-- Validation d'une correction par l'agence, sans renvoi au client.
--
-- Après une modification de texte, la personne qui a corrigé peut soit
-- renvoyer la fiche au client, soit la valider elle-même. Le second geste
-- remplace une validation du client : il doit donc laisser une trace
-- distincte, nominative et datée, que l'historique montre comme telle — une
-- fiche validée par l'agence ne doit jamais se lire « validée par le client ».

create table weekly_sheet_staff_validations (
  id                   uuid primary key default gen_random_uuid(),
  -- Redondant avec la fiche, mais c'est ce que la RLS sait lire sans jointure.
  client_id            uuid not null references clients(id) on delete cascade,
  weekly_sheet_id      uuid not null references weekly_sheets(id) on delete cascade,
  weekly_sheet_item_id uuid references weekly_sheet_items(id) on delete set null,
  ticket_id            uuid references client_tickets(id) on delete set null,
  validated_by         uuid references profiles(id) on delete set null,
  -- Nom figé : il reste lisible si le compte change ou disparaît.
  validated_by_name    text not null,
  created_at           timestamptz not null default now()
);

comment on table weekly_sheet_staff_validations is
  'Corrections validées par l''agence sans renvoi au client : qui, quand, sur quelle fiche et quel ticket.';

create index weekly_sheet_staff_validations_sheet_idx on weekly_sheet_staff_validations (weekly_sheet_id);
create index weekly_sheet_staff_validations_ticket_idx on weekly_sheet_staff_validations (ticket_id);

alter table weekly_sheet_staff_validations enable row level security;

-- Écrite par l'action serveur seule (clé service) ; lue par l'équipe du client.
revoke all on weekly_sheet_staff_validations from anon;
revoke insert, update, delete, truncate, trigger, references on weekly_sheet_staff_validations from authenticated;

create policy weekly_sheet_staff_validations_select on weekly_sheet_staff_validations
  for select to authenticated
  using (can_access_client(client_id) and not is_commercial());
