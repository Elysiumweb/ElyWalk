import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));

const diag = await import('./diagnostics');

beforeEach(() => diag.clearDiagnostics());

describe('journal de diagnostic (F06)', () => {
  it('retire e-mails, coordonnées, jetons et UID avant journalisation', () => {
    const scrubbed = diag.scrubMessage(
      'échec pour alice@example.com à 48.856612,2.352221 (uid BZ333LlhuJMoD4rXIquGE0zzjX43 token eyJhbGciOiJIUzI1NiIsInR5cCI6)',
    );
    expect(scrubbed).not.toContain('alice@example.com');
    expect(scrubbed).not.toContain('48.856612');
    expect(scrubbed).not.toContain('BZ333LlhuJMoD4rXIquGE0zzjX43');
    expect(scrubbed).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6');
    expect(scrubbed).toContain('<email>');
    expect(scrubbed).toContain('<nombre>');
    expect(scrubbed).toContain('<uid>');
  });

  it('dédoublonne les erreurs répétitives avec un compteur', () => {
    for (let i = 0; i < 5; i += 1) diag.logDiagnostic('error', 'network', new Error(`timeout après ${i} ms`));
    const entries = diag.readDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(5);
  });

  it('borne le journal (pas de fuite mémoire sur une longue session)', () => {
    for (let i = 0; i < 400; i += 1) diag.logDiagnostic('warn', `scope-${i}`, new Error(`erreur ${i}`));
    expect(diag.readDiagnostics().length).toBeLessThanOrEqual(200);
  });

  it('produit un rapport lisible sans données personnelles', () => {
    diag.logDiagnostic('error', 'firestore', new Error('Missing or insufficient permissions pour alice@example.com'));
    const report = diag.buildDiagnosticsReport({ pendingSync: 2, adConsent: 'granted', uid: 'BZ333LlhuJMoD4rXIquGE0zzjX43' });
    expect(report).toContain('ElyWalk — rapport de diagnostic');
    expect(report).toContain('Synchronisation en attente : 2');
    expect(report).toContain('Consentement publicitaire : granted');
    expect(report).not.toContain('alice@example.com');
    expect(report).toContain('Aucune coordonnée GPS');
  });

  it('expose les informations d’appareil utiles au support', () => {
    const info = diag.deviceInfo();
    expect(info.platform).toBe('web');
    expect(info.native).toBe(false);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
