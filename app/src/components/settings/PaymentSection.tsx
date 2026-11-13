import { useState } from 'react';
import Sheet from '../Sheet';
import { useToast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import { updateUserFields } from '../../lib/db';

/**
 * Réglages → Paiement (D07) : destination de réception des retraits.
 * Extrait du profil pour que les réglages soient rangés par objectif
 * (« comment je suis payé ») et non par implémentation.
 */
export default function PaymentSection() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(profile?.paypalEmail || '');
  if (!profile) return null;

  const save = async () => {
    setBusy(true);
    try {
      if (!email.includes('@')) throw new Error('E-mail PayPal invalide.');
      await updateUserFields(profile.uid, { paypalEmail: email.trim() });
      toast('E-mail PayPal enregistré.', 'success');
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="settings-payment">
      <div className="card-title">Paiement</div>
      <div className="list-row">
        <div className="row-main">
          <div className="row-title" style={{ fontSize: 14 }}>
            {profile.paypalEmail || 'Aucun e-mail PayPal'}
          </div>
          <div className="row-sub">Compte de réception des retraits</div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { setEmail(profile.paypalEmail || ''); setOpen(true); }}
          data-testid="edit-paypal-button"
        >
          Modifier
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="E-mail PayPal" testId="paypal-email-sheet">
        <div className="field">
          <label htmlFor="paypal-email">E-mail du compte PayPal</label>
          <input
            id="paypal-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@paypal.com"
            data-testid="profile-paypal-input"
          />
        </div>
        <button className="btn btn-gold" onClick={save} disabled={busy} data-testid="save-paypal-button">
          {busy ? '…' : 'Enregistrer'}
        </button>
      </Sheet>
    </div>
  );
}
