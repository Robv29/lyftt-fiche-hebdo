-- =============================================================================
-- LYFTT — Fonctions métier côté base
-- Ce qui doit rester vrai quelle que soit la porte d'entrée (application, cron,
-- correction manuelle) est implémenté ici plutôt que dans l'application.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- §3 — Échéance de validation, calculée depuis la semaine de publication.
-- Jamais un texte en dur : jour + heure + fuseau viennent du paramétrage client.
-- ----------------------------------------------------------------------------

create or replace function compute_validation_deadline(
  target_client_id uuid,
  period_start date
) returns timestamptz
language plpgsql stable as $$
declare
  c            record;
  deadline_day date;
begin
  select timezone, validation_deadline_weekday, validation_deadline_time
    into c
  from clients where id = target_client_id;

  if not found then
    raise exception 'Client % introuvable', target_client_id;
  end if;

  -- period_start est un lundi (semaine ISO) ; on avance jusqu'au jour paramétré.
  deadline_day := period_start
    + ((c.validation_deadline_weekday - extract(isodow from period_start)::int + 7) % 7);

  -- Interprète l'heure dans le fuseau du client, puis convertit en instant absolu.
  return ((deadline_day + c.validation_deadline_time) at time zone c.timezone);
end;
$$;

comment on function compute_validation_deadline is
  'Échéance absolue calculée à partir de la semaine de publication (§3).';

-- Renseigne l'échéance à la création d'une fiche si elle n'est pas fournie.
create or replace function weekly_sheets_set_deadline() returns trigger
language plpgsql as $$
begin
  if new.validation_deadline_at is null then
    new.validation_deadline_at := compute_validation_deadline(new.client_id, new.period_start);
  end if;
  return new;
end;
$$;

create trigger weekly_sheets_set_deadline_trg
  before insert on weekly_sheets
  for each row execute function weekly_sheets_set_deadline();

-- ----------------------------------------------------------------------------
-- §11 — Gel d'une version : snapshot de tous les contenus de la fiche.
-- ----------------------------------------------------------------------------

create or replace function create_sheet_version(
  target_sheet_id uuid,
  summary text default null,
  author uuid default null,
  ticket uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  next_number int;
  version_id  uuid;
begin
  -- Verrouille la fiche : deux corrections simultanées ne doivent pas produire
  -- deux fois le même numéro de version.
  perform 1 from weekly_sheets where id = target_sheet_id for update;

  select coalesce(max(version_number), 0) + 1 into next_number
  from weekly_sheet_versions where weekly_sheet_id = target_sheet_id;

  -- Toute version précédente encore « envoyée » devient obsolète (§14).
  update weekly_sheet_versions
     set status = 'superseded'
   where weekly_sheet_id = target_sheet_id and status in ('draft', 'sent');

  insert into weekly_sheet_versions (
    weekly_sheet_id, version_number, status, change_summary, created_by, source_ticket_id
  ) values (
    target_sheet_id, next_number, 'draft', summary, author, ticket
  ) returning id into version_id;

  insert into weekly_sheet_item_versions (
    weekly_sheet_item_id, sheet_version_id, content_snapshot, media_snapshot, created_by
  )
  select
    i.id,
    version_id,
    jsonb_build_object(
      'position', i.position,
      'scheduled_date', i.scheduled_date,
      'scheduled_time', i.scheduled_time,
      'publication_type', i.publication_type,
      'format', i.format,
      'networks', to_jsonb(i.networks),
      'caption', i.caption,
      'hashtags', to_jsonb(i.hashtags),
      'is_cancelled', i.is_cancelled
    ),
    case when m.id is null then null else jsonb_build_object(
      'media_asset_id', m.id,
      'kind', m.kind,
      'storage_path', m.storage_path,
      'thumbnail_path', m.thumbnail_path,
      'file_name', m.file_name
    ) end,
    author
  from weekly_sheet_items i
  left join media_assets m on m.id = i.media_asset_id
  where i.weekly_sheet_id = target_sheet_id;

  update weekly_sheets
     set current_version_id = version_id
   where id = target_sheet_id;

  -- Les exports rattachés aux versions précédentes ne doivent plus être envoyés (§14).
  update sheet_exports
     set is_obsolete = true, obsoleted_at = now()
   where weekly_sheet_id = target_sheet_id
     and sheet_version_id <> version_id
     and not is_obsolete;

  return version_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- §15 — Statut global de la fiche, recalculé à partir des contenus.
-- La fiche n'est « validée » que si tous les contenus le sont.
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
    and status not in ('closed', 'cancelled', 'rejected', 'approved_by_client');

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

create or replace function trg_recompute_sheet_status() returns trigger
language plpgsql as $$
declare
  sheet_id uuid;
begin
  sheet_id := coalesce(
    case when tg_table_name = 'weekly_sheet_items'
         then coalesce(new.weekly_sheet_id, old.weekly_sheet_id) end,
    case when tg_table_name = 'client_tickets'
         then coalesce(new.weekly_sheet_id, old.weekly_sheet_id) end
  );

  if sheet_id is not null then
    perform recompute_sheet_status(sheet_id);
  end if;
  return null;
end;
$$;

create trigger weekly_sheet_items_recompute_status
  after insert or update of approval_status, is_cancelled or delete
  on weekly_sheet_items
  for each row execute function trg_recompute_sheet_status();

create trigger client_tickets_recompute_status
  after insert or update of status or delete
  on client_tickets
  for each row execute function trg_recompute_sheet_status();

-- ----------------------------------------------------------------------------
-- §16 — Validation tacite : appliquée par tâche planifiée, uniquement si le
-- client l'a explicitement autorisée ET qu'un message a bien été envoyé.
-- ----------------------------------------------------------------------------

create or replace function apply_tacit_approvals()
returns table (weekly_sheet_id uuid, items_approved int)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int;
begin
  for r in
    select s.id, s.client_id
    from weekly_sheets s
    join clients c on c.id = s.client_id
    where c.approval_policy = 'tacit_allowed'
      and s.status in ('sent_to_client', 'partially_approved', 'awaiting_revalidation')
      and s.validation_deadline_at is not null
      and s.validation_deadline_at < now()
      -- Preuve d'envoi obligatoire : sans message envoyé, pas de tacite.
      and exists (
        select 1 from client_message_dispatches d where d.weekly_sheet_id = s.id
      )
      -- Aucune demande de modification en cours.
      and not exists (
        select 1 from client_tickets t
        where t.weekly_sheet_id = s.id
          and t.status not in ('closed', 'cancelled', 'rejected', 'approved_by_client')
      )
  loop
    update weekly_sheet_items
       set approval_status = 'approved'
     where weekly_sheet_items.weekly_sheet_id = r.id
       and not is_cancelled
       and approval_status = 'pending';
    get diagnostics n = row_count;

    update weekly_sheets
       set status = 'tacitly_approved', approved_at = now()
     where id = r.id;

    weekly_sheet_id := r.id;
    items_approved := n;
    return next;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- §19 — Stockage : buckets privés. Les médias ne sont servis qu'en URL signée.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('media', 'media', false), ('exports', 'exports', false)
on conflict (id) do nothing;
