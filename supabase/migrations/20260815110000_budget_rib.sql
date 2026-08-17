-- =============================================================================
-- RIB du client
--
-- Dès qu'une part est prélevée au client — comptant, ou gestion mensuelle d'un
-- hybride — la facturation suppose un RIB. Il manquait jusqu'ici : on s'en
-- apercevait au moment du prélèvement, c'est-à-dire trop tard.
--
-- Le dépôt n'est pas bloquant. Il est signalé en rouge sur l'écran budget tant
-- qu'il n'est pas fait : interdire d'enregistrer un budget parce qu'un document
-- manque ferait perdre la saisie déjà faite, sans rien accélérer.
--
-- Un fichier, pas une case à cocher : au moment d'établir le prélèvement, il
-- faut pouvoir ouvrir le RIB, pas seulement savoir qu'il existe. Le fichier va
-- dans le bucket privé `media`, comme les autres pièces jointes ; seul son
-- chemin est stocké ici, et il ne se lit que par URL signée.
--
-- La colonne booléenne `rib_received` d'une première tentative est retirée :
-- aucun dossier ne l'avait cochée, elle ne portait aucune information.
-- =============================================================================

alter table client_budgets
  add column rib_storage_path text,
  add column rib_file_name    text,
  add column rib_uploaded_at  timestamptz,
  add column rib_uploaded_by  uuid references profiles(id) on delete set null;

alter table client_budgets
  drop column if exists rib_received;

comment on column client_budgets.rib_storage_path is
  'Chemin dans le bucket privé media. Nul tant que le RIB n''a pas été déposé.';
