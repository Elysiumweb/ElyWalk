/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  ADMOB_APP_ID,
  AD_UNIT_APP_OPEN,
  AD_UNIT_INTERSTITIAL,
  AD_UNIT_REWARDED,
} from './constants';
import manifestXml from '../../android/app/src/main/AndroidManifest.xml?raw';

/**
 * Garde-fou de production : un ID AdMob erroné (ou désynchronisé du manifeste)
 * ne provoque aucune erreur visible — le SDK ne sert simplement aucune annonce.
 * Ces tests échouent immédiatement si la configuration régresse.
 */

const APP_ID_RE = /^ca-app-pub-\d{16}~\d{10}$/;
const AD_UNIT_RE = /^ca-app-pub-\d{16}\/\d{10}$/;

function publisherOf(id: string): string {
  return id.split(/[~/]/)[0];
}

describe('configuration AdMob de production', () => {
  it('utilise un ID d’application AdMob bien formé', () => {
    expect(ADMOB_APP_ID).toMatch(APP_ID_RE);
  });

  it('utilise des blocs d’annonces bien formés et tous du même compte', () => {
    for (const unit of [AD_UNIT_APP_OPEN, AD_UNIT_INTERSTITIAL, AD_UNIT_REWARDED]) {
      expect(unit).toMatch(AD_UNIT_RE);
      expect(publisherOf(unit)).toBe(publisherOf(ADMOB_APP_ID));
    }
  });

  it('n’a pas deux blocs d’annonces identiques', () => {
    const units = [AD_UNIT_APP_OPEN, AD_UNIT_INTERSTITIAL, AD_UNIT_REWARDED];
    expect(new Set(units).size).toBe(units.length);
  });

  it('reste synchronisé avec la meta-data APPLICATION_ID du manifeste', () => {
    const match = manifestXml.match(
      /com\.google\.android\.gms\.ads\.APPLICATION_ID"\s*\n?\s*android:value="([^"]+)"/
    );
    expect(match?.[1]).toBe(ADMOB_APP_ID);
  });
});
