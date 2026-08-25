# Résumé exécutif — audit de sécurité et de conformité

**Application auditée :** LYFTT — Fiche hebdomadaire (SaaS interne d'agence social media)
**Dépôt :** `~/dev/lyftt-fiche-hebdo`, commit `db81802`, branche `main`
**Environnement examiné :** code source + base de données Supabase de **production**
(projet `lyftt-fiche-hebdo`, région eu-west-3), en **lecture seule uniquement**.
**Date :** 24 août 2026
**Méthode :** analyse statique du code, des migrations et de la configuration ; lectures
non destructives de l'état réel en base (`information_schema`, `pg_policies`, `pg_trigger`,
`storage.buckets`) ; `npm audit` ; linter de sécurité Supabase.

> **Aucun test intrusif, aucune écriture, aucune exploitation n'a été réalisée en production.**
> Aucune donnée personnelle réelle n'a été extraite ni reproduite dans ce rapport.

---

## Niveau de risque global : **MOYEN** (initialement ÉLEVÉ)

## Décision recommandée : **lancement sous conditions**

> ### ✅ Mise à jour du 24 août 2026 — `C-01` est **CORRIGÉ**
>
> La migration `20260824190000_lock_profile_role.sql` a été appliquée en production
> avec votre accord. Vérifications post-correction (détail en `02-securite-technique.md`) :
>
> - **Aucun signe d'exploitation** : la base ne comptait que 4 profils
>   (2 `super_admin`, 2 `production_manager`) et **aucun compte à faible privilège**
>   n'existait — le risque était donc resté théorique.
> - Un utilisateur authentifié qui tente de changer son rôle : **bloqué**.
> - Le service-role (utilisé par `changeMemberRole()`) : **toujours autorisé**.
> - Un utilisateur qui modifie son nom : **toujours autorisé** (pas de régression).
> - 340 tests passants, `tsc --noEmit` sans erreur, données inchangées.
>
> **Le blocage sur la création de nouveaux comptes d'équipe est levé.**
> Les constats `H-01` à `H-03` restent ouverts et conditionnent la suite.

La correction s'est révélée simple, comme anticipé : il ne s'agissait pas de remettre
en cause l'architecture.

Cette réserve ne doit pas masquer la qualité réelle de l'ensemble. Le code présente
un niveau de rigueur nettement supérieur à ce qu'on attend d'un développement
« vibe coding » :

- le portail client public est la partie la mieux défendue (tokens à 256 bits, hachés
  en base, bornage systématique des écritures au périmètre du lien, limitation de débit) ;
- **aucun secret réel n'a été trouvé** dans les fichiers suivis ni dans l'historique Git ;
- les buckets de stockage sont **privés**, sans policy permissive, servis par URLs signées ;
- les actions serveur du back-office suivent un motif d'autorisation cohérent et
  correct (`requireEditorialProfile()` + vérification de périmètre **par une lecture RLS**),
  qui fait de la base la source de vérité plutôt que du code applicatif ;
- une migration de durcissement (`20260804090400_harden_functions.sql`) montre qu'un
  audit Supabase précédent a déjà été pris au sérieux et corrigé.

Le défaut critique est **localisé**, pas systémique : une politique RLS écrite en
supposant, à tort, que PostgreSQL filtre les colonnes.

---

## Les cinq risques prioritaires

| # | ID | Constat | Gravité | Confiance |
|---|----|---------|---------|-----------|
| ~~1~~ | ~~`C-01`~~ | ~~Tout compte d'équipe peut s'auto-attribuer le rôle `super_admin`~~ — **CORRIGÉ le 24/08** | ~~Critique~~ | Vérifié |
| 2 | `H-01` | Un contributeur peut falsifier le statut d'un ticket, y compris « validé par le client » | **Élevé** | **Confirmée** (mesurée en base) |
| 3 | `H-02` | Dépendances : 4 CVE de gravité haute (`sharp`/libvips, `postcss`) | **Élevé** | Confirmée (`npm audit`) |
| 4 | `H-03` | Limitation de débit en mémoire, inopérante sur Vercel (anti-force brute du portail) | **Élevé** | Confirmée (code + modèle d'exécution) |
| 5 | `M-06` | Suppression irréversible planifiée des fiches (> 14 j) sans sauvegarde vérifiée | **Moyen** | À confirmer (politique de sauvegarde inconnue) |

**Conformité RGPD/juridique :** l'application ne comporte **ni CGU, ni CGV, ni mentions
légales, ni politique cookies**. Le seul document est un encart de 3 paragraphes sur le
portail client. C'est le principal chantier non technique.
Un point favorable et notable : **aucun traceur publicitaire ni analytique n'a été trouvé** —
seuls des cookies de session strictement nécessaires sont déposés, donc **aucun bandeau
de consentement n'est requis** en l'état (art. 82 loi Informatique et Libertés).

---

## Plan d'action

### Sous 24 heures — arrêter l'hémorragie

1. ~~**`C-01`**~~ — ✅ **FAIT le 24/08/2026.** Privilèges de colonne restreints
   (`authenticated` ne conserve `UPDATE` que sur `full_name`, `phone`, `avatar_url`)
   et trigger `profiles_no_self_promotion` posé en filet de sécurité.
   Vérification préalable d'exploitation : **négative**.
2. **`H-01`** — Restreindre `client_tickets_update` : interdire la modification de
   `client_id` et cantonner les transitions de statut autorisées à un contributeur.
3. Supprimer ou authentifier `/api/diagnostic` (`M-01`) et la page publique
   `/test-clic` (`L-01`), toutes deux marquées « temporaire » dans le code.

### Sous 7 jours — réduire la surface

4. **`H-02`** — Mettre à jour Next.js (correctif `sharp`/`postcss`) ; planifier la montée
   de version et vérifier la non-régression.
5. **`H-03`** — Remplacer la limitation de débit en mémoire par un magasin partagé
   (Upstash Redis, ou une table Postgres) — l'interface `RateLimitStore` est déjà prévue pour.
6. Ajouter les en-têtes de sécurité **globaux** : CSP, HSTS, `X-Content-Type-Options`,
   `Referrer-Policy`, `Permissions-Policy` (`M-02`).
7. Activer la protection contre les mots de passe compromis (HaveIBeenPwned) et étudier
   la MFA pour les comptes `super_admin` (`M-04`).
8. Vérifier et documenter la politique de sauvegarde et de restauration (`M-06`).

### Sous 30 jours — conformité et pérennité

9. Rédiger CGU/CGV, mentions légales et politique de confidentialité complète ;
   les rendre accessibles et **horodater leur acceptation** (voir `04-documents-juridiques.md`).
10. Établir le registre des traitements (art. 30 RGPD) et signer les DPA avec les
    sous-traitants (Vercel, Supabase, Resend) — voir `03-rgpd-cookies.md`.
11. Documenter les transferts hors EEE (Vercel, société américaine) et les garanties associées.
12. Mettre en place la traçabilité des actions d'administration et une procédure
    de notification de violation sous 72 h.
13. Ajouter les tests de non-régression de sécurité décrits en `06-tests-regression.md`.

---

## Avertissement

L'analyse juridique et RGPD de ce rapport constitue une **aide à la conformité**, fondée
sur la lecture du code et des sources publiques citées (CNIL, EUR-Lex, Légifrance).
Elle **ne constitue pas un avis juridique** et doit être validée par un professionnel du
droit qualifié avant mise en production commerciale.

Les points marqués « À confirmer » n'ont pas pu être vérifiés depuis le code seul :
ils appellent des éléments listés en `07-informations-manquantes.md`.
