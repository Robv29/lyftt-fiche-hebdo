-- =============================================================================
-- LYFTT — Durcissement des fonctions
--
-- PostgREST expose automatiquement toute fonction du schéma `public` sous
-- /rest/v1/rpc/. Combiné à SECURITY DEFINER — qui contourne RLS — cela rendait
-- `create_sheet_version` et `apply_tacit_approvals` appelables par n'importe
-- quel visiteur anonyme. Détecté par l'audit Supabase après déploiement.
-- =============================================================================

-- Ces trois fonctions sont appelées soit par des triggers, soit par le serveur
-- avec la clé service-role, qui n'est pas soumise à ces révocations.
revoke execute on function create_sheet_version(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function apply_tacit_approvals()
  from public, anon, authenticated;
revoke execute on function recompute_sheet_status(uuid)
  from public, anon, authenticated;

-- Les aides de RLS sont évaluées à l'intérieur des politiques, donc au nom de
-- l'utilisateur connecté : `authenticated` doit conserver EXECUTE. Le rôle
-- `anon` n'a aucune politique, il n'en a donc jamais besoin.
revoke execute on function current_role_is(app_role[]) from public, anon;
revoke execute on function is_staff_lead() from public, anon;
revoke execute on function can_access_client(uuid) from public, anon;
revoke execute on function can_access_ticket(uuid) from public, anon;

grant execute on function current_role_is(app_role[]) to authenticated;
grant execute on function is_staff_lead() to authenticated;
grant execute on function can_access_client(uuid) to authenticated;
grant execute on function can_access_ticket(uuid) to authenticated;

-- search_path figé : évite qu'un schéma placé en amont détourne un appel.
alter function set_updated_at() set search_path = public;
alter function compute_validation_deadline(uuid, date) set search_path = public;
alter function weekly_sheets_set_deadline() set search_path = public;
alter function trg_recompute_sheet_status() set search_path = public;
