import { useNavigate } from 'react-router-dom';

/**
 * Écran 404 (A12.4).
 *
 * Avant : `*` renvoyait silencieusement vers l'accueil (`Navigate to="/"`).
 * Une URL mal recopiée, un lien de notification obsolète ou un parcours
 * supprimé aboutissait donc à un écran d'accueil sans explication, et
 * l'utilisateur croyait avoir perdu ses données. L'écran dit ce qui s'est
 * passé et propose les trois issues utiles.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="screen" data-testid="not-found-screen">
      <div className="card empty-state" style={{ marginTop: 48 }}>
        <div className="display" style={{ fontSize: 40, letterSpacing: '0.08em' }}>404</div>
        <strong>Cette page n’existe pas</strong>
        <p className="muted-text" style={{ maxWidth: 320, margin: '8px auto 0' }}>
          Le lien est peut-être incomplet, ou l’élément qu’il désignait a été supprimé. Vos données
          et vos ElyCoins ne sont pas concernées.
        </p>
        <div className="route-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button type="button" className="btn btn-gold" onClick={() => navigate('/')} data-testid="not-found-home">
            Retour à l’accueil
          </button>
          <button type="button" className="btn btn-outline" onClick={() => navigate(-1)} data-testid="not-found-back">
            Page précédente
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/history')}>
            Mon historique
          </button>
        </div>
      </div>
    </div>
  );
}
