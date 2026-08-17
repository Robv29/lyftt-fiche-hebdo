-- =============================================================================
-- Commandes de production internes
--
-- L'équipe se demande des contenus entre elle — « une vidéo pour Muratet
-- avant vendredi » — par messages, qui se perdent comme se perdaient les
-- demandes clients. La commande est posée avec son échéance et son brief ;
-- le graphiste ou vidéaste y dépose directement le fichier produit, et le
-- demandeur valide.
--
-- Distinct des tickets clients : ici il n'y a ni client à recontacter, ni
-- revalidation — juste un fichier attendu par un collègue.
-- =============================================================================

create type production_request_kind as enum ('video', 'photo', 'visuel');
create type production_request_status as enum ('a_faire', 'livree', 'validee');

create table production_requests (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  kind           production_request_kind not null,
  title          text not null,
  brief          text,
  due_on         date not null,
  status         production_request_status not null default 'a_faire',
  media_asset_id uuid references media_assets(id) on delete set null,
  requested_by   uuid references profiles(id) on delete set null,
  requested_by_name text,
  delivered_at   timestamptz,
  validated_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index production_requests_open_idx
  on production_requests (status, due_on);

alter table production_requests enable row level security;

create policy production_requests_select on production_requests
  for select to authenticated
  using (can_access_client(client_id));

create policy production_requests_write on production_requests
  for all to authenticated
  using (can_access_client(client_id))
  with check (can_access_client(client_id));
