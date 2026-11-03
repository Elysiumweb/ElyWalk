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

## app-ads.txt — validation AdMob (annonces monétisées)

AdMob refuse de valider l'application tant qu'il ne trouve pas, à la **racine du
domaine développeur déclaré sur Google Play**, un fichier `app-ads.txt` conforme à
la spec IAB Tech Lab et contenant **l'ID éditeur du compte AdMob** qui possède
l'application. Le message « vos informations ne correspondent pas à celles de
votre compte AdMob » recouvre deux causes : fichier absent, ou ID éditeur
différent de celui du compte.

- Fichier source : `app/public/app-ads.txt` (une seule ligne de données, ASCII,
  fins de ligne LF, sans BOM).
- Vite copie `app/public/*` dans `app/dist/`, donc le fichier est publié tel quel
  par Firebase Hosting, **avant** la réécriture SPA (`rewrites: **`) : les
  fichiers statiques sont servis en priorité.
- En-tête forcé en `text/plain; charset=utf-8` dans `firebase.json` (`headers`).

**La fiche Play Store pointe sur `https://elysium-esport.fr`** : c'est donc
`https://elysium-esport.fr/app-ads.txt` qu'AdMob interroge, et c'est ce fichier
qui fait foi. Il est publié depuis le dépôt du site (`Elysiumweb/main`,
`public/app-ads.txt`, déployé par Vercel, 59 octets identiques).

La copie de ce dépôt (`https://elywalk-2f7ba.web.app/app-ads.txt`, servie aussi
sur `.firebaseapp.com`) reste utile comme **secours** : si la fiche Play devait
basculer vers ce domaine, le fichier est déjà en place. Elle n'est pas lue par
AdMob tant que la fiche Play indique `elysium-esport.fr`.

Contenu actuel :

```
google.com, pub-5316598937383510, DIRECT, f08c47fec0942fa0
```

| Champ | Valeur | Rôle |
| --- | --- | --- |
| domaine | `google.com` | système publicitaire |
| ID éditeur | `pub-5316598937383510` | compte AdMob propriétaire de l'app |
| relation | `DIRECT` | inventaire vendu directement |
| ID de certification | `f08c47fec0942fa0` | TAG ID de Google |

Vérification locale et distante :

```bash
cd app
npm run check:app-ads                        # format + cohérence avec le code
npm run check:app-ads -- --url https://elysium-esport.fr/app-ads.txt
                                             # 200 + text/plain + contenu à jour
npm run check:app-ads -- --url https://elywalk-2f7ba.web.app/app-ads.txt
```

Contrôle manuel de ce que voit le crawler (client HTTP simple, sans JavaScript) :

```bash
curl -sS -D - -o /dev/null https://elysium-esport.fr/app-ads.txt
# attendu : HTTP/2 200 · content-type: text/plain; charset=utf-8 · aucun
# en-tête x-vercel-mitigated
```

Le script vérifie l'encodage (pas de BOM, pas de CRLF, pas d'espace parasite),
les 4 champs séparés par « , », la validité de l'ID éditeur, de la relation et
de l'ID de certification, puis compare l'ID éditeur avec les identifiants AdMob
du code (`constants.ts`, `AndroidManifest.xml`). Il sort en erreur si le fichier
est mal formé ; `--strict` rend aussi bloquants les écarts de compte.

Publication :

```bash
npm run build && firebase deploy --only hosting
```

Puis, dans la console AdMob, section *app-ads.txt* de l'application →
**Vérifier les modifications** (le crawl peut prendre de quelques minutes à 24 h ;
Google ne recrawle pas le fichier plus d'une fois par 24 h).

### Identifiants AdMob — compte `pub-5316598937383510`

Tous les identifiants publicitaires de l'application sont alignés sur le compte
qui valide `app-ads.txt`. Ils doivent rester ensemble : un bloc d'annonce d'un
autre compte ne remplit pas et la SSV du Worker (`/ssv`) ne correspond jamais.

| Emplacement | Constante | Valeur |
| --- | --- | --- |
| `app/src/lib/constants.ts` | `ADMOB_APP_ID` | `ca-app-pub-5316598937383510~4963026878` |
| `app/src/lib/constants.ts` | `AD_UNIT_REWARDED` | `ca-app-pub-5316598937383510/9832210178` |
| `app/src/lib/constants.ts` | `AD_UNIT_APP_OPEN` | `ca-app-pub-5316598937383510/6986554989` |
| `app/src/lib/constants.ts` | `AD_UNIT_INTERSTITIAL` | `ca-app-pub-5316598937383510/7972992736` |
| `AndroidManifest.xml` | `com.google.android.gms.ads.APPLICATION_ID` | `ca-app-pub-5316598937383510~4963026878` |

Après toute modification de ces identifiants :

```bash
cd app
npm run build                # régénère dist/ avec les nouveaux IDs
npx cap sync android         # les recopie dans android/app/src/main/assets/public
npm run check:app-ads -- --strict   # vérifie code, manifest, bundle et app-ads.txt
```

`check:app-ads` échoue aussi si le bundle web embarqué dans le projet Android
(`app/android/app/src/main/assets/public`) contient encore un éditeur absent de
`app-ads.txt` — c'est le symptôme d'un `cap sync` oublié, donc d'un APK qui part
avec les anciens blocs. Les anciens identifiants du compte
`pub-6906841385343667` (`~6481018527`, blocs `/3683414466`, `/6616749893`,
`/3494240028`) sont obsolètes et ne doivent pas revenir.

### Vercel : vérifier que le pare-feu ne challenge pas le crawler

Le site `elysium-esport.fr` est hébergé sur **Vercel**. Une sonde HTTP simple a
renvoyé une fois, le 2026-11-03 :

```
HTTP/1.1 429 Too Many Requests
Server: Vercel
X-Vercel-Mitigated: challenge
```

C'est le **Security Checkpoint** de Vercel (Attack Mode / challenge de bots) :
seul un navigateur capable d'exécuter du JavaScript le franchit. Le crawler
`app-ads.txt` d'AdMob est un client HTTP simple — il recevrait la page de
challenge au lieu du fichier. Les robots vérifiés (Googlebot, Bingbot) sont
exemptés, mais le crawler AdMob n'est pas dans cette liste.

Les sondes suivantes, quelques minutes plus tard, renvoyaient bien `200` avec
`Content-Type: text/plain; charset=utf-8` et 59 octets : le blocage n'était donc
pas permanent. À recontrôler si la validation AdMob échoue encore.

```
HTTP/2 200
Content-Type: text/plain; charset=utf-8
Content-Length: 59
Cache-Control: public, max-age=0, must-revalidate
Content-Disposition: inline; filename="app-ads.txt"
```

Si le challenge réapparaît, dans le tableau de bord Vercel (projet du site) :

1. *Firewall* → **Bot Management** → **Attack Mode** : **Disable**
   (ou `vercel firewall attack-mode disable --yes`). Ce mode est un outil
   d'urgence anti-DDoS, pas un réglage permanent.
2. *Firewall* → *Rules* : aucune règle ne doit faire `challenge`/`deny` sur
   `/app-ads.txt` ; ajouter au-dessus une règle `bypass` sur
   `path eq /app-ads.txt` si nécessaire (les règles personnalisées passent avant
   les règles gérées).
3. *Firewall* → *Overview* : plus aucune requête `/app-ads.txt` marquée
   `challenge`.

Une règle `bypass` du WAF ne contourne ni Attack Mode ni les mitigations
système. Si le challenge doit rester global, l'alternative est de pointer le
champ *Site Web* de la fiche Play vers `elywalk-2f7ba.web.app` (Firebase
Hosting, sans challenge), où le fichier est déjà publié — le champ se modifie
sans nouvelle version de l'APK.

Le rewrite SPA du site (`/(.*) → /index.html` dans `vercel.json`) ne masque pas
le fichier : Vercel sert les fichiers statiques avant les rewrites. En revanche,
si `public/app-ads.txt` disparaissait du déploiement, `/app-ads.txt` renverrait
`index.html` en 200 HTML — donc un contenu invalide plutôt qu'un 404.

### Fiche Play Store (vérifiée le 2026-11-03)

`https://play.google.com/store/apps/details?id=com.elysium.elywalk` est publiée
(éditeur *Elysium Esport*, mention « Contient des annonces ») et son champ
*Site Web* vaut **`https://elysium-esport.fr/`** : c'est exactement ce domaine
qu'AdMob interroge. Les trois conditions de validation sont donc réunies —
fichier au bon endroit, bon ID éditeur, domaine correspondant à la fiche.

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
https://elywalk-2f7ba.web.app/app-ads.txt           # validation AdMob (fichier, pas une page)
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

La version Android est `4 / 1.7.0` (versionCode 4, obligatoire pour publier un nouvel AAB).

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
- **Fiche Play → *Site Web*** : saisir le domaine exact où `app-ads.txt` est publié
  (`elywalk-2f7ba.web.app`), puis lancer *Vérifier les modifications* dans AdMob.
  Le domaine de la fiche Play est celui que le crawler interroge, sans redirection.
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
