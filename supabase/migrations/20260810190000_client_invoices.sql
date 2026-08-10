-- =============================================================================
-- LYFTT — Facturation des clients au comptant
--
-- Un client comptant règle ce qu'il consomme : les prestations du mois sont
-- notées au fil de l'eau, et le mois écoulé donne une facture à établir.
--
-- Seul l'état du dossier est stocké ; le contenu et le montant de la facture
-- se déduisent des prestations du mois. Un total figé se désynchroniserait à
-- la première prestation ajoutée après coup.
-- =============================================================================

create type invoice_status as enum ('a_faire', 'faite', 'prelevement_programme');

create table client_invoices (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  -- Premier jour du mois facturé, qui sert de clé au dossier.
  period_month  date not null,
  status        invoice_status not null default 'a_faire',
  invoiced_at   timestamptz,
  scheduled_at  timestamptz,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references profiles(id) on delete set null,
  unique (client_id, period_month)
);

alter table client_invoices enable row level security;

-- Même restriction que le budget : donnée de direction.
create policy client_invoices_admin on client_invoices
  for all to authenticated
  using (current_role_is(array['super_admin']::app_role[]))
  with check (current_role_is(array['super_admin']::app_role[]));
