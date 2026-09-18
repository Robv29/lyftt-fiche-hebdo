-- Demande d'avis Google, une fois par trimestre : trace de chaque envoi.
--
-- Une ligne par adresse et par trimestre, posée AVANT l'envoi : l'unicité
-- empêche d'écrire deux fois à la même personne, qu'une exécution se répète ou
-- que la même adresse suive deux dossiers. L'avis porte sur l'agence, pas sur
-- un dossier : la clé est l'adresse, le client n'est qu'une trace.

create table client_review_requests (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null check (period_month = date_trunc('quarter', period_month)::date),
  email        text not null check (email = lower(btrim(email))),
  client_id    uuid references clients(id) on delete set null,
  resend_id    text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (period_month, email)
);

comment on table client_review_requests is
  'Demande d''avis Google trimestrielle : un envoi par adresse et par trimestre. Écrit par la tâche planifiée seule.';

alter table client_review_requests enable row level security;

-- Écriture réservée à la tâche planifiée (clé service). TRUNCATE échappe à la RLS.
revoke all on client_review_requests from anon;
revoke insert, update, delete, truncate, trigger, references on client_review_requests from authenticated;

create policy client_review_requests_select on client_review_requests
  for select to authenticated
  using (client_id is not null and can_access_client(client_id) and not is_commercial());

-- Dossiers exclus de la demande d'avis : l'agence elle-même, un compte d'essai,
-- ou un client qui ne souhaite pas être sollicité.
alter table clients
  add column review_requests boolean not null default true;

comment on column clients.review_requests is
  'Faux : le dossier ne reçoit pas la demande d''avis Google trimestrielle.';

update clients
set review_requests = false
where id in (
  '59aaa4be-d810-4abc-a78a-b1e8a761f922', -- LYFTT
  '37daa10e-cb75-4243-aefa-96fbb09bf751'  -- aneto
);

-- Désinscriptions de la demande d'avis, par adresse.
--
-- Le message dit comment ne plus le recevoir : répondre « stop ». L'adresse
-- est alors inscrite ici — et seule elle : les autres contacts du même client
-- continuent de recevoir la demande. Aucune lecture ni écriture depuis
-- l'application : la tâche planifiée la lit avec la clé service.
create table review_request_optouts (
  email      text primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);

alter table review_request_optouts enable row level security;
revoke all on review_request_optouts from anon, authenticated;
