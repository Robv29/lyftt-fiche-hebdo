-- Fiche d'un shooting — ce que sa date ne sait pas dire.
--
-- LA DATE N'EST PAS ICI, ET C'EST VOLONTAIRE. Elle vit dans
-- `client_budget_lines.performed_on`, où elle a toujours vécu : c'est elle que
-- pose le bouton « Date calée » du tableau de bord, elle que lit le calcul de
-- l'échéance suivante, elle qui compose la facture. La recopier dans cette
-- table en aurait fait une seconde vérité, et deux vérités finissent toujours
-- par diverger — c'est la cause commune des cinq défauts coûteux corrigés
-- cette semaine.
--
-- Cette table est donc greffée sur la ligne de budget, une pour une, et ne
-- porte que ce qui manquait : nom, type, lieu, responsable, durée, délai de
-- livraison. Supprimer la ligne emporte la fiche, ce qui est correct : sans
-- date, un shooting n'existe pas.
--
-- L'annulation fait exception. Elle ne se déduit d'aucune date — une date
-- passée signifie « réalisé », sauf si le shooting a été annulé — et se
-- consigne donc ici. Annuler cesse ainsi d'être une suppression sans trace.

create table shootings (
  id               uuid primary key default gen_random_uuid(),
  budget_line_id   uuid not null unique references client_budget_lines(id) on delete cascade,
  -- Redondant avec la ligne, mais indispensable : la RLS et les requêtes du
  -- module filtrent par client sans avoir à joindre le budget, table réservée
  -- à la direction.
  client_id        uuid not null references clients(id) on delete cascade,
  name             text,
  kind             text check (kind in ('photo', 'video', 'photo_video')),
  place            text,
  -- Nom libre : le responsable n'est pas toujours un compte de l'application.
  lead_name        text,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 1440),
  delivery_days    integer check (delivery_days is null or delivery_days between 0 and 365),
  cancelled        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table shootings is
  'Fiche d''un shooting. La date reste dans client_budget_lines.performed_on ; cette table ne porte que ce que la date ne dit pas.';

create index shootings_client_idx on shootings (client_id);

create trigger shootings_set_updated_at
  before update on shootings
  for each row execute function set_updated_at();

alter table shootings enable row level security;

-- Lecture ouverte à l'équipe de production du client : savoir qu'un shooting
-- est calé sert à préparer le tournage, pas à voir un budget.
create policy shootings_select on shootings
  for select to authenticated
  using (can_access_client(client_id) and not is_commercial());

-- Écriture réservée à ceux qui produisent, comme pour les fiches et les tickets.
create policy shootings_write on shootings
  for all to authenticated
  using (can_access_client(client_id) and is_producer())
  with check (can_access_client(client_id) and is_producer());
