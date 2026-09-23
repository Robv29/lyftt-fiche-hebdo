-- =============================================================================
-- Production : chacun voit le plan de charge de tous, en lecture seule.
--
-- Une commande de production n'était visible que des personnes rattachées au
-- client. Résultat : personne ne voyait ce que produisaient les autres, ni ce
-- qui partait en retard ailleurs. Le plan de charge de l'agence est une
-- information d'organisation, pas un contenu client : il s'ouvre à l'équipe.
--
-- IMPORTANT : cette politique est *additive* et en SELECT seulement, sur le
-- modèle des politiques du commercial (`20260902110100_role_commercial_policies`).
-- `can_access_client()` n'est pas touchée — onze politiques d'écriture en
-- dépendent sans contrôle de rôle. `production_requests_write` (for all) reste
-- donc bornée au périmètre client : lire la commande d'un autre ne donne pas le
-- droit d'y toucher, et c'est la base qui le garantit, pas l'écran.
--
-- Ce qui s'élargit : ce que la file a besoin d'afficher — nature, intitulé,
-- brief, échéance, statut, qui a commandé, à qui c'est confié, quand ça a été
-- livré et validé. Plus le *nom* des clients concernés, sans quoi la liste est
-- illisible.
--
-- Ce qui ne s'élargit pas, et reste protégé sans une ligne de code :
--   • `clients` — ses lignes portent `notes` (la formule vendue, la cadence,
--     les formats), les dates de contrat, les coordonnées. `clients_select`
--     n'est pas touchée : seule la fonction ci-dessous sort, et elle ne rend
--     que (id, name).
--   • `media_assets` — le fichier livré et le visuel d'exemple sont du contenu
--     client. `media_assets_select` reste sur `can_access_client()`, donc les
--     jointures de la page reviennent nulles hors périmètre et aucune URL
--     signée n'est produite. La carte dit qu'un fichier existe, elle ne le
--     montre pas.
--   • `client_budgets`, `client_tickets`, fiches, publications : rien ne bouge.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Qui lit le plan de charge.
--
-- Une fonction dédiée plutôt que `is_producer()` : celle-ci sert dans des
-- politiques d'*écriture* (tickets, shootings). Y ajouter un rôle demain pour
-- une raison d'écriture élargirait en silence la lecture de la production.
-- Même liste de rôles peut-être, deux intentions, deux fonctions.
--
-- Même liste que le garde-fou de `production_assignees()` : toute l'équipe
-- interne, observateur compris — son compte est en lecture seule par nature, et
-- /production lui est déjà ouvert. Le commercial en est exclu nommément : il
-- n'a aucune politique sur cette table, et `denyCommercial()` le renvoie
-- ailleurs.
-- -----------------------------------------------------------------------------
create or replace function is_production_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select current_role_is(array[
    'super_admin', 'production_manager', 'community_manager',
    'graphic_designer', 'video_editor', 'observer'
  ]::app_role[]);
$$;

comment on function is_production_reader() is
  'Équipe interne qui consulte le plan de charge de la production. Lecture seule : ne jamais employer dans une politique d''écriture.';

revoke execute on function is_production_reader() from public, anon;
grant execute on function is_production_reader() to authenticated;

create policy production_requests_select_equipe on production_requests
  for select to authenticated using (is_production_reader());

comment on policy production_requests_select_equipe on production_requests is
  'Lecture du plan de charge par toute l''équipe. Additive : l''écriture reste bornée par production_requests_write (can_access_client).';

-- -----------------------------------------------------------------------------
-- Nommer les clients de la file, et rien de plus.
--
-- Sans nom de client, une commande élargie s'affiche « Client » et la liste
-- devient inutilisable. On ne rend donc que (id, name), et seulement pour les
-- clients qui ont au moins une commande. Un lecteur qui n'est pas de l'équipe
-- de production n'y gagne rien : il retrouve exactement ce que `clients_select`
-- lui montre déjà.
-- -----------------------------------------------------------------------------
create or replace function production_request_clients()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name
    from clients c
   where exists (select 1 from production_requests r where r.client_id = c.id)
     and (is_production_reader() or can_access_client(c.id))
   order by c.name;
$$;

comment on function production_request_clients() is
  'Identifiant et nom des clients ayant au moins une commande de production. Rien d''autre ne sort de la table clients.';

revoke execute on function production_request_clients() from public, anon;
grant execute on function production_request_clients() to authenticated;

-- `revoke all on production_requests from anon` et le retrait de TRUNCATE sont
-- déjà posés par 20260918140000 : rien à refaire ici.
