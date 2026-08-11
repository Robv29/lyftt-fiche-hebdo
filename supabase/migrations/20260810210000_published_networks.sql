-- Réseaux effectivement publiés.
--
-- La fiche client dit sur quels réseaux on publie pour lui ; cette colonne dit
-- lesquels ont réellement reçu la publication. L'écart entre les deux est
-- précisément ce qu'on veut voir : un contenu posté sur Instagram mais oublié
-- sur Facebook ne se remarquait jusqu'ici par aucun moyen.
alter table weekly_sheet_items
  add column if not exists published_networks social_network[] not null default '{}';

comment on column weekly_sheet_items.published_networks is
  'Réseaux sur lesquels la publication a effectivement été postée, cochés un à un à la publication.';
