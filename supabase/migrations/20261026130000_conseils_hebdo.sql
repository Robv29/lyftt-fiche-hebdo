-- Conseils de la semaine : le diagnostic du lundi 10 h, la pop-up du lundi 14 h 30.
--
-- Une ligne par semaine ISO **et par audience**, écrite par la tâche planifiée
-- seule. La pop-up ne calcule rien : elle lit cette ligne. C'est ce qui garantit
-- que deux personnes qui ouvrent l'application le même lundi lisent le même
-- diagnostic, et que le texte ne change pas sous les yeux de celui qui le lit.
--
-- Même motif que weekly_sheet_send_alerts : la réservation sur une clé unique
-- fait l'idempotence, jamais l'horloge. La tâche est planifiée à deux heures UTC
-- pour couvrir l'heure d'été (8 h et 9 h UTC valent 10 h à Paris, été puis
-- hiver), et c'est l'unicité de (iso_year, iso_week, audience) qui garantit un
-- seul calcul par semaine.

-- ----------------------------------------------------------------------------
-- Pourquoi deux lignes par semaine
--
-- Le score de l'agence n'est pas un nombre unique. Deux de ses neuf mesures —
-- « Dossiers budget complets » et « Shootings catégorisés » — se calculent sur
-- client_budget_lines, table ouverte à la seule direction
-- (20260810160000_client_budgets.sql). Pour tout autre rôle elles valent null,
-- les poids des piliers se redistribuent (health-score.ts) et la note change :
-- 78 pour la direction, 81 pour le reste de l'équipe sur les données du jour.
--
-- Une seule ligne devrait donc soit afficher au community manager une note
-- qu'il ne retrouve pas sur son propre tableau de bord, soit lui montrer deux
-- conseils budgétaires qu'il ne peut ni vérifier ni suivre. D'où l'audience, et
-- un partage au niveau de la **ligne** : tous les comptes de l'application sont
-- un seul rôle Postgres, `authenticated`, donc un grant par colonne n'y
-- changerait rien.
-- ----------------------------------------------------------------------------

create table weekly_advice (
  id            uuid primary key default gen_random_uuid(),
  iso_year      smallint not null,
  iso_week      smallint not null check (iso_week between 1 and 53),
  -- Lundi civil, heure de Paris. Lu dans la base de fuseaux et non calculé :
  -- le lundi à 0 h 30 à Paris, il est encore dimanche en UTC.
  week_start    date not null,
  audience      text not null check (audience in ('equipe', 'direction')),
  -- Lundi 14 h 30 à Paris, résolu en instant une fois pour toutes. Un instant
  -- et non une heure civile : c'est le navigateur qui comparera, et une
  -- comparaison d'instants ne dépend ni du fuseau de l'appareil ni de la saison.
  opens_at      timestamptz not null,
  -- Fenêtre réellement analysée. La purge nocturne supprime les fiches dont la
  -- semaine est passée depuis plus de quinze jours et emporte en cascade leurs
  -- publications, leurs versions et leurs tickets : ce que le diagnostic PEUT
  -- mesurer change de semaine en semaine, et une phrase qui ne sait pas dire sa
  -- propre fenêtre est une généralité.
  window_since  date not null,
  -- La note telle que CETTE audience la voit, et l'objectif du moment. Null
  -- quand rien n'est mesurable — une semaine sans fiche envoyée, par exemple.
  score         smallint,
  target        smallint not null,
  -- Les conseils, au plus cinq, déjà formulés et triés par le volume qu'ils
  -- expliquent. Le texte est figé à l'écriture : recalculer à l'affichage
  -- rouvrirait la porte à deux diagnostics pour la même semaine.
  --
  -- Chaque conseil porte `clients: [{clientId, count}]` et JAMAIS de nom. Le
  -- diagnostic est à l'échelle de l'agence, mais can_access_client borne un
  -- community manager à ses clients : une ligne qui nommerait tout le monde lui
  -- livrerait les dossiers des autres. Les noms sont résolus à l'affichage, par
  -- une lecture soumise à RLS ; ceux que la personne ne peut pas résoudre se
  -- replient sur « et n autres dossiers ».
  advices       jsonb not null default '[]'::jsonb,
  -- Les n de la semaine. Dans quinze jours, plus aucune ligne source ne
  -- permettra de les recalculer : cette ligne devient la seule mémoire durable
  -- de ce qu'on a mesuré, et c'est elle qui permettra de dire « en hausse ».
  sample        jsonb not null default '{}'::jsonb,
  computed_at   timestamptz not null default now(),
  unique (iso_year, iso_week, audience)
);

comment on table weekly_advice is
  'Diagnostic hebdomadaire de l''agence : une ligne par semaine ISO et par audience, écrite par la tâche planifiée du lundi 10 h. Aucun montant, aucun nom de client.';

-- La recherche de la pop-up est toujours (iso_year, iso_week) : la contrainte
-- d'unicité fournit déjà l'index, aucun index de plus à poser.

alter table weekly_advice enable row level security;

-- Écriture réservée à la tâche planifiée (clé service). TRUNCATE échappe à la
-- RLS : il est révoqué explicitement, comme pour weekly_sheet_send_alerts.
revoke all on weekly_advice from anon;
revoke insert, update, delete, truncate, trigger, references on weekly_advice from authenticated;

-- La table est à l'échelle de l'agence : pas de client_id, donc rien que
-- can_access_client puisse borner. La lecture se partage donc par audience.
--
-- Le commercial n'est dans aucune des deux listes : il ne produit rien, sa
-- navigation ne propose que la carte et les fiches clients, et denyCommercial()
-- le renvoie ailleurs sur les écrans internes. La pop-up est donc hors de sa
-- portée par construction, et pas seulement par politesse de l'interface.
create policy weekly_advice_select on weekly_advice
  for select to authenticated
  using (
    (audience = 'equipe'
      and current_role_is(array['super_admin', 'production_manager', 'community_manager']::app_role[]))
    or (audience = 'direction'
      and current_role_is(array['super_admin']::app_role[]))
  );

-- ----------------------------------------------------------------------------
-- Qui a déjà vu les conseils de la semaine
--
-- Côté serveur, et non dans le navigateur : « une fois par personne et par
-- semaine » doit survivre à un changement d'appareil, à une navigation privée
-- et à un vidage de cache. Un localStorage aurait rouvert la pop-up à chaque
-- ordinateur et l'aurait refermée définitivement à chaque nettoyage.
--
-- Clé sur la semaine et non sur l'identifiant de la ligne de conseils : une
-- personne ne voit qu'une des deux audiences, et son « vu » porte sur la
-- semaine, pas sur la variante qu'on lui a servie.
-- ----------------------------------------------------------------------------

create table weekly_advice_views (
  iso_year      smallint not null,
  iso_week      smallint not null check (iso_week between 1 and 53),
  profile_id    uuid not null references profiles(id) on delete cascade,
  seen_at       timestamptz not null default now(),
  -- Fermée explicitement (croix, Échap, clic hors de la fenêtre), par
  -- opposition à simplement ouverte. Distinguer les deux permettra de savoir si
  -- les conseils sont lus ou balayés, sans rien demander à personne.
  dismissed_at  timestamptz,
  primary key (iso_year, iso_week, profile_id)
);

comment on table weekly_advice_views is
  'Conseils de la semaine déjà vus, par personne. Chacun ne lit et n''écrit que sa propre ligne.';

alter table weekly_advice_views enable row level security;

revoke all on weekly_advice_views from anon;
-- insert et update restent : c'est la personne elle-même qui pose sa ligne, par
-- une action serveur sous RLS. Aucun client à privilèges n'est nécessaire — la
-- table ne porte aucun montant et aucune lecture hors périmètre.
revoke delete, truncate, trigger, references on weekly_advice_views from authenticated;

create policy weekly_advice_views_select_self on weekly_advice_views
  for select to authenticated
  using (profile_id = auth.uid());

create policy weekly_advice_views_insert_self on weekly_advice_views
  for insert to authenticated
  with check (profile_id = auth.uid() and is_active_profile());

create policy weekly_advice_views_update_self on weekly_advice_views
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
