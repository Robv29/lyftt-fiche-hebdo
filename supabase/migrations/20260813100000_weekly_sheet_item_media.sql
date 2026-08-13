-- =============================================================================
-- Galerie d'une publication
--
-- Un post photo peut porter plusieurs images — un carrousel. Le champ unique
-- `media_asset_id` ne pouvait en désigner qu'une ; il reste la **couverture**,
-- dénormalisée, pour que tous les écrans qui n'affichent qu'une vignette
-- continuent de fonctionner sans changement. Cette table porte l'ordre complet.
--
-- Conséquence à ne pas manquer : la purge planifiée considérait comme orphelin
-- tout média sans publication rattachée via `media_asset_id`. Les images
-- suivantes d'un carrousel auraient donc été supprimées au bout de 48 heures.
-- =============================================================================

create table weekly_sheet_item_media (
  id                    uuid primary key default gen_random_uuid(),
  weekly_sheet_item_id  uuid not null references weekly_sheet_items(id) on delete cascade,
  media_asset_id        uuid not null references media_assets(id) on delete cascade,
  position              smallint not null default 0,
  created_at            timestamptz not null default now(),
  unique (weekly_sheet_item_id, media_asset_id)
);

create index weekly_sheet_item_media_item_idx
  on weekly_sheet_item_media (weekly_sheet_item_id, position);
create index weekly_sheet_item_media_asset_idx
  on weekly_sheet_item_media (media_asset_id);

alter table weekly_sheet_item_media enable row level security;

create policy weekly_sheet_item_media_select on weekly_sheet_item_media
  for select to authenticated
  using (exists (
    select 1 from weekly_sheet_items i
    join weekly_sheets s on s.id = i.weekly_sheet_id
    where i.id = weekly_sheet_item_id and can_access_client(s.client_id)
  ));

create policy weekly_sheet_item_media_write on weekly_sheet_item_media
  for all to authenticated
  using (exists (
    select 1 from weekly_sheet_items i
    join weekly_sheets s on s.id = i.weekly_sheet_id
    where i.id = weekly_sheet_item_id
      and can_access_client(s.client_id)
      and current_role_is(array['super_admin','production_manager','community_manager']::app_role[])
  ))
  with check (exists (
    select 1 from weekly_sheet_items i
    join weekly_sheets s on s.id = i.weekly_sheet_id
    where i.id = weekly_sheet_item_id and can_access_client(s.client_id)
  ));

insert into weekly_sheet_item_media (weekly_sheet_item_id, media_asset_id, position)
select i.id, i.media_asset_id, 0
  from weekly_sheet_items i
 where i.media_asset_id is not null
on conflict do nothing;
