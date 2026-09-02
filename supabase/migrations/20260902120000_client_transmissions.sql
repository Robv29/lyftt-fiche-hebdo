-- =============================================================================
-- Transmission client — le passage du CRM commercial à la production
--
-- Les deux applications ne partagent rien. Quand un client signait et
-- composait son menu de prestations, l'information restait chez le commercial
-- et le chef de projet l'apprenait par message, souvent le jour du rendez-vous.
-- Le CRM dépose désormais la fiche ici ; elle attend d'être prise en charge,
-- puis devient un vrai client.
--
-- `crm_prospect_id` est unique parce que le CRM peut renvoyer la même fiche
-- plusieurs fois : menu modifié, déclencheur rejoué, webhook réessayé.
-- L'insertion est donc idempotente — et ne réécrit que ce qui vient du CRM,
-- jamais ce que la production a saisi de son côté (statut, rendez-vous, note,
-- client rattaché).
-- =============================================================================

create table client_transmissions (
  id               uuid primary key default gen_random_uuid(),
  crm_prospect_id  bigint not null unique,
  entreprise       text not null,
  contact_prenom   text,
  contact_nom      text,
  email            text,
  telephone        text,
  fiche_mission    text,
  montant_ca       numeric,
  menu_compose_le  timestamptz,
  -- Posé par le webhook Calendly, et non par le CRM : le rendez-vous se prend
  -- après la signature, parfois plusieurs jours plus tard.
  date_rdv         timestamptz,
  statut           text not null default 'a_traiter'
                     check (statut in ('a_traiter', 'traite', 'ignore')),
  -- Rempli quand la fiche a donné lieu à un vrai client.
  client_id        uuid references clients(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table client_transmissions is
  'Fiches poussées par le CRM commercial après signature. Écrites par la clé service-role depuis /api/crm/*, relues par l''écran « Transmission client ».';

-- L'écran ne regarde jamais la table entière : il ouvre sur « à traiter ».
create index client_transmissions_statut_idx on client_transmissions (statut);

create trigger client_transmissions_set_updated_at
  before update on client_transmissions
  for each row execute function set_updated_at();

alter table client_transmissions enable row level security;

-- Comme partout ailleurs, aucune politique n'ouvre quoi que ce soit à `anon` :
-- les routes /api/crm/* écrivent avec la clé service-role, qui contourne la RLS
-- après avoir vérifié elles-mêmes leur secret d'appel.

create or replace function is_active_profile() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

comment on function is_active_profile() is
  'Membre de l''équipe en activité, quel que soit son rôle.';

-- Lecture ouverte à toute l'équipe : une fiche transmise ne contient rien de
-- plus que ce qu'un contact client porte déjà, et savoir qui arrive évite de
-- produire pour un client que personne n'a encore créé.
create policy client_transmissions_select on client_transmissions
  for select to authenticated
  using (is_active_profile());

-- Écriture réservée à ceux qui pilotent la production, comme pour les clients
-- et les fiches. Le commercial, lui, n'a rien à reprendre ici : il a déjà tout
-- saisi dans le CRM.
create policy client_transmissions_write on client_transmissions
  for all to authenticated
  using (current_role_is(array['super_admin', 'production_manager', 'community_manager']::app_role[]))
  with check (current_role_is(array['super_admin', 'production_manager', 'community_manager']::app_role[]));
