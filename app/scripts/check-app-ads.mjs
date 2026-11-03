#!/usr/bin/env node
/**
 * Vérifie le fichier app-ads.txt d'ElyWalk (spécification IAB Tech Lab v1.1).
 *
 *   node scripts/check-app-ads.mjs                 # vérifie le fichier local
 *   node scripts/check-app-ads.mjs --url https://elywalk-2f7ba.web.app/app-ads.txt
 *                                                  # vérifie aussi la copie publiée
 *   node scripts/check-app-ads.mjs --strict         # les notes deviennent bloquantes
 *
 * Contrôles :
 *   1. fichier présent, UTF-8 sans BOM, fins de ligne LF, pas d'espace parasite ;
 *   2. une ligne de données = domaine, ID éditeur, relation, ID de certification,
 *      séparés par exactement « , » ;
 *   3. cohérence entre l'ID éditeur déclaré et l'ID AdMob utilisé dans l'app
 *      (constants.ts + AndroidManifest.xml) : un écart fait échouer la validation
 *      AdMob qui renvoie « vos informations ne correspondent pas à celles de
 *      votre compte AdMob » ;
 *   4. si --url est fourni : code HTTP 200, content-type text/plain, contenu
 *      identique au fichier local (donc le déploiement a bien eu lieu).
 *
 * Codes de sortie : 0 = tout est bon, 1 = au moins une erreur.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const ADS_FILE = join(APP_DIR, 'public', 'app-ads.txt');
const CONSTANTS_FILE = join(APP_DIR, 'src', 'lib', 'constants.ts');
const MANIFEST_FILE = join(APP_DIR, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

const GOOGLE_CERT_AUTHORITY = 'f08c47fec0942fa0';
const VALID_RELATIONSHIPS = new Set(['DIRECT', 'RESELLER']);

const errors = [];
const warnings = [];
const ok = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const pass = (msg) => ok.push(msg);

// ---------------------------------------------------------------------------
// 1. Lecture brute et contrôles d'encodage
// ---------------------------------------------------------------------------
if (!existsSync(ADS_FILE)) {
  fail(`Fichier introuvable : ${ADS_FILE}`);
} else {
  const bytes = readFileSync(ADS_FILE);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail('Le fichier commence par un BOM UTF-8 : le premier domaine est illisible pour les crawlers.');
  }
  if (bytes.includes(0x0d)) {
    fail('Le fichier contient des retours chariot CRLF : utiliser des fins de ligne LF (\\n).');
  }
  if (bytes.length === 0) {
    fail('Le fichier est vide.');
  }
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
    warn('Le fichier ne se termine pas par un saut de ligne (toléré, mais recommandé).');
  }
  if (bytes.some((b) => b > 0x7e || (b < 0x20 && b !== 0x0a))) {
    fail('Le fichier contient des caractères non ASCII ou de contrôle.');
  }

  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const dataLines = [];
  let lineNo = 0;

  for (const rawLine of lines) {
    lineNo += 1;
    const line = rawLine.trimEnd();

    if (line.trim() === '') {
      warn(`Ligne ${lineNo} : ligne vide (ignorée par les crawlers).`);
      continue;
    }
    if (/^[ \t]+/.test(rawLine)) {
      fail(`Ligne ${lineNo} : espace ou tabulation en début de ligne.`);
    }
    if (/[ \t]+$/.test(rawLine)) {
      fail(`Ligne ${lineNo} : espace ou tabulation en fin de ligne.`);
    }
    if (line.startsWith('#')) continue; // commentaire autorisé par la spec
    dataLines.push({ lineNo, line });
  }

  if (dataLines.length === 0) {
    fail('Aucune ligne de données : le fichier ne déclare aucun vendeur autorisé.');
  }

  // -------------------------------------------------------------------------
  // 2. Format de chaque ligne de données
  // -------------------------------------------------------------------------
  const fields = dataLines.map(({ lineNo: n, line }) => {
    const parts = line.split(',');
    if (parts.length !== 4) {
      fail(`Ligne ${n} : ${parts.length} champs au lieu de 4 (attendu « domaine, ID éditeur, relation, ID de certification »).`);
      return { n, domain: parts[0]?.trim(), publisher: parts[1]?.trim() };
    }
    const [domain, publisher, relationship, certAuthority] = parts.map((p) => p.trim());

    // La spec tolère les espaces autour des virgules, mais un séparateur
    // homogène « , » évite les surprises avec les parseurs stricts.
    if (!/^[^,\s]+(, [^,\s]+)*$/.test(line)) {
      fail(`Ligne ${n} : séparateurs irréguliers (format attendu « domaine, pub-…, DIRECT, f08c… », un espace après chaque virgule).`);
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      fail(`Ligne ${n} : domaine « ${domain} » invalide (minuscules, sans schéma ni chemin).`);
    }
    if (!/^pub-\d{16}$/.test(publisher)) {
      fail(`Ligne ${n} : ID éditeur « ${publisher} » invalide (attendu pub- + 16 chiffres).`);
    }
    if (!VALID_RELATIONSHIPS.has(relationship)) {
      fail(`Ligne ${n} : relation « ${relationship} » invalide (DIRECT ou RESELLER).`);
    }
    if (!/^[0-9a-f]{16}$/.test(certAuthority)) {
      fail(`Ligne ${n} : ID de certification « ${certAuthority} » invalide (16 caractères hexadécimaux).`);
    } else if (domain === 'google.com' && certAuthority !== GOOGLE_CERT_AUTHORITY) {
      fail(`Ligne ${n} : pour google.com, l'ID de certification TAG doit être ${GOOGLE_CERT_AUTHORITY}.`);
    }

    return { n, domain, publisher };
  });

  // -------------------------------------------------------------------------
  // 3. Cohérence avec les identifiants AdMob de l'application
  // -------------------------------------------------------------------------
  const adsPublisherIds = new Set(fields.map((f) => f.publisher).filter(Boolean));

  const collect = (file, regex) => {
    if (!existsSync(file)) return new Set();
    const content = readFileSync(file, 'utf8');
    const ids = new Set();
    for (const match of content.matchAll(regex)) ids.add(`pub-${match[1]}`);
    return ids;
  };

  const appPublisherIds = new Set([
    ...collect(CONSTANTS_FILE, /ca-app-pub-(\d{16})/g),
    ...collect(MANIFEST_FILE, /ca-app-pub-(\d{16})/g),
  ]);

  if (appPublisherIds.size === 0) {
    warn('Aucun ID AdMob trouvé dans constants.ts / AndroidManifest.xml : cohérence non vérifiable.');
  } else {
    for (const id of appPublisherIds) {
      if (!adsPublisherIds.has(id)) {
        warn(
          `Incohérence : l'app utilise l'éditeur ${id} mais app-ads.txt déclare ` +
            `${[...adsPublisherIds].join(', ') || '(rien)'} — AdMob valide le fichier pour ` +
            "l'éditeur du compte, mais les blocs de pub de l'app appartiennent à l'autre compte. " +
            'Aligner les deux (voir DEPLOYMENT.md § app-ads.txt), puis relancer avec --strict.',
        );
      }
    }
    for (const id of adsPublisherIds) {
      if (id && !appPublisherIds.has(id)) {
        warn(`app-ads.txt déclare ${id}, absent du code de l'app (ligne volontaire ? à confirmer).`);
      }
    }
    if ([...appPublisherIds].some((id) => adsPublisherIds.has(id))) {
      pass(`Éditeur AdMob cohérent (${[...appPublisherIds].join(', ')}).`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Vérification de la copie publiée (optionnelle)
  // -------------------------------------------------------------------------
  const urlIndex = process.argv.indexOf('--url');
  const url = urlIndex !== -1 ? process.argv[urlIndex + 1] : process.env.APP_ADS_URL;

  if (url) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      const body = await response.text();

      if (!response.ok) {
        fail(`${url} répond ${response.status} (attendu 200).`);
      } else {
        pass(`${url} répond 200.`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/plain')) {
        fail(`${url} est servi en « ${contentType || 'type inconnu'} » au lieu de text/plain.`);
      } else {
        pass(`Content-Type correct (${contentType}).`);
      }
      if (new URL(response.url).pathname !== '/app-ads.txt') {
        fail(`${url} redirige vers ${response.url} : la racine doit servir le fichier directement.`);
      }
      const normalize = (value) =>
        value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
          .join('\n');
      if (normalize(body) !== normalize(text)) {
        fail(`${url} ne sert pas encore le contenu local : le déploiement Firebase Hosting est à refaire.`);
      } else {
        pass('Contenu publié identique au fichier local.');
      }
    } catch (error) {
      fail(`${url} est injoignable : ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------
const strict = process.argv.includes('--strict');

if (strict) {
  errors.push(...warnings);
  warnings.length = 0;
}

for (const message of ok) console.log(`  OK    ${message}`);
for (const message of warnings) console.log(`  NOTE  ${message}`);
for (const message of errors) console.log(`  ERREUR ${message}`);

if (errors.length > 0) {
  console.error(`\napp-ads.txt : ${errors.length} erreur(s), ${warnings.length} avertissement(s).`);
  process.exit(1);
}

console.log(`\napp-ads.txt : valide (${warnings.length} avertissement(s)).`);
