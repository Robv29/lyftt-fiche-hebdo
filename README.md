# LYFTT — Fiche hebdomadaire

Planning éditorial hebdomadaire et **validation client** : le community manager
prépare la fiche, génère un lien sécurisé, l'envoie par WhatsApp ; le client
consulte, valide contenu par contenu, ou demande une modification précise qui
devient un ticket affecté à la bonne personne.

L'objectif est d'éviter les retours perdus dans WhatsApp — « je n'aime pas la
photo », « il faut changer un truc dans le texte » — et de conserver une preuve
de validation.

## Stack

- **Next.js 15** (App Router, Server Actions) + TypeScript + Tailwind
- **Supabase** — PostgreSQL, Auth, Storage
- **Vitest** pour le domaine, **Playwright** pour le navigateur

## Démarrage

```bash
npm install
```

```bash
cp .env.example .env.local
```

Renseignez `.env.local`, puis provisionnez la base :

```bash
supabase start && supabase db reset
```

```bash
npm run dev
```

Comptes de démonstration (mot de passe `demo1234`) : `elena@lyftt.fr`
(community manager), `graphiste@lyftt.fr`, `videaste@lyftt.fr`,
`production@lyftt.fr`.

## Tests

Le domaine métier est testé sans base de données :

```bash
npm test
```

Les tests navigateur supposent une base provisionnée et amorcée :

```bash
npm run test:e2e
```

## Architecture

```
src/lib/domain/      Logique métier pure, testée : échéances, routage,
                     workflow, statuts, modèles de messages, diff, tokens
src/lib/security/    Nettoyage des textes, contrôle des pièces jointes,
                     limitation de débit
src/lib/review/      Couche de lecture du portail client
src/lib/internal/    Actions serveur de l'équipe
src/app/client-review/[token]/   Portail client public
src/app/(internal)/  Écrans internes (authentifiés)
supabase/migrations/ Schéma, RLS, fonctions métier
```

### Où vit la règle métier

Ce qui doit rester vrai quelle que soit la porte d'entrée est **en base** :
calcul de l'échéance, gel d'une version, recalcul du statut de la fiche,
validation tacite. L'application reprend les mêmes règles en TypeScript pour
l'affichage immédiat, et `tests/unit` vérifie que les deux disent la même chose.

### Modèle de sécurité du portail client

Le portail est public, mais il n'utilise **jamais** la clé anon Supabase. Il est
rendu côté serveur après vérification du token, avec la clé service-role, et
chaque requête est explicitement bornée à la fiche du lien. Aucune politique RLS
n'ouvre quoi que ce soit au rôle `anon` : une fuite de la clé publique ne donne
accès à rien.

- Token de 256 bits, encodé en base64url ; **seul son SHA-256 est stocké**
- Expiration, révocation, régénération ; un seul lien actif par fiche
- Format vérifié avant toute requête — pas d'énumération possible
- Limitation de débit sur l'ouverture, la validation, les tickets, les envois
- Buckets privés, médias servis en URL signée à durée limitée
- `internal_notes` n'est jamais sélectionné par la couche portail
  (vérifié par un test)

### Données personnelles

Seule une empreinte d'IP salée et tronquée est conservée, ainsi qu'une famille de
navigateur — jamais l'User-Agent complet ni l'IP en clair. La durée de
conservation est configurable par client (`clients.data_retention_days`).

## Ce qui reste à faire

- **Génération du PDF** : la table `sheet_exports` et la gestion d'obsolescence
  sont en place, mais le rendu du document lui-même n'est pas implémenté. La
  mention de version à imprimer est fournie par `exportVersionLabel()`.
- **Rappels automatiques** (§17) : `apply_tacit_approvals()` est écrite et prête
  à être appelée par un cron Supabase ; les rappels e-mail restent à brancher.
- **Dépôt de fichier par la production** : l'écran production liste les
  corrections et gère les transitions ; le téléversement de la nouvelle version
  du média par le graphiste reste à ajouter.
- **Types générés** : lancer `npm run db:types` une fois la base provisionnée
  remplacera les accesseurs de libellés défensifs par des types stricts.
