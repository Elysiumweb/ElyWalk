import { useEffect, useMemo, useRef, useState } from 'react';
import { encodeQr, drawQr, type QrCode } from '../lib/qrcode';
import { shareUrlForReferral } from '../lib/share';

interface Props {
  value: string;
  size?: number;
  logo?: string;
  title?: string;
}

/**
 * QR code **généré localement** (aucun service externe).
 *
 * Avant, l'image venait de `api.qrserver.com` : sans réseau, le composant
 * affichait du texte à la place du code, donc impossible à scanner sur le
 * terrain (F11). L'encodage est maintenant fait dans l'application
 * (`lib/qrcode.ts`), le rendu sur un canvas : le QR s'affiche et s'imprime
 * même en mode avion.
 */
export default function QRCode({ value, size = 180, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qr, setQr] = useState<QrCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setQr(encodeQr(value || ' ', { level: 'M' }));
      setError(null);
    } catch (e) {
      setQr(null);
      setError((e as Error).message);
    }
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !qr) return;
    // Rendu 2× pour rester net sur les écrans HiDPI.
    const scale = 2;
    canvas.width = size * scale;
    canvas.height = size * scale;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    drawQr(ctx, qr, { x: 0, y: 0, size, dark: '#111111', light: '#ffffff', margin: 2 });
  }, [qr, size]);

  if (error) {
    return (
      <div
        className="qr-fallback"
        style={{
          width: size,
          height: size,
          background: 'var(--surface-2)',
          border: '1px solid var(--gold-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 12,
        }}
      >
        <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: 22, letterSpacing: '0.2em' }}>{value}</div>
        <small style={{ color: 'var(--muted)', textAlign: 'center' }}>{title || 'Code ami ElyWalk'}</small>
      </div>
    );
  }

  return (
    <div className="qr-wrap" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`QR code ${value}`}
        data-testid="qr-canvas"
        style={{ borderRadius: 12, border: '1px solid var(--gold-border)', background: 'white', padding: 6, boxSizing: 'content-box' }}
      />
      {title && <small style={{ color: 'var(--muted)' }}>{title}</small>}
    </div>
  );
}

/**
 * Carte de partage « Ajoute-moi » : QR dessiné localement + code + pseudo,
 * partagée via la feuille système (ou téléchargée sur le web).
 */
export async function shareFriendCode(code: string, displayName: string): Promise<'shared' | 'downloaded'> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Génération de l’image impossible.');

  const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#25241e');
  grad.addColorStop(1, '#111111');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = '#D8CA82';
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, 1004, 1274);
  ctx.fillStyle = '#D8CA82';
  ctx.font = '700 44px Arial';
  ctx.fillText('ELYWALK', 84, 120);
  ctx.fillStyle = '#fff';
  ctx.font = '700 48px Arial';
  ctx.fillText('Ajoute-moi !', 84, 200);
  ctx.fillStyle = '#98948a';
  ctx.font = '30px Arial';
  ctx.fillText(`${displayName} t’invite sur ElyWalk`, 84, 250);

  // QR hors ligne : encodé ici, dessiné sur le même canvas.
  try {
    const qr = encodeQr(shareUrlForReferral(code), { level: 'M' });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(240, 320, 600, 600);
    drawQr(ctx, qr, { x: 240, y: 320, size: 600, dark: '#111111', light: '#ffffff', margin: 2 });
  } catch {
    ctx.fillStyle = '#fff';
    ctx.font = '700 120px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(code, 540, 620);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#D8CA82';
  ctx.font = '700 78px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(code, 540, 1020);
  ctx.fillStyle = '#98948a';
  ctx.font = '26px Arial';
  ctx.fillText('Code ami · scanne le QR ou entre le code', 540, 1070);
  ctx.fillStyle = '#d8d2c2';
  ctx.font = '30px Arial';
  ctx.fillText('Marchez. Progressez. Gagnez.', 540, 1190);
  ctx.textAlign = 'left';

  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Génération de l’image impossible.'))), 'image/jpeg', 0.92));
  const file = new File([blob], `elywalk-qr-${code}.jpg`, { type: 'image/jpeg' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title: 'Mon code ElyWalk', text: `Rejoins-moi sur ElyWalk avec le code ${code}`, files: [file] });
      return 'shared';
    } catch (e) {
      if (/cancel|abort/i.test((e as Error).message || '')) return 'shared';
    }
  }
  const url2 = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url2;
  a.download = `elywalk-qr-${code}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url2), 1500);
  return 'downloaded';
}

/** Petit aperçu textuel (utilisé quand le rendu canvas n'est pas possible). */
export function QRFallbackCanvas({ code, name }: { code: string; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useMemo(() => encodeQrSafe(code), [code]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 240;
    canvas.height = 240;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 240, 240);
    if (preview) drawQr(ctx, preview, { x: 10, y: 10, size: 220, dark: '#111111', light: '#ffffff', margin: 2 });
    else {
      ctx.fillStyle = '#D8CA82';
      ctx.font = '700 36px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(code, 120, 130);
      ctx.fillStyle = '#98948a';
      ctx.font = '14px Arial';
      ctx.fillText(name, 120, 160);
    }
  }, [preview, code, name]);
  return <canvas ref={ref} width={240} height={240} style={{ borderRadius: 12, border: '1px solid var(--gold-border)' }} />;
}

function encodeQrSafe(value: string): QrCode | null {
  try {
    return encodeQr(value || ' ');
  } catch {
    return null;
  }
}
