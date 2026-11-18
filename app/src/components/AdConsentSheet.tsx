import { useEffect, useState } from 'react';
import Sheet from './Sheet';
import {
  needsConsentPrompt,
  onAdPrivacyOptionsRequested,
  setAdConsent,
  useAdConsent,
} from '../lib/adConsent';
import { PRIVACY_POLICY_URL } from '../lib/constants';

/**
 * Écran de consentement publicitaire (RGPD) — Unity LevelPlay (médiation),
 * avec Meta Audience Network parmi les réseaux en in-app bidding.
 *
 * S'affiche au premier lancement tant qu'aucun choix n'a été exprimé (aucune
 * annonce n'est demandée d'ici là), puis reste accessible depuis
 * Profil → « Confidentialité des annonces » pour changer d'avis à tout moment.
 */
export default function AdConsentSheet() {
  const { consent, ready } = useAdConsent();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Première ouverture : proposition spontanée si aucun choix (uniquement une
  // fois le stockage lu, pour ne pas réafficher l'écran aux utilisateurs ayant
  // déjà consenti).
  useEffect(() => {
    if (ready && needsConsentPrompt(consent)) setOpen(true);
  }, [consent, ready]);

  // Réouverture à la demande (Profil → Confidentialité des annonces).
  useEffect(() => onAdPrivacyOptionsRequested(() => setOpen(true)), []);

  const choose = async (value: 'granted' | 'refused') => {
    setBusy(true);
    try {
      await setAdConsent(value);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Confidentialité des annonces"
      testId="ad-consent-sheet"
    >
      <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
        ElyWalk est financé par la publicité. Les annonces sont diffusées par <strong>Unity LevelPlay</strong>,
        notre plateforme de médiation, à laquelle participent des réseaux partenaires dont{' '}
        <strong>Meta Audience Network</strong>.
        Nous ne transmettons <strong>jamais</strong> vos pas, vos sorties ou vos données de santé :
        seuls l’identifiant publicitaire de votre appareil et des données techniques sont utilisés.
      </p>
      <p
        style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}
        data-testid="ad-consent-installed-apps"
      >
        Pour éviter de vous montrer la publicité d’une application que vous avez déjà, le SDK publicitaire
        consulte aussi la <strong>liste des applications installées</strong> sur votre appareil — y compris
        si vous choisissez les annonces non personnalisées. Android filtre cette liste et ElyWalk ne
        demande aucune permission d’accès global. Détail au § 4.1 de la{' '}
        <a href={`${PRIVACY_POLICY_URL}#applis-installees`} target="_blank" rel="noreferrer">
          politique de confidentialité
        </a>.
      </p>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
        Vous pouvez choisir des annonces personnalisées (plus rémunératrices pour l’application)
        ou non personnalisées. Ce choix est révocable à tout moment depuis votre profil.
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-gold"
          disabled={busy}
          onClick={() => choose('granted')}
          data-testid="ad-consent-personalized"
        >
          Accepter les annonces personnalisées
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => choose('refused')}
          data-testid="ad-consent-non-personalized"
        >
          Annonces non personnalisées uniquement
        </button>
        <a
          className="text-button"
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          style={{ textAlign: 'center' }}
        >
          Politique de confidentialité
        </a>
      </div>
    </Sheet>
  );
}
