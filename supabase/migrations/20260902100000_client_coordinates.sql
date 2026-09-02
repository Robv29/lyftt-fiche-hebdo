-- Coordonnées géographiques des clients, pour la carte des implantations.
--
-- Le géocodage passe par l'API Adresse de l'État, appelée à l'enregistrement
-- d'une fiche client. Le résultat est conservé ici plutôt que redemandé à
-- chaque affichage : la carte doit se dessiner même quand le service est
-- indisponible, et une commune ne se déplace pas.
--
-- `geo_label` garde la commune telle que le service l'a comprise. Sans elle,
-- un point mal placé est indébrouillable : on ne sait pas si la saisie était
-- fautive ou si le géocodeur s'est trompé de ville.

alter table public.clients
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geo_label text,
  add column if not exists geo_updated_at timestamptz;

comment on column public.clients.latitude is
  'Latitude WGS84 de la commune du client, issue du géocodage.';
comment on column public.clients.longitude is
  'Longitude WGS84 de la commune du client, issue du géocodage.';
comment on column public.clients.geo_label is
  'Commune retenue par le géocodeur, pour pouvoir vérifier un point douteux.';
