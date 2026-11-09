# Déploiement ElyWalk

## Identifiant d'application (⚠️ à faire AVANT publication)

L'`applicationId` / `appId` est désormais **`com.elysium.elywalk`** (fini
`com.example.elywalk`). Après ce changement, il faut :

1. **Firebase Console** → Projet `elywalk-2f7ba` → *Paramètres projet* → *Vos
   applications* : ajouter une app Android `com.elysium.elywalk` avec la même
   empreinte SHA-1 (le keystore n'a pas changé), puis **retélécharger
   `google-services.json`** et remplacer `app/google-services.json` **et**
   `app/android/app/google-services.json`.
2. **Meta Audience Network** : aucun renommage à faire (le Monetization Manager
   ne connaît pas l'`applicationId` Android, seulement l'app liée au Play
   Store). Vérifier en revanche que l'app reste **liée** au Play Store.
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
- la validation serveur des récompenses **Meta S2S** (`/meta-reward`, et
  `/ssv` pour l'historique AdMob) ;
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

La version Android est `9 / 1.8.0` (chaque envoi doit porter un `versionCode`
strictement supérieur au précédent : 4 = 1.4.0, 5 = 1.5.0, 6 = 1.6.0,
7 = 1.7.0 publiée, 8 = 1.7.1, 9 = 1.8.0).

> ⚠️ **Toujours construire depuis `main`.** La version 7 publiée sur Play a été
> produite depuis une branche de travail créée avant la 1.6.0 : elle ne
> contenait ni le bord à bord, ni R8, ni les correctifs de stabilité — d'où les
> deux avertissements de la console **et** le plantage au lancement. Avant
> chaque `bundleRelease`, vérifier les deux marqueurs :
>
> ```bash
> grep -m1 versionName android/app/build.gradle   # doit être la version attendue
> grep -m1 minifyEnabled android/app/build.gradle # doit être « true »
> git log --oneline -1                             # doit être le commit de main voulu
> ```

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
- pas de `-repackageclasses ''` ni de `-allowaccessmodification` : Play évalue
  la réduction et l'optimisation (`minifyEnabled`, `shrinkResources`, mode
  complet), pas ces deux drapeaux. Ils déplacent des classes que certains SDK
  retrouvent par leur nom complet — gain marginal, risque de plantage réel, et
  impossible à tester sans APK release ;
- `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m` : le mode complet de
  R8 dépasse les 1,5 Go d'origine sur ce projet (Firebase + Google Mobile Ads)
  et échouerait en `OutOfMemoryError` ;
- `proguard-android-optimize.txt` + `app/android/app/proguard-rules.pro`
  (conserve les classes chargées par réflexion : plugins Capacitor listés dans
  `assets/capacitor.plugins.json`, plugins natifs `StepCounterPlugin` /
  `TrackingPlugin`, widget, services de premier plan, interfaces JavaScript) ;
- `app/android/app/src/main/res/raw/keep.xml` protège les ressources
  référencées par nom (icône de notification, splash, widget, launcher) ;
- `android.enableR8.keepLineNumbers=true` : numéros de ligne conservés dans les
  traces de pile (diagnostic Play Console) sans désactiver l'obscurcissement ;
- règles ajoutées en 1.7.1 : `app.capgo.pedometer.**` (plugin podomètre tiers,
  **sans** règles « consumer »), `MainActivity`, et `-dontwarn` sur la
  dépendance optionnelle Facebook du plugin Firebase Authentication. Une règle
  manquante transforme l'optimisation en plantage : après toute modification,
  vérifier un APK release réel.

Le fichier de correspondance R8 (`mapping.txt`) est inclus automatiquement dans
l'AAB : les rapports de plantage Play restent lisibles.

⚠️ Après un changement de règles, tester un **APK release** réel
(`./gradlew assembleRelease` puis `adb install -r`) : pubs, podomètre, sortie
GPS, partage et widget.

### Affichage de bord à bord (Android 15 / SDK 35+)

Deux avertissements Play sont visés : « il se peut que l'affichage de bord à
bord ne soit pas disponible pour tous les utilisateurs » et « votre appli
utilise des API ou des paramètres obsolètes pour l'affichage de bord à bord ».

- `MainActivity.enableEdgeToEdgeCompat()` appelle
  **`WindowCompat.enableEdgeToEdge(getWindow())`** (androidx.core **1.17.0**,
  déjà amené par Capacitor). C'est l'API recommandée par Google : elle applique
  le bord à bord de façon **rétrocompatible** (toutes les versions d'Android),
  rend les barres transparentes et gère les contrastes, sans que le code de
  l'application n'appelle directement les API dépréciées.
- Un `catch (Throwable)` entoure l'appel : un échec du bord à bord ne doit
  **jamais** empêcher l'interface de s'afficher (l'application reste alors en
  affichage encarté, ce qui est parfaitement utilisable). Aucune autre API de
  fenêtre dépréciée n'est appelée en repli, pour ne pas réintroduire
  l'avertissement Play.
- Les icônes des barres système sont forcées en clair
  (`WindowInsetsControllerCompat.setAppearanceLightStatusBars/NavigationBars`),
  l'application ayant un thème sombre.
- **Aucune couleur de barre dans le thème** : `android:statusBarColor`,
  `android:navigationBarColor`, `android:enforceStatusBarContrast` et
  `android:enforceNavigationBarContrast` ont été retirés de
  `res/values/styles.xml`. Ils sont dépréciés et sans effet depuis Android 15 et
  étaient signalés par Play. Les barres sont transparentes par défaut.
- Le mode encoche reste `always` (`res/values-v30/styles.xml`, fenêtre de
  l'application **et** écran de lancement) : remplaçant non déprécié de
  `shortEdges`.
- Les encarts sont consommés côté web : `viewport-fit=cover` (index.html) et
  `env(safe-area-inset-*)` dans les feuilles de style ; Capacitor injecte aussi
  `--safe-area-inset-*` (`SystemBars.insetsHandling: 'css'`).
- Repli natif (`MainActivity.applyInsetsFallback()`) : sur les appareils
  **antérieurs à Android 15 dont la WebView est ancienne**, les marges système
  (barres + encoche + clavier) sont appliquées sur `android.R.id.content`.
  À partir d'Android 15, c'est Capacitor qui s'en charge : pas de double marge.
- Les occurrences restantes signalées par Play peuvent provenir des
  bibliothèques Google elles-mêmes (`com.google.android.gms.ads.internal.overlay`,
  `com.google.android.play.core.hsdp`, `androidx.core`/`androidx.activity`) :
  elles ne sont pas dans le code ElyWalk. Cet avertissement est une
  **recommandation, pas un blocage de publication**.

### Stabilité au lancement

Trois causes de fermeture immédiate sont traitées depuis la 1.7.1 :

1. **Délai de premier plan (5 s).** `TrackingService.onCreate()` restaure la
   trace GPS depuis le disque ; ce travail est désormais fait **après**
   `startForeground()`. La notification est disponible dès la promotion : le
   canal est créé dans `buildNotification()`.
2. **Exceptions remontées par le pont JavaScript.** Capacitor relance sur le
   thread principal toute exception d'une méthode `@PluginMethod`
   (`throw new RuntimeException(ex)`), ce qui tue l'application. Les appels du
   `StepCounterService` (capteur, `StepStore`, listener JS, widget) sont
   encapsulés ; `BootReceiver` utilise `StepCounterService.startQuietly()`.
3. **Moteur de rendu WebView.** `MainActivity` installe un `WebViewListener`
   dont `onRenderProcessGone()` recrée l'activité et renvoie `true` : sans cela
   Android termine le processus.

Côté web, `AppErrorBoundary` + `src/lib/startup-guard.ts` affichent un écran de
secours (« ElyWalk n'a pas pu démarrer » + bouton Réessayer) au lieu d'une page
blanche si une exception de rendu ou un bundle illisible survient.

Vérification après un envoi : Play Console → *Android vitals* → aucun
`ForegroundServiceDidNotStartInTimeException`, et l'onglet *Qualité* ne
mentionne plus de plantage au démarrage.

### Contrôle des avertissements Play avant envoi

Les avertissements « bord à bord » et « optimisation R8 » sont calculés par
Play **sur l'AAB envoyé**. Pour les vérifier avant de livrer :

```bash
cd app/android
./gradlew clean bundleRelease
# 1. Le bundle est-il bien optimisé ? (R8 : mapping.txt présent, taille réduite)
ls -la app/build/outputs/mapping/release/mapping.txt
# 2. Aucune API de barre dépréciée ne doit rester dans le code de l'application
grep -c "setStatusBarColor\|setNavigationBarColor" app/build/outputs/mapping/release/mapping.txt || true
# 3. Le bord à bord est activé par WindowCompat.enableEdgeToEdge : vérifier que
#    la classe est bien référencée depuis MainActivity dans le mapping
grep -n "com.elysium.elywalk.MainActivity" app/build/outputs/mapping/release/mapping.txt

# Contrôle du bundle lui-même (aapt2 / bundletool)
bundletool build-apks --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=/tmp/elywalk.apks --mode=universal
```

Les avertissements disparaissent sur la version **suivante** : Play ne réévalue
pas un build déjà publié.

### `app-ads.txt` (validation Meta Audience Network)

**État : fichier en ligne, validation en attente de la mise en production.**

Le robot de Meta explore une seule URL : la racine du champ *Site Web* de la
fiche Play. Cette fiche déclare `https://elysium-esport.fr` (Play Console →
*Paramètres du Store* → *Coordonnées sur la fiche Play Store*), site hébergé
sur **Vercel**. L'URL explorée est donc :

```text
https://elysium-esport.fr/app-ads.txt     ← en ligne (2026-11-02)
```

⚠️ **Le déploiement Firebase n'est pas exploré** tant que la fiche Play
déclare ce domaine. Le fichier versionné ici (`app/public/app-ads.txt`,
publié sur `elywalk-2f7ba.web.app`) n'est qu'un **miroir** : la source de
vérité est le dépôt Vercel du site.

Il reste deux conditions, hors de ce dépôt :

1. l'application doit être **publiée en production** sur le Play Store (le
   robot lit le site du développeur sur la fiche **publique** ; une app en
   test fermé n'en a pas) ;
2. compter jusqu'à 24 h d'exploration, puis *Vérifier* dans le Monetization
   Manager → *App Settings → app-ads.txt*.

Contenu exact (l'enregistrement Meta est celui qui compte depuis la 1.8.0 ;
la ligne `google.com` est conservée pour l'historique et ne gêne pas) :

```text
google.com, pub-5316598937383510, DIRECT, f08c47fec0942fa0
facebook.com, 1598870752271390, DIRECT, c3e20eee3f780d68
```

#### Option A (recommandée) — déposer le fichier sur `elysium-esport.fr` (Vercel)

Le site `elysium-esport.fr` est hébergé sur **Vercel**. Le fichier se dépose
dans le dépôt de CE site (pas dans ce dépôt-ci), puis part au déploiement.

**1. Où placer le fichier selon le framework**

| Projet Vercel | Emplacement dans le dépôt | URL servie |
| --- | --- | --- |
| Next.js (App ou Pages Router) | `public/app-ads.txt` | `/app-ads.txt` |
| Vite, React, Vue, Svelte | `public/app-ads.txt` | `/app-ads.txt` |
| Astro | `public/app-ads.txt` | `/app-ads.txt` |
| Nuxt 3 | `public/app-ads.txt` | `/app-ads.txt` |
| Site statique sans framework | racine du dépôt | `/app-ads.txt` |

Contenu : la ligne unique ci-dessus, en texte brut, sans BOM, sans `<html>`
autour. Vercel sert les fichiers de `public/` en `text/plain` automatiquement
pour une extension `.txt` ; aucun réglage supplémentaire n'est nécessaire.

**2. Mettre le domaine nu en domaine principal**

C'est le piège Vercel le plus fréquent. Si `elysium-esport.fr` redirige en 308
vers `www.elysium-esport.fr`, le robot d'AdMob — qui explore l'apex déclaré sur
Play — peut abandonner. Dans *Vercel → Project → Settings → Domains*, mettre
**`elysium-esport.fr` en domaine principal** (`www` redirige alors vers l'apex,
et non l'inverse). À défaut, déposer le fichier de sorte que les deux hôtes le
servent en 200.

**3. Vérifier la Deployment Protection**

*Settings → Deployment Protection* : si *Vercel Authentication* ou *Password
Protection* est actif sur la Production, toute requête anonyme reçoit un 401 —
le robot d'AdMob aussi. Désactiver la protection pour la Production (ou au
minimum exclure la racine du site).

**4. Attention aux réécritures fourre-tout**

Avec `rewrites` dans `vercel.json`, les fichiers statiques passent avant les
réécritures : rien à faire. Avec l'ancienne clé `routes`, il faut un
`{ "handle": "filesystem" }` **avant** la route fourre-tout, sinon
`/app-ads.txt` renvoie le HTML de la SPA.

Pour forcer explicitement le type MIME (facultatif) :

```json
{
  "headers": [
    {
      "source": "/app-ads.txt",
      "headers": [{ "key": "Content-Type", "value": "text/plain; charset=utf-8" }]
    }
  ]
}
```

**Variante — proxy vers le miroir Firebase** (une seule source de vérité, le
fichier reste versionné dans ce dépôt) :

```json
{
  "rewrites": [
    {
      "source": "/app-ads.txt",
      "destination": "https://elywalk-2f7ba.web.app/app-ads.txt"
    }
  ]
}
```

Plus pratique à maintenir, mais ajoute une dépendance réseau au moment de
l'exploration : le fichier statique reste le choix le plus sûr.

**5. Vérifier**

```bash
./scripts/check-app-ads.sh      # teste apex + www + miroir Firebase
```

Le script signale les erreurs propres à Vercel (en-tête `x-vercel-error`, 401
de la Deployment Protection, page d'authentification renvoyée à la place du
fichier).

#### Option B — pointer la fiche Play vers Firebase

Si le dépôt Vercel d'`elysium-esport.fr` n'est pas accessible, changer le champ
*Site Web* de la fiche Play en `https://elywalk-2f7ba.web.app` : le fichier y
est déjà servi correctement. Google recommande explicitement Firebase Hosting
pour `app-ads.txt`. Inconvénients : l'URL est visible par les utilisateurs sur
la fiche Play, et toute modification de fiche demande une republication puis
~24 h de propagation avant qu'AdMob la voie.

#### Publication du miroir Firebase

```bash
cd app && npm run build      # Vite copie app/public/** dans app/dist
cd .. && firebase deploy --only hosting
```

`firebase.json` ajoute un en-tête `Content-Type: text/plain; charset=utf-8`
sur `/app-ads.txt` (la réécriture `** → /index.html` ne masque pas les
fichiers statiques).

Ensuite, dans le Monetization Manager → *App Settings → app-ads.txt*, cliquer
sur **Vérifier** (ou *Rechercher à nouveau*). L'exploration peut prendre jusqu'à
24 h. Tant que le fichier n'est pas validé, une partie des acheteurs
programmatiques refuse d'enchérir : moins d'annonces remplies et un revenu
par mille plus faible.

#### Les trois conditions, dans l'ordre où AdMob les vérifie

1. **L'application doit être publiée sur le Play Store** (FAQ Google : « Do I
   need to publish my app to verify the app-ads.txt file? → **Yes** ») : le
   robot part de la **fiche publique** pour y lire le site du développeur.
   ✅ ElyWalk est en production. Vérifier tout de même que le lien *Site Web*
   apparaît bien sur la **fiche publique** (page Play → *Assistance de
   l'appli*) : une modification de fiche non republiée reste invisible du
   robot.
2. **Le champ « Site Web » de la fiche détermine l'URL explorée.**
   Play Console → *Croissance* → *Présence sur le Store* → *Paramètres du
   Store* → *Coordonnées sur la fiche Play Store* → **Site Web**.
   Valeur actuelle : `https://elysium-esport.fr` (apex, sans `www`, sans
   chemin). Toute modification de ce champ demande une republication de la
   fiche puis ~24 h avant d'être vue par AdMob.
3. **Le fichier doit répondre 200 en texte brut à cette URL exacte.**

#### Vérifier ce que voit le robot

```bash
./scripts/check-app-ads.sh                       # apex + www + miroir Firebase
./scripts/check-app-ads.sh https://un-autre.fr   # un domaine precis
```

Le script affiche l'hébergeur de chaque domaine (en-tête `Server`), puis
contrôle le code HTTP, les redirections, le type MIME, la présence de HTML
(piège du *fallback* SPA), un éventuel BOM, l'enregistrement exact, les
identifiants éditeur parasites et le `robots.txt` du domaine.

#### Pièges connus (liste officielle + retours terrain)

| Symptôme | Cause | Correctif |
| --- | --- | --- |
| « app-ads.txt introuvable » | champ *Site Web* absent de la fiche **publique** (modification non republiée) | republier la fiche, attendre 24 h |
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

## Publicités Meta Audience Network (F24 / F25)

Depuis la **1.8.0**, ElyWalk n'utilise plus AdMob (compte refusé par Google) ni
aucune plateforme de médiation : la régie est **Meta Audience Network**,
intégrée en direct.

| Élément | Valeur |
| --- | --- |
| Application (propriété) | `1712220190424595` |
| Bannière #1 | `1712220190424595_1712220347091246` |
| Interstitiel #2 | `1712220190424595_1712220353757912` |
| Rectangle moyen #3 | `1712220190424595_1712220350424579` |
| Natif #4 | `1712220190424595_1712220357091245` |
| Bannière native #5 | `1712220190424595_1712220360424578` |
| Interstitiel récompensé #6 | `1712220190424595_1712220367091244` |
| SDK Android | `com.facebook.android:audience-network-sdk:6.22.0` |

Ces identifiants sont déclarés à **un seul endroit** : `app/src/lib/constants.ts`
(`META_APP_ID`, `META_PLACEMENT_*`, `AD_PLACEMENTS`). L'`APP_ID` est répété dans
`android/app/src/main/AndroidManifest.xml`
(`com.facebook.sdk.ApplicationId`) : les deux doivent rester identiques.

### Les six moments publicitaires

| Moment | Format | Placement |
| --- | --- | --- |
| Ouverture de l'application | interstitiel | #2 |
| Validation des pas | interstitiel | #2 |
| Vidéo contre 0,1 ElyCoin | interstitiel récompensé | #6 |
| Demande de retrait | interstitiel | #2 |
| Chaque page | bannière | #1 |
| Fin d'une sortie GPS | interstitiel | #2 |

Meta ne propose **ni** format « App Open » **ni** vidéo récompensée séparée :
l'ouverture passe par l'interstitiel (plafond 2/jour, cooldown 10 min, jamais
pendant l'onboarding) et la récompense par l'interstitiel récompensé.

Les placements #3, #4 et #5 sont déclarés mais pas encore utilisés : ils sont
prêts pour de futurs encarts (rectangle en fin d'article, natif dans le fil).

### Checklist Meta avant publication

- [ ] **`app-ads.txt`** publié à la racine du site déclaré sur la fiche Play :
      `facebook.com, 1598870752271390, DIRECT, c3e20eee3f780d68`
      (vérifiable avec `npm run check:app-ads`).
- [ ] **Client Token** renseigné dans
      `android/app/src/main/res/values/strings.xml`
      (`facebook_client_token`, actuellement `VOTRE_CLIENT_TOKEN_META`).
      Il se lit dans le Monetization Manager → *Paramètres → Avancé*. Un jeton
      absent ou erroné ⇒ **aucun remplissage**.
- [ ] L'application est **liée au Play Store** dans le Monetization Manager : une
      app non liée ne reçoit que des annonces de test.
- [ ] Les six placements sont **actifs** (un placement neuf peut rester sans
      impression quelques heures).
- [ ] Paiements et fiscalité validés.
- [ ] Pour tester, utiliser les identifiants de test
      (`IMG_16_9_APP_INSTALL#<placement>`) ou déclarer l'appareil via
      `AdSettings.addTestDevice(...)`. Ne jamais cliquer sur ses propres
      annonces de production (trafic invalide = suspension).

### Consentement (CMP maison)

Meta **n'est pas** signataire du TCF : il n'y a ni formulaire IAB ni chaîne de
consentement (`IABTCF_*`). ElyWalk affiche donc son **propre écran de
consentement** (`src/components/ConsentGate.tsx`), avec deux boutons de poids
égal (Accepter / Refuser), une seule fois par installation :

- zones concernées : **EEE, Royaume-Uni, Suisse** — et **pays indéterminé**
  (traité par prudence comme « consentement requis ») ;
- refus ⇒ `canShowAds()` reste `false`, aucune requête d'annonce n'est émise ;
- choix modifiable à tout moment : **Profil → Modifier mes choix publicitaires** ;
- **États-Unis** : Limited Data Use activé automatiquement
  (`AdSettings.setDataProcessingOptions(new String[]{"LDU"})`).

La région est déduite de la locale système (`fr-FR` → FR). Ce n'est pas une
géolocalisation : un appareil configuré en anglais américain mais physiquement
en France verra donc la règle américaine. Pour fermer cet écart, remplacer
`detectRegion()` dans `src/lib/ads.ts` par un appel à
`Device.getInfo()` complété d'une API de pays (ou d'un en-tête `CF-IPCountry`
renvoyé par le Worker).

### Validation serveur des récompenses (S2S)

Sans validation, un utilisateur pourrait forger l'appel `showRewardedAd()` et
s'attribuer des ElyCoins. Meta propose une validation **S2S** :

1. Déployer le Worker (`/worker/README.md`) et créer le secret :

   ```bash
   cd worker && npx wrangler deploy
   npx wrangler secret put META_CLIENT_TOKEN   # = Client Token de l'app
   ```

2. Dans le Monetization Manager, sur le placement #6 →
   *Server Side Reward Validation* → URL
   `https://<worker>/meta-reward`.
3. Renseigner la même URL dans `app/src/lib/constants.ts`
   (`ADS_S2S_REWARD_URL`), puis reconstruire l'application.

Fonctionnement : Meta appelle
`/meta-reward?token=…&puid=…&pc=Coins1&ptid=…` ; le Worker vérifie le jeton
(comparaison à temps constant), plafonne le montant et crédite de façon
idempotente (`ptid`). Réponse **200** ⇒ `onRewardServerSuccess` ⇒ l'app affiche
la récompense. Toute autre réponse ⇒ pas de crédit.

Tant que `ADS_S2S_REWARD_URL` est vide, l'app retombe sur le **crédit client**
existant (`creditAdReward`, borné à 1 récompense/heure par les règles
Firestore). C'est le mode par défaut de la 1.8.0 : il fonctionne, mais reste
plus fragile qu'une validation serveur.

### Lire l'état réel depuis l'appareil

Profil → *Confidentialité des annonces* affiche une phrase d'interprétation et
un bloc **Diagnostic technique** (copiable) :

```text
natif            : oui
SDK initialisé   : oui
consentement     : granted | denied | pending
région           : FR
consentement req.: oui
limited data use : non
interstitiel     : oui/non
récompensé       : oui/non
bannière         : oui/non
dernière erreur  : …
```

Lecture :

- `consentement = pending` ⇒ l'écran de consentement n'a pas encore été
  présenté (ou a été réinitialisé depuis le profil) ;
- `consentement = denied` ⇒ aucune annonce, c'est le comportement attendu ;
- `dernière erreur` contient *no fill* ⇒ la régie répond mais ne remplit pas :
  app non liée au Play Store, placements inactifs, `app-ads.txt` non vu, ou
  Client Token invalide ;
- `SDK initialisé = non` ⇒ problème d'initialisation (réseau, Play Services).

### Brancher une médiation plus tard

Tout le cadencement (délais, plafonds, consentement, diagnostic) vit dans
`src/lib/ads.ts` et ne dépend d'aucun SDK : seule l'implémentation de l'objet
`NativeAds` (le pont `registerPlugin('MetaAds')`) est propre à Meta. Le jour où
une médiation (AppLovin MAX, Unity LevelPlay…) est ajoutée, il suffira de faire
pointer ce pont vers le SDK de médiation et d'y déclarer les placements Meta
comme source — le reste de l'application, y compris les six moments, ne bouge
pas.

## Consentement publicitaire RGPD (F03)

Le consentement est recueilli par l'**écran maison** décrit ci-dessus
(`ConsentGate`), affiché avant la première requête d'annonce pour l'EEE, le
Royaume-Uni, la Suisse et les pays non identifiés. Le choix est stocké dans
`Preferences` (`ads.consent.v1`) et peut être révisé depuis
**Profil → Modifier mes choix publicitaires**. Aucune annonce n'est chargée
tant que l'utilisateur n'a pas accepté.

## Notifications (F10)

Le rappel quotidien à 20 h et les push FCM sont désormais **désactivables**
depuis Profil → *Notifications* (préférences persistées dans `Preferences`).
Aucune permission n'est demandée de façon inconditionnelle.

## Avant publication

- Les mentions légales (`LegalPage.tsx`) sont complètes (CGU, confidentialité,
  mentions légales). Mettre à jour la **fiche Play « Sécurité des données »** en
  cohérence : publicité (**Meta Audience Network**, plus AdMob), géolocalisation,
  activité physique/santé, âge minimum 15 ans.
- Configurer `contact@elysium-esport.fr` comme adresse d'assistance Play Store.
- Vérifier les modèles d'e-mails Firebase Authentication (vérification,
  changement d'e-mail) et les domaines autorisés.
- Créer les offres dans `partnerOffers` (`title`, `description`, `partnerName`,
  `coins`, `active`, `createdAt`).

## Limite de sécurité résiduelle

Firestore borne toujours les montants (validation quotidienne ≤ 60 000 pas,
récompense publicitaire ≤ 1/h, débits atomiques). Le Worker apporte l'attestation
forte manquante (Play Integrity, et validation Meta S2S dès que
`ADS_S2S_REWARD_URL` est renseignée) : sans jeton vérifié côté serveur, le client
ne peut pas créditer son solde sur une preuve externe. **Tant que le S2S Meta
n'est pas activé**, la récompense reste créditée côté client : le plafond
d'1 récompense/heure (règles Firestore) limite l'abus mais ne l'empêche pas. Reste à brancher
un prestataire de paiement réel (PayPal Payouts) pour l'exécution des retraits.
