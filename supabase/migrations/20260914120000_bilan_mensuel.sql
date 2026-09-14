-- Bilan mensuel proposé aux clients le 5 du mois : trace de chaque envoi.
--
-- Une ligne par contact, par client et par mois. Elle est posée AVANT l'envoi,
-- et l'unicité fait le reste : ni deux exécutions simultanées, ni le
-- rattrapage des jours suivants ne peuvent écrire deux fois au même contact.
-- `sent_at` vide signifie « réservé, issue inconnue » : on ne réessaie pas,
-- un message en double chez un client coûte plus qu'un message manqué.

create table client_follow_up_emails (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  email        text not null check (email = lower(btrim(email))),
  resend_id    text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (client_id, period_month, email)
);

comment on table client_follow_up_emails is
  'Bilan mensuel proposé le 5 du mois : un envoi par contact, par client et par mois. Écrit par la tâche planifiée seule.';

alter table client_follow_up_emails enable row level security;

-- Écriture réservée à la tâche planifiée, qui passe par la clé service.
-- Les droits par défaut du schéma public ne doivent rien ouvrir d'autre.
-- TRUNCATE échappe à la RLS : il se retire comme le reste.
revoke all on client_follow_up_emails from anon;
revoke insert, update, delete, truncate, trigger, references on client_follow_up_emails from authenticated;

create policy client_follow_up_emails_select on client_follow_up_emails
  for select to authenticated
  using (can_access_client(client_id) and not is_commercial());
