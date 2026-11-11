import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatRouteDistance,
  externalMapsUrl,
  pointLabel,
  tidyAddress,
  routeOnFootBikeOrCar,
  type TravelMode,
} from './directions';
import { haversineM } from './geo';

describe('formatDuration', () => {
  it('affiche les minutes sous une heure', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(30)).toBe('1 min');
    expect(formatDuration(12 * 60)).toBe('12 min');
    expect(formatDuration(59 * 60 + 20)).toBe('59 min');
    expect(formatDuration(60 * 60)).toBe('1 h');
  });

  it('affiche heures et minutes au-delà', () => {
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3600 + 5 * 60)).toBe('1 h 05');
    expect(formatDuration(2 * 3600 + 30 * 60)).toBe('2 h 30');
  });

  it('tolère les valeurs invalides', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-10)).toBe('—');
  });
});

describe('formatRouteDistance', () => {
  it('arrondit les petites distances à la dizaine de mètres', () => {
    expect(formatRouteDistance(0)).toBe('—');
    expect(formatRouteDistance(24)).toBe('20 m');
    expect(formatRouteDistance(454)).toBe('450 m');
  });

  it('passe en kilomètres avec une virgule française', () => {
    expect(formatRouteDistance(1000)).toBe('1,0 km');
    expect(formatRouteDistance(3240)).toBe('3,2 km');
  });
});

describe('adresses', () => {
  it('raccourcit une adresse Nominatim', () => {
    expect(tidyAddress('12, Rue de Rivoli, 75004 Paris, Île-de-France, France')).toBe(
      'Rue de Rivoli, 75004 Paris, Île-de-France'
    );
  });

  it('privilégie l’adresse réelle au couple de coordonnées', () => {
    expect(pointLabel({ lat: 48.85, lng: 2.35 }, '1 place de la Concorde, Paris')).toBe(
      '1 place de la Concorde, Paris'
    );
    expect(pointLabel({ lat: 48.8566, lng: 2.3522 })).toBe('48.8566, 2.3522');
    expect(pointLabel(null)).toBe('Point de départ');
  });
});

describe('externalMapsUrl', () => {
  it('adapte le mode de déplacement et l’origine', () => {
    const modes: TravelMode[] = ['walk', 'bike', 'car', 'transit'];
    const expected = ['walking', 'bicycling', 'driving', 'transit'];
    modes.forEach((mode, index) => {
      const url = externalMapsUrl({ lat: 48.85, lng: 2.35 }, mode, { lat: 48.86, lng: 2.36 });
      expect(url).toContain(`travelmode=${expected[index]}`);
      expect(url).toContain('origin=48.86,2.36');
      expect(url).toContain('destination=48.85,2.35');
    });
  });
});

describe('haversineM', () => {
  it('mesure la distance entre deux points connus', () => {
    // Paris (Notre-Dame) → Lyon (Part-Dieu) ≈ 392 km.
    const d = haversineM({ lat: 48.853, lng: 2.3499 }, { lat: 45.7606, lng: 4.8593 });
    expect(d).toBeGreaterThan(388_000);
    expect(d).toBeLessThan(396_000);
  });

  it('renvoie zéro pour un point identique', () => {
    expect(haversineM({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Transports en commun : normalisation des deux fournisseurs
// ---------------------------------------------------------------------------

import { inIleDeFrance, parseMotisPlan, parseOtpPlan } from './directions';

/** Polyline précision 1e5 : « _p~iF~ps|U_ulLnnqC ». */
const POLY_1E5 = '_p~iF~ps|U_ulLnnqC';
/** Même tracé logique, précision 1e7 (Transitous / MOTIS v1). */
const POLY_1E7 = '_ibE_accC_wbEnnoC';

const OTP_FIXTURE = {
  plan: {
    itineraries: [
      {
        duration: 1080,
        legs: [
          {
            mode: 'WALK',
            distance: 147,
            duration: 180,
            from: { name: 'START' },
            to: { name: 'Hôtel de Ville' },
            legGeometry: { points: POLY_1E5 },
          },
          {
            mode: 'SUBWAY',
            distance: 4200,
            duration: 720,
            from: { name: 'Hôtel de Ville' },
            to: { name: 'Charles de Gaulle - Étoile' },
            routeShortName: '1',
            routeColor: 'FFCE00',
            headsign: 'La Défense',
            legGeometry: { points: POLY_1E5 },
          },
          {
            mode: 'WALK',
            distance: 300,
            duration: 180,
            from: { name: 'Charles de Gaulle - Étoile' },
            to: { name: 'END' },
            legGeometry: { points: POLY_1E5 },
          },
        ],
      },
    ],
  },
};

const MOTIS_FIXTURE = {
  itineraries: [
    {
      duration: 1080,
      legs: [
        {
          mode: 'WALK',
          distance: 147,
          duration: 180,
          from: { name: 'START' },
          to: { name: 'Hôtel de Ville' },
          legGeometry: { points: POLY_1E7, precision: 7 },
        },
        {
          mode: 'SUBWAY',
          distance: 4200,
          duration: 720,
          from: { name: 'Hôtel de Ville' },
          to: { name: 'Charles de Gaulle - Étoile' },
          routeShortName: '1',
          routeColor: 'FFCE00',
          headsign: 'La Défense',
          legGeometry: { points: POLY_1E7, precision: 7 },
        },
      ],
    },
  ],
};

describe('parseOtpPlan / parseMotisPlan', () => {
  it('normalise un itinéraire Île-de-France Mobilités', () => {
    const plan = parseOtpPlan(OTP_FIXTURE);
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('transit');
    expect(plan!.durationS).toBe(1080);
    expect(plan!.distanceM).toBe(147 + 4200 + 300);
    expect(plan!.steps[0].instruction).toContain('Marchez');
    expect(plan!.steps[1].instruction).toContain('Prenez 1');
    expect(plan!.steps[1].instruction).toContain('direction La Défense');
    expect(plan!.transitLegs?.[1]).toMatchObject({ mode: 'metro', line: '1', color: '#FFCE00' });
    expect(plan!.geometry.length).toBeGreaterThan(1);
    // Coordonnées décodées en degrés, pas en unités de polyline.
    expect(Math.abs(plan!.geometry[0].lat)).toBeLessThan(90);
    expect(Math.abs(plan!.geometry[0].lng)).toBeLessThan(180);
  });

  it('normalise un itinéraire Transitous (polyline précision 1e7)', () => {
    const plan = parseMotisPlan(MOTIS_FIXTURE);
    expect(plan).not.toBeNull();
    expect(plan!.provider).toContain('Transitous');
    expect(plan!.distanceM).toBe(147 + 4200);
    expect(plan!.transitLegs?.[1].mode).toBe('metro');
    expect(plan!.geometry.length).toBeGreaterThan(1);
    expect(Math.abs(plan!.geometry[0].lat)).toBeLessThan(90);
  });

  it('ignore une réponse sans itinéraire', () => {
    expect(parseOtpPlan({ plan: { itineraries: [] } })).toBeNull();
    expect(parseMotisPlan({ itineraries: [] })).toBeNull();
    expect(parseMotisPlan({})).toBeNull();
  });
});

describe('inIleDeFrance', () => {
  it('reconnaît un trajet francilien', () => {
    expect(inIleDeFrance({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8738, lng: 2.295 })).toBe(true);
  });

  it('rejette un trajet hors région', () => {
    expect(inIleDeFrance({ lat: 48.8566, lng: 2.3522 }, { lat: 45.764, lng: 4.8357 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Modes marche / vélo / voiture — Valhalla d'abord, OSRM en secours
// ---------------------------------------------------------------------------

describe('routeOnFootBikeOrCar', () => {
  const from = { lat: 48.85, lng: 2.35 };
  const to = { lat: 48.87, lng: 2.29 };

  it('interroge Valhalla avec le coût correspondant au mode', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      return {
        ok: true,
        json: async () => ({
          routes: [
            {
              distance: 6100,
              duration: 1200,
              geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
              legs: [
                {
                  steps: [
                    {
                      distance: 300,
                      duration: 200,
                      name: 'Rue de Rivoli',
                      maneuver: { type: 'turn', modifier: 'left', instruction: 'Tournez à gauche dans Rue de Rivoli.' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      } as any;
    }) as any;
    try {
      const plan = await routeOnFootBikeOrCar(from, to, 'bike');
      expect(calls[0]).toContain('valhalla');
      expect(decodeURIComponent(calls[0])).toContain('"costing":"bicycle"');
      expect(plan.mode).toBe('bike');
      expect(plan.provider).toContain('Valhalla');
      // Valhalla fournit la phrase française : elle est reprise telle quelle.
      expect(plan.steps[0].instruction).toBe('Tournez à gauche dans Rue de Rivoli.');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retombe sur OSRM et recalcule la durée à pied si Valhalla échoue', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('valhalla')) throw new Error('502');
      return {
        ok: true,
        json: async () => ({
          routes: [
            {
              distance: 4800,
              duration: 360, // durée voiture, ignorée pour la marche
              geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
              legs: [{ steps: [] }],
            },
          ],
        }),
      } as any;
    }) as any;
    try {
      const plan = await routeOnFootBikeOrCar(from, to, 'walk');
      expect(calls).toHaveLength(2);
      expect(calls[1]).toContain('project-osrm');
      expect(plan.mode).toBe('walk');
      // 4,8 km à 4,8 km/h = 1 h = 3600 s.
      expect(plan.durationS).toBe(3600);
      expect(plan.provider).toContain('OSRM');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('signale l’indisponibilité quand les deux moteurs échouent', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as any;
    try {
      await expect(routeOnFootBikeOrCar(from, to, 'car')).rejects.toThrow(/indisponible/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});
