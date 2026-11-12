# Déploiement ElyWalk

## Identifiant d'application (⚠️ à faire AVANT publication)

L'`applicationId` / `appId` est désormais **`com.elysium.elywalk`** (fini
`com.example.elywalk`). Après ce changement, il faut :

1. **Firebase Console** → Projet `elywalk-2f7ba` → *Paramètres projet* → *Vos
   applications* : ajouter une app Android `com.elysium.elywalk` avec la même
   empreinte SHA-1 (le keystore n'a pas changé), puis **retélécharger
   `google-services.json`** et remplacer `app/google-services.json` **et**
   `app/android/app/google-services.json`.
2. **Unity LevelPlay** : ajouter l'application Android `com.elysium.elywalk`
   (app key `29767936d`), créer les ad units et brancher Meta Audience Network
   en bidding (voir § « Unity LevelPlay » plus bas).
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

### Où écrire ?

Collection **`challengeCatalog`** de la base Firestore du projet
**`elywalk-2f7ba`** — un document par défi ouvert.

**Ne rien écrire à la main.** Deux chemins, dans cet ordre de préférence :

1. **Dans l'application** (recommandé) : se connecter avec un compte président
   (`isPresidentUid`), puis **Profil → Administration → « Barème des défis » →
   « Ouvrir les défis du jour au versement »**. L'écran affiche aussi, pour chaque
   défi : `ouvert`, `fermé` ou `objectif seul`. Cette voie calcule les
   identifiants exacts du jour — c'est le point qui casse en saisie manuelle,
   puisque les identifiants changent **chaque semaine** (`week-steps-2026-11-09`)
   et **chaque jour** (`streak-2026-11-12`).
2. **Console Firebase** → `challengeCatalog` → *Ajouter un document*, seulement
   pour ajuster un montant à la main. Reprendre l'identifiant tel qu'affiché dans
   la liste « Barème des défis » de l'app.

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
- la file de retraits (`/cron/process-payouts`).

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

## Consentement publicitaire RGPD (F03)

Depuis la 1.9.0, le consentement n'est plus fourni par Google UMP : il est
recueilli **dans l'application** (`src/lib/adConsent.ts` + `components/AdConsentSheet.tsx`).

- Au premier lancement, l'écran « Confidentialité des annonces » propose deux
  choix : annonces personnalisées, ou annonces non personnalisées (`LDU`).
- Tant qu'aucun choix n'est exprimé (`unknown`), **aucune annonce n'est
  demandée** : ni bannière, ni interstitiel, ni vidéo récompensée.
- Le choix est persisté (`Preferences`, clé `ads.consent.v1`), transmis au SDK
  natif **avant l'initialisation** via `LevelPlayAds.initialize({ personalized })`
  → `LevelPlayPrivacySettings.setGDPRConsent(boolean)`, complété par
  `setCCPA(!personalized)` (refus de la vente/partage) et `setCOPPA(false)`,
  puis modifiable à chaud
  (`LevelPlayAds.setConsent`) depuis Profil → *Confidentialité des annonces*.
- LevelPlay relaie ce consentement à chaque réseau médié : Meta Audience Network
  applique son mode *Limited Data Use* en cas de refus.

> ⚠️ **EEE / Royaume-Uni** : ce garde-fou applicatif ne remplace pas une CMP
> enregistrée IAB TCF v2. Pour une mise en production conforme, brancher une CMP
> (Didomi, Axeptio, Google UMP + adaptateur) qui écrit la chaîne `IABTCF_*` lue
> par LevelPlay, et vérifier dans le tableau de bord LevelPlay que la
> réglementation GDPR est activée pour l'app.

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

Depuis la 2.1.0, l'application passe par **Unity LevelPlay** comme plateforme de
médiation. **Meta Audience Network** y est branché en *in-app bidding* : le SDK
Meta n'est plus appelé directement par l'application, c'est LevelPlay qui
arbitre les enchères et sert l'annonce gagnante.

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

1. **Ad units** : les quatre ad units ci-dessus existent (bannière,
   interstitiel, natif, récompensée).
2. **Meta Audience Network en bidding** : *Mediation management* → ajouter Meta
   Audience Network, saisir l'**App ID** Meta (`1712220190424595`), l'*access
   token* et les placements Meta, puis activer le bidding sur chaque groupe de
   médiation. Formats biddables chez Meta : bannière, interstitiel, medium
   rectangle, vidéo récompensée — **pas le natif** (le natif reste servi en
   médiation classique ; sans *fill*, l'app retombe automatiquement sur la
   bannière 320×50).
3. **app-ads.txt** : copier la ligne `ironsrc.com, <PUBLISHER_ID>, DIRECT`
   affichée dans *LevelPlay → Compte → app-ads.txt* et la décommenter dans
   `app/public/app-ads.txt`.
4. **Test suite** : `LevelPlay.setMetaData("is_test_suite", "enable")` avant
   l'init, puis `LevelPlay.launchTestSuite(context)` (à retirer en production).

### `app-ads.txt` (obligatoire)

Le fichier `app/public/app-ads.txt` est copié à la racine de `dist/` par
`npm run build`, donc servi par Firebase Hosting. Il contient la ligne Meta
(réseau en bidding) et un emplacement pour la ligne de l'éditeur LevelPlay :

```
facebook.com, 1598870752271390, DIRECT, c3e20eee3f780d68
# ironsrc.com, <PUBLISHER_ID>, DIRECT      ← à décommenter avec votre Publisher ID
# unity.com, <PUBLISHER_ID>, DIRECT        ← si LevelPlay affiche aussi cette ligne
```

- URL à déclarer dans Play Console (champ *Site web* de la fiche) :
  `https://elywalk-2f7ba.web.app` — c'est ce domaine qui est exploré pour
  trouver `app-ads.txt`.
- Vérification : `curl https://elywalk-2f7ba.web.app/app-ads.txt` doit renvoyer
  les lignes en `text/plain` (les rewrites SPA ne s'appliquent pas aux fichiers
  existants).
- Après modification, forcer la relecture dans le tableau de bord LevelPlay et
  dans Monetization Manager (le crawl peut prendre 24 à 48 h).

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

```bash
cd app
npm run build && npx cap sync android
```

Le SDK est déclaré dans `android/app/build.gradle` :

```gradle
implementation 'com.unity3d.ads-mediation:mediation-sdk:9.5.0'
implementation 'com.unity3d.ads-mediation:facebook-adapter:5.7.0' // embarque le SDK Meta
implementation 'com.google.android.gms:play-services-appset:16.0.0'
implementation 'com.google.android.gms:play-services-ads-identifier:18.2.0'
```

Vérifier les versions recommandées :
<https://docs.unity.com/en-us/grow/levelplay/sdk/android/mediation-networks>
(la version de l'adaptateur Meta fixe la version du SDK Audience Network
embarquée — l'adaptateur 5.7.0 s'appuie sur le SDK Meta 6.22.0).

`minSdkVersion` doit rester ≥ 21 (ElyWalk est à 24), le SDK LevelPlay exige
Kotlin ≥ 1.7 (fourni par Gradle/Maven Central) et
`android:hardwareAccelerated="true"` est activé dans le manifeste (vidéos).
L'activité et le provider du SDK (`ControllerActivity`, `IronsourceLifecycleProvider`)
sont fusionnés depuis l'AAR : rien à déclarer à la main.

### Test des annonces

- Sans réseau configuré ou sans campagne active, LevelPlay renvoie un *no fill*
  (`onAdLoadFailed`) — c'est normal, l'application continue de fonctionner
  (toutes les fonctions publicitaires résolvent sans bloquer).
- Pour tester un remplissage : activer les *test mode* des ad units dans le
  tableau de bord LevelPlay, ou passer par l'Integration Test Suite.
- Sur la version web (`npm run dev`), les publicités sont **inertes** : les
  fonctions de `lib/ads.ts` résolvent immédiatement.

## Notifications (F10)

Le rappel quotidien à 20 h et les push FCM sont désormais **désactivables**
depuis Profil → *Notifications* (préférences persistées dans `Preferences`).
Aucune permission n'est demandée de façon inconditionnelle.

## Avant publication

- Les mentions légales (`LegalPage.tsx`) sont complètes (CGU, confidentialité,
  mentions légales). Mettre à jour la **fiche Play « Sécurité des données »** en
  cohérence : publicité (Unity LevelPlay + Meta Audience Network),
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
