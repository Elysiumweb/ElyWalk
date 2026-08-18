import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  registerWithEmail,
  loginWithEmail,
  loginWithGoogle,
  frAuthError,
} from '../lib/auth-service';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const { setPendingReferralCode, setPendingDisplayName } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = () =>
    run(async () => {
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Entrez votre nom.');
        setPendingReferralCode(referral.trim() || null);
        setPendingDisplayName(name.trim());
        await registerWithEmail(email.trim(), password, name.trim());
      } else {
        await loginWithEmail(email.trim(), password);
      }
    });

  const submitGoogle = () =>
    run(async () => {
      setPendingReferralCode(referral.trim() || null);
      await loginWithGoogle();
    });

  return (
    <div className="auth-screen">
      <img src="/deco-1.webp" className="auth-deco-top" alt="" />
      <img src="/deco-2.webp" className="auth-deco-bottom" alt="" />
      <img src="/elywalk-logo.png" alt="ElyWalk" className="auth-logo" />
      <h1 className="auth-title">ELYWALK</h1>
      <p className="auth-sub">Marche. Gagne. Soutiens Elysium.</p>

      <div className="chip-row" style={{ justifyContent: 'center' }}>
        <button
          className={`chip ${mode === 'login' ? 'chip-active' : ''}`}
          onClick={() => setMode('login')}
          data-testid="auth-mode-login"
        >
          Connexion
        </button>
        <button
          className={`chip ${mode === 'register' ? 'chip-active' : ''}`}
          onClick={() => setMode('register')}
          data-testid="auth-mode-register"
        >
          Inscription
        </button>
      </div>

      {mode === 'register' && (
        <div className="field">
          <label>Nom / Pseudo</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Votre pseudo"
            data-testid="auth-name-input"
          />
        </div>
      )}
      <div className="field">
        <label>Adresse e-mail</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@exemple.com"
          data-testid="auth-email-input"
        />
      </div>
      <div className="field">
        <label>Mot de passe</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          data-testid="auth-password-input"
        />
      </div>
      {mode === 'register' && (
        <div className="field">
          <label>Code de parrainage (optionnel)</label>
          <input
            className="input"
            value={referral}
            onChange={(e) => setReferral(e.target.value.toUpperCase())}
            placeholder="Ex. A3F7K9"
            data-testid="auth-referral-input"
          />
        </div>
      )}
      <button className="btn btn-gold" onClick={submitEmail} disabled={busy} data-testid="auth-submit-button">
        {busy ? '...' : mode === 'register' ? "S'inscrire" : 'Se connecter'}
      </button>

      <div className="divider">ou</div>
      <button className="btn btn-outline" onClick={submitGoogle} disabled={busy} data-testid="auth-google-button">
        <GoogleG /> Continuer avec Google
      </button>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24">
      <path fill="#EA4335" d="M12 5.04c1.72 0 3.26.59 4.47 1.74l3.32-3.32C17.76 1.55 15.1.5 12 .5 7.42.5 3.44 3.1 1.46 6.9l3.87 3c.95-2.83 3.6-4.86 6.67-4.86Z" />
      <path fill="#4285F4" d="M23.5 12.27c0-.94-.08-1.62-.26-2.33H12v4.44h6.58c-.13 1.1-.85 2.76-2.44 3.87l3.78 2.93c2.26-2.09 3.58-5.17 3.58-8.91Z" />
      <path fill="#FBBC05" d="M5.34 14.1a7.06 7.06 0 0 1-.38-2.28c0-.79.14-1.56.36-2.28l-3.86-3A11.86 11.86 0 0 0 .18 11.82c0 1.9.46 3.7 1.28 5.29l3.88-3.01Z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.02 7.6-2.78l-3.78-2.93c-1.01.7-2.36 1.2-3.82 1.2-3.07 0-5.72-2.03-6.66-4.85l-3.87 3C3.44 20.9 7.42 23.5 12 23.5Z" />
    </svg>
  );
}
