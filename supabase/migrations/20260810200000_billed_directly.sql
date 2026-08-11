-- Une prestation ajoutée à un client en financement n'est pas toujours prise
-- en charge par son organisme : il peut refuser de la faire passer sur son
-- enveloppe. Elle lui est alors facturée directement.
--
-- Le drapeau la sort du budget et la fait rejoindre le circuit de facturation,
-- celui-là même qui sert aux clients au comptant. Une prestation est donc soit
-- consommée sur l'enveloppe, soit facturée — jamais les deux.
alter table client_budget_lines
  add column if not exists billed_directly boolean not null default false;

comment on column client_budget_lines.billed_directly is
  'Prestation facturée au client hors enveloppe de financement : elle ne consomme pas le budget et rejoint le circuit de facturation.';
