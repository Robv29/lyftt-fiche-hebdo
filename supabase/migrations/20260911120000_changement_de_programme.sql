-- Changement de programme : reporter une publication sans repasser par le client.
--
-- `reprogrammed_from` garde la toute première date prévue — celle que le client
-- avait validée — et fait apparaître la pastille « Changement de programme ».
-- Reporté deux fois, un post la conserve : l'écraser par la date intermédiaire
-- effacerait la trace de l'engagement.
--
-- Déplacer `scheduled_date` ne relance aucune validation : le déclencheur
-- `weekly_sheet_items_recompute_status` ne réagit qu'à `approval_status` et
-- `is_cancelled`. C'est voulu, et c'est ce qui rend le report possible même sur
-- une semaine déjà validée.

alter table weekly_sheet_items
  add column if not exists reprogrammed_from date,
  add column if not exists reprogrammed_at   timestamptz,
  add column if not exists reprogrammed_by   uuid references profiles(id) on delete set null,
  add column if not exists reprogrammed_note text;

comment on column weekly_sheet_items.reprogrammed_from is
  'Première date prévue avant un changement de programme. Non nulle = pastille affichée.';
