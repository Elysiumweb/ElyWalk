#!/usr/bin/env bash
# Vérifie qu'un fichier app-ads.txt est exploitable par le robot d'AdMob.
#
# Usage :
#   ./scripts/check-app-ads.sh                       # vérifie le domaine par défaut
#   ./scripts/check-app-ads.sh https://exemple.fr    # vérifie un domaine précis
#   ./scripts/check-app-ads.sh https://a.fr https://www.a.fr
#
# Le robot d'AdMob explore UNIQUEMENT https://<site web declare sur Google
# Play>/app-ads.txt. Tester un autre domaine ne prouve rien.

set -u

PUB_ID="pub-5316598937383510"
EXPECTED="google.com, ${PUB_ID}, DIRECT, f08c47fec0942fa0"

DEFAULT_HOSTS=("https://elywalk-2f7ba.web.app")
HOSTS=("$@")
if [ ${#HOSTS[@]} -eq 0 ]; then
  HOSTS=("${DEFAULT_HOSTS[@]}")
fi

green() { printf '\033[32m  OK  \033[0m %s\n' "$1"; }
red()   { printf '\033[31m ECHEC\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m ATTN \033[0m %s\n' "$1"; }

overall=0

for base in "${HOSTS[@]}"; do
  url="${base%/}/app-ads.txt"
  printf '\n=== %s ===\n' "$url"

  headers=$(curl -sS -L -m 20 -D - -o /tmp/app-ads-body.$$ \
            -A 'Mozilla/5.0 (compatible; AdsTxtCrawler/1.0)' "$url" 2>/tmp/app-ads-err.$$)
  if [ $? -ne 0 ]; then
    red "requete impossible : $(cat /tmp/app-ads-err.$$)"
    overall=1
    continue
  fi

  body=$(cat /tmp/app-ads-body.$$)
  code=$(printf '%s' "$headers" | awk '/^HTTP\//{c=$2} END{print c}')
  ctype=$(printf '%s' "$headers" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{c=$2} END{print tolower(c)}')
  final=$(curl -sS -L -m 20 -o /dev/null -w '%{url_effective}' "$url")
  redirects=$(curl -sS -L -m 20 -o /dev/null -w '%{num_redirects}' "$url")

  # 1. Statut HTTP
  if [ "$code" = "200" ]; then green "HTTP 200"; else red "HTTP ${code:-aucun} (doit etre 200)"; overall=1; fi

  # 2. Redirections : tolerees, mais doivent finir sur le bon fichier
  if [ "${redirects:-0}" -gt 0 ]; then
    warn "${redirects} redirection(s) -> ${final}"
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

  # 5. L'enregistrement attendu (espaces et casse tolerants)
  if printf '%s' "$body" | tr -d '\r' | grep -Eiq "^[[:space:]]*google\.com[[:space:]]*,[[:space:]]*${PUB_ID}[[:space:]]*,[[:space:]]*DIRECT[[:space:]]*,[[:space:]]*f08c47fec0942fa0"; then
    green "enregistrement trouve : ${EXPECTED}"
  else
    red "enregistrement AdMob introuvable (attendu : ${EXPECTED})"
    overall=1
  fi

  # 6. Un autre pub-xxxx DIRECT de Google signale souvent un copier-coller errone
  other=$(printf '%s' "$body" | grep -Eio 'pub-[0-9]{10,20}' | sort -u | grep -v "$PUB_ID")
  if [ -n "$other" ]; then
    warn "autres identifiants editeur presents (normal si regies multiples) : $(printf '%s' "$other" | tr '\n' ' ')"
  fi

  # 7. Taille et nombre de lignes, pour reperer un fichier tronque
  printf '      %s ligne(s), %s octet(s)\n' "$(printf '%s' "$body" | grep -c '')" "${#body}"

  rm -f /tmp/app-ads-body.$$ /tmp/app-ads-err.$$
done

printf '\n'
if [ "$overall" -eq 0 ]; then
  printf 'Resultat : fichier exploitable. Lancez "Verifier les modifications" dans AdMob.\n'
  printf 'Rappel : le domaine teste doit etre EXACTEMENT celui du champ "Site Web"\n'
  printf 'de la fiche Google Play, et la fiche doit etre publique.\n'
else
  printf 'Resultat : au moins un probleme bloquant. Corrigez-le avant de relancer AdMob.\n'
fi
exit "$overall"
