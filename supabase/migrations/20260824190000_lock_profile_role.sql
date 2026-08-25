-- =============================================================================
-- LYFTT — Verrouillage du rôle et de l'activation d'un profil
--
-- Correctif de la vulnérabilité C-01 (audit du 24 août 2026).
--
-- La politique `profiles_update_self` autorise chacun à modifier son propre
-- profil : `using (id = auth.uid()) with check (id = auth.uid())`. Or PostgreSQL
-- n'applique pas la RLS colonne par colonne — une policy qui ne contraint que
-- l'identité de la ligne ouvre TOUTES ses colonnes, `role` et `is_active`
-- comprises.
--
-- Conséquence : n'importe quel compte authentifié pouvait s'attribuer le rôle
-- `super_admin` par un simple appel à l'API REST, avec son propre jeton et la
-- clé anon — publique par conception. Le rôle `super_admin` ouvre le budget,
-- les RIB des clients et la suppression définitive de clients.
--
-- Deux couches indépendantes sont posées ici : les privilèges de colonne, puis
-- un trigger qui reste efficace même si un GRANT trop large réapparaissait.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privilèges de colonne — ne laisser modifiable que ce qui relève du profil
-- ----------------------------------------------------------------------------

revoke update on public.profiles from authenticated;
grant  update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- `anon` n'a aucune politique sur cette table et ne peut donc rien écrire ;
-- le privilège lui est tout de même retiré, par défense en profondeur.
revoke update on public.profiles from anon;

-- ----------------------------------------------------------------------------
-- 2. Filet de sécurité — indépendant des privilèges accordés
-- ----------------------------------------------------------------------------

/*
 * `auth.uid()` est nul lorsque la requête vient de la clé service-role : les
 * actions légitimes d'administration (`changeMemberRole`, `setMemberActive`,
 * `createTeamMember`), déjà protégées par `requireSuperAdmin()` côté serveur,
 * continuent donc de fonctionner. Seules les requêtes faites au nom d'un
 * utilisateur authentifié sont concernées.
 */
create or replace function profiles_block_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active) then
    raise exception
      'Le rôle et l''activation d''un compte ne peuvent être modifiés que par un administrateur.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_no_self_promotion on public.profiles;

create trigger profiles_no_self_promotion
  before update on public.profiles
  for each row
  execute function profiles_block_privilege_escalation();
