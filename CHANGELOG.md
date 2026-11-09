# Changelog

## 1.8.1 — 2026-11-09

Version de **correctifs** : résout le plantage au lancement dès qu'une session est connectée et l'erreur de compilation R8 en build release (`missing_rules.txt`).

- **F42 Erreur R8 — règles de conservation manquantes (`missing_rules.txt`).**
  `./gradlew :app:minifyReleaseWithR8` échouait car R8 en mode complet (AGP 8+)
  détectait des classes manquantes non marquées par `-dontwarn` :
  - `com.facebook.infer.annotation.**` (annotations Infer du SDK Meta Audience Network) ;
  - `com.facebook.**` (dépendances optionnelles Facebook du plugin `@capacitor-firebase/authentication` : `CallbackManager$Factory`, `AccessToken`, `FacebookCallback`…) ;
  - `androidx.credentials.**`, `com.google.android.gms.auth.**`, `com.google.android.gms.games.**` (handlers optionnels de Firebase Auth) ;
  - suppression de `allowoptimization` sur les plugins natifs (`MetaAdsPlugin`, `StepCounterPlugin`, `TrackingPlugin`) pour garantir que R8 ne renomme ni n'inline leurs méthodes `@PluginMethod` appelées par réflexion via le pont Capacitor.
- **F43 Plantage au lancement une fois connecté — Meta Audience Network.**
  Tant que l'utilisateur n'était pas connecté, la vue `AdBanner` n'était pas
  montée et aucune annonce n'était demandée. Dès la connexion, le montage de
  la bannière et le préchargement de l'interstitiel déclenchaient deux causes
  de plantage immédiat :
  1. `com.facebook.sdk.ApplicationId` dans le `AndroidManifest.xml` était posé en
     valeur numérique brute (`1712220190424595`) : AAPT la convertit en entier/long,
     de sorte que `metaData.getString("com.facebook.sdk.ApplicationId")` renvoyait
     `null`, provoquant un `NullPointerException` / `FacebookException` fatal
     dès la première requête du SDK. La clé pointe désormais vers la ressource chaîne
     `@string/facebook_app_id`.
  2. Sur Android 10+, instancier un `AdView` sans contexte d'activité préalable
     provoquait un arrêt brutal du SDK Meta : `MainActivity.onCreate()` initialise
     désormais explicitement `AudienceNetworkAds.initialize(this)` avec le contexte
     de l'activité.
  3. `MetaAdsPlugin` vérifie systématiquement la validité de l'activité (`isFinishing`),
     isole les rappels d'erreurs et détache proprement la vue avant tout ajout dans le
     conteneur de bannière.
- **F44 Plantage au lancement une fois connecté — Service de pas (FGS Health).**
  Dès la connexion, `pedometer.start()` démarre `StepCounterService` en premier
  plan. Sur Android 14+ (targetSdk 36), un service de premier plan de type `health`
  exige au manifeste la permission normale `HIGH_SAMPLING_RATE_SENSORS` ou la permission
  d'exécution `ACTIVITY_RECOGNITION`. En cas de refus ou de latence d'octroi,
  l'échec de `startForeground()` avec le type santé entraînait un arrêt par le système
  (`ForegroundServiceDidNotStartInTimeException`). Ajout de `HIGH_SAMPLING_RATE_SENSORS`
  et repli sans type si l'appel avec `FOREGROUND_SERVICE_TYPE_HEALTH` est rejeté.

## 1.8.0 — 2026-11-08

Changement de **régie publicitaire** : ElyWalk quitte AdMob (compte refusé par
Google) pour **Meta Audience Network**, intégré en direct, sans aucune
plateforme de médiation. Les six moments publicitaires sont conservés.

- **Régie Meta Audience Network.** Nouveau pont natif `MetaAds`
  (`android/.../MetaAdsPlugin.java`, SDK `com.facebook.android:audience-network-sdk`
  6.22.0) exposant bannière, interstitiel et interstitiel récompensé. Le plugin
  AdMob (`@capacitor-community/admob`) et toute la machinerie UMP sont
  supprimés : plus une seule référence à `ca-app-pub` dans le bundle.
- **Sans médiation.** Meta est branché en direct (pas de TCF, Meta n'étant pas
  au registre IAB). `lib/ads.ts` reste volontairement agnostique du SDK : brancher
  une médiation plus tard ne demandera que de remplacer le pont `NativeAds`.
- **Les six moments conservés**, chacun sur un placement distinct du
  Monetization Manager :
  | Moment | Format | Placement |
  |---|---|---|
  | Ouverture de l'application | interstitiel #2 | `…_1712220353757912` |
  | Validation des pas | interstitiel #2 | `…_1712220353757912` |
  | Vidéo contre des ElyCoins | interstitiel récompensé #6 | `…_1712220367091244` |
  | Retrait d'ElyCoins | interstitiel #2 | `…_1712220353757912` |
  | Chaque page | bannière #1 | `…_1712220347091246` |
  | Fin de sortie GPS | interstitiel #2 | `…_1712220353757912` |
- **Bannière sur toute l'application.** Vue native ancrée en bas de la WebView ;
  sa hauteur est publiée dans `--ad-banner-height`, que la barre d'onglets, les
  écrans et la carte réservent pour ne jamais passer sous l'annonce.
- **Consentement (CMP maison).** Écran affiché une seule fois, avant la première
  requête d'annonce, uniquement dans les zones qui l'exigent (EEE, Royaume-Uni,
  Suisse ; pays indéterminé traité comme « consentement requis »). Refus =
  aucune publicité, et le choix est modifiable dans Profil → *Modifier mes choix
  publicitaires*. Aux États-Unis, Limited Data Use est activé automatiquement
  (`AdSettings.setDataProcessingOptions`).
- **Validation serveur des récompenses (S2S).** Nouvelle route Worker
  `GET /meta-reward` (`token`, `puid`, `pc`, `ptid`) : Meta n'émet
  `onRewardServerSuccess` qu'après un 200, et c'est le Worker qui crédite
  (idempotent sur `ptid`, montant plafonné). Tant que `ADS_S2S_REWARD_URL` est
  vide, repli sur le crédit client borné existant.
- **`app-ads.txt`.** Enregistrement Meta publié :
  `facebook.com, 1598870752271390, DIRECT, c3e20eee3f780d68` (vérifié par
  `scripts/check-app-ads.sh`).

## 1.7.1 — 2026-11-08

Version de **correctifs** : elle traite le plantage au lancement et les deux
avertissements restants de Google Play sur la version 7 (1.7.0).

- **F35 Plantage au lancement — services de premier plan.**
  `TrackingService.onCreate()` restaurait la trace GPS (lecture disque,
  `SharedPreferences`, parsing JSON) **avant** d'appeler `startForeground()`.
  Sur un appareil lent ou une trace volumineuse, ce travail dépassait le délai
  de 5 s imposé par Android après `startForegroundService()` : le système
  terminait le processus (`ForegroundServiceDidNotStartInTimeException`), ce
  que l'utilisateur voit comme une fermeture immédiate de l'application. La
  promotion en premier plan est désormais **la première instruction**, la
  restauration ensuite ; la notification est disponible dès le départ (le canal
  est créé dans `buildNotification()`).
- **F36 Plantage au lancement — pont JavaScript.** `StepCounterService`
  remontait les exceptions du capteur et de sa notification au pont Capacitor,
  qui les relance sur le thread principal (`Bridge.callPluginMethod` →
  `throw new RuntimeException(ex)`), donc en plantage applicatif. Les appels
  sensibles (`StepStore`, listener JS, widget, enregistrement du capteur) sont
  encapsulés. `BootReceiver` passe par `StepCounterService.startQuietly()`, qui
  absorbe `ForegroundServiceStartNotAllowedException` (ROM restrictives).
- **F37 Plantage au lancement — WebView.** Si le moteur de rendu de la WebView
  meurt (mémoire insuffisante, pilote graphique), Android termine le processus
  par défaut : nouvelle implémentation de `WebViewListener.onRenderProcessGone`
  dans `MainActivity`, qui recrée l'activité (`return true`).
- **F38 Écran blanc.** Filet de sécurité côté web : `AppErrorBoundary` +
  `lib/startup-guard.ts`. Une exception de rendu, un bundle illisible ou un
  échec d'initialisation affichent un écran explicite avec un bouton
  « Réessayer » au lieu d'une page blanche. Effets de démarrage (`pedometer`,
  liens entrants, partage système) protégés contre les rejets non capturés.
- **F39 Bord à bord — avertissement « peut ne pas être disponible pour tous les
  utilisateurs ».** `MainActivity` appelle désormais
  `WindowCompat.enableEdgeToEdge(getWindow())` (androidx.core 1.17.0, déjà
  présent), l'API recommandée par Google pour activer le bord à bord de façon
  rétrocompatible sur toutes les versions d'Android. Repli interne si l'appel
  échoue (l'interface ne doit jamais être bloquée par le bord à bord), et icônes
  claires forcées dans les barres système.
- **F40 Bord à bord — avertissement « API ou paramètres obsolètes ».**
  Suppression de `android:statusBarColor`, `android:navigationBarColor`,
  `android:enforceStatusBarContrast` et `android:enforceNavigationBarContrast`
  du thème : dépréciés et sans effet depuis Android 15, ils étaient signalés par
  Play. Les barres sont transparentes par défaut. Le mode encoche reste
  `always` (`values-v30`), remplaçant non déprécié de `shortEdges`.
- **F41 R8 — avertissement « Améliorez la mémoire et les performances avec
  l'optimisation R8 ».** Règles de conservation complétées pour que R8 puisse
  optimiser sans casser l'application : plugin podomètre tiers
  (`app.capgo.pedometer.**`, sans règles « consumer »), `MainActivity`,
  dépendance optionnelle Facebook du plugin Firebase Authentication.
  `android.enableR8.keepLineNumbers=true` conserve des traces de pile lisibles
  sans désactiver l'obscurcissement. `mapping.txt` reste joint à l'AAB.
- Version `8 / 1.7.1` (le `versionCode` doit progresser à chaque envoi).
- Tests : 46 (dont 7 nouveaux sur le filet de sécurité du démarrage).

### ⚠️ Origine de la version 7 (1.7.0) — cause commune des trois symptômes

Vérification faite sur le dépôt : le commit qui a produit la version 7
(`2f24263`, branche `arena795`) descend de la **1.4.0** (`26c48c8`) et **ne
contient pas** les correctifs de la 1.6.0 (PR #13). Son `build.gradle` porte
encore `minifyEnabled false` et son thème n'a ni bord à bord ni mode encoche :

- les deux avertissements Play de la version 7 (« bord à bord » et
  « optimisation R8 ») portent donc sur du code **antérieur** à la 1.6.0 : ces
  correctifs existaient déjà sur `main` mais n'ont jamais été publiés ;
- le plantage au lancement est celui du code natif de la 1.4.0 : promotion en
  premier plan trop tardive, exceptions du pont non capturées, aucun filet de
  sécurité si le moteur de rendu WebView meurt (F35 à F38) ;
- seul changement fonctionnel de la version 7 : la migration des identifiants
  AdMob (`d097b14`), déjà présente sur `main`.

**Conséquence opérationnelle :** la version 8 doit être construite depuis
`main` (cette branche), jamais depuis une branche de travail oubliée ni depuis
un AAB archivé.

## 1.6.0 — 2026-11-02

- **F28** `app-ads.txt` publié. La validation échouait dans la console AdMob
  (« Impossible de valider Elywalk (Android) ») faute de fichier à la racine du
  site déclaré sur Google Play. `app/public/app-ads.txt` contient désormais
  l'enregistrement `google.com, pub-5316598937383510, DIRECT,
  f08c47fec0942fa0` ; Vite le copie dans `app/dist` et Firebase Hosting le sert
  en `text/plain` (règle `headers` de `firebase.json`), avec un `robots.txt`
  qui autorise explicitement le robot `Google-adstxt`. ⚠️ La fiche Play déclare
  `https://elysium-esport.fr` (site Vercel) : c'est **ce** domaine qu'AdMob
  explore — le fichier y est en ligne depuis le 2026-11-02 — et le déploiement
  Firebase n'en est qu'un miroir (voir DEPLOYMENT.md). Script de diagnostic :
  `scripts/check-app-ads.sh`. Sans ce fichier, certains acheteurs
  programmatiques refusent d'enchérir : moins d'annonces et revenus plus
  faibles.
- **F29** Affichage de bord à bord désormais actif pour **tous** les
  utilisateurs : `WindowCompat.setDecorFitsSystemWindows(window, false)` n'est
  plus conditionné à la version de WebView installée (c'est ce test qui valait
  l'avertissement Play « peut ne pas être disponible pour tous les
  utilisateurs »). Un repli natif applique les marges de sécurité uniquement
  sur les appareils antérieurs à Android 15 dont la WebView ne gère pas
  `env(safe-area-inset-*)`.
- **F30** Mode encoche `always` déclaré aussi dans le thème (`values-v30`),
  pour la fenêtre de l'application **et** pour l'écran de lancement : plus
  aucune ressource de l'application ne demande `shortEdges`, déprécié depuis
  Android 15.
- **F31** Optimisation R8 (recommandation « mémoire et performances » de Google
  Play) : `android.enableR8.fullMode=true` et mémoire du démon Gradle portée à
  4 Go pour absorber la passe d'optimisation complète. Pas de
  `-repackageclasses ''` / `-allowaccessmodification` : sans effet sur le
  verdict de Play, mais déplacement de classes repérées par leur nom complet.
- **F33** Diagnostic publicitaire lisible. Détecte notamment l'absence de
  message de consentement dans AdMob (`NOT_REQUIRED` + aucun formulaire +
  aucune option de confidentialité), cause d'un remplissage nul en EEE/UK
  depuis que Google impose une CMP certifiée. Profil → *Confidentialité des
  annonces* explique désormais **pourquoi** aucune annonce ne sort (message
  RGPD non publié pour l'application, consentement refusé, « no fill » de la
  régie, SDK non initialisé) et propose un bloc technique copiable.
- **F34** Blocs d'annonces de test Google activables au build
  (`VITE_TEST_ADS=1 npm run build`), comme sur Orbit Hop : permet de vérifier
  le câblage sans dépendre de l'état du compte AdMob, et sans risque de
  « trafic invalide ». Les identifiants de test sont éliminés statiquement du
  paquet de production.
- **F32** SDK Google Mobile Ads aligné sur `25.5.+` (dernière version de la
  branche recommandée par Google pour Android 15).

## 1.5.0 — 2026-11-02

- **F24** Publicités réparées. Les identifiants AdMob pointaient vers un autre
  compte que celui de l'application : aucune annonce ne pouvait être servie.
  L'ID d'application (`ca-app-pub-5316598937383510~4963026878`) est désormais
  identique dans `AndroidManifest.xml` et `src/lib/constants.ts`, et les trois
  blocs d'annonces du compte ElyWalk sont câblés :
  - *annonce à l'ouverture* (`…/6986554989`) au lancement et au retour dans l'app ;
  - *interstitiel* (`…/7972992736`) à la validation des pas, **à la fin d'une
    sortie** et **après une demande de retrait** ;
  - *vidéo avec récompense* (`…/9832210178`) pour « Regarder une pub pour
    gagner 0,1 ElyCoins » (identifiant transmis en SSV).
- **F25** Chargement des annonces fiabilisé : initialisation unique (plus de
  double `initialize()` concurrent), nouvelle tentative de consentement après
  un échec réseau, préchargement et rechargement automatique de l'interstitiel,
  délai minimal entre deux annonces, et aucune annonce d'ouverture enchaînée
  sur une autre annonce plein écran. L'interstitiel passe **après** l'action
  (validation, sortie, retrait) : une pub indisponible ne fait plus perdre
  l'opération. Profil → *Confidentialité des annonces* affiche l'état réel de
  la régie.
- **F26** Optimisation du code DEX exigée par Google Play : la version de
  production est minifiée et obscurcie par R8 (`minifyEnabled` +
  `shrinkResources`) avec des règles de conservation pour Capacitor, les
  plugins natifs et le widget.
- **F27** Affichage de bord à bord (Android 15) : activation rétrocompatible
  sans API obsolète (plus de `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` côté
  application), barres système transparentes via le thème, encarts transmis au
  CSS (`env(safe-area-inset-*)`), et SDK Google Mobile Ads aligné sur la
  branche 25.x qui supprime l'usage de cette API dépréciée.
- **Correctif** `@capacitor/filesystem` et `@capacitor/share` n'étaient pas
  inclus dans le projet Android (partage d'image et export de fichiers).

## 1.4.0 — 2026-10-22

- **F16** Pause / reprise d'une sortie : nouveau bouton dans l'écran Sortie GPS et méthodes `pause()` / `resume()` du plugin `Tracking`. Le service natif `TrackingService` gère l'état `paused` (GPS coupé, notification « en pause », reprise après kill du process) et le temps de pause est exclu de la durée active, de la vitesse et de l'allure.
- **F17** Export GPX / CSV : une sortie s'exporte en GPX 1.1 (importable dans Strava, Garmin, Google Earth) et en CSV (une ligne par sortie) ; l'historique des pas quotidiens s'exporte aussi en CSV, en complément de l'export RGPD JSON.
- **F18** Renommer et annoter une sortie : titre personnalisé (80 caractères), note privée (500 caractères) et météo ressentie, éditables depuis la fiche de la sortie. Le titre et la météo apparaissent sur l'image partagée.
- **F19** Filtres et pagination de « Mes sorties » : par type (marche / course), par période (7 j, 30 j, 1 an) et par distance minimale, avec pagination par curseur (20 sorties par page, bouton « Charger plus ») au lieu de la limite fixe à 20.
- **F20** Indicateur de qualité GPS en direct : précision du dernier point, alerte quand le signal se dégrade, et mode « économie de batterie » (moins de points, précision moindre) appliqué côté natif et côté web.
- **F21** Résumés hebdomadaires et mensuels dans Activité : pas, distance, kcal et jours actifs, comparaison avec la semaine / le mois précédent, et partage de la synthèse en image.
- **F22** Objectif de sortie (« marcher 5 km ») : presets 1/3/5/10 km ou valeur libre, progression en direct et toast + notification locale à l'atteinte.
- **F23** Cartes de sorties thématisées : choix du fond de carte de l'image partagée entre Voyager, Sombre et Satellite (tuiles CARTO / ESRI déjà branchées et compatibles CORS).

## 1.3.0 — 2026-08-21

- **F12** Carte : fin du message « Aucun partenaire sur la carte ».
- **F13** « Partager mes pas du jour » génère enfin un vrai fichier : écriture dans le cache + feuille de partage système (`@capacitor/filesystem` + `@capacitor/share`). Le téléchargement blob ne fonctionnait pas en WebView.
- **F14** « Démarrer la sortie » tourne en arrière-plan : nouveau service natif de premier plan (`TrackingService`, type `location`) qui enregistre le parcours GPS même app fermée, avec notification persistante et reprise après kill du process. Branché via le plugin Capacitor `Tracking`.
- **F15** Sorties consultables et partageables : nouvelle page de détail (`/activity/:id`) affichant le trajet, les pas, les calories, la distance, la durée, la vitesse moyenne et l’allure, avec partage en image (carte du parcours + stats). Les pas sont comptés via le delta du podomètre pendant la sortie.

## 1.2.0 — 2026-08-20

- **F01** Icônes launcher + splash générées depuis le logo marcheur (or/noir), fini le placeholder Capacitor.
- **F02** Identifiant Android réel : `com.elysium.elywalk` (fin de `com.example.elywalk`).
- **F03** Consentement publicitaire RGPD via Google UMP / Funding Choices, révocable (options de confidentialité).
- **F04** Garde-fous des App Open Ads : plafond journalier, cooldown, exemption tant que l'onboarding n'est pas terminé.
- **F05** Attestation serveur : Play Integrity + AdMob Server-Side Verification (Worker Cloudflare).
- **F06** Backend de confiance 100 % gratuit (Cloudflare Workers) : push, payouts, attestation.
- **F07** `assetlinks.json` (App Links) + script de génération de l'empreinte SHA-256.
- **F08** Mentions légales / CGU / confidentialité complètes (âge 15 ans, AdMob, géolocalisation, santé).
- **F09** Changement d'adresse e-mail Firebase (avec ré-authentification).
- **F10** Paramètres de notifications : rappel 20 h et push désactivables depuis le profil.
- **F11** Consommation réelle des jetons FCM (demandes d'amis, retraits) par le cron du Worker.

## 1.1.0 — 2026-08-18

- Sécurisation de l’économie ElyCoins par transactions atomiques et règles Firestore.
- Contrôle des pas, limitation horaire des pubs et remboursement des retraits refusés.
- Catalogue partenaires et réservation avec ElyCoins.
- Historique, graphe, distance, objectifs personnalisés et badges.
- Mot de passe oublié/changement, vérification e-mail, export et suppression RGPD.
- CGU, confidentialité, mentions légales et onboarding.
- Demandes d’amis envoyées, recherche par pseudo, partage, suppression et profils publics.
- Classements alternatifs, actualisation, carte enrichie, recherche, proximité et itinéraires.
- Gestion explicite du hors-ligne et confirmations sensibles.
- Premiers tests automatisés.
