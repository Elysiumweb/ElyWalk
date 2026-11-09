# ElyWalk — Backend de confiance (Cloudflare Workers, gratuit)

Remplace les Cloud Functions Firebase (qui exigent le plan payant **Blaze**) par un
**Cloudflare Worker**, gratuit à l'échelle de l'application (100 000 requêtes/jour
offertes, tâches planifiées incluses).

> **Aucune dépendance runtime.** Le Worker appelle directement les **API REST** Google
> (Firestore REST, FCM HTTP v1, Play Integrity, AdMob SSV) avec des jetons OAuth2
> signés en RS256 via Web Crypto (natif dans Workers). `firebase-admin` (SDK Node) est
> volontairement exclu : il s'appuie sur gRPC et des APIs Node incompatibles avec
> l'isolat Workers (il ne se résout pas au build et échouerait à l'exécution).

## Endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/` | État de santé |
| `POST` | `/verify-integrity` | Vérifie un jeton **Play Integrity** (F05) |
| `GET` | `/ssv` | Callback **AdMob Server-Side Verification** (F05) |
| `POST` | `/fcm/send` | Envoi d'un **push FCM** (protégé par `API_SECRET`) |
| `GET` | `/cron/process-notifications` | Consomme `friendRequests` + `withdrawals` → push (F11) |
| `GET` | `/cron/process-payouts` | File de retraits (F06) |

Le Worker possède les droits d'un **compte de service Firebase** (contournement des
règles Firestore) : c'est le seul composant de confiance qui peut créditer un solde
sur une preuve externe (intégrité Play ou callback SSV signé). Le client ne peut pas
forger ces écritures.

## Déploiement

```bash
cd worker
npm install                 # installe wrangler + typescript (dev uniquement)
npx wrangler login          # compte Cloudflare gratuit
```

### Secrets

```bash
# 1) Compte de service Firebase (Console → Paramètres → Comptes de service → Générer)
npx wrangler secret put GOOGLE_APPLICATION_CREDENTIALS   # coller le JSON complet

# 2) Secret partagé pour /fcm/send (générer une chaîne aléatoire)
npx wrangler secret put API_SECRET
```

> Plus besoin de configurer les clés SSV : le Worker les récupère automatiquement
> depuis le serveur de clés Google (`https://gstatic.com/admob/reward/verifier-keys.json`),
> avec cache d'une heure (rotation des clés gérée automatiquement).

```bash
npx wrangler deploy
```

Les tâches planifiées (`[triggers] crons` de `wrangler.toml`) sont actives après le
premier déploiement. Les endpoints `/cron/*` sont aussi appelables manuellement
pour tester (ex. `curl https://<votre-worker>.workers.dev/cron/process-notifications`).

## Prérequis côté Google

### Play Integrity (F05)
1. **Play Console** → votre app → *Intégrité de l'application* → lier un projet Google Cloud.
2. Activer l'API **Play Integrity API** dans ce projet.
3. Accorder au compte de service le rôle *Play Integrity API → Utilisateur de l'API*
   (IAM), ou l'autorisation via la Play Console.
4. Récupérer le **numéro de projet Google Cloud** (Console → Paramètres projet).
5. Côté app : `npm install @capacitor-community/play-integrity && npx cap sync`.

Le client (voir `app/src/lib/attestation.ts`) demande un jeton, l'envoie à
`/verify-integrity`, et le Worker confirme (ou non) l'intégrité de l'appareil.

### AdMob SSV (F05)
1. Console AdMob → bloc **Récompensées** → *Vérification côté serveur* : renseigner
   l'URL `https://<votre-worker>.workers.dev/ssv`.
2. Les **clés publiques** sont récupérées automatiquement par le Worker depuis le
   serveur de clés Google (aucun secret à configurer).
3. Côté app, `showRewardedAd(uid)` transmet l'uid via `ssv.userId` → paramètre
   `user_id` du callback. Le Worker crédite le bon compte après vérification.

> ⚠️ Les callbacks SSV ne partent que sur les annonces de **production** (pas en
> mode test). Utiliser l'outil de validation de la console AdMob pour tester
> l'endpoint. Tant que `ATTESTATION_WORKER_URL` est vide côté app, le crédit reste
> client (fallback) ; une fois l'URL renseignée, le crédit passe côté serveur.

## Sécurité

- Le client ne doit **jamais** appeler `/fcm/send` directement (secret `API_SECRET`
  non embarqué dans l'app). Les notifications sont déclenchées par le cron qui lit
  les collections de confiance (`friendRequests`, `withdrawals`).
- `/verify-integrity` est sans secret : le jeton Play Integrity est opaque et vérifié
  côté Google ; un attaquant ne peut pas l'inventer.
- `/ssv` est appelé par Google avec une signature **ECDSA P-256** ; le Worker la
  vérifie avec les clés publiques officielles avant de créditer. Sans signature
  valide, rien n'est crédité.
