-- Accès en lecture du rôle « commercial ».
--
-- Le commercial voit tous les clients, leurs contacts et l'équipe qui les
-- suit — de quoi préparer un rendez-vous et lire la carte des implantations.
-- Il ne modifie rien, nulle part.
--
-- IMPORTANT : ces politiques sont *additives* et ne touchent pas
-- `can_access_client()`. Ce choix n'est pas cosmétique. Onze politiques
-- d'écriture reposent sur cette fonction sans contrôle de rôle — demandes de
-- production, tickets, médias, contenus de fiches. Y ajouter le commercial lui
-- aurait ouvert l'écriture partout, à l'exact opposé de ce qui est demandé.
-- Le périmètre en lecture s'élargit donc par des politiques distinctes, en
-- SELECT uniquement.
--
-- Tout le reste — fiches, publications, tickets, budget, factures, RIB,
-- médias — reste hors de portée : aucune politique ne mentionne le commercial,
-- et `can_access_client()` l'ignore.

create or replace function is_commercial() returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_is(array['commercial']::app_role[]);
$$;

comment on function is_commercial() is
  'Rôle commercial : lecture seule des clients. Ne jamais employer dans une politique d''écriture.';

create policy clients_select_commercial on clients
  for select to authenticated using (is_commercial());

create policy client_contacts_select_commercial on client_contacts
  for select to authenticated using (is_commercial());

create policy client_assignments_select_commercial on client_assignments
  for select to authenticated using (is_commercial());

-- Pour afficher le nom du community manager qui suit chaque client.
create policy profiles_select_commercial on profiles
  for select to authenticated using (is_commercial());
