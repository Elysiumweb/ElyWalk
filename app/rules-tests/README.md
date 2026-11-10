# Tests d’accès Firestore

Ces tests utilisent `@firebase/rules-unit-testing` et un véritable émulateur Firestore : ils ne testent donc pas seulement le masquage dans React.

Prérequis : Node.js et un JRE accessible via `java -version`.

```bash
cd app
npm ci
npm run test:rules
```

Couverture : blocage bilatéral des demandes/messages/réactions, déblocage réservé au propriétaire, confidentialité et modération des signalements, confidentialité des parcours.
