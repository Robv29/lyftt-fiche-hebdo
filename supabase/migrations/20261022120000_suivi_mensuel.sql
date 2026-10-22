-- =============================================================================
-- LYFTT — Produits de suivi mensuel
--
-- Deux prestations vendues au mois partagent une seule mécanique : « Gestion du
-- budget publicitaire » et « Accompagnement marketing externalisé ». Chaque
-- mois, pour chaque client qui en détient une : une ligne à l'addition, un
-- compte rendu à remplir par l'agence, puis une invitation au client à un
-- rendez-vous de suivi, autant de fois dans le mois que la fréquence vendue
-- l'indique (de 1 à 3).
--
-- Trois tables, chacune pour une raison distincte :
--
--   • client_tracking_services    — ce qui est VENDU. Seule source de vérité du
--     prix et de la fréquence. Les lignes mensuelles de l'addition en sont la
--     conséquence, comme les mois de gestion sont la conséquence de la formule
--     du client. Sans elle, arrêter une prestation n'aurait pas de formulation :
--     supprimer la ligne du mois en cours l'aurait vue réapparaître la nuit
--     suivante, déduite de celle du mois précédent.
--
--   • client_tracking_reports     — le TRAVAIL de l'agence, et l'historique du
--     client. Elle ne porte AUCUN MONTANT, et c'est volontaire : c'est ce qui
--     permet de l'ouvrir à l'équipe qui suit le client — carte du tableau de
--     bord, calendrier de production — sans élargir d'un centime qui voit les
--     budgets. Même raison que `shootings`, qui redouble `client_id` pour ne
--     pas avoir à joindre une table réservée à la direction.
--     Elle porte aussi son propre `client_id` et son propre mois : l'historique
--     du client doit se relire mois après mois, et les fiches hebdomadaires
--     sont purgées quatorze jours après leur fin.
--
--   • client_tracking_invitations — la réservation d'ENVOI. La tâche des e-mails
--     clients passe chaque jour : l'unicité en base est ce qui garantit qu'un
--     créneau ne part qu'une fois. Même motif que `client_follow_up_emails` et
--     `client_review_requests`.
--
-- Le plafond de 1 à 3 est tenu aux trois étages : champ `max` du formulaire,
-- schéma de l'action serveur, et les deux contraintes `check` ci-dessous.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ce qui est vendu
-- -----------------------------------------------------------------------------
create table client_tracking_services (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  /*
   * Clé du catalogue, déclarée dans src/lib/domain/monthly-tracking.ts. Pas
   * d'enum : ajouter un troisième produit de la famille ne doit coûter qu'une
   * déclaration côté code, et une valeur d'enum demande sa propre migration,
   * appliquée avant tout objet qui l'emploie.
   */
  service_key      text not null check (length(service_key) between 1 and 64),
  -- Libellé saisi à la vente, figé : il figure sur l'addition du client.
  label            text not null check (length(btrim(label)) > 0),
  /*
   * Prix d'UN rendez-vous de suivi, en centimes entiers. Le mois coûte
   * prix × fréquence : c'est ce que `lineTotalCents` calcule déjà, et le
   * formulaire l'écrit noir sur blanc à la saisie.
   */
  unit_price_cents integer not null check (unit_price_cents >= 0),
  -- Nombre de rendez-vous de suivi par mois. Le plafond, à sa source.
  frequency        smallint not null check (frequency between 1 and 3),
  -- Premier mois vendu, et dernier mois inclus. Toujours un premier du mois.
  started_on       date not null check (started_on = date_trunc('month', started_on)::date),
  ended_on         date check (ended_on is null or ended_on = date_trunc('month', ended_on)::date),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references profiles(id) on delete set null,
  check (ended_on is null or ended_on >= started_on),
  -- Une prestation ne se vend qu'une fois par mois de départ.
  unique (client_id, service_key, started_on)
);

comment on table client_tracking_services is
  'Prestations de suivi mensuel vendues à un client : prix d''un rendez-vous, fréquence mensuelle, mois de début et de fin. Seule source de vérité du prix et de la fréquence.';

/*
 * Une seule prestation en cours par client et par produit.
 *
 * Le formulaire le vérifie déjà, mais deux ajouts simultanés passeraient tous
 * les deux : l'unicité se porte en base. Même argument que le plafond des
 * envies client (20261009120100).
 */
create unique index client_tracking_services_en_cours_idx
  on client_tracking_services (client_id, service_key)
  where ended_on is null;

create index client_tracking_services_client_idx
  on client_tracking_services (client_id);

alter table client_tracking_services enable row level security;

-- TRUNCATE échappe à la RLS : il se retire comme le reste.
revoke all on client_tracking_services from anon;
revoke truncate, trigger, references on client_tracking_services from authenticated;

/*
 * La prestation porte un prix : même réserve que `client_budget_lines`, qui est
 * réservée à la direction. Le community manager qui produit les contenus d'un
 * client n'a pas à voir ce qu'il paie.
 */
create policy client_tracking_services_admin on client_tracking_services
  for all to authenticated
  using (current_role_is(array['super_admin']::app_role[]))
  with check (current_role_is(array['super_admin']::app_role[]));

-- -----------------------------------------------------------------------------
-- Les lignes mensuelles de l'addition
--
-- Elles vivent dans `client_budget_lines`, avec les autres : `billing` vaut
-- 'ponctuel' et `performed_on` est le premier du mois, exactement comme les
-- mois de gestion. Surtout pas 'mensuel' — ce drapeau multiplie une ligne
-- unique par un nombre de mois d'engagement et la fait tomber en entier sur une
-- seule facture.
-- -----------------------------------------------------------------------------

/*
 * Un mois ne peut être inscrit qu'une fois par client et par produit.
 * L'unicité est portée par la base : la synchronisation peut alors être rejouée
 * sans précaution, par la tâche planifiée comme à l'ouverture de l'écran
 * budget. Même motif que `client_budget_lines_management_month_idx`, qui est
 * filtré sur sa seule clé et ne couvre donc pas celles-ci.
 *
 * AJOUT D'UN TROISIÈME PRODUIT : c'est le seul endroit, avec la contrainte
 * ci-dessous, où la liste des clés est répétée hors du code. Une ligne à
 * ajouter aux deux, dans une migration.
 */
create unique index client_tracking_month_idx
  on client_budget_lines (client_id, service_key, performed_on)
  where service_key in ('gestion_budget_pub', 'marketing_externalise');

/*
 * Plafond de la fréquence sur la ligne, en plus de celui porté par la
 * prestation vendue. Restreint aux deux clés : un plafond inconditionnel
 * casserait les lignes existantes — une ligne `post_photo` porte aujourd'hui
 * une quantité de 4. Aucune ligne ne porte encore ces deux clés, la contrainte
 * est donc satisfaite immédiatement et n'a pas besoin d'être `not valid`.
 */
alter table client_budget_lines
  add constraint client_budget_lines_suivi_frequence_chk
  check (
    service_key not in ('gestion_budget_pub', 'marketing_externalise')
    or (quantity between 1 and 3 and quantity = round(quantity))
  );

-- -----------------------------------------------------------------------------
-- Le compte rendu mensuel — AUCUN MONTANT ICI
-- -----------------------------------------------------------------------------
create table client_tracking_reports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  service_key   text not null check (length(service_key) between 1 and 64),
  -- Mois sur lequel porte le compte rendu : le mois écoulé.
  period_month  date not null check (period_month = date_trunc('month', period_month)::date),
  -- Jour où il est attendu : le 8, avant le premier rendez-vous du mois.
  due_on        date not null,
  /*
   * Responsable, désigné par ROLE à l'ouverture (affectation du client, puis
   * profil actif du rôle dans un ordre déterministe, puis repli
   * d'encadrement) : jamais une personne écrite dans le code, qui ne survit
   * pas à son titulaire.
   */
  assigned_to   uuid references profiles(id) on delete set null,
  status        text not null default 'a_faire' check (status in ('a_faire', 'rempli')),
  -- Les améliorations faites dans le mois : texte libre, exigé au remplissage.
  improvements  text,
  -- Statistiques relevées, par clé déclarée. Centimes pour les montants.
  stats         jsonb not null default '{}'::jsonb,
  filled_by     uuid references profiles(id) on delete set null,
  filled_at     timestamptz,
  created_at    timestamptz not null default now(),
  -- Un compte rendu par client, par produit et par mois.
  unique (client_id, service_key, period_month)
);

comment on table client_tracking_reports is
  'Compte rendu mensuel d''une prestation de suivi : améliorations faites et statistiques du mois. Ne porte aucun montant, et s''ouvre donc à l''équipe qui suit le client. Créé par la tâche planifiée, rempli par l''agence.';

comment on column client_tracking_reports.stats is
  'Valeurs relevées, par clé de statistique déclarée dans monthly-tracking.ts. Les montants sont en centimes entiers ; les ratios ne sont jamais stockés, ils se calculent.';

create index client_tracking_reports_client_idx
  on client_tracking_reports (client_id, period_month desc);

-- Ce qui reste à remplir : la carte du tableau de bord et la pastille de
-- navigation ne lisent que celles-là.
create index client_tracking_reports_a_faire_idx
  on client_tracking_reports (due_on)
  where status = 'a_faire';

alter table client_tracking_reports enable row level security;

-- TRUNCATE échappe à la RLS : il se retire comme le reste.
revoke all on client_tracking_reports from anon;
/*
 * Création par la tâche planifiée seule, suppression par personne : un compte
 * rendu ouvert est une trace. Le remplissage, lui, est un UPDATE de l'équipe —
 * il reste donc permis, sous la politique ci-dessous.
 */
revoke insert, delete, truncate, trigger, references on client_tracking_reports from authenticated;

/*
 * Lecture et remplissage par l'équipe qui suit le client, commercial exclu.
 * Même formulation que `shootings` : savoir qu'un compte rendu est attendu sert
 * à l'organisation, pas à voir un budget. Les graphistes et vidéastes n'ont pas
 * d'affectation client et n'en voient donc aucun, ce qui est correct : remplir
 * un bilan marketing n'est pas leur travail.
 */
create policy client_tracking_reports_select on client_tracking_reports
  for select to authenticated
  using (can_access_client(client_id) and not is_commercial());

create policy client_tracking_reports_update on client_tracking_reports
  for update to authenticated
  using (can_access_client(client_id) and not is_commercial())
  with check (can_access_client(client_id) and not is_commercial());

-- -----------------------------------------------------------------------------
-- Les invitations envoyées
-- -----------------------------------------------------------------------------
create table client_tracking_invitations (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  /*
   * Rang du créneau dans le mois, à partir de 0. La clé porte le créneau et
   * NON le produit, et c'est la décision elle-même : un client qui détient les
   * deux produits reçoit une invitation par créneau, pas deux. Le rendez-vous
   * est le même, avec la même personne, sur le même lien de réservation.
   */
  slot_index   smallint not null check (slot_index between 0 and 2),
  email        text not null check (email = lower(btrim(email))),
  resend_id    text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (client_id, period_month, slot_index, email)
);

comment on table client_tracking_invitations is
  'Invitation à un rendez-vous de suivi : un envoi par contact, par client et par créneau du mois. Écrite par la tâche planifiée seule. La clé ne porte pas le produit : un client qui détient les deux n''est invité qu''une fois par créneau.';

alter table client_tracking_invitations enable row level security;

-- TRUNCATE échappe à la RLS : il se retire comme le reste.
revoke all on client_tracking_invitations from anon;
revoke insert, update, delete, truncate, trigger, references on client_tracking_invitations from authenticated;

create policy client_tracking_invitations_select on client_tracking_invitations
  for select to authenticated
  using (can_access_client(client_id) and not is_commercial());

-- -----------------------------------------------------------------------------
-- Dossiers exclus des invitations
--
-- Même motif que le bilan mensuel et la demande d'avis : un réglage par
-- dossier, pas une liste de noms dans le code. L'agence gère ses propres
-- réseaux sous le nom LYFTT, et « aneto » est un compte d'essai.
-- -----------------------------------------------------------------------------
alter table clients
  add column tracking_invitations boolean not null default true;

comment on column clients.tracking_invitations is
  'Faux : le dossier ne reçoit pas les invitations aux rendez-vous de suivi mensuel (agence, compte d''essai, refus du client).';

update clients
set tracking_invitations = false
where id in (
  '59aaa4be-d810-4abc-a78a-b1e8a761f922', -- LYFTT
  '37daa10e-cb75-4243-aefa-96fbb09bf751'  -- aneto
);
