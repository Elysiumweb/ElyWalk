import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSharedActivityBySession, type SharedActivitySummary } from '../lib/db';
import SharedActivityCard from '../components/SharedActivityCard';
import SharedActivityMap from '../components/SharedActivityMap';
import { PLAY_STORE_URL } from '../lib/constants';
import { fmtDuration } from '../lib/activity';

/**
 * Page **publique** d'une sortie partagée (A7) — `/s/:sessionId?t=<jeton>`.
 *
 * Constat : le lien était généré et la règle Firestore autorisait la lecture
 * anonyme, mais rien ne lisait ce document hors connexion. Un destinataire
 * ouvrait donc un écran d'authentification.
 *
 * Cette page :
 *  - s'ouvre **sans compte** (rendue avant la garde d'authentification) ;
 *  - affiche le résumé partagé : titre, auteur, date, distance, durée, pas et
 *    un aperçu de zone sur une carte ;
 *  - met à jour le titre du document et les balises OpenGraph (`og:title`,
 *    `og:description`, `og:image`) pour que les aperçus de lien soient lisibles
 *    (WhatsApp, SMS, Telegram lisent ces balises quand ils exécutent la page ;
 *    pour un aperçu garanti sans JavaScript, le Worker expose la même page en
 *    HTML rendu côté serveur — voir `worker/src/index.ts`, `/s/:id`) ;
 *  - propose « Voir dans ElyWalk » et « Installer ElyWalk » ;
 *  - explique clairement un lien révoqué ou expiré.
 */

const DEFAULT_TITLE = 'ElyWalk · Sortie partagée';

function upsertMeta(attr: 'property' | 'name', key: string, content: string): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const selector = `meta[${attr}="${key}"]`;
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) {
    const previous = existing.getAttribute('content');
    existing.setAttribute('content', content);
    return () => {
      if (previous == null) existing.removeAttribute('content');
      else existing.setAttribute('content', previous);
    };
  }
  const element = document.createElement('meta');
  element.setAttribute(attr, key);
  element.setAttribute('content', content);
  document.head.appendChild(element);
  return () => element.remove();
}

export default function SharedActivityPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = params.get('t');
  const [summary, setSummary] = useState<SharedActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSharedActivityBySession(sessionId || '', token)
      .then((value) => {
        if (cancelled) return;
        setSummary(value);
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger cette sortie. Vérifiez votre connexion.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, token]);

  // Titre + OpenGraph : l'aperçu du lien dans une messagerie reprend ces
  // valeurs au lieu d'un générique « ElyWalk ».
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previousTitle = document.title;
    if (!summary) {
      document.title = DEFAULT_TITLE;
      return () => { document.title = previousTitle; };
    }
    const distance = summary.distanceM < 1000
      ? `${Math.round(summary.distanceM)} m`
      : `${(summary.distanceM / 1000).toFixed(2).replace('.', ',')} km`;
    document.title = `${summary.title} · ${distance} · ElyWalk`;
    const description = `${summary.ownerName ? `${summary.ownerName} a` : 'Une'} ${summary.type === 'run' ? 'couru' : 'marché'} ${distance} en ${fmtDuration(summary.durationSec)} avec ElyWalk.`;
    const cleanups = [
      upsertMeta('property', 'og:title', `${summary.title} · ElyWalk`),
      upsertMeta('property', 'og:description', description),
      upsertMeta('property', 'og:type', 'article'),
      upsertMeta('name', 'twitter:card', 'summary'),
      upsertMeta('name', 'description', description),
      upsertMeta('property', 'og:image', new URL('/elywalk-logo.png', window.location.origin).toString()),
    ];
    return () => {
      document.title = previousTitle;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [summary]);

  const center = useMemo(() => {
    if (!summary || summary.centerLat == null || summary.centerLng == null) return null;
    return { lat: summary.centerLat, lng: summary.centerLng };
  }, [summary?.centerLat, summary?.centerLng]);

  const openInApp = () => {
    if (!summary) return;
    if (user) navigate(`/activity/${summary.sessionId}?t=${encodeURIComponent(summary.token)}`);
    else navigate('/');
  };

  return (
    <div className="public-share-screen" data-testid="shared-activity-page">
      <header className="public-share-header">
        <img src="/elywalk-logo.png" alt="" width={40} height={40} />
        <div>
          <strong>ElyWalk</strong>
          <span>Marchez. Progressez. Gagnez.</span>
        </div>
      </header>

      {loading && (
        <div className="card" data-testid="shared-activity-loading">
          <div className="empty-state">
            <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> Chargement de la sortie…
          </div>
        </div>
      )}

      {!loading && !summary && (
        <div className="card" data-testid="shared-activity-invalid">
          <div className="card-title">Ce lien n’est plus disponible</div>
          <p className="card-help">
            {error || 'Le partage a été révoqué par son auteur, ou l’adresse est incomplète.'}
          </p>
          <p className="card-help">
            Demandez un nouveau lien à votre ami, ou découvrez ElyWalk : vos pas deviennent des
            ElyCoins.
          </p>
          <div className="route-actions">
            <a className="btn btn-gold" href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
              Installer ElyWalk
            </a>
            <button type="button" className="btn btn-outline" onClick={() => navigate('/')}>
              Ouvrir ElyWalk
            </button>
          </div>
        </div>
      )}

      {summary && (
        <>
          <SharedActivityCard
            activity={{
              title: summary.title,
              ownerName: summary.ownerName,
              type: summary.type,
              startedAt: summary.startedAt,
              durationSec: summary.durationSec,
              distanceM: summary.distanceM,
              calories: summary.calories,
              steps: summary.steps,
              caption: summary.caption,
            }}
          >
            {center && (
              <SharedActivityMap center={center} radiusM={summary.radiusM} />
            )}
          </SharedActivityCard>

          {/* Ce que le lien ne montre pas : la confiance du destinataire. */}
          <p className="public-share-note" data-testid="shared-activity-privacy">
            Ce partage contient le résumé de la sortie (titre, date, distance, durée) et une zone
            approximative. Le tracé GPS détaillé et la note privée ne sont jamais transmis.
          </p>

          <div className="route-actions public-share-actions">
            <button type="button" className="btn btn-gold" onClick={openInApp} data-testid="shared-activity-open">
              Voir dans ElyWalk
            </button>
            <a className="btn btn-outline" href={PLAY_STORE_URL} target="_blank" rel="noreferrer" data-testid="shared-activity-install">
              Installer l’application
            </a>
          </div>
        </>
      )}
    </div>
  );
}
