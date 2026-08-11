-- Les mois de gestion étaient inscrits à la fin de la période ; ils le sont
-- désormais au début, la gestion se réglant d'avance. Les lignes déjà posées
-- portent donc une date décalée d'un mois, et il en manque une par client.
--
-- Ces lignes sont entièrement dérivées de la date de début et du rythme
-- vendu : les supprimer est sans perte, la synchronisation les repose
-- correctement à la prochaine ouverture de l'écran ou passage de la tâche.
delete from client_budget_lines where service_key = 'production_mensuelle';
