-- Début de gestion.
--
-- Sans lui, le budget consommé ne comptait que les prestations ajoutées à la
-- main : la production récurrente déjà livrée depuis le début du contrat
-- n'apparaissait nulle part, et le restant était systématiquement surévalué.
--
-- Cette date ne touche pas au cycle de vie du client, qui reste gouverné par
-- l'archivage manuel, la pause et la fin de gestion.

alter table clients add column if not exists contract_start_date date;

comment on column clients.contract_start_date is
  'Début de gestion. Sert à mesurer la production récurrente déjà consommée sur le budget ; n''affecte pas l''état du client.';
