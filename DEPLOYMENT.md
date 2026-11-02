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
      identifiants appareil (IP, HWID, jeton FCM, ID publicitaire), publicité AdMob,
      sous-traitants (Firebase, AdMob, Cloudflare, PayPal, ipify), durées, droits RGPD.
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

La version Android est `6 / 1.6.0` (chaque envoi doit porter un `versionCode`
strictement supérieur au précédent : 4 = 1.4.0, 5 = 1.5.0, 6 = 1.6.0).

### Build de production (AAB signé)

```bash
cd app
npm ci && npm test && npm run build
npx cap sync android
cd android
./gradlew clean bundleRelease      # app/android/app/build/outputs/bundle/release/app-release.aab
```

Signature : créer `app/android/keystore.properties` (ignoré par Git)

```properties
storeFile=/chemin/absolu/elywalk-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

ou exporter `ELYWALK_STORE_FILE`, `ELYWALK_STORE_PASSWORD`, `ELYWALK_KEY_ALIAS`,
`ELYWALK_KEY_PASSWORD` (CI). Sans ces valeurs, `bundleRelease` produit un AAB
non signé, à signer depuis Android Studio (*Build → Generate Signed App
Bundle*). ⚠️ Conserver la **même clé d'upload** que la 1.4.0, sinon Play
refuse l'envoi.

### Optimisation du code DEX et R8 (exigences Google Play)

Play signalait « L'optimisation du code DEX est inférieure à notre seuil —
Obscurcissement (1 %) » : la version release n'était pas minifiée. Elle l'est
depuis la 1.5.0, et l'avertissement a disparu sur le build 5. Play affiche
maintenant une recommandation plus douce (« Améliorez la mémoire et les
performances de votre appli avec l'optimisation R8 ») ; la 1.6.0 pousse donc
l'optimisation un cran plus loin.

Réglages actuels (`app/android/app/build.gradle`, `gradle.properties`,
`proguard-rules.pro`) :

- `minifyEnabled true` + `shrinkResources true` ;
- `android.enableR8.fullMode=true` (optimisations inter-classes, fusion de
  classes, analyse de nullité) ;
- `-allowaccessmodification` + `-repackageclasses ''` : R8 peut élargir la
  visibilité des membres et regrouper tout le code non conservé dans un paquet
  racine — ce sont les deux réglages qui font monter les pourcentages
  d'obscurcissement et d'optimisation mesurés par Play ;
- `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m` : le mode complet de
  R8 dépasse les 1,5 Go d'origine sur ce projet (Firebase + Google Mobile Ads)
  et échouerait en `OutOfMemoryError` ;
- `proguard-android-optimize.txt` + `app/android/app/proguard-rules.pro`
  (conserve les classes chargées par réflexion : plugins Capacitor listés dans
  `assets/capacitor.plugins.json`, plugins natifs `StepCounterPlugin` /
  `TrackingPlugin`, widget, services de premier plan, interfaces JavaScript) ;
- `app/android/app/src/main/res/raw/keep.xml` protège les ressources
  référencées par nom (icône de notification, splash, widget, launcher).

Le fichier de correspondance R8 (`mapping.txt`) est inclus automatiquement dans
l'AAB : les rapports de plantage Play restent lisibles.

⚠️ Après un changement de règles, tester un **APK release** réel
(`./gradlew assembleRelease` puis `adb install -r`) : pubs, podomètre, sortie
GPS, partage et widget.

### Affichage de bord à bord (Android 15 / SDK 35+)

- `MainActivity.enableEdgeToEdgeCompat()` active le bord à bord **sans API
  obsolète** : `WindowCompat.setDecorFitsSystemWindows(false)` et
  `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS` (API 30+) à la place de
  `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`, déprécié dans Android 15.
- Les couleurs transparentes des barres viennent du thème
  (`res/values/styles.xml`), jamais de `Window#setStatusBarColor`.
- Les encarts sont consommés côté web : `viewport-fit=cover` (index.html) et
  `env(safe-area-inset-*)` dans les feuilles de style ; Capacitor injecte aussi
  `--safe-area-inset-*` (`SystemBars.insetsHandling: 'css'`).
- Le bord à bord est activé **sans condition**, sur toutes les versions
  d'Android. Il l'était auparavant seulement quand la WebView installée savait
  exposer les safe-area (Chromium 140+) : c'est ce test à l'exécution qui
  valait l'avertissement Play « l'affichage de bord à bord peut ne pas être
  disponible pour tous les utilisateurs ».
- Repli natif (`MainActivity.applyInsetsFallback()`) : sur les appareils
  **antérieurs à Android 15 dont la WebView est ancienne**, les marges système
  (barres + encoche + clavier) sont appliquées sur `android.R.id.content`.
  À partir d'Android 15, c'est Capacitor qui s'en charge : pas de double marge.
- Le mode encoche `always` est aussi déclaré dans le thème
  (`res/values-v30/styles.xml`) pour la fenêtre de l'application **et** pour
  l'écran de lancement : plus aucune ressource de l'app ne demande
  `shortEdges`.
- Les occurrences restantes de `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`
  signalées par Play proviennent des bibliothèques Google elles-mêmes
  (`com.google.android.gms.ads.internal.overlay`,
  `com.google.android.play.core.hsdp.service.HsdpShimActivity`,
  `androidx.activity.EdgeToEdgeApi28`), **pas du code ElyWalk**. Le SDK
  d'annonces suit la dernière version de la branche recommandée
  (`playServicesAdsVersion = '25.5.+'` dans `app/android/variables.gradle`) ;
  le module `play.core.hsdp` arrive en dépendance transitive de ce SDK et ne
  peut pas être exclu sans risque de plantage. Cet avertissement est une
  **recommandation, pas un blocage de publication** : il se résorbera avec les
  prochaines versions des SDK Google.

### `app-ads.txt` (validation AdMob)

La console AdMob affichait « Impossible de valider Elywalk (Android) » :
AdMob explore `https://<site web déclaré sur Google Play>/app-ads.txt` et n'y
trouvait rien. Le fichier est maintenant versionné dans
`app/public/app-ads.txt` (une seule ligne, sans espace superflu) :

```text
google.com, pub-5316598937383510, DIRECT, f08c47fec0942fa0
```

Publication :

```bash
cd app && npm run build      # Vite copie app/public/** dans app/dist
cd .. && firebase deploy --only hosting
curl -i https://elywalk-2f7ba.web.app/app-ads.txt   # 200 + text/plain
```

`firebase.json` ajoute un en-tête `Content-Type: text/plain; charset=utf-8`
sur `/app-ads.txt` (la réécriture `** → /index.html` ne masque pas les
fichiers statiques).

⚠️ Deux conditions impératives :

1. l'URL explorée est **exactement** celle du champ *Site Web* de la fiche
   Google Play. Si la fiche déclare `https://elywalk-2f7ba.web.app`, le
   déploiement Firebase suffit ; si elle déclare `https://elysium-esport.fr`,
   le **même fichier doit exister à la racine de ce domaine**
   (`https://elysium-esport.fr/app-ads.txt`), sous-domaine `www` compris ;
2. le fichier doit être servi en **HTTP 200 texte brut**, sans redirection
   vers une page HTML.

Ensuite, dans AdMob → *Applications → app-ads.txt*, cliquer sur **Vérifier les
modifications** (ou *Rechercher à nouveau*). L'exploration peut prendre jusqu'à
24 h. Tant que le fichier n'est pas validé, une partie des acheteurs
programmatiques refuse d'enchérir : moins d'annonces remplies et un revenu
par mille plus faible.

#### Les trois conditions, dans l'ordre où AdMob les vérifie

1. **L'application doit être publiée sur le Play Store.** C'est écrit noir sur
   blanc dans la FAQ Google (« Do I need to publish my app to verify the
   app-ads.txt file? → **Yes** ») : le robot part de la **fiche publique** pour
   y lire le site du développeur. Une application en **test fermé** n'a pas de
   fiche publique → le robot n'a aucun domaine à explorer → message « vos
   informations ne correspondent pas ». C'est la cause la plus probable tant
   que la 1.6.0 n'est pas en production.
2. **Le champ « Site Web » doit être renseigné dans la fiche.**
   Play Console → *Croissance* (Grow users) → *Présence sur le Store* →
   *Paramètres du Store* → **Coordonnées de la fiche Play** → *Site Web*.
   Mettre exactement `https://elywalk-2f7ba.web.app` (sans `www`, sans chemin,
   sans barre oblique finale). Toute modification de la fiche demande ~24 h
   avant d'être vue par AdMob.
3. **Le fichier doit répondre 200 en texte brut à cette URL exacte.**

#### Vérifier ce que voit le robot

```bash
./scripts/check-app-ads.sh                          # domaine Firebase par défaut
./scripts/check-app-ads.sh https://elysium-esport.fr
```

Le script contrôle le code HTTP, les redirections, le type MIME, la présence de
HTML (piège du *fallback* SPA), l'enregistrement exact et les identifiants
éditeur parasites.

#### Pièges connus (liste officielle + retours terrain)

| Symptôme | Cause | Correctif |
| --- | --- | --- |
| « app-ads.txt introuvable » | application non publiée, ou champ *Site Web* vide | publier en production, renseigner le site, attendre 24 h |
| Validation échoue alors que l'URL marche | le domaine déclaré sur Play n'est **pas** celui qui héberge le fichier | aligner les deux |
| `www` contre domaine nu | AdMob n'unifie **pas** `example.com` et `www.example.com` | héberger le fichier sur l'hôte exact déclaré |
| Redirection apex → www | le robot ne suit pas toujours les redirections | servir le fichier en 200 direct sur l'hôte déclaré |
| Réponse en `text/html` | fichier absent, c'est la page 404 ou le *fallback* SPA qui répond | règle `headers` de `firebase.json` + fichier réellement déployé |
| Fichier illisible | BOM UTF-8, CRLF, espaces insécables | fichier ASCII pur, LF (vérifié : `od -c app/public/app-ads.txt`) |
| Robot bloqué | `robots.txt` restrictif | `app/public/robots.txt` autorise `Google-adstxt`, `Googlebot`, `Mediapartners-Google` |
| Rien ne bouge après 24 h | cache CDN ou fiche non propagée | purger le cache, revérifier après 48–72 h |

Google recommande explicitement **Firebase Hosting** pour héberger
`app-ads.txt` (et refuse Google Sites) : le domaine `*.web.app` convient, c'est
un suffixe public, donc `elywalk-2f7ba.web.app` est bien une racine de domaine.

⚠️ Ne pas confondre avec la **validation du compte AdMob** (identité,
paiements) : `app-ads.txt` ne valide que l'autorisation de vente de
l'inventaire.

## Publicités AdMob (F24 / F25)

Compte AdMob ElyWalk — **ID d'application** :
`ca-app-pub-5316598937383510~4963026878`

| Format | Bloc d'annonces | Déclenchement |
| --- | --- | --- |
| Annonce à l'ouverture | `ca-app-pub-5316598937383510/6986554989` | Lancement + retour dans l'app (plafond 2/jour, cooldown 10 min, jamais pendant l'onboarding) |
| Interstitiel | `ca-app-pub-5316598937383510/7972992736` | Validation des pas, fin d'une sortie, demande de retrait (60 s minimum entre deux) |
| Vidéo avec récompense | `ca-app-pub-5316598937383510/9832210178` | « Regarder une pub pour gagner 0,1 ElyCoins » (1/h, SSV avec `userId`) |

Ces valeurs sont déclarées à **deux endroits qui doivent rester synchronisés** :

- `app/src/lib/constants.ts` (`ADMOB_APP_ID`, `AD_UNIT_*`) ;
- `app/android/app/src/main/AndroidManifest.xml`
  (`com.google.android.gms.ads.APPLICATION_ID`).

Un ID d'application qui ne correspond pas au compte propriétaire des blocs =
**zéro annonce** (c'était la panne de la 1.4.0). Le manifeste active aussi
`OPTIMIZE_INITIALIZATION` / `OPTIMIZE_AD_LOADING` (moins d'ANR au démarrage).

Checklist console AdMob avant publication :

- [ ] L'application `com.elysium.elywalk` est **liée au Play Store** dans AdMob
      (*Applications → Paramètres de l'application*).
- [ ] `app-ads.txt` **validé** (voir la section dédiée plus haut) : le fichier
      doit répondre en 200 à la racine du site déclaré sur la fiche Play.
- [ ] Les trois blocs d'annonces sont **actifs** (un bloc tout juste créé peut
      rester sans impression pendant quelques heures).
- [ ] *Confidentialité et messages → Message RGPD* : message **publié** pour
      l'EEE/UK, sinon `canRequestAds` reste `false` en Europe et aucune annonce
      n'est diffusée (l'app l'indique dans Profil → *Confidentialité des
      annonces*).
- [ ] *Confidentialité et messages → Options de confidentialité* activées
      (bouton de révision du consentement exigé par le RGPD).
- [ ] Paiements et fiscalité validés : un compte non vérifié ne reçoit que des
      annonces vides.
- [ ] Pour tester sans risque d'« invalid traffic », utiliser un appareil de
      test déclaré dans AdMob ou les blocs de test Google.

## Consentement publicitaire RGPD (F03)

AdMob est initialisé avec le module de consentement Google **UMP** (Funding
Choices) : avant toute annonce, le formulaire de consentement est affiché pour
les utilisateurs de l'EEE/UK. L'utilisateur peut le réviser à tout moment
(Profil → *Confidentialité des annonces*), où s'affiche également l'état réel
de la régie (annonces actives / indisponibles). Créer et **publier** le
**message RGPD** dans la console AdMob → *Confidentialité et messages*.

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
