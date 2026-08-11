-- Sujet de la semaine.
--
-- La production reçoit une fiche à remplir sans savoir ce qu'on veut y
-- raconter : le sujet arrivait par message, ou pas du tout. Une phrase portée
-- par la fiche elle-même le dit une fois pour toutes, au bon endroit.
alter table weekly_sheets add column if not exists topic text;

comment on column weekly_sheets.topic is
  'Sujet de la semaine, en une phrase : ce que la production doit savoir avant de créer les contenus.';
