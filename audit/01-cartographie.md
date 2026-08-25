# Cartographie du SaaS

## 1. Architecture générale

Application **Next.js 15.5.22** (App Router, React 18.3) déployée sur **Vercel**,
adossée à **Supabase** (PostgreSQL 17.6 + Auth + Storage), région **eu-west-3 (Paris)**.

Il s'agit d'un SaaS **mono-organisation** : une seule agence (LYFTT) l'utilise pour gérer
ses propres clients. La notion de « tenant » n'est donc pas une organisation cliente mais
un **client de l'agence**, et l'isolation qui compte est double :

1. entre **membres de l'équipe** (un community manager ne voit que les clients qui lui
   sont affectés — porté par `client_assignments` et la fonction `can_access_client()`) ;
2. entre **clients finaux**, qui accèdent à un portail public via un lien à token, sans
   compte ni mot de passe.

Il n'y a **pas de paiement en ligne, pas d'abonnement, pas de quota** : le module
« budget » est un outil de suivi de facturation interne, sans prestataire de paiement.
Toute la section « contournement de paiement » du périmètre d'audit est donc **sans objet**,
ce qui réduit d'autant la surface d'attaque.

### Composants

| Couche | Technologie | Remarques |
|---|---|---|
| Frontend | React 18 / Next App Router, Tailwind 3 | Server Components majoritaires |
| Backend | Server Actions Next.js (`"use server"`) | Pas d'API REST interne, hors 2 routes |
| API HTTP | 2 routes : `/api/diagnostic`, `/api/maintenance/purge-media` | Exclues du middleware |
| Base | PostgreSQL 17 (Supabase), 27 migrations | RLS activée sur 20 tables |
| Stockage | Supabase Storage, buckets `media` et `exports` | **Privés**, URLs signées |
| Auth | Supabase Auth (e-mail + mot de passe) | Sessions par cookies |
| Tâches planifiées | Vercel Cron (1 : purge quotidienne 03h17) | Authentifiée par `CRON_SECRET` |
| E-mails | Resend (`RESEND_API_KEY`) | Notifications internes et client |

## 2. Zones accessibles sans authentification

C'est la surface d'attaque externe. Elle est réduite et, pour l'essentiel, bien défendue.

| Route | Contrôle d'accès | Évaluation |
|---|---|---|
| `/login` | — | Standard Supabase |
| `/client-review/[token]` | Token 256 bits, haché SHA-256 en base, expiration + révocation | **Solide** |
| `/demande/[token]` | Idem | **Solide** |
| `/api/diagnostic` | **Aucun** | **Fuite de configuration** (`M-01`) |
| `/api/maintenance/purge-media` | `Authorization: Bearer <CRON_SECRET>` | Correct, mais destructif (`M-06`) |
| `/test-clic` | **Aucun** | Page de diagnostic laissée en production (`L-01`) |

## 3. Modèle d'autorisation

Cinq rôles applicatifs (`app_role`) : `super_admin`, `production_manager`,
`community_manager`, `graphic_designer`, `video_editor`.

Le modèle repose sur **deux mécanismes complémentaires** :

- **RLS PostgreSQL** pour les lectures faites au nom de l'utilisateur
  (`createSupabaseServerClient`), via les fonctions `can_access_client()`,
  `can_access_ticket()`, `is_staff_lead()`, `current_role_is()` ;
- **gardes applicatives** pour les écritures, qui passent par le client `service_role`
  (lequel **contourne la RLS**) : `requireEditorialProfile()`, `requireAdmin()`,
  `requireSuperAdmin()`, `requireClientAccess()`.

Le point remarquable — et bien vu — est que la vérification de périmètre des écritures
est déléguée à **une lecture RLS** (`resolveAccessibleSheet()`, `resolveAccessibleItem()`,
`canAccessClient()` dans `src/lib/internal/authorization.ts`). Si la ligne n'est pas
visible sous RLS, l'écriture est refusée. La politique SQL reste ainsi l'unique source
de vérité, et une évolution des règles n'a pas à être répercutée dans le code.

**Conséquence importante :** la sécurité du back-office dépend entièrement de la
correction de ces politiques RLS. C'est précisément là que se situe le défaut `C-01`.

### Usage du client `service_role`

`src/lib/supabase/admin.ts` est marqué `server-only` (une importation côté client casse
la compilation) — bonne pratique. Son en-tête le décrit toutefois comme « réservé au
portail client », alors qu'il est utilisé dans **~20 fichiers d'actions internes**.
Le commentaire est donc trompeur et mériterait d'être corrigé, même si l'usage
lui-même est encadré par les gardes ci-dessus (voir `M-07`).

## 4. Flux de données

```
                        (1) équipe interne
Navigateur ──HTTPS──> Vercel (Next.js, Server Actions)
   │                      │
   │                      ├── middleware : Supabase Auth (getUser) ──> Supabase Auth (EU)
   │                      ├── lectures  : client anon + JWT ─RLS──> PostgreSQL (EU, Paris)
   │                      ├── écritures : client service_role ─────> PostgreSQL  (RLS contournée,
   │                      │                                           gardes applicatives)
   │                      └── médias    : URLs signées ────────────> Supabase Storage (privé)
   │
   │                    (2) client final (sans compte)
   └──HTTPS──> /client-review/<token> ──> résolution du token (SHA-256)
                          │                 puis service_role borné à la fiche du lien
                          └── notifications ──> Resend (e-mail)

                        (3) tâche planifiée
Vercel Cron ──Bearer CRON_SECRET──> /api/maintenance/purge-media ──> PostgreSQL + Storage
                                     (validations tacites, purge médias,
                                      SUPPRESSION des fiches > 14 jours)
```

### Détail des flux

| # | Flux | Données transmises | Finalité | Destinataire | Lieu | Sensibilité |
|---|---|---|---|---|---|---|
| 1 | Équipe → app | Identifiants, contenus éditoriaux, données clients | Production éditoriale | Vercel + Supabase | UE (eu-west-3) / Vercel edge | Moyenne |
| 2 | Client → portail | Validations, commentaires, pièces jointes, note de satisfaction | Validation contractuelle | Supabase | UE | Moyenne |
| 3 | App → Resend | Adresse e-mail, nom, lien de validation | Notification | Resend | **À confirmer** (US probable) | Moyenne |
| 4 | Portail → journal | **Empreinte d'IP salée** (SHA-256 tronqué 16 car.), famille de navigateur | Preuve de consultation, anti-abus | Supabase | UE | Faible (pseudonymisé) |
| 5 | Cron → base | — | Purge et validation tacite | Supabase | UE | **Destructif** |

Le choix de ne stocker qu'une **empreinte d'IP salée et tronquée** plutôt que l'IP,
et une **famille de navigateur** plutôt que l'User-Agent complet
(`src/lib/domain/tokens.ts`), est une application correcte du principe de
minimisation (art. 5.1.c RGPD). À souligner au crédit du projet.

## 5. Données personnelles traitées

| Catégorie | Données | Personnes concernées |
|---|---|---|
| Comptes équipe | Nom, e-mail, téléphone, rôle, avatar | Salariés / prestataires LYFTT |
| Contacts clients | Nom, prénom, e-mail, téléphone, rôle | Représentants des clients |
| Contenus | Légendes, hashtags, visuels, vidéos | Peut contenir des images de personnes |
| Traçabilité portail | Empreinte d'IP salée, famille de navigateur, horodatage | Contacts clients |
| Facturation | RIB (bucket `exports`), budgets, factures | Clients (personnes morales et physiques) |
| Satisfaction | Note 1–3 par fiche | Contacts clients |

**Aucune donnée sensible au sens de l'art. 9 RGPD** n'est traitée par conception.
**Point d'attention :** les visuels produits pour les clients peuvent contenir des
**images de personnes identifiables** (photos de commerces, de personnel, de clients).
Ce traitement d'image n'est encadré nulle part dans le code ni dans les documents —
voir `03-rgpd-cookies.md`.

Le **RIB** stocké dans le bucket `exports` est une donnée bancaire : elle mérite une
attention particulière en matière de conservation et de traçabilité d'accès.

## 6. Services tiers et sous-traitants

| Service | Rôle | Données | Lieu | DPA signé ? |
|---|---|---|---|---|
| Vercel | Hébergement applicatif | Toutes (en transit), logs | US / edge mondial | **À confirmer** |
| Supabase | Base, auth, stockage | Toutes (au repos) | eu-west-3 (Paris) | **À confirmer** |
| Resend | E-mails transactionnels | Nom, e-mail, liens | **À confirmer** | **À confirmer** |
| GitHub | Code source | Aucune donnée personnelle client | US | Sans objet |

**Aucun outil d'analytics, de publicité, de chat ou de réseau social** n'a été trouvé
dans le code. Recherche effectuée sur `document.cookie`, `localStorage`,
`sessionStorage`, et les motifs usuels de traceurs : **un seul résultat**, l'écriture
des cookies de session Supabase (`src/lib/supabase/server.ts:20`).

## 7. Secrets et configuration

Variables attendues (`.env.example`) : `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`,
`NEXT_PUBLIC_APP_URL`, `REVIEW_LINK_TTL_DAYS`, plus `RESEND_API_KEY`, `MAIL_FROM`,
`CRON_SECRET`.

- `.env`, `.env.local` et `.env*.local` sont **correctement présents dans `.gitignore`**.
- **Aucun secret réel dans l'historique Git** : la recherche sur l'ensemble des commits
  (motifs JWT, `sk_live_`, `re_`, `service_role`) ne remonte que les **placeholders**
  de `.env.example` (`cle-service-role`). Vérifié sur tout l'historique.
- Le fichier `.env.local` présent localement a été créé pendant une session de
  développement antérieure et ne contient que l'URL et la **clé anon** (publique par
  conception, exposée dans le bundle client).

## 8. Chaîne de développement

- Pas de workflow CI/CD dans le dépôt (`.github/` absent) : déploiement Vercel piloté
  par les poussées sur `main`. **Aucune protection de branche constatée** ; les commits
  récents sont poussés directement sur `main` sans revue.
- Tests : Vitest et Playwright sont configurés (`vitest.config.ts`,
  `playwright.config.ts`) — leur couverture réelle en matière de sécurité est évaluée
  en `06-tests-regression.md`.
- Pas de séparation d'environnements constatée : **un seul projet Supabase**, pas de
  préproduction identifiée. C'est un frein direct à la testabilité sécurité
  (voir `07-informations-manquantes.md`).
