-- Livraison d'un shooting : ce qui a été rendu, et quand.
--
-- Le cahier des charges demande deux indicateurs de plus — les assets produits
-- et le pourcentage de livraisons à temps — qu'aucune donnée existante ne
-- permettait de calculer. Les déduire d'ailleurs aurait été pire que de ne pas
-- les afficher : compter les médias des fiches hebdomadaires, par exemple,
-- aurait présenté sous le nom d'« assets d'un shooting » des visuels qui n'en
-- viennent pas.
--
-- Ces deux valeurs se saisissent donc sur la fiche, comme la durée : seul
-- quelqu'un qui a monté le tournage sait combien d'assets en sont sortis.
--
-- `delivery_days` reste la promesse faite au client ; `delivered_on` est la
-- date réelle. C'est leur écart qui dit si la livraison a tenu.

alter table shootings
  add column if not exists delivered_on date,
  add column if not exists assets_count integer
    check (assets_count is null or assets_count between 0 and 10000);

comment on column shootings.delivered_on is
  'Date de livraison réelle. Comparée à la date du shooting plus delivery_days, elle dit si le délai promis a été tenu.';
comment on column shootings.assets_count is
  'Nombre de contenus livrés à l''issue du shooting, saisi à la main.';
