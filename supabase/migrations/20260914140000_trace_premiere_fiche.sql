-- Trace permanente de la production d'un client : sa première fiche.
--
-- L'entretien de nuit supprime les fiches passées. Compter les fiches du jour
-- ne dit donc pas si un client a été suivi : un client en gestion depuis un an
-- en affiche souvent zéro. Or c'est précisément ce qu'il faut savoir avant de
-- le passer en prestation ponctuelle, geste qui retire ses mois de gestion.
--
-- La date est posée à la création de la première fiche et ne s'efface jamais.

alter table clients add column first_sheet_at timestamptz;

comment on column clients.first_sheet_at is
  'Création de la première fiche hebdomadaire. Survit à la purge des fiches : un client qui en a eu une a été en gestion.';

update clients c
set first_sheet_at = s.first_at
from (select client_id, min(created_at) as first_at from weekly_sheets group by client_id) s
where s.client_id = c.id and c.first_sheet_at is null;

-- SECURITY DEFINER : la fiche est créée par l'équipe, qui n'a pas à pouvoir
-- modifier la table des clients pour que la trace soit posée.
create or replace function set_client_first_sheet_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update clients
  set first_sheet_at = coalesce(new.created_at, now())
  where id = new.client_id and first_sheet_at is null;
  return new;
end;
$$;

revoke all on function set_client_first_sheet_at() from public, anon, authenticated;

create trigger weekly_sheets_first_sheet_at
  after insert on weekly_sheets
  for each row execute function set_client_first_sheet_at();
