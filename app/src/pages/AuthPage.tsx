import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { PRIVACY_POLICY_URL } from '../lib/constants';
import {
  registerWithEmail,
  loginWithEmail,
  loginWithGoogle,
  resetPassword,
  frAuthError,
} from '../lib/auth-service';

type Mode = 'login' | 'register';
type Action = 'email' | 'google' | 'reset';
type FieldErrors = Partial<Record<'name' | 'email' | 'password', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Longueur minimale exigée à l'inscription : à aligner sur la règle du service d'authentification.
const MIN_PASSWORD_LENGTH = 6;

export default function AuthPageV2() {
  const { setPendingReferralCode, setPendingDisplayName } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [action, setAction] = useState<Action | null>(null);
  const busy = action !== null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');
  const [referralOpen, setReferralOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const criteria = [
    { ok: password.length >= 8, label: '8 caractères' },
    { ok: /[a-z]/.test(password) && /[A-Z]/.test(password), label: 'une majuscule et une minuscule' },
    { ok: /\d/.test(password), label: 'un chiffre' },
    { ok: /[^A-Za-z0-9]/.test(password), label: 'un caractère spécial' },
  ];
  const passwordScore = criteria.filter((c) => c.ok).length;
  const strengthLabel = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort'][passwordScore];
  const missingCriteria = criteria.filter((c) => !c.ok).map((c) => c.label);

  const run = async (kind: Action, fn: () => Promise<void>) => {
    setAction(kind);
    try {
      await fn();
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setAction(null);
    }
  };

  const clearError = (field: keyof FieldErrors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
  };

  /** Erreur posée sous le champ, focus sur le premier champ en défaut, puis message en haut d'écran. */
  const failOn = (next: FieldErrors) => {
    setErrors(next);
    const first = (['name', 'email', 'password'] as const).find((field) => next[field]);
    if (!first) return;
    document.getElementById(`auth-${first}`)?.focus();
    throw new Error(next[first]);
  };

  const submitEmail = () =>
    run('email', async () => {
      const next: FieldErrors = {};
      if (mode === 'register' && !name.trim()) next.name = 'Entrez votre nom.';
      if (!EMAIL_RE.test(email.trim())) next.email = 'Saisissez une adresse e-mail valide.';
      if (!password) next.password = 'Saisissez votre mot de passe.';
      else if (mode === 'register' && password.length < MIN_PASSWORD_LENGTH) {
        next.password = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
      }
      failOn(next);
      if (mode === 'register') {
        setPendingReferralCode(referral.trim() || null);
        setPendingDisplayName(name.trim());
        await registerWithEmail(email.trim(), password, name.trim());
      } else {
        await loginWithEmail(email.trim(), password);
      }
    });

  const submitGoogle = () =>
    run('google', async () => {
      setPendingReferralCode(referral.trim() || null);
      await loginWithGoogle();
    });

  const forgotPassword = () =>
    run('reset', async () => {
      if (!email.includes('@')) failOn({ email: 'Saisissez d’abord votre adresse e-mail.' });
      setErrors({});
      await resetPassword(email);
      toast('E-mail de réinitialisation envoyé.', 'success');
    });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void submitEmail();
  };

  const submitLabel =
    action === 'email'
      ? mode === 'register' ? 'Création du compte…' : 'Connexion…'
      : mode === 'register' ? "S'inscrire" : 'Se connecter';

  return (
    // Le formulaire porte lui-même `auth-screen` : la mise en page d'origine est inchangée.
    <form className="auth-screen" onSubmit={onSubmit} noValidate data-testid="auth-form">
      <img src="/deco-1.webp" className="auth-deco-top" alt="" />
      <img src="/deco-2.webp" className="auth-deco-bottom" alt="" />
      <img src="/elywalk-logo.png" alt="ElyWalk" className="auth-logo" />
      <h1 className="auth-title">ELYWALK</h1>
      <p className="auth-sub">Marche. Gagne. Soutiens Elysium.</p>

      <div className="chip-row" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className={`chip ${mode === 'login' ? 'chip-active' : ''}`}
          onClick={() => switchMode('login')}
          aria-pressed={mode === 'login'}
          data-testid="auth-mode-login"
        >
          Connexion
        </button>
        <button
          type="button"
          className={`chip ${mode === 'register' ? 'chip-active' : ''}`}
          onClick={() => switchMode('register')}
          aria-pressed={mode === 'register'}
          data-testid="auth-mode-register"
        >
          Inscription
        </button>
      </div>

      <button type="button" className="btn btn-outline" onClick={submitGoogle} disabled={busy} data-testid="auth-google-button">
        <GoogleG /> {action === 'google' ? 'Connexion à Google…' : 'Continuer avec Google'}
      </button>
      <div className="divider">ou</div>

      {mode === 'register' && (
        <div className="field">
          <label htmlFor="auth-name">Nom / Pseudo</label>
          <input
            id="auth-name"
            className="input"
            value={name}
            onChange={(e) => { setName(e.target.value); clearError('name'); }}
            placeholder="Votre pseudo"
            autoComplete="nickname"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'auth-name-error' : undefined}
            data-testid="auth-name-input"
          />
          {errors.name && <small id="auth-name-error" className="field-error" role="alert" data-testid="auth-name-error">{errors.name}</small>}
        </div>
      )}
      <div className="field">
        <label htmlFor="auth-email">Adresse e-mail</label>
        <input
          id="auth-email"
          className="input"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
          placeholder="vous@exemple.com"
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'auth-email-error' : undefined}
          data-testid="auth-email-input"
        />
        {errors.email && <small id="auth-email-error" className="field-error" role="alert" data-testid="auth-email-error">{errors.email}</small>}
      </div>
      <div className="field">
        <label htmlFor="auth-password">Mot de passe</label>
        <div className="password-field">
          <input
            id="auth-password"
            className="input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearError('password'); }}
            placeholder="••••••••"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'auth-password-error' : undefined}
            data-testid="auth-password-input"
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            aria-pressed={showPassword}
            data-testid="auth-password-toggle"
          >
            {showPassword ? 'Masquer' : 'Afficher'}
          </button>
        </div>
        {errors.password && <small id="auth-password-error" className="field-error" role="alert" data-testid="auth-password-error">{errors.password}</small>}
        {mode === 'register' && password && (
          <>
            <div className={`password-strength strength-${passwordScore}`} data-testid="auth-password-strength">
              <span style={{ width: `${Math.max(15, passwordScore * 25)}%` }} />Force : {strengthLabel}
            </div>
            {missingCriteria.length > 0 && (
              <small className="field-help" aria-live="polite" data-testid="auth-password-criteria">
                Pour le renforcer, ajoutez : {missingCriteria.join(', ')}.
              </small>
            )}
          </>
        )}
        {mode === 'login' && (
          <button type="button" className="text-button" onClick={forgotPassword} disabled={busy} data-testid="forgot-password-button">
            {action === 'reset' ? 'Envoi de l’e-mail…' : 'Mot de passe oublié ?'}
          </button>
        )}
      </div>

      {referralOpen || referral ? (
        <div className="field" id="auth-referral-field">
          <label htmlFor="auth-referral">Code de parrainage (optionnel)</label>
          <input
            id="auth-referral"
            className="input"
            value={referral}
            onChange={(e) => setReferral(e.target.value.toUpperCase())}
            placeholder="Ex. A3F7K9"
            autoCapitalize="characters"
            autoComplete="off"
            autoFocus={referralOpen && !referral}
            data-testid="auth-referral-input"
          />
          {mode === 'login' && <small className="field-help">Utilisé si Google crée un nouveau compte.</small>}
        </div>
      ) : (
        <button
          type="button"
          className="text-button"
          onClick={() => setReferralOpen(true)}
          aria-expanded={false}
          data-testid="auth-referral-toggle"
        >
          J’ai un code de parrainage
        </button>
      )}

      <button type="submit" className="btn btn-gold" disabled={busy} aria-busy={action === 'email'} data-testid="auth-submit-button">
        {submitLabel}
      </button>
      {mode === 'register' && (
        <p className="legal-consent">
          En créant un compte, vous acceptez les <a href="/legal/terms">CGU</a> et la{' '}
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">politique de confidentialité</a>.
        </p>
      )}
    </form>
  );
}

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 5.04c1.72 0 3.26.59 4.47 1.74l3.32-3.32C17.76 1.55 15.1.5 12 .5 7.42.5 3.44 3.1 1.46 6.9l3.87 3c.95-2.83 3.6-4.86 6.67-4.86Z" />
      <path fill="#4285F4" d="M23.5 12.27c0-.94-.08-1.62-.26-2.33H12v4.44h6.58c-.13 1.1-.85 2.76-2.44 3.87l3.78 2.93c2.26-2.09 3.58-5.17 3.58-8.91Z" />
      <path fill="#FBBC05" d="M5.34 14.1a7.06 7.06 0 0 1-.38-2.28c0-.79.14-1.56.36-2.28l-3.86-3A11.86 11.86 0 0 0 .18 11.82c0 1.9.46 3.7 1.28 5.29l3.88-3.01Z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.02 7.6-2.78l-3.78-2.93c-1.01.7-2.36 1.2-3.82 1.2-3.07 0-5.72-2.03-6.66-4.85l-3.87 3C3.44 20.9 7.42 23.5 12 23.5Z" />
    </svg>
  );
}
