-- Dossiers exclus du bilan mensuel.
--
-- Tous les dossiers en gestion ne sont pas de vrais clients : l'agence gère
-- ses propres réseaux sous le nom LYFTT, et « aneto » est un compte d'essai.
-- Leur proposer un rendez-vous de suivi n'aurait aucun sens. Un réglage par
-- dossier plutôt qu'une liste de noms dans le code : un nom se renomme, et un
-- vrai client pourra un jour demander à ne plus recevoir ce message.

alter table clients
  add column monthly_follow_up boolean not null default true;

comment on column clients.monthly_follow_up is
  'Faux : le dossier ne reçoit pas la proposition de bilan mensuel du 5 du mois (agence, compte d''essai, refus du client).';

update clients
set monthly_follow_up = false
where id in (
  '59aaa4be-d810-4abc-a78a-b1e8a761f922', -- LYFTT
  '37daa10e-cb75-4243-aefa-96fbb09bf751'  -- aneto
);
