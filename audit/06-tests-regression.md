# Tests de non-régression de sécurité

## État actuel

**21 fichiers, 340 tests unitaires, tous passants** (`npx vitest run`, 2,9 s).
Plus 2 suites Playwright (`tests/e2e/internal-workflow.spec.ts`, `client-review.spec.ts`).

`tests/unit/security.test.ts` couvre déjà correctement les **primitives** :
entropie et unicité des tokens, non-stockage en clair, validation de format, états
(révoqué/expiré), pseudonymisation d'IP, contrôle des pièces jointes (taille, type,
signature binaire), neutralisation des noms de fichiers, nettoyage des textes, et la
mécanique de limitation de débit.

**Le trou de couverture est net et unique : aucun test d'autorisation.** Aucun test ne
vérifie qu'un rôle donné ne peut *pas* faire quelque chose. C'est précisément la classe
de défaut à laquelle appartiennent `C-01` et `H-01` — ce qui explique qu'ils aient
traversé 340 tests verts sans être détectés.

---

## Prérequis : un environnement de test

Aucun test d'autorisation ne peut être écrit sérieusement contre la production.
**Recommandation préalable à tout le reste :** créer une branche Supabase de test
(ou un projet dédié) alimentée par `supabase/seed.sql`, avec un compte par rôle.

Sans cet environnement, les tests `T-01` à `T-05` restent des **protocoles**, non des
tests automatisés — et la vérification de `C-01` restera documentaire.

---

## A-01 · Vérification immédiate — à exécuter AVANT correction

**Objectif :** s'assurer que `C-01` n'a pas déjà été exploité.
**Nature :** lecture seule, sans risque, exécutable en production dès maintenant.

```sql
-- 1) Inventaire des rôles actuels : tout super_admin inattendu doit être expliqué
select id, email, role, is_active, created_at, updated_at
from public.profiles
order by role, updated_at desc;

-- 2) Signal d'alerte : profils dont le rôle a été modifié après la création.
--    updated_at nettement postérieur à created_at sur un compte super_admin
--    mérite un examen (le trigger set_updated_at horodate chaque modification).
select id, email, role, created_at, updated_at,
       updated_at - created_at as ecart
from public.profiles
where updated_at > created_at + interval '1 minute'
order by updated_at desc;
```

**Résultat attendu :** chaque `super_admin` correspond à une personne légitimement
administratrice. Toute anomalie relève de la procédure d'incident (et, le cas échéant,
d'une notification CNIL sous 72 h au titre de l'art. 33 RGPD).

**Limite méthodologique à connaître :** `updated_at` est écrasé à chaque modification —
ce test détecte une modification, pas son auteur ni son contenu. C'est l'absence de
journal d'audit (`F-22`) qui empêche d'aller plus loin. Les journaux Postgres de Supabase
ne remontent que sur une fenêtre limitée : **cette vérification est à faire sans tarder.**

---

## T-01 · Un compte non-admin ne peut pas changer son rôle (`C-01`)

**Type :** intégration, environnement de test **uniquement**.

```
Étant donné un compte authentifié de rôle `video_editor`
Quand il exécute :
    PATCH /rest/v1/profiles?id=eq.<son_uuid>
    Authorization: Bearer <son JWT>   apikey: <clé anon>
    {"role": "super_admin"}
Alors la requête échoue (403 ou 0 ligne modifiée)
Et   son rôle en base est toujours `video_editor`
```

**Cas complémentaires, à ne pas oublier :**

- même test sur `{"is_active": true}` après désactivation → doit échouer ;
- même test sur `{"full_name": "…"}` → **doit réussir** (non-régression fonctionnelle) ;
- `changeMemberRole()` appelée par un `super_admin` → **doit réussir** (c'est le vrai
  risque de régression du correctif `F-01`).

**Avant correction :** la requête aboutit. **Après :** elle échoue. C'est ce test qui
établit la réalité de la vulnérabilité et l'efficacité du correctif.

---

## T-02 · Un contributeur ne peut pas falsifier une validation client (`H-01`)

```
Étant donné un `graphic_designer` affecté au ticket T
Quand il exécute PATCH /rest/v1/client_tickets?id=eq.T {"status":"approved_by_client"}
Alors la requête échoue
Et   quand il tente {"client_id":"<autre client>"}
Alors la requête échoue
Et   quand il tente {"status":"in_progress"}   (transition légitime de production)
Alors la requête réussit
```

---

## T-03 · Isolation entre clients pour un community manager

Non signalé comme défaut — les gardes applicatives paraissent correctes — mais c'est
l'invariant central du modèle : il mérite d'être verrouillé par un test.

```
Étant donné un `community_manager` affecté au client A, non affecté au client B
Alors  GET  /rest/v1/weekly_sheets?client_id=eq.B          → 0 ligne
Et     saveSheetContent()  sur une fiche de B              → « accès refusé »
Et     setSheetTopic()     sur une fiche de B              → « accès refusé »
Et     generateReviewLink() sur une fiche de B             → refus
Et     les mêmes opérations sur une fiche de A             → succès
```

À décliner sur les 8 opérations du périmètre d'audit : créer, lire, modifier, supprimer,
lister, rechercher, exporter, partager.

---

## T-04 · Le portail client reste borné à sa fiche (non-régression)

Ce point est **actuellement correct** (double vérification : appartenance + `UPDATE`
borné). Le test sert à ce qu'il le reste.

```
Étant donné un token valide pour la fiche S1
Quand approveItem() est appelée avec l'itemId d'une publication de la fiche S2
Alors « Contenu introuvable » et aucune écriture sur S2
Idem pour createTicket(), rateSheet(), approveAll()
Et   un token révoqué ou expiré → accès refusé
```

---

## T-05 · Auto-affectation sur un ticket (`M-05` — à confirmer)

**Ce test tranche un point que l'analyse statique laisse ouvert.**

```
Étant donné un `video_editor` NON affecté au ticket T d'un client hors de son périmètre
Quand il exécute POST /rest/v1/client_ticket_assignments
     {"ticket_id":"T","profile_id":"<son uuid>","assignment_role":"…"}
Alors la requête doit échouer
```

Si elle réussit, `M-05` passe de « à confirmer » à **Élevé** (contournement du
cloisonnement par auto-affectation) et `F-10` devient prioritaire.

---

## T-06 · Test structurel : pas de service_role sans garde (`M-07`)

Test unitaire pur, **exécutable immédiatement sans environnement de test**, et
probablement le meilleur rapport valeur/effort de cette liste : il empêche la
réapparition de toute une classe de défauts.

```ts
// tests/unit/authorization-guards.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const GUARDS = /requireEditorialProfile|requireAdmin|requireSuperAdmin|requireClientAccess|resolveReviewLink|resolveRequestLink/;

describe("gardes d'autorisation", () => {
  it("toute action serveur utilisant le service_role porte une garde", () => {
    const files = globSync("src/**/*.ts").filter((f) =>
      readFileSync(f, "utf8").includes('"use server"'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const block of src.split(/\nexport async function /).slice(1)) {
        const name = block.split("(")[0].trim();
        if (block.includes("createSupabaseAdminClient") && !GUARDS.test(block)) {
          offenders.push(`${file} :: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

> **Note d'honnêteté sur ce test :** il est **heuristique**, pas une preuve. Au cours de
> cet audit, une première version de cette analyse a produit **plusieurs faux positifs**
> (gardes portant un nom non prévu, gardes situées dans une fonction auxiliaire), qu'il a
> fallu écarter par lecture manuelle. Il détecte une action manifestement non gardée ;
> il ne garantit pas que la garde présente soit la bonne. À utiliser comme filet, jamais
> comme certificat.

---

## Commandes

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test          # vitest run  → attendu : 340+ tests passants
npm run test:e2e      # playwright
npm audit --omit=dev  # attendu après F-05 : 0 vulnérabilité haute
```

## Résultats attendus après corrections

| Test | Avant | Après |
|---|---|---|
| A-01 | Anomalies à investiguer | Aucun rôle inattendu |
| T-01 | Élévation possible | Refusée, profil modifiable |
| T-02 | Falsification possible | Refusée, production OK |
| T-03 | Attendu conforme | Conforme (verrouillé) |
| T-04 | Attendu conforme | Conforme (verrouillé) |
| T-05 | **Inconnu** | Refusée |
| T-06 | À établir | Aucune action non gardée |
| `npm audit` | 4 hautes | 0 haute |
