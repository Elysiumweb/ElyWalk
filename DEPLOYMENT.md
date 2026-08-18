# Déploiement ElyWalk 1.1

## Firebase (aucune Cloud Function)

```bash
firebase login
firebase use elywalk-2f7ba
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

Les règles doivent être déployées **avant** la version 1.1 de l’application. Le fichier `firebase.json` active aussi la réécriture SPA nécessaire aux liens `/legal/*` et `/?ref=CODE`.

## Android

```bash
cd app
npm ci
npm test
npm run build
npx cap sync android
npx cap open android
```

La version Android est `2 / 1.1.0`. Les plugins de notifications locales et FCM sont enregistrés. Ajouter les fichiers `assetlinks.json` sur les deux domaines Firebase Hosting pour que les liens HTTPS soient vérifiés par Android. Le schéma de secours est `elywalk://referral?code=ABC123`.

## Notifications

- Le rappel de validation à 20 h est local et ne nécessite aucun serveur.
- Les jetons FCM sont enregistrés dans `users/{uid}/notificationTokens/{token}`.
- Sans backend de confiance, les notifications FCM peuvent être envoyées manuellement depuis Firebase Console. Les déclenchements automatiques « demande d’ami » et « retrait payé » nécessitent un serveur, une extension Firebase ou une Cloud Function.

## Limite de sécurité sans backend

Les règles empêchent la modification arbitraire du solde, imposent une validation quotidienne bornée à 60 000 pas, une récompense publicitaire au maximum par heure, des débits atomiques et le remboursement atomique d’un rejet. Elles ne peuvent toutefois pas attester qu’un événement capteur ou qu’une publicité a réellement eu lieu : le client reste contrôlé par l’utilisateur. Une attestation forte exige un composant de confiance (serveur ou Cloud Functions), idéalement avec Play Integrity et la vérification serveur AdMob SSV.

## Avant publication

- Remplacer/valider dans `LegalPage.tsx` les coordonnées légales, le responsable de traitement et l’adresse de contact de l’association.
- Configurer l’adresse e-mail d’assistance Play Store et la fiche de sécurité des données.
- Vérifier les modèles d’e-mails Firebase Authentication et les domaines autorisés.
- Créer les offres dans la collection `partnerOffers` (`title`, `description`, `partnerName`, `coins`, `active`, `createdAt`).
