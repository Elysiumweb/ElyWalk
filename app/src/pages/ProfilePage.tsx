import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import { logout, startPhoneLink, frAuthError, type PhoneSession } from '../lib/auth-service';
import { updateUserFields, setReferredBy, maybeCreateReferralClaim } from '../lib/db';
import { isPresidentUid } from '../lib/constants';
import { fmtCoins } from '../lib/coins';

export default function ProfilePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [session, setSession] = useState<PhoneSession | null>(null);
  const [busy, setBusy] = useState(false);

  const [referralOpen, setReferralOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const [paypalOpen, setPaypalOpen] = useState(false);
  const [paypalEmail, setPaypalEmail] = useState(profile?.paypalEmail || '');

  const isAdmin = isPresidentUid(profile?.uid);

  const sendSms = async () => {
    setBusy(true);
    try {
      if (!phone.trim().startsWith('+')) {
        throw new Error('Format international requis, ex. +33612345678');
      }
      const s = await startPhoneLink(phone.trim(), 'recaptcha-container-profile');
      setSession(s);
      toast('Code SMS envoyé.', 'success');
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmSms = async () => {
    if (!session || !profile) return;
    setBusy(true);
    try {
      await session.confirm(smsCode.trim());
      await updateUserFields(profile.uid, {
        phoneNumber: phone.trim(),
        phoneVerified: true,
      });
      await maybeCreateReferralClaim({ ...profile, phoneNumber: phone.trim(), phoneVerified: true });
      toast('Téléphone vérifié ✓', 'success');
      setPhoneOpen(false);
      setSession(null);
      setSmsCode('');
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveReferral = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const ok = await setReferredBy(profile.uid, referralCode);
      if (!ok) throw new Error('Code invalide ou parrain déjà défini.');
      toast('Parrain enregistré ! Vérifiez vos téléphones pour valider le bonus.', 'success');
      setReferralOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePaypal = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      if (!paypalEmail.includes('@')) throw new Error('E-mail PayPal invalide.');
      await updateUserFields(profile.uid, { paypalEmail: paypalEmail.trim() });
      toast('E-mail PayPal enregistré.', 'success');
      setPaypalOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    await logout();
  };

  if (!profile) return null;

  return (
    <div className="screen" data-testid="profile-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Profil</h1>
        </div>
      </div>

      <div className="gold-hero" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src="/deco-1.webp" className="hero-deco" alt="" />
        <div className="avatar" style={{ width: 58, height: 58, fontSize: 22 }}>
          {profile.displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="display" style={{ fontSize: 17 }} data-testid="profile-name">
            {profile.displayName}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{profile.email || profile.phoneNumber}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {isAdmin && (
              <span className="badge">👑 {profile.role === 'president' ? 'Président' : 'Co-Président'}</span>
            )}
            <span className="badge">{fmtCoins(profile.elycoins)} EC</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Téléphone</div>
        <div className="list-row">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 14 }}>
              {profile.phoneNumber || 'Aucun numéro'}
            </div>
            <div className="row-sub">Requis pour valider un parrainage</div>
          </div>
          {profile.phoneVerified ? (
            <span className="badge badge-success" data-testid="phone-verified-badge">Vérifié ✓</span>
          ) : (
            <button className="btn btn-gold btn-sm" onClick={() => setPhoneOpen(true)} data-testid="verify-phone-button">
              Vérifier
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Parrainage</div>
        <div className="list-row">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 14 }}>Mon code : {profile.referralCode}</div>
            <div className="row-sub">+10 EC par filleul (téléphones vérifiés des deux côtés)</div>
          </div>
        </div>
        {!profile.referredBy && (
          <button className="btn btn-outline" onClick={() => setReferralOpen(true)} data-testid="enter-referral-button">
            J’ai un code de parrainage
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-title">Paiement</div>
        <div className="list-row">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 14 }}>{profile.paypalEmail || 'Aucun e-mail PayPal'}</div>
            <div className="row-sub">Compte de réception des retraits</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setPaypalOpen(true)} data-testid="edit-paypal-button">
            Modifier
          </button>
        </div>
      </div>

      {isAdmin && (
        <button className="btn btn-gold" onClick={() => navigate('/admin')} data-testid="admin-button">
          👑 Administration Elysium
        </button>
      )}
      <div className="section-gap" />
      <button className="btn btn-danger" onClick={onLogout} data-testid="logout-button">
        Se déconnecter
      </button>

      <Sheet open={phoneOpen} onClose={() => setPhoneOpen(false)} title="Vérifier mon téléphone" testId="phone-sheet">
        {!session ? (
          <>
            <div className="field">
              <label>Numéro de téléphone</label>
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+33612345678"
                data-testid="profile-phone-input"
              />
            </div>
            <button className="btn btn-gold" onClick={sendSms} disabled={busy} data-testid="profile-send-sms-button">
              {busy ? '...' : 'Recevoir le code SMS'}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Code reçu par SMS</label>
              <input
                className="input"
                inputMode="numeric"
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value)}
                placeholder="123456"
                data-testid="profile-sms-code-input"
              />
            </div>
            <button className="btn btn-gold" onClick={confirmSms} disabled={busy} data-testid="profile-confirm-sms-button">
              {busy ? '...' : 'Valider'}
            </button>
          </>
        )}
        <div id="recaptcha-container-profile" />
      </Sheet>

      <Sheet open={referralOpen} onClose={() => setReferralOpen(false)} title="Code de parrainage" testId="referral-sheet">
        <div className="field">
          <label>Code de votre parrain</label>
          <input
            className="input"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="Ex. A3F7K9"
            data-testid="referral-code-input"
          />
        </div>
        <button className="btn btn-gold" onClick={saveReferral} disabled={busy} data-testid="save-referral-button">
          {busy ? '...' : 'Enregistrer'}
        </button>
      </Sheet>

      <Sheet open={paypalOpen} onClose={() => setPaypalOpen(false)} title="E-mail PayPal" testId="paypal-email-sheet">
        <div className="field">
          <label>E-mail du compte PayPal</label>
          <input
            className="input"
            type="email"
            value={paypalEmail}
            onChange={(e) => setPaypalEmail(e.target.value)}
            placeholder="vous@paypal.com"
            data-testid="profile-paypal-input"
          />
        </div>
        <button className="btn btn-gold" onClick={savePaypal} disabled={busy} data-testid="save-paypal-button">
          {busy ? '...' : 'Enregistrer'}
        </button>
      </Sheet>
    </div>
  );
}
