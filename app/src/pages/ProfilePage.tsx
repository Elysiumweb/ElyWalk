import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import BadgeGrid, { BadgePreview } from '../components/BadgeGrid';
import QRCode, { shareFriendCode } from '../components/QRCode';
import LevelBadge from '../components/LevelBadge';
import { logout, updateAuthProfile, changePassword, changeEmail, deleteAuthAccount, reauthenticateAccount, frAuthError } from '../lib/auth-service';
import { updateUserFields, setReferredBy, exportAccountData, deleteAccountData, listUserBadges, watchUserBadges, getReferralDashboard, updateActivityPrivacy } from '../lib/db';
import { uploadAvatar, deleteAvatar } from '../lib/avatar';
import { getNotificationSettings, setReminderEnabled, setPushEnabled, type NotificationSettings } from '../lib/notifications';
import { ACCOUNT_DELETION_URL, DATA_DELETION_URL, BADGE_DEFINITIONS } from '../lib/constants';
import { openAdPrivacyOptions } from '../lib/ads';
import { isPresidentUid } from '../lib/constants';
import { fmtCoins, fmtNumber, formatDistance } from '../lib/coins';
import { APP_VERSION, BUILD_STAMP } from '../lib/version';
import { THEME_OPTIONS, useThemePreference } from '../lib/theme';
import type { UserBadge, BadgeDefinition } from '../lib/types';

export default function ProfilePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailPassword, setEmailPassword] = useState('');
  const [nextEmail, setNextEmail] = useState('');

  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    getNotificationSettings().then(setNotifSettings).catch(() => undefined);
  }, []);

  const [referralOpen, setReferralOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const [paypalOpen, setPaypalOpen] = useState(false);
  const [paypalEmail, setPaypalEmail] = useState(profile?.paypalEmail || '');

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(profile?.displayName || '');
  const [editBio, setEditBio] = useState(profile?.bio || '');
  const [editPreview, setEditPreview] = useState<string | null>(null);
  const [editFile, setEditFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Badges
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [badgeSheet, setBadgeSheet] = useState<{ def: BadgeDefinition; badge?: UserBadge } | null>(null);
  useEffect(() => {
    if (!profile) return;
    const unsub = watchUserBadges(profile.uid, setBadges);
    return unsub;
  }, [profile?.uid]);

  // Referral dashboard
  const [referralData, setReferralData] = useState<{ total: number; active: number; earned: number; items: { uid: string; displayName: string; claimed: boolean; rejected?: boolean; createdAt: number; active?: boolean; totalSteps?: number }[] } | null>(null);
  useEffect(() => {
    if (!profile) return;
    getReferralDashboard(profile.uid).then(setReferralData).catch(()=>undefined);
  }, [profile?.uid]);

  const [qrOpen, setQrOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Réglage d'affichage (Système / Sombre / Contraste renforcé).
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();

  const isAdmin = isPresidentUid(profile?.uid);

  const saveReferral = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const ok = await setReferredBy(profile.uid, referralCode);
      if (!ok) throw new Error('Code invalide ou parrain déjà défini.');
      toast('Parrain enregistré ! Le bonus est vérifié automatiquement.', 'success');
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

  const openEdit = () => {
    setEditName(profile?.displayName || '');
    setEditBio(profile?.bio || '');
    setEditPreview(null);
    setEditFile(null);
    setEditOpen(true);
  };

  const onPickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Choisissez une image (JPG, PNG, WEBP…).', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Image trop lourde (8 Mo max).', 'error');
      return;
    }
    setEditFile(file);
    const url = URL.createObjectURL(file);
    setEditPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const saveProfile = async () => {
    if (!profile) return;
    const name = editName.trim();
    const bio = editBio.trim();
    if (name.length < 2) {
      toast('Le pseudo doit contenir au moins 2 caractères.', 'error');
      return;
    }
    if (name.length > 24) {
      toast('Le pseudo est limité à 24 caractères.', 'error');
      return;
    }
    if (bio.length > 160) {
      toast('La bio est limitée à 160 caractères.', 'error');
      return;
    }
    setBusy(true);
    try {
      const fields: Record<string, unknown> = { displayName: name, bio: bio || null };
      if (editFile) {
        fields.photoURL = await uploadAvatar(profile.uid, editFile);
      }
      await updateUserFields(profile.uid, fields as any);
      await updateAuthProfile({
        displayName: name,
        ...(fields.photoURL && String(fields.photoURL).startsWith('http') ? { photoURL: String(fields.photoURL) } : {}),
      }).catch(() => undefined);
      toast('Profil mis à jour.', 'success');
      setEditOpen(false);
      if (editPreview) URL.revokeObjectURL(editPreview);
      setEditPreview(null);
      setEditFile(null);
    } catch (e) {
      toast((e as Error).message || 'Impossible d’enregistrer le profil.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => { if (confirm('Voulez-vous vraiment vous déconnecter ?')) await logout(); };
  const onChangePassword = async () => { setBusy(true); try { await changePassword(currentPassword, nextPassword); toast('Mot de passe modifié.','success'); setSecurityOpen(false); } catch(e){toast(frAuthError(e),'error')} finally{setBusy(false)} };
  const onChangeEmail = async () => { if(!profile)return; setBusy(true); try { await changeEmail(emailPassword, nextEmail); await updateUserFields(profile.uid, { email: nextEmail.trim() }); toast('Adresse e-mail mise à jour.','success'); setEmailOpen(false); setEmailPassword(''); setNextEmail(''); } catch(e){toast(frAuthError(e),'error')} finally{setBusy(false)} };
  const onToggleReminder = async (v: boolean) => { await setReminderEnabled(v); setNotifSettings((s) => s ? { ...s, reminder: v } : s); };
  const onTogglePush = async (v: boolean) => { if(!profile)return; await setPushEnabled(profile.uid, v); setNotifSettings((s) => s ? { ...s, push: v } : s); };
  const onPrivacyOptions = async () => { openAdPrivacyOptions(); };
  const onExport = async () => { if(!profile)return; const data=await exportAccountData(profile.uid); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.download=`elywalk-export-${profile.uid}.json`; a.click(); URL.revokeObjectURL(a.href); };
  const onDelete = async () => { if(!profile||!confirm('Suppression définitive : vos données et votre compte seront effacés. Continuer ?'))return; const pwd=prompt('Pour confirmer, saisissez votre mot de passe (laissez vide pour Google)')||undefined; setBusy(true); try { if(pwd) await reauthenticateAccount(pwd); await deleteAvatar(profile.uid); await deleteAccountData(profile.uid); await deleteAuthAccount(); } catch(e){toast(frAuthError(e),'error')} finally{setBusy(false)} };
  const copyText = async (value: string, label: string) => { await navigator.clipboard.writeText(value); toast(`${label} copié !`, 'success'); };
  const onShare = async () => { if(!profile)return; const url=`${location.origin}/?ref=${profile.referralCode}`; const text=`Rejoins-moi sur ElyWalk avec le code ${profile.referralCode}`; if(navigator.share) await navigator.share({title:'ElyWalk',text,url}); else {await navigator.clipboard.writeText(`${text} ${url}`);toast('Lien copié !','success')} };
  const onShareQR = async () => {
    if(!profile) return;
    try {
      const res = await shareFriendCode(profile.referralCode, profile.displayName);
      toast(res==='shared'?'QR partagé !':'Image enregistrée.','success');
    } catch(e){ toast((e as Error).message,'error'); }
  };

  if (!profile) return null;

  const totalDistance = (profile.totalSteps * (profile.strideLengthCm||75))/100;

  return (
    <div className="screen" data-testid="profile-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Profil</h1>
        </div>
      </div>

      <div className="gold-hero profile-hero">
        <img src="/deco-1.webp" className="hero-deco" alt="" />
        <button
          type="button"
          className="avatar-edit"
          onClick={openEdit}
          data-testid="edit-avatar-button"
          aria-label="Modifier la photo de profil"
        >
          <Avatar name={profile.displayName} photoURL={profile.photoURL} size={58} />
          <span className="avatar-cam">
            <CamIcon />
          </span>
        </button>
        <div className="profile-hero-main">
          <div className="profile-name" data-testid="profile-name">
            {profile.displayName}
          </div>
          {profile.bio && <div className="profile-bio">{profile.bio}</div>}
          {!profile.bio && <div className="text-muted mt-1">Aucune bio · touche « Modifier » pour en ajouter</div>}
          {profile.email ? <button type="button" className="copy-value" onClick={() => copyText(profile.email!, 'E-mail')} title="Copier l’e-mail">{profile.email} <span aria-hidden="true">⧉</span></button> : <div className="text-muted-sm">Aucun e-mail</div>}
          <div className="badge-row">
            {isAdmin && (
              <span className="badge">👑 {profile.role === 'president' ? 'Président' : 'Co-Président'}</span>
            )}
            <span className="badge">{fmtCoins(profile.elycoins)} EC</span>
            <span className="badge">🔥 {profile.streak} j</span>
          </div>
        </div>
      </div>

      <LevelBadge totalSteps={profile.totalSteps} />

      <button className="btn btn-outline" onClick={openEdit} data-testid="edit-profile-button">
        Modifier mon profil
      </button>
      <div className="section-gap" />

      <div className="card" data-testid="badges-card">
        <div className="card-title">Badges · {badges.length}/{BADGE_DEFINITIONS.length}</div>
        <BadgeGrid badges={badges} onSelect={(def,b)=>setBadgeSheet({def,badge:b})} />
        {badges.length===0 && <p className="card-help mt-2">Validez vos pas, lancez une sortie GPS ou maintenez une série pour débloquer vos premiers trophées !</p>}
      </div>

      <div className="card">
        <div className="card-title">Statistiques</div>
        <div className="stat-grid-2">
          <div className="stat"><div className="stat-value">{fmtNumber(profile.totalSteps)}</div><div className="stat-label">pas cumulés</div></div>
          <div className="stat"><div className="stat-value">{formatDistance(totalDistance, profile.unitSystem || 'metric')}</div><div className="stat-label">distance totale</div></div>
          <div className="stat"><div className="stat-value">{profile.streak}</div><div className="stat-label">meilleure série</div></div>
          <div className="stat"><div className="stat-value">{fmtNumber(profile.totalCalories)}</div><div className="stat-label">kcal totales</div></div>
        </div>
        <div className="row-sub mt-2">Membre depuis {new Date(profile.createdAt).toLocaleDateString('fr-FR')}</div>
      </div>

      <div className="card">
        <div className="card-title">Parrainage</div>
        <button type="button" className="referral-code" onClick={() => copyText(profile.referralCode, 'Code')} aria-label={`Copier le code ${profile.referralCode}`}>
          <span>Mon code</span><strong>{profile.referralCode}</strong><small>Toucher pour copier · +10 EC par filleul</small>
        </button>
        <div className="two-col mt-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={onShare}>Partager le lien</button>
          <button type="button" className="btn btn-gold btn-sm" onClick={()=>setQrOpen(true)}>QR code</button>
        </div>
        {profile.referralRejected && (
          <div className="row-sub text-danger mt-1" data-testid="referral-rejected-note">
            ⚠️ Parrainage non éligible : même appareil ou même adresse IP
            détecté(e) entre votre parrain et vous.
          </div>
        )}
        {!profile.referredBy && (
          <button className="btn btn-outline" onClick={() => setReferralOpen(true)} data-testid="enter-referral-button">
            J’ai un code de parrainage
          </button>
        )}
      </div>

      <div className="card" data-testid="referral-dashboard">
        <div className="card-title">Tableau de parrainage</div>
        {referralData ? (
          <>
            <div className="stat-grid">
              <div className="stat"><div className="stat-value">{referralData.total}</div><div className="stat-label">filleuls</div></div>
              <div className="stat"><div className="stat-value">{referralData.active}</div><div className="stat-label">actifs*</div></div>
              <div className="stat"><div className="stat-value">+{referralData.earned} EC</div><div className="stat-label">gains</div></div>
            </div>
            <small className="card-help">* Actif = +1000 pas cumulés</small>
            {referralData.items.length>0 ? referralData.items.map(f=>(
              <div key={f.uid} className="list-row">
                <Avatar name={f.displayName} photoURL={null} size={36} />
                <div className="row-main">
                  <div className="row-title row-title-sm">{f.displayName}</div>
                  <div className="row-sub">{fmtNumber(f.totalSteps||0)} pas · {f.active?'actif':'inactif'}</div>
                </div>
                {f.rejected ? <span className="badge badge-danger">Refusé</span> : f.claimed ? <span className="badge badge-success">Éligible ✓</span> : <span className="badge badge-muted">En attente</span>}
              </div>
            )) : <div className="empty-state empty-state-compact">Aucun filleul pour l’instant — partagez votre code !</div>}
          </>
        ) : <div className="empty-state">Chargement...</div>}
      </div>

      <div className="card">
        <div className="card-title">Paiement</div>
        <div className="list-row">
          <div className="row-main">
            <div className="row-title">{profile.paypalEmail || 'Aucun e-mail PayPal'}</div>
            <div className="row-sub">Compte de réception des retraits</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setPaypalOpen(true)} data-testid="edit-paypal-button">
            Modifier
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Confidentialité du fil d’activité</div>
        <p className="card-help">Choisissez ce que vos amis voient dans leur fil.</p>
        <div className="list-row">
          <div className="row-main"><div className="row-title row-title-sm">Objectifs atteints</div><div className="row-sub">Quand vous validez 10k pas</div></div>
          <button className={`btn btn-sm ${profile.activityPrivacy?.shareGoals!==false?'btn-gold':'btn-ghost'}`} onClick={async()=>{
            const current = profile.activityPrivacy?.shareGoals !== false;
            await updateActivityPrivacy(profile.uid, { ...(profile.activityPrivacy||{}), shareGoals: !current });
            toast(!current?'Objectifs partagés':'Objectifs masqués','info');
          }}>{profile.activityPrivacy?.shareGoals===false?'Masqué':'Partagé'}</button>
        </div>
        <div className="list-row">
          <div className="row-main"><div className="row-title row-title-sm">Sorties GPS</div><div className="row-sub">Fin de sortie</div></div>
          <button className={`btn btn-sm ${profile.activityPrivacy?.shareActivities!==false?'btn-gold':'btn-ghost'}`} onClick={async()=>{
            const current = profile.activityPrivacy?.shareActivities !== false;
            await updateActivityPrivacy(profile.uid, { ...(profile.activityPrivacy||{}), shareActivities: !current });
            toast(!current?'Sorties partagées':'Sorties masquées','info');
          }}>{profile.activityPrivacy?.shareActivities===false?'Masqué':'Partagé'}</button>
        </div>
        <div className="list-row">
          <div className="row-main"><div className="row-title row-title-sm">Badges</div><div className="row-sub">Trophées débloqués</div></div>
          <button className={`btn btn-sm ${profile.activityPrivacy?.shareBadges!==false?'btn-gold':'btn-ghost'}`} onClick={async()=>{
            const current = profile.activityPrivacy?.shareBadges !== false;
            await updateActivityPrivacy(profile.uid, { ...(profile.activityPrivacy||{}), shareBadges: !current });
            toast(!current?'Badges partagés':'Badges masqués','info');
          }}>{profile.activityPrivacy?.shareBadges===false?'Masqué':'Partagé'}</button>
        </div>
        <div className="list-row">
          <div className="row-main"><div className="row-title row-title-sm">Défis</div><div className="row-sub">Victoires et challenges</div></div>
          <button className={`btn btn-sm ${profile.activityPrivacy?.shareChallenges!==false?'btn-gold':'btn-ghost'}`} onClick={async()=>{
            const current = profile.activityPrivacy?.shareChallenges !== false;
            await updateActivityPrivacy(profile.uid, { ...(profile.activityPrivacy||{}), shareChallenges: !current });
            toast(!current?'Défis partagés':'Défis masqués','info');
          }}>{profile.activityPrivacy?.shareChallenges===false?'Masqué':'Partagé'}</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Notifications</div>
        {notifSettings && (
          <>
            <div className="list-row">
              <div className="row-main">
                <div className="row-title">Rappel quotidien (20 h)</div>
                <div className="row-sub">Notification locale de validation des pas</div>
              </div>
              <button
                className={`btn btn-sm ${notifSettings.reminder ? 'btn-gold' : 'btn-ghost'}`}
                onClick={() => onToggleReminder(!notifSettings.reminder)}
                data-testid="toggle-reminder-button"
              >
                {notifSettings.reminder ? 'Activé' : 'Désactivé'}
              </button>
            </div>
            <div className="list-row">
              <div className="row-main">
                <div className="row-title">Notifications push</div>
                <div className="row-sub">Demandes d’amis, retraits et actualités</div>
              </div>
              <button
                className={`btn btn-sm ${notifSettings.push ? 'btn-gold' : 'btn-ghost'}`}
                onClick={() => onTogglePush(!notifSettings.push)}
                data-testid="toggle-push-button"
              >
                {notifSettings.push ? 'Activé' : 'Désactivé'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Réglage d'affichage : Système / Sombre / Contraste renforcé.
          Le choix est persisté et appliqué via data-theme sur <html>. */}
      <div className="card" data-testid="display-settings">
        <div className="card-title">Affichage</div>
        <p className="card-help mb-2">
          La charte noir &amp; or reste la référence. Choisissez un contraste plus élevé si
          vous lisez dehors ou avec une vue fatiguée.
        </p>
        <div className="theme-options" role="radiogroup" aria-label="Thème d’affichage">
          {THEME_OPTIONS.map((option) => {
            const selected = themePreference === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`theme-option ${selected ? 'theme-option-selected' : ''}`}
                onClick={() => { void setThemePreference(option.id); }}
                data-testid={`theme-option-${option.id}`}
              >
                <span className="theme-option-icon" aria-hidden="true">{option.icon}</span>
                <span className="theme-option-main">
                  <span className="theme-option-title">{option.label}</span>
                  <span className="theme-option-hint">{option.hint}</span>
                </span>
                <span className="theme-option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card"><div className="card-title">Compte & données</div>
        <button className="btn btn-ghost" onClick={()=>setSecurityOpen(true)}>Changer le mot de passe</button>
        <button className="btn btn-ghost" onClick={()=>setEmailOpen(true)} data-testid="change-email-button">Changer l’adresse e-mail</button><div className="section-gap" />
        <button className="btn btn-outline" onClick={onPrivacyOptions} data-testid="ad-privacy-button">Confidentialité des annonces (Chartboost · Meta)</button><div className="section-gap" />
        <button className="btn btn-outline" onClick={onExport}>Exporter mes données (RGPD)</button><div className="section-gap" />
        <a className="btn btn-outline" href={DATA_DELETION_URL} target="_blank" rel="noopener noreferrer">Supprimer une partie de mes données</a><div className="section-gap" />
        <button className="btn btn-danger" onClick={onDelete} disabled={busy}>Supprimer définitivement mon compte</button>
        <p className="text-muted mt-2">
          Procédure détaillée, données supprimées et durées de conservation :{' '}
          <a href={ACCOUNT_DELETION_URL} target="_blank" rel="noopener noreferrer">{ACCOUNT_DELETION_URL}</a>
        </p>
        <div className="legal-links"><a href="/legal/terms">CGU</a> · <a href="/legal/privacy">Confidentialité</a> · <a href="/legal/notices">Mentions légales</a> · <a href="mailto:contact@elysium-esport.fr?subject=Feedback%20ElyWalk">Donner mon avis</a> · <button className="text-button legal-inline-button" onClick={()=>navigate('/whats-new')}>Nouveautés</button><br/>
          {/* Version générée au build (package.json) : plus de chaîne en dur. */}
          <span data-testid="app-version" title={`Build ${BUILD_STAMP}`}>ElyWalk {APP_VERSION}</span>
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

      <Sheet open={securityOpen} onClose={()=>setSecurityOpen(false)} title="Changer le mot de passe"><div className="field"><label>Mot de passe actuel</label><input className="input" type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></div><div className="field"><label>Nouveau mot de passe</label><input className="input" type="password" value={nextPassword} onChange={e=>setNextPassword(e.target.value)}/></div><button className="btn btn-gold" onClick={onChangePassword} disabled={busy||nextPassword.length<6}>Enregistrer</button></Sheet>

      <Sheet open={emailOpen} onClose={()=>setEmailOpen(false)} title="Changer l’adresse e-mail" testId="change-email-sheet">
        <p className="onboarding-copy">Pour votre sécurité, confirmez votre mot de passe actuel puis saisissez la nouvelle adresse.</p>
        <div className="field"><label>Mot de passe actuel</label><input className="input" type="password" value={emailPassword} onChange={e=>setEmailPassword(e.target.value)} data-testid="email-password-input"/></div>
        <div className="field"><label>Nouvelle adresse e-mail</label><input className="input" type="email" value={nextEmail} onChange={e=>setNextEmail(e.target.value)} placeholder="vous@exemple.com" data-testid="new-email-input"/></div>
        <button className="btn btn-gold" onClick={onChangeEmail} disabled={busy||emailPassword.length<1||!nextEmail.includes('@')} data-testid="save-email-button">Enregistrer</button>
      </Sheet>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="Modifier mon profil" testId="edit-profile-sheet">
        <div className="profile-edit-photo">
          <button
            type="button"
            className="avatar-edit"
            onClick={() => fileRef.current?.click()}
            data-testid="pick-photo-button"
            aria-label="Choisir une photo"
          >
            <Avatar
              name={editName || profile.displayName}
              photoURL={editPreview || profile.photoURL}
              size={88}
            />
            <span className="avatar-cam">
              <CamIcon />
            </span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fileRef.current?.click()}
            data-testid="change-photo-button"
          >
            Changer la photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="profile-photo-input"
            onChange={(e) => onPickPhoto(e.target.files?.[0])}
          />
        </div>
        <div className="field">
          <label>Pseudo</label>
          <input
            className="input"
            value={editName}
            maxLength={24}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Votre pseudo"
            data-testid="edit-name-input"
          />
        </div>
        <div className="field">
          <label>Bio <span className="field-counter">{editBio.length}/160</span></label>
          <textarea
            className="input"
            value={editBio}
            maxLength={160}
            onChange={(e)=>setEditBio(e.target.value)}
            placeholder="Parlez-nous de vous, de vos objectifs de marche..."
            rows={3}
            data-testid="edit-bio-input"
          />
          <small className="field-help">Visible sur votre profil public. 160 caractères max.</small>
        </div>
        {editBio && (
          <div className="card card-preview mb-3">
            <div className="card-title">Aperçu public</div>
            <div className="profile-preview-row">
              <Avatar name={editName||profile.displayName} photoURL={editPreview||profile.photoURL} size={44} />
              <div>
                <div className="profile-preview-name">{editName||profile.displayName}</div>
                <div className="row-sub">{editBio || 'Votre bio apparaîtra ici'}</div>
              </div>
            </div>
          </div>
        )}
        <button className="btn btn-gold" onClick={saveProfile} disabled={busy} data-testid="save-profile-button">
          {busy ? '...' : 'Enregistrer'}
        </button>
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

      <Sheet open={!!badgeSheet} onClose={()=>setBadgeSheet(null)} title={badgeSheet?.def.title||'Badge'}>
        {badgeSheet && <BadgePreview def={badgeSheet.def} badge={badgeSheet.badge} />}
      </Sheet>

      <Sheet open={qrOpen} onClose={()=>setQrOpen(false)} title="Mon QR ami">
        <div className="qr-sheet text-center">
          <QRCode value={`${location.origin}/?ref=${profile.referralCode}`} size={220} title={`Code ${profile.referralCode}`} />
          <div className="qr-sheet-code">{profile.referralCode}</div>
          <p className="card-help mt-2">Vos amis scannent ce QR en présentiel pour vous ajouter instantanément.</p>
          <button className="btn btn-gold mt-3" onClick={onShareQR}>Partager l’image stylée</button>
          <button className="btn btn-outline mt-2" onClick={()=>copyText(`${location.origin}/?ref=${profile.referralCode}`,'Lien')}>Copier le lien</button>
        </div>
      </Sheet>
    </div>
  );
}

function CamIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="3.2" />
    </svg>
  );
}
