-- =============================================================================
-- LYFTT — Budget client
--
-- Un client est soit au comptant, soit en financement. Le financement est une
-- enveloppe non reportable : l'objectif est de la consommer entièrement avant
-- la fin de gestion. On enregistre donc l'enveloppe, puis chaque prestation
-- ajoutée au fil de l'eau — comme une addition.
--
-- Aucun total n'est stocké : il se déduit des lignes. Un cumul figé se
-- désynchroniserait à la première ligne modifiée.
-- =============================================================================

create type client_billing_mode as enum ('comptant', 'financement');

create table client_budgets (
  client_id           uuid primary key references clients(id) on delete cascade,
  billing_mode        client_billing_mode not null default 'comptant',
  -- Enveloppe accordée, en centimes : jamais de flottant sur de l'argent.
  budget_cents        integer not null default 0 check (budget_cents >= 0),
  note                text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references profiles(id) on delete set null
);

create table client_budget_lines (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  -- Clé du catalogue, conservée pour les regroupements ultérieurs.
  service_key         text not null,
  /*
   * Libellé et prix sont recopiés du catalogue à l'ajout, puis figés. Une
   * révision tarifaire ne doit pas réécrire une addition déjà établie.
   */
  label               text not null,
  billing             text not null check (billing in ('ponctuel', 'mensuel')),
  unit_price_cents    integer not null check (unit_price_cents >= 0),
  quantity            numeric(8,2) not null default 1 check (quantity > 0),
  -- Durée d'engagement d'une prestation mensuelle.
  months              integer check (months is null or months > 0),
  -- Date du shooting, ou date de mise à jour de la formule.
  performed_on        date not null,
  note                text,
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id) on delete set null
);

create index client_budget_lines_client_idx
  on client_budget_lines (client_id, performed_on desc);

alter table client_budgets enable row level security;
alter table client_budget_lines enable row level security;

/*
 * Écran réservé à la direction : le budget d'un client n'a pas à être visible
 * du community manager qui produit ses contenus. La restriction est portée par
 * la base, pas seulement par l'interface.
 */
create policy client_budgets_admin on client_budgets
  for all to authenticated
  using (current_role_is(array['super_admin']::app_role[]))
  with check (current_role_is(array['super_admin']::app_role[]));

create policy client_budget_lines_admin on client_budget_lines
  for all to authenticated
  using (current_role_is(array['super_admin']::app_role[]))
  with check (current_role_is(array['super_admin']::app_role[]));
