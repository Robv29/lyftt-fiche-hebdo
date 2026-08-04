-- Checklist opérationnelle du menu Publications.
alter table weekly_sheet_items
  add column if not exists media_downloaded_at timestamptz,
  add column if not exists content_copied_at timestamptz;

comment on column weekly_sheet_items.media_downloaded_at is
  'Date à laquelle le média a été récupéré depuis la checklist de publication.';
comment on column weekly_sheet_items.content_copied_at is
  'Date à laquelle le texte et ses hashtags ont été copiés en une action.';

create index if not exists weekly_sheet_items_daily_publication_idx
  on weekly_sheet_items (scheduled_date, published_at)
  where not is_cancelled;
