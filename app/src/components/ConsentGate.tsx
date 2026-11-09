import { useState } from 'react';
import { setConsent } from '../lib/ads';

/**
 * Écran de consentement publicitaire.
 *
 * <p>Meta n'est pas membre de l'IAB Europe : il n'y a pas de signal TCF à
 * relayer, et la régie Meta n'interroge pas de CMP. La loi
 * (RGPD/ePrivacy) impose donc de recueillir nous-mêmes le choix avant tout
 * chargement d'annonce : cet écran le fait, une fois par installation et
 * uniquement dans les zones qui l'exigent (EEE, Royaume-Uni, Suisse et pays
 * indéterminé).</p>
 *
 * <p>Les deux boutons sont de même poids visuel : un refus ne doit pas être
 * plus difficile à donner qu'un accord.</p>
 */
export default function ConsentGate({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const decide = async (granted: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await setConsent(granted);
    } finally {
      onDone();
    }
  };

  return (
    <div className="consent-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-card">
        <h2 id="consent-title" className="consent-title">
          Publicités et vie privée
        </h2>
        <p className="consent-text">
          ElyWalk est gratuite grâce à la publicité, fournie par <strong>Meta Audience Network</strong>.
          Pour vous montrer des annonces pertinentes, Meta peut utiliser votre identifiant publicitaire
          et des données d’usage.
        </p>
        <p className="consent-text">
          Vous pouvez refuser : l’application reste entièrement utilisable, mais les annonces ne seront
          pas affichées et les ElyCoins publicitaires ne seront plus disponibles.
        </p>
        <p className="consent-text consent-muted">
          Vous pourrez changer d’avis à tout moment depuis Profil → Modifier mes choix publicitaires.
          Voir la politique de confidentialité de Meta :{' '}
          <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer noopener">
            facebook.com/privacy/policy
          </a>
          .
        </p>
        <div className="consent-actions">
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => decide(true)}
            disabled={busy}
            data-testid="consent-accept"
          >
            Accepter
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => decide(false)}
            disabled={busy}
            data-testid="consent-refuse"
          >
            Refuser
          </button>
        </div>
      </div>
    </div>
  );
}
