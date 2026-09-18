-- =============================================================================
-- Commandes de production : à qui elles sont confiées, qui les livre, qui les
-- valide.
--
-- Une commande partait « à la production » sans destinataire : chacun pensait
-- que l'autre s'en chargeait. Elle est désormais confiée à une personne, qui
-- la voit comme la sienne. Et pour savoir si ce qui est commandé est rendu à
-- l'heure, il faut savoir par qui : la livraison et la validation gardent le
-- nom de leur auteur.
--
-- Les noms sont figés, comme `requested_by_name` et
-- `weekly_sheet_staff_validations.validated_by_name` : l'historique reste
-- lisible si le compte est désactivé ou effacé.
--
-- Passé : seule la livraison se reconstitue de façon sûre — le fichier livré
-- est téléversé par la personne qui livre, dans le même geste, une à deux
-- secondes avant la livraison. Rien ne dit en revanche à qui les commandes
-- étaient destinées ni qui les a validées : ces colonnes restent vides
-- (« non renseigné ») plutôt que devinées.
-- =============================================================================

alter table production_requests
  add column assigned_to       uuid references profiles(id) on delete set null,
  add column assigned_to_name  text,
  add column assigned_at       timestamptz,
  add column delivered_by      uuid references profiles(id) on delete set null,
  add column delivered_by_name text,
  add column validated_by      uuid references profiles(id) on delete set null,
  add column validated_by_name text;

comment on column production_requests.assigned_to is
  'Personne de production à qui la commande est confiée.';
comment on column production_requests.delivered_by is
  'Auteur de la dernière livraison (un nouveau dépôt remplace le précédent).';
comment on column production_requests.validated_by is
  'Personne qui a validé la livraison.';

create index production_requests_assignee_idx
  on production_requests (assigned_to, status);

-- -----------------------------------------------------------------------------
-- Reprise du passé : qui a livré. Avant le déclencheur, qui refuserait
-- d'écrire un autre nom que celui de l'utilisateur connecté.
-- -----------------------------------------------------------------------------
update production_requests pr
   set delivered_by      = ma.uploaded_by,
       delivered_by_name = p.full_name
  from media_assets ma
  join profiles p on p.id = ma.uploaded_by
 where ma.id = pr.media_asset_id
   and pr.delivered_at is not null
   and pr.delivered_by is null
   -- Même geste : le fichier précède la livraison de quelques secondes.
   and pr.delivered_at >= ma.created_at
   and pr.delivered_at - ma.created_at < interval '10 minutes';

-- -----------------------------------------------------------------------------
-- Qui peut recevoir une commande.
--
-- La liste est lue par tout membre de l'équipe qui commande — y compris un
-- rôle qui ne lit que son propre profil. D'où une fonction à droits
-- d'auteur, qui ne rend que le strict nécessaire, et rien au commercial ni à
-- un compte désactivé.
-- -----------------------------------------------------------------------------
create or replace function production_assignees()
returns table (id uuid, full_name text, role app_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role
    from profiles p
   where p.is_active
     and p.role in ('production_manager', 'graphic_designer', 'video_editor')
     and current_role_is(array[
       'super_admin', 'production_manager', 'community_manager',
       'graphic_designer', 'video_editor', 'observer'
     ]::app_role[])
   order by p.full_name;
$$;

comment on function production_assignees() is
  'Personnes actives à qui confier une commande de production. Même liste que PRODUCTION_ASSIGNEE_ROLES côté application.';

revoke execute on function production_assignees() from public, anon;
grant execute on function production_assignees() to authenticated;

-- -----------------------------------------------------------------------------
-- Garde-fou en base : les noms suivent les identifiants, et nul ne signe à
-- la place d'un autre.
--
-- • La personne confiée doit être active, de la production, et avoir accès au
--   client — sans quoi la RLS lui cacherait la commande qu'on vient de lui
--   confier (graphiste ou vidéaste non rattaché au client).
-- • Livrer et valider s'inscrivent au nom de l'utilisateur connecté ; la clé
--   service (auth.uid() nul) n'est pas concernée.
-- • Un nom figé ne se réécrit pas seul : il est tiré du profil quand
--   l'identifiant change, et conservé sinon. Quand l'identifiant retombe à nul
--   (profil effacé, ou retour en production), le nom est laissé tel que
--   l'écrit l'application.
-- -----------------------------------------------------------------------------
create or replace function production_requests_stamp_people()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_assignee record;
begin
  -- Personne confiée.
  if new.assigned_to is not null then
    if tg_op = 'INSERT'
       or new.assigned_to is distinct from old.assigned_to
       or new.client_id is distinct from old.client_id then
      select id, full_name, role into v_assignee
        from profiles
       where id = new.assigned_to
         and is_active
         and role in ('production_manager', 'graphic_designer', 'video_editor');
      if not found then
        raise exception using
          errcode = 'check_violation',
          message = 'Cette personne ne peut pas recevoir de commande de production.';
      end if;
      if v_assignee.role <> 'production_manager' and not exists (
        select 1 from client_assignments
         where client_id = new.client_id and profile_id = new.assigned_to
      ) then
        raise exception using
          errcode = 'check_violation',
          message = format('%s n''a pas accès à ce client. Rattachez d''abord cette personne au client.', v_assignee.full_name);
      end if;
      new.assigned_to_name := v_assignee.full_name;
      if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
        new.assigned_at := now();
      else
        new.assigned_at := old.assigned_at;
      end if;
    else
      new.assigned_to_name := old.assigned_to_name;
      new.assigned_at := old.assigned_at;
    end if;
  end if;

  -- Auteur de la livraison.
  if new.delivered_by is not null then
    if tg_op = 'INSERT' or new.delivered_by is distinct from old.delivered_by then
      if auth.uid() is not null and new.delivered_by <> auth.uid() then
        raise exception using
          errcode = 'insufficient_privilege',
          message = 'Une livraison s''enregistre au nom de la personne connectée.';
      end if;
      new.delivered_by_name := (select full_name from profiles where id = new.delivered_by);
    else
      new.delivered_by_name := old.delivered_by_name;
    end if;
  end if;

  -- Auteur de la validation.
  if new.validated_by is not null then
    if tg_op = 'INSERT' or new.validated_by is distinct from old.validated_by then
      if auth.uid() is not null and new.validated_by <> auth.uid() then
        raise exception using
          errcode = 'insufficient_privilege',
          message = 'Une validation s''enregistre au nom de la personne connectée.';
      end if;
      new.validated_by_name := (select full_name from profiles where id = new.validated_by);
    else
      new.validated_by_name := old.validated_by_name;
    end if;
  end if;

  return new;
end;
$$;

-- Appelée par le déclencheur seulement : personne n'a à l'exécuter en direct.
revoke execute on function production_requests_stamp_people() from public, anon, authenticated;

create trigger production_requests_stamp_people
  before insert or update on production_requests
  for each row execute function production_requests_stamp_people();

-- -----------------------------------------------------------------------------
-- Droits. `anon` n'a aucune politique sur ces tables ; TRUNCATE contourne la
-- RLS : ni l'un ni l'autre n'a lieu d'être.
-- -----------------------------------------------------------------------------
revoke all on production_requests from anon;
revoke truncate, trigger, references on production_requests from authenticated;

revoke all on internal_notifications from anon;
revoke truncate, trigger, references on internal_notifications from authenticated;
