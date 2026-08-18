-- =============================================================================
-- Lien permanent de demande, un par client.
--
-- Le lien de validation est attaché à une fiche et expire ; en générer un
-- nouveau révoque le précédent. Le donner « pour toute demande » reviendrait à
-- casser celui que le client utilise pour valider sa semaine.
--
-- Celui-ci ne dépend d'aucune fiche et ne se périme pas : il s'enregistre dans
-- les contacts du client, et sert à toutes ses demandes — shooting, devis,
-- correction, question. Le tri entre production et éditorial se fait ensuite,
-- à partir du type choisi, comme pour toute demande.
--
-- Le jeton est conservé en clair, à la différence du lien de validation : il
-- doit pouvoir être recopié à tout moment sans être réémis, sinon le lien déjà
-- donné au client cesserait de fonctionner. Ce qu'il ouvre est volontairement
-- pauvre — un formulaire de demande, aucun contenu client — et le débit est
-- limité côté serveur.
-- =============================================================================

create table client_request_links (
  client_id     uuid primary key references clients (id) on delete cascade,
  token         text not null unique,
  created_by    uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  use_count     integer not null default 0
);

alter table client_request_links enable row level security;

create policy client_request_links_read on client_request_links
  for select to authenticated
  using (can_access_client(client_id));

comment on table client_request_links is
  'Lien permanent par client pour déposer une demande. Écrit et lu par la clé service côté public.';
