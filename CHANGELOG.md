# Changelog

## 1.6.0 — 2026-11-02

- **F28** `app-ads.txt` publié. La validation échouait dans la console AdMob
  (« Impossible de valider Elywalk (Android) ») faute de fichier à la racine du
  site déclaré sur Google Play. `app/public/app-ads.txt` contient désormais
  l'enregistrement `google.com, pub-5316598937383510, DIRECT,
  f08c47fec0942fa0` ; Vite le copie dans `app/dist` et Firebase Hosting le sert
  en `text/plain` (règle `headers` de `firebase.json`). Sans ce fichier,
  certains acheteurs programmatiques refusent d'enchérir : moins d'annonces et
  revenus plus faibles.
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
- **F31** Optimisation R8 poussée (recommandation « mémoire et performances »
  de Google Play) : `android.enableR8.fullMode=true`,
  `-allowaccessmodification` et `-repackageclasses ''`, mémoire du démon Gradle
  portée à 4 Go pour absorber la passe d'optimisation complète.
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
