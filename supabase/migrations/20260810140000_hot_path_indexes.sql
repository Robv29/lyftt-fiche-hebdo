-- Index sur les clés étrangères empruntées à chaque affichage.
--
-- Sans eux, chaque rendu de Publications ou d'une fiche impose un parcours
-- séquentiel des tables jointes. C'est indolore sur quelques lignes, moins
-- dès que trente clients produisent leurs publications chaque semaine.
-- Une suppression de média ou de fiche verrouille aussi moins longtemps.

create index if not exists weekly_sheet_items_media_asset_idx
  on weekly_sheet_items (media_asset_id)
  where media_asset_id is not null;

create index if not exists weekly_sheets_current_version_idx
  on weekly_sheets (current_version_id)
  where current_version_id is not null;

create index if not exists weekly_sheets_community_manager_idx
  on weekly_sheets (community_manager_id);

create index if not exists client_content_approvals_item_idx
  on client_content_approvals (weekly_sheet_item_id);

create index if not exists client_content_approvals_link_idx
  on client_content_approvals (review_link_id);

create index if not exists client_tickets_item_idx
  on client_tickets (weekly_sheet_item_id)
  where weekly_sheet_item_id is not null;

create index if not exists client_message_dispatches_sheet_idx
  on client_message_dispatches (weekly_sheet_id);
