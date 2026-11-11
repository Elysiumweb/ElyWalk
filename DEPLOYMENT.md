# Déploiement ElyWalk

## Identifiant d'application (⚠️ à faire AVANT publication)

L'`applicationId` / `appId` est désormais **`com.elysium.elywalk`** (fini
`com.example.elywalk`). Après ce changement, il faut :

1. **Firebase Console** → Projet `elywalk-2f7ba` → *Paramètres projet* → *Vos
   applications* : ajouter une app Android `com.elysium.elywalk` avec la même
   empreinte SHA-1 (le keystore n'a pas changé), puis **retélécharger
   `google-services.json`** et remplacer `app/google-services.json` **et**
   `app/android/app/google-services.json`.
2. **Meta Audience Network** : dans Monetization Manager, ajouter l'application
   Android `com.elysium.elywalk` (voir § « Meta Audience Network » plus bas).
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

La version Android est `210 / 2.1.0`.

## Consentement publicitaire RGPD (F03)

Depuis la 1.9.0, le consentement n'est plus fourni par Google UMP : il est
recueilli **dans l'application** (`src/lib/adConsent.ts` + `components/AdConsentSheet.tsx`).

- Au premier lancement, l'écran « Confidentialité des annonces » propose deux
  choix : annonces personnalisées, ou annonces non personnalisées (`LDU`).
- Tant qu'aucun choix n'est exprimé (`unknown`), **aucune annonce n'est
  demandée** : ni bannière, ni interstitiel, ni vidéo récompensée.
- Le choix est persisté (`Preferences`, clé `ads.consent.v1`), transmis au SDK
  natif via `MetaAds.setConsent({ personalized })` (le nom du plugin Capacitor
  n'a pas changé, mais il pilote désormais Chartboost Mediation) puis révocable
  à tout moment depuis Profil → *Confidentialité des annonces (Chartboost · Meta)*.
- Côté Meta, le refus est appliqué par `AdSettings.setDataProcessingOptions(["LDU"], 0, 0)` ;
  l'acceptation remet les options à zéro. Chartboost Core 1.1.0 n'expose pas de
  setter de consentement Java (uniquement via adaptateur CMP) : le garde-fou
  applicatif reste la source de vérité.

> ⚠️ **EEE / Royaume-Uni** : ce garde-fou applicatif ne remplace pas une CMP
> enregistrée IAB TCF v2. Pour une mise en production conforme, brancher une CMP
> (Didomi, Axeptio, Google UMP + adaptateur, ou le consentement natif Meta) qui
> écrit la chaîne `IABTCF_*` lue par le SDK Audience Network, et vérifier dans
> Monetization Manager → *Data processing options* que le mode `LDU` est bien
> appliqué en cas de refus.

## Chartboost Mediation + Meta Audience Network (régie depuis 2.1.0)

Depuis la 2.1.0, ElyWalk n'appelle plus directement le SDK Meta : l'application
intègre **Chartboost Mediation** (ex-Helium, SDK Android `5.4.0`), qui sert les
emplacements et délègue le remplissage à l'**adaptateur Meta Audience Network**
(`5.6.22.0.0`, AN SDK `6.22.0`). Procédure suivie :
<https://developers.facebook.com/documentation/audience-network/bidding/partner-mediation/chartboost>.

> Meta Audience Network est **bidding uniquement** et ne remplit que
> l'**interstitiel** et l'**interstitiel récompensé**. Le « bannière » n'existe
> donc pas côté Meta : voir *Formats et emplacements* ci-dessous.

### Identifiants

| Rôle | Constante (`app/src/lib/constants.ts`) | Placement Chartboost | Format |
| --- | --- | --- | --- |
| Interstitiel (ouverture, validation des pas) | `CHARTBOOST_PLACEMENT_INTERSTITIAL` | `inter` | INTERSTITIAL |
| Vidéo récompensée (ElyCoins) | `CHARTBOOST_PLACEMENT_REWARDED` | `reward` | REWARDED |
| Medium rectangle / carte native | `CHARTBOOST_PLACEMENT_BANNER` | `banner` | INTERSTITIAL (⚠️) |

App ID Chartboost : `CHARTBOOST_APP_ID` dans `app/src/lib/constants.ts`
(**à remplacer par l'identifiant réel du dashboard avant toute publication**).
Les identifiants Meta (`META_APP_ID`, `META_PLACEMENT_*`) restent nécessaires à
`app-ads.txt` et au consentement, mais ne sont plus utilisés pour charger une
annonce.

Les trois placements sont créés dans le dashboard Chartboost en **BIDDING**,
sans restriction de pays ni de CPM ; l'adaptateur Meta se configure dans
*Mediation → Networks → Meta* (app id + placement id proxifiés par Chartboost).

### `app-ads.txt` (obligatoire)

Le fichier `app/public/app-ads.txt` est copié à la racine de `dist/` par
`npm run build`, donc servi par Firebase Hosting :

```
facebook.com, 1598870752271390, DIRECT, c3e20eee3f780d68
```

- URL à déclarer dans Play Console (champ *Site web* de la fiche) :
  `https://elywalk-2f7ba.web.app` — c'est ce domaine qui est exploré pour
  trouver `app-ads.txt`.
- Vérification : `curl https://elywalk-2f7ba.web.app/app-ads.txt` doit renvoyer
  la ligne ci-dessus en `text/plain` (les rewrites SPA ne s'appliquent pas aux
  fichiers existants).
- Après modification, forcer la relecture dans Monetization Manager →
  *app-ads.txt* (le crawl Meta peut prendre 24 à 48 h), et déclarer la ligne
  équivalente fournie par Chartboost dans son dashboard.

### Formats et emplacements

| Emplacement | Format réel | Placement | Fichier |
| --- | --- | --- | --- |
| Ouverture / retour dans l'app | Interstitiel, plafonné à 2/jour et espacé de 10 min | `inter` | `src/App.tsx` + `lib/ads.ts` |
| Validation des pas | Interstitiel | `inter` | `src/pages/HomePage.tsx` |
| Vidéo récompensée (ElyCoins) | Récompensé | `reward` | `src/pages/HomePage.tsx` |
| Retrait ElyCoins | ⚠️ le placement `banner` est un **INTERSTITIAL** : l'écran affiche un plein écran (`showMediumRectangle` → `loadAndShowOnce`) | `banner` | `src/pages/WalletPage.tsx` |
| Fin de sortie GPS | Pas d'équivalent natif chez Meta via Chartboost : **carte intégrée** dans la WebView (overlay HTML), sans revenu | `inter` (fallback) | `src/components/AdBanner.tsx` |

Conséquences à connaître :

- `showBanner`, `showNativeBanner`, `hideBanner` et `hideNativeBanner` résolvent
  immédiatement `{ height: 0 }` : **aucun espace n'est réservé** en bas d'écran
  (`--ad-banner-h` reste à `0`). Il n'y a donc plus de bandeau 320×50.
- `showMediumRectangle` et `showNativeCard` renvoient `{ shown: false }` tant
  que Chartboost ne remplit pas ; l'interface ne les attend jamais.
- Pour retrouver un vrai bandeau, créer un placement `banner` au format
  **BANNER** (Chartboost/AdMob) et rétablir l'appel `showBanner` dans
  `AdBanner.tsx` — l'API du plugin est déjà prête (elle retourne la hauteur).

### Build Android

```bash
cd app
npm run build && npx cap sync android
```

Dépendances déclarées dans `android/app/build.gradle` :

```gradle
implementation 'com.chartboost:chartboost-core-sdk:1.1.0'
implementation 'com.chartboost:chartboost-mediation-sdk:5.4.0'
implementation 'com.chartboost:chartboost-mediation-adapter-meta-audience-network:5.6.22.0.0'
implementation 'com.chartboost:chartboost-mediation-adapter-chartboost:5.9.14.0.0'
implementation 'com.facebook.android:audience-network-sdk:6.22.0'
implementation 'com.google.android.gms:play-services-ads-identifier:18.2.0'
implementation 'com.google.android.gms:play-services-appset:16.1.0'
```

Les dépôts Chartboost sont déclarés dans `android/build.gradle`
(`allprojects.repositories`) :

```gradle
maven { url 'https://cboost.jfrog.io/artifactory/chartboost-mediation' }
maven { url 'https://cboost.jfrog.io/artifactory/chartboost-core' }
maven { url 'https://cboost.jfrog.io/artifactory/chartboost-ads' }
```

Le SDK Chartboost Core exige Retrofit/OkHttp/Kotlinx Serialization, déjà ajoutés
au même bloc `dependencies`. Les règles ProGuard de `proguard-rules.pro`
conservent `com.chartboost.**`, les adaptateurs et `com.facebook.ads.**`.

`minSdkVersion` doit rester ≥ 24 (Core 1.1.0 / Mediation 5.4.0) et
`android:hardwareAccelerated="true"` est activé dans le manifeste (vidéos).

### Test des annonces

- Le plugin passe `ChartboostMediationSdk.setTestMode(ctx, true)` **uniquement**
  si l'APK est `debuggable` : la release ne bascule jamais en Test Mode.
- Sans campagne active, Chartboost renvoie un *no fill* : c'est normal, toutes
  les fonctions publicitaires résolvent sans bloquer (`{ shown: false }`,
  `{ rewarded: false }`, `{ height: 0 }`).
- Pour tester un remplissage : activer le Test Mode dans le dashboard Chartboost
  ou créer des campagnes de test côté Meta.
- Sur la version web (`npm run dev`), les publicités sont **inertes**.

## Notifications (F10)

Le rappel quotidien à 20 h et les push FCM sont désormais **désactivables**
depuis Profil → *Notifications* (préférences persistées dans `Preferences`).
Aucune permission n'est demandée de façon inconditionnelle.

## Avant publication

- Les mentions légales (`LegalPage.tsx`) sont complètes (CGU, confidentialité,
  mentions légales). Mettre à jour la **fiche Play « Sécurité des données »** en
  cohérence : publicité (Chartboost Mediation · Meta Audience Network),
  géolocalisation, activité physique/santé, âge
  minimum 15 ans.
- **Bumper la version avant publication** : `app/package.json`, puis
  `versionCode` / `versionName` dans `app/android/app/build.gradle` (actuellement
  `210` / `2.1.0`). Play Console refuse un `versionCode` déjà utilisé.
- Configurer `contact@elysium-esport.fr` comme adresse d'assistance Play Store.
- Vérifier les modèles d'e-mails Firebase Authentication (vérification,
  changement d'e-mail) et les domaines autorisés.
- Créer les offres dans `partnerOffers` (`title`, `description`, `partnerName`,
  `coins`, `active`, `createdAt`).

## Limite de sécurité résiduelle

Firestore borne toujours les montants (validation quotidienne ≤ 60 000 pas,
récompense publicitaire ≤ 1/h, débits atomiques). Le Worker apporte l'attestation
forte manquante (Play Integrity + vérification serveur des récompenses) : sans jeton vérifié côté serveur,
le client ne peut pas créditer son solde sur une preuve externe. Reste à brancher
un prestataire de paiement réel (PayPal Payouts) pour l'exécution des retraits.
