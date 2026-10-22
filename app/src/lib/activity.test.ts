import { describe, expect, it } from 'vitest';
import {
  activeFiltersCount,
  buildActivitiesCsv,
  buildDailyStepsCsv,
  buildGpx,
  currentMonthRange,
  currentWeekRange,
  distanceBetween,
  elevationGainM,
  filtersToQuery,
  fmtDuration,
  goalProgress,
  gpsQuality,
  isQualityDegraded,
  paceMinPerKm,
  percentChange,
  previousWeekRange,
  safeFilename,
  sessionTitle,
  speedKmh,
  summarizeRange,
  weatherLabel,
} from './activity';
import type { ActivitySession, DailySteps } from './types';

const session: ActivitySession = {
  id: 'abc',
  uid: 'u1',
  type: 'walk',
  startedAt: new Date(2026, 9, 21, 8, 30, 0).getTime(),
  durationSec: 1800,
  pausedSec: 300,
  distanceM: 5000,
  calories: 250,
  steps: 6667,
  status: 'completed',
  points: [
    { lat: 49.44, lng: 2.09, recordedAt: 1000, altitude: 50, accuracy: 8 },
    { lat: 49.441, lng: 2.091, recordedAt: 2000, altitude: 55 },
    { lat: 49.442, lng: 2.092, recordedAt: 3000, altitude: 52 },
  ],
  title: 'Balade au bord de l’Authie',
  note: 'Très calme, un peu de vent.',
  weather: 'wind',
};

describe('géométrie et formatage', () => {
  it('calcule une distance haversine cohérente', () => {
    const d = distanceBetween({ lat: 49, lng: 2 }, { lat: 50, lng: 2 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112500);
    expect(distanceBetween({ lat: 49, lng: 2 }, { lat: 49, lng: 2 })).toBe(0);
  });

  it('formate durée, vitesse et allure (pauses exclues en amont)', () => {
    expect(fmtDuration(3661)).toBe('01:01:01');
    expect(fmtDuration(-5)).toBe('00:00:00');
    expect(speedKmh(10000, 3600)).toBeCloseTo(10);
    expect(paceMinPerKm(5000, 1800)).toBe(`6'00"`);
    expect(paceMinPerKm(0, 100)).toBe('—');
  });

  it('calcule le dénivelé positif cumulé', () => {
    expect(elevationGainM(session.points)).toBe(5);
    expect(elevationGainM([])).toBe(0);
  });

  it('utilise le titre personnalisé ou un libellé de repli', () => {
    expect(sessionTitle(session)).toBe('Balade au bord de l’Authie');
    const fallback = sessionTitle({ ...session, title: '  ' });
    expect(fallback).toContain('Marche');
    expect(fallback).toContain('21');
    expect(weatherLabel('wind')).toContain('Venté');
    expect(weatherLabel(null)).toBeNull();
  });
});

describe('qualité du signal GPS', () => {
  it('classe la précision en trois niveaux', () => {
    expect(gpsQuality(6).level).toBe('good');
    expect(gpsQuality(12).level).toBe('good');
    expect(gpsQuality(20).level).toBe('fair');
    expect(gpsQuality(45).level).toBe('poor');
    expect(gpsQuality(null).level).toBe('unknown');
    expect(gpsQuality(20).label).toContain('±20 m');
  });

  it('détecte une dégradation seulement quand le signal empire', () => {
    expect(isQualityDegraded('good', 'fair')).toBe(true);
    expect(isQualityDegraded('fair', 'poor')).toBe(true);
    expect(isQualityDegraded('poor', 'good')).toBe(false);
    expect(isQualityDegraded('good', 'unknown')).toBe(false);
  });
});

describe('objectif de sortie', () => {
  it('calcule la progression et le restant', () => {
    const goal = goalProgress(2500, 5);
    expect(goal).not.toBeNull();
    expect(goal!.percent).toBe(50);
    expect(goal!.remainingM).toBe(2500);
    expect(goal!.reached).toBe(false);
    expect(goalProgress(6000, 5)!.percent).toBe(100);
    expect(goalProgress(6000, 5)!.reached).toBe(true);
    expect(goalProgress(6000, 5)!.remainingM).toBe(0);
  });

  it('ignore un objectif absent ou invalide', () => {
    expect(goalProgress(1000, null)).toBeNull();
    expect(goalProgress(1000, 0)).toBeNull();
    expect(goalProgress(1000, -3)).toBeNull();
  });
});

describe('synthèses par période', () => {
  const days: DailySteps[] = [
    { date: '2026-10-05', steps: 1000, coins: 1, calories: 40, validatedAt: 1 },
    { date: '2026-10-19', steps: 6000, coins: 6, calories: 240, validatedAt: 2 },
    { date: '2026-10-20', steps: 8000, coins: 8, calories: 320, validatedAt: 3 },
    { date: '2026-10-21', steps: 10000, coins: 10, calories: 400, validatedAt: 4 },
  ];

  it('trouve les bornes de la semaine (lundi → dimanche)', () => {
    const wednesday = new Date(2026, 9, 21, 15, 0, 0);
    expect(currentWeekRange(wednesday)).toEqual({ start: '2026-10-19', end: '2026-10-26' });
    expect(previousWeekRange(wednesday)).toEqual({ start: '2026-10-12', end: '2026-10-19' });
    expect(currentMonthRange(wednesday)).toEqual({ start: '2026-10-01', end: '2026-11-01' });
  });

  it('additionne pas, distance, kcal et jours actifs', () => {
    const week = summarizeRange(days, '2026-10-19', '2026-10-26', 75);
    expect(week.steps).toBe(24000);
    expect(week.distanceM).toBeCloseTo(18000);
    expect(week.calories).toBe(960);
    expect(week.activeDays).toBe(3);
    expect(week.coins).toBe(24);
  });

  it('compare deux périodes en pourcentage', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(100, 0)).toBeNull();
  });
});

describe('export GPX', () => {
  it('produit un GPX 1.1 valide avec titre, points et horodatage', () => {
    const gpx = buildGpx(session);
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<gpx version="1.1" creator="ElyWalk"');
    expect(gpx).toContain('<name>Balade au bord de l’Authie</name>');
    expect(gpx).toContain('<trkpt lat="49.440000" lon="2.090000">');
    expect(gpx).toContain('<ele>50.0</ele>');
    expect(gpx).toContain('<type>walking</type>');
    expect(gpx).toContain('</gpx>');
  });

  it('échappe le XML et ignore les points invalides', () => {
    const gpx = buildGpx({
      ...session,
      title: 'Balade <Authie> & Cie',
      note: 'Titre "spécial"',
      points: [
        { lat: 49.44, lng: 2.09, recordedAt: 1000 },
        { lat: 120, lng: 2.09, recordedAt: 2000 },
      ],
    });
    expect(gpx).toContain('Balade &lt;Authie&gt; &amp; Cie');
    expect(gpx).toContain('Titre &quot;spécial&quot;');
    expect((gpx.match(/<trkpt /g) || []).length).toBe(1);
  });
});

describe('export CSV', () => {
  it('exporte une sortie avec en-tête et champs échappés', () => {
    const csv = buildActivitiesCsv([session], weatherLabel);
    expect(csv.startsWith('\uFEFFdate,debut,duree_s')).toBe(true);
    expect(csv).toContain('1800,300,5000,5.000');
    expect(csv).toContain('"Très calme, un peu de vent."');
    expect(csv).toContain('Venté');
  });

  it('exporte les pas quotidiens avec distance calculée', () => {
    const csv = buildDailyStepsCsv([
      { date: '2026-10-21', steps: 10000, coins: 10, calories: 400, validatedAt: 1 },
    ], 75);
    expect(csv.startsWith('\uFEFFdate,pas,distance_km,calories,elycoins')).toBe(true);
    expect(csv).toContain('2026-10-21,10000,7.500,400,10');
  });

  it('neutralise les caractères de nom de fichier', () => {
    expect(safeFilename('Balade au bord de l’Authie')).toBe('Balade-au-bord-de-l-Authie');
    expect(safeFilename('   ')).toBe('elywalk');
  });
});

describe('filtres de sorties', () => {
  it('convertit l’état d’interface en requête Firestore', () => {
    const now = new Date(2026, 9, 21).getTime();
    expect(filtersToQuery({ type: 'all', periodDays: 0, minDistanceKm: 0 }, now)).toEqual({
      type: undefined, from: undefined, minDistanceM: undefined,
    });
    const query = filtersToQuery({ type: 'run', periodDays: 7, minDistanceKm: 5 }, now);
    expect(query.type).toBe('run');
    expect(query.from).toBe(now - 7 * 86400000);
    expect(query.minDistanceM).toBe(5000);
  });

  it('compte les filtres actifs', () => {
    expect(activeFiltersCount({ type: 'all', periodDays: 0, minDistanceKm: 0 })).toBe(0);
    expect(activeFiltersCount({ type: 'walk', periodDays: 30, minDistanceKm: 0 })).toBe(2);
    expect(activeFiltersCount({ type: 'run', periodDays: 7, minDistanceKm: 1 })).toBe(3);
  });
});
