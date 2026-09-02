-- =============================================================================
-- Transmission client — parcours de validation en trois étapes
--
-- La carte ne disait que « à traiter » ou « traitée ». Entre les deux, il se
-- passe pourtant trois choses distinctes, dont aucune n'était datée :
--   1. le chef de projet relit le menu composé par le client, et le corrige ;
--   2. il envoie au client le récapitulatif de son accompagnement ;
--   3. il crée le vrai dossier client.
-- Chaque étape reçoit donc son horodatage, seule façon de savoir d'un coup
-- d'œil ce qui reste à faire sur une fiche — et de le prouver plus tard.
--
-- POURQUOI DEUX COLONNES DE MENU
-- ------------------------------
-- Le CRM renvoie la fiche à chaque modification du dossier commercial, et
-- l'upsert de /api/crm/transmission réécrit `fiche_mission`. Si la correction
-- de Théo vivait dans cette colonne, une simple retouche du numéro de
-- téléphone dans le CRM l'effacerait — sans que personne ne s'en aperçoive,
-- puisque le menu réapparaîtrait plausible.
--
-- `fiche_mission` reste donc la parole du CRM, écrite par lui seul, et
-- `menu_corrige` celle de la production. L'affichage privilégie la seconde
-- quand elle existe. Aucune des deux ne peut écraser l'autre, et la version
-- d'origine reste consultable — c'est elle qui fait foi si le client conteste.
-- =============================================================================

alter table client_transmissions
  -- Menu relu et corrigé par le chef de projet. Null tant qu'il n'a rien
  -- changé : on retombe alors sur le CRM, et ses mises à jour continuent de
  -- passer. Le remettre à null revient à « reprendre le menu du CRM ».
  add column if not exists menu_corrige         text,
  -- Étape 1 : le menu a été relu et validé. Redaté à chaque revalidation.
  add column if not exists menu_valide_le       timestamptz,
  add column if not exists menu_valide_par      uuid references profiles (id) on delete set null,
  -- Étape 2 : le récapitulatif est parti chez le client.
  add column if not exists recap_envoye_le      timestamptz,
  add column if not exists recap_envoye_par     uuid references profiles (id) on delete set null,
  -- Adresse réellement servie : le contact du CRM peut changer après coup, et
  -- « à qui est-ce parti » est la première question posée quand un client dit
  -- n'avoir rien reçu.
  add column if not exists recap_envoye_a       text,
  -- Dernière fois que le CRM a transmis un menu *différent*. Sans elle, une
  -- correction de Théo masquerait silencieusement une vraie évolution de la
  -- commande : l'écran peut désormais signaler « le CRM a renvoyé un menu
  -- depuis votre relecture ».
  add column if not exists fiche_mission_maj_le timestamptz;

comment on column client_transmissions.fiche_mission is
  'Menu tel que le CRM l''a transmis. Réécrit à chaque envoi du CRM, jamais par la production.';
comment on column client_transmissions.menu_corrige is
  'Menu corrigé par le chef de projet. Prime sur fiche_mission à l''affichage ; null = on suit le CRM.';
comment on column client_transmissions.fiche_mission_maj_le is
  'Horodatage du dernier menu réellement différent reçu du CRM, pour signaler une divergence après relecture.';

-- Le trigger, plutôt que la route webhook : la datation doit tenir quel que
-- soit le chemin d'écriture — upsert du CRM, rattrapage manuel, correction en
-- base. Une règle posée à un seul endroit ne se contourne pas par mégarde.
create or replace function client_transmissions_track_fiche_mission() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.fiche_mission is not null then
      new.fiche_mission_maj_le := now();
    end if;
  elsif new.fiche_mission is distinct from old.fiche_mission then
    new.fiche_mission_maj_le := now();
  end if;
  return new;
end;
$$;

alter function client_transmissions_track_fiche_mission() set search_path = public;

comment on function client_transmissions_track_fiche_mission() is
  'Date les seuls changements réels du menu venu du CRM (un renvoi à l''identique ne compte pas).';

drop trigger if exists client_transmissions_track_fiche_mission on client_transmissions;
create trigger client_transmissions_track_fiche_mission
  before insert or update on client_transmissions
  for each row execute function client_transmissions_track_fiche_mission();

-- L'écran trie par avancement : d'abord ce que personne n'a encore regardé.
-- `nulls first` est l'ordre naturel de Postgres en ascendant, donc l'index
-- couvre le tri tel que la page le demande.
create index if not exists client_transmissions_avancement_idx
  on client_transmissions (menu_valide_le, recap_envoye_le, menu_compose_le desc)
  where statut in ('a_traiter', 'traite');

-- RLS : rien à ajouter. `client_transmissions_select` (toute l'équipe active)
-- et `client_transmissions_write` (rôles éditoriaux) portent sur la table
-- entière, donc sur ces colonnes. Les redéclarer ici reviendrait à dupliquer
-- la règle, et à la voir diverger au premier ajustement.

-- Rattrapage des fiches déjà en base : sans cela, une fiche transmise avant
-- cette migration passerait pour « menu jamais reçu » et le signalement de
-- divergence se déclencherait à tort au premier renvoi du CRM.
update client_transmissions
   set fiche_mission_maj_le = coalesce(menu_compose_le, created_at)
 where fiche_mission is not null and fiche_mission_maj_le is null;
