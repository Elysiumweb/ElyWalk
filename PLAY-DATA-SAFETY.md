# Play Console — Sécurité des données : « Applis installées »

Version refusée : **2.1.3 (20103)** — motif : *« Formulaire incorrect relatif à la sécurité des données »*, preuve *« Sécurité des données (Applis installées : non déclaré) »*.

## 1. Pourquoi la fonctionnalité reste en place

Le code d'ElyWalk ne lit pas la liste des applications installées : aucune
permission `QUERY_ALL_PACKAGES`, aucun bloc `<queries>`, aucun appel à
`getInstalledPackages`, `getInstalledApplications` ou `queryIntentActivities`
dans `android/app` ni dans les plugins Capacitor.

La lecture est faite par le **SDK publicitaire Unity LevelPlay** (ironSource),
qui appelle `PackageManager.getInstalledApplications(0)` — Unity l'a documenté
et a publié un correctif en 9.4.3 ; le SDK embarqué est la 9.7.0, et
`getPackagesForUid` subsiste. Meta Audience Network, réseau appelé en in-app
bidding, est également destinataire.

« Supprimer la fonctionnalité » signifierait donc retirer la régie publicitaire,
donc les ElyCoins. **On déclare.**

## 2. À saisir dans Play Console

App → **Sécurité des données** → *Activité dans les applis* → **Applis installées**

| Champ | Réponse à sélectionner |
| --- | --- |
| Cette app collecte-t-elle des données sur les applis installées ? | **Oui** |
| Ces données sont-elles partagées avec des tiers ? | **Oui** |
| S'agit-il d'un traitement éphémère ? | **Non** |
| La collecte est-elle obligatoire ou facultative ? | **Obligatoire** |
| Finalités | **Publicité ou marketing** et **Prévention des fraudes, sécurité et conformité** |
| Les données sont-elles chiffrées en transit ? | **Oui** |
| L'utilisateur peut-il demander la suppression de ces données ? | **Non** |

Puis **Enregistrer** → onglet *Vue d'ensemble* → **Publier la version** (le
formulaire est global au package `com.elysium.elywalk` et couvre toutes les
versions publiées, y compris la 20103 refusée).

## 2 bis. Parcours écran par écran (ordre réel du formulaire FR)

1. « Ces données sont-elles collectées, partagées ou les deux ? » →
   cocher **Collectées** *et* **Partagées**.
2. « Ces données sont-elles traitées de manière éphémère ? » → **Non**.
3. « Ces données sont-elles requises pour votre appli ? » → **La collecte de
   données est requise** (elle a lieu même en annonces non personnalisées).
4. « Pourquoi ces données utilisateur sont-elles collectées ? » →
   **Publicité ou marketing** + **Prévention des fraudes, sécurité et
   conformité**.
5. « Pourquoi ces données utilisateur sont-elles partagées ? » → **les deux
   mêmes finalités** (le formulaire exige la cohérence entre collecte et
   partage).
6. Chiffrement en transit → **Oui**. Suppression à la demande → **Non**.

À ne pas cocher : *Analyse* (concerne l'analyse de l'app, pas la sélection
publicitaire), *Fonctionnement de l'appli* (aucune fonctionnalité n'en dépend),
*Personnalisation* (réservée au contenu recommandé dans l'app).

## 3. Réponse à l'écran de refus (si un champ « Répondre » est proposé)

> Bonjour,
>
> La collecte signalée provient du SDK de médiation publicitaire Unity LevelPlay
> (ironSource) intégré à l'application, et non du code applicatif : ElyWalk ne
> déclare aucune permission d'accès global aux applications (ni
> `QUERY_ALL_PACKAGES`, ni bloc `<queries>`) et n'appelle aucune API
> d'énumération de paquets. Le SDK consulte `PackageManager` pour la sélection
> publicitaire et l'anti-fraude.
>
> Le formulaire Sécurité des données a été mis à jour : « Activité dans les
> applis → Applis installées » est désormais déclaré comme collecté et partagé,
> à des fins publicitaires et de prévention de la fraude, de manière obligatoire,
> chiffrée en transit, sans possibilité de suppression à la demande.
>
> Ce traitement est décrit dans la politique de confidentialité
> (https://elywalk-2f7ba.web.app/privacy.html#applis-installees, § 4.1) et
> mentionné dans l'écran de consentement publicitaire de l'application, y
> compris lorsque l'utilisateur choisit des annonces non personnalisées.
>
> Une nouvelle version (2.1.4, versionCode 20104) accompagne cette mise à jour.

## 4. Notes de version FR (2.1.4 — 20104)

```
• Transparence publicitaire : la liste des applications installées, consultée par la régie LevelPlay, est expliquée dans l'app et dans la politique de confidentialité (§ 4.1)
• Itinéraires : marche, vélo et voiture calculés par Valhalla (OpenStreetMap), qui respecte vraiment le mode choisi
• Confidentialité publicitaire renforcée : refus de la vente/partage transmis au SDK
```

*(≈ 375 caractères — à ajuster si Play Console tronque.)*

## 5. Notes de version EN (2.1.4 — 20104)

```
• Ad transparency: the list of installed apps read by the LevelPlay ad SDK is explained in-app and in the privacy policy (§ 4.1)
• Directions: walking, cycling and driving now use Valhalla (OpenStreetMap), which honours the selected mode
• Stronger ad privacy: opt-out of sale/sharing passed to the SDK
```

## 6. Contrôles avant envoi

```bash
cd app && npm install --no-audit --no-fund
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
npm run build
```

Puis, sur l'AAB produit :

```bash
bundletool dump manifest --bundle ElyWalk-2.1.4.aab | grep -E "QUERY_ALL_PACKAGES|<queries"
```

La commande doit ne rien renvoyer. Si Play revient à la charge, joindre cette
sortie vide comme preuve que la collecte est bien d'origine SDK.
