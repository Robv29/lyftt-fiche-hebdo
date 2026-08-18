-- =============================================================================
-- Visuel de référence joint à une commande interne.
--
-- Un brief écrit dit rarement ce qu'on a en tête : « comme la story de la
-- semaine dernière, mais plus sobre » suppose que l'autre ait la story sous
-- les yeux. La référence se joint donc à la demande, et le studio l'a devant
-- lui au moment de produire.
--
-- Le fichier vit dans `media_assets` comme les autres, et n'est pas effacé
-- avec la commande : il peut servir à plusieurs demandes.
-- =============================================================================

alter table production_requests
  add column reference_media_id uuid references media_assets(id) on delete set null;

comment on column production_requests.reference_media_id is
  'Visuel ou photo de référence, pour orienter la création. Nul quand le brief se suffit.';
