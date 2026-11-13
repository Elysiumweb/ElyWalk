import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  decideUpdate,
  isOutdated,
  normalizeRelease,
  parseSnooze,
  parseVersion,
  playStoreMarketUrl,
  playStoreUrl,
  SNOOZE_MS,
} from './appRelease';

/**
 * Logique de mise à jour : elle décide si l'application bloque son démarrage.
 * Une erreur ici est visible par tous les utilisateurs (écran affiché à tort)
 * ou invisible pour tous (mise à jour jamais proposée) — d'où ces tests sur les
 * cas limites plutôt que sur le cas nominal seulement.
 */

describe('versions', () => {
  it('découpe une version en nombres comparables', () => {
    expect(parseVersion('2.2.3')).toEqual([2, 2, 3]);
    expect(parseVersion('v2.3')).toEqual([2, 3]);
    expect(parseVersion('2.2.3-beta.1')).toEqual([2, 2, 3]);
    expect(parseVersion('')).toEqual([]);
    expect(parseVersion(undefined)).toEqual([]);
  });

  it('compare segment par segment, les segments manquants valant zéro', () => {
    expect(compareVersions('2.2.2', '2.2.3')).toBe(-1);
    expect(compareVersions('2.2.3', '2.2.2')).toBe(1);
    expect(compareVersions('2.2', '2.2.0')).toBe(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
    expect(compareVersions('3.0.0', '2.99.99')).toBe(1);
  });

  it('ignore un préfixe v et un suffixe de pré-version', () => {
    expect(isOutdated('v2.2.2', '2.2.3')).toBe(true);
    expect(isOutdated('2.2.3', '2.2.3-beta.1')).toBe(false);
  });
});

describe('decideUpdate', () => {
  const now = 1_800_000_000_000;

  it('ne signale rien sans version publiée exploitable', () => {
    expect(decideUpdate('2.2.3', null, null, now).available).toBe(false);
    expect(decideUpdate('2.2.3', { latestVersion: '' }, null, now).available).toBe(false);
    expect(decideUpdate('2.2.3', { latestVersion: '2.3.0', enabled: false }, null, now).available).toBe(
      false,
    );
  });

  it('ne propose jamais de « mettre à jour » vers une version plus ancienne', () => {
    // Cas réel : un build de test en avance sur le Play Store.
    const decision = decideUpdate('2.3.1', { latestVersion: '2.3.0' }, null, now);
    expect(decision.available).toBe(false);
  });

  it('propose une mise à jour recommandée quand une version plus récente existe', () => {
    const decision = decideUpdate('2.2.3', { latestVersion: '2.3.0' }, null, now);
    expect(decision).toMatchObject({
      available: true,
      severity: 'recommended',
      latestVersion: '2.3.0',
      dismissed: false,
    });
  });

  it('force la mise à jour sous la version minimale supportée', () => {
    const decision = decideUpdate(
      '2.2.0',
      { latestVersion: '2.3.0', minSupportedVersion: '2.2.2' },
      null,
      now,
    );
    expect(decision.severity).toBe('required');
    // Une version minimale déjà atteinte laisse la main à l'utilisateur.
    expect(
      decideUpdate('2.2.2', { latestVersion: '2.3.0', minSupportedVersion: '2.2.2' }, null, now)
        .severity,
    ).toBe('recommended');
  });

  it('respecte le report de 24 h, mais jamais pour une mise à jour obligatoire', () => {
    const snooze = { version: '2.3.0', until: now + SNOOZE_MS };
    const snoozed = decideUpdate('2.2.3', { latestVersion: '2.3.0' }, snooze, now);
    expect(snoozed.available).toBe(true);
    expect(snoozed.dismissed).toBe(true);

    // Délai écoulé : l'écran revient.
    expect(decideUpdate('2.2.3', { latestVersion: '2.3.0' }, snooze, snooze.until + 1).dismissed).toBe(
      false,
    );

    // Une nouvelle version annule le report de la précédente.
    expect(decideUpdate('2.2.3', { latestVersion: '2.4.0' }, snooze, now).dismissed).toBe(false);

    // Obligatoire : le report est ignoré.
    const forced = decideUpdate(
      '2.2.3',
      { latestVersion: '2.3.0', minSupportedVersion: '2.3.0' },
      snooze,
      now,
    );
    expect(forced.severity).toBe('required');
    expect(forced.dismissed).toBe(false);
  });

  it('borne et nettoie les notes de version', () => {
    const decision = decideUpdate(
      '2.2.3',
      { latestVersion: '2.3.0', notes: '   ' + 'a'.repeat(900) },
      null,
      now,
    );
    expect(decision.notes?.length).toBe(600);
    expect(decideUpdate('2.2.3', { latestVersion: '2.3.0', notes: '   ' }, null, now).notes).toBe(
      undefined,
    );
  });
});

describe('robustesse des données distantes', () => {
  it('ignore un état de report illisible', () => {
    expect(parseSnooze(null)).toBeNull();
    expect(parseSnooze('pas du json')).toBeNull();
    expect(parseSnooze('{"version":2}')).toBeNull();
    expect(parseSnooze('{"version":"2.3.0","until":"demain"}')).toBeNull();
    expect(parseSnooze('{"version":"2.3.0","until":42}')).toEqual({ version: '2.3.0', until: 42 });
  });

  it('normalise le document appRelease/current', () => {
    expect(normalizeRelease(null)).toBeNull();
    expect(normalizeRelease({})).toBeNull();
    expect(normalizeRelease({ latestVersion: 42 })).toBeNull();
    const release = normalizeRelease({
      latestVersion: ' 2.3.0 ',
      minSupportedVersion: ' ',
      notes: 'x'.repeat(900),
      publishedAt: '2026-11-13T10:00:00Z',
      enabled: 'yes',
      unknownField: true,
    });
    expect(release).toEqual({
      latestVersion: '2.3.0',
      minSupportedVersion: undefined,
      notes: 'x'.repeat(600),
      publishedAt: Date.parse('2026-11-13T10:00:00Z'),
      enabled: true,
    });
    expect(normalizeRelease({ latestVersion: '2.4.0', enabled: false })?.enabled).toBe(false);
    expect(normalizeRelease({ latestVersion: '2.4.0', publishedAt: 1234 })?.publishedAt).toBe(1234);
  });
});

describe('liens Play Store', () => {
  it('pointe vers la fiche de l’application', () => {
    expect(playStoreUrl()).toBe('https://play.google.com/store/apps/details?id=com.elysium.elywalk');
    expect(playStoreMarketUrl()).toBe('market://details?id=com.elysium.elywalk');
    expect(playStoreUrl('com.exemple.app')).toContain('id=com.exemple.app');
  });
});
