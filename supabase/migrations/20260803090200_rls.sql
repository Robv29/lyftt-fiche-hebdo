-- =============================================================================
-- LYFTT — Politiques d'accès
--
-- Principe : le portail client n'utilise JAMAIS la clé anon. Il est rendu côté
-- serveur, après vérification du token, avec le client service-role. Aucune
-- policy n'ouvre donc quoi que ce soit au rôle `anon` : une fuite de la clé
-- publique ne donne accès à rien (§19).
-- =============================================================================

alter table profiles                   enable row level security;
alter table clients                    enable row level security;
alter table client_contacts            enable row level security;
alter table client_assignments         enable row level security;
alter table media_assets               enable row level security;
alter table weekly_sheets              enable row level security;
alter table weekly_sheet_items         enable row level security;
alter table weekly_sheet_versions      enable row level security;
alter table weekly_sheet_item_versions enable row level security;
alter table client_review_links        enable row level security;
alter table client_review_events       enable row level security;
alter table client_tickets             enable row level security;
alter table client_ticket_assignments  enable row level security;
alter table client_ticket_comments     enable row level security;
alter table client_ticket_attachments  enable row level security;
alter table client_content_approvals   enable row level security;
alter table client_message_templates   enable row level security;
alter table client_message_dispatches  enable row level security;
alter table sheet_exports              enable row level security;
alter table internal_notifications     enable row level security;

-- ----------------------------------------------------------------------------
-- Aides
-- ----------------------------------------------------------------------------

create or replace function current_role_is(roles app_role[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role = any (roles)
  );
$$;

-- Encadrement : super_admin + responsable de production voient tout.
create or replace function is_staff_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_is(array['super_admin', 'production_manager']::app_role[]);
$$;

-- Un membre « voit » un client s'il y est affecté, ou s'il fait partie de l'encadrement.
create or replace function can_access_client(target_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff_lead() or exists (
    select 1 from client_assignments
    where client_id = target_client_id and profile_id = auth.uid()
  );
$$;

-- Un membre « voit » un ticket s'il a accès au client, ou s'il y est affecté
-- personnellement — c'est ce qui limite graphistes et vidéastes aux seules
-- corrections qui les concernent (§22).
create or replace function can_access_ticket(target_ticket_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from client_tickets t
    where t.id = target_ticket_id and can_access_client(t.client_id)
  ) or exists (
    select 1 from client_ticket_assignments a
    where a.ticket_id = target_ticket_id and a.profile_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Profils
-- ----------------------------------------------------------------------------

create policy profiles_select_self_or_team on profiles
  for select to authenticated
  using (id = auth.uid() or current_role_is(array[
    'super_admin', 'production_manager', 'community_manager'
  ]::app_role[]));

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_all on profiles
  for all to authenticated
  using (current_role_is(array['super_admin']::app_role[]))
  with check (current_role_is(array['super_admin']::app_role[]));

-- ----------------------------------------------------------------------------
-- Clients et rattachements
-- ----------------------------------------------------------------------------

create policy clients_select on clients
  for select to authenticated using (can_access_client(id));

create policy clients_write on clients
  for all to authenticated
  using (is_staff_lead()) with check (is_staff_lead());

create policy client_contacts_select on client_contacts
  for select to authenticated using (can_access_client(client_id));

create policy client_contacts_write on client_contacts
  for all to authenticated
  using (can_access_client(client_id) and current_role_is(array[
    'super_admin', 'production_manager', 'community_manager'
  ]::app_role[]))
  with check (can_access_client(client_id));

create policy client_assignments_select on client_assignments
  for select to authenticated
  using (profile_id = auth.uid() or can_access_client(client_id));

create policy client_assignments_write on client_assignments
  for all to authenticated
  using (is_staff_lead()) with check (is_staff_lead());

-- ----------------------------------------------------------------------------
-- Fiches, contenus, médias
-- ----------------------------------------------------------------------------

create policy media_assets_select on media_assets
  for select to authenticated using (can_access_client(client_id));

create policy media_assets_insert on media_assets
  for insert to authenticated with check (can_access_client(client_id));

create policy weekly_sheets_select on weekly_sheets
  for select to authenticated using (can_access_client(client_id));

create policy weekly_sheets_write on weekly_sheets
  for all to authenticated
  using (can_access_client(client_id) and current_role_is(array[
    'super_admin', 'production_manager', 'community_manager'
  ]::app_role[]))
  with check (can_access_client(client_id));

create policy weekly_sheet_items_select on weekly_sheet_items
  for select to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy weekly_sheet_items_write on weekly_sheet_items
  for all to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id
      and can_access_client(s.client_id)
      and current_role_is(array[
        'super_admin', 'production_manager', 'community_manager'
      ]::app_role[])
  ))
  with check (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy weekly_sheet_versions_select on weekly_sheet_versions
  for select to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy weekly_sheet_item_versions_select on weekly_sheet_item_versions
  for select to authenticated
  using (exists (
    select 1 from weekly_sheet_versions v
    join weekly_sheets s on s.id = v.weekly_sheet_id
    where v.id = sheet_version_id and can_access_client(s.client_id)
  ));

-- ----------------------------------------------------------------------------
-- Liens de consultation — lecture seule côté application authentifiée.
-- La création et la révocation passent par des fonctions serveur.
-- ----------------------------------------------------------------------------

create policy client_review_links_select on client_review_links
  for select to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy client_review_events_select on client_review_events
  for select to authenticated
  using (exists (
    select 1 from client_review_links l
    join weekly_sheets s on s.id = l.weekly_sheet_id
    where l.id = review_link_id and can_access_client(s.client_id)
  ));

-- ----------------------------------------------------------------------------
-- Tickets
-- ----------------------------------------------------------------------------

create policy client_tickets_select on client_tickets
  for select to authenticated using (can_access_ticket(id));

-- Un graphiste ou un vidéaste peut faire avancer un ticket qui lui est affecté,
-- mais la création et la clôture restent à l'encadrement éditorial (§22).
create policy client_tickets_update on client_tickets
  for update to authenticated
  using (can_access_ticket(id)) with check (can_access_ticket(id));

create policy client_tickets_insert on client_tickets
  for insert to authenticated
  with check (can_access_client(client_id) and current_role_is(array[
    'super_admin', 'production_manager', 'community_manager'
  ]::app_role[]));

create policy client_ticket_assignments_select on client_ticket_assignments
  for select to authenticated
  using (profile_id = auth.uid() or can_access_ticket(ticket_id));

create policy client_ticket_assignments_write on client_ticket_assignments
  for all to authenticated
  using (can_access_ticket(ticket_id)) with check (can_access_ticket(ticket_id));

create policy client_ticket_comments_select on client_ticket_comments
  for select to authenticated using (can_access_ticket(ticket_id));

create policy client_ticket_comments_insert on client_ticket_comments
  for insert to authenticated with check (can_access_ticket(ticket_id));

create policy client_ticket_attachments_select on client_ticket_attachments
  for select to authenticated using (can_access_ticket(ticket_id));

create policy client_ticket_attachments_insert on client_ticket_attachments
  for insert to authenticated with check (can_access_ticket(ticket_id));

-- ----------------------------------------------------------------------------
-- Validations, messages, exports, notifications
-- ----------------------------------------------------------------------------

create policy client_content_approvals_select on client_content_approvals
  for select to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy client_message_templates_select on client_message_templates
  for select to authenticated
  using (client_id is null or can_access_client(client_id));

create policy client_message_templates_write on client_message_templates
  for all to authenticated
  using (is_staff_lead()) with check (is_staff_lead());

create policy client_message_dispatches_select on client_message_dispatches
  for select to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy client_message_dispatches_insert on client_message_dispatches
  for insert to authenticated
  with check (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy sheet_exports_select on sheet_exports
  for select to authenticated
  using (exists (
    select 1 from weekly_sheets s
    where s.id = weekly_sheet_id and can_access_client(s.client_id)
  ));

create policy internal_notifications_own on internal_notifications
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
