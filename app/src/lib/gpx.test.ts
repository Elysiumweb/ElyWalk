import { describe, expect, it } from 'vitest';
import {
  MAX_POINT_GAP_SEC,
  buildImportedActivity,
  gpxImportError,
  parseGpx,
} from './gpx';

const wrap = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${inner}</gpx>`;

const twoPoints = (t0: number, t1: number) =>
  wrap(`<trk><name>Boucle</name><trkseg>
    <trkpt lat="48.8566" lon="2.3522"><ele>35</ele><time>${new Date(t0).toISOString()}</time></trkpt>
    <trkpt lat="48.8580" lon="2.3522"><ele>38</ele><time>${new Date(t1).toISOString()}</time></trkpt>
  </trkseg></trk>`);

describe('import GPX (A12.2)', () => {
  it('lit les pistes avec altitude, horodatage et nom', () => {
    const tracks = parseGpx(twoPoints(0, 60_000));
    expect(tracks).toHaveLength(1);
    expect(tracks[0].name).toBe('Boucle');
    expect(tracks[0].points).toHaveLength(2);
    expect(tracks[0].points[0]).toMatchObject({ lat: 48.8566, lng: 2.3522, altitude: 35 });
    expect(tracks[0].points[1].altitude).toBe(38);
  });

  it('lit un itinéraire (rtept) quand il n’y a aucune piste', () => {
    const tracks = parseGpx(
      wrap(`<rte>
        <rtept lat="48.8566" lon="2.3522"/>
        <rtept lat="48.8600" lon="2.3522"/>
      </rte>`),
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].points).toHaveLength(2);
  });

  it('ignore les points hors bornes ou non numériques', () => {
    const tracks = parseGpx(
      wrap(`<trk><trkseg>
        <trkpt lat="48.8566" lon="2.3522"/>
        <trkpt lat="999" lon="2.3522"/>
        <trkpt lat="abc" lon="2.3522"/>
        <trkpt lat="48.8580" lon="2.3522"/>
      </trkseg></trk>`),
    );
    expect(tracks[0].points).toHaveLength(2);
  });

  it('calcule distance, durée plafonnée, pas et calories', () => {
    // 140 m environ, 60 s d'écart : la durée ne doit pas être gonflée.
    const track = parseGpx(twoPoints(0, 60_000))[0];
    const activity = buildImportedActivity(track, { strideCm: 70 });
    expect(activity).not.toBeNull();
    expect(activity!.distanceM).toBeGreaterThan(100);
    expect(activity!.distanceM).toBeLessThan(200);
    expect(activity!.durationSec).toBe(60);
    // 140 m / 0,70 m ≈ 200 pas, et 0,04 kcal/pas sans profil santé.
    expect(activity!.steps).toBeGreaterThan(150);
    expect(activity!.calories).toBeGreaterThan(0);
    expect(activity!.type).toBe('walk');
  });

  it('plafonne un écart temporel aberrant (GPS qui décroche)', () => {
    const track = parseGpx(twoPoints(0, 3 * 3600 * 1000))[0];
    const activity = buildImportedActivity(track);
    expect(activity!.durationSec).toBe(MAX_POINT_GAP_SEC);
  });

  it('estime la durée à 5 km/h quand la trace n’est pas horodatée', () => {
    const track = parseGpx(
      wrap(`<trk><trkseg>
        <trkpt lat="48.8566" lon="2.3522"/>
        <trkpt lat="48.8580" lon="2.3522"/>
      </trkseg></trk>`),
    )[0];
    const activity = buildImportedActivity(track, { fallbackStart: 1_700_000_000_000 });
    // 140 m à 5 km/h ≈ 100 s.
    expect(activity!.durationSec).toBeGreaterThan(80);
    expect(activity!.durationSec).toBeLessThan(130);
    expect(activity!.startedAt).toBe(1_700_000_000_000);
    expect(activity!.points[0].recordedAt).toBeGreaterThanOrEqual(1_700_000_000_000);
  });

  it('refuse une piste trop courte pour former une sortie', () => {
    const track = parseGpx(wrap(`<trk><trkseg><trkpt lat="48.85" lon="2.35"/></trkseg></trk>`))[0];
    expect(buildImportedActivity(track)).toBeNull();
  });

  it('donne un message clair pour un fichier inexploitable', () => {
    expect(gpxImportError('')).toMatch(/vide/);
    expect(gpxImportError('{"type":"FeatureCollection"}')).toMatch(/GPX/);
    expect(gpxImportError(wrap('<trk><trkseg></trkseg></trk>'))).toMatch(/Aucun point/);
    expect(gpxImportError(twoPoints(0, 1000))).toBeNull();
  });
});
