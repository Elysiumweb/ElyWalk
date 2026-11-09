#!/usr/bin/env bash
#
# ElyWalk — Génération de .well-known/assetlinks.json (App Links Android)
# ======================================================================
# Android vérifie les intent-filters HTTPS via ce fichier hébergé à la racine
# des deux domaines Firebase Hosting (elywalk-2f7ba.web.app et
# elywalk-2f7ba.firebaseapp.com).
#
# Usage :
#   bash scripts/generate-assetlinks.sh <keystore> <alias>
#
#   Exemple :
#   bash scripts/generate-assetlinks.sh ~/elywalk-release.keystore elywalk
#
# L'empreinte SHA-256 du certificat de SIGNATURE doit correspondre à celle de
# l'APK publié. Pour un APK déjà signé, on peut l'extraire ainsi :
#   keytool -printcert -jarfile app-release.apk | grep SHA256
#
# Le fichier généré est placé dans public/.well-known/assetlinks.json puis
# copié dans dist/ par `npm run build` et déployé via `firebase deploy`.
#
set -euo pipefail

KEYSTORE="${1:?Usage: generate-assetlinks.sh <keystore> <alias>}"
ALIAS="${2:?Usage: generate-assetlinks.sh <keystore> <alias>}"
PACKAGE="com.elysium.elywalk"

cd "$(dirname "$0")/.."

FINGERPRINT="$(
  keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "${KEYSTORE_PASSWORD:-}" \
    | awk '/SHA256:/ { print $2; exit }'
)"

if [ -z "$FINGERPRINT" ]; then
  echo "Impossible d'extraire l'empreinte SHA-256. Si le keystore a un mot de passe," >&2
  echo "définissez la variable KEYSTORE_PASSWORD." >&2
  exit 1
fi

mkdir -p public/.well-known
cat > public/.well-known/assetlinks.json <<EOF
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "${PACKAGE}",
      "sha256_cert_fingerprints": [
        "${FINGERPRINT}"
      ]
    }
  }
]
EOF

echo "✅ public/.well-known/assetlinks.json généré (SHA256: ${FINGERPRINT})"
echo "   Déployer avec : firebase deploy --only hosting"
