/**
 * Séries de jours consécutifs.
 *
 * F07 — l'écran Profil affichait `profile.streak` (la série **en cours**) sous
 * le libellé « meilleure série ». Les deux notions sont désormais calculées
 * séparément, à partir des mêmes documents quotidiens : aucun changement
 * d'économie, aucune écriture serveur.
 *
 * Module pur (aucun accès réseau) pour être testable sans émulateur.
 */

/** Clé `YYYY-MM-DD` d'une date en heure locale. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Décale une clé `YYYY-MM-DD` d'un nombre de jours (négatif = passé). */
export function shiftDay(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return dayKey(parsed);
}

/**
 * Plus longue suite de jours consécutifs présents dans `dates`.
 * Les doublons et l'ordre d'entrée n'ont aucun effet.
 */
export function bestStreakFromDates(dates: Iterable<string>): number {
  const unique = new Set([...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
  let best = 0;
  for (const date of unique) {
    // On ne démarre une série qu'au premier jour : le jour précédent est absent.
    if (unique.has(shiftDay(date, -1))) continue;
    let length = 1;
    let cursor = date;
    while (unique.has(shiftDay(cursor, 1))) {
      cursor = shiftDay(cursor, 1);
      length += 1;
    }
    if (length > best) best = length;
  }
  return best;
}

/**
 * Série en cours : nombre de jours consécutifs validés jusqu'à aujourd'hui (ou
 * hier, pour ne pas casser la série avant la validation du jour).
 */
export function currentStreakFromDates(dates: Iterable<string>, today = new Date()): number {
  const unique = new Set([...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
  let cursor = dayKey(today);
  if (!unique.has(cursor)) {
    const yesterday = shiftDay(cursor, -1);
    if (!unique.has(yesterday)) return 0;
    cursor = yesterday;
  }
  let length = 0;
  while (unique.has(cursor)) {
    length += 1;
    cursor = shiftDay(cursor, -1);
  }
  return length;
}
