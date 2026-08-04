-- =============================================================================
-- LYFTT — Fiche hebdomadaire : socle
-- Modélise la fiche telle qu'elle existe aujourd'hui en PDF :
--   en-tête (client, période, nombre de publications, réseaux)
--   puis N lignes « CONTENU | CONTENU VISUEL | RÉDACTION ».
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ----------------------------------------------------------------------------
-- Énumérations
-- ----------------------------------------------------------------------------

create type app_role as enum (
  'super_admin',
  'production_manager',   -- responsable de production
  'community_manager',
  'graphic_designer',     -- graphiste
  'video_editor',         -- vidéaste
  'observer'
);

create type social_network as enum (
  'instagram',
  'facebook',
  'linkedin',
  'tiktok',
  'youtube',
  'google_business',
  'pinterest',
  'x'
);

-- Colonne « CONTENU » de la fiche : POST / REEL / STORY…
create type publication_type as enum (
  'post',
  'reel',
  'story',
  'carousel',
  'video',
  'article',
  'other'
);

-- Sous-libellé de la colonne « CONTENU » : VISUEL / PHOTO / REELS…
create type media_format as enum (
  'visuel',   -- création graphique
  'photo',
  'reels',
  'video',
  'carrousel',
  'texte_seul'
);

create type media_kind as enum ('image', 'video', 'document');

-- Statut de la fiche vu par l'équipe (§15 de la spec).
create type sheet_status as enum (
  'draft',                    -- en préparation
  'internal_review',          -- contrôle interne
  'ready_to_send',            -- prête à envoyer
  'sent_to_client',           -- envoyée au client
  'partially_approved',       -- partiellement validée
  'changes_requested',        -- modifications demandées
  'corrections_in_progress',  -- corrections en cours
  'new_version_to_send',      -- nouvelle version à envoyer
  'awaiting_revalidation',    -- en attente de nouvelle validation
  'approved_by_client',       -- validée par le client
  'tacitly_approved',         -- validation tacite
  'rejected',                 -- refusée
  'expired'                   -- expirée
);

-- Statut d'un contenu pris isolément (§15).
create type item_approval_status as enum (
  'pending',            -- en attente de validation
  'approved',           -- validé
  'changes_requested',  -- modification demandée
  'corrected',          -- corrigé
  'resent',             -- renvoyé
  'approved_after_fix'  -- validé après correction
);

-- Règle de validation applicable au client (§16).
create type approval_policy as enum (
  'explicit_required',  -- validation explicite obligatoire
  'tacit_allowed'       -- validation tacite autorisée
);

-- ----------------------------------------------------------------------------
-- Profils internes
-- ----------------------------------------------------------------------------

create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null,
  email         citext not null unique,
  role          app_role not null default 'community_manager',
  phone         text,
  avatar_url    text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table profiles is
  'Membres de l''équipe LYFTT. Le rôle pilote l''accès aux tickets et aux écrans de production.';

-- ----------------------------------------------------------------------------
-- Clients
-- ----------------------------------------------------------------------------

create table clients (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              citext not null unique,
  logo_url          text,
  timezone          text not null default 'Europe/Paris',

  -- Échéance de validation configurable (§3). 1 = lundi … 7 = dimanche (ISO).
  validation_deadline_weekday  smallint not null default 2
    constraint clients_deadline_weekday_range check (validation_deadline_weekday between 1 and 7),
  validation_deadline_time     time not null default '10:00',

  -- Règle applicable en l'absence de réponse (§16). Jamais tacite par défaut.
  approval_policy              approval_policy not null default 'explicit_required',
  tacit_approval_notice        text,

  -- Rappels (§17)
  reminders_enabled            boolean not null default true,
  reminder_channel_email       boolean not null default true,
  reminder_channel_whatsapp    boolean not null default true,

  whatsapp_group_name          text,
  notes                        text,

  -- Conservation configurable des liens et tickets (§20).
  data_retention_days          integer not null default 730
    constraint clients_retention_positive check (data_retention_days > 0),

  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column clients.approval_policy is
  'La validation tacite n''est jamais activée par défaut : elle doit être paramétrée explicitement (§16).';

create table client_contacts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  first_name    text not null,
  last_name     text,
  email         citext,
  phone         text,
  role_label    text,
  is_primary    boolean not null default false,
  receives_reminders boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index client_contacts_client_idx on client_contacts (client_id);
-- Un seul contact principal par client.
create unique index client_contacts_one_primary_idx
  on client_contacts (client_id) where is_primary;

-- Qui s'occupe de quel client (sert au routage des tickets, §7).
create table client_assignments (
  client_id   uuid not null references clients (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  role        app_role not null,
  is_default  boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (client_id, profile_id, role)
);

create index client_assignments_profile_idx on client_assignments (profile_id);

-- ----------------------------------------------------------------------------
-- Médias
-- ----------------------------------------------------------------------------

create table media_assets (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients (id) on delete cascade,
  kind            media_kind not null,
  storage_path    text not null,
  file_name       text not null,
  mime_type       text not null,
  byte_size       bigint,
  width           integer,
  height          integer,
  duration_seconds numeric(10, 2),
  thumbnail_path  text,
  -- Chaînage des versions : un nouveau fichier pointe vers celui qu'il remplace.
  replaces_media_id uuid references media_assets (id) on delete set null,
  uploaded_by     uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index media_assets_client_idx on media_assets (client_id);
create index media_assets_replaces_idx on media_assets (replaces_media_id)
  where replaces_media_id is not null;

comment on table media_assets is
  'Les anciens fichiers ne sont jamais supprimés : ils restent accessibles en interne via replaces_media_id (§13).';

-- ----------------------------------------------------------------------------
-- Fiches hebdomadaires
-- ----------------------------------------------------------------------------

create table weekly_sheets (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients (id) on delete cascade,

  iso_year            integer not null,
  iso_week            integer not null
    constraint weekly_sheets_week_range check (iso_week between 1 and 53),
  period_start        date not null,
  period_end          date not null,
  constraint weekly_sheets_period_order check (period_end >= period_start),

  networks            social_network[] not null default '{}',
  title               text,

  status              sheet_status not null default 'draft',
  community_manager_id uuid references profiles (id) on delete set null,

  -- Calculée à la création à partir de la semaine + du paramétrage client (§3).
  validation_deadline_at timestamptz,

  sent_to_client_at   timestamptz,
  first_viewed_at     timestamptz,
  approved_at         timestamptz,

  created_by          uuid references profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (client_id, iso_year, iso_week)
);

create index weekly_sheets_client_status_idx on weekly_sheets (client_id, status);
create index weekly_sheets_deadline_idx on weekly_sheets (validation_deadline_at)
  where status in ('sent_to_client', 'partially_approved', 'awaiting_revalidation');

create table weekly_sheet_items (
  id                uuid primary key default gen_random_uuid(),
  weekly_sheet_id   uuid not null references weekly_sheets (id) on delete cascade,
  position          integer not null,

  scheduled_date    date not null,
  scheduled_time    time,
  publication_type  publication_type not null default 'post',
  format            media_format not null default 'photo',
  networks          social_network[] not null default '{}',

  caption           text not null default '',
  hashtags          text[] not null default '{}',

  media_asset_id    uuid references media_assets (id) on delete set null,
  -- « Vidéo transmise séparément » : pas de fichier mais le client doit pouvoir commenter (§5).
  media_external_url text,
  media_pending_note text,

  -- Jamais exposé au client (§19, scénario 8).
  internal_notes    text,

  approval_status   item_approval_status not null default 'pending',
  is_cancelled      boolean not null default false,
  published_at      timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (weekly_sheet_id, position)
);

create index weekly_sheet_items_sheet_idx on weekly_sheet_items (weekly_sheet_id);
create index weekly_sheet_items_status_idx on weekly_sheet_items (approval_status);

comment on column weekly_sheet_items.internal_notes is
  'Notes internes. Ne doit JAMAIS être sélectionnée dans une requête servant le portail client.';
