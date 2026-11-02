#!/usr/bin/env bash
# Verifie qu'un fichier app-ads.txt est exploitable par le robot d'AdMob.
#
# Usage :
#   ./scripts/check-app-ads.sh                       # domaines par defaut
#   ./scripts/check-app-ads.sh https://exemple.fr    # un domaine precis
#
# IMPORTANT : le robot d'AdMob explore UNIQUEMENT
#   https://<site web declare sur la fiche Google Play>/app-ads.txt
# Pour ElyWalk, la fiche Play declare https://elysium-esport.fr
# (Parametres du Store > Coordonnees > Site Web). C'est donc CE domaine qui
# doit heberger le fichier ; le domaine Firebase n'est jamais explore tant que
# la fiche n'est pas modifiee.

set -u

PUB_ID="pub-5316598937383510"
EXPECTED="google.com, ${PUB_ID}, DIRECT, f08c47fec0942fa0"

# 1er = domaine declare sur Play (le seul qui compte), 2e = variante www,
# 3e = miroir Firebase (utile seulement si la fiche Play est modifiee).
DEFAULT_HOSTS=(
  "https://elysium-esport.fr"
  "https://www.elysium-esport.fr"
  "https://elywalk-2f7ba.web.app"
)

HOSTS=("$@")
if [ ${#HOSTS[@]} -eq 0 ]; then
  HOSTS=("${DEFAULT_HOSTS[@]}")
fi

green() { printf '\033[32m  OK  \033[0m %s\n' "$1"; }
red()   { printf '\033[31m ECHEC\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m ATTN \033[0m %s\n' "$1"; }
info()  { printf '       %s\n' "$1"; }

overall=0

for base in "${HOSTS[@]}"; do
  url="${base%/}/app-ads.txt"
  printf '\n=== %s ===\n' "$url"

  # --- Qui heberge ce domaine ? (utile pour savoir ou deposer le fichier) ---
  roothdr=$(curl -sS -L -m 20 -I -o /dev/null -D - "${base%/}/" 2>/dev/null | tr -d '\r')
  server=$(printf '%s' "$roothdr" | awk -F': ' 'tolower($1)=="server"{s=$2} END{print s}')
  powered=$(printf '%s' "$roothdr" | awk -F': ' 'tolower($1)=="x-powered-by"{s=$2} END{print s}')
  [ -n "${server:-}" ] && info "heberge par : ${server}${powered:+ / $powered}"

  headers=$(curl -sS -L -m 20 -D - -o /tmp/app-ads-body.$$ \
            -A 'Mozilla/5.0 (compatible; Google-adstxt)' "$url" 2>/tmp/app-ads-err.$$)
  if [ $? -ne 0 ]; then
    red "requete impossible : $(cat /tmp/app-ads-err.$$ 2>/dev/null)"
    overall=1
    rm -f /tmp/app-ads-body.$$ /tmp/app-ads-err.$$
    continue
  fi

  body=$(cat /tmp/app-ads-body.$$)
  code=$(printf '%s' "$headers" | awk '/^HTTP\//{c=$2} END{print c}')
  ctype=$(printf '%s' "$headers" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{c=$2} END{print tolower(c)}')
  final=$(curl -sS -L -m 20 -o /dev/null -w '%{url_effective}' "$url")
  redirects=$(curl -sS -L -m 20 -o /dev/null -w '%{num_redirects}' "$url")

  # 1. Statut HTTP
  if [ "$code" = "200" ]; then green "HTTP 200"; else red "HTTP ${code:-aucun} (doit etre 200)"; overall=1; fi

  # 1 bis. Diagnostics specifiques Vercel
  if printf '%s' "$headers" | tr -d '\r' | grep -qi '^x-vercel-id:'; then
    info "servi par Vercel"
    vercel_err=$(printf '%s' "$headers" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-vercel-error"{e=$2} END{print e}')
    [ -n "${vercel_err:-}" ] && red "x-vercel-error: ${vercel_err}"
    case "$code" in
      401|403)
        red "Vercel renvoie ${code} : Deployment Protection (Vercel Authentication"
        red "ou mot de passe) bloque le robot. Settings > Deployment Protection"
        red "> desactiver pour la Production."
        overall=1
        ;;
    esac
    case "$body" in
      *"Authentication Required"*|*"vercel.com/sso"*)
        red "page d'authentification Vercel renvoyee a la place du fichier"
        overall=1
        ;;
    esac
  fi

  # 2. Redirections : AdMob ne les suit pas de facon fiable
  if [ "${redirects:-0}" -gt 0 ]; then
    warn "${redirects} redirection(s) -> ${final}"
    warn "AdMob ne suit pas toujours les redirections : servir le fichier en 200 direct"
    case "$final" in
      */app-ads.txt) : ;;
      *) red "la redirection ne pointe plus vers /app-ads.txt"; overall=1 ;;
    esac
  else
    green "aucune redirection"
  fi

  # 3. Type MIME : du texte, surtout pas du HTML
  case "$ctype" in
    text/plain*) green "Content-Type: $ctype" ;;
    text/html*)  red "Content-Type: $ctype (le serveur renvoie une page HTML)"; overall=1 ;;
    *)           warn "Content-Type: ${ctype:-absent} (text/plain recommande)" ;;
  esac

  # 4. Piege classique : la 404 ou le fallback SPA renvoie du HTML en 200
  case "$body" in
    *"<html"*|*"<!DOCTYPE"*|*"<!doctype"*)
      red "le corps de la reponse est du HTML, pas un app-ads.txt"; overall=1 ;;
    *) green "corps en texte brut" ;;
  esac

  # 5. BOM UTF-8 : casse le parsing de la premiere ligne
  if head -c 3 /tmp/app-ads-body.$$ 2>/dev/null | grep -q $'\xef\xbb\xbf'; then
    red "BOM UTF-8 en tete de fichier (le robot ne lira pas la 1re ligne)"
    overall=1
  fi

  # 6. L'enregistrement attendu (espaces et casse tolerants)
  if printf '%s' "$body" | tr -d '\r' | grep -Eiq "^[[:space:]]*google\.com[[:space:]]*,[[:space:]]*${PUB_ID}[[:space:]]*,[[:space:]]*DIRECT[[:space:]]*,[[:space:]]*f08c47fec0942fa0"; then
    green "enregistrement trouve : ${EXPECTED}"
  else
    red "enregistrement AdMob introuvable (attendu : ${EXPECTED})"
    overall=1
  fi

  # 7. Autres identifiants editeur : normal en mediation, suspect sinon
  other=$(printf '%s' "$body" | grep -Eio 'pub-[0-9]{10,20}' | sort -u | grep -v "$PUB_ID")
  [ -n "$other" ] && warn "autres identifiants editeur : $(printf '%s' "$other" | tr '\n' ' ')"

  # 8. robots.txt du domaine : peut bloquer le robot app-ads.txt
  robots=$(curl -sS -L -m 15 "${base%/}/robots.txt" 2>/dev/null)
  if printf '%s' "$robots" | grep -Eiq '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$'; then
    warn "robots.txt contient un 'Disallow: /' : verifier qu'il n'englobe pas Google-adstxt"
  fi

  info "$(printf '%s' "$body" | grep -c '') ligne(s), ${#body} octet(s)"
  rm -f /tmp/app-ads-body.$$ /tmp/app-ads-err.$$
done

printf '\n'
if [ "$overall" -eq 0 ]; then
  printf 'Resultat : fichier exploitable sur tous les domaines testes.\n'
else
  printf 'Resultat : au moins un probleme. Seul le domaine declare sur la fiche\n'
  printf 'Play (https://elysium-esport.fr) doit imperativement passer au vert.\n'
fi
exit "$overall"
