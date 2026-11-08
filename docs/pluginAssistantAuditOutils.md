# Audit des outils de l'assistant (phase 2, lecture seule)

Date : 2026-11-08
Périmètre : `src/lib/chat-tools.ts` (1142 lignes), `src/app/api/chat/route.ts`, `src/app/api/mcp/route.ts`, `src/app/api/user/api-token/route.ts`, `src/app/actions/chat-briefing.ts`
Référence d'upstream : `origin/main` au commit `687652df`
Méthode : lecture du code, aucune exécution contre la base, aucune modification d'outil. Toute affirmation porte un `fichier:ligne`. Ce qui n'a pas été prouvé est marqué « non vérifié ».

## 0. Synthèse

Constats classés par gravité.

| # | Constat | Classe | Section |
|---|---|---|---|
| 1 | Un collaborateur en consultation ou membre peut générer un jeton MCP pour le compte du propriétaire, puis écrire toutes les données du propriétaire par `/api/mcp`. | Sécurité, critique | 3.2 |
| 2 | Un collaborateur en consultation peut écrire les données du propriétaire par le chat : aucun refus de mutation n'existe dans le plugin, alors que le noyau dit le contraire. | Sécurité, grave | 3.1 |
| 3 | `delete_culture` supprime les ventes comptables liées aux récoltes, là où upstream refuse (exercice potentiellement déclaré, factures, lots). | Intégrité, grave | 1.10 |
| 4 | `get_especes` ne filtre pas la visibilité du référentiel : les espèces privées d'autres comptes sont listées. `create_culture` accepte un `especeId` privé d'un autre compte. | Sécurité | 2, 1.2 |
| 5 | `delete_variete_perso` supprime sans compter les cultures liées (variété remise à `NULL`) et efface le stock de graines (cascade). `delete_planche` ne compte pas les interventions. | Intégrité | 1.9, 1.5 |
| 6 | Aucun outil d'écriture sauf deux n'invalide le cache KPI ; aucun n'invalide le cache d'irrigation. Les chiffres du tableau de bord restent périmés. | Intégrité | 1 |
| 7 | Lectures fausses : filtre d'état de `get_cultures`, unité des récoltes, `get_planification` limité aux ITP personnels, `get_dashboard_stats` hors source de vérité KPI. | Intégrité | 2 |
| 8 | `fetchDailyBriefing(userId)` accepte un identifiant fourni par le client, sans contrôle d'identité. | Sécurité, moyen | 3.4 |

Recommandation : approche A (appel en processus des handlers d'upstream) pour l'écriture dans une session, complétée par l'usage direct des bibliothèques publiques d'upstream pour la lecture, avec un refus de lecture seule explicite côté plugin. Le chemin MCP par jeton ne peut pas passer par A : il passe en lecture seule tant qu'il n'est pas refondu. Détail en section 4.

Corrections au contexte transmis avec la demande d'audit :
- Le chemin « recolte » n'est pas le seul service réutilisable. Le code d'upstream expose déjà des bibliothèques qui portent l'essentiel des règles : `src/lib/cultures/suppression.ts` (`compterVentesRecoltesCulture`, `aDesVentes`, `messageSuppressionCultureRefusee`), `src/lib/planches/traces.ts` (`compterTracesPlanches`, `refusSuppressionPlanche`), `src/lib/interventions/references.ts`, `src/lib/cultures/etat.ts`, `src/lib/cultures/execution.ts`, `src/lib/itp-acces.ts`, `src/lib/referentiel-communaute.ts`, `src/lib/rotation-check.ts`, `src/lib/validations/*`. Ce qui reste dans les `route.ts`, c'est l'enchaînement des contrôles et les réponses HTTP.
- `src/lib/planches/traces.ts:12-13` écrit : « Toute suppression passe par cette fonction : route, conversion en objet du plan, assistant ». Notre assistant ne l'appelle pas.
- `src/lib/verger/creation-arbre.ts:7-14` raconte exactement le même défaut sur l'assistant privé d'upstream (outil `create_arbre` qui écrit par `prisma.arbre.create` et contourne le calendrier d'entretien). Le piège est connu d'upstream.
- Lignes des outils confirmées : 508, 607, 713, 805, 872, 904, 956, 981, 1031, 1059 (lignes `name:`). 32 lignes contiennent `prisma.` dans le fichier, dont 2 dans l'aide `resoudreEspeceParNom`.
- Les tailles de `cultures/route.ts` (641) et `interventions/route.ts` (803) sont exactes.

## 1. Outils d'écriture : ce que la route d'upstream fait et que l'outil ne fait pas

Légende de classe : I = intégrité des données, S = sécurité, C = cosmétique.

Toutes les routes d'upstream d'écriture commencent par `requireAuthApi()` : le tenant est donc `session.user.id`. Les outils reçoivent `userId` et l'utilisent comme tenant dans le chat (section 3).

### 1.1 `create_intervention` (l.508) contre `POST /api/interventions` (`interventions/route.ts:535-637`)

Appel de l'outil : `prisma.intervention.create` (`chat-tools.ts:585`).

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Validation zod `createInterventionSchema` (types, nombres coercés, AMM) | :541, `validations/intervention.ts:7,14,46` | Contrôle manuel du seul `type` ; `Number(dureeMinutes)` non borné | I |
| Une intervention réalisée (`fait`) ne peut pas être datée de plus de demain | :551-554, `interventions/date-realisee.ts:19` | Absente : `fait` vaut `true` par défaut et la date est acceptée telle quelle | I |
| Vérification des références (culture, arbre, planche appartiennent au tenant) | :555-556, `interventions/references.ts` | Non applicable : l'outil n'expose ni `cultureId` ni `plancheId`. Écart latent dès qu'on les ajoute. | C |
| Verrou des règlements dans la transaction | :559-560, `comptabilite/verrou-reglements.ts` | Absent | I |
| Écriture comptable dérivée si `coutTotal` > 0 | :608-610, `auto-compta` | Non applicable aujourd'hui (pas de champ de coût). Écart latent. | I |
| `invalidateKpi` | :629 | Absent | I |
| `irrigationCache.invalidateUser` (un arrosage nourrit le bilan hydrique) | :630 | Absent : un arrosage noté par chat n'apparaît pas dans le bilan hydrique avant expiration du cache | I |
| Réponse d'erreur fautive : détail Prisma renvoyé au modèle | `chat-tools.ts:598-604` | Le message brut d'exception part dans le résultat de l'outil | C |

### 1.2 `create_culture` (l.607) contre `POST /api/cultures` (`cultures/route.ts:189-640`)

Appel de l'outil : `prisma.culture.create` (`chat-tools.ts:688`).

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Validation `createCultureSchema` | :197 | Aucune (`Number(annee)` peut valoir `NaN`) | I |
| Dates ramenées au jour civil (`normaliserDatesCreationCulture`) | :212 | `new Date(String(...))` brut : un instant avec fuseau n'est pas ramené au jour | I |
| Étape déjà faite : date recalée au jour courant, plan mémorisé (`ecrituresPassageAFait`) | :228-234 | `semisFait` / `plantationFaite` posés sans toucher aux dates | I |
| Espèce visible par le tenant (`visibiliteReferentiel`) | :243-253 | `especeId` fourni **n'est pas vérifié** (`chat-tools.ts:620-622`) ; la résolution par nom ne voit pas les espèces partagées à la communauté (`:47-59`, `OR userId / null`) | S puis C |
| Variété visible et rattachée à l'espèce | :265-286 | Non applicable (pas de `varieteId`) | C |
| Placeholder de variété pour qu'aucune culture n'en soit dépourvue (`ensurePlaceholderVariete`) | :582 | Absent : culture créée sans variété | I |
| Détection de violation de rotation, refus 409 sans `confirmRotation` | :284-296 | Non applicable (pas de planche). Écart latent. | I |
| ITP utilisable (`whereItpUtilisable`) et décalage de zone | :310, :340-350 | Non applicable (pas d'ITP) | C |
| Validation des dates contre l'ITP (récolte avant plantation refusée) | :404-430 | Absente : une récolte antérieure au semis est enregistrée | I |
| Quantité déduite (`quantiteCultureACreer`) | :392 | Absente | C |
| Verdict d'occupation de la planche, chevauchement | :440-519 | Non applicable (pas de planche) | I latent |
| `aIrriguer` automatique | :543-551 | Absent | C |
| Transaction | :579 | Absente | C |
| `invalidateKpi` | :622 | Absent | I |
| `masquerReferentielsEmbarques` sur la réponse | :625 | Réponse limitée à des noms : sans objet | C |

Remarque : l'outil ne peut ni rattacher la culture à une planche ni choisir une variété ou un ITP. Les contrôles de rotation, d'occupation et de verdict ITP ne sont pas « manquants » aujourd'hui, ils sont inatteignables ; ils le deviennent à la première extension de l'outil.

### 1.3 `update_culture` (l.713) contre `PATCH /api/cultures/[id]` (`cultures/[id]/route.ts:478-712`)

Appel de l'outil : `prisma.culture.update` (`chat-tools.ts:778`), avec contrôle de propriété correct (`:750`).

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Conduite en semis direct : pas d'étape de plantation à marquer, refus 409 | :600-607 | Absente | I |
| Annulation d'une étape refusée si des récoltes existent, refus 409 | :610-620 (calcul `etapesAnnulees` :585) | Absente : `recolteFaite=false` accepté avec récoltes enregistrées | I |
| Cohérence du cycle (annuler l'amont en laissant l'aval fait), refus 409 | :625-639 | Absente | I |
| Écritures de passage à fait et de retour à non fait (`ecrituresPassageAFait`, `ecrituresRetourANonFait`) | :677-679 | Absentes : on peut marquer la récolte faite sans plantation | I |
| Dates ramenées au jour civil, `finRecolte` validée | :692 | Absentes | I |
| `invalidateKpi` | :705 | Absent | I |
| Validation `updateCultureSchema` (pour les changements de quantité, qui passent par `PUT`) | `[id]/route.ts:180` | Absente | I |

### 1.4 `create_planche` (l.805) contre `POST /api/planches` (`planches/route.ts:95-150`)

L'outil réutilise déjà `createPlancheSchema` (`chat-tools.ts:834`) et refuse les doublons (`:838-843`) : c'est le moins écarté des outils.

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Surface arrondie à 2 décimales (`surfacePlanche`) | :131, `planches/surface.ts:12-17` | `largeur * longueur` non arrondi | C |
| Données persistées issues du résultat validé (champs inconnus écartés) | :137-145 | Construction à partir des arguments bruts | C |
| Description de l'outil : « Supprime définitivement les données existantes si une planche du même nom existe déjà » | n/a | Faux : le code refuse. Le modèle peut demander une confirmation inutile ou renoncer. | C |

`invalidateKpi` est présent (`chat-tools.ts:863`).

### 1.5 `delete_planche` (l.872) contre `DELETE /api/planches/[id]` (`planches/[id]/route.ts:175-225`)

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Refus 409 si une culture **ou une intervention** retient la planche (`refusSuppressionPlanche`) | :205-208, `planches/traces.ts:1-30` | Compte seulement les cultures (`chat-tools.ts:885-890`). Une intervention saisie sur la planche survit avec un `planche_id` orphelin (pas de clé étrangère) : l'emplacement disparaît du registre phyto. | I |
| Résolution par identifiant ou nom (`resoudreIdPlanche`) | :187, `planches/resolution.ts:30` | Par nom exact seulement | C |
| Message de refus nommant les années des cultures et un lien | :203-208 | Message générique | C |

`invalidateKpi` présent (`chat-tools.ts:895`).

### 1.6 `create_objet_jardin` (l.904) contre `POST /api/objets-jardin` (`objets-jardin/route.ts:41-65`)

La route d'upstream n'a aucune validation (`body.type`, `body.largeur` bruts). L'outil est plus strict (type énuméré, dimensions positives). Écart restant : `rotation2D` non posé (la route met `|| 0`), `parcelleGeoId` non contrôlé dans les deux cas. Aucune règle métier perdue. Classe : C.

### 1.7 `delete_objet_jardin` (l.956) contre `DELETE /api/objets-jardin/[id]` (`objets-jardin/[id]/route.ts:66-95`)

Même contrôle de propriété (`findUnique` avec `userId`), même suppression. `Number(args.objetId)` peut valoir `NaN` (la route refuse « ID invalide », :73-75) : erreur Prisma renvoyée au lieu d'un refus propre. Classe : C.

### 1.8 `create_variete_perso` (l.981) contre `POST /api/varietes` (`varietes/route.ts:162-260`)

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Libellé conservé tel que saisi, seule la clé de dédup est normalisée (`displayReferentielName`) | :187, ticket cmswxyuoi | `cleanReferentielName` (`chat-tools.ts:1004`) remplace tirets et soulignés par des espaces (`normalize.ts:83-88`) : « Marc-Phacélie » devient « Marc Phacélie » | I (libellé) |
| Validation `createVarieteSchema` | :171 | Aucune : `semaineRecolte`, `dureeRecolte` non bornées | I |
| Espèce parente visible (`visibiliteReferentiel`) | :195 | Résolution `OR userId / null` : les espèces communautaires ne sont pas trouvées | C |
| Attribution perso ou officielle (`attributionCreation`) | :189 | `userId` = tenant, `partageCommunaute=false` : équivalent pour un non-admin | C |
| Dédup 409 scopée par origine | :209-234 | Dédup équivalente, mais en message d'erreur | C |
| Stock saisi avec la variété, transaction (`enregistrerStockVariete`) | :243-260 | Absent, non exposé | C |
| Description de l'outil : « Supprime définitivement les données existantes si une variété du même nom existe » | n/a | Faux : le code refuse | C |

### 1.9 `delete_variete_perso` (l.1031) contre `DELETE /api/varietes/[id]` (`varietes/[id]/route.ts:180-235`)

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Refus 409 si des cultures utilisent la variété | :219-225 | Absent. `Culture.varieteId` est en `onDelete: SetNull` (`schema.prisma:1367`) : les cultures perdent leur variété, et l'invariant « aucune culture sans variété » (`cultures/route.ts:580-582`) est cassé | I |
| Stock de graines de la variété | cascade `schema.prisma:3828` | `UserStockVariete` supprimé en cascade, sans le dire | I |
| Contrôle de propriétaire | :214 (403) | Présent (`chat-tools.ts:1046-1048`) | n/a |

### 1.10 `delete_culture` (l.1059) contre `DELETE /api/cultures/[id]` (`cultures/[id]/route.ts:719-800`)

| Règle ou effet d'upstream | Ligne upstream | Dans l'outil | Classe |
|---|---|---|---|
| Refus 409 si des lots sont liés à des bons ou factures (`mouvementStockCommercial`) | :752 | Absent. Le schéma met `Recolte` en cascade depuis `Culture` (`schema.prisma:1439`) mais `MouvementStockCommercial.recolteId` en `NoAction` (`schema.prisma:4950`) : la base fera échouer la suppression, donc protection accidentelle et message d'erreur brut | I |
| Refus 409 si une récolte est vendue, facturée ou porte une vente (`compterVentesRecoltesCulture`, `aDesVentes`) | :756-761, `cultures/suppression.ts:39-66` | **Absent. L'outil supprime les `venteManuelle` automatiques des récoltes** (`chat-tools.ts:1081-1087`). Le commentaire d'upstream (:754-755, audit 2026-10-08) décrit ce comportement comme le défaut qu'il a corrigé : écritures effacées de la comptabilité, exercice déjà déclaré compris. Une récolte facturée (`factureId`) est supprimée en cascade sans refus. | I, grave |
| Filtre `userId` sur la suppression des ventes | :773-780 | `deleteMany` sans `userId` (`chat-tools.ts:1081-1087`) : ciblé par identifiants de récoltes du tenant, donc pas de fuite, mais sans la ceinture | C |
| `invalidateKpi` | :793 | Absent | I |

Le prompt demande une confirmation avant suppression (`chat.ts:20`). Une consigne de prompt n'est pas un contrôle : voir 3.5.

### 1.11 Bilan des classes

- Intégrité (I) : 1.1, 1.2, 1.3, 1.5, 1.8, 1.9, 1.10, plus l'absence d'invalidation KPI sur 8 outils sur 10.
- Sécurité (S) : 1.2 (`especeId` non contrôlé).
- Cosmétique (C) : le reste.

## 2. Outils de lecture

Tous les outils filtrent sur `userId` (le tenant dans le chat), sauf `get_especes`.

| Outil (ligne) | Tenant | Visibilité du référentiel | Filtre d'état | Écart | Classe |
|---|---|---|---|---|---|
| `get_meteo_parcelles` (l.95) | oui (`parcelleGeo.userId`) | n/a | n/a | aucun | n/a |
| `get_cultures` (l.157) | oui (`:169`) | n/a (renvoie des noms) | **incohérent** | Le filtre `etat` est un `switch` local (`:182-205`) qui diverge de `whereEtatCulture` (`lib/cultures/etat.ts:42-55`) : « Planifiée » ne teste pas `recolteFaite` ni `plantationFaite`, « Semée » ne teste pas `recolteFaite`. Une culture récoltée sans semis enregistré passe le filtre « Planifiée » et s'affiche « En récolte » (même défaut que le ticket cmsp59tdu corrigé par upstream). Pas de pagination au-delà de 50. | I |
| `get_planches` (l.243) | oui (`:253`) | n/a | n/a | aucun écart de règle | n/a |
| `get_recoltes` (l.282) | oui (`:294`) | n/a | n/a | La colonne `quantiteKg` est la quantité brute, exprimée dans `Recolte.unite` (`schema.prisma`, commentaire « dans l'unité ci-dessous », l'unité de référence est `unite`, pas le kilo). Des litres ou des oeufs sont annoncés en kg. | I |
| `get_especes` (l.331) | **non** (`_userId` ignoré, `:341`) | **non** | n/a | `where` sans visibilité : toutes les espèces, y compris les espèces privées d'autres comptes. Upstream filtre par `visibiliteReferentiel` et masque le propriétaire (`especes/route.ts:161,203`). | S |
| `get_stocks` (l.372) | oui (`userStock*.userId`) | n/a | n/a | aucun | n/a |
| `get_planification` (l.426) | **trop strict** | **non** | n/a | `iTP.findMany({ where: { userId } })` (`:436`) ne renvoie que les ITP personnels : le référentiel officiel (userId nul) est invisible, donc le résultat est vide pour la plupart des comptes. Le paramètre `annee` est ignoré. Upstream applique `whereItpUtilisable` (visible et actif, `itp-acces.ts:26`) puis la règle de zone ; le commentaire `itp-acces.ts:15-18` décrit le même défaut sur l'ancien assistant (122 ITP vus sur 673). | I |
| `get_dashboard_stats` (l.458) | oui | n/a | partiel | Chiffres recomposés hors de la source de vérité KPI (`lib/kpi`, `getKpiMaraichage`, `dashboard/route.ts:9`) : `surfaceCultivee` est la somme de toutes les planches, `recoltesAnneeKg` additionne des unités différentes, `tachesSemaine` compte des cultures et non des tâches. Ces valeurs divergeront du tableau de bord. | I |

Aucun outil de lecture ne passe par `masquerReferentielsEmbarques`, sans conséquence aujourd'hui car ils ne renvoient que des noms et des identifiants d'espèce.

## 3. Sécurité

### 3.1 `/api/chat` : session et tenant corrects, mais aucun refus de mutation

Ce qui est correct :
- `api/chat/route.ts:26` appelle `requireAuthApi(request)`. `requireAuthApi` résout le contexte (`auth-utils.ts:154`, `appliquerContexteExploitation` :53-72) et rend `user.id` = tenant, `user.acteurId` = personne. Le chat reçoit `session.user.id` (`:28`), donc le tenant. C'est l'identifiant à utiliser pour des données métier (en-tête de `auth-utils.ts:1-18`).
- Rate limit par IP : `auth-utils.ts:139-142`, 100 requêtes par 15 minutes, clé `api:${ip}` ; `getClientIP` prend le dernier élément de `x-forwarded-for` (`rate-limit.ts:80-89`). Compteur en mémoire (`rate-limit.ts:13`), donc par processus.
- Une session de consultation admin (impersonation) ne peut pas utiliser le chat : `middleware.ts:106-118` évalue `motifInterdictionConsultation` avant toute sortie publique, et une requête POST vaut `"MUTATION"` (`impersonation-policy.ts:37-55`, :48 pour le test de méthode) : réponse 403. Preuve par lecture, non exécutée.

Ce qui ne l'est pas : le refus d'écriture pour un rôle en lecture seule.
1. `requireAuthApi` ne refuse que si l'en-tête `x-gleba-mutation` vaut `"1"` (`auth-utils.ts:159-162`, `requeteCouranteEstMutation` :80-89).
2. Le middleware pose cet en-tête (`middleware.ts:35`) via `valeurEnteteMutation` (`entete-mutation.ts:81-86`), qui rend `"0"` pour tout chemin de `CHEMINS_HORS_EXPLOITATION`, dont `"/api/chat"` (`entete-mutation.ts:59`).
3. Donc pour un POST sur `/api/chat`, un acteur de rôle `CONSULTATION` (`peutEcrire: false`, `roles.ts:121` ne donne l'écriture qu'à `MEMBRE`) passe la garde.
4. Le commentaire d'upstream annonce la suite : « `/api/chat` y figure pour que l'assistant reste consultable ; ses outils de MUTATION sont refusés séparément, à l'exécution (cf. `api/chat/route.ts`) » (`entete-mutation.ts:41-43`). Notre `api/chat/route.ts` n'en contient aucun, et `chat-tools.ts`, `chat.ts`, `chat-*-tools.ts`, `chat-codex.ts` ne référencent ni `peutEcrireExploitation`, ni `refusSiLectureSeule`, ni `LECTURE_SEULE` (recherche textuelle dans ces fichiers : aucune occurrence).
5. Les outils reçoivent `userId` = tenant (`chat.ts:117,137-156`, puis `executerOutil(…, userId)` dans chaque boucle de provider). Les écritures s'appliquent donc aux données du propriétaire.

Conclusion : un collaborateur `CONSULTATION` peut, en formulant une demande au chat, faire exécuter `create_culture`, `delete_planche`, `delete_culture`, etc. sur l'exploitation du propriétaire. Un compte `MEMBRE` a le droit d'écrire, donc n'est pas concerné. La restriction par module (`modulesExploitation`) n'est pas appliquée non plus : `moduleAutorise` (`roles.ts:126`) n'a aucun appelant hors tests, et upstream ne l'applique visiblement qu'à l'affichage (`composition.server.ts:129`) ; aucun outil de chat ne la vérifie.

Mise en garde : cet état suppose que des collaborateurs existent dans l'instance (fonction ajoutée le 2026-08-19). Une instance sans adhésion n'est pas exposée. Non vérifié sur une base réelle.

### 3.2 `/api/mcp` et `/api/user/api-token` : escalade de privilège

Route MCP (`api/mcp/route.ts`) :
- Authentification : jeton porteur en clair, `prisma.user.findFirst({ where: { apiToken: token } })` (`:35`). Le champ est `@unique` (`schema.prisma:92`) et stocké en clair.
- Elle ne passe jamais par `requireAuthApi` : aucune résolution tenant ou acteur (`appliquerContexteExploitation` non appelée), aucun refus de mutation en lecture seule (`refusMutationSiLectureSeule` non appelée), aucun rate limit (`checkRateLimit` absent).
- Elle appelle `executerOutil(tool, args, user.id)` (`:75`) avec l'identifiant du propriétaire du jeton, sans rôle ni module.
- Le middleware l'exempte de la session (`middleware.ts:85,120`).

Effet pour un jeton appartenant à un membre : `user.id` est l'identifiant de la personne, pas du tenant. Ses écritures vont dans son propre espace, pas dans l'exploitation partagée. Ce n'est pas une fuite, mais c'est incohérent avec le chat (tenant).

La faille vient de la route de gestion du jeton :
1. `api/user/api-token/route.ts` appelle `requireAuthApi()` (`:15,40,68`) puis utilise `session!.user.id` (`:20,49,73`). Or `session.user.id` est le **tenant** (`auth-utils.ts:62-63`).
2. L'en-tête de `auth-utils.ts:1-18` classe pourtant « le jeton d'API » parmi les usages de `getActeurId`. La route de préférences le fait correctement (`api/user/preferences/route.ts:51`, `getActeurId(session)`).
3. `/api/user/api-token` est dans `CHEMINS_HORS_EXPLOITATION` (`entete-mutation.ts:50`) : l'en-tête vaut `"0"`, la garde de lecture seule ne s'applique pas.
4. Donc un membre, y compris en `CONSULTATION`, qui appelle `POST /api/user/api-token` exécute `prisma.user.update({ where: { id: <tenant> }, data: { apiToken } })` (`:47-52`) et reçoit en réponse le jeton complet (`:54-56`). Ce jeton appartient au compte du **propriétaire**.
5. Avec ce jeton, `POST /api/mcp` exécute les 10 outils d'écriture avec l'identifiant du propriétaire, sans aucune vérification de rôle.
6. Le même membre peut aussi lire le préfixe du jeton du propriétaire (`GET`, `:24-28`) et le révoquer (`DELETE`, `:73-75`), ce qui coupe les clients MCP légitimes.

Preuve par lecture de code, non exécutée. Pour confirmer sans toucher aux données : un test de route avec une session mockée `{ id: tenant, acteurId: membre }` doit montrer que `prisma.user.update` reçoit l'identifiant du tenant.

Pendant une consultation admin, `POST` et `DELETE` sur `api-token` sont refusés par le middleware (méthode non sûre, `impersonation-policy.ts:48`). `GET` reste possible et ne renvoie que le préfixe.

Autres points mineurs sur le jeton : stockage en clair (le jeton de capteur d'upstream est haché en SHA-256, `lib/capteurs/jeton.ts:11-17`) ; aucun rate limit sur `/api/mcp` ; le message d'erreur brut d'une exception est renvoyé au client MCP (`api/mcp/route.ts:88-92`).

### 3.3 Impersonation, résumé

| Chemin | Compte impersonné peut-il écrire ? | Preuve |
|---|---|---|
| `/api/chat` (POST) | Non, 403 par le middleware | `middleware.ts:106-118`, `impersonation-policy.ts:48` |
| `/api/mcp` avec cookie de session impersonné | Non, 403 par le même contrôle | idem |
| `/api/mcp` avec jeton porteur | Hors du périmètre de l'impersonation : aucune session. Voir 3.2. | `api/mcp/route.ts:19-35` |

### 3.4 Bonus : `fetchDailyBriefing(userId)` (`app/actions/chat-briefing.ts:6-12`)

Server action déclarée `"use server"` qui prend `userId` en paramètre et ne vérifie aucune identité : elle lit les tâches et alertes (`getDailyBriefingData`, `chat/daily-briefing.ts:17-21`) et écrit un marqueur (`markBriefingAsShown`) pour l'identifiant reçu. Les identifiants sont des cuid non devinables, ce qui limite l'exploitation, mais le principe est défaillant : une action serveur est un point d'entrée HTTP. Correctif de principe : lire la session côté serveur et ignorer le paramètre. Classe : sécurité, moyen.

### 3.5 Confirmation des suppressions

La demande de confirmation avant suppression n'existe que dans le prompt système (`chat.ts:20`). Sur le chemin MCP il n'y en a aucune. Un contrôle serveur (jeton de confirmation à usage unique, ou refus de suppression dans le même tour que la demande) serait le seul moyen de l'imposer. À décider par le mainteneur.

## 4. Comment réutiliser la logique d'upstream sans modifier ses fichiers

### 4.1 Faits établis sur l'authentification hors requête

- Les handlers d'upstream appellent `requireAuthApi()` **sans** argument (`cultures/route.ts:190`, `interventions/route.ts:536`, `planches/route.ts:96`) : le rate limit par IP (`auth-utils.ts:139`, conditionné à `request`) n'y est donc jamais appliqué, ni aujourd'hui ni dans un appel en processus.
- `requireAuthApi` appelle `auth()` (`auth-utils.ts:147`). Sous next-auth v5, `auth()` sans argument lit `headers()` de `next/headers` (`node_modules/next-auth/lib/index.js:45,91`) et en extrait le cookie (`index.js:12`). Il lit donc les en-têtes de la **requête Next courante**, pas ceux d'un objet `NextRequest` construit à la main.
- Conséquence : une fonction appelée dans la chaîne d'`await` du handler `/api/chat` voit les en-têtes de `/api/chat`, cookie compris. Un handler importé et appelé en processus s'authentifie donc comme l'utilisateur du chat, même avec un `NextRequest` synthétique.
- `requeteCouranteEstMutation` lit le même contexte (`auth-utils.ts:80-89`) : l'en-tête de mutation vu par un handler appelé en processus est celui de `/api/chat`, soit `"0"`. La garde de lecture seule ne se déclenche donc pas. Elle doit être posée explicitement par le plugin (`refusSiLectureSeule`, `garde-session.ts:39-46`, existe pour cela).
- Hors contexte de requête (script, tâche de fond, chemin MCP sans cookie), `headers()` lève une erreur capturée (`auth-utils.ts:85-87`, retourne `false`), et `auth()` rend `null` : 401.
- Les boucles de provider tournent à l'intérieur de la requête (`api/chat/route.ts:64`, réponse JSON attendue, pas de flux détaché). Aucun appel d'outil ne s'exécute en dehors de cette chaîne.

### 4.2 Comparaison

| Critère | A. Handlers en processus | B. fetch HTTP interne | C. Extraction de services dans les fichiers d'upstream |
|---|---|---|---|
| Faisabilité Next 16 | Oui. Les tests d'upstream le font déjà (`import { POST } from "./route"`, `cultures/route.test.ts:37`). Pour les routes `[id]`, passer `{ params: Promise.resolve({ id }) }` (les handlers font `await params`). | Oui, avec cookie transmis. Dépend de l'URL interne (`NEXTAUTH_URL`, port, proxy) et de la confiance d'hôte next-auth : non vérifié, aucun `trustHost` trouvé dans `lib/auth.ts`. | Oui |
| Session de l'utilisateur | Automatique par `headers()` ambiant | Explicite : cookie de la requête courante | Sans objet |
| Garde lecture seule d'upstream | Ne se déclenche pas (en-tête `"0"`). À poser dans le plugin. | Native : le middleware repose l'en-tête depuis la vraie méthode et le vrai chemin (`middleware.ts:35`) | À poser |
| Garde d'impersonation | Déjà couverte en amont (le chat est interdit) | Native | Idem A |
| Rate limit par IP | Inexistant dans les handlers (voir 4.1) | Inexistant aussi | Sans objet |
| Chemin MCP par jeton (sans cookie) | Impossible : pas de session ambiante, 401 | Possible seulement en fabriquant un cookie de session signé pour l'utilisateur du jeton (secret d'authentification côté serveur, nom de cookie et sel à vérifier : non prouvé) | Possible (les services prennent un `userId`) |
| Coût à chaque synchro | Faible : seul le contrat HTTP (corps de requête, forme de réponse) compte, c'est l'API que l'interface d'upstream consomme déjà | Faible, plus des pannes d'infrastructure possibles | Élevé : modifie `cultures/route.ts` (17 commits depuis le 2026-08-01), `cultures/[id]/route.ts` (16), `interventions/route.ts` (13) : conflit quasi certain à chaque synchro |
| Risques | Le handler renvoie une `NextResponse` dont il faut traduire statuts et messages (409, 400) en résultat d'outil ; les `console.error` d'upstream alimentent le journal ; dépendance au contexte ambiant (un futur appel hors requête casse) | Latence, double authentification, boucle réseau dans Docker, dérive de configuration d'hôte, jeton de session fabriqué à sécuriser | Le plus propre techniquement, mais incompatible avec « module greffé » tant qu'upstream n'a pas accepté la PR |
| Taille du changement dans le plugin | Un adaptateur d'environ 60 lignes, puis une réécriture de chaque outil d'écriture | Adaptateur plus cookie et URL de base, un peu plus long | Plusieurs centaines de lignes dans upstream |

Option complémentaire D (lecture et suppression), non demandée mais pertinente : composer directement les bibliothèques publiques d'upstream sans passer par la route. Pour la lecture, c'est le bon choix : `whereEtatCulture`, `visibiliteReferentiel`, `whereItpUtilisable`, `getKpiMaraichage`, `masquerReferentielsEmbarques`. Pour les écritures c'est plus risqué : l'enchaînement des contrôles reste dans la route, et un nouveau contrôle ajouté en ligne par upstream passerait inaperçu.

### 4.3 Recommandation

1. **Écriture en session : approche A**, avec trois ajouts :
   - appeler `requireAuthApi()` côté plugin avant l'adaptateur et refuser par `refusSiLectureSeule(session)` quand `peutEcrireExploitation === false`, pour combler 3.1 ;
   - traduire chaque réponse d'upstream en résultat d'outil sans rien perdre : `error`, `warnings`, `alerteSaison`, `rotationViolation` (un 409 de rotation devient une question posée à l'utilisateur, puis un second appel avec `confirmRotation: true`) ;
   - ajouter au vérificateur de contrat un contrôle de présence des routes d'upstream appelées et de leurs méthodes exportées.
2. **Lecture : approche D**, par les bibliothèques publiques (3 à 5 lignes par outil), pour corriger la section 2 sans réseau.
3. **Chemin MCP : lecture seule dans un premier temps**, avec résolution tenant par `resoudreContexteExploitation(acteur)` (`exploitation/membres.ts:41`). L'écriture par jeton demande de trancher entre B avec cookie de session fabriqué et une refonte du jeton ; aucune des deux n'est prouvée faisable dans cette session. C'est une décision à porter au mainteneur.
4. **C : à écarter**, sauf proposition de PR upstream portant uniquement sur des services de création (comme `recolte/creation.ts`) et acceptée avant de toucher le code.
5. **Correctifs de sécurité préalables**, indépendants du choix, à traiter en premier : `api-token` sur l'identifiant de la personne (`getActeurId`), refus de mutation dans le chat et le MCP, visibilité de `get_especes`, identité de `fetchDailyBriefing`.

### 4.4 Découpage en étapes testables

Les tests suivent le modèle des tests de routes d'upstream (`vi.mock('@/lib/auth-utils')`, `vi.mock('@/lib/prisma')`, voir `cultures/[id]/route.delete.test.ts:24-40`).

| Étape | Contenu | Test de non-régression |
|---|---|---|
| 0 | Correctifs de sécurité de 4.3, point 5 | `api-token` : une session `{ id: tenant, acteurId: membre }` met à jour `membre`, jamais `tenant` ; chat : un acteur `peutEcrireExploitation=false` reçoit un refus sur chaque outil d'écriture ; `get_especes` n'expose pas une espèce privée d'un autre compte ; `fetchDailyBriefing` ignore un identifiant étranger |
| 1 | Adaptateur `appelerRouteUpstream(handler, { methode, corps, params })` qui construit un `NextRequest`, appelle le handler, rend `{ ok, statut, corps }` | Cas nominal avec un handler factice ; cas de refus 409 traduit en `erreur` ; cas où le handler lève une exception |
| 2 | `delete_culture` : réponse de `DELETE /api/cultures/[id]` | Nominal : culture sans récolte supprimée. Refus d'upstream : culture avec récolte vendue, statut 409 et message de `messageSuppressionCultureRefusee`, **aucune** `venteManuelle` supprimée |
| 3 | `delete_planche`, `delete_variete_perso` | Planche avec intervention : refus 409 (`refusSuppressionPlanche`). Variété utilisée par une culture : refus 409 |
| 4 | `create_culture` et `update_culture` (PATCH) | Nominal. Refus : espèce privée d'un autre compte (400) ; récolte antérieure au semis (400) ; annulation d'étape avec récoltes (409) ; rotation violée (409, puis création avec `confirmRotation`) |
| 5 | `create_intervention` | Nominal ; intervention réalisée datée dans le futur (400) ; `irrigationCache.invalidateUser` et `invalidateKpi` appelés |
| 6 | `create_planche`, `create_variete_perso` | Nominal ; doublon (409) ; libellé de variété avec tiret conservé tel que saisi |
| 7 | `create_objet_jardin`, `delete_objet_jardin` : rester directs (aucune règle d'upstream perdue), avec test d'identifiant invalide | Identifiant `NaN` refusé proprement |
| 8 | Lecture : `get_cultures`, `get_recoltes`, `get_especes`, `get_planification`, `get_dashboard_stats` par les bibliothèques publiques | Test de parité avec `whereEtatCulture` ; unité des récoltes reprise ; ITP officiels visibles ; chiffres égaux à `getKpiMaraichage` |
| 9 | Test de contrat qui interdit le retour à `prisma.*.create/update/delete` direct dans `chat-tools.ts` pour les outils migrés | Recherche textuelle dans le source, sur le modèle de `chat-bubble-contrat.test.ts` |

Ordre justifié par la gravité : suppression comptable (étape 2) avant le reste.

## 5. Outils manquants pour verger, élevage et comptabilité (phase 4)

Information seulement. Pour chaque module, la source de vérité en lecture est la route d'upstream ou la bibliothèque indiquée. Tout outil de ces modules doit aussi vérifier `moduleAutorise(contexte, "<module>")` (`exploitation/roles.ts:126`), qui n'a aucun appelant côté serveur aujourd'hui.

### 5.1 Verger

| Besoin | Source de vérité |
|---|---|
| Liste et fiche des arbres | `src/app/api/arbres/route.ts` (GET), `src/app/api/arbres/[id]/` |
| Statistiques du verger | `src/app/api/arbres/stats/route.ts` |
| Opérations et soins d'entretien, tâches | `src/app/api/arbres/operations/`, `src/app/api/arbres/taches/`, `src/lib/verger/lien-operations-arbre.ts`, `src/lib/verger/operation-label.ts` |
| Récoltes d'arbres, lots, campagnes | `src/app/api/arbres/recoltes/`, `lots/`, `campagnes/`, `src/lib/verger/saison-recolte-arbre.ts`, `suivi-commercial.ts`, `disponibilite-lot.ts` |
| Délai avant récolte | `src/lib/verger/dar.ts` |
| Référentiel d'essences, porte-greffes | `src/app/api/verger/essences-disponibles/`, `porte-greffes/`, `referentiel/` |
| Création d'arbre (geste commun) | `src/lib/verger/creation-arbre.ts`, `creation-recolte.ts` : à réutiliser, c'est précisément le piège relevé dans le commentaire d'en-tête (`creation-arbre.ts:7-14`) |

### 5.2 Élevage

| Besoin | Source de vérité |
|---|---|
| Animaux, lots | `src/app/api/elevage/animaux/`, `lots/` |
| Effectif et priorités | `src/lib/elevage/effectif.ts`, `dashboard-priorites.ts`, `src/app/api/elevage/stats/route.ts` |
| Soins, échéances, soins à faire | `src/app/api/elevage/soins/`, `src/lib/elevage/echeances-soins.ts`, `soins-a-faire.ts` |
| Délais d'attente lait et viande (point de sécurité sanitaire) | `src/lib/elevage/attente-lait.ts`, `attente-viande.ts`, `attentes.ts`, `src/app/api/elevage/attentes/` |
| Naissances, mouvements de cheptel, pesées | `src/app/api/elevage/naissances/`, `mouvements-cheptel/`, `pesees/` |
| Lait, oeufs | `src/lib/elevage/bilan-lait.ts`, `stock-oeufs.ts`, `src/app/api/elevage/bilan-lait/`, `stock-oeufs/` |
| Tâches terrain | `src/app/api/elevage/taches/`, `taches-terrain/` |
| Registres réglementaires | `src/app/api/elevage/registre-sanitaire/` et voisins ; ces lectures ont des effets de bord listés dans `impersonation-policy.ts:9-21` : ne pas les exposer en lecture libre |

### 5.3 Comptabilité

| Besoin | Source de vérité |
|---|---|
| Indicateurs financiers | `src/lib/kpi` (`getKpiCompta`, export `kpi/index.ts:18`), `src/app/api/comptabilite/stats/route.ts`, `bilan/route.ts` |
| Dépenses, revenus, ventes manuelles | `src/app/api/comptabilite/depenses/`, `revenus/`, `ventes-manuelles/` |
| Factures, règlements, clients, fournisseurs | `src/app/api/comptabilite/factures/`, `reglements/`, `clients/`, `fournisseurs/`, `src/lib/comptabilite/reglements.ts`, `encours.ts`, `impayees.ts` |
| Ventilation par module | `src/lib/comptabilite/modules.ts:23` (`MODULES_COMPTA`), `ventilation-revenus.ts`, `revenus-cultures.ts` |
| Coûts de production, TVA, banque | `src/app/api/comptabilite/couts-production/`, `tva/`, `banque/` |
| Alertes | `src/lib/comptabilite/alertes.ts` |

Contraintes propres à la comptabilité : toute écriture doit passer par le verrou des règlements (`verrou-reglements.ts`) et par les routes d'upstream. Aucun outil d'écriture comptable ne devrait être écrit en `prisma.*` direct.

Hors modules : aucun outil `create_recolte` n'existe alors que le service d'upstream est prêt (`recolte/creation.ts:85`, `creerRecoltes(userId, entrees, uniteRequise)`). C'est le candidat naturel pour la première extension d'écriture, parce qu'il ne demande aucun adaptateur de route.
