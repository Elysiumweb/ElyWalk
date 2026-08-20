#!/usr/bin/env bash
#
# ElyWalk — Génération des icônes launcher + splash Android
# ============================================================
# Recolorie le logo marcheur en « or héritage » (#D8CA82) sur fond
# midnight black (#111111), puis produit :
#   - les icônes launcher legacy (carré + rond) pour chaque densité ;
#   - le foreground des icônes adaptatives (108 dp) ;
#   - les splash screen (drawable + variantes portrait/paysage).
#
# Dépendance : ImageMagick (`convert`).
# Usage : bash scripts/generate-assets.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="public/elywalk-logo.png"
GOLD="#D8CA82"
BLACK="#111111"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MASTER="$TMP/logo-gold.png"

# 1) Master « or sur noir » : on utilise la luminance du logo comme alpha.
convert "$SRC" -colorspace gray "$TMP/mask.png"
convert -size 512x512 "xc:${BLACK}" \
  \( -size 512x512 "xc:${GOLD}" "$TMP/mask.png" -alpha off \
     -compose CopyOpacity -composite \) \
  -compose over -composite "$MASTER"

# Sauvegarde d'une copie réutilisable (icône de marque).
mkdir -p public
cp "$MASTER" public/elywalk-icon-gold.png

resdir="android/app/src/main/res"

# ---------------------------------------------------------------------------
# 2) Icônes legacy (square + round) — tailles standard Android
# ---------------------------------------------------------------------------
declare -A MIPMAP=(
  [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192
)
for d in "${!MIPMAP[@]}"; do
  s="${MIPMAP[$d]}"
  dir="$resdir/mipmap-$d"
  # Carré : logo recadré à ~92 % centré sur fond noir
  inner=$(( s * 92 / 100 ))
  convert "$MASTER" -resize "${inner}x${inner}" -gravity center \
    -background "$BLACK" -extent "${s}x${s}" "$dir/ic_launcher.png"
  # Rond : même logo avec masque circulaire
  convert "$MASTER" -resize "${inner}x${inner}" -gravity center \
    -background "$BLACK" -extent "${s}x${s}" \
    \( -size "${s}x${s}" xc:none -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) \
    -compose DstIn -composite "$dir/ic_launcher_round.png"
  echo "mipmap-$d : ic_launcher.png + ic_launcher_round.png (${s}px)"
done

# ---------------------------------------------------------------------------
# 3) Foreground adaptatif (108 dp) — logo dans la zone sûre (≈66 %)
# ---------------------------------------------------------------------------
declare -A FG=(
  [mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432
)
for d in "${!FG[@]}"; do
  s="${FG[$d]}"
  inner=$(( s * 60 / 100 ))
  convert "$MASTER" -resize "${inner}x${inner}" -gravity center \
    -background none -extent "${s}x${s}" \
    "$resdir/mipmap-$d/ic_launcher_foreground.png"
  echo "mipmap-$d : ic_launcher_foreground.png (${s}px)"
done

# Fond de l'icône adaptative -> noir
cat > "$resdir/values/ic_launcher_background.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#111111</color>
</resources>
EOF

# ---------------------------------------------------------------------------
# 4) Splash screen — fond noir + logo or centré
# ---------------------------------------------------------------------------
make_splash() {
  local out="$1" w="$2" h="$3"
  local side=$(( (w < h ? w : h) * 28 / 100 ))
  convert "$MASTER" -resize "${side}x${side}" -gravity center \
    -background "$BLACK" -extent "${w}x${h}" "$out"
  echo "splash : $(basename "$out") (${w}x${h})"
}

make_splash "$resdir/drawable/splash.png" 480 320

# Portrait
make_splash "$resdir/drawable-port-mdpi/splash.png" 320 480
make_splash "$resdir/drawable-port-hdpi/splash.png" 480 720
make_splash "$resdir/drawable-port-xhdpi/splash.png" 720 960
make_splash "$resdir/drawable-port-xxhdpi/splash.png" 960 1440
make_splash "$resdir/drawable-port-xxxhdpi/splash.png" 1280 1920

# Paysage
make_splash "$resdir/drawable-land-mdpi/splash.png" 480 320
make_splash "$resdir/drawable-land-hdpi/splash.png" 720 480
make_splash "$resdir/drawable-land-xhdpi/splash.png" 960 720
make_splash "$resdir/drawable-land-xxhdpi/splash.png" 1440 960
make_splash "$resdir/drawable-land-xxxhdpi/splash.png" 1920 1280

echo "✅ Icônes et splash générés depuis $SRC"
