-- Un mois de gestion ne peut être inscrit qu'une fois. L'unicité est portée
-- par la base : la synchronisation peut alors être rejouée sans précaution,
-- par la tâche planifiée comme à l'ouverture de l'écran.
create unique index if not exists client_budget_lines_management_month_idx
  on client_budget_lines (client_id, performed_on)
  where service_key = 'production_mensuelle';
