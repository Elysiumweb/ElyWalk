import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatRouteDistance,
  externalMapsUrl,
  pointLabel,
  tidyAddress,
  routeOnFootBikeOrCar,
  searchAddresses,
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

/** Réponse Valhalla native (`trip`) — format réel du service. */
const VALHALLA_TRIP = {
  trip: {
    language: 'fr-FR',
    summary: { length: 6.1, time: 1200 },
    legs: [
      {
        summary: { length: 6.1, time: 1200 },
        // Polyline précision 1e6.
        shape: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        maneuvers: [
          {
            type: 'depart',
            instruction: 'Partez vers le nord sur Rue de Rivoli.',
            length: 0.3,
            time: 200,
            begin_shape_index: 0,
          },
          {
            type: 'left',
            modifier: 'left',
            instruction: 'Tournez à gauche dans Rue de Rivoli.',
            length: 5.8,
            time: 1000,
            begin_shape_index: 1,
          },
          {
            type: 'destination',
            instruction: 'Vous êtes arrivé à votre destination.',
            length: 0,
            time: 0,
            begin_shape_index: 2,
          },
        ],
      },
    ],
  },
};

describe('routeOnFootBikeOrCar', () => {
  const from = { lat: 48.85, lng: 2.35 };
  const to = { lat: 48.87, lng: 2.29 };

  it('interroge Valhalla avec le coût correspondant au mode', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      return { ok: true, json: async () => VALHALLA_TRIP } as any;
    }) as any;
    try {
      const plan = await routeOnFootBikeOrCar(from, to, 'bike');
      expect(calls[0]).toContain('valhalla');
      expect(decodeURIComponent(calls[0])).toContain('"costing":"bicycle"');
      expect(plan.mode).toBe('bike');
      expect(plan.provider).toContain('Valhalla');
      // Valhalla fournit la phrase française : elle est reprise telle quelle,
      // dans l'ordre des manœuvres (départ, virage, arrivée).
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[1].instruction).toBe('Tournez à gauche dans Rue de Rivoli.');
      expect(plan.steps[1].kind).toBe('left');
      expect(plan.steps[1].at).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
      // Distance et durée viennent du résumé du trajet, pas de l'interface.
      expect(plan.distanceM).toBe(6100);
      expect(plan.durationS).toBe(1200);
      expect(plan.geometry.length).toBeGreaterThan(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('demande un tracé piéton ou automobile selon le mode', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      calls.push(decodeURIComponent(String(input)));
      return { ok: true, json: async () => VALHALLA_TRIP } as any;
    }) as any;
    try {
      await routeOnFootBikeOrCar(from, to, 'walk');
      await routeOnFootBikeOrCar(from, to, 'car');
      expect(calls[0]).toContain('"costing":"pedestrian"');
      expect(calls[1]).toContain('"costing":"auto"');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejette une réponse Valhalla vide et bascule sur OSRM', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('valhalla')) return { ok: true, json: async () => ({}) } as any;
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
      // Instance communautaire multimodale : profil piéton explicite.
      expect(calls[1]).toContain('routed-foot');
      expect(plan.mode).toBe('walk');
      // Le profil étant respecté, la durée du moteur est conservée.
      expect(plan.durationS).toBe(360);
      expect(plan.provider).toContain('piéton');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('utilise le démonstrateur OSRM en dernier recours et recalcule la durée', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (!url.includes('project-osrm')) throw new Error('502');
      return {
        ok: true,
        json: async () => ({
          routes: [
            { distance: 4800, duration: 360, geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', legs: [{ steps: [] }] },
          ],
        }),
      } as any;
    }) as any;
    try {
      const plan = await routeOnFootBikeOrCar(from, to, 'walk');
      expect(calls.some((url) => url.includes('routed-foot'))).toBe(true);
      expect(calls[calls.length - 1]).toContain('project-osrm');
      // 4,8 km à 4,8 km/h = 1 h = 3600 s.
      expect(plan.durationS).toBe(3600);
      expect(plan.provider).toContain('OSRM');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('signale l’indisponibilité quand les trois moteurs échouent', async () => {
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

// ---------------------------------------------------------------------------
// Recherche d'adresse (Rencontres → Adresse)
// ---------------------------------------------------------------------------

describe('searchAddresses', () => {
  it('ne sollicite aucun service sous trois caractères', async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return { ok: true, json: async () => ({ features: [] }) } as any;
    }) as any;
    try {
      expect(await searchAddresses('pa')).toEqual([]);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('propose des adresses Photon avec leurs coordonnées', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: { housenumber: '12', street: 'Rue de Rivoli', postcode: '75004', city: 'Paris', osm_id: 42, osm_type: 'W', osm_value: 'house' },
              geometry: { coordinates: [2.3553, 48.8558] },
            },
          ],
        }),
      }) as any) as any;
    try {
      const items = await searchAddresses('rue de rivoli 75004');
      expect(items).toHaveLength(1);
      expect(items[0].label).toContain('Rue de Rivoli');
      expect(items[0].lat).toBeCloseTo(48.8558, 3);
      expect(items[0].lng).toBeCloseTo(2.3553, 3);
      expect(items[0].kind).toBe('house');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retombe sur Nominatim quand Photon échoue', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes('photon')) throw new Error('503');
      return {
        ok: true,
        json: async () => [
          { place_id: 7, display_name: '1, Place de la Concorde, 75008 Paris, France', lat: '48.8656', lon: '2.3212', type: 'house' },
        ],
      } as any;
    }) as any;
    try {
      const items = await searchAddresses('place de la concorde paris');
      expect(items).toHaveLength(1);
      expect(items[0].label).toBe('Place de la Concorde, 75008 Paris');
      expect(items[0].lat).toBeCloseTo(48.8656, 3);
    } finally {
      globalThis.fetch = original;
    }
  });
});
