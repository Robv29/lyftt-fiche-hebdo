-- =============================================================================
-- LYFTT — Journalisation des accès aux coordonnées bancaires
--
-- Recommandation de l'audit du 24 août 2026 (constat T2, « [RP] Le RIB »).
--
-- Le RIB est la donnée la plus sensible de l'application. Sa consultation ne
-- laissait jusqu'ici aucune trace : un `super_admin` pouvait ouvrir les
-- coordonnées bancaires d'un client sans que rien ne le consigne, ce qui rend
-- impossible de répondre à « qui y a accédé, et quand » — question posée aussi
-- bien par une enquête interne que par l'art. 33 en cas de violation.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rib_event_type') then
    create type rib_event_type as enum ('viewed', 'uploaded', 'replaced', 'removed', 'purged');
  end if;
end $$;

create table if not exists public.client_rib_events (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  -- Nul lorsque l'événement vient d'une tâche automatique (purge planifiée).
  profile_id         uuid references public.profiles(id) on delete set null,
  /*
   * Nom recopié au moment de l'accès. Un compte supprimé met `profile_id` à
   * nul : sans cette copie, l'événement dirait « quelqu'un » — un journal qui
   * ne nomme plus personne ne vaut rien.
   */
  profile_label      text,
  event_type         rib_event_type not null,
  metadata           jsonb not null default '{}',
  ip_hash            text,
  user_agent_family  text,
  created_at         timestamptz not null default now()
);

comment on table public.client_rib_events is
  'Journal des accès aux coordonnées bancaires (RIB). Écrit uniquement par la clé '
  'service-role ; lisible par les super_admin. Conservation 12 mois, purgée par la '
  'tâche planifiée quotidienne.';

create index if not exists client_rib_events_client_idx
  on public.client_rib_events (client_id, created_at desc);

create index if not exists client_rib_events_created_at_idx
  on public.client_rib_events (created_at);

alter table public.client_rib_events enable row level security;

/*
 * Lecture réservée à la direction : le journal dit qui consulte les données
 * bancaires, c'est une donnée sensible à son tour.
 *
 * Aucune policy d'écriture n'est créée : sous RLS, l'absence de policy vaut
 * interdiction. Seule la clé service-role, qui contourne la RLS, alimente ce
 * journal — et elle n'est employée que par le serveur.
 */
drop policy if exists client_rib_events_select on public.client_rib_events;
create policy client_rib_events_select on public.client_rib_events
  for select
  using (current_role_is(array['super_admin'::app_role]));

/*
 * Immuabilité. Un événement consigné ne se réécrit pas : autoriser la
 * modification viderait le journal de sa valeur probante, y compris vis-à-vis
 * de celui qui détient la clé service-role.
 *
 * La suppression reste possible : elle sert la purge de rétention et
 * l'effacement des données d'un client qui le demande (art. 17).
 */
create or replace function client_rib_events_block_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Un événement du journal des accès au RIB ne peut pas être modifié.'
    using errcode = '42501';
end;
$$;

drop trigger if exists client_rib_events_immutable on public.client_rib_events;

create trigger client_rib_events_immutable
  before update on public.client_rib_events
  for each row
  execute function client_rib_events_block_update();
