-- Alerte « fiches non envoyées », le vendredi à 16 h : trace de chaque alerte.
--
-- Une ligne par vendredi, posée AVANT l'envoi. C'est l'unicité qui garantit UN
-- seul e-mail : la tâche est planifiée à deux heures UTC pour couvrir l'heure
-- d'été (14 h et 15 h UTC valent 16 h à Paris, été puis hiver), et un rejeu ou
-- un appel à la main ne doit pas faire sonner deux fois le téléphone des
-- dirigeants. `sent_at` vide signifie « réservé, issue inconnue » : on ne
-- réessaie pas, mieux vaut une alerte manquée qu'un doublon.
--
-- Même motif que client_review_requests et client_tracking_invitations.

create table weekly_sheet_send_alerts (
  id            uuid primary key default gen_random_uuid(),
  -- Vendredi civil, heure de Paris. Clé d'unicité : une alerte par vendredi.
  alert_date    date not null,
  -- Lundi de la semaine visée : la trace dit sur quelle semaine on a alerté.
  week_start    date not null,
  missing_count smallint not null check (missing_count > 0),
  -- Ce qui a été annoncé — nom du client et motif —, pour relire une alerte
  -- sans rejouer le calcul sur des fiches qui ont bougé depuis.
  missing       jsonb not null default '[]'::jsonb,
  recipients    text[] not null default '{}',
  resend_id     text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (alert_date)
);

comment on table weekly_sheet_send_alerts is
  'Alerte interne du vendredi 16 h sur les fiches non envoyées : une ligne par vendredi. Écrite par la tâche planifiée seule.';

alter table weekly_sheet_send_alerts enable row level security;

-- Écriture réservée à la tâche planifiée (clé service). TRUNCATE échappe à la RLS.
revoke all on weekly_sheet_send_alerts from anon;
revoke insert, update, delete, truncate, trigger, references on weekly_sheet_send_alerts from authenticated;

-- La table est à l'échelle de l'agence : pas de client_id, donc
-- `can_access_client` n'a rien à borner. La lecture revient à l'encadrement,
-- ce qui tient les commerciaux à l'écart par construction.
create policy weekly_sheet_send_alerts_select on weekly_sheet_send_alerts
  for select to authenticated
  using (is_staff_lead());

-- -----------------------------------------------------------------------------
-- Dossiers exclus de l'alerte
--
-- Même motif que le bilan mensuel, la demande d'avis et les invitations de
-- suivi : un réglage par dossier, pas une liste de noms dans le code — un nom
-- se renomme. L'agence gère ses propres réseaux sous le nom LYFTT et « aneto »
-- est un compte d'essai : aucun des deux n'a de fiche à envoyer à un client, et
-- tous deux sont en brouillon permanent. Les inclure, c'était deux fausses
-- alertes chaque vendredi, c'est-à-dire une alerte qu'on cesse de lire.
--
-- Réutiliser `monthly_follow_up` aurait confondu deux décisions, et cassé le
-- jour où un vrai client demande à sortir de l'une sans sortir de l'autre.
-- -----------------------------------------------------------------------------
alter table clients
  add column weekly_sheet_alert boolean not null default true;

comment on column clients.weekly_sheet_alert is
  'Faux : le dossier n''entre pas dans l''alerte du vendredi sur les fiches non envoyées.';

update clients
set weekly_sheet_alert = false
where id in (
  '59aaa4be-d810-4abc-a78a-b1e8a761f922', -- LYFTT
  '37daa10e-cb75-4243-aefa-96fbb09bf751'  -- aneto
);
