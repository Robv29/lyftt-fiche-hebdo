-- Lien client réutilisable.
--
-- Jusqu'ici chaque « générer le lien » créait un nouveau token et révoquait le
-- précédent : le lien déjà envoyé au client mourait, en moyenne au bout de 22 h.
-- On garde donc le token en clair pour pouvoir re-proposer la MÊME adresse au
-- lieu d'en fabriquer une autre. Le compromis est assumé : la colonne n'est
-- lisible que par le service role, et la recherche continue de passer par le
-- hash (aucune énumération possible).
alter table client_review_links add column if not exists token text;

comment on column client_review_links.token is
  'Token en clair, pour re-copier le lien déjà envoyé au client. Null sur les liens créés avant cette migration.';
