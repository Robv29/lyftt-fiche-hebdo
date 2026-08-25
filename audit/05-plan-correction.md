# Plan de correction

Corrections triées par priorité.

> **État au 25 août 2026 :** le **lot 1** et le **lot 2** sont appliqués et déployés
> (`F-01` à `F-05`), à l'exception de `F-05` traité autrement que prévu — par `overrides`
> de `postcss` et `sharp` plutôt que par une montée en Next 16, les CVE se trouvant dans
> ces bibliothèques et non dans le framework. Les lots 3 et 4 restent ouverts, ainsi que
> les mentions légales.

Ordre d'exécution recommandé : lot 1 (critique) → lot 2 (élevé) → lot 3 (moyen) →
lot 4 (conformité). Après chaque lot : `npm run typecheck`, `npm run lint`,
`npm run test`, plus les tests de non-régression de `06-tests-regression.md`.

---

## Lot 1 — Critique (sous 24 h)

### F-01 · Bloquer l'auto-promotion de rôle (`C-01`)

- **Fichiers :** nouvelle migration `supabase/migrations/<horodatage>_lock_profile_role.sql`
- **Charge :** 1 h (dont vérification préalable)
- **Dépendances :** aucune
- **Attention :** vérifier **avant** correction qu'aucun rôle n'a déjà été modifié
  anormalement (requête `A-01` en `06-tests-regression.md`). Cette vérification d'abord,
  le correctif ensuite.

```sql
-- 1) Privilèges de colonne : ne laisser modifiable que ce qui relève du profil
revoke update on public.profiles from authenticated;
grant  update (full_name, phone, avatar_url) on public.profiles to authenticated;
revoke update on public.profiles from anon;   -- défense en profondeur

-- 2) Filet de sécurité indépendant des GRANT
create or replace function profiles_block_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active) then
    raise exception 'Modification du rôle ou de l''activation interdite';
  end if;
  return new;
end;
$$;

create trigger profiles_no_self_promotion
  before update on public.profiles
  for each row execute function profiles_block_privilege_escalation();
```

**Critères d'acceptation**

- Un compte non-`super_admin` qui tente `PATCH /rest/v1/profiles` avec `{"role":"super_admin"}`
  reçoit une erreur ; son rôle est inchangé.
- Le même compte peut toujours modifier `full_name`, `phone`, `avatar_url`.
- `changeMemberRole()` et `setMemberActive()` (service_role, `requireSuperAdmin`)
  fonctionnent toujours — à vérifier explicitement, c'est le risque de régression du lot.
- `npm run test` et `npm run build` passent.

---

## Lot 2 — Élevé (sous 7 jours)

### F-02 · Restreindre la mise à jour des tickets (`H-01`)

- **Fichiers :** nouvelle migration ; vérifier `src/lib/internal/actions.ts` (`transitionTicket`)
- **Charge :** 3 h · **Dépendances :** aucune

Deux couches : interdire le changement de `client_id` par trigger, et restreindre les
transitions accessibles à un contributeur non éditorial (un graphiste ne doit pas pouvoir
écrire `approved_by_client`).

**Critères d'acceptation :** un contributeur affecté peut faire avancer un ticket sur les
statuts de production ; il ne peut ni le passer en `approved_by_client`, ni changer
`client_id`. Le parcours de correction complet reste fonctionnel de bout en bout.

### F-03 · Supprimer la route de diagnostic et la page de test (`M-01`, `L-01`)

- **Fichiers :** supprimer `src/app/api/diagnostic/`, `src/app/test-clic/` ;
  retirer `test-clic` du `matcher` de `src/middleware.ts:104`
- **Charge :** 15 min · **Dépendances :** aucune

**Critères d'acceptation :** les deux routes renvoient 404 ; le reste de l'application
est inchangé. (Les deux fichiers portent déjà la mention « temporaire ».)

### F-04 · Magasin de limitation de débit partagé (`H-03`)

- **Fichiers :** `src/lib/security/rate-limit.ts` (+ nouveau `RateLimitStore`)
- **Charge :** 4 h · **Dépendances :** provisionner Upstash Redis, ou table Postgres

L'interface `RateLimitStore` existe déjà : seule une nouvelle implémentation est à écrire,
`MemoryRateLimitStore` restant pour les tests.

**Critères d'acceptation :** le compteur survit à un redémarrage et est partagé entre
instances ; les tests existants passent avec le magasin mémoire.

### F-05 · Montée de version Next.js (`H-02`)

- **Fichiers :** `package.json`, `package-lock.json`, ajustements d'API éventuels
- **Charge :** 4 h à 2 j (changement majeur, incertitude réelle)
- **Dépendances :** faire après F-01 à F-04 — ne pas mêler un correctif critique à une
  migration de framework

**Critères d'acceptation :** `npm audit --omit=dev` ne signale plus de vulnérabilité haute ;
`npm run build` passe ; parcours critiques vérifiés (connexion, planning, fiche, portail
client, envoi de lien).

---

## Lot 3 — Moyen (sous 30 jours)

### F-06 · En-têtes de sécurité globaux (`M-02`)

- **Fichiers :** `next.config.ts` · **Charge :** 3 h (CSP à ajuster)

Étendre le bloc `headers()` à `/:path*` : `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`,
et une `Content-Security-Policy`. Déployer la CSP en **`Content-Security-Policy-Report-Only`
d'abord** — Next.js injecte des scripts en ligne, une CSP stricte posée d'emblée casserait
l'application.

**Critères d'acceptation :** en-têtes présents sur toutes les routes ; aucune violation
CSP en `report-only` pendant 7 jours avant bascule en mode bloquant.

### F-07 · Révocation de session à la désactivation (`M-03`)

- **Fichiers :** `src/app/(internal)/utilisateurs/actions.ts`, `src/middleware.ts`
- **Charge :** 2 h

`setMemberActive(false)` doit appeler `supabase.auth.admin.signOut(profileId)` ;
le middleware doit rejeter un utilisateur dont le profil est inactif.

**Critères d'acceptation :** un compte désactivé est déconnecté immédiatement et ne peut
plus lire l'API REST avec son ancien JWT.

### F-08 · Durcissement de l'authentification (`M-04`)

- **Charge :** 1 h (configuration Supabase, pas de code)

Activer la protection contre les mots de passe compromis (HIBP), fixer une politique de
complexité, activer la MFA au moins pour les `super_admin`.

### F-09 · Sauvegarde et preuve de validation avant purge (`M-06`)

- **Fichiers :** `src/app/api/maintenance/purge-media/route.ts` · **Charge :** 1 j

Vérifier la politique de sauvegarde Supabase (PITR) ; archiver les preuves de validation
(qui, quoi, quand) **avant** la suppression en cascade ; ajouter une limitation de débit
sur l'endpoint. Voir aussi `03-rgpd-cookies.md` §3 : la durée de 14 jours est à revoir
au regard de la prescription commerciale.

### F-10 · Affectations de tickets (`M-05`)

- **Charge :** 1 h après vérification `T-05`

Restreindre `client_ticket_assignments_write` à `is_staff_lead()`, quelle que soit
l'issue du test — l'écriture d'affectations n'a pas de raison d'être ouverte aux
contributeurs.

### F-11 · Corriger la documentation de `admin.ts` et outiller la règle (`M-07`)

- **Fichiers :** `src/lib/supabase/admin.ts`, nouveau test `T-06` · **Charge :** 2 h

Le commentaire actuel (« réservé au portail client ») est faux et trompeur pour la
prochaine personne qui écrira une action. Le corriger, et ajouter le test automatisé
qui détecte une action `"use server"` utilisant le service_role sans garde.

### F-12 · Protection de branche (`I-01`)

- **Charge :** 30 min (configuration GitHub)

Protéger `main` : revue obligatoire, exécution de `typecheck`, `lint`, `test` et
`npm audit` avant fusion.

---

## Lot 4 — Conformité (sous 30 à 60 jours)

| # | Action | Charge | Dépendances |
|---|---|---|---|
| F-13 | Mentions légales (art. 6-III LCEN) | 2 h | Informations société (§5 de `04-…`) |
| F-14 | Politique de confidentialité complète | 1 j | Registre des traitements |
| F-15 | Registre des traitements (art. 30) | 1 j | — |
| F-16 | Signature des DPA (Vercel, Supabase, Resend) | 2 j | — |
| F-17 | Clause de PI et cession de droits | — | **Juriste** |
| F-18 | Encadrement du droit à l'image | 1 j | **Juriste** |
| F-19 | Table `document_acceptances` + parcours d'acceptation | 1 j | F-13, F-14 |
| F-20 | Alignement des durées de conservation | 1 j | F-09 |
| F-21 | Outillage des droits des personnes (accès, effacement, portabilité) | 3 j | F-15 |
| F-22 | Journal d'audit des actions d'administration | 2 j | — |
| F-23 | Procédure de violation de données < 72 h | 1 j | — |

---

## Recommandation de séquencement

**F-01 seul, en premier, déployé isolément.** C'est une migration courte dont l'effet doit
être vérifié sans être mêlé à d'autres changements — et la seule dont l'absence justifie
de retarder toute ouverture de nouveaux comptes.

Ne pas grouper F-05 (montée de Next.js) avec le reste : c'est le seul lot au périmètre
incertain, et le mélanger brouillerait le diagnostic en cas de régression.
