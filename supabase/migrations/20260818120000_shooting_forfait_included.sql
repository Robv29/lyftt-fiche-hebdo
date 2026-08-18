-- =============================================================================
-- Un shooting est-il compris dans le forfait, ou vendu en plus ?
--
-- Le forfait « une demi-journée tous les mois » donne droit à un shooting par
-- période, déjà payé par le lissage mensuel : celui-là ne se facture pas une
-- seconde fois. Le suivant, dans la même période, est vendu en plus et doit
-- partir à la facture — c'est l'erreur coûteuse, celle qu'on ne voit pas.
--
-- Trois états, et le troisième compte autant que les deux autres :
--   true  → compris dans le forfait, inscrit à 0 €
--   false → supplémentaire, facturé au tarif du catalogue
--   null  → pas encore tranché, donc à catégoriser avant de facturer
--
-- Les lignes déjà saisies restent à null : elles remontent dans l'écran de
-- catégorisation plutôt que d'être classées à l'aveugle par une migration.
-- =============================================================================

alter table client_budget_lines
  add column forfait_included boolean;

comment on column client_budget_lines.forfait_included is
  'Shooting compris dans le forfait (true), vendu en plus (false), ou pas encore tranché (null).';

create index client_budget_lines_a_categoriser_idx
  on client_budget_lines (client_id)
  where forfait_included is null and service_key like 'shooting%';
