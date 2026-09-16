-- Validation des visuels d'une fiche, indépendamment des textes.
--
-- Les fichiers et les textes avancent à des rythmes différents. Attendre les
-- légendes pour dire que les visuels sont bons bloquait le suivi de
-- production : la validation des visuels se pose donc à part, datée et
-- nominative.
--
-- Elle ne vaut que pour les fichiers qu'elle a vus. Un fichier remplacé,
-- ajouté ou retiré ensuite — y compris dans un carrousel — la retire d'office :
-- sinon « visuels validés » s'afficherait sur des fichiers que personne n'a
-- regardés. C'est la base qui s'en charge, quel que soit l'écran du dépôt.

alter table weekly_sheets
  add column visuals_validated_at timestamptz,
  add column visuals_validated_by uuid references profiles(id) on delete set null,
  -- Nom figé au moment de la validation : il reste lisible si le compte change.
  add column visuals_validated_by_name text;

comment on column weekly_sheets.visuals_validated_at is
  'Visuels de la fiche validés. Remis à vide dès qu''un fichier change ensuite.';

-- SECURITY DEFINER : le graphiste qui dépose un fichier n'a pas le droit de
-- modifier la fiche elle-même, mais son dépôt doit bien retirer la validation.
create or replace function weekly_sheet_items_reset_visuals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Un contenu sans fichier attendu ne change rien aux visuels.
    if new.format = 'texte_seul' or new.is_cancelled then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.media_asset_id is not distinct from old.media_asset_id
       and new.media_external_url is not distinct from old.media_external_url
       and new.format is not distinct from old.format
       and not (old.is_cancelled and not new.is_cancelled) then
      return new;
    end if;
  end if;

  update weekly_sheets
  set visuals_validated_at = null, visuals_validated_by = null, visuals_validated_by_name = null
  where id = new.weekly_sheet_id and visuals_validated_at is not null;
  return new;
end;
$$;

create trigger weekly_sheet_items_reset_visuals
  after insert or update on weekly_sheet_items
  for each row execute function weekly_sheet_items_reset_visuals();

create or replace function weekly_sheet_item_media_reset_visuals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_sheet uuid;
begin
  select weekly_sheet_id into target_sheet
  from weekly_sheet_items
  where id = coalesce(new.weekly_sheet_item_id, old.weekly_sheet_item_id);

  if target_sheet is not null then
    update weekly_sheets
    set visuals_validated_at = null, visuals_validated_by = null, visuals_validated_by_name = null
    where id = target_sheet and visuals_validated_at is not null;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger weekly_sheet_item_media_reset_visuals
  after insert or update or delete on weekly_sheet_item_media
  for each row execute function weekly_sheet_item_media_reset_visuals();

revoke all on function weekly_sheet_items_reset_visuals() from public, anon, authenticated;
revoke all on function weekly_sheet_item_media_reset_visuals() from public, anon, authenticated;
