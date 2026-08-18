-- =============================================================================
-- Notation de la semaine par le client.
--
-- Elle est demandée au moment où le client vient de valider sa fiche : il est
-- devant l'écran, il a les publications en tête, et cela ne lui coûte qu'un
-- geste. Un questionnaire envoyé plus tard n'obtient que des réponses extrêmes.
--
-- Trois niveaux plutôt que cinq étoiles : une échelle large ne produit que des
-- 4 et des 5, dont on n'apprend rien. Ici, il faut se situer.
--   1 → décevant     (0 %)
--   2 → correct      (50 %)
--   3 → très bien    (100 %)
-- Le pourcentage est calculé à l'affichage, jamais stocké : une échelle qui
-- changerait rendrait fausses toutes les notes déjà enregistrées.
--
-- Une note par fiche : c'est l'unité de production, et celle qui permet de
-- rattacher la satisfaction à ce qui a été livré cette semaine-là.
-- =============================================================================

create table client_sheet_ratings (
  id               uuid primary key default gen_random_uuid(),
  weekly_sheet_id  uuid not null unique references weekly_sheets (id) on delete cascade,
  client_id        uuid not null references clients (id) on delete cascade,
  -- Lien par lequel la note a été donnée : trace de provenance, comme les événements.
  review_link_id   uuid references client_review_links (id) on delete set null,
  score            smallint not null check (score between 1 and 3),
  -- Demandé seulement quand la note n'est pas la meilleure : c'est là qu'est l'information.
  comment          text,
  submitted_at     timestamptz not null default now()
);

create index client_sheet_ratings_client_idx
  on client_sheet_ratings (client_id, submitted_at desc);

alter table client_sheet_ratings enable row level security;

-- L'équipe lit les notes des clients de son périmètre ; personne ne les modifie
-- depuis l'application : une note donnée par le client lui appartient.
create policy client_sheet_ratings_select on client_sheet_ratings
  for select to authenticated
  using (can_access_client(client_id));

comment on table client_sheet_ratings is
  'Satisfaction du client sur une fiche validée. Écrite par la clé service depuis le lien de validation.';
