import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LocaleContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import ConfirmSheet from '../components/ConfirmSheet';
import BlockedAccounts from '../components/BlockedAccounts';
import NotificationBell from '../components/NotificationBell';
import AppearanceSection from '../components/settings/AppearanceSection';
import LanguageSection from '../components/settings/LanguageSection';
import NotificationsSection from '../components/settings/NotificationsSection';
import PaymentSection from '../components/settings/PaymentSection';
import ActivityPrivacySection from '../components/settings/ActivityPrivacySection';
import {
  changeEmail,
  changePassword,
  deleteAuthAccount,
  frAuthError,
  logout,
  reauthenticateAccount,
} from '../lib/auth-service';
import {
  deleteAccountData,
  exportAccountData,
  updateUserFields,
} from '../lib/db';
import { deleteAvatar } from '../lib/avatar';
import { openAdPrivacyOptions } from '../lib/ads';
import { exportFilename, findResidualData } from '../lib/account';
import { shareJsonFile } from '../lib/export';
import { ACCOUNT_DELETION_URL, DATA_DELETION_URL } from '../lib/constants';
import { APP_VERSION_LABEL } from '../lib/version';

/**
 * Réglages (D07).
 *
 * Destination unique pour « comment l'application se comporte » — organisée
 * par objectif utilisateur, pas par implémentation :
 *  1. Notifications (rappels de marche, alertes sociales et de rencontre,
 *     push) ;
 *  2. Affichage et langue ;
 *  3. Compte (sécurité, e-mail, données RGPD, déconnexion) ;
 *  4. Confidentialité (fil d'activité, comptes bloqués, annonces) ;
 *  5. Paiement.
 * Aucun réglage n'a été supprimé par rapport au profil d'origine.
 */
export default function SettingsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [busy, setBusy] = useState(false);
  const [exportStep, setExportStep] = useState('');

  const [securityOpen, setSecurityOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailPassword, setEmailPassword] = useState('');
  const [nextEmail, setNextEmail] = useState('');

  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!profile) return null;

  const onChangePassword = async () => {
    setBusy(true);
    try {
      await changePassword(currentPassword, nextPassword);
      toast('Mot de passe modifié.', 'success');
      setSecurityOpen(false);
      setCurrentPassword('');
      setNextPassword('');
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onChangeEmail = async () => {
    setBusy(true);
    try {
      await changeEmail(emailPassword, nextEmail);
      await updateUserFields(profile.uid, { email: nextEmail.trim() });
      toast('Adresse e-mail mise à jour.', 'success');
      setEmailOpen(false);
      setEmailPassword('');
      setNextEmail('');
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    try {
      await logout();
    } catch (e) {
      toast(frAuthError(e), 'error');
    }
  };

  const onExport = async () => {
    setBusy(true);
    setExportStep('Préparation de l’export…');
    try {
      const data = await exportAccountData(profile.uid);
      const warnings = (data.warnings as string[] | undefined) || [];
      setExportStep('Génération du fichier…');
      await shareJsonFile(JSON.stringify(data, null, 2), exportFilename(profile.uid), 'Mes données ElyWalk');
      toast(
        warnings.length
          ? `Export terminé avec ${warnings.length} partie(s) incomplète(s).`
          : 'Export téléchargé sur votre appareil.',
        warnings.length ? 'error' : 'success',
      );
    } catch (e) {
      toast((e as Error).message || 'Export impossible.', 'error');
    } finally {
      setBusy(false);
      setExportStep('');
    }
  };

  /**
   * Suppression du compte (F03).
   *
   * L'ordre compte : on réauthentifie d'abord (Firebase exige une connexion
   * récente), on efface ensuite les données, et seulement à la fin le compte
   * d'authentification. Si l'effacement s'interrompt, le compte reste donc
   * utilisable pour reprendre la suppression — l'inverse laisserait des données
   * orphelines définitivement inaccessibles.
   */
  const onDelete = async (typed: string) => {
    const value = typed.trim();
    setBusy(true);
    try {
      setExportStep('Vérification de votre identité…');
      const password = value && value !== 'SUPPRIMER' ? value : undefined;
      // Comptes Google : réauthentification par popup si nécessaire.
      if (password) await reauthenticateAccount(password);
      else await reauthenticateAccount();
      setExportStep('Suppression de vos sorties…');
      await deleteAvatar(profile.uid);
      await deleteAccountData(profile.uid, (step) => setExportStep(`${step}…`));
      setExportStep('Vérification finale…');
      const residues = await findResidualData(profile.uid);
      if (residues.length) {
        toast(
          `Certaines données (${residues.join(', ')}) seront purgées côté serveur. Vérifiez régulièrement votre compte.`,
          'error',
        );
      }
      await deleteAuthAccount();
    } catch (e) {
      toast(frAuthError(e), 'error');
    } finally {
      setBusy(false);
      setExportStep('');
      setDeleteOpen(false);
    }
  };

  return (
    <div className="screen" data-testid="settings-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">{t('settings.title')}</h1>
          <div className="screen-sub">{t('settings.subtitle')}</div>
        </div>
        <div className="header-actions">
          <NotificationBell />
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/profile')} data-testid="settings-back">
            Retour
          </button>
        </div>
      </div>

      {busy && exportStep ? (
        <p className="muted-xs" role="status" aria-live="polite" data-testid="account-progress">
          {exportStep}
        </p>
      ) : null}

      <NotificationsSection />

      <AppearanceSection />

      <LanguageSection />

      <div className="card" data-testid="settings-account">
        <div className="card-title">Compte & sécurité</div>
        <button className="btn btn-ghost" onClick={() => setSecurityOpen(true)} data-testid="change-password-button">
          Changer le mot de passe
        </button>
        <button className="btn btn-ghost" onClick={() => setEmailOpen(true)} data-testid="change-email-button">
          Changer l’adresse e-mail
        </button>
        <div className="section-gap" />
        <button className="btn btn-outline" onClick={onExport} disabled={busy} data-testid="export-account">
          Exporter toutes mes données (RGPD)
        </button>
        <p className="muted-xs" style={{ marginTop: 'var(--space-1)' }}>
          Fichier JSON complet : sorties et tracés GPS, pas quotidiens, transactions, messages, amis,
          parcours, défis, badges, retraits. Aucune limite de profondeur d’historique.
        </p>
        <div className="section-gap" />
        <a className="btn btn-outline" href={DATA_DELETION_URL} target="_blank" rel="noopener noreferrer">
          Supprimer une partie de mes données
        </a>
        <div className="section-gap" />
        <button className="btn btn-danger" onClick={() => setDeleteOpen(true)} disabled={busy} data-testid="delete-account">
          Supprimer définitivement mon compte
        </button>
        <p className="muted-xs" style={{ marginTop: 'var(--space-2)' }}>
          Procédure détaillée, données supprimées et durées de conservation :{' '}
          <a href={ACCOUNT_DELETION_URL} target="_blank" rel="noopener noreferrer">{ACCOUNT_DELETION_URL}</a>
        </p>
        <div className="section-gap" />
        <button className="btn btn-danger" onClick={() => setLogoutOpen(true)} data-testid="logout-button">
          Se déconnecter
        </button>
      </div>

      <ActivityPrivacySection />

      <BlockedAccounts />

      <div className="card" data-testid="settings-ads">
        <div className="card-title">Confidentialité des annonces</div>
        <p className="card-help">
          Choisissez les partenaires publicitaires autorisés à utiliser vos données. Ce choix est
          conservé sur cet appareil et peut être modifié à tout moment.
        </p>
        <button className="btn btn-outline" onClick={() => openAdPrivacyOptions()}>
          Confidentialité des annonces (LevelPlay · Meta)
        </button>
      </div>

      <PaymentSection />

      <div className="card">
        <div className="card-title">À propos</div>
        <div className="legal-links">
          <a href="/legal/terms">CGU</a> · <a href="/legal/privacy">Confidentialité</a> ·{' '}
          <a href="/legal/notices">Mentions légales</a> ·{' '}
          <a href="mailto:contact@elysium-esport.fr?subject=Feedback%20ElyWalk">Donner mon avis</a> ·{' '}
          <button className="text-button inline-link" onClick={() => navigate('/whats-new')}>Nouveautés</button> ·{' '}
          <button className="text-button inline-link" onClick={() => navigate('/diagnostics')} data-testid="diagnostics-link">
            Diagnostic
          </button>
          <br />
          {APP_VERSION_LABEL}
        </div>
      </div>

      <Sheet open={securityOpen} onClose={() => setSecurityOpen(false)} title="Changer le mot de passe" testId="change-password-sheet">
        <div className="field">
          <label htmlFor="current-password">Mot de passe actuel</label>
          <input
            id="current-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="next-password">Nouveau mot de passe</label>
          <input
            id="next-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-gold" onClick={onChangePassword} disabled={busy || nextPassword.length < 6}>
          Enregistrer
        </button>
      </Sheet>

      <Sheet open={emailOpen} onClose={() => setEmailOpen(false)} title="Changer l’adresse e-mail" testId="change-email-sheet">
        <p className="onboarding-copy">
          Pour votre sécurité, confirmez votre mot de passe actuel puis saisissez la nouvelle adresse.
        </p>
        <div className="field">
          <label htmlFor="email-password">Mot de passe actuel</label>
          <input
            id="email-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
            data-testid="email-password-input"
          />
        </div>
        <div className="field">
          <label htmlFor="new-email">Nouvelle adresse e-mail</label>
          <input
            id="new-email"
            className="input"
            type="email"
            autoComplete="email"
            value={nextEmail}
            onChange={(e) => setNextEmail(e.target.value)}
            placeholder="vous@exemple.com"
            data-testid="new-email-input"
          />
        </div>
        <button
          className="btn btn-gold"
          onClick={onChangeEmail}
          disabled={busy || emailPassword.length < 1 || !nextEmail.includes('@')}
          data-testid="save-email-button"
        >
          Enregistrer
        </button>
      </Sheet>

      <ConfirmSheet
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Se déconnecter ?"
        consequences={[
          'Vous devrez vous reconnecter pour retrouver votre profil.',
          'Vos pas continuent d’être comptés sur cet appareil.',
          'Aucune donnée n’est supprimée.',
        ]}
        confirmLabel="Se déconnecter"
        onConfirm={onLogout}
        testId="logout-sheet"
      />

      <ConfirmSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Supprimer définitivement votre compte"
        danger
        consequences={[
          'Toutes vos sorties GPS et tracés sont effacés.',
          'Pas quotidiens, transactions, messages, amis, parcours, défis et badges sont supprimés.',
          'Cette action est irréversible : aucune restauration n’est possible.',
        ]}
        textField={{
          label: 'Saisissez SUPPRIMER (ou votre mot de passe) pour confirmer',
          placeholder: 'SUPPRIMER',
          required: true,
        }}
        confirmLabel="Supprimer mon compte"
        busy={busy}
        onConfirm={onDelete}
        testId="delete-account-sheet"
      />
    </div>
  );
}
