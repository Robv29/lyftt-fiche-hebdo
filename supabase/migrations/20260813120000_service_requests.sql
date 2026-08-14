-- Demandes hors publication.
--
-- Un client demande aussi des devis, des dates de shooting, ou des retouches
-- sur un service annexe — le site web, par exemple. Ces demandes arrivaient
-- par message et se perdaient : rien ne les suivait, personne ne savait si
-- elles étaient traitées.
--
-- Elles empruntent le circuit des tickets, qui sait déjà router, assigner et
-- clore. Elles s'en distinguent par leur type, et par l'absence de
-- publication rattachée : elles ne portent sur aucun contenu de la semaine.
alter type ticket_type add value if not exists 'quote_request';
alter type ticket_type add value if not exists 'shooting_request';
alter type ticket_type add value if not exists 'side_service';
