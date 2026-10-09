-- « Vos envies » — plafond et neutralité vis-à-vis du statut de la fiche.
--
-- À appliquer **après** `20261009120000_envies_client_enum.sql` : les deux
-- objets ci-dessous nomment la valeur `weekly_wish`, qui ne peut pas être
-- ajoutée et utilisée dans la même transaction.

-- ----------------------------------------------------------------------------
-- Une envie par fiche, c'est-à-dire une par semaine.
--
-- Le portail vérifie déjà le plafond avant d'insérer, mais deux envois
-- simultanés passeraient tous les deux : la limite de vingt tickets par heure
-- et par lien ne l'empêche pas. La contrainte est donc en base, où elle ne
-- peut pas être contournée — y compris par la clé service-role.
-- ----------------------------------------------------------------------------
create unique index if not exists client_tickets_une_envie_par_fiche
  on public.client_tickets (weekly_sheet_id)
  where ticket_type = 'weekly_wish';

comment on index public.client_tickets_une_envie_par_fiche is
  'Une seule envie client par fiche hebdomadaire : le portail la propose une fois par semaine.';

-- ----------------------------------------------------------------------------
-- Le statut d'une fiche ne dépend que des demandes portant sur son contenu.
--
-- `recompute_sheet_status()` comptait **tous** les tickets ouverts de la
-- fiche, sans distinction de type. Une envie — qui ne corrige rien et dont
-- l'objet est la semaine *suivante* — laissait donc `open_tickets > 0` et
-- figeait la fiche en `changes_requested` au lieu de `new_version_to_send`,
-- ou en `corrections_in_progress` au lieu de `awaiting_revalidation`. La liste
-- « à renvoyer » du tableau de bord se lit sur `new_version_to_send` : une
-- envie ouverte pouvait y masquer une fiche qui attendait son renvoi.
--
-- Le défaut valait déjà pour les devis, les dates de shooting et les services
-- annexes, arrivés en août : ils sont exclus par la même occasion.
--
-- La comparaison se fait sur `ticket_type::text` : la fonction reste
-- installable et exécutable quelle que soit la composition de l'énumération.
-- Le reste du corps est inchangé.
-- ----------------------------------------------------------------------------
create or replace function recompute_sheet_status(target_sheet_id uuid)
returns sheet_status
language plpgsql security definer set search_path = public as $$
declare
  s              record;
  total          int;
  approved       int;
  requested      int;
  corrected      int;
  open_tickets   int;
  next_status    sheet_status;
begin
  select * into s from weekly_sheets where id = target_sheet_id;
  if not found then
    return null;
  end if;

  -- Un statut terminal posé explicitement (validation tacite, refus, forçage)
  -- n'est pas recalculé automatiquement.
  if s.status in ('draft', 'internal_review', 'ready_to_send',
                  'tacitly_approved', 'rejected', 'expired') then
    return s.status;
  end if;

  select
    count(*) filter (where not is_cancelled),
    count(*) filter (where not is_cancelled and approval_status in ('approved', 'approved_after_fix')),
    count(*) filter (where not is_cancelled and approval_status = 'changes_requested'),
    count(*) filter (where not is_cancelled and approval_status in ('corrected', 'resent'))
  into total, approved, requested, corrected
  from weekly_sheet_items where weekly_sheet_id = target_sheet_id;

  select count(*) into open_tickets
  from client_tickets
  where weekly_sheet_id = target_sheet_id
    and status not in ('closed', 'cancelled', 'rejected', 'approved_by_client')
    -- Demandes hors publication : elles ne portent sur aucun contenu de la
    -- fiche, elles ne peuvent donc pas retenir son statut.
    and ticket_type::text not in
        ('quote_request', 'shooting_request', 'side_service', 'weekly_wish');

  if total = 0 then
    next_status := s.status;
  elsif approved = total then
    next_status := 'approved_by_client';
  elsif requested > 0 then
    next_status := case
      when open_tickets = 0 then 'new_version_to_send'
      else 'changes_requested'
    end;
  elsif corrected > 0 then
    next_status := case
      when open_tickets > 0 then 'corrections_in_progress'
      else 'awaiting_revalidation'
    end;
  elsif approved > 0 then
    next_status := 'partially_approved';
  else
    next_status := 'sent_to_client';
  end if;

  if next_status is distinct from s.status then
    update weekly_sheets
       set status = next_status,
           approved_at = case when next_status = 'approved_by_client'
                              then coalesce(approved_at, now()) end
     where id = target_sheet_id;
  end if;

  return next_status;
end;
$$;

-- `create or replace` conserve les droits existants ; on les repose malgré
-- tout, pour que la migration soit lisible seule (cf. 20260804090400).
revoke execute on function recompute_sheet_status(uuid)
  from public, anon, authenticated;
