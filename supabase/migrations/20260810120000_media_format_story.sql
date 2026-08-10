-- Les stories sont vendues au même titre que les photos, vidéos et visuels :
-- elles deviennent un format de contenu à part entière, et non un « autre ».
--
-- ADD VALUE ne peut pas être suivi d'une utilisation de la valeur dans la même
-- transaction : cette migration n'insère donc rien qui référence 'story'.
alter type media_format add value if not exists 'story';
