# Documents juridiques et parcours contractuel

> **Avertissement.** Aide à la conformité, **pas un avis juridique**. Les rédactions
> proposées sont des points de départ à faire valider par un professionnel du droit.
> Les informations manquantes sont explicitement signalées : elles ne peuvent pas être
> déduites du code.

---

## 1. État des lieux

Recherche exhaustive dans le dépôt (`cgu`, `cgv`, `confidentialité`, `privacy`,
`mentions`, `cookie`, `legal`) : **un seul fichier**, `PrivacyNotice.tsx`.

| Document | Présent ? | Emplacement |
|---|---|---|
| CGU | **Non** | — |
| CGV / contrat d'abonnement | **Non** | — |
| Politique de confidentialité | **Partiel** | Encart 3 § sur le portail client + lien externe |
| Politique cookies | **Non** | Non requise en l'état (voir `03-rgpd-cookies.md`) |
| Mentions légales | **Non** | — |
| DPA / accord de sous-traitance | **Non** | — |
| Liste des sous-traitants | **Non** | — |
| Acceptation horodatée d'un contrat | **Non** | Aucune trace en base |

**Le seul document existant**, `src/app/client-review/[token]/PrivacyNotice.tsx`, contient :
le responsable de traitement (LYFTT), la finalité, une durée de conservation (inexacte —
voir `03-rgpd-cookies.md` §3), les droits d'accès/rectification/suppression, un contact
(`contact@lyftt.fr`), et un lien vers `lyftt.fr/politique-de-confidentialite`.

C'est un socle honnête et lisible, mais insuffisant : il manque l'identité complète du
responsable, la base légale, les destinataires, les transferts, le droit de réclamation
auprès de la CNIL, et les droits d'opposition, limitation et portabilité.

---

## 2. Nature du service et régime applicable

**Point de qualification préalable, déterminant pour la suite.**

L'application est un **outil interne d'agence**, pas un SaaS commercialisé en
libre-service : pas d'inscription publique (les comptes sont créés par un `super_admin`),
pas de paiement en ligne, pas d'abonnement, pas de tarification dans le code.

Il en découle deux régimes distincts, à ne pas confondre :

- **Vis-à-vis de l'équipe** (salariés, prestataires) : une **charte d'utilisation** et une
  information RGPD des salariés suffisent. Des CGU commerciales seraient hors sujet.
- **Vis-à-vis des clients de l'agence** : la relation est régie par le **contrat de
  prestation** (hors application). Le portail de validation en est un outil d'exécution.
  Les CGU du portail doivent donc s'articuler avec ce contrat, sans le contredire.

**[IM] Question ouverte, à trancher avant toute rédaction :** l'outil a-t-il vocation à
être commercialisé à d'autres agences ? La réponse change entièrement le corpus
nécessaire (CGV, droit de rétractation, médiateur de la consommation, reconduction
tacite…). En l'état, ces éléments sont **sans objet**.

Sont donc **sans objet aujourd'hui**, et le resteront tant que le service n'est pas
commercialisé : droit de rétractation (art. L.221-18 C. consommation), médiateur de la
consommation (art. L.612-1), reconduction tacite (loi Chatel, art. L.215-1), clauses
abusives B2C, information précontractuelle sur les prix.

---

## 3. Écarts constatés

### 3.1 Mentions légales absentes — **non-conformité certaine**

L'art. 6-III de la **LCEN** (loi n° 2004-575 du 21 juin 2004) impose à tout éditeur de
service en ligne de mettre à disposition du public :

- dénomination sociale, forme juridique, capital social ;
- adresse du siège ;
- numéro RCS, numéro de TVA intracommunautaire ;
- nom du directeur de la publication ;
- **nom, dénomination et adresse de l'hébergeur** (ici : Vercel Inc. et Supabase) ;
- coordonnées de contact.

Sanction encourue : jusqu'à 75 000 € d'amende pour une personne morale (art. 6-VI LCEN).

Ces mentions s'appliquent à la partie accessible au public, **le portail client inclus**.

**[IM]** Aucune de ces informations n'est disponible dans le dépôt.

### 3.2 Absence de preuve d'acceptation — **risque probable**

Aucune table, colonne ni horodatage n'enregistre l'acceptation de conditions
contractuelles, ni par l'équipe, ni par les clients. En cas de litige, l'agence ne peut
démontrer ni la version acceptée, ni la date.

**Recommandation :** table `document_acceptances` (`profile_id` ou `contact_id`,
`document_type`, `version`, `accepted_at`, empreinte d'IP salée — cohérente avec le
`hashIp` déjà en place).

### 3.3 Validation tacite — **risque probable, point sensible**

Le mécanisme (§16 du projet) fait qu'une fiche **non contestée dans le délai est réputée
validée** (`apply_tacit_approvals`). L'application le matérialise correctement : le
paramétrage est par client (`approval_policy`), la mention contractuelle est stockée
(`tacit_approval_notice`) et affichée, et la fonction vérifie qu'un message a bien été
envoyé et qu'aucune demande n'est en cours. **C'est bien conçu.**

La validité juridique de la clause dépend en revanche de deux éléments **hors application** :

1. son inscription explicite dans le **contrat signé** avec chaque client ;
2. le caractère **raisonnable du délai** et la preuve de la réception du message.

**[IM]** Le contrat type n'est pas dans le dépôt. En B2B entre professionnels une telle
clause est admissible si elle est claire et acceptée ; elle serait beaucoup plus fragile
face à un non-professionnel.

**[RP]** Point d'attention : la suppression des fiches à 14 jours (`M-06`) **détruit la
preuve** de cette validation tacite. Une clause contractuelle sans preuve conservée perd
l'essentiel de son intérêt.

### 3.4 Propriété intellectuelle non traitée — **non-conformité certaine**

L'application produit et stocke des œuvres (visuels, vidéos, textes). Rien ne définit :

- la **titularité** des droits sur les contenus produits par l'agence ;
- la **cession** de droits au client, son étendue (supports, durée, territoire) — l'art.
  L.131-3 du Code de la propriété intellectuelle exige une délimitation précise ;
- les droits sur les contenus **fournis par le client** (photos, logos) et la garantie
  qu'il en détient les droits ;
- le sort des contenus à la fin de la relation.

C'est un manque classique et coûteux en agence : sans cession écrite et délimitée, le
client n'acquiert pas les droits qu'il croit avoir achetés.

### 3.5 Restitution et réversibilité — **risque probable**

`deleteClient` supprime définitivement un client et ses données (avec un décompte
préalable de ce qui sera emporté — **[BP]**, bonne pratique). Mais aucun **export** n'est
prévu : à la fin d'une relation, le client ne peut récupérer ni ses contenus ni son
historique. Une clause de réversibilité, avec format et délai, est attendue dans ce type
de prestation.

### 3.6 Autres clauses absentes

Limitation de responsabilité · disponibilité du service (aucun engagement, ni SLA, ni
information sur l'absence de SLA) · modération et contenus interdits · suspension et
fermeture de compte · droit applicable et juridiction compétente · sous-traitance
ultérieure · confidentialité réciproque · assurance RC professionnelle.

---

## 4. Corpus documentaire recommandé

| # | Document | Destinataire | Contenu minimal | Priorité |
|---|---|---|---|---|
| 1 | **Mentions légales** | Public (portail inclus) | Art. 6-III LCEN — voir §3.1 | **Haute** |
| 2 | **Politique de confidentialité** complète | Public | Art. 13-14 RGPD : identité, finalités, bases légales, destinataires, durées, transferts, droits, réclamation CNIL | **Haute** |
| 3 | **Charte d'utilisation interne** | Équipe | Usages autorisés, confidentialité, sécurité, conséquences | Haute |
| 4 | **Conditions d'utilisation du portail** | Contacts clients | Objet, accès par lien, valeur de la validation (explicite et tacite), durée de validité du lien | Haute |
| 5 | **Annexe contractuelle RGPD** | Clients | Répartition responsable/sous-traitant, art. 28.3 | Haute |
| 6 | **Clause de PI et cession de droits** | Clients | Titularité, cession délimitée (art. L.131-3 CPI), garanties du client | Haute |
| 7 | **Liste des sous-traitants** | Public | Vercel, Supabase, Resend + localisation | Moyenne |
| 8 | **Clause de réversibilité** | Clients | Format, délai, coût de restitution | Moyenne |
| 9 | **DPA signés** | Fournisseurs | Vercel, Supabase, Resend | Haute |

---

## 5. Informations à obtenir avant rédaction

Aucune de ces informations n'est déductible du code — elles conditionnent toute rédaction :

1. Dénomination sociale exacte, forme juridique, capital, siège, RCS, TVA de LYFTT
2. Nom du directeur de la publication
3. Adresses légales des hébergeurs (Vercel Inc., Supabase Inc.)
4. Contrat de prestation type actuellement signé avec les clients
5. Clause de validation tacite déjà présente, ou non, dans ce contrat
6. Clientèle exclusivement professionnelle, ou existence de clients non professionnels
7. Statut des membres de l'équipe (salariés, freelances) et contrats associés
8. Intention de commercialiser l'outil à des tiers
9. Assurance RC professionnelle souscrite
10. Existence effective de `lyftt.fr/politique-de-confidentialite` et son contenu

---

## 6. Sources

- LCEN n° 2004-575 du 21 juin 2004, art. 6-III et 6-VI — *legifrance.gouv.fr*
- RGPD (règlement UE 2016/679), art. 5, 13, 28, 30, 32-35 — *eur-lex.europa.eu*
- Loi Informatique et Libertés n° 78-17, art. 82 (traceurs) — *legifrance.gouv.fr*
- Lignes directrices et recommandation « cookies et autres traceurs » — *cnil.fr*
- Code de commerce, art. L.110-4 (prescription quinquennale) — *legifrance.gouv.fr*
- Code de la propriété intellectuelle, art. L.131-3 (cession de droits) — *legifrance.gouv.fr*
- Code civil, art. 9 (droit à l'image) — *legifrance.gouv.fr*
- Code de la consommation, art. L.221-18, L.612-1, L.215-1 — *legifrance.gouv.fr*
  (sans objet en l'état — voir §2)
