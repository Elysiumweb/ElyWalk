import { Capacitor } from '@capacitor/core';

// ============================================================
// Signaux appareil (anti-fraude parrainage)
// ------------------------------------------------------------
// - IP publique : deux comptes parrain/filleul ne doivent pas
//   partager la même adresse IP.
// - HWID : identifiant matériel. Sur Android, identifiant unique
//   de l'appareil ; sur le web, empreinte matérielle (GPU, CPU,
//   écran, fuseau…). Un même HWID ne peut pas parrainer un
//   autre compte.
// ============================================================

export interface DeviceSignals {
  ip: string | null;
  hwid: string | null;
}

/** Adresses publiques essayées dans l'ordre pour récupérer l'IP. */
const IP_ENDPOINTS: { url: string; extract: (json: unknown) => string | null }[] = [
  {
    url: 'https://api.ipify.org?format=json',
    extract: (j) => (j as { ip?: string }).ip || null,
  },
  {
    url: 'https://api64.ipify.org?format=json',
    extract: (j) => (j as { ip?: string }).ip || null,
  },
  {
    url: 'https://ipapi.co/json/',
    extract: (j) => (j as { ip?: string }).ip || null,
  },
];

/** Récupère l'adresse IP publique de l'appareil (null si impossible). */
export async function getDeviceIp(timeoutMs = 6000): Promise<string | null> {
  for (const endpoint of IP_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(endpoint.url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const ip = endpoint.extract(await res.json());
      if (ip) return ip;
    } catch {
      // Essayer l'endpoint suivant.
    }
  }
  return null;
}

/** Empreinte matérielle du navigateur (GPU, CPU, écran, fuseau…). */
function webHardwareFingerprint(): string {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const parts: string[] = [
    navigator.userAgent || '',
    navigator.language || '',
    (navigator as { platform?: string }).platform || '',
    `cpu:${navigator.hardwareConcurrency || 0}`,
    `ram:${nav.deviceMemory || 0}`,
    `screen:${screen.width}x${screen.height}x${screen.colorDepth}`,
    `tz:${Intl.DateTimeFormat().resolvedOptions().timeZone || ''}`,
    `touch:${navigator.maxTouchPoints || 0}`,
    `gpu:${webglRenderer()}`,
  ];
  return `WEB-${fnv1aHash(parts.join('|'))}`;
}

/** Modèle de carte graphique via WebGL (signal matériel fort). */
function webglRenderer(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return 'unknown';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_VENDOR_WEBGL: number;
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    if (!dbg) return 'masked';
    const vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string;
    const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
    return `${vendor} ${renderer}`;
  } catch {
    return 'unavailable';
  }
}

/**
 * HWID de l'appareil :
 * - Plateforme native (Android) : identifiant unique de l'appareil.
 * - Web : empreinte matérielle stable du navigateur.
 */
export async function getDeviceHwid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Device } = await import('@capacitor/device');
      const { identifier } = await Device.getId();
      if (identifier) return `NAT-${identifier}`;
    } catch {
      // Le plugin n'a pas répondu : on retombe sur l'empreinte web.
    }
  }
  try {
    return webHardwareFingerprint();
  } catch {
    return null;
  }
}

/** Récupère IP + HWID en parallèle (best effort, ne lève jamais d'erreur). */
export async function getDeviceSignals(timeoutMs = 8000): Promise<DeviceSignals> {
  const work = Promise.all([
    getDeviceIp().catch(() => null),
    getDeviceHwid().catch(() => null),
  ]).then(([ip, hwid]) => ({ ip, hwid }));
  const fallback = new Promise<DeviceSignals>((resolve) => {
    setTimeout(() => resolve({ ip: null, hwid: null }), timeoutMs);
  });
  return Promise.race([work, fallback]);
}

/** Hash FNV-1a 32 bits (deux passes pour un identifiant plus long). */
function fnv1aHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
