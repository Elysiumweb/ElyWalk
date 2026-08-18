# Vérification par téléphone & App Check — ElyWalk

Ce document décrit **ce qui a été corrigé dans le code** et **ce qu'il reste à
configurer dans la console Firebase / Google Cloud** pour que la connexion par
SMS et App Check fonctionnent.

Références :
- [S'authentifier avec Firebase sur Android à l'aide d'un numéro de téléphone](https://firebase.google.com/docs/auth/android/phone-auth?hl=fr)
- [Plugin `@capacitor-firebase/authentication` — Firebase JS SDK](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/firebase-js-sdk.md)
- [Plugin `@capacitor-firebase/app-check` — Firebase JS SDK](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/app-check/docs/firebase-js-sdk.md)

---

## 1. Pourquoi la vérification du numéro ne marchait pas

L'app est un Capacitor + WebView : la **session Firebase utilisée par Firestore
est celle du SDK JS** (`firebase/auth`), alors que l'envoi du SMS est fait par
le **SDK natif Android** (plugin Capacitor).

Quatre bugs se cumulaient :

| # | Problème | Conséquence | Correctif |
|---|----------|-------------|-----------|
| 1 | Le code SMS était **consommé deux fois** : `FirebaseAuthentication.confirmVerificationCode()` (natif) **puis** `signInWithCredential()` (JS) | `auth/invalid-verification-code` / `auth/session-expired` à chaque validation du code | On appelle `signInWithPhoneNumber({ skipNativeAuth: true })` : le natif ne fait que la vérification d'application + l'envoi du SMS, la connexion est faite **une seule fois** côté JS avec `PhoneAuthProvider.credential(verificationId, code)` |
| 2 | L'**auto-retrieval** Android (lecture automatique du SMS) n'était pas désactivé et l'événement `phoneVerificationCompleted` n'était pas géré | Sur beaucoup d'appareils, aucun `phoneCodeSent` n'était émis → l'app restait bloquée puis « Délai dépassé » | `timeout: 0` (désactive l'auto-retrieval, recommandé par la doc du plugin quand on utilise le SDK JS) + écoute de `phoneVerificationCompleted` avec un message clair |
| 3 | `FirebaseAuthentication.removeAllListeners()` était appelé (supprime **tous** les listeners du plugin, y compris `authStateChange`) | Effets de bord sur l'état de session | On ne retire que les `PluginListenerHandle` créés pour ce flux (`handle.remove()`) |
| 4 | La liaison d'un numéro (`ProfilePage`) utilisait `linkWithPhoneNumber` **natif**, or `skipNativeAuth` n'a aucun effet sur le linking et l'utilisateur n'est pas connecté sur la couche native | Échec systématique de « Vérifier mon téléphone » | La liaison se fait côté JS : `linkWithCredential(auth.currentUser, PhoneAuthProvider.credential(...))` |

Autres améliorations :
- `RecaptchaVerifier` (web) : recréé après échec (un reCAPTCHA consommé n'est pas
  réutilisable) et contrôle de la présence du conteneur DOM.
- `setLanguageCode('fr')` côté natif → le SMS est envoyé en français.
- Messages d'erreur FR ajoutés : `auth/code-expired`, `auth/quota-exceeded`,
  `auth/captcha-check-failed`, `auth/missing-client-identifier`,
  `auth/app-not-authorized`, `auth/firebase-app-check-token-is-invalid`.

### Ce qui reste à faire côté console (obligatoire !)

Le fichier `app/google-services.json` actuel contient :

```json
"oauth_client": [],
```

… et **aucune empreinte de certificat**. C'est bloquant : sans empreinte SHA,
la vérification d'application (Play Integrity **et** le repli reCAPTCHA)
échoue, et Firebase renvoie `auth/missing-client-identifier` /
`auth/app-not-authorized` / « This app is not authorized to use Firebase
Authentication ».

1. Récupérer les empreintes de la clé de signature :
   ```bash
   cd app/android && ./gradlew signingReport
   ```
   (et, pour la prod, l'empreinte **SHA‑256 de la clé de signature d'app Google Play**,
   dans Play Console > Configuration > Intégrité de l'application).
2. Console Firebase > ⚙️ **Paramètres du projet** > **Général** > carte *Vos applications*
   > application Android `com.example.elywalk` > **Ajouter une empreinte** :
   ajouter **SHA‑1 (repli reCAPTCHA)** *et* **SHA‑256 (Play Integrity)**,
   pour la clé de debug **et** la clé de release/Play.
3. **Télécharger le nouveau `google-services.json`** et remplacer
   `app/google-services.json` (puis `npx cap sync android`).
4. Console Firebase > **Authentication** > *Sign-in method* : activer
   **Téléphone**.
5. Google Cloud Console > **API et services** > *Identifiants* > la clé API
   Android : soit sans restriction, soit autoriser
   `elywalk-2f7ba.firebaseapp.com` (nécessaire au flux reCAPTCHA de repli).
6. Authentication > *Settings* > **Domaines autorisés** : vérifier la présence de
   `elywalk-2f7ba.firebaseapp.com` (+ le domaine de la version web).
7. Pour tester sans consommer de SMS : Authentication > *Settings* >
   **Numéros de téléphone à des fins de test** (ex. `+33 6 12 34 56 78` / `123456`).

> ⚠️ L'`applicationId` est encore `com.example.elywalk`. Il doit être identique
> dans `capacitor.config.ts`, `android/app/build.gradle`, `google-services.json`
> et sur Play Console. À changer avant publication (un changement d'ID impose de
> réenregistrer l'app dans Firebase).

---

## 2. Pourquoi App Check coupait l'accès aux données

App Check en **mode appliqué** exige que *chaque* requête Firestore porte un
jeton App Check valide. Or :

- les lectures/écritures Firestore de l'app sont faites par le **SDK JS** dans la
  WebView ;
- aucun provider App Check n'était initialisé côté JS ;
- le provider natif Play Integrity **n'alimente pas automatiquement** le SDK JS.

→ toutes les requêtes partaient **sans jeton** et Firestore répondait
`permission-denied` : les utilisateurs perdaient l'accès aux données. Ce n'était
donc pas un problème de règles de sécurité.

### Correctif implémenté

Ajout du plugin `@capacitor-firebase/app-check` et du module
[`app/src/lib/app-check.ts`](../src/lib/app-check.ts) :

1. initialisation **native** (`FirebaseAppCheck.initialize()`, Play Integrity) ;
2. `CustomProvider` côté JS qui récupère le jeton natif via
   `FirebaseAppCheck.getToken()` ;
3. `initializeAppCheck(app, { provider })` côté JS ;
4. sur le web : `ReCaptchaV3Provider(VITE_APP_CHECK_RECAPTCHA_SITE_KEY)` ;
5. l'initialisation est **attendue avant le rendu de l'app**
   (`app/src/main.tsx`), donc avant la première requête Firestore ;
6. si l'initialisation échoue, l'erreur est loguée et l'app démarre quand même
   (pas d'écran blanc).

`src/lib/firebase.ts` a aussi été ajusté : dans la WebView on utilise l'**App ID
Android** (celui attesté par Play Integrity) ; pour une exécution navigateur,
renseignez `VITE_FIREBASE_WEB_APP_ID` (voir `app/.env.example`).

### Procédure de mise en service (ordre important)

1. `npm install && npx cap sync android` (le plugin App Check ajoute
   `firebase-appcheck-playintegrity` au projet Android).
2. Google Cloud Console : activer l'**API Play Integrity** pour le projet et
   lier le projet Firebase à l'application Google Play.
3. Console Firebase > **App Check** > onglet *Applications* : enregistrer
   l'application Android avec le fournisseur **Play Integrity**.
4. Déployer une build contenant ce correctif et **laisser App Check en mode
   non appliqué** (« Surveiller ») pendant quelques jours.
5. Onglet *API* > Cloud Firestore : vérifier dans les **métriques** que le taux
   de requêtes *vérifiées* est proche de 100 % (les anciennes versions de l'app
   installées chez les utilisateurs apparaîtront en « non vérifiées » — attendez
   qu'elles soient mises à jour).
6. **Seulement ensuite**, activer l'application forcée (*Appliquer*) pour
   Cloud Firestore (puis Storage / Authentication si besoin).

> Activer l'application forcée avant que la majorité du parc soit mise à jour
> re-cassera l'accès aux données : c'est exactement le symptôme observé.

### Développement / émulateur

- **Android debug** : le plugin utilise automatiquement le *debug provider*.
  Au premier lancement, `logcat` affiche un jeton de débogage
  (`Enter this debug secret into the allow list…`) → à ajouter dans
  Firebase Console > App Check > application Android > menu ⋮ >
  **Gérer les jetons de débogage**.
- **Navigateur** : mettre `VITE_APP_CHECK_DEBUG_TOKEN=true` dans `.env.local`,
  récupérer le jeton dans la console du navigateur et l'enregistrer de la même
  façon.

---

## 3. Récapitulatif des fichiers modifiés

| Fichier | Changement |
|---|---|
| `app/src/lib/auth-service.ts` | Flux téléphone natif/web corrigé (voir §1) |
| `app/src/lib/app-check.ts` | **Nouveau** — App Check natif + SDK JS |
| `app/src/lib/firebase.ts` | Config via variables d'env, App ID par plateforme |
| `app/src/main.tsx` | App Check initialisé avant le rendu |
| `app/capacitor.config.ts` | `skipNativeAuth: true` (le SDK JS porte la session) |
| `app/package.json` | + `@capacitor-firebase/app-check` |
| `app/.env.example` | **Nouveau** — variables front |
