# Déploiement ElyWalk

## Identifiant d'application (⚠️ à faire AVANT publication)

L'`applicationId` / `appId` est désormais **`com.elysium.elywalk`** (fini
`com.example.elywalk`). Après ce changement, il faut :

1. **Firebase Console** → Projet `elywalk-2f7ba` → *Paramètres projet* → *Vos
   applications* : ajouter une app Android `com.elysium.elywalk` avec la même
   empreinte SHA-1 (le keystore n'a pas changé), puis **retélécharger
   `google-services.json`** et remplacer `app/google-services.json` **et**
   `app/android/app/google-services.json`.
2. **AdMob** : enregistrer (ou renommer) l'application `com.elysium.elywalk`
   pour que les IDs de blocs restent valides.
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

## Firebase (Hosting + règles) — gratuit (Spark)

```bash
firebase login
firebase use elywalk-2f7ba
npm --prefix app run build
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

## Backend de confiance — Cloudflare Workers (F05/F06/F11, 100 % gratuit)

Les Cloud Functions Firebase exigent le plan payant **Blaze**. ElyWalk utilise
donc un **Cloudflare Worker** gratuit (voir `worker/README.md`) qui fournit :

- l'attestation **Play Integrity** (`/verify-integrity`) ;
- la vérification **AdMob SSV** (`/ssv`) ;
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

Les clés publiques AdMob SSV sont récupérées automatiquement par le Worker depuis
le serveur de clés Google (aucun secret SSV à configurer).

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

La version Android est `2 / 1.1.0`.

## Consentement publicitaire RGPD (F03)

AdMob est initialisé avec le module de consentement Google **UMP** (Funding
Choices) : avant toute annonce, le formulaire de consentement est affiché pour
les utilisateurs de l'EEE/UK. L'utilisateur peut le réviser à tout moment
(Profil → *Confidentialité des annonces*). Créer le **message RGPD** dans la
console AdMob → *Confidentialité et messages*.

## Notifications (F10)

Le rappel quotidien à 20 h et les push FCM sont désormais **désactivables**
depuis Profil → *Notifications* (préférences persistées dans `Preferences`).
Aucune permission n'est demandée de façon inconditionnelle.

## Avant publication

- Les mentions légales (`LegalPage.tsx`) sont complètes (CGU, confidentialité,
  mentions légales). Mettre à jour la **fiche Play « Sécurité des données »** en
  cohérence : publicité (AdMob), géolocalisation, activité physique/santé, âge
  minimum 15 ans.
- Configurer `contact@elysium-esport.fr` comme adresse d'assistance Play Store.
- Vérifier les modèles d'e-mails Firebase Authentication (vérification,
  changement d'e-mail) et les domaines autorisés.
- Créer les offres dans `partnerOffers` (`title`, `description`, `partnerName`,
  `coins`, `active`, `createdAt`).

## Limite de sécurité résiduelle

Firestore borne toujours les montants (validation quotidienne ≤ 60 000 pas,
récompense publicitaire ≤ 1/h, débits atomiques). Le Worker apporte l'attestation
forte manquante (Play Integrity + AdMob SSV) : sans jeton vérifié côté serveur,
le client ne peut pas créditer son solde sur une preuve externe. Reste à brancher
un prestataire de paiement réel (PayPal Payouts) pour l'exécution des retraits.
