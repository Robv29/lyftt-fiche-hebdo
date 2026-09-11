-- Nature du client : gestion des réseaux sociaux, ou prestation ponctuelle.
--
-- Jusqu'ici un client EST une gestion : créer un client imposait cinq
-- hashtags, des réseaux, un groupe WhatsApp, des jours de publication et une
-- échéance de validation — autant de réponses inventées pour un client venu
-- pour un seul shooting. Et une fois créé, il recevait des mois de gestion :
-- le forfait de base de 50 € s'ajoute même à rythme nul.
--
-- `ponctuel` : ni fiche hebdomadaire, ni mois facturé. Le cycle de vie le
-- rend non productible (`one_shot`), ce qui le sort du planning, de la
-- production et des compteurs du tableau de bord ; la formule le rend non
-- géré, ce qui le sort de la facturation mensuelle.
--
-- Défaut `gestion` : les clients existants n'ont jamais eu d'autre nature.

alter table clients
  add column if not exists client_kind text not null default 'gestion'
    check (client_kind in ('gestion', 'ponctuel'));

comment on column clients.client_kind is
  'gestion = gestion des réseaux sociaux, fiches hebdomadaires et mois facturés. ponctuel = prestation one-shot, sans gestion ni facturation mensuelle.';
