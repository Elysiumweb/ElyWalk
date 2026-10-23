# Changelog

## 1.5.0 — 2026-10-23 — passage en production

- **F24 — Publicités AdMob réparées.** Les identifiants pointaient vers un **autre compte AdMob** (`ca-app-pub-6906841385343667`). L'`APPLICATION_ID` du manifeste ne correspondait donc pas au compte courant : `AdMob.initialize()` échouait silencieusement et **aucune annonce n'était servie**. Tout est aligné sur le compte `ca-app-pub-5316598937383510` (application `~4963026878`, App Open `6986554989`, interstitiel `7972992736`, récompensée `9832210178`). Un test unitaire (`src/lib/ads-config.test.ts`) verrouille la cohérence `constants.ts` ↔ `AndroidManifest.xml`.
- **F25 — Emplacements publicitaires complets.** App Open à l'ouverture et au retour au premier plan (plafond 3/jour, cooldown 30 min, jamais juste après un autre plein écran) ; interstitiel après la **validation des pas**, la **fin d'une sortie GPS** et une **demande de retrait** ; vidéo récompensée (« +0,1 ElyCoin ») avec SSV `userId`. Les interstitiels sont préchargés et espacés de 45 s ; les récompenses ne dépendent jamais du chargement d'une annonce.
- **F26 — Affichage de bord à bord (Android 15).** `EdgeToEdge.enable()` en rétrocompatibilité (si WebView ≥ 140), barres système transparentes, icônes claires, et encarts consommés côté web via `--safe-area-inset-*` (Capacitor `SystemBars`) avec repli sur `env(safe-area-inset-*)`. Plus aucune API obsolète de découpe d'écran utilisée par le code applicatif.
- **F27 — Build de production optimisé (R8).** `minifyEnabled` + `shrinkResources` avec règles ProGuard dédiées (Capacitor, plugins natifs, AdMob, Firebase, widget, services) : corrige l'alerte Play Console « obscurcissement du code DEX : 1 % » et réduit la taille de l'APK/AAB.
- **F28 — Empreinte mémoire réduite.** Bundle web découpé (firebase / leaflet / react / capacitor / vendor) : la WebView n'analyse plus un fichier unique de 1,3 Mo au démarrage.
- Version `versionCode 4` / `versionName 1.5.0`.

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
