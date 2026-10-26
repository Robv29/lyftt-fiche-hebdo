-- =============================================================================
-- Conseils de la semaine : un seul diagnostic, le complet, pour tout le monde.
--
-- Mis en service ce matin (20261026130000_conseils_hebdo.sql), le diagnostic
-- écrivait deux lignes par semaine. Deux des neuf mesures du score — « Dossiers
-- budget complets » et « Shootings catégorisés » — se calculent sur
-- client_budget_lines, table réservée à la direction : sans elles les poids des
-- piliers se redistribuent et la note change (81 pour l'équipe, 78 pour la
-- direction sur les données du jour), et les deux conseils qui en découlent ne
-- partaient qu'à la direction.
--
-- Le propriétaire a tranché l'inverse : tout le monde lit le diagnostic
-- complet. Une ligne par semaine, le jeu de règles entier, et la note qui
-- contient les mesures budgétaires — c'est-à-dire la note que les conseils
-- affichés peuvent effectivement faire bouger. Partager les deux conseils en
-- gardant la note de l'équipe aurait posé une pastille « +4 pts » sur une
-- mesure absente de la note affichée : un mensonge arithmétique, pas un
-- arrondi.
--
-- ----------------------------------------------------------------------------
-- CE QUI NE CHANGE PAS, et il faut le dire précisément
--
--   • AUCUN MONTANT NE SE PARTAGE. Les deux conseils tirés du budget ne portent
--     que des comptes et des identifiants de dossiers : « n shootings tournés
--     attendent leur classement », « n des m dossiers gérés sont en défaut sur
--     leur fiche budget — enveloppe dépassée, rythme intenable ou dates
--     manquantes ». Les règles lisent un nombre de lignes et une liste
--     d'identifiants (budgetIssueClientIds, unclassifiedShootings) ; aucune ne
--     sélectionne unit_price_cents, budget_cents ni aucune autre colonne de
--     prix, et la note n'est qu'un pourcentage. La colonne `advices` reste donc
--     ce qu'elle était : des phrases, des comptes, des identifiants.
--   • client_budgets, client_budget_lines, client_invoices, shootings : aucune
--     politique touchée. Lire un conseil qui dit « 4 dossiers en défaut » ne
--     donne pas le droit d'ouvrir une fiche budget, et le droit de CLASSER un
--     shooting — compris au forfait ou vendu en plus — reste à la direction. Le
--     conseil envoie sur l'onglet Shootings ; il ne l'ouvre à personne.
--   • Les noms de clients restent résolus à l'affichage, sous la RLS de celui
--     qui lit : la ligne ne porte que des identifiants, et ce qu'un community
--     manager ne peut pas résoudre se replie sur « et n autres dossiers ».
--   • Le commercial reste dehors. Il n'est dans aucune liste de rôles ici, il
--     ne produit rien, sa navigation ne propose que la carte et les fiches
--     clients, et denyCommercial() le renvoie ailleurs sur les écrans internes.
--   • La pastille rouge de la navigation reste à la direction (super_admin).
--   • weekly_advice_views n'est pas touchée : les « déjà vu » sont clés par
--     (iso_year, iso_week, profile_id), jamais par audience. Personne ne reverra
--     la pop-up de la semaine 2026-44 pour l'avoir déjà fermée ce matin.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. Réconcilier les lignes déjà écrites
--
-- La semaine 2026-44 est déjà en base, en deux lignes, et a déjà pu être lue.
-- On garde la complète ('direction') et on supprime l'amputée ('equipe') :
-- promouvoir l'autre aurait conservé une note (81) sans les deux mesures que
-- deux de ses conseils réclament.
--
-- La condition d'existence couvre le cas où une seule des deux lignes aurait
-- été écrite : elle est alors promue telle quelle à l'étape suivante, plutôt que
-- de laisser une semaine sans diagnostic. Après cette suppression, il reste au
-- plus une ligne par semaine, donc la mise à jour qui suit ne peut pas violer
-- l'unicité.
-- ----------------------------------------------------------------------------
delete from weekly_advice as partielle
where partielle.audience = 'equipe'
  and exists (
    select 1 from weekly_advice as entiere
    where entiere.iso_year = partielle.iso_year
      and entiere.iso_week = partielle.iso_week
      and entiere.audience = 'direction'
  );

-- ----------------------------------------------------------------------------
-- 2. Une seule valeur d'audience
--
-- La colonne survit avec une valeur unique, 'agence'. Elle porte la moitié de
-- la clé d'unicité (iso_year, iso_week, audience), sur laquelle reposent la
-- réservation du lundi et les deux écritures `onConflict` — la tâche planifiée
-- et le bouton de la direction. La retirer aurait demandé de refaire l'index et
-- de toucher les deux écritures pour ne rien gagner.
--
-- La contrainte est reposée plutôt que supprimée : elle dit à la lecture
-- suivante qu'il n'y a plus qu'un public, et refuse une ligne 'direction'
-- réécrite par mégarde par une version antérieure du code.
-- ----------------------------------------------------------------------------
alter table weekly_advice drop constraint weekly_advice_audience_check;

update weekly_advice set audience = 'agence' where audience <> 'agence';

alter table weekly_advice
  /*
   * Les deux anciennes valeurs restent acceptées : le schéma part avant le
   * code et peut survivre à un retour arrière, qui réécrirait une ligne
   * « equipe » ou « direction ». Un diagnostic que toute l'équipe rate pendant
   * une semaine coûte plus cher qu'une ligne jamais lue. Elles seront
   * refusées par une migration de suite, une fois le déploiement tenu.
   */
  add constraint weekly_advice_audience_check check (audience in ('agence', 'equipe', 'direction'));

comment on table weekly_advice is
  'Diagnostic hebdomadaire de l''agence : une ligne par semaine ISO, lue par toute l''équipe interne. Aucun montant, aucun nom de client.';

comment on column weekly_advice.audience is
  'Toujours « agence » : un seul diagnostic pour tous. Conservée parce qu''elle porte la clé d''unicité (iso_year, iso_week, audience) sur laquelle repose la réservation du lundi.';

comment on column weekly_advice.score is
  'La note complète, mesures budgétaires comprises — celle que les conseils stockés peuvent faire bouger. Elle dépasse donc de un à trois points celle qu''un rôle sans accès au budget lit sur son propre tableau de bord : l''écart est dit à l''écran (« Note de l''agence »), parce que deux des conseils portent précisément sur ces mesures.';

-- ----------------------------------------------------------------------------
-- 3. Qui lit la ligne de la semaine
--
-- Les trois rôles qui produisent, et eux seuls — la même liste que
-- EDITORIAL_ROLES côté application, qui évite déjà un aller-retour inutile aux
-- comptes que cette politique laisserait les mains vides.
--
-- Le partage reste au niveau de la LIGNE et non de la colonne : tous les
-- comptes de l'application sont un seul rôle Postgres, `authenticated`, donc un
-- grant par colonne n'y changerait rien. Il n'y a plus rien à borner dans la
-- ligne — elle ne porte ni montant, ni nom, ni client_id lisible sans RLS.
-- ----------------------------------------------------------------------------
drop policy weekly_advice_select on weekly_advice;

create policy weekly_advice_select on weekly_advice
  for select to authenticated
  using (current_role_is(array['super_admin', 'production_manager', 'community_manager']::app_role[]));
