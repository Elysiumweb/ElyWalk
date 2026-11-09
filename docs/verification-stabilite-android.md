# Vérification de stabilité Android avant nouvelle soumission

Les correctifs de robustesse ne remplacent pas le rapport Play Console : relever dans Android Vitals la version, les appareils, les étapes et les traces des plantages signalés. Comparer les traces avec le fichier `mapping.txt` du build release correspondant si R8 est activé.

## Avant diffusion

1. Compiler la version **release** signée après `npm ci`, `npm run build` et `npx cap sync android`. Utiliser un `versionCode` supérieur à toutes les versions déjà chargées sur Play Console et conserver le fichier de mapping R8.
2. Installer cette même version via un test interne sur plusieurs appareils/émulateurs (notamment Android 12, 13, 14 et 15/16), avec et sans capteur de pas. Vérifier les journaux `adb logcat` et le rapport pré-lancement Play. Répéter avec une connexion interrompue.
3. Parcourir tous les onglets et boutons : connexion/inscription, accueil, validation et publicité, carte/localisation, amis, classement, portefeuille, profil, partage/export, sortie GPS et historique. Vérifier aussi les retours arrière et doubles appuis rapides.
4. Refuser puis accorder les permissions d'activité physique, notifications et localisation ; révoquer activité/localisation dans les paramètres pendant l'utilisation puis revenir dans l'app. Vérifier l'absence de crash et les messages d'erreur.
5. Démarrer, mettre en pause, reprendre et terminer une sortie GPS, changer le mode économie, passer en arrière-plan, revenir et fermer/rouvrir l'application. Vérifier que les données de sortie et de pas restent cohérentes et que les services s'arrêtent proprement.
6. Examiner les traces et taux de plantage de la version de test dans Android Vitals, corriger toute régression et soumettre la nouvelle version pour examen dans Play Console.

Les tests JavaScript (`npm test`) et la compilation web ne valident ni les services Android ni les SDK natifs. Les tester sur appareils reste obligatoire.
