-- =============================================================================
-- Jeu de données de démonstration
-- Reprend la fiche réelle « Un été à la campagne » (semaine du 27/07).
-- =============================================================================

-- Comptes de démonstration. En production, les profils sont créés via
-- l'inscription Supabase Auth ; ici on insère directement pour pouvoir tester.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'elena@lyftt.fr',
   crypt('demo1234', gen_salt('bf')), now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'graphiste@lyftt.fr',
   crypt('demo1234', gen_salt('bf')), now(), now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'production@lyftt.fr',
   crypt('demo1234', gen_salt('bf')), now(), now(), now()),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'videaste@lyftt.fr',
   crypt('demo1234', gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

insert into profiles (id, full_name, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'Élena Nguyen', 'elena@lyftt.fr', 'community_manager'),
  ('22222222-2222-2222-2222-222222222222', 'Yoan Ruans', 'graphiste@lyftt.fr', 'graphic_designer'),
  ('33333333-3333-3333-3333-333333333333', 'Robin Vergnes', 'production@lyftt.fr', 'production_manager'),
  ('44444444-4444-4444-4444-444444444444', 'Camille Roy', 'videaste@lyftt.fr', 'video_editor')
on conflict (id) do nothing;

-- Client : validation explicite obligatoire, échéance mardi 10 h.
insert into clients (id, name, slug, timezone, validation_deadline_weekday,
                     validation_deadline_time, approval_policy, whatsapp_group_name)
values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Un été à la campagne',
  'un-ete-a-la-campagne',
  'Europe/Paris',
  2,
  '10:00',
  'explicit_required',
  'LYFTT x Guinguette'
) on conflict (id) do nothing;

insert into client_contacts (client_id, first_name, last_name, phone, is_primary)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Brigitte', 'Lascaux', '+33612345678', true)
on conflict do nothing;

insert into client_assignments (client_id, profile_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'community_manager'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'graphic_designer'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'video_editor')
on conflict do nothing;

-- Fiche de la semaine du 27/07 : 1 post photo + 1 reel, Instagram + Facebook.
insert into weekly_sheets (id, client_id, iso_year, iso_week, period_start, period_end,
                           networks, status, community_manager_id, created_by)
values (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  2026, 31, '2026-07-27', '2026-08-02',
  array['instagram', 'facebook']::social_network[],
  'ready_to_send',
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111'
) on conflict (id) do nothing;

-- Les cinq publications de la fiche, du lundi au vendredi à 18 h.
insert into weekly_sheet_items (
  weekly_sheet_id, position, scheduled_date, scheduled_time, publication_type,
  format, networks, caption, hashtags, media_pending_note, internal_notes
)
select
  'bbbbbbbb-0000-0000-0000-000000000001',
  row_number() over (order by d.day),
  d.day,
  '18:00',
  case when d.format = 'reels' then 'reel' else 'post' end::publication_type,
  d.format::media_format,
  array['instagram', 'facebook']::social_network[],
  E'☀️ Des souvenirs d''été\n@uneteaalacampagne\n\U0001F4CD 1987 Rte d''Auch, 82000 Montauban',
  array['#Guinguette', '#Montauban', '#TarnEtGaronne', '#SortirEnOccitanie', '#AperoTime'],
  case when d.format = 'reels' then 'Vidéo transmise séparément' else null end,
  -- Notes internes : ne doivent jamais apparaître sur le portail client.
  'Note interne : relancer Brigitte pour les photos du concert.'
from (values
  ('2026-07-27'::date, 'visuel'),
  ('2026-07-28'::date, 'photo'),
  ('2026-07-29'::date, 'reels'),
  ('2026-07-30'::date, 'photo'),
  ('2026-07-31'::date, 'photo')
) as d(day, format)
on conflict do nothing;

-- Modèles de messages par défaut, insérés en version modifiable.
insert into client_message_templates (name, channel, body, template_type)
values
  ('Standard WhatsApp', 'whatsapp',
   E'Bonjour {{contact_first_name}},\n\nVoici le planning des contenus prévus pour la semaine {{publication_week}}.\n\nMerci de le consulter et de nous transmettre votre validation ou vos demandes de modification avant le {{validation_deadline}}.\n\nPour valider ou demander une modification, cliquez sur ce lien et sélectionnez le contenu concerné :\n{{review_link}}\n\nMerci et bonne journée.\n{{community_manager_name}} — LYFTT',
   'standard'),
  ('Rappel WhatsApp', 'whatsapp',
   E'Bonjour {{contact_first_name}},\n\nUn petit rappel concernant le planning des contenus de la semaine {{publication_week}}.\n\nMerci de le consulter avant le {{validation_deadline}} :\n{{review_link}}\n\n{{community_manager_name}} — LYFTT',
   'reminder')
on conflict do nothing;
