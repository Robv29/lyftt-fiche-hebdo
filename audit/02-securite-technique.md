# Constats de sécurité technique

Chaque constat est étayé par un chemin de fichier, une configuration mesurée, ou une
requête de vérification non destructive. Les points non vérifiables depuis le code sont
explicitement marqués **« À confirmer »**.

## Tableau de synthèse

| ID | Constat | Gravité | Confiance | Impact | Fichier / Flux | Correction | Priorité |
|---|---|---:|---:|---|---|---|---:|
| C-01 | ✅ **CORRIGÉ 24/08** — Auto-promotion au rôle `super_admin` | ~~Critique~~ | Vérifié | Compromission totale | `20260824190000_lock_profile_role.sql` | Appliquée | — |
| H-01 | ✅ **CORRIGÉ 25/08** — Falsification du statut d'un ticket | ~~Élevé~~ | Vérifié | Preuve contractuelle corrompue | `20260825090000_lock_ticket_transitions.sql` | Appliquée | — |
| H-02 | ✅ **CORRIGÉ 25/08** — 4 CVE hautes (`sharp`, `postcss`) | ~~Élevé~~ | Vérifié | Lecture de fichiers / DoS | `package.json` | Overrides, sans Next 16 | — |
| H-03 | ✅ **CORRIGÉ 25/08** — Limitation de débit inopérante en serverless | ~~Élevé~~ | Vérifié | Force brute du portail | `20260825100000_shared_rate_limit.sql` | Magasin en base | — |
| M-01 | ✅ **CORRIGÉ 25/08** — `/api/diagnostic` public | ~~Moyen~~ | Vérifié | Reconnaissance | Route supprimée | Appliquée | — |
| M-02 | Absence de CSP, HSTS et en-têtes globaux | Moyen | Confirmée | XSS non contenue | `next.config.ts:9` | Ajouter en-têtes | 5 |
| M-03 | Session maintenue après désactivation du compte | Moyen | Confirmée | Accès résiduel | `src/middleware.ts:60` | Vérifier `is_active` | 6 |
| M-04 | Mots de passe compromis autorisés, pas de MFA | Moyen | Confirmée | Prise de compte | Config Supabase Auth | Activer HIBP + MFA | 5 |
| M-05 | Auto-affectation possible sur un ticket (RLS récursive) | Moyen | **À confirmer** | Contournement de cloisonnement | `20260803090200_rls.sql:178` | Restreindre écriture | 6 |
| M-06 | Suppression planifiée irréversible des fiches (> 14 j) | Moyen | Confirmée (code) | Perte de données et de preuve | `purge-media/route.ts` | Sauvegarde + revue | 4 |
| M-07 | `service_role` utilisé bien au-delà du périmètre documenté | Moyen | Confirmée | Risque d'erreur future | `src/lib/supabase/admin.ts` | Corriger doc + revue | 7 |
| L-01 | ✅ **CORRIGÉ 25/08** — Page `/test-clic` publique | ~~Faible~~ | Vérifié | Surface inutile | Page supprimée | Appliquée | — |
| L-02 | Comparaison non constante du `CRON_SECRET` | Faible | Confirmée | Théorique | `purge-media/route.ts:47` | `timingSafeEqual` | 8 |
| L-03 | Extension `citext` dans le schéma `public` | Faible | Confirmée | Défense en profondeur | Linter Supabase | Déplacer | 9 |
| I-01 | Absence de protection de branche et de revue | Info | Confirmée | Qualité | Dépôt Git | Protéger `main` | 7 |

---

## C-01 — Élévation verticale de privilèges : tout compte d'équipe peut devenir `super_admin`

> ## ✅ CORRIGÉ le 24 août 2026
>
> Migration `supabase/migrations/20260824190000_lock_profile_role.sql`, appliquée en
> production après accord explicite. **Vérification préalable d'exploitation : négative**
> (voir « Résultat de la vérification A-01 » plus bas). Tests de non-régression : voir
> « Vérification post-correction » en fin de section.
>
> Le constat est conservé intégralement ci-dessous : il documente la cause racine et
> sert de référence si la policy venait à être réécrite.

- **Domaine :** autorisation / RLS
- **Gravité initiale : CRITIQUE** — **Confiance : confirmée** (état mesuré en base de production)
- **Composant :** table `public.profiles`, policy `profiles_update_self`

### Preuve

Trois faits mesurés en production, dont la conjonction suffit à établir la vulnérabilité :

**1. La policy ne filtre que la ligne, pas les colonnes** (`pg_policies`) :

```
profiles_update_self | UPDATE | roles=authenticated
  using = (id = auth.uid())
  check = (id = auth.uid())
```

**2. Le rôle `authenticated` détient `UPDATE` sur les colonnes sensibles**
(`information_schema.column_privileges`) :

```
authenticated | UPDATE | role
authenticated | UPDATE | is_active
```

**3. Aucun garde-fou** : le seul trigger sur `profiles` est
`profiles_set_updated_at BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at()`,
qui ne contrôle rien. Aucune contrainte `CHECK`, aucun `REVOKE` de colonne.

Source dans le dépôt : `supabase/migrations/20260803090200_rls.sql:83-85`, et
définition de la colonne `role app_role not null` en `20260803090000_base.sql`.

### Scénario d'exploitation

PostgreSQL **n'applique pas la RLS colonne par colonne** : une policy `FOR UPDATE`
dont le `WITH CHECK` ne porte que sur l'identité de la ligne autorise la modification
de **toutes** les colonnes de cette ligne.

Un utilisateur disposant du rôle le plus faible (`video_editor`, `graphic_designer`)
possède un JWT valide et la clé `anon` — publique par conception, présente dans le
bundle JavaScript. Il lui suffit d'un appel direct à l'API REST Supabase, **sans passer
par l'interface** :

```
PATCH /rest/v1/profiles?id=eq.<son_propre_uuid>
Authorization: Bearer <son_JWT>
apikey: <clé anon publique>
Content-Type: application/json

{"role": "super_admin"}
```

La policy est satisfaite (`id = auth.uid()`), le privilège de colonne est accordé,
aucun trigger ne s'y oppose : la mise à jour aboutit.

> **Cette requête n'a pas été exécutée.** Elle modifierait des données réelles en
> production. La preuve documentaire ci-dessus est suffisante et concluante ;
> une confirmation dynamique devra se faire sur un environnement de test dédié
> (protocole en `06-tests-regression.md`).

### Impact

- **Technique :** contrôle total de l'application. `super_admin` ouvre l'accès au module
  budget (chiffre d'affaires, **RIB des clients**), à la gestion des comptes (création,
  suppression, changement de rôle d'autrui), et à la **suppression définitive de clients**
  avec toutes leurs données (`deleteClient`).
- **Métier :** un prestataire externe (graphiste, monteur — profils typiquement les moins
  contrôlés, parfois freelances) accède aux données bancaires et financières de tous les
  clients de l'agence, et peut détruire l'historique. Un départ conflictuel suffit à
  transformer ce défaut en incident majeur.
- **Données concernées :** RIB, budgets, factures, contacts clients, l'intégralité des
  contenus éditoriaux, comptes de l'équipe.
- **RGPD :** manquement à l'art. 32 (sécurité du traitement) ; un accès non autorisé
  effectif constituerait une violation de données à notifier sous 72 h (art. 33).

### Cause racine

Hypothèse erronée sur le fonctionnement de la RLS PostgreSQL : la policy a été écrite
pour signifier « chacun modifie son profil » (nom, téléphone, avatar), sans réaliser que
la portée s'étend à `role` et `is_active`. Le défaut est **de conception, pas d'inattention** :
rien dans le code applicatif ne le laisse deviner, et l'interface n'expose évidemment pas
cette possibilité — ce qui illustre qu'un contrôle présent uniquement dans l'IHM n'est
pas un contrôle.

### Correction recommandée

Deux couches, à appliquer ensemble (défense en profondeur) :

```sql
-- 1) Retirer le privilège au niveau colonne
revoke update on public.profiles from authenticated;
grant  update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- 2) Filet de sécurité : rejeter toute tentative, même si un GRANT réapparaît
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

`auth.uid()` est nul lorsque la requête vient du client `service_role` : les actions
légitimes de `src/app/(internal)/utilisateurs/actions.ts` (déjà gardées par
`requireSuperAdmin()`) continuent de fonctionner.

- **Difficulté :** faible (une migration, ~20 lignes) — **Priorité : 1 (immédiate)**
- **Vérification :** voir `T-01` en `06-tests-regression.md`.

### Résultat de la vérification A-01 (exécutée avant correction)

**Aucun signe d'exploitation.** Constat rassurant, et instructif sur la portée réelle :

| Vérification | Résultat |
|---|---|
| Répartition des rôles | 4 profils : **2 `super_admin`, 2 `production_manager`** |
| Comptes à faible privilège (`graphic_designer`, `video_editor`) | **Aucun** |
| Profils modifiés après création | 2, datés des 4 et 5 août 2026 |

Les deux modifications remontent à la mise en place initiale du projet (l'une porte un
identifiant en `33333333`, caractéristique d'un jeu de données de départ) et sont
cohérentes avec du paramétrage, non avec une exploitation.

**Point important :** la vulnérabilité était **exploitable en théorie mais sans porteur
en pratique** — aucun compte à faible privilège n'existait encore. C'est précisément ce
qui rendait la correction urgente : elle devait être posée **avant** la création du
premier compte graphiste ou monteur, population la plus concernée et souvent externe.

*Limite de cette vérification :* `updated_at` signale qu'une modification a eu lieu, pas
son auteur ni son contenu. En l'absence de journal d'audit (`F-22`), il n'est pas
possible d'aller plus loin rétrospectivement.

### Vérification post-correction

État mesuré après application de la migration :

- `authenticated` ne conserve `UPDATE` que sur `full_name`, `phone`, `avatar_url` ;
- `anon` n'a plus aucun privilège `UPDATE` sur `profiles` ;
- le trigger `profiles_no_self_promotion` est actif (`pg_trigger`).

Trois scénarios testés en base, **toutes les écritures annulées** par savepoint PL/pgSQL
(aucune donnée modifiée — répartition des rôles identique avant et après) :

| Scénario | Attendu | Résultat |
|---|---|---|
| Service-role change un rôle (`changeMemberRole`) | Autorisé | ✅ Autorisé |
| Utilisateur authentifié change son propre rôle | Bloqué | ✅ Bloqué |
| Utilisateur authentifié modifie son nom | Autorisé | ✅ Autorisé |

Complété par : `tsc --noEmit` sans erreur, **340 tests unitaires passants**.

Le deuxième scénario est celui qui établit la fermeture de la faille ; le premier et le
troisième établissent l'absence de régression — c'était le risque principal du correctif.

---

## H-01 — Falsification du statut d'un ticket, y compris la validation client

> ## ✅ CORRIGÉ le 25 août 2026
>
> Migration `supabase/migrations/20260825090000_lock_ticket_transitions.sql`, appliquée
> en production. Un trigger interdit, **aux seules requêtes faites au nom d'un utilisateur
> authentifié** (`auth.uid()` non nul), le changement de `client_id` ainsi que l'entrée
> dans `approved_by_client` **comme la sortie** — retirer une validation acquise corrompt
> la preuve autant que d'en fabriquer une.
>
> Aucun parcours applicatif n'est touché : toutes les écritures de statut passent par la
> clé service-role (`createSupabaseAdminClient`), pour laquelle `auth.uid()` est nul.
>
> Le constat est conservé ci-dessous : il documente la cause racine.

- **Gravité initiale : Élevé** — **Confiance : confirmée** (mesurée en base)
- **Composant :** policy `client_tickets_update`

### Preuve

```
client_tickets_update | UPDATE | using = can_access_ticket(id) | check = can_access_ticket(id)
```

`can_access_ticket()` renvoie vrai si l'utilisateur a accès au client **ou s'il est
affecté au ticket** (`20260803090200_rls.sql:60-70`). Aucune restriction de colonne ni
de transition d'état.

### Scénario

Un graphiste affecté à un ticket peut, par appel direct à l'API REST :

- passer le ticket en `approved_by_client` — **sans que le client ait validé quoi que ce
  soit**. Or ce statut est la trace de la validation contractuelle, et il conditionne le
  recalcul du statut de la fiche (`recompute_sheet_status`) ;
- modifier `client_id` et déplacer le ticket vers un autre client, y compris hors de son
  périmètre.

Le commentaire du code annonce pourtant l'intention inverse : *« la création et la clôture
restent à l'encadrement éditorial »* (`20260803090200_rls.sql:168-169`). L'intention n'est
pas traduite dans la policy — illustration du principe « présence d'un mécanisme ≠ efficacité ».

### Impact

Corruption de la preuve de validation client, sur laquelle repose le cycle contractuel
(§16 du projet : validation explicite ou tacite). Une fiche pourrait être réputée validée
sans l'avoir été, avec les conséquences commerciales et juridiques associées.

### Correction

Interdire la modification de `client_id`, et restreindre les statuts accessibles à un
contributeur non éditorial via un trigger de transition, ou séparer la policy en deux
(`using` distinct pour l'encadrement et pour les contributeurs affectés).

- **Difficulté :** moyenne — **Priorité : 2**

---

## H-02 — Dépendances vulnérables (4 CVE de gravité haute)

> ## ✅ CORRIGÉ le 25 août 2026
>
> `npm audit --omit=dev` ne signale plus **aucune** vulnérabilité.
>
> Correctif retenu : `postcss` monté en 8.5.26 et `sharp` en 0.35.3 par `overrides`,
> **sans passer à Next 16**. Les CVE sont dans ces deux bibliothèques, pas dans Next :
> un saut majeur de framework aurait ajouté un risque de régression sans rien corriger
> de plus. `npm run build` passe, `next/image` compris.
>
> **Réponse à la question B-8, restée ouverte à l'audit** — *un fichier déposé par un
> client atteint-il `sharp` ?* **Non.** Aucun `remotePatterns` n'est configuré dans
> `next.config.ts`, donc `next/image` ne peut optimiser aucune image distante ; et le
> seul composant affichant un média client (`PublicationChecklist.tsx:133`) porte
> l'attribut `unoptimized`. La gravité réelle de cette CVE pour ce projet était donc
> faible — ce que l'audit ne pouvait pas trancher sans cette vérification.
>
> Restent 5 vulnérabilités en dépendances de **développement** (`vite`, `vitest`), non
> déployées. Leur correctif impose une montée majeure de `vitest` : à traiter séparément.

- **Gravité initiale : Élevé** — **Confiance : confirmée** (`npm audit --omit=dev`)

### Preuve

```
sharp  <0.35.0 — Severity: high
  CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (libvips)
postcss — 3 avis : GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849
  (lecture de fichiers arbitraires via sourceMappingURL)
Chaîne : next 15.5.22 → sharp / postcss
Correctif : next@16.3.2 (changement majeur)
```

### Pertinence pour ce projet

`sharp`/libvips traite des images. L'application accepte des **téléversements d'images
et de vidéos par les clients finaux, sans authentification** (portail public,
`createTicket` avec pièces jointes). Les fichiers vont directement vers Supabase Storage,
ce qui limite l'exposition, mais l'optimisation d'images de Next.js peut faire transiter
des contenus par `sharp`. La question à trancher — **à confirmer** — est de savoir si un
fichier déposé par un client atteint `sharp` : si oui, la gravité monte nettement.

`checkAttachment()` (`src/lib/security/attachments.ts`) vérifie taille, type MIME **et
signature binaire** — bonne pratique qui réduit le risque sans l'annuler (un fichier
peut être un JPEG valide et malveillant pour libvips).

### Correction

Montée de version de Next.js, avec recette de non-régression. Vérifier en parallèle si
`next/image` est utilisé sur des sources distantes non fiables.

- **Difficulté :** moyenne (changement majeur) — **Priorité : 3**

---

## H-03 — Limitation de débit inopérante en production

> ## ✅ CORRIGÉ le 25 août 2026
>
> Migration `20260825100000_shared_rate_limit.sql` + réécriture de
> `src/lib/security/rate-limit.ts`. Le compteur vit désormais en base
> (`consume_rate_limit`), partagé entre instances et persistant au recyclage.
> L'atomicité vient d'un `insert … on conflict do update` sous verrou de ligne.
>
> `MemoryRateLimitStore` demeure pour les tests et le développement.
> Deux tests ont été ajoutés (`tests/unit/security.test.ts`) : relais fidèle de la
> décision de la base, et repli **passant** si la base est indisponible — sans base,
> l'application ne peut de toute façon rien servir, et un repli bloquant fermerait le
> portail aux clients légitimes pendant l'incident.
>
> **Un défaut a été trouvé et corrigé pendant la mise au point** : plafonner le compteur
> à `limite` rendait « pile à la limite » et « au-delà » indistinguables, si bien que
> plus rien n'était jamais refusé. Le plafond est à `limite + 1`. Vérifié en base :
> 3 appels passants, puis refus avec `retry_after` — et compteurs bien indépendants
> d'une clé à l'autre.

- **Gravité initiale : Élevé** — **Confiance : confirmée** (code + modèle d'exécution Vercel)
- **Composant :** `src/lib/security/rate-limit.ts:59` (`MemoryRateLimitStore`)

### Preuve

```ts
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
```

Le commentaire d'en-tête est explicite et honnête : *« Implémentation en mémoire,
suffisante pour un déploiement mono-instance. Sur plusieurs instances, remplacer le
magasin par Redis »*. Or le déploiement est **Vercel serverless** : chaque invocation
peut s'exécuter dans une instance distincte, et les instances sont recyclées en continu.
Le compteur n'est donc **jamais partagé ni durable**.

### Impact

Toutes les protections qui en dépendent sont largement contournables :

- `linkAccess` (30/min) et `invalidToken` (10/10 min) — **la protection contre le
  balayage de tokens du portail** ;
- `ticketCreation`, `approval`, `attachment` — protections contre l'abus applicatif.

L'entropie du token (256 bits) rend une force brute *hors de portée* même sans
limitation : le risque réel n'est donc pas la découverte d'un lien, mais l'**abus
applicatif** (inondation de tickets, dépôt massif de pièces jointes jusqu'à 10 Mo,
saturation du stockage et des coûts) une fois un lien légitime connu.

### Correction

Remplacer le magasin par Upstash Redis ou une table Postgres. L'interface
`RateLimitStore` est déjà conçue pour cette substitution — le refactor est minime.

- **Difficulté :** faible à moyenne — **Priorité : 4**

---

## M-01 — Route de diagnostic publique

> ## ✅ CORRIGÉ le 25 août 2026 — `src/app/api/diagnostic/` supprimée.
> La page `/test-clic` (`L-01`) l'a été également, et `test-clic` retiré du `matcher`
> de `src/middleware.ts`. Les deux portaient déjà la mention « temporaire ».

- **Gravité initiale : Moyen** — **Confiance : confirmée**
- **Composant :** `src/app/api/diagnostic/route.ts` (exclue du middleware, `force-dynamic`)

Accessible sans authentification, elle divulgue : le marqueur de build déployé, la
**présence ou l'absence de chaque variable d'environnement** (dont
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`), l'hôte Supabase, l'hôte
applicatif, et `cronSecretUtilisable` — qui indique si `CRON_SECRET` est exploitable.

Aucune valeur de secret n'est exposée (le code s'en garde soigneusement, et
`safeHost()` ne renvoie que le nom d'hôte). Il s'agit donc d'une **fuite d'informations
de reconnaissance**, pas d'une compromission : elle indique à un attaquant quelles
fonctions sont actives et quelles protections manquent.

Le fichier porte la mention *« À supprimer une fois le déploiement stabilisé »* :
il s'agit d'appliquer une intention déjà formulée.

- **Correction :** supprimer la route, ou exiger un en-tête d'authentification.
- **Difficulté :** triviale — **Priorité : 2**

---

## M-02 — Absence d'en-têtes de sécurité globaux

- **Gravité : Moyen** — **Confiance : confirmée**
- **Composant :** `next.config.ts:9-22`

Seul `/client-review/:path*` reçoit des en-têtes (`X-Robots-Tag`, `Referrer-Policy`,
`X-Content-Type-Options`, `X-Frame-Options`). **Tout le back-office en est dépourvu.**

Manquent, globalement :

- **`Content-Security-Policy`** — aucune, nulle part. C'est la défense de second rideau
  contre le XSS ; React échappe le rendu par défaut, mais une CSP contient l'exploitation
  si une faille apparaît (`dangerouslySetInnerHTML`, dépendance compromise).
- **`Strict-Transport-Security`** — absente (Vercel force HTTPS, mais HSTS protège du
  déclassement au premier contact).
- `X-Frame-Options` / `frame-ancestors` sur le back-office → **clickjacking possible**
  sur les écrans internes.
- `Permissions-Policy`.

- **Correction :** étendre le bloc `headers()` à `/:path*`, avec une CSP en
  `report-only` d'abord pour mesurer les régressions.
- **Difficulté :** faible (CSP à ajuster) — **Priorité : 5**

---

## M-03 — Session maintenue après désactivation d'un compte

- **Gravité : Moyen** — **Confiance : confirmée** (lecture de code)
- **Composant :** `src/middleware.ts:60`

Le middleware ne vérifie que l'existence d'un utilisateur :

```ts
if (!user && !request.nextUrl.pathname.startsWith("/login")) { ... redirect }
```

`is_active` n'est pas contrôlé. La désactivation via `setMemberActive(false)` met à jour
`profiles.is_active` mais **ne révoque pas la session Supabase** : le JWT reste valide
jusqu'à son expiration.

**Atténuation réelle et substantielle :** `getCurrentProfile()` filtre sur `is_active`
(`src/lib/supabase/server.ts`), et la fonction RLS `current_role_is()` exige
`is_active`. Les pages et les actions gardées refusent donc l'accès. Le risque résiduel
porte sur les chemins qui ne passent ni par l'une ni par l'autre, et sur la fenêtre
d'accès en lecture directe à l'API REST avec le JWT encore valide, pour les tables dont
la policy ne dépend pas de `current_role_is()` (ex. `profiles_select_self_or_team` via
`id = auth.uid()`, `internal_notifications_own`).

- **Correction :** appeler `supabase.auth.admin.signOut(userId)` à la désactivation, et
  vérifier `is_active` dans le middleware.
- **Difficulté :** faible — **Priorité : 6**

---

## M-04 — Politique d'authentification insuffisante

- **Gravité : Moyen** — **Confiance : confirmée** (linter Supabase)

> `auth_leaked_password_protection` : *Leaked password protection is currently disabled.*

- Pas de vérification HaveIBeenPwned → des mots de passe déjà compromis sont acceptés.
- **Pas de MFA**, y compris pour `super_admin` — alors que ce rôle donne accès aux RIB
  et à la suppression définitive de données.
- Politique de complexité : **à confirmer** (réglage Supabase non lisible depuis le code).
- Aucune limitation de tentatives applicative sur `/login` (Supabase en applique une
  côté service, dont le réglage est **à confirmer**).

- **Correction :** activer la protection HIBP, imposer la MFA aux `super_admin`.
- **Difficulté :** faible (configuration) — **Priorité : 5**

---

## M-05 — Auto-affectation possible sur un ticket (RLS potentiellement récursive)

- **Gravité : Moyen** — **Confiance : À CONFIRMER**
- **Composant :** policy `client_ticket_assignments_write`

```
client_ticket_assignments_write | ALL
  using = can_access_ticket(ticket_id) | check = can_access_ticket(ticket_id)
```

`can_access_ticket()` renvoie vrai notamment s'il **existe une ligne dans
`client_ticket_assignments`** pour l'utilisateur. La policy d'écriture de cette table
s'appuie donc sur son propre contenu.

**Question ouverte :** lors d'un `INSERT`, le `WITH CHECK` voit-il la ligne en cours
d'insertion ? `can_access_ticket()` est déclarée `STABLE`, ce qui devrait lui donner le
snapshot antérieur à la commande et **empêcher** l'auto-élévation. Le comportement exact
dépend de la visibilité intra-commande et mérite une vérification empirique plutôt qu'une
affirmation.

Si l'auto-insertion réussissait, tout utilisateur authentifié pourrait s'affecter à un
ticket arbitraire et accéder aux contenus d'un client hors de son périmètre.

- **Vérification nécessaire :** test sur environnement dédié (protocole `T-05`).
- **Correction (prudente, quelle que soit l'issue) :** restreindre l'écriture des
  affectations à `is_staff_lead()`.
- **Priorité : 6**

---

## M-06 — Suppression planifiée irréversible

- **Gravité : Moyen** — **Confiance : confirmée (code)** ; impact réel **à confirmer**
- **Composant :** `src/app/api/maintenance/purge-media/route.ts`

Chaque nuit à 03h17, la tâche supprime définitivement les fiches dont `period_end` est
antérieur à 14 jours, **par lots de 100**, en cascade. Le commentaire du code est lucide :

> *« Opération destructive et irréversible : la cascade emporte les publications, les
> versions, les validations client et les tickets de la fiche. La preuve de validation
> disparaît avec eux. »*

Points de vigilance :

1. **La preuve de validation client disparaît** — or c'est l'élément qui atteste
   contractuellement de l'accord du client. Sa conservation devrait suivre la durée de
   prescription commerciale, pas 14 jours.
2. Aucune sauvegarde ni corbeille n'est constatée dans le code. La politique de
   sauvegarde Supabase (PITR ?) est **à confirmer**.
3. L'endpoint n'a **aucune limitation de débit** : quiconque détiendrait `CRON_SECRET`
   pourrait le déclencher en boucle.

- **Correction :** vérifier la politique de sauvegarde, archiver les preuves de
  validation avant purge, aligner les durées sur les obligations de conservation.
- **Priorité : 4**

---

## M-07 — Le client `service_role` déborde largement son périmètre documenté

- **Gravité : Moyen** — **Confiance : confirmée**
- **Composant :** `src/lib/supabase/admin.ts`

L'en-tête déclare : *« Client à privilèges élevés, **réservé au portail client** »*.
En pratique, il est utilisé dans **~20 fichiers d'actions internes**.

Ce n'est pas une vulnérabilité en soi — les gardes applicatives sont, à ma vérification,
présentes et correctes partout (`requireEditorialProfile`, `requireAdmin`,
`requireSuperAdmin`, `requireClientAccess`, complétées par une vérification de périmètre
via lecture RLS). C'est un **risque structurel** : toute nouvelle action écrite sur ce
modèle contourne la RLS par défaut, et une garde oubliée devient immédiatement une faille
d'isolation, sans qu'aucun filet ne la rattrape.

Cette architecture explique aussi pourquoi `C-01` est si grave : le rôle `super_admin`
n'est pas seulement un affichage, il ouvre des actions qui s'exécutent hors RLS.

- **Correction :** corriger le commentaire (il induit en erreur), et ajouter un test
  automatisé qui échoue si une action `"use server"` utilise `createSupabaseAdminClient()`
  sans garde (voir `T-06`).
- **Priorité : 7**

---

## Constats faibles

**L-01 — `/test-clic` publique.** Page de diagnostic d'interactivité, exemptée du
middleware, présente en production. Marquée « temporaire » dans le code. Surface inutile.
**Priorité : 3** (suppression triviale).

**L-02 — Comparaison non constante du `CRON_SECRET`.**
`purge-media/route.ts:47` : `request.headers.get("authorization") !== \`Bearer ${secret}\``.
Attaque temporelle théorique sur un secret long et aléatoire — risque très faible, mais
`timingSafeEqual` est déjà importé ailleurs dans le projet (`src/lib/domain/tokens.ts`).
**Priorité : 8**

**L-03 — `citext` dans le schéma `public`** (linter Supabase). Défense en profondeur.
**Priorité : 9**

**I-01 — Absence de protection de branche.** Les commits sont poussés directement sur
`main`, sans revue ni CI obligatoire — y compris ceux de la session de développement
ayant précédé cet audit. Pour un projet manipulant des données bancaires, une revue
et une exécution automatique de `npm audit`, `tsc` et des tests avant fusion sont
un minimum. **Priorité : 7**

---

## Points positifs vérifiés

Ils comptent autant que les défauts, et méritent d'être maintenus lors des corrections :

| Vérification | Résultat |
|---|---|
| Secrets dans le dépôt et l'historique Git | **Aucun** (placeholders seuls) |
| Buckets de stockage | **Privés**, aucune policy permissive, URLs signées |
| Entropie et stockage des tokens du portail | 256 bits CSPRNG, SHA-256 en base, jamais en clair |
| IDOR sur le portail public | **Non exploitable** : appartenance vérifiée + `UPDATE` borné (`.eq("weekly_sheet_id", …)`) |
| Injection SQL | Non constatée — requêtes via le client Supabase (paramétrées) |
| Validation des entrées | Zod systématique sur les Server Actions |
| Pièces jointes | Taille, type MIME **et signature binaire** contrôlés ; nom de fichier neutralisé |
| Nettoyage des textes | Caractères de contrôle et surcharges bidirectionnelles retirés |
| RPC `SECURITY DEFINER` sensibles | `EXECUTE` révoqué pour `anon`/`authenticated` (migration de durcissement) |
| Minimisation des données de traçabilité | Empreinte d'IP salée et tronquée, famille de navigateur |
| Rôle `anon` | Aucune policy ne lui ouvre quoi que ce soit |
| Traceurs tiers | **Aucun** |
