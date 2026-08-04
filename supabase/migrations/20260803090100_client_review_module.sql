-- =============================================================================
-- LYFTT — Module « Validation client, lien interactif et tickets »
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Énumérations du module
-- ----------------------------------------------------------------------------

-- §6 — Types de demande. L'ordre suit celui de la spec.
create type ticket_type as enum (
  'text_edit',            -- modifier le texte
  'text_typo',            -- corriger une faute
  'text_information',     -- changer une information
  'text_tone',            -- modifier le ton
  'hashtags',             -- modifier les hashtags
  'photo_replace',        -- remplacer une photo
  'photo_retouch',        -- retoucher une photo
  'graphic_edit',         -- modifier une création graphique
  'image_order',          -- changer l'ordre des images
  'video_edit',           -- modifier une vidéo
  'video_replace',        -- remplacer une vidéo
  'schedule_change',      -- changer la date de publication
  'network_change',       -- changer le réseau
  'publication_remove',   -- retirer une publication
  'publication_add',      -- ajouter une publication
  'other'                 -- autre demande
);

-- Famille de traitement, déduite du type (sert au routage §7 et aux filtres §9).
create type ticket_category as enum ('editorial', 'graphic', 'video', 'scheduling', 'scope');

-- §10 — Séquencement des tickets.
create type ticket_status as enum (
  'new',                  -- nouveau
  'to_qualify',           -- à qualifier
  'assigned',             -- affecté
  'in_progress',          -- en cours
  'ready_for_review',     -- prêt à contrôler
  'internally_reviewed',  -- contrôlé en interne
  'new_version_generated',-- nouvelle version générée
  'sent_back_to_client',  -- renvoyé au client
  'approved_by_client',   -- validé par le client
  'closed',               -- fermé
  -- statuts supplémentaires
  'awaiting_client',      -- en attente du client
  'rejected',             -- refusé
  'out_of_scope',         -- hors périmètre
  'billing_review',       -- facturation complémentaire à valider
  'cancelled',            -- annulé
  'reopened'              -- rouvert
);

create type ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create type actor_type as enum ('client', 'staff', 'system');

create type comment_visibility as enum ('internal', 'client_visible', 'system');

-- §7 — Rôle d'une personne sur un ticket.
create type assignment_role as enum (
  'owner',        -- community manager référent, responsable éditorial
  'contributor',  -- graphiste / vidéaste qui produit la correction
  'reviewer',     -- contrôle interne
  'watcher'       -- responsable de production notifié
);

create type review_event_type as enum (
  'link_opened',
  'sheet_viewed',
  'item_approved',
  'sheet_approved',
  'ticket_created',
  'attachment_uploaded',
  'new_version_viewed',
  'access_denied'
);

create type sheet_version_status as enum (
  'draft',
  'sent',
  'superseded',   -- une version plus récente existe
  'approved'
);

create type message_channel as enum ('whatsapp', 'email');

-- §4 — Modèles de messages.
create type message_template_type as enum (
  'standard',
  'warm',
  'explicit_approval',
  'tacit_approval',
  'after_corrections',
  'reminder',
  'overdue',
  'new_version'
);

-- ----------------------------------------------------------------------------
-- §11 — Versions de fiche
-- ----------------------------------------------------------------------------

create table weekly_sheet_versions (
  id                uuid primary key default gen_random_uuid(),
  weekly_sheet_id   uuid not null references weekly_sheets (id) on delete cascade,
  version_number    integer not null
    constraint weekly_sheet_versions_number_positive check (version_number >= 1),
  status            sheet_version_status not null default 'draft',
  change_summary    text,
  -- Ticket ayant motivé cette version (null pour la version 1).
  source_ticket_id  uuid,
  created_by        uuid references profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  sent_to_client_at timestamptz,
  validated_at      timestamptz,

  unique (weekly_sheet_id, version_number)
);

create index weekly_sheet_versions_sheet_idx
  on weekly_sheet_versions (weekly_sheet_id, version_number desc);

comment on table weekly_sheet_versions is
  'Historique des versions. Une version n''est jamais écrasée : on en crée une nouvelle (§10, §11).';

-- Instantané d'un contenu à une version donnée (§11).
create table weekly_sheet_item_versions (
  id                    uuid primary key default gen_random_uuid(),
  weekly_sheet_item_id  uuid not null references weekly_sheet_items (id) on delete cascade,
  sheet_version_id      uuid not null references weekly_sheet_versions (id) on delete cascade,
  -- Texte, hashtags, date, réseaux… au moment du gel de la version.
  content_snapshot      jsonb not null,
  -- Média actif à ce moment-là (id, chemin, miniature).
  media_snapshot        jsonb,
  created_by            uuid references profiles (id) on delete set null,
  created_at            timestamptz not null default now(),

  unique (weekly_sheet_item_id, sheet_version_id)
);

create index weekly_sheet_item_versions_version_idx
  on weekly_sheet_item_versions (sheet_version_id);

-- La fiche pointe vers sa version active.
alter table weekly_sheets
  add column current_version_id uuid references weekly_sheet_versions (id) on delete set null;

-- ----------------------------------------------------------------------------
-- §18 — Liens de consultation
-- ----------------------------------------------------------------------------

create table client_review_links (
  id                uuid primary key default gen_random_uuid(),
  weekly_sheet_id   uuid not null references weekly_sheets (id) on delete cascade,
  -- Le token brut n'est jamais stocké : seulement son SHA-256 (§18, §19).
  token_hash        text not null unique,
  -- 8 premiers caractères, uniquement pour permettre à l'équipe d'identifier un lien.
  token_prefix      text not null,
  sheet_version_id  uuid references weekly_sheet_versions (id) on delete set null,
  expires_at        timestamptz not null,
  revoked_at        timestamptz,
  revoked_reason    text,
  last_accessed_at  timestamptz,
  access_count      integer not null default 0,
  created_by        uuid references profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index client_review_links_sheet_idx on client_review_links (weekly_sheet_id);
-- Un seul lien actif par fiche à un instant donné.
create unique index client_review_links_one_active_idx
  on client_review_links (weekly_sheet_id)
  where revoked_at is null;

comment on column client_review_links.token_hash is
  'SHA-256 du token. La recherche se fait par hash : aucune énumération possible (§19).';

-- ----------------------------------------------------------------------------
-- §18 — Consultations / événements
-- ----------------------------------------------------------------------------

create table client_review_events (
  id              uuid primary key default gen_random_uuid(),
  review_link_id  uuid not null references client_review_links (id) on delete cascade,
  event_type      review_event_type not null,
  metadata        jsonb not null default '{}',
  -- Empreinte tronquée et salée, jamais l'IP en clair (§20, minimisation).
  ip_hash         text,
  user_agent_family text,
  created_at      timestamptz not null default now()
);

create index client_review_events_link_idx
  on client_review_events (review_link_id, created_at desc);
create index client_review_events_type_idx on client_review_events (event_type);

comment on table client_review_events is
  'Journalisation minimale. On conserve une famille de navigateur, pas l''User-Agent complet (§20).';

-- ----------------------------------------------------------------------------
-- §18 — Tickets
-- ----------------------------------------------------------------------------

create sequence client_ticket_number_seq;

create table client_tickets (
  id                    uuid primary key default gen_random_uuid(),
  -- Numéro lisible : LYF-000123
  ticket_number         text not null unique
    default 'LYF-' || lpad(nextval('client_ticket_number_seq')::text, 6, '0'),

  client_id             uuid not null references clients (id) on delete cascade,
  weekly_sheet_id       uuid not null references weekly_sheets (id) on delete cascade,
  -- Null si la demande porte sur la fiche entière (ex. « ajouter une publication »).
  weekly_sheet_item_id  uuid references weekly_sheet_items (id) on delete set null,
  sheet_version_id      uuid references weekly_sheet_versions (id) on delete set null,
  review_link_id        uuid references client_review_links (id) on delete set null,

  ticket_type           ticket_type not null,
  category              ticket_category not null,
  title                 text not null,
  description           text not null
    constraint client_tickets_description_not_blank check (length(btrim(description)) > 0),
  -- Proposition de nouveau texte / consigne précise fournie par le client (§12).
  client_suggestion     text,
  -- Détails typés selon le type de demande (timecode vidéo, type de retouche…).
  details               jsonb not null default '{}',

  priority              ticket_priority not null default 'normal',
  status                ticket_status not null default 'new',

  due_at                timestamptz,
  submitted_at          timestamptz not null default now(),
  resolved_at           timestamptz,
  closed_at             timestamptz,
  reopened_at           timestamptz,
  reopen_count          integer not null default 0,

  -- Version produite en réponse à ce ticket.
  resolution_version_id uuid references weekly_sheet_versions (id) on delete set null,

  created_by_type       actor_type not null default 'client',
  created_by_name       text,
  created_by_email      citext,
  created_by_profile_id uuid references profiles (id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index client_tickets_sheet_idx on client_tickets (weekly_sheet_id);
create index client_tickets_item_idx on client_tickets (weekly_sheet_item_id);
create index client_tickets_client_status_idx on client_tickets (client_id, status);
create index client_tickets_status_due_idx on client_tickets (status, due_at);
-- Tickets ouverts : requête la plus fréquente (pastille de navigation, §8).
create index client_tickets_open_idx on client_tickets (client_id, created_at desc)
  where status not in ('closed', 'cancelled', 'rejected');

alter table weekly_sheet_versions
  add constraint weekly_sheet_versions_source_ticket_fk
  foreign key (source_ticket_id) references client_tickets (id) on delete set null;

-- ----------------------------------------------------------------------------
-- §18 — Affectations
-- ----------------------------------------------------------------------------

create table client_ticket_assignments (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references client_tickets (id) on delete cascade,
  profile_id      uuid not null references profiles (id) on delete cascade,
  assignment_role assignment_role not null,
  assigned_at     timestamptz not null default now(),
  accepted_at     timestamptz,
  completed_at    timestamptz,

  unique (ticket_id, profile_id, assignment_role)
);

create index client_ticket_assignments_profile_idx
  on client_ticket_assignments (profile_id, completed_at);

-- ----------------------------------------------------------------------------
-- §18 — Commentaires
-- ----------------------------------------------------------------------------

create table client_ticket_comments (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references client_tickets (id) on delete cascade,
  author_profile_id uuid references profiles (id) on delete set null,
  author_type       actor_type not null,
  author_name       text,
  visibility        comment_visibility not null default 'internal',
  body              text not null
    constraint client_ticket_comments_body_not_blank check (length(btrim(body)) > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index client_ticket_comments_ticket_idx
  on client_ticket_comments (ticket_id, created_at);

-- ----------------------------------------------------------------------------
-- §18 — Pièces jointes
-- ----------------------------------------------------------------------------

create table client_ticket_attachments (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references client_tickets (id) on delete cascade,
  media_asset_id    uuid not null references media_assets (id) on delete cascade,
  uploaded_by_type  actor_type not null default 'client',
  uploaded_by_name  text,
  created_at        timestamptz not null default now(),

  unique (ticket_id, media_asset_id)
);

create index client_ticket_attachments_ticket_idx on client_ticket_attachments (ticket_id);

-- ----------------------------------------------------------------------------
-- §18 — Validations client
-- ----------------------------------------------------------------------------

create table client_content_approvals (
  id                    uuid primary key default gen_random_uuid(),
  weekly_sheet_id       uuid not null references weekly_sheets (id) on delete cascade,
  -- Null = validation globale de la fiche.
  weekly_sheet_item_id  uuid references weekly_sheet_items (id) on delete cascade,
  sheet_version_id      uuid not null references weekly_sheet_versions (id) on delete cascade,
  review_link_id        uuid references client_review_links (id) on delete set null,

  status                item_approval_status not null,
  client_name           text,
  client_email          citext,
  comment               text,
  approved_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create index client_content_approvals_sheet_idx
  on client_content_approvals (weekly_sheet_id, sheet_version_id);
-- Une seule validation courante par contenu et par version : on remplace en cas de
-- changement d'avis (le client valide puis demande une modification, §24).
create unique index client_content_approvals_unique_item_idx
  on client_content_approvals (sheet_version_id, weekly_sheet_item_id)
  where weekly_sheet_item_id is not null;

-- ----------------------------------------------------------------------------
-- §18 — Modèles de messages
-- ----------------------------------------------------------------------------

create table client_message_templates (
  id            uuid primary key default gen_random_uuid(),
  -- Null = modèle global LYFTT ; renseigné = modèle propre à un client.
  client_id     uuid references clients (id) on delete cascade,
  name          text not null,
  channel       message_channel not null default 'whatsapp',
  subject       text,
  body          text not null,
  template_type message_template_type not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index client_message_templates_type_idx
  on client_message_templates (template_type, channel) where is_active;
create unique index client_message_templates_default_idx
  on client_message_templates (template_type, channel)
  where client_id is null and is_active;

-- Trace des envois : qui a envoyé quoi, quand (§4).
create table client_message_dispatches (
  id                uuid primary key default gen_random_uuid(),
  weekly_sheet_id   uuid not null references weekly_sheets (id) on delete cascade,
  sheet_version_id  uuid references weekly_sheet_versions (id) on delete set null,
  template_id       uuid references client_message_templates (id) on delete set null,
  template_type     message_template_type not null,
  channel           message_channel not null,
  recipient_label   text,
  rendered_body     text not null,
  sent_at           timestamptz not null default now(),
  sent_by           uuid references profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index client_message_dispatches_sheet_idx
  on client_message_dispatches (weekly_sheet_id, sent_at desc);

comment on table client_message_dispatches is
  'Preuve d''envoi : indispensable pour justifier une validation tacite (§16).';

-- ----------------------------------------------------------------------------
-- §14 — Exports
-- ----------------------------------------------------------------------------

create table sheet_exports (
  id                uuid primary key default gen_random_uuid(),
  weekly_sheet_id   uuid not null references weekly_sheets (id) on delete cascade,
  sheet_version_id  uuid not null references weekly_sheet_versions (id) on delete cascade,
  storage_path      text not null,
  file_name         text not null,
  byte_size         bigint,
  -- L'ancien export n'est pas supprimé, il est marqué obsolète (§14).
  is_obsolete       boolean not null default false,
  obsoleted_at      timestamptz,
  generated_by      uuid references profiles (id) on delete set null,
  generated_at      timestamptz not null default now()
);

create index sheet_exports_sheet_idx on sheet_exports (weekly_sheet_id, generated_at desc);
create index sheet_exports_active_idx on sheet_exports (weekly_sheet_id) where not is_obsolete;

-- ----------------------------------------------------------------------------
-- §8 — Notifications internes
-- ----------------------------------------------------------------------------

create table internal_notifications (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles (id) on delete cascade,
  ticket_id     uuid references client_tickets (id) on delete cascade,
  weekly_sheet_id uuid references weekly_sheets (id) on delete cascade,
  title         text not null,
  body          text,
  -- Marquer comme lue ne ferme pas le ticket (§8).
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index internal_notifications_unread_idx
  on internal_notifications (profile_id, created_at desc) where read_at is null;

-- ----------------------------------------------------------------------------
-- Horodatage automatique
-- ----------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'clients', 'client_contacts', 'weekly_sheets', 'weekly_sheet_items',
    'client_review_links', 'client_tickets', 'client_ticket_comments',
    'client_message_templates'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end;
$$;
