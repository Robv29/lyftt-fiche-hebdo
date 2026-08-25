# Informations manquantes et éléments à obtenir

Questions auxquelles **le code seul ne permet pas de répondre**. Elles conditionnent
plusieurs conclusions de cet audit, notamment celles marquées « À confirmer ».

---

## 1. Bloquants pour terminer l'audit technique

| # | Question | Pourquoi | Impact |
|---|---|---|---|
| B-1 | **Autorisez-vous des tests actifs, et sur quel environnement ?** | `C-01`, `H-01`, `M-05` ne sont établis que par preuve documentaire | Confirmation dynamique des 3 constats |
| B-2 | Existe-t-il une préproduction ou une branche Supabase de test ? | Aucune n'a été trouvée ; un seul projet Supabase | Bloque `T-01` à `T-05` |
| B-3 | Politique de sauvegarde Supabase : PITR activé ? rétention ? restauration déjà testée ? | Non lisible depuis le code | `M-06`, RPO/RTO |
| B-4 | Accès aux journaux Vercel (fonctions, edge) | Vérifier si des données personnelles ou des secrets y transitent | Conformité art. 32 |
| B-5 | Vercel Analytics / Speed Insights activés dans le tableau de bord ? | Activables **sans modification du code** ; changeraient la conclusion « aucun traceur » | `03-rgpd-cookies.md` §4 |
| B-6 | Réglages Supabase Auth : complexité des mots de passe, limitation des tentatives, durée des jetons | Non lisibles depuis le dépôt | `M-04` |
| B-7 | Qui détient l'accès au tableau de bord Supabase et Vercel ? MFA activée sur ces comptes ? | Un accès console contourne toutes les protections applicatives | Risque équivalent à `C-01` |
| B-8 | ✅ **RÉSOLU 25/08 — non.** Aucun `remotePatterns` dans `next.config.ts`, et le seul média client affiché porte `unoptimized`. Aucun fichier client n'atteint `sharp` | — | Gravité réelle de `H-02` : faible |

---

## 2. Nécessaires à la conformité RGPD

| # | Élément | Pourquoi |
|---|---|---|
| R-1 | DPA signés avec **Vercel**, **Supabase**, **Resend** | Art. 28.3 — obligatoire |
| R-2 | Localisation d'hébergement de **Resend** | Transfert hors EEE éventuel (chap. V) |
| R-3 | Registre des traitements existant, s'il y en a un | Art. 30 |
| R-4 | ✅ **RÉSOLU 25/08 — la page n'existe pas** (404, et certificat TLS invalide sur le domaine). Une politique de confidentialité est désormais servie par l'application, vers laquelle le portail renvoie | — |
| R-5 | ⚠️ **PARTIEL 25/08** — **RIB : fin de gestion + 30 j**, arrêté et purge automatisée. Restent à définir : comptes, contacts, contenus | Aucune autre n'est définie hors la purge à 14 j |
| R-6 | Le contrat client prévoit-il la **validation tacite** ? | Sa validité juridique en dépend entièrement |
| R-7 | Procédure existante de recueil du droit à l'image | Traitement T4, non encadré |
| R-8 | Volumétrie réelle (nombre de clients, de contacts, de personnes sur les visuels) | Détermine l'obligation éventuelle d'AIPD |
| R-9 | Statut des membres de l'équipe (salariés / freelances) | Base légale et information des personnes |
| R-10 | Une violation de données est-elle déjà survenue ? | Obligation de documentation (art. 33.5) |

---

## 3. Nécessaires à la rédaction juridique

Aucun de ces éléments n'est déductible du code. Ils sont repris de
`04-documents-juridiques.md` §5 :

1. Dénomination sociale, forme juridique, capital, siège, RCS, TVA
2. Directeur de la publication
3. Adresses légales de Vercel Inc. et Supabase Inc.
4. Contrat de prestation type en vigueur
5. Clientèle exclusivement professionnelle, ou non
6. **Intention de commercialiser l'outil à d'autres agences** — change tout le corpus
7. Assurance RC professionnelle
8. Politique tarifaire, s'il y en a une

---

## 4. Points hors périmètre du code, à vérifier par vous

- **Sécurité des postes** de l'équipe (le rôle `super_admin` donne accès aux RIB).
- **Gestion des départs** : `deleteTeamMember` existe, mais aucune procédure n'est
  documentée — or `M-03` montre qu'une session survit à une désactivation.
- **Rotation des secrets** : `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`,
  `IP_HASH_SALT`. Aucune procédure constatée. *Attention : la rotation d'`IP_HASH_SALT`
  invaliderait la corrélation des empreintes d'IP existantes — effet voulu ou non, à décider.*
- **Surveillance et alertes** : aucun outil constaté. Une exploitation de `C-01` passerait
  aujourd'hui totalement inaperçue.
- **Plan de réponse à incident** : absent.

---

## 5. Ce que cet audit n'a pas couvert

Par honnêteté méthodologique, voici les limites de ce travail :

- **Aucun test dynamique** : pas de test d'intrusion, pas d'exploitation, pas de fuzzing.
  Tous les constats reposent sur l'analyse statique et sur des lectures en base.
- **Pas de revue exhaustive ligne à ligne** des 119 fichiers TypeScript. L'analyse a été
  dirigée vers les zones à risque (authentification, autorisation, RLS, routes publiques,
  actions serveur, secrets). Une revue complète pourrait révéler d'autres points.
- **Pas d'analyse du frontend** sous l'angle XSS DOM (`dangerouslySetInnerHTML` non
  recherché systématiquement — à faire).
- **Pas de revue de la configuration Vercel** (variables, domaines, protection de
  déploiement) ni de la console Supabase, faute d'accès.
- **Pas de vérification des e-mails** réellement envoyés (contenu, en-têtes, SPF/DKIM/DMARC).
- **Pas d'analyse de la chaîne d'approvisionnement** au-delà de `npm audit` : les 273 Ko
  de `package-lock.json` n'ont pas fait l'objet d'une revue de provenance.
- **Le portail `/demande/[token]`** a été vérifié plus succinctement que
  `/client-review/[token]` ; il suit le même motif, ce qui est rassurant sans valoir preuve.

Ces limites ne remettent pas en cause les constats établis — elles délimitent ce qui
reste à explorer.
