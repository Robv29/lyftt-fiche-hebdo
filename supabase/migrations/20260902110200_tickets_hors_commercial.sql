-- Les tickets sortent du périmètre des rôles qui ne produisent pas.
--
-- `can_access_ticket()` accorde l'accès par affectation personnelle, sans
-- regarder le rôle. Un compte passé au rôle commercial gardait donc ses
-- anciennes affectations : il voyait le ticket, et pouvait le modifier — un
-- rôle « consultation seule » qui écrit. Vérifié en base avant correction, sur
-- un compte d'essai basculé en commercial dans une transaction annulée.
--
-- Le contrôle est posé côté rôle plutôt qu'en retirant les affectations : une
-- affectation reste une trace de qui a travaillé sur quoi, et l'effacer pour
-- gérer un droit ferait perdre cette trace.

create or replace function is_producer() returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_is(array[
    'super_admin', 'production_manager', 'community_manager',
    'graphic_designer', 'video_editor'
  ]::app_role[]);
$$;

comment on function is_producer() is
  'Rôles qui produisent. Exclut commercial et observateur, qui ne font que consulter.';

drop policy client_tickets_update on client_tickets;
create policy client_tickets_update on client_tickets
  for update to authenticated
  using (can_access_ticket(id) and is_producer())
  with check (can_access_ticket(id) and is_producer());

drop policy client_ticket_assignments_write on client_ticket_assignments;
create policy client_ticket_assignments_write on client_ticket_assignments
  for all to authenticated
  using (can_access_ticket(ticket_id) and is_producer())
  with check (can_access_ticket(ticket_id) and is_producer());

drop policy client_ticket_comments_insert on client_ticket_comments;
create policy client_ticket_comments_insert on client_ticket_comments
  for insert to authenticated
  with check (can_access_ticket(ticket_id) and is_producer());

drop policy client_ticket_attachments_insert on client_ticket_attachments;
create policy client_ticket_attachments_insert on client_ticket_attachments
  for insert to authenticated
  with check (can_access_ticket(ticket_id) and is_producer());

-- En lecture aussi : le commercial n'a rien à faire dans les tickets.
drop policy client_tickets_select on client_tickets;
create policy client_tickets_select on client_tickets
  for select to authenticated
  using (can_access_ticket(id) and not is_commercial());

drop policy client_ticket_comments_select on client_ticket_comments;
create policy client_ticket_comments_select on client_ticket_comments
  for select to authenticated
  using (can_access_ticket(ticket_id) and not is_commercial());

drop policy client_ticket_attachments_select on client_ticket_attachments;
create policy client_ticket_attachments_select on client_ticket_attachments
  for select to authenticated
  using (can_access_ticket(ticket_id) and not is_commercial());

drop policy client_ticket_assignments_select on client_ticket_assignments;
create policy client_ticket_assignments_select on client_ticket_assignments
  for select to authenticated
  using ((profile_id = auth.uid() or can_access_ticket(ticket_id)) and not is_commercial());
