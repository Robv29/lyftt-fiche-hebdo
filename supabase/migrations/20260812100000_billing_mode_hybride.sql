-- Mode hybride.
--
-- Cas courant : la gestion des réseaux est facturée au client, mais ses
-- shootings passent sur un financement. Une seule règle suffit à le décrire —
-- le récurrent se facture, le ponctuel se prend sur l'enveloppe — et le
-- drapeau `billed_directly` reste disponible pour l'exception ligne à ligne.
alter type client_billing_mode add value if not exists 'hybride';
