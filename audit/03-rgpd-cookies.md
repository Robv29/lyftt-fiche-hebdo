# Audit RGPD, vie privée et traceurs

> ### ✅ Mise à jour du 25 août 2026 — information des personnes (art. 13)
>
> Le portail client renvoyait vers `https://lyftt.fr/politique-de-confidentialite`.
> **Cette page n'existe pas** : le domaine répond 404 et présente en outre un certificat
> TLS ne couvrant pas `lyftt.fr` (il pointe vers un mutualisé OVH). Les contacts clients
> n'avaient donc accès à **aucune** information sur le traitement de leurs données —
> manquement direct à l'art. 13.
>
> Une politique de confidentialité complète est désormais servie par l'application
> (`/politique-de-confidentialite`) et `PrivacyNotice` y renvoie. Elle n'affirme que ce
> qui est vérifiable dans le code : durées réellement appliquées, sous-traitants réels,
> absence de traceur. **Elle ne comble pas** les points ci-dessous qui relèvent d'une
> décision de l'entreprise : durées de conservation des comptes, des contacts et du
> **RIB**, et base légale du **droit à l'image** (`T4`).


> **Avertissement.** Cette analyse est une **aide à la conformité** fondée sur la lecture
> du code, des migrations et de la configuration. Elle **ne constitue pas un avis
> juridique** et doit être validée par un professionnel du droit avant mise en production
> commerciale. Les sources officielles citées sont accessibles sur cnil.fr, legifrance.gouv.fr
> et eur-lex.europa.eu.

Classification employée, conformément à la demande :
**[NC]** non-conformité certaine · **[RP]** risque probable ·
**[IM]** information manquante · **[BP]** bonne pratique recommandée

---

## 1. Cartographie des traitements

L'agence LYFTT est **responsable de traitement** pour ses données d'équipe et ses données
clients. Elle est vraisemblablement **sous-traitante** (art. 28 RGPD) pour les contenus
qu'elle produit et publie au nom de ses clients — ce qui appelle un contrat de
sous-traitance **avec chacun de ses clients**, distinct des DPA avec ses propres
fournisseurs. **[IM]** Ce point n'est documenté nulle part dans le dépôt.

### T1 — Gestion des comptes de l'équipe

| Élément | Valeur |
|---|---|
| Personnes concernées | Salariés et prestataires de LYFTT |
| Données | Nom, e-mail, téléphone, rôle, avatar, horodatages |
| Finalité | Authentification, attribution du travail |
| Base légale | Contrat (art. 6.1.b) / intérêt légitime (6.1.f) |
| Conservation | **[IM]** Aucune durée définie. `deleteTeamMember` existe mais n'est pas automatisé |
| Destinataires | Équipe interne |
| Sous-traitants | Supabase (UE), Vercel |
| Hébergement | eu-west-3 (Paris) |
| Sécurité | RLS + gardes applicatives — **affaibli par `C-01`** |

### T2 — Gestion des clients et de leurs contacts

| Élément | Valeur |
|---|---|
| Personnes concernées | Représentants des clients (personnes physiques) |
| Données | Nom, prénom, e-mail, téléphone, fonction, **RIB** |
| Finalité | Exécution de la prestation, facturation |
| Base légale | Contrat (6.1.b) ; obligation légale pour la facturation (6.1.c) |
| Conservation | **[IM]** Non définie. Le RIB n'a **aucune durée de purge** dans le code |
| Hébergement | eu-west-3 (Paris) |

> **[RP] Le RIB** (`bucket exports`, migration `20260815110000_budget_rib.sql`) est une
> donnée bancaire conservée sans durée ni traçabilité d'accès définie. Une donnée bancaire
> ne devrait être conservée que le temps strictement nécessaire au mandat de prélèvement,
> et son accès journalisé.
>
> ### ✅ Durée arrêtée et appliquée le 25 août 2026
>
> **Conservation : jusqu'à la fin de la gestion, plus trente jours.** Le délai couvre le
> dernier prélèvement et la facture de solde, qui tombent après la date de fin.
>
> La purge est **automatique**, greffée sur la tâche planifiée quotidienne
> (`src/app/api/maintenance/purge-media/route.ts`) : colonnes remises à nul puis fichier
> retiré du stockage. La durée est désormais annoncée aux personnes concernées dans la
> politique de confidentialité — l'écart entre l'information donnée et la pratique réelle,
> relevé au §3, est donc résorbé sur ce point.
>
> Un client **sans date de fin** est traité comme un client dont la gestion se poursuit :
> son RIB n'est pas purgé. C'est le choix de l'éditeur, et la seule lecture cohérente d'un
> champ vide.
>
> Vérifié en base au moment de la mise en place : aucun RIB n'était stocké, la purge ne
> détruit donc rien de rétroactif ; 10 clients sans date de fin sont bien préservés par la
> requête.
>
> ### ✅ Journalisation des accès — mise en place le 25 août 2026
>
> Table `client_rib_events` (migration `20260825110000_rib_access_log.sql`). Cinq
> événements sont consignés : consultation, dépôt, remplacement, retrait, purge
> automatique. Chacun porte l'auteur, l'horodatage, une empreinte d'IP salée et la
> famille de navigateur — la même minimisation que pour le portail client.
>
> **La consultation est journalisée au moment où l'URL signée est délivrée**, et non au
> clic sur le fichier : une fois l'URL remise au navigateur, les coordonnées sont
> accessibles. C'est là que l'accès se joue réellement.
>
> Trois propriétés vérifiées en base, transaction annulée :
>
> | Contrôle | Résultat |
> |---|---|
> | Lecture par un `super_admin` | ✅ autorisée |
> | Lecture par un `production_manager` | ✅ aucune ligne |
> | Lecture anonyme | ✅ refusée |
> | Modification d'un événement | ✅ bloquée par trigger |
> | Suppression (purge, art. 17) | ✅ possible |
>
> L'immuabilité vaut **y compris pour la clé service-role** : un journal réinscriptible
> n'a aucune valeur probante. La suppression reste ouverte, pour la rétention et pour
> l'effacement demandé par un client.
>
> Le journal est **conservé un an**, puis purgé par la tâche quotidienne : assez pour
> reconstituer un incident, pas au point de constituer un fichier de surveillance de
> l'équipe. Les dix derniers accès sont lisibles sur la fiche budget du client, sous un
> bloc replié — un journal qu'on ne peut pas consulter n'a qu'une valeur théorique.

### T3 — Validation client par lien public

| Élément | Valeur |
|---|---|
| Personnes concernées | Contacts clients |
| Données | Validations, commentaires, pièces jointes, note de satisfaction, **empreinte d'IP salée**, famille de navigateur |
| Finalité | Preuve de validation contractuelle |
| Base légale | Contrat (6.1.b) ; intérêt légitime pour la traçabilité anti-abus (6.1.f) |
| Conservation | **[NC]** Contradiction — voir §3 |
| Sécurité | **Bonne** : token 256 bits haché, pas de compte, données minimisées |

**[BP]** La pseudonymisation de l'IP (`hashIp`, SHA-256 salé tronqué à 16 caractères) et
la réduction de l'User-Agent à une famille sont une application exemplaire de la
minimisation (art. 5.1.c). À conserver.

### T4 — Contenus éditoriaux (images et vidéos)

| Élément | Valeur |
|---|---|
| Personnes concernées | **Tiers photographiés** : personnel des clients, passants, clients des commerces |
| Données | Images et vidéos de personnes identifiables |
| Finalité | Production et publication de contenus sur les réseaux sociaux |
| Base légale | **[NC] Non déterminée** |
| Conservation | Purge des originaux après publication ; aperçus 30 j par défaut |

> **[NC] Point le plus sous-estimé de l'audit.** L'application produit et publie des
> visuels susceptibles de contenir des personnes identifiables. Rien dans le code ni dans
> les documents ne traite du **droit à l'image** ni de la base légale de ce traitement.
> Le droit à l'image relève en France de l'art. 9 du Code civil et exige en principe le
> **consentement** de la personne représentée ; s'y ajoute la base légale RGPD.
> Une procédure de recueil d'autorisation (modèle de décharge) et une conduite à tenir en
> cas de demande de retrait sont à mettre en place.
>
> **[BP]** La purge automatique des originaux après publication est en revanche une
> excellente pratique de minimisation.

### T5 — Notifications par e-mail

| Élément | Valeur |
|---|---|
| Données | Nom, e-mail, lien de validation |
| Base légale | Contrat (6.1.b) — e-mails **transactionnels**, non commerciaux |
| Sous-traitant | Resend |
| Hébergement | **[IM]** À confirmer — Resend est une société américaine |

**[BP]** Aucune prospection commerciale ni newsletter n'a été trouvée dans le code : les
envois sont strictement transactionnels. L'art. L.34-5 du Code des postes et des
communications électroniques (consentement préalable) **ne s'applique donc pas** en l'état.

### T6 — Satisfaction client

Notes de 1 à 3 par fiche (`client_sheet_ratings`). Finalité : amélioration du service.
Base légale : intérêt légitime. **[IM]** Aucune information des personnes sur ce
traitement, ni durée de conservation.

**Aucune décision automatisée ni profilage au sens de l'art. 22** n'a été trouvé.
**Aucune fonctionnalité d'IA** n'est présente dans le code : les sections « prompt
injection », « entraînement de modèle sur données clients » du périmètre d'audit sont
**sans objet**. Le module de hashtags est explicitement marqué *« sans IA »* et repose sur
une bibliothèque statique et un mélange déterministe.

**Aucune donnée de mineur** n'est traitée par conception (clientèle professionnelle),
mais des mineurs peuvent apparaître sur les visuels (T4) — ce qui renforce l'exigence du §T4.

---

## 2. Matrice de conformité

| Exigence | État | Classement | Élément constaté |
|---|---|---|---|
| Information au moment de la collecte (art. 13) | Partiel | **[NC]** | Encart sur le portail client uniquement ; rien pour l'équipe |
| Politique de confidentialité accessible | Externe | **[IM]** | Lien vers `lyftt.fr/politique-de-confidentialite`, hors dépôt, contenu non vérifiable |
| Registre des traitements (art. 30) | Absent | **[NC]** | Aucun document dans le dépôt |
| Base légale documentée par traitement | Absent | **[NC]** | Déduite du code, jamais formalisée |
| Contrats de sous-traitance (art. 28) | Inconnu | **[IM]** | Vercel, Supabase, Resend |
| Liste des sous-traitants publiée | Absente | **[NC]** | — |
| Transferts hors EEE documentés | Absent | **[RP]** | Vercel (US) ; Resend **[IM]** |
| Durées de conservation définies | Partiel | **[NC]** | Purge médias/fiches codée ; rien pour comptes, contacts, RIB |
| Minimisation (art. 5.1.c) | **Conforme** | **[BP]** | IP pseudonymisée, UA réduit, purge des originaux |
| Protection dès la conception (art. 25) | Partiel | **[RP]** | Bonne intention (§19/§20 dans le code) mais `C-01` |
| Sécurité (art. 32) | **Insuffisant** | **[NC]** | `C-01` critique, pas de MFA, pas de chiffrement applicatif du RIB |
| Droit d'accès / rectification | Manuel | **[RP]** | Aucun outil ; possible via SQL |
| Droit à l'effacement | Partiel | **[RP]** | `deleteClient` et `deleteTeamMember` existent ; sous-traitants et sauvegardes non couverts |
| Droit à la portabilité | Absent | **[NC]** | Aucun export structuré des données personnelles |
| Droit d'opposition / limitation | Absent | **[NC]** | Non implémenté |
| Traçabilité des actions d'administration | Absente | **[NC]** | Aucun journal d'audit applicatif |
| Procédure de violation < 72 h (art. 33) | Absente | **[NC]** | Aucun document |
| AIPD nécessaire ? | **Probablement non** | **[BP]** | Pas de traitement à grande échelle ni de données sensibles |
| DPO nécessaire ? | **Probablement non** | — | Ni autorité publique, ni suivi systématique à grande échelle (art. 37) |

### Sur l'AIPD et le DPO

L'analyse d'impact (art. 35) ne paraît **pas obligatoire** : pas de données sensibles au
sens de l'art. 9, pas de surveillance systématique à grande échelle, pas de décision
automatisée. La désignation d'un DPO ne semble pas non plus obligatoire (art. 37).
Ces deux conclusions restent **à valider par un professionnel** au regard de la volumétrie
réelle et des lignes directrices du CEPD, que le code seul ne permet pas d'établir.

---

## 3. Contradiction sur les durées de conservation — **[NC]**

C'est l'écart le plus net entre le discours et l'implémentation.

**Ce qui est annoncé au client** (`PrivacyNotice.tsx`) :

> « Nous conservons ces éléments le temps de la prestation, puis pendant la durée prévue
> à votre contrat. »

**Ce que fait le code** (`purge-media/route.ts`) : suppression **définitive et en cascade**
des fiches dont `period_end` remonte à plus de **14 jours** — emportant publications,
versions, **validations client** et tickets.

Deux problèmes distincts :

1. **Information inexacte** des personnes concernées (art. 13.2.a).
2. **Perte de la preuve de validation contractuelle** au bout de 14 jours, alors que la
   prescription commerciale de droit commun est de **5 ans** (art. L.110-4 du Code de
   commerce). En cas de litige sur un contenu publié, l'agence ne disposerait plus de la
   trace de l'accord du client.

**Recommandation :** dissocier la purge des **médias** (justifiée : volumétrie et
minimisation) de la conservation des **preuves de validation** (à archiver, sous forme
minimale : qui, quoi, quand), et aligner l'information client sur la pratique réelle.

---

## 4. Cookies et traceurs

Inventaire établi par recherche exhaustive dans le code source sur `document.cookie`,
`localStorage`, `sessionStorage`, `cookies().set`, et les motifs usuels de traceurs
(analytics, publicité, chat, vidéo, réseaux sociaux).

**Résultat : un seul point d'écriture** — `src/lib/supabase/server.ts:20`, les cookies de
session Supabase.

| Nom | Fournisseur | Finalité | Durée | Domaine | Partie | Consentement |
|---|---|---|---|---|---|---|
| `sb-<ref>-auth-token` (et variantes fragmentées) | Supabase | Session d'authentification | Session / durée du jeton de rafraîchissement | 1re partie | Première | **Non requis** — strictement nécessaire |

### Conclusion — **[BP]**

**Aucun bandeau de consentement n'est requis en l'état.** Les seuls traceurs déposés sont
strictement nécessaires à la fourniture d'un service expressément demandé par
l'utilisateur : ils bénéficient de l'exemption prévue à l'**art. 82 de la loi
Informatique et Libertés** et rappelée par les lignes directrices cookies de la CNIL.

**Aucun traceur publicitaire, analytique, de mesure d'audience ou de réseau social n'a
été trouvé.** C'est un point de conformité remarquable, à préserver : l'ajout ultérieur
d'un outil de mesure d'audience (Google Analytics, Plausible, Vercel Analytics…) ferait
immédiatement basculer le service dans l'obligation de recueillir un consentement
préalable — avec bandeau, refus aussi simple que l'acceptation, et conservation de la
preuve.

**[IM]** À vérifier hors dépôt : la configuration Vercel Analytics / Speed Insights,
activable depuis le tableau de bord **sans modification du code**.

---

## 5. Écarts et actions prioritaires

| Priorité | Action | Article | Délai |
|---|---|---|---|
| 1 | Corriger `C-01` (sécurité, art. 32) | art. 32 | 24 h |
| 2 | Aligner l'information client sur les durées réelles, ou l'inverse | art. 13 | 7 j |
| 3 | Archiver les preuves de validation avant purge | art. 5.1.e + L.110-4 C. com. | 7 j |
| 4 | Établir le registre des traitements | art. 30 | 30 j |
| 5 | Signer les DPA (Vercel, Supabase, Resend) et publier la liste | art. 28 | 30 j |
| 6 | Encadrer le droit à l'image sur les visuels produits | art. 9 C. civ. + RGPD | 30 j |
| 7 | Documenter les transferts hors EEE et leurs garanties | chap. V | 30 j |
| 8 | Définir et appliquer les durées (comptes, contacts, **RIB**) | art. 5.1.e | 30 j |
| 9 | Outiller les droits des personnes (accès, effacement, portabilité) | art. 15-20 | 60 j |
| 10 | Journal d'audit des actions d'administration | art. 32 | 60 j |
| 11 | Procédure de notification de violation < 72 h | art. 33 | 30 j |
