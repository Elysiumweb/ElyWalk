import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  size?: number;
  logo?: string;
  title?: string;
}

// Generates QR image via external API (works offline fallback with canvas pattern)
// For full offline QR, we use a tiny canvas fallback that renders the code as pattern + text.
// If API fails, we show a styled code block.
export default function QRCode({ value, size = 180, title }: Props) {
  const [failed, setFailed] = useState(false);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=111111&color=d8ca82&margin=10`;
  if (failed) {
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
      <img
        src={url}
        alt={`QR ${value}`}
        width={size}
        height={size}
        style={{ borderRadius: 12, border: '1px solid var(--gold-border)', background: 'white', padding: 6 }}
        onError={() => setFailed(true)}
        data-testid="qr-image"
      />
      {title && <small style={{ color: 'var(--muted)' }}>{title}</small>}
    </div>
  );
}

// Génère une image de partage stylée ElyWalk avec QR + code + pseudo
export async function shareFriendCode(code: string, displayName: string): Promise<'shared'|'downloaded'> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0,0,1080,1350);
  grad.addColorStop(0,'#25241e'); grad.addColorStop(1,'#111111');
  ctx.fillStyle = grad; ctx.fillRect(0,0,1080,1350);
  ctx.strokeStyle = '#D8CA82'; ctx.lineWidth = 3; ctx.strokeRect(38,38,1004,1274);
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 44px Arial'; ctx.fillText('ELYWALK',84,120);
  ctx.fillStyle = '#fff'; ctx.font = '700 48px Arial'; ctx.fillText('Ajoute-moi !',84,200);
  ctx.fillStyle = '#98948a'; ctx.font = '30px Arial'; ctx.fillText(`${displayName} t’invite sur ElyWalk`,84,250);
  // QR placeholder (on dessine un QR stylisé si on ne charge pas l'image)
  // On tente de charger l'image QR
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(`${location.origin}/?ref=${code}`)}&bgcolor=ffffff&color=111111`;
  try {
    const img = await loadImage(qrUrl);
    ctx.drawImage(img, 240, 320, 600, 600);
  } catch {
    // fallback: code text
    ctx.fillStyle = '#fff'; ctx.font = '700 120px Arial'; ctx.textAlign = 'center';
    ctx.fillText(code, 540, 620);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#D8CA82'; ctx.font = '700 78px Arial'; ctx.textAlign = 'center';
  ctx.fillText(code,540,1020);
  ctx.fillStyle = '#98948a'; ctx.font = '26px Arial'; ctx.fillText('Code ami · scanne le QR ou entre le code',540,1070);
  ctx.fillStyle = '#d8d2c2'; ctx.font = '30px Arial'; ctx.fillText('Marchez. Progressez. Gagnez.',540,1190);
  ctx.textAlign = 'left';
  // share
  const blob: Blob = await new Promise((res, rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('canvas')), 'image/jpeg', 0.92));
  const file = new File([blob], `elywalk-qr-${code}.jpg`, { type: 'image/jpeg' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files:[file] }))) {
    try { await navigator.share({ title: 'Mon code ElyWalk', text: `Rejoins-moi sur ElyWalk avec le code ${code}`, files:[file] }); return 'shared'; } catch(e){ if(/cancel|abort/i.test((e as Error).message||'')) return 'shared'; }
  }
  const url2 = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url2; a.download=`elywalk-qr-${code}.jpg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url2),1500);
  return 'downloaded';
}
function loadImage(src:string): Promise<HTMLImageElement> {
  return new Promise((res,rej)=>{
    const img=new Image(); img.crossOrigin='anonymous';
    img.onload=()=>res(img); img.onerror=rej; img.src=src;
  });
}

export function QRFallbackCanvas({ code, name }: { code:string; name:string }){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!ref.current) return;
    const canvas=ref.current; const ctx=canvas.getContext('2d')!;
    canvas.width=240; canvas.height=240;
    ctx.fillStyle='#111'; ctx.fillRect(0,0,240,240);
    ctx.fillStyle='#D8CA82'; ctx.font='700 36px Arial'; ctx.textAlign='center';
    ctx.fillText(code,120,130);
    ctx.fillStyle='#98948a'; ctx.font='14px Arial'; ctx.fillText(name,120,160);
    ctx.textAlign='left';
  },[code,name]);
  return <canvas ref={ref} width={240} height={240} style={{borderRadius:12, border:'1px solid var(--gold-border)'}} />;
}
