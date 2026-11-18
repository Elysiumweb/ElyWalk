# Déploiement ElyWalk

## 2.2.5 — déployer les règles **et** l'application

Cette version corrige trois défauts dont deux dépendent des règles Firestore :
les **validations de pas multiples** (`validStepCredit` réécrite) et la
suppression de **toutes** les conditions `email_verified` (désormais aucune
fonction n'est réservée aux comptes confirmés : pas, défis, amis, publicité,
parrainage, dépenses, retraits). Une application 2.2.5 avec des règles
antérieures serait refusée à la deuxième validation du jour et bloquerait encore
les récompenses des comptes non confirmés ; des règles 2.2.5 avec une
application antérieure fonctionnent (l'ancien client ne valide qu'une fois).

```bash
firebase deploy --only firestore:rules     # indispensable
cd app && npm run build && npx cap sync android
```

Vérifier ensuite, avec un compte **dont l'e-mail n'est pas confirmé** : valider
ses pas deux fois dans la même journée (deux crédits distincts), envoyer et
accepter une demande d'ami, ouvrir et encaisser un défi, regarder une vidéo
récompensée, demander un retrait. Tout doit fonctionner sans confirmation.

⚠️ Vérifier aussi la console Firebase : *Authentication → Méthodes de connexion
→ E-mail/Mot de passe* ne doit pas activer l'option « Exiger une vérification
par e-mail avant connexion », qui bloquerait l'accès **avant** même l'arrivée
dans l'application (ce réglage n'est pas versionné dans ce dépôt).

Côté itinéraires (`lib/directions.ts`), aucun déploiement serveur n'est
nécessaire : la chaîne Valhalla → OSRM → Transitous s'exécute depuis
l'application. Si les quatre moteurs publics sont injoignables, l'écran affiche
une estimation à vol d'oiseau explicitement annoncée plutôt qu'une erreur.

## Identifiant d'application (⚠️ à faire AVANT publication)

L'`applicationId` / `appId` est désormais **`com.elysium.elywalk`** (fini
`com.example.elywalk`). Après ce changement, il faut :

1. **Firebase Console** → Projet `elywalk-2f7ba` → *Paramètres projet* → *Vos
   applications* : ajouter une app Android `com.elysium.elywalk` avec la même
   empreinte SHA-1 (le keystore n'a pas changé), puis **retélécharger
   `google-services.json`** et remplacer `app/google-services.json` **et**
   `app/android/app/google-services.json`.
2. **Unity LevelPlay** : ajouter l'application Android `com.elysium.elywalk`
   (app key `29767936d`), créer les ad units et configurer les instances des
   réseaux (voir § « Unity LevelPlay » plus bas).
3. **Play Console** : créer la fiche de l'app avec `com.elysium.elywalk`.

Les réglages suivants ont déjà été propagés dans le code :
`capacitor.config.ts`, `android/app/build.gradle` (namespace + applicationId),
`android/app/src/main/res/values/strings.xml`, les classes Java
(`com/elysium/elywalk/*.java`).

## Icônes et splash (F01)

Les icônes launcher et les splash screen sont générées depuis le logo marcheur,
recoloré « or héritage » (#D8CA82) sur midnight black (#111111).

```bash
cd app
bash scripts/generate-assets.sh   # régénère tous les assets Android
```

## App Links — `assetlinks.json` (F07)

Le fichier `app/public/.well-known/assetlinks.json` est copié dans `dist/` puis
servi à la racine des deux domaines Hosting. Deux points sont déjà réglés dans le
repo : `firebase.json` n'ignore plus les dossiers `.well-known` (retrait de
`**/.*`), et Firebase Hosting sert les fichiers statiques avant les rewrites SPA.

Générer l'empreinte SHA-256 **du certificat de signature** :

```bash
cd app
bash scripts/generate-assetlinks.sh <keystore> <alias>
# ou, pour un APK déjà signé :
keytool -printcert -jarfile app-release.apk | grep SHA256
```

Puis `npm run build && firebase deploy --only hosting`.

## Règles de confidentialité — URL publique (exigence Play Store)

Le Play Store exige une politique de confidentialité hébergée sur une **URL publique**
(HTTPS, accessible dans le monde entier sans connexion, page HTML standard), et un lien
vers cette URL **dans l'application**.

- Fichier source : `app/public/privacy.html` (page statique autonome, CSS inline).
- Copié tel quel dans `app/dist/` par `npm run build`, donc servi par Firebase Hosting.
- **URL à renseigner dans la fiche Play Store** :

  ```
  https://elywalk-2f7ba.web.app/privacy.html
  ```

  (fonctionne aussi sur `https://elywalk-2f7ba.firebaseapp.com/privacy.html`)

La constante `PRIVACY_POLICY_URL` (`app/src/lib/constants.ts`) pointe vers cette URL et
est utilisée à trois endroits : la page *Confidentialité* de l'app, le consentement à
l'inscription (`AuthPage`) et le pied de page du profil.

Checklist Play Store :

- [ ] *Play Console → Politique → Règles de confidentialité* : coller l'URL ci-dessus.
- [ ] L'URL répond en 200 sans authentification, sans redirection et sans géoblocage.
- [ ] Le contenu couvre bien : données d'activité physique (santé), localisation,
      identifiants appareil (IP, HWID, jeton FCM, ID publicitaire), publicité
      Meta Audience Network, sous-traitants (Firebase, Meta, Cloudflare, PayPal, ipify),
      durées, droits RGPD.
- [ ] Cohérence avec la fiche *Sécurité des données* et avec `LegalPage.tsx`.

Vérification après déploiement :

```bash
curl -I https://elywalk-2f7ba.web.app/privacy.html   # 200 + content-type text/html
firebase deploy --only hosting
```

## Suppression de compte — URL publique (exigence Play Store)

Le Play Store exige une **URL de suppression de compte** distincte de la politique de
confidentialité, qui décrit la procédure, les données supprimées et les durées de
conservation.

- Fichier source : `app/public/delete-account.html`
- **URL à renseigner dans la fiche Play Store** :

  ```
  https://elywalk-2f7ba.web.app/delete-account.html
  ```

- Constante `ACCOUNT_DELETION_URL` (`app/src/lib/constants.ts`), affichée dans
  *Profil → Supprimer définitivement mon compte* et dans la politique de confidentialité.

La page documente deux voies : la suppression immédiate depuis l'application
(Profil → bouton rouge → confirmation → mot de passe, vide si connexion Google) et la
demande par e-mail à `contact@elysium-esport.fr` (traitement sous 30 jours) lorsque
l'utilisateur ne peut plus se connecter.

## Suppression de données sans fermer le compte — URL publique

Play demande une **URL distincte** pour la suppression de données lorsqu'on déclare
offrir cette possibilité (ce qui est le cas d'ElyWalk).

- Fichier source : `app/public/delete-data.html`
- **URL à renseigner dans la fiche Play Store** :

  ```
  https://elywalk-2f7ba.web.app/delete-data.html
  ```

- Constante `DATA_DELETION_URL` (`app/src/lib/constants.ts`), bouton
  *Profil → « Supprimer une partie de mes données »*.

La page sépare le libre-service immédiat (sortie GPS et son tracé, ami, photo de
profil, jetons FCM via la désactivation des notifications, consentement publicitaire)
de ce qui passe par une demande e-mail traitée sous 30 jours (historique de pas,
historique de transactions, bloc de sorties, réactions et messages, données de profil
optionnelles).

Récapitulatif des trois URL publiques à renseigner dans la fiche Play Store :

```
https://elywalk-2f7ba.web.app/privacy.html          # règles de confidentialité
https://elywalk-2f7ba.web.app/delete-account.html   # suppression du compte
https://elywalk-2f7ba.web.app/delete-data.html      # suppression des données
```

`deleteAccountData()` (`app/src/lib/db.ts`) doit rester exhaustif : il efface
`dailySteps`, `transactions`, `challenges` et `notificationTokens` (sous-collections du
profil, **non** supprimées avec le document parent), `activitySessions`, `friendships`,
`friendRequests` et `friendReactions` (les deux sens), et anonymise `withdrawals` /
`partnerRequests`. ⚠️ Toute nouvelle collection contenant des données personnelles doit
y être ajoutée.

## Firebase (Hosting + règles) — gratuit (Spark)

```bash
firebase login
firebase use elywalk-2f7ba
npm --prefix app run build
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

Depuis la 1.4.0, « Mes sorties » est paginée et filtrable : deux index
composites `activitySessions` sont nécessaires (`uid` + `startedAt` desc, et
`uid` + `type` + `startedAt` desc). Ils sont déclarés dans
`firestore.indexes.json` ; sans ce déploiement, la liste des sorties renvoie
une erreur « index requis ».

**2.1.3 — correctif « The query requires an index » :** la pagination triait
aussi explicitement par identifiant de document (`orderBy(documentId(), 'desc')`),
ce qui exigeait un index à quatre champs différent selon le filtre de type
choisi. Le client ne trie plus que par `startedAt` (Firestore ajoute `__name__`
automatiquement pour la pagination) ; les index à quatre champs restent déclarés
pour les versions déjà installées. Après une mise à jour du fichier :

```bash
firebase deploy --only firestore:indexes
firebase firestore:indexes   # vérifie l'état de construction
```

Les index manquants peuvent aussi être générés depuis les liens affichés par
l'application au moment de l'erreur.

## Catalogue des défis (`challengeCatalog`) — 2.2.0

### Où ?

**Uniquement dans l'espace d'administration de l'application** :
*Profil → 👑 Administration Elysium → onglet « Barème des défis »*.

Aucune saisie dans la console Firebase n'est nécessaire (ni souhaitée) : les
identifiants de défi sont **datés** — `week-steps-2026-11-09` change chaque
lundi, `streak-2026-11-12` chaque jour — et une ligne recopiée à la main devient
orpheline la semaine suivante, donc un défi qui ne paie plus silencieusement.
L'écran calcule les identifiants du jour et écrit la collection à votre place
(écriture réservée aux présidents par la règle `allow write: if president()`).

### Comment ?

1. Se connecter avec un compte président (`isPresidentUid`).
2. *Profil → 👑 Administration Elysium → Barème des défis*.
3. Ajuster au besoin le montant de chaque défi (1 à 50 EC), puis
   **« Ouvrir les défis du jour au versement »**.
4. Pour chaque défi, le badge indique l'état réel :
   `ouvert` (versement actif), `fermé` (aucun versement), `objectif seul`
   (aucune ligne de catalogue).
5. « Enregistrer » fige un montant défi par défi ; « Fermer » coupe
   immédiatement tout versement sur ce défi (suppression de la ligne).

### Rythme

Republier régulièrement, l'écran le rappelle :

- **chaque lundi** → `week-steps-<lundi>` (Sprint collectif) ;
- **le 1er du mois** → `season-<AAAA-MM>` (Saison des foulées) ;
- **tous les 3-4 jours** → `streak-<date>` et `dated-active-<date>`.

### Ce que contient un document

```
challengeCatalog/week-steps-2026-11-09
  active:    true          // false ou absent = défi non rémunéré
  reward:    25            // 1 à 50 EC, doit correspondre au versement
  target:    250000        // objectif (pas / jours actifs / série)
  startsAt:  "2026-11-09"  // AAAA-MM-JJ
  endsAt:    "2026-11-15"
  title:     "Sprint collectif"   // memorandum, facultatif
  updatedAt: 1762900000000
```

Sans ligne de catalogue, le défi reste jouable mais **aucune récompense n'est
versée** : c'est volontaire, mieux vaut un défi non payé qu'un crédit illimité.
La règle `validChallengeCredit` exige `active == true`, une date de fin non
dépassée et `reward` **strictement égal** au montant réclamé.

### Rythme

Les défis sont datés. Republication nécessaire au minimum :

- **chaque lundi** pour `week-steps-<lundi>` (Sprint collectif) ;
- **le 1er du mois** pour `season-<AAAA-MM>` (Saison des foulées) ;
- **chaque jour** pour `streak-<AAAA-MM-JJ>` (Feu sacré) et
  `dated-active-<début>` (7 jours en mouvement) — ces deux-là sont visibles une
  quinzaine de jours, une republication tous les 3-4 jours suffit en pratique.

Le bouton est idempotent : une ligne déjà valide n'est **jamais** écrasée (vos
ajustements de montant survivent).

## Classement et « liste » Firestore — 2.2.1

⚠️ **À lire avant de déployer les règles** : Firestore limite une requête à
**10 appels de document** (`exists()` / `get()`) **au total**, pas par ligne. Une
règle de `list` qui appelle `blocked()` (2 appels) refuse donc la requête
entière dès le 6ᵉ résultat — c'est ce qui vidait le classement en 2.2.0.

Règle à retenir pour toute nouvelle collection lue en liste : **aucun `exists()`,
`get()` ou `getAfter()` dans un `allow list`**. Ces contrôles vont dans
`allow get` (lecture unitaire) et dans les règles d'écriture. Si un filtrage par
ligne est indispensable, il faut dénormaliser l'information dans le document
(ex. un champ `blockedUsers` sur le profil) — c'est une décision de modèle de
données, pas un détail de règle.

Vérification côté client : `getLeaderboard` lit en cascade (tri serveur → sans
tri → petite fenêtre → tri local) et l'écran affiche le nombre réel de marcheurs
classés. Si ce nombre est inférieur à l'attendu après déploiement, c'est que les
règles actives sont encore les anciennes :

```bash
firebase deploy --only firestore:rules
```

### 2.2.2 — la dénormalisation est en place

Le paragraphe ci-dessus annonçait la seule issue praticable : dénormaliser le
blocage dans le document lu. C'est fait en 2.2.2 — un `get()` par ligne restant
un appel par ligne, il a fallu aller jusqu'à **zéro** appel de document dans les
règles de liste.

| Où | Quoi | Coût règle |
| --- | --- | --- |
| `users/{uid}` | `blockedUsers` (que j'ai bloqué), `blockedBy` (qui m'a bloqué) | `list` : 0 |
| `friendships/{id}` | `hiddenFor` (amitié masquée par un blocage) | `list` : 0 |
| `friendRequests/{id}` | `fromBlocked`, figé à l'envoi | `list` : 0 |
| `directMessages/{id}` | `fromBlocked`, figé à l'envoi | `list` : 0 |
| `activityFeed/{id}` | `audience` (`friends`) | `list` : 0 |
| `activitySessions/{id}` | `allow list` borné à 100, amitié via 1 `get` à clé fixe | 1 |

`blockedAccounts/{owner}_{blocked}` reste la **source de vérité** (elle porte le
nom affiché dans les réglages) et sert aux contrôles d'écriture
(`canInteract`, 2 `exists`) : aucune écriture n'est autorisée sur la seule foi
d'un champ répliqué.

- `blockAccount` / `unblockAccount` écrivent les quatre représentations dans un
  **même lot atomique** : le blocage, `blockedUsers` chez soi, `blockedBy` chez
  l'autre et `hiddenFor` sur l'amitié. Deux écritures séparées laisseraient un
  état où le blocage existe sans être vu des listes — l'utilisateur bloqué
  réapparaîtrait le temps d'un rafraîchissement.
- **À faire une fois après déploiement** : renseigner les profils créés avant la
  2.2.2, sans quoi un blocage ancien ne filtre pas les listes (les lectures
  unitaires et les interactions restent, elles, bloquées par la table de
  référence). Depuis l'espace admin ou la console :

  Depuis l'application : **Admin → Maintenance → « Renseigner les profils
  existants »** (réservé au président). En console, l'appel équivalent est :

  ```js
  // Une seule fois, avec un compte président
  await backfillBlockedUsers('UID_PRESIDENT');
  ```

  Idempotent : seuls les profils à qui il manque `blockedUsers` ou `blockedBy`
  sont touchés, aucune liste existante n'est écrasée. La règle de lecture de
  `blockedAccounts` autorise le président pour cette raison précise.
- Les nouveaux comptes sont créés avec `blockedUsers: []` et `blockedBy: []` ;
  la règle de `create` n'accepte rien d'autre.

Si l'écran Amis reste en chargement après ce déploiement, c'est que les règles
actives sont encore celles de la 2.2.1 :

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Notes privées et audiences — migration 2.2.0

`activitySessions.note` n'existe plus : la règle Firestore refuse désormais ce
champ. Les notes des versions précédentes doivent être déplacées vers
`users/{uid}/privateActivityNotes/{sessionId}` — c'est ce que fait
`migratePrivateNotes(uid)` (`app/src/lib/db.ts`), à appeler depuis un écran
d'administration ou une tâche unique de migration. Tant qu'elles ne sont pas
migrées, les notes restent visibles sur le document (elles étaient déjà
publiées) mais ne sont plus modifiables.

Le partage par lien utilise un document `shareLinks/<sessionId>_<uid>` :
identifiant déterministe (donc vérifiable par une règle sans requête sur un
champ), lecture par identifiant uniquement (`list` interdit — sinon les liens
seraient énumérables), et **suppression = révocation immédiate**. Ce document ne
contient qu'un résumé (titre, date, distance, durée, légende) : le tracé GPS
n'est jamais publié par un lien.

## Backend de confiance — Cloudflare Workers (F05/F06/F11, 100 % gratuit)

Les Cloud Functions Firebase exigent le plan payant **Blaze**. ElyWalk utilise
donc un **Cloudflare Worker** gratuit (voir `worker/README.md`) qui fournit :

- l'attestation **Play Integrity** (`/verify-integrity`) ;
- ~~la vérification AdMob SSV (`/ssv`)~~ — **legacy** : conservé pour compatibilité
  mais inutilisé depuis le passage à Meta Audience Network (pas d'équivalent SSV) ;
- l'envoi de **push FCM** (`/fcm/send`) ;
- la consommation des jetons FCM via **cron** (`/cron/process-notifications`) ;
- la file de retraits (`/cron/process-payouts`) ;
- le récapitulatif hebdomadaire du dimanche (`/cron/weekly-recap`, déclenché par
  `*/10 * * * 0` — une tranche de 8 comptes par passage, reprise via
  `cronState/weeklyRecap`).

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GOOGLE_APPLICATION_CREDENTIALS   # JSON du compte de service
npx wrangler secret put API_SECRET
npx wrangler deploy
```

Les clés publiques AdMob SSV étaient récupérées automatiquement par le Worker ;
l'endpoint `/ssv` n'est plus appelé depuis la 1.9.0 (Meta Audience Network ne
propose pas de callback serveur signé pour les récompenses). Le crédit ElyCoins
est borné par la transaction Firestore `adClaims` (une récompense par heure).

Côté app, renseigner `ATTESTATION_WORKER_URL` dans `app/src/lib/constants.ts` et
installer le plugin d'intégrité :

```bash
cd app
npm install @capacitor-community/play-integrity
npx cap sync
```

## Écran de mise à jour au démarrage (« nouvelle version disponible »)

Depuis 2.2.3, l'application compare sa version installée à la version publiée
sur le Play Store **au lancement**, et affiche un écran qui propose la mise à
jour. Deux niveaux :

- **recommandée** : « Plus tard » est possible, l'écran ne revient pas avant
  24 h (report mémorisé pour cette version précise) ;
- **obligatoire** : aucun bouton de fermeture, ni Échap ni clic sur le fond.

### D'où vient la « dernière version » ?

1. **Le worker** (`/cron/sync-release`, toutes les 6 h) relit l'API **Android
   Publisher** (`tracks/production/releases`), déduit `versionName` du
   `versionCode` et l'écrit dans `appRelease/current`. Rien à faire à la main
   après une publication Play.
   - Le compte de service (`GOOGLE_APPLICATION_CREDENTIALS`) doit avoir accès à
     l'application dans Play Console (*Utilisateurs et autorisations* →
     « Afficher les données de l'application »).
   - Endpoint testable à la main :
     `curl https://<worker>.workers.dev/cron/sync-release`.
2. **Le Play Store lui-même** (Android uniquement) : l'app tente une lecture
   sans ouvrir d'écran ; si elle réussit elle prime sur Firestore.
3. **L'administration** : Profil → Administration → onglet **Mise à jour**, qui
   publie `notes` (affichées sur l'écran), `minSupportedVersion` (bascule en
   obligatoire) et permet de **suspendre** l'écran sans publier de version.

### Mise en place (une fois)

```bash
# 1. Autoriser l'API Play dans le projet du compte de service
gcloud services enable androidpublisher.googleapis.com

# 2. Déployer le worker (le cron `15 */6 * * *` se met en place au déploiement)
cd worker && npx wrangler deploy

# 3. Vérifier
curl https://<worker>.workers.dev/cron/sync-release   # → {"ok":true,"version":"2.2.3"}

# 4. Déclarer les notes de version et l'éventuelle version minimale
#    Profil → Administration → Mise à jour (ou document `appRelease/current`).
```

### Déclencher une mise à jour obligatoire

Renseigner `minSupportedVersion` (ex. `2.2.3`). Toute version strictement
inférieure voit un écran sans échappatoire : à réserver aux changements de
contrat d'API ou aux correctifs de sécurité, sinon on bloque des utilisateurs
qui n'ont pas encore la mise à jour dans le Play Store.

### Pour tester sans publier

Écrire `appRelease/current` avec un `latestVersion` supérieur à `package.json`
(onglet Administration → Mise à jour). Pour ne plus être dérangé pendant les
tests : bouton **Suspendre l'écran de mise à jour** (`enabled: false`).

## Android

```bash
cd app
npm ci
npm test
npm run build
npx cap sync android
npx cap open android
```

La version Android n'est plus écrite en dur : `android/app/build.gradle` lit
`app/package.json` (une seule source) et en déduit `versionName` **et**
`versionCode` (`2.1.0` → `20100`). Il suffit donc d'incrémenter la version dans
`app/package.json` avant `npm run build && npx cap sync android` — Play Console
refuse un APK/AAB dont le `versionCode` n'a pas augmenté.

### Prérequis de compilation (JDK et mémoire)

AGP 8.13 et Capacitor 8 exigent un **JDK 21** : `java -version` doit l'annoncer
et `JAVA_HOME` doit pointer dessus (pas sur un JRE embarqué par un autre outil).
Le build recompile les plugins Capacitor **depuis `node_modules`** — dont
`capacitor-local-notifications` — donc plusieurs modules Kotlin sont reconstruits
à chaque `npx cap sync`.

`android/gradle.properties` fixe deux réglages qui suppriment l'échec
« The daemon has terminated unexpectedly on startup attempt #1 … Kotlin compile
daemon is ready » :

- `org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m` — les 1536 Mo
  d'origine ne suffisent plus pour AGP 8.13 + `compileSdk 36` + une dizaine de
  modules ; sur une machine à 8 Go, ne pas dépasser 3072 Mo ;
- `kotlin.compiler.execution.strategy=in-process` — la compilation Kotlin se fait
  dans le daemon Gradle, sans second JVM à démarrer (celui qui sortait avec le
  code 0 sous Windows + JDK 21).

Si l'erreur réapparaît malgré tout, purger les daemons et le cache Kotlin :

```bash
cd app/android
./gradlew --stop
rm -rf .gradle ~/.gradle/kotlin   # PowerShell : Remove-Item -Recurse -Force .gradle, "$env:USERPROFILE\.gradle\kotlin"
./gradlew :app:assembleDebug
```

## Consentement publicitaire RGPD (F03)

Depuis la 1.9.0, le consentement n'est plus fourni par Google UMP : il est
recueilli **dans l'application** (`src/lib/adConsent.ts` + `components/AdConsentSheet.tsx`).

- L'écran « Confidentialité des annonces » présente les réseaux et propose
  d'accepter ou de refuser la personnalisation. Le choix est conservé dans
  `Preferences` (`ads.consent.v2`). L'ancien choix `v1` ne couvre pas les
  nouveaux réseaux : l'écran est reproposé une fois à la mise à jour.
- Tant que le choix est `unknown`, ElyWalk **n'initialise pas LevelPlay et ne
  demande aucune annonce**. Le plugin applique `setGDPRConsent(personalized)`
  et `setCCPA(!personalized)` avant l'initialisation. Le réglage est modifiable
  depuis Profil → *Confidentialité des annonces* (`LevelPlayAds.setConsent`).
- Meta reçoit séparément son option *Limited Data Use* (`AdSettings`), pour
  les États américains où elle s'applique. LDU n'est pas un signal RGPD.
- ElyWalk n'est pas destinée aux enfants : `setCOPPA(false)`,
  `CHARTBOOST_COPPA=NO` et `Vungle_coppa=false` sont appliqués avant l'init.
  Vérifier que les réglages correspondants concordent dans les consoles.

> **EEE / Royaume-Uni** : ne pas se fonder uniquement sur ce choix local pour
> la mise en production. Configurer une CMP compatible avec LevelPlay et les
> régies activées (TCF et signal de consentement additionnel, selon leurs
> exigences), puis vérifier la transmission des choix par réseau. Un refus
> peut se traduire par une absence de remplissage, pas par une annonce garantie.

## Sécurité des données Play — « Applis installées »

Google Play a refusé la version **20103** avec le motif
« Sécurité des données (Applis installées : non déclaré) ». Le formulaire doit
correspondre au comportement réel de l'app **et de ses SDK**.

### Pourquoi la fonctionnalité ne peut pas être « supprimée »

Le code de l'application ne fait aucune énumération de paquets : ni
`QUERY_ALL_PACKAGES`, ni bloc `<queries>`, ni `getInstalledPackages` /
`getInstalledApplications` / `queryIntentActivities` dans `android/app` ni dans
les plugins Capacitor. La lecture vient du SDK de médiation :

- Unity documente `PackageManager.getInstalledApplications(0)` dans LevelPlay,
  avec un correctif « Google Play upload blocker » en **9.4.3** ; le SDK
  embarqué est la **9.7.0** (`android/app/build.gradle`), et des usages de
  `getPackagesForUid` subsistent. Meta Audience Network, appelé en *bidding* via
  l'adaptateur `facebook-adapter`, figure aussi parmi les réseaux.
- La permission `com.google.android.gms.permission.AD_ID` (manifeste) confirme
  la présence d'identifiants publicitaires à usage de mesure.

Conclusion : **Option 1** (déclarer) est la seule voie viable sans supprimer la
régie publicitaire, donc l'économie d'ElyCoins.

### Réponses exactes à saisir dans Play Console

App → **Sécurité des données** → *Activité dans les applis* → **Applis installées** :

| Champ | Réponse |
| --- | --- |
| Collecté ? | **Oui** |
| Partagé ? | **Oui** |
| Traitement éphémère ? | Non |
| Obligatoire ? | Oui (non facultatif) |
| Finalités | **Publicité ou marketing** (+ *Prévention des fraudes, sécurité et conformité*) |
| Chiffré en transit ? | **Oui** (HTTPS uniquement) |
| Suppression possible à la demande ? | Non |

Puis enregistrer et **resoumettre la version pour examen**. Ce formulaire est
global au package `com.elysium.elywalk` : il couvre toutes les versions publiées,
y compris la 20103 refusée.

### Ce que le dépôt apporte comme preuve

- `AndroidManifest.xml` — commentaire d'en-tête rappelant l'absence de
  permission de visibilité des paquets et l'origine SDK du traitement.
- `public/privacy.html` — sections **4.1** (applications installées : données,
  destinataires, finalité, caractère obligatoire, chiffrement, pas de
  `QUERY_ALL_PACKAGES`) et **4.2** (désinstallation, réinitialisation de
  l'identifiant publicitaire).
- `components/AdConsentSheet.tsx` — mention explicite de la liste des
  applications installées dans l'écran de consentement, y compris en annonces
  non personnalisées.
- `LevelPlayAdsPlugin.java` — `setGDPRConsent` + `setCCPA(!personalized)` +
  `setCOPPA(false)` appliqués avant `LevelPlay.init`.

### Vérification technique (si Play demande un justificatif)

```bash
# 1. Le manifeste fusionné ne doit contenir ni QUERY_ALL_PACKAGES ni <queries>
bundletool dump manifest --bundle ElyWalk.aab | grep -E "QUERY_ALL_PACKAGES|<queries"
# 2. Le code de l'app ne doit rien énumérer
grep -rn "getInstalledApplications\|getInstalledPackages\|queryIntentActivities" \
  android/app/src app/node_modules/@capacitor* 2>/dev/null
```

Les deux commandes doivent revenir **vides** ; c'est la démonstration que la
collecte provient exclusivement du SDK publicitaire, déjà déclaré.

## Unity LevelPlay (médiation publicitaire depuis 2.1.0)

**Unity LevelPlay** arbitre les enchères et initialise les SDK partenaires via
leurs adaptateurs Android. Meta Audience Network, Chartboost, Liftoff Monetize
(Vungle) et BIGO Ads utilisent la même app key et les mêmes ad units LevelPlay :
aucun ID de placement partenaire ni secret de reporting n'est à ajouter au code.

### Identifiants

| Rôle | Constante (`app/src/lib/constants.ts`) | Ad unit LevelPlay |
| --- | --- | --- |
| App key | `LEVELPLAY_APP_KEY` | `29767936d` |
| Bannière 320×50 (toutes les pages) | `LEVELPLAY_AD_UNIT_BANNER` | `g1zzk5uxi41cpcc2` |
| Interstitiel (ouverture, validation des pas, fin de sortie) | `LEVELPLAY_AD_UNIT_INTERSTITIAL` | `s73ihk59x7y52d6v` |
| Natif (bandeau des listes + carte de fin de sortie) | `LEVELPLAY_AD_UNIT_NATIVE` | `kz81dz4wdl6v0kue` |
| Vidéo récompensée (vidéo → ElyCoins) | `LEVELPLAY_AD_UNIT_REWARDED` | `l9z2u3fws3nm1cfc` |
| Medium rectangle 300×250 (retrait) | `LEVELPLAY_AD_UNIT_MEDIUM_RECTANGLE` | réutilise l'ad unit bannière (taille `MEDIUM_RECTANGLE`) |

**Récompense** — ad unit récompensée configurée avec *Reward item name*
`ElyCoin` et *Reward amount* `1`. Côté application, 1 unité LevelPlay = **0,1
ElyCoin** (`AD_REWARD_COINS`) : la conversion est faite par
`rewardCoinsFrom()` dans `src/lib/ads.ts`, et la récompense est ignorée si le
nom ou le montant annoncés par le réseau ne correspondent pas. Le montant
crédité reste borné à 0,1 EC par heure par la règle Firestore `validAdCredit`.

### Côté tableau de bord LevelPlay

Même si les réseaux ont déjà été ajoutés, vérifier dans **Setup → SDK Networks**
et **Instances** que leurs instances Android sont actives pour ElyWalk
(`com.elysium.elywalk`) et associées aux ad units définies ci-dessus.

| Réseau | À vérifier dans LevelPlay |
| --- | --- |
| [Meta Audience Network](https://docs.unity.com/en-us/grow/levelplay/sdk/android/networks/guides/meta-audience-network) | Compte Meta lié, App ID et Placement ID complet par instance en bidding. |
| [Chartboost](https://docs.unity.com/en-us/grow/levelplay/sdk/android/networks/guides/chartboost) | App ID, App Signature et Location ID par format ; créer des emplacements **Bidding**. Vérifier aussi le reporting. |
| [Liftoff Monetize](https://docs.unity.com/en-us/grow/levelplay/sdk/android/networks/guides/liftoff-monetize) | App ID et Placement Reference ID par format, via auto-setup ou via la configuration manuelle et les paramètres de reporting. |
| [BIGO Ads](https://docs.unity.com/en-us/grow/levelplay/sdk/android/networks/guides/bigo-ads) | App ID et Ad Slot ID par format ; les slots doivent être de type **Server Bidding**. |

Les quatre réseaux peuvent servir bannière, interstitiel et vidéo récompensée.
Le natif est à vérifier séparément sur les instances qui le prennent en charge
(dont Meta) ; ElyWalk conserve son repli sur la bannière dans les listes.
Saisir signatures, clés et jetons uniquement dans les consoles concernées.

### `app-ads.txt` (obligatoire)

La source `app/public/app-ads.txt` est copiée à la racine de `app/dist/` par
Vite. Elle conserve la ligne Meta et contient le bloc Liftoff fourni, dont :

```text
vungle.com, 6afd795a8a4ab1588b4bbc18, DIRECT, c107d686becd2d77
```

L'identifiant du vendeur `vungle.com` n'est pas un ID de placement. Ajouter
les lignes d'éditeur ou d'autres régies si leurs consoles les demandent, en
copiant les enregistrements exacts. Les modèles commentés `ironsrc.com` et
`unity.com` ne sont pas des vendeurs actifs sans les lignes remises par LevelPlay.

Depuis la racine du dépôt, publier uniquement Hosting pour mettre à jour le fichier :

```bash
npm --prefix app run build
firebase deploy --only hosting --project elywalk-2f7ba
curl -fsSI https://elywalk-2f7ba.web.app/app-ads.txt
curl -fsS https://elywalk-2f7ba.web.app/app-ads.txt | grep -F 'vungle.com, 6afd795a8a4ab1588b4bbc18, DIRECT'
```

- La fiche Play Store doit indiquer `https://elywalk-2f7ba.web.app` comme site
  développeur. Le fichier doit répondre **200** en `text/plain` sur ce domaine.
- Demander une nouvelle lecture dans LevelPlay et les consoles partenaires.
  La copie Android est régénérée par `npx cap sync android` ; celle-ci ne
  remplace pas la publication Firebase Hosting.

### Formats et emplacements

| Emplacement | Format | Fichier |
| --- | --- | --- |
| Ouverture / retour dans l'app | Interstitiel, plafonné à 2/jour et espacé de 10 min | `src/App.tsx` + `lib/ads.ts` |
| Validation des pas | Interstitiel | `src/pages/HomePage.tsx` |
| Vidéo récompensée (ElyCoins) | Vidéo récompensée | `src/pages/HomePage.tsx` |
| Retrait ElyCoins | Medium rectangle 300×250 | `src/pages/WalletPage.tsx` |
| Toutes les pages | Bannière 320×50 (+ natif compact sur `/history`) | `src/components/AdBanner.tsx` |
| Fin de sortie GPS | Carte native | `src/pages/ActivityPage.tsx` |

Le rendu natif est assuré par un **plugin Capacitor maison** :
`android/app/src/main/java/com/elysium/elywalk/LevelPlayAdsPlugin.java`. Il
n'existe pas de plugin Capacitor officiel pour LevelPlay, d'où cette
implémentation directe du SDK ; les vues natives (bandeau, carte) sont
construites par programme aux couleurs d'ElyWalk, avec le badge « Publicité »
exigé par les règles Play.

### Build Android

Avec un JDK 21 et le SDK Android (API 36), depuis la racine du dépôt :

```bash
cd app
npm ci
npm run build && npx cap sync android
cd android
bash ./gradlew :app:assembleDebug
```

`android/app/build.gradle` conserve **LevelPlay 9.7.0** et configure :

| Adaptateur LevelPlay | Version | SDK transitif |
| --- | --- | --- |
| `facebook-adapter` | 5.7.0 | Meta Audience Network 6.22.0 |
| `chartboost-adapter` | 5.12.0 | Chartboost 9.14.1 |
| `vungle-adapter` | 5.18.0 | Liftoff Monetize 7.8.0 |
| `bigo-adapter` | 5.15.0 | BIGO Ads 6.2.0 |

Les adaptateurs sont sur Maven Central. Le dépôt Maven Chartboost est limité
au groupe `com.chartboost`. Chartboost utilise la stdlib Kotlin 2.3.0 ; le
projet utilise le plugin Kotlin 2.3.10 et AGP 8.13.2 pour D8/R8. Ne pas ajouter
les SDK à la main : ils sont résolus transitivement. Les versions recommandées
sont dans la [documentation LevelPlay Android](https://docs.unity.com/en-us/grow/levelplay/sdk/android/mediation-networks).

L'accélération matérielle reste active pour les vidéos. Les activités des
régies sont déclarées dans leurs AAR. Pour le cache média Meta,
`network_security_config.xml` autorise HTTP **uniquement** vers `127.0.0.1` ;
les autres destinations restent soumises à l'interdiction de trafic en clair.

### Test des annonces

- Sur un appareil Android, utiliser l'[Integration Test Suite](https://docs.unity.com/en-us/grow/levelplay/sdk/android/integration-test-suite)
  dans un build de test : `LevelPlay.setMetaData("is_test_suite", "enable")`
  avant l'init, puis `LevelPlay.launchTestSuite(context)` après une init réussie.
  Ne pas activer ce mode dans le build de production.
- Vérifier les versions SDK/adaptateur et le chargement/affichage d'**annonces
  de test** de chaque réseau par format actif. Vérifier aussi la conversion de
  la vidéo récompensée et le repli si un réseau ne propose aucune annonce.
- Avant envoi sur le Play Store, contrôler les permissions du manifeste
  **fusionné** et réévaluer la fiche « Sécurité des données » pour les SDK ajoutés.
- Le build web (`npm run dev`) ne lance pas LevelPlay ; il ne valide pas
  l'intégration native ni le remplissage publicitaire.

## Notifications (F10)

Le rappel quotidien à 20 h et les push FCM sont désormais **désactivables**
depuis Profil → *Notifications* (préférences persistées dans `Preferences`).
Aucune permission n'est demandée de façon inconditionnelle.

## Avant publication

- Les mentions légales (`LegalPage.tsx`) sont complètes (CGU, confidentialité,
  mentions légales). Mettre à jour la **fiche Play « Sécurité des données »** en
  cohérence : publicité (Unity LevelPlay et ses réseaux partenaires),
  géolocalisation, activité physique/santé, âge
  minimum 15 ans.
- Configurer `contact@elysium-esport.fr` comme adresse d'assistance Play Store.
- Vérifier les modèles d'e-mails Firebase Authentication (vérification,
  changement d'e-mail) et les domaines autorisés.
- Créer les offres dans `partnerOffers` (`title`, `description`, `partnerName`,
  `coins`, `active`, `createdAt`).

## Limite de sécurité résiduelle

Firestore borne toujours les montants (validation quotidienne ≤ 60 000 pas,
récompense publicitaire ≤ 1/h et 0,1 EC, débits atomiques). Le Worker apporte
l'attestation forte manquante (Play Integrity). En revanche, ni Meta Audience
Network ni LevelPlay ne fournissent de vérification serveur signée pour les
récompenses (pas d'équivalent AdMob SSV) : la récompense vidéo reste donc
créditée côté client, bornée par le slot `adClaims` (1 par heure et par compte). Pour une
preuve externe, brancher les *server-to-server callbacks* LevelPlay (ad unit
récompensée) vers un endpoint du Worker, en transmettant l'UID via
`setDynamicUserId`. Reste à brancher un prestataire de paiement réel (PayPal
Payouts) pour l'exécution des retraits.
