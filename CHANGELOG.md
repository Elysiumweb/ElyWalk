# Changelog

## 2.1.4 — 2026-11-11

### Conformité « Sécurité des données » (refus Play du build 20103)

- **D01 — Cause du refus identifiée.** Google Play a refusé la version 20103 :
  « Sécurité des données (Applis installées : non déclaré) ». Le code de
  l'application ne contient **aucun** appel d'énumération de paquets —
  vérification sur `app/android` (Java + manifeste) **et** sur les manifestes de
  tous les plugins Capacitor : zéro occurrence de `QUERY_ALL_PACKAGES`,
  `<queries>`, `getInstalledPackages`, `queryIntentActivities`. La source est le
  SDK de médiation : Unity documente que LevelPlay appelait
  `PackageManager.getInstalledApplications(0)` (correctif 9.4.3) et
  `getPackagesForUid`, et le SDK 9.7.0 embarqué en conserve des usages. La
  déclaration doit donc couvrir le SDK tiers, pas seulement notre code.
- **D02 — Réponse à Play : conserver la fonctionnalité et déclarer.** Option 1
  retenue : « Activité dans les applis → Applis installées » = collecté **et**
  partagé, finalité *Publicité ou marketing*, obligatoire, chiffré en transit,
  sans suppression à la demande, non éphémère. Le formulaire décrit le
  comportement réel du SDK : le retirer de nos sources n'empêcherait pas l'appel.
- **D03 — Divulgation renforcée dans l'application.** L'écran de consentement
  publicitaire mentionne explicitement la consultation de la liste des
  applications installées, y compris en annonces non personnalisées
  (`AdConsentSheet`, `data-testid="ad-consent-installed-apps"`).
- **D04 — Politique de confidentialité.** Nouvelles sections **4.1** (« Applications
  installées » : données, destinataires, finalité, caractère obligatoire,
  chiffrement, absence de `QUERY_ALL_PACKAGES`) et **4.2** (désinstallation,
  réinitialisation de l'identifiant publicitaire), ligne dédiée au tableau des
  données et mise à jour de la liste des destinataires.
- **D05 — Confidentialité LevelPlay complétée.** En plus de
  `setGDPRConsent`, le pont natif applique `setCCPA(!personalized)` et
  `setCOPPA(false)` avant toute initialisation (`LevelPlayAdsPlugin`).
- **D06 — Itinéraires marche / vélo / voiture corrigés.** Le serveur OSRM de
  démonstration ignore le profil demandé (`/foot` et `/bike` renvoient le même
  trajet voiture) : le calcul passe désormais par **Valhalla** (FOSSGIS, données
  OpenStreetMap), qui applique réellement le coût `pedestrian` / `bicycle` /
  `auto` et renvoie des consignes en français. OSRM reste en secours, avec durée
  recalculée (4,8 km/h à pied, 15 km/h à vélo). Trois tests ajoutés.
- **D07 — Version 2.1.4 (versionCode 20104)** : le build 20103 refusé ne peut
  pas être réutilisé.

## 2.1.3 — 2026-11-11

### Correctifs de saisie, de photo de profil et de sorties

- **B01** Saisie qui « sautait » à chaque lettre : le focus du composant
  `Sheet` (feuilles Profil, Rencontres, Parcours…) était rejoué à chaque rendu
  du parent et renvoyait le curseur sur la croix de fermeture. L'effet ne dépend
  plus que de l'ouverture, le focus initial est donné à la feuille elle-même, et
  il n'est jamais volé à un champ déjà actif. Le focus est rendu au déclencheur à
  la fermeture (test de régression : `components/Sheet.test.tsx`, vérifié en
  échec sur l'ancien code et au vert sur le nouveau).
- **B02** Photo de profil qui chargeait à l'infini : l'application tentait un
  envoi Firebase Storage (bucket inexistant) dont l'attente n'aboutissait jamais.
  La photo est désormais **recadrée et compressée localement** puis stockée en
  **base64 dans le document Firestore** `users/{uid}.photoURL` (paliers 192 → 96
  px, cible < 60 Ko, une seule écriture Firestore, plus aucun appel réseau
  externe). L'aperçu affiche « Photo prête (x Ko) » avant l'enregistrement, et
  les anciennes photos trop lourdes sont recompressées une fois au chargement du
  profil.
- **B03** « The query requires an index » sur les sorties : la pagination
  triait explicitement par `documentId()`, ce qui réclamait un index composite
  différent pour chaque filtre. Le tri secondaire est laissé à Firestore
  (`__name__` implicite) ; `firestore.indexes.json` déclare désormais les index
  `activitySessions`, `savedRoutes` et `eventNotifications` réellement utilisés
  (les anciens index à quatre champs restent pour les versions installées).
- **B04** Rencontres : « Rejoindre » n'inscrit plus l'organisateur en liste
  d'attente quand sa sortie est complète, quitter sa propre sortie ne produit
  plus d'erreur de permission, et un badge « Vous organisez cette sortie »
  remplace les actions impossibles.

### Carte et itinéraires

- **F35** Carte réorganisée : la recherche ne recouvre plus les accès
  « Parcours / Événements / Sortie » (en-tête en flux), et le bouton de
  localisation, le zoom et la fiche partenaire sont calés **dans la zone carte**,
  au-dessus de la bannière publicitaire et de la barre d'onglets.
- **F36** Itinéraire intégré à l'application : nouvelle feuille plein écran
  (carte, établissements et Rencontres) avec **adresse réelle** de départ et
  d'arrivée (Nominatim), point de départ = position actuelle ou adresse saisie,
  et itinéraire calculé pour **à pied, à vélo, en voiture** (OSRM) et en
  **transports en commun** (OpenTripPlanner Île-de-France Mobilités : lignes,
  direction, correspondances, durée). Tracé dessiné sur la carte, consignes
  étape par étape, durée et distance ; « Ouvrir dans Google Maps » reste un
  bouton de secours explicite. Politique de confidentialité complétée
  (§ destinataires + § 5.1).
- **F37** Version 2.1.3 (versionCode **20103**) pour que Play Console accepte la
  publication.

## 2.1.0 — 2026-11-11

### Régie publicitaire : Unity LevelPlay en médiation, Meta Audience Network en bidding

- **F30** Nouvelle plateforme de médiation : **Unity LevelPlay** (app key
  `29767936d`) remplace l'appel direct au SDK Meta. Meta Audience Network y est
  branché en **in-app bidding** via `com.unity3d.ads-mediation:facebook-adapter` :
  LevelPlay arbitre les enchères, Meta n'est plus intégré à la main. Nouveau
  plugin Capacitor maison `LevelPlayAdsPlugin.java` (suppression de
  `MetaAdsPlugin.java` et des layouts `meta_ad_*.xml`) — il n'existe pas de
  plugin Capacitor officiel pour LevelPlay.
- **F31** Les quatre ad units produits sont branchés : bannière
  `g1zzk5uxi41cpcc2` (toutes les pages), interstitiel `s73ihk59x7y52d6v`
  (ouverture, validation des pas, fin de sortie), natif `kz81dz4wdl6v0kue`
  (bandeau compact sur `/history` + carte de fin de sortie), vidéo récompensée
  `l9z2u3fws3nm1cfc`. Le medium rectangle 300×250 réutilise l'ad unit bannière
  (taille `MEDIUM_RECTANGLE`).
- **F32** Récompense LevelPlay **ElyCoin × 1 = 0,1 ElyCoin** : conversion
  centralisée (`rewardCoinsFrom`), récompense ignorée si le nom ou le montant
  annoncés diffèrent, crédit toujours borné par le slot Firestore `adClaims`
  (1 récompense par heure et par compte). L'UID est transmis à LevelPlay
  (`setDynamicUserId`) pour préparer les callbacks serveur-à-serveur.
- **F33** Consentement RGPD appliqué **avant** l'initialisation
  (`LevelPlayPrivacySettings.setGDPRConsent`), donc transmis à chaque réseau
  médié, et modifiable à chaud. Aucune annonce n'est demandée tant qu'aucun
  choix n'a été exprimé. Le format natif retombe automatiquement sur la bannière
  320×50 s'il n'y a pas de remplissage.
- **F34** Version à source unique : `app/package.json` alimente `__APP_VERSION__`
  (Vite) **et** `versionName` / `versionCode` Android (2.1.0 → 20100). Le Profil
  et l'écran Nouveautés n'écrivent plus la version en dur ; Play Console exige un
  `versionCode` supérieur à chaque publication.
- Documentation : `DEPLOYMENT.md` § « Unity LevelPlay » (ad units, bidding Meta,
  `app-ads.txt`, build Gradle), politique de confidentialité et page légale
  mises à jour (LevelPlay comme plateforme de médiation).

### Design et accessibilité

- **D35** Libellés de navigation visibles sur téléphone : chaque onglet affiche
  un libellé court (« Rangs » pour « Classement ») sous son icône, avec le
  libellé complet en `aria-label` et des badges qui ne chevauchent plus le texte.
- **D36** Hiérarchie de l'accueil : le compteur et « Valider mes pas » restent
  dominants ; les cinq accès secondaires passent en grille compacte 2 colonnes,
  repliable, et l'action publicitaire ne partage plus la ligne du barème.
- **D37** Plancher de lisibilité : plus aucune information utile sous 12 px
  (libellés de graphiques, métadonnées de défis, statistiques, calendrier) ;
  le texte secondaire s'enroule au lieu d'être tronqué.
- **D38** Jetons partagés (`--space-*`, `--text-*`) et classes utilitaires
  (`.stack-sm`, `.row-between`, `.muted-text`, `.muted-xs`, `.title-sm`) en
  remplacement des styles en ligne des pages retouchées.
- **D39** Rencontres : date du jour calculée en heure locale (fini
  `toISOString()`), fuseau de l'appareil affiché, `min` sur le champ date et
  refus d'une sortie créée dans le passé.
- **D40** Nouveau réglage « Affichage » : **Système / Sombre / Contraste
  renforcé** (`appearance.ts` + `appearance.css`). Le mode contraste éclaircit
  les textes discrets, renforce les bordures et rend les états désactivés
  identifiables autrement que par l'opacité ; la charte noir/or est conservée.

## 1.9.0 — 2026-11-09

### Régie publicitaire : passage d'AdMob à Meta Audience Network

- **F24** Migration complète de la régie : le SDK Google Mobile Ads et le plugin
  `@capacitor-community/admob` sont retirés au profit de **Meta Audience Network**
  (`com.facebook.android:audience-network-sdk`). Nouveau plugin Capacitor maison
  `MetaAdsPlugin.java` (bannière, native banner, interstitiel, interstitiel
  récompensé, medium rectangle, carte native) — il n'existe pas de plugin
  Capacitor officiel pour Meta AN.
- **F25** Les six emplacements produits sont branchés : bannière 320×50 sur
  toutes les pages (`AdBanner`), interstitiel à l'ouverture (plafond 2/jour,
  cooldown 10 min), interstitiel à la validation des pas, interstitiel récompensé
  pour la vidéo ElyCoins, medium rectangle 300×250 avant un retrait, carte native
  à la fin d'une sortie. Le placement « native banner » sert de bandeau compact
  sur la page « Mes sorties ».
- **F26** `app/public/app-ads.txt` déclare Meta (`facebook.com, 1598870752271390,
  DIRECT, c3e20eee3f780d68`), servi à la racine du domaine Hosting.
- **F27** Consentement RGPD sans dépendance externe : nouveau module
  `lib/adConsent.ts` + écran `AdConsentSheet` (annonces personnalisées ou non).
  Aucune annonce n'est demandée tant qu'aucun choix n'a été exprimé ; le choix
  est révocable depuis Profil → *Confidentialité des annonces*.
- **F28** Fin de la dépendance à AdMob SSV : la récompense ElyCoins est créditée
  côté client, bornée par la transaction Firestore `adClaims` (une récompense par
  heure et par compte). L'endpoint `/ssv` du Worker reste en place mais n'est
  plus utilisé.
- **F29** La bannière native réserve sa hauteur via la variable CSS
  `--ad-banner-h` : la barre d'onglets, les feuilles modales et les écrans
  (carte, sortie GPS) remontent automatiquement pour ne jamais être masqués.
- Textes légaux (CGU, politique de confidentialité, suppression de données) mis à
  jour : Meta Platforms Ireland Ltd comme sous-traitant publicitaire, portée du
  consentement, permissions `ACCESS_NETWORK_STATE` et `AD_ID`.

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
