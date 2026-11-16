import { Capacitor } from '@capacitor/core';

/**
 * Retour haptique (A12.3).
 *
 * Avant : seul un `navigator.vibrate?.([40, 50, 80])` sur le web, ignoré par la
 * WebView Android et absent d'iOS — aucune vibration à la validation des pas,
 * à l'objectif atteint ni à l'arrêt d'une sortie.
 *
 * Le module utilise `@capacitor/haptics` sur mobile (moteur natif, respecte les
 * réglages système) et le repli `navigator.vibrate` sur le web. **Aucun appel
 * ne lève d'exception** : un appareil sans moteur haptique ne doit jamais
 * interrompre une validation ou une fin de sortie.
 */
type HapticsPlugin = typeof import('@capacitor/haptics');

let pluginPromise: Promise<HapticsPlugin | null> | null = null;

function loadPlugin(): Promise<HapticsPlugin | null> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null);
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/haptics').catch(() => null);
  }
  return pluginPromise;
}

function webVibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined') return;
  const vibrate = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (typeof vibrate !== 'function') return;
  try {
    // `VibratePattern` du DOM est `number | Iterable<number>` ; les deux formes
    // sont acceptées par les navigateurs, on reste tolérant sur le typage.
    (vibrate as (p: number | number[]) => boolean).call(navigator, pattern);
  } catch {
    /* pas de moteur : on ignore */
  }
}

/** Confirmation légère (validation, ajout, enregistrement). */
export async function hapticTap(): Promise<void> {
  try {
    const plugin = await loadPlugin();
    if (plugin) await plugin.Haptics.impact({ style: plugin.ImpactStyle.Light });
    else webVibrate(20);
  } catch {
    webVibrate(20);
  }
}

/** Objectif atteint, palier de série, arrivée à destination. */
export async function hapticSuccess(): Promise<void> {
  try {
    const plugin = await loadPlugin();
    if (plugin) {
      await plugin.Haptics.impact({ style: plugin.ImpactStyle.Medium });
      await plugin.Haptics.vibrate({ duration: 80 });
    } else {
      webVibrate([40, 50, 80]);
    }
  } catch {
    webVibrate([40, 50, 80]);
  }
}

/** Fin de sortie (arrêt volontaire) : motif plus marqué. */
export async function hapticFinish(): Promise<void> {
  try {
    const plugin = await loadPlugin();
    if (plugin) {
      await plugin.Haptics.vibrate({ duration: 160 });
      await plugin.Haptics.impact({ style: plugin.ImpactStyle.Heavy });
    } else {
      webVibrate([60, 40, 60, 40, 120]);
    }
  } catch {
    webVibrate([60, 40, 60, 40, 120]);
  }
}

/** Erreur / refus (facultatif, jamais bloquant). */
export async function hapticError(): Promise<void> {
  try {
    const plugin = await loadPlugin();
    if (plugin) await plugin.Haptics.vibrate({ duration: 220 });
    else webVibrate(220);
  } catch {
    webVibrate(220);
  }
}
