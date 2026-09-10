-- Les sauvegardes sortent de l'API, et les prédicats RLS aussi.
--
-- Supabase a signalé « Table publicly accessible » : deux tables de sauvegarde
-- créées avant des corrections de données vivaient dans `public` sans RLS.
-- Or `public` est le schéma exposé par PostgREST, et Supabase accorde par
-- défaut tous les droits à `anon` sur ses nouvelles tables — clé anon qui est
-- publique par nature, embarquée dans le bundle du navigateur. N'importe qui
-- pouvait donc les lire ET les supprimer.
--
-- Une sauvegarde n'a rien à faire dans un schéma exposé : elle ne sert qu'à
-- revenir en arrière, depuis la console. Elle vit désormais dans `sauvegardes`,
-- que l'API ne publie pas, avec RLS active et aucun droit pour le navigateur.
-- Trois barrières plutôt qu'une : le schéma, les droits, la RLS.

create schema if not exists sauvegardes;

comment on schema sauvegardes is
  'Sauvegardes ponctuelles prises avant une correction de données. Hors des schémas exposés par l''API : rien n''y est joignable depuis un navigateur.';

revoke all on schema sauvegardes from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    '_backup_lignes_budget_supprimees',
    '_backup_rattrapage_20260901',
    'clients_notes_backup_20260825',
    'sheet_items_dates_backup_20260828'
  ] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I set schema sauvegardes', t);
    end if;
    if exists (select 1 from pg_tables where schemaname = 'sauvegardes' and tablename = t) then
      execute format('revoke all on sauvegardes.%I from anon, authenticated', t);
      execute format('alter table sauvegardes.%I enable row level security', t);
    end if;
  end loop;
end $$;

/*
 * Prédicats des politiques RLS : ils étaient appelables sans être connecté,
 * via /rest/v1/rpc/. Le droit venait de `PUBLIC`, si bien que le retirer à
 * `anon` seul ne retirait rien.
 *
 * `authenticated` le conserve : une expression de politique s'évalue avec les
 * privilèges de celui qui interroge, et le lui retirer casserait tout le
 * cloisonnement au lieu de le renforcer.
 */
revoke execute on function public.is_commercial()     from public;
revoke execute on function public.is_producer()       from public;
revoke execute on function public.is_active_profile() from public;
grant  execute on function public.is_commercial()     to authenticated;
grant  execute on function public.is_producer()       to authenticated;
grant  execute on function public.is_active_profile() to authenticated;

-- Fonctions de déclencheur : elles s'exécutent au nom du propriétaire de la
-- table. Personne n'a besoin de pouvoir les appeler directement.
revoke execute on function public.client_tickets_block_contractual_changes() from public, anon, authenticated;
revoke execute on function public.profiles_block_privilege_escalation()      from public, anon, authenticated;

-- Une fonction SECURITY DEFINER sans search_path figé peut être détournée par
-- un schéma placé devant le sien.
alter function public.client_rib_events_block_update() set search_path = public, pg_temp;
