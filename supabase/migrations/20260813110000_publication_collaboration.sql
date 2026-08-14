-- Collaboration avec un autre compte.
--
-- Une publication en collaboration doit être créée depuis le réseau en
-- invitant le compte partenaire : c'est une étape manuelle, distincte de la
-- publication elle-même, et qu'on oublie facilement. Le champ reste vide dans
-- l'immense majorité des cas — il ne s'affiche alors nulle part, ni pour le
-- client ni à la publication.
alter table weekly_sheet_items
  add column if not exists collaboration_handle text,
  add column if not exists collaboration_done_at timestamptz;

comment on column weekly_sheet_items.collaboration_handle is
  'Compte associé à la publication en collaboration. Vide : aucune collaboration, rien n''est affiché.';
comment on column weekly_sheet_items.collaboration_done_at is
  'Horodatage de l''invitation en collaboration effectivement envoyée depuis le réseau.';
