# ElyWalk — Backend de confiance (Cloudflare Workers, gratuit)

Remplace les Cloud Functions Firebase (qui exigent le plan payant **Blaze**) par un
**Cloudflare Worker**, gratuit à l'échelle de l'application (100 000 requêtes/jour
offertes, tâches planifiées incluses).

## Endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/` | État de santé |
| `POST` | `/verify-integrity` | Vérifie un jeton **Play Integrity** (F05) |
| `GET` | `/ssv` | Callback **AdMob Server-Side Verification** (F05) |
| `POST` | `/fcm/send` | Envoi d'un **push FCM** (protégé par `API_SECRET`) |
| `GET` | `/cron/process-notifications` | Consomme `friendRequests` + `withdrawals` → push (F11) |
| `GET` | `/cron/process-payouts` | File de retraits (F06) |

Le Worker utilise l'**Admin SDK Firebase** (qui contourne les règles Firestore) :
c'est le seul composant de confiance qui peut créditer un solde sur une preuve
externe (intégrité Play ou callback SSV signé). Le client ne peut pas forger ces
écritures.

## Déploiement (une seule fois)

```bash
cd worker
npm install
npx wrangler login          # compte Cloudflare gratuit
```

### Secrets

```bash
# 1) Compte de service Firebase (Console → Paramètres → Comptes de service → Générer)
npx wrangler secret put GOOGLE_APPLICATION_CREDENTIALS   # coller le JSON complet

# 2) Secret partagé pour /fcm/send (générer une chaîne aléatoire)
npx wrangler secret put API_SECRET

# 3) Clés publiques AdMob SSV (console AdMob → Récompensées → Vérification côté serveur)
npx wrangler secret put SSV_KEYS    # ex. : [{"keyId":"123","pem":"-----BEGIN PUBLIC KEY-----..."}]
```

```bash
npx wrangler deploy
```

Les tâches planifiées (`[triggers] crons` de `wrangler.toml`) sont actives après
le premier déploiement. Les endpoints `/cron/*` sont aussi appelables manuellement
pour tester.

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
2. Télécharger les **clés publiques** et les coller dans le secret `SSV_KEYS`.
3. Côté app, passer `userId` (= uid) lors de `prepareRewardVideoAd` pour que
   `custom_data` soit renvoyé au callback.

> ⚠️ Les callbacks SSV ne partent que sur les annonces de **production**.
> Valider la vérification de signature avec l'outil de test de la console AdMob
> avant de supprimer le crédit côté client.

## Sécurité

- Le client ne doit **jamais** appeler `/fcm/send` directement (secret `API_SECRET`
  non embarqué dans l'app). Les notifications sont déclenchées par le cron qui lit
  les collections de confiance (`friendRequests`, `withdrawals`).
- `/verify-integrity` est sans secret : le jeton Play Integrity est opaque et vérifié
  côté Google ; un attaquant ne peut pas l'inventer.
- `/ssv` est appelé par Google avec une signature RSA ; sans clé publique valide,
  rien n'est crédité.
