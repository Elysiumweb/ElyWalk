import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LocaleContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import QRCode, { shareFriendCode } from '../components/QRCode';
import LevelBadge from '../components/LevelBadge';
import { logout, updateAuthProfile } from '../lib/auth-service';
import { updateUserFields, setReferredBy, listUserBadges, getReferralDashboard } from '../lib/db';
import { toFirestoreAvatarDataUrl, deleteAvatar, shrinkStoredAvatar } from '../lib/avatar';
import { DATA_DELETION_URL } from '../lib/constants';
import { isUnshareableOrigin, shareUrlForReferral } from '../lib/share';
import { APP_VERSION_LABEL } from '../lib/version';
import { isPresidentUid } from '../lib/constants';
import { fmtCoins, fmtNumber } from '../lib/coins';
import type { UserProfile } from '../lib/types';
import NotificationBell from '../components/NotificationBell';
import { useAlerts } from '../context/AlertsContext';
import ConfirmSheet from '../components/ConfirmSheet';
import BlockedAccounts from '../components/BlockedAccounts';

export default function ProfilePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);

  const [referralOpen, setReferralOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(profile?.displayName || '');
  const [editBio, setEditBio] = useState(profile?.bio || '');
  const [editPreview, setEditPreview] = useState<string | null>(null);
  const [editPhotoDataUrl, setEditPhotoDataUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Photo héritée trop lourde (> 60 Ko) : recompressée une seule fois, en
  // tâche de fond. Le drapeau local évite toute boucle d'écriture si la
  // recompression échoue.
  const shrunkRef = useRef(false);
  useEffect(() => {
    const photo = profile?.photoURL;
    if (!profile || !photo || shrunkRef.current) return;
    shrunkRef.current = true;
    void shrinkStoredAvatar(photo)
      .then((next) => (next ? updateUserFields(profile.uid, { photoURL: next }) : undefined))
      .catch(() => undefined);
  }, [profile?.uid, profile?.photoURL]);

  /** Supprime la photo de profil (repasse sur l'initiale du pseudo). */
  const removePhoto = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      await updateUserFields(profile.uid, { photoURL: null });
      await deleteAvatar(profile.uid).catch(() => undefined);
      setEditPhotoDataUrl(null);
      setEditPreview(null);
      toast('Photo de profil supprimée.', 'info');
    } catch (e) {
      toast((e as Error).message || 'Suppression impossible.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Referral dashboard
  const [referralData, setReferralData] = useState<{ total: number; active: number; earned: number; items: { uid: string; displayName: string; claimed: boolean; rejected?: boolean; createdAt: number; active?: boolean; totalSteps?: number }[] } | null>(null);
  useEffect(() => {
    if (!profile) return;
    getReferralDashboard(profile.uid).then(setReferralData).catch(()=>undefined);
  }, [profile?.uid]);

  const [qrOpen, setQrOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

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

  const openEdit = () => {
    setEditName(profile?.displayName || '');
    setEditBio(profile?.bio || '');
    setEditPreview(null);
    setEditPhotoDataUrl(null);
    setEditOpen(true);
  };

  /**
   * La photo est compressée **tout de suite** (recadrage carré + paliers de
   * qualité) pour donner un aperçu fidèle et pour ne plus jamais bloquer
   * l'enregistrement : la data-URL prête pour Firestore est mémorisée ici.
   */
  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Choisissez une image (JPG, PNG, WEBP…).', 'error');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast('Image trop lourde (12 Mo max).', 'error');
      return;
    }
    setPhotoBusy(true);
    try {
      const dataUrl = await toFirestoreAvatarDataUrl(file);
      setEditPhotoDataUrl(dataUrl);
      setEditPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return dataUrl;
      });
    } catch (e) {
      toast((e as Error).message || 'Impossible de traiter cette image.', 'error');
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
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
      // Une seule écriture Firestore : pseudo, bio et photo (base64) partent
      // ensemble. Aucun Storage, donc aucun risque de chargement infini.
      const fields: Record<string, unknown> = {
        displayName: name,
        // `null` efface explicitement la bio quand le champ est vidé.
        bio: bio || null,
      };
      if (editPhotoDataUrl) fields.photoURL = editPhotoDataUrl;
      await updateUserFields(profile.uid, fields as Partial<UserProfile>);
      // Firebase Auth ne stocke que des URL http(s) : une data-URL y serait
      // rejetée, on ne synchronise donc que le pseudo.
      await updateAuthProfile({ displayName: name }).catch(() => undefined);
      toast(editPhotoDataUrl ? 'Profil et photo mis à jour.' : 'Profil mis à jour.', 'success');
      setEditOpen(false);
      if (editPreview) URL.revokeObjectURL(editPreview);
      setEditPreview(null);
      setEditPhotoDataUrl(null);
    } catch (e) {
      toast((e as Error).message || 'Impossible d’enregistrer le profil.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const [logoutOpen, setLogoutOpen] = useState(false);
  const onLogout = async () => {
    await logout();
    setLogoutOpen(false);
  };
  const copyText = async (value: string, label: string) => { await navigator.clipboard.writeText(value); toast(`${label} copié !`, 'success'); };
  const onShare = async () => {
    if (!profile) return;
    const url = shareUrlForReferral(profile.referralCode);
    // Garde-fou : un lien local n'est jamais partagé (voir `lib/share`).
    if (isUnshareableOrigin(url)) {
      toast('Lien indisponible : réessayez depuis une version à jour de l’application.', 'error');
      return;
    }
    const text = `Rejoins-moi sur ElyWalk avec le code ${profile.referralCode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ElyWalk', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Lien copié !', 'success'); }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message || 'Partage impossible.', 'error');
    }
  };
  const onShareQR = async () => {
    if(!profile) return;
    try {
      const res = await shareFriendCode(profile.referralCode, profile.displayName);
      toast(res==='shared'?'QR partagé !':'Image enregistrée.','success');
    } catch(e){ toast((e as Error).message,'error'); }
  };

  if (!profile) return null;

  return (
    <div className="screen" data-testid="profile-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Profil</h1>
        </div>
        <div className="header-actions"><NotificationBell /></div>
      </div>

      <div className="gold-hero" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="display" style={{ fontSize: 17 }} data-testid="profile-name">
            {profile.displayName}
          </div>
          {profile.bio && <div style={{ color: '#d8d2c2', fontSize: 12, marginTop: 4, lineHeight:1.4 }}>{profile.bio}</div>}
          {!profile.bio && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Aucune bio · touche « Modifier » pour en ajouter</div>}
          {profile.email ? <button type="button" className="copy-value" onClick={() => copyText(profile.email!, 'E-mail')} title="Copier l’e-mail">{profile.email} <span aria-hidden="true">⧉</span></button> : <div style={{ color: 'var(--muted)', fontSize: 13 }}>Aucun e-mail</div>}
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

      <div className="card">
        <div className="card-title">Parrainage</div>
        <button type="button" className="referral-code" onClick={() => copyText(profile.referralCode, 'Code')} aria-label={`Copier le code ${profile.referralCode}`}>
          <span>Mon code</span><strong>{profile.referralCode}</strong><small>Toucher pour copier · +10 EC par filleul</small>
        </button>
        <div className="two-col" style={{marginTop:10}}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onShare}>Partager le lien</button>
          <button type="button" className="btn btn-gold btn-sm" onClick={()=>setQrOpen(true)}>QR code</button>
        </div>
        {profile.referralRejected && (
          <div className="row-sub" style={{ color: '#ff8b8b', marginTop: 6 }} data-testid="referral-rejected-note">
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
            <div className="stat-grid" style={{gridTemplateColumns:'1fr 1fr 1fr'}}>
              <div className="stat"><div className="stat-value">{referralData.total}</div><div className="stat-label">filleuls</div></div>
              <div className="stat"><div className="stat-value">{referralData.active}</div><div className="stat-label">actifs*</div></div>
              <div className="stat"><div className="stat-value">+{referralData.earned} EC</div><div className="stat-label">gains</div></div>
            </div>
            <small className="card-help">* Actif = +1000 pas cumulés</small>
            {referralData.items.length>0 ? referralData.items.map(f=>(
              <div key={f.uid} className="list-row">
                <Avatar name={f.displayName} photoURL={null} size={36} />
                <div className="row-main">
                  <div className="row-title" style={{fontSize:13}}>{f.displayName}</div>
                  <div className="row-sub">{fmtNumber(f.totalSteps||0)} pas · {f.active?'actif':'inactif'}</div>
                </div>
                {f.rejected ? <span className="badge badge-danger">Refusé</span> : f.claimed ? <span className="badge badge-success">Éligible ✓</span> : <span className="badge badge-muted">En attente</span>}
              </div>
            )) : <div className="empty-state" style={{padding:'12px 0'}}>Aucun filleul pour l’instant — partagez votre code !</div>}
          </>
        ) : <div className="empty-state">Chargement...</div>}
      </div>

      {/*
        D07 — le profil était une seule colonne de dix cartes (identité,
        trophées, statistiques, parrainage, paiement, confidentialité,
        apparence, langue, notifications, données) : les réglages et la
        progression se perdaient au milieu du reste.

        Le profil ne garde que l'identité, le palier, le parrainage et deux
        destinations explicites : « Progression » (statistiques, paliers,
        collection de badges) et « Réglages » (notifications, apparence,
        langue, paiement, confidentialité, compte). Aucun accès n'est perdu :
        chaque carte déplacée vit sur l'un de ces deux écrans.
      */}
      <div className="card" data-testid="profile-destinations">
        <div className="card-title">{t('profile.goto')}</div>
        <div className="profile-destinations">
          <button
            className="profile-destination"
            onClick={() => navigate('/progression')}
            data-testid="profile-go-progression"
          >
            <span className="profile-destination-icon" aria-hidden="true">🏆</span>
            <span className="profile-destination-main">
              <span className="profile-destination-title">{t('profile.goto.progression')}</span>
              <span className="profile-destination-hint">{t('profile.goto.progression.hint')}</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          <button
            className="profile-destination"
            onClick={() => navigate('/settings')}
            data-testid="profile-go-settings"
          >
            <span className="profile-destination-icon" aria-hidden="true">⚙️</span>
            <span className="profile-destination-main">
              <span className="profile-destination-title">{t('profile.goto.settings')}</span>
              <span className="profile-destination-hint">{t('profile.goto.settings.hint')}</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>


      <div className="card" data-testid="profile-account-shortcut">
        <div className="card-title">Compte & données</div>
        <p className="card-help">
          Mot de passe, e-mail, export RGPD, suppression du compte, comptes bloqués et confidentialité
          des annonces se règlent au même endroit.
        </p>
        <button className="btn btn-outline" onClick={() => navigate('/settings')} data-testid="profile-account-settings">
          Ouvrir les réglages du compte
        </button>
        <div className="section-gap" />
        <a className="btn btn-outline" href={DATA_DELETION_URL} target="_blank" rel="noopener noreferrer">Supprimer une partie de mes données</a>
        <div className="legal-links"><a href="/legal/terms">CGU</a> · <a href="/legal/privacy">Confidentialité</a> · <a href="/legal/notices">Mentions légales</a> · <a href="mailto:contact@elysium-esport.fr?subject=Feedback%20ElyWalk">Donner mon avis</a> · <button className="text-button inline-link" onClick={()=>navigate('/whats-new')}>Nouveautés</button> · <button className="text-button inline-link" onClick={()=>navigate('/diagnostics')} data-testid="diagnostics-link">Diagnostic</button><br/>{APP_VERSION_LABEL}</div>
      </div>

      {isAdmin && (
        <button className="btn btn-gold" onClick={() => navigate('/admin')} data-testid="admin-button">
          👑 Administration Elysium
        </button>
      )}
      <div className="section-gap" />
      <button className="btn btn-danger" onClick={() => setLogoutOpen(true)} data-testid="logout-button">
        Se déconnecter
      </button>
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
            disabled={photoBusy}
            data-testid="change-photo-button"
          >
            {photoBusy ? 'Préparation de la photo…' : 'Choisir une photo'}
          </button>
          {editPhotoDataUrl && !photoBusy && (
            <span className="photo-ready" role="status" data-testid="photo-ready">
              ✓ Photo prête ({Math.round(editPhotoDataUrl.length / 1024)} Ko)
            </span>
          )}
          {profile.photoURL && !photoBusy && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void removePhoto()}
              disabled={busy}
              data-testid="remove-photo-button"
            >
              Supprimer la photo
            </button>
          )}
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
          <label>Bio <span style={{color:'var(--muted)', textTransform:'none'}}>{editBio.length}/160</span></label>
          <textarea
            className="input"
            value={editBio}
            maxLength={160}
            onChange={(e)=>setEditBio(e.target.value)}
            placeholder="Parlez-nous de vous, de vos objectifs de marche..."
            rows={3}
            data-testid="edit-bio-input"
          />
          <small style={{color:'var(--muted)', fontSize:11}}>Visible sur votre profil public. 160 caractères max.</small>
        </div>
        {editBio && (
          <div className="card" style={{background:'var(--surface-2)', marginBottom:12}}>
            <div className="card-title" style={{fontSize:11}}>Aperçu public</div>
            <div style={{display:'flex', gap:10, alignItems:'center'}}>
              <Avatar name={editName||profile.displayName} photoURL={editPreview||profile.photoURL} size={44} />
              <div>
                <div style={{fontWeight:700, fontSize:14}}>{editName||profile.displayName}</div>
                <div style={{color:'var(--muted)', fontSize:12, marginTop:2}}>{editBio || 'Votre bio apparaîtra ici'}</div>
              </div>
            </div>
          </div>
        )}
        <button
          className="btn btn-gold"
          onClick={saveProfile}
          disabled={busy || photoBusy}
          data-testid="save-profile-button"
        >
          {busy ? 'Enregistrement…' : photoBusy ? 'Photo en cours…' : 'Enregistrer'}
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

      <Sheet open={qrOpen} onClose={()=>setQrOpen(false)} title="Mon QR ami">
        <div style={{textAlign:'center', padding:'10px 0'}}>
          <QRCode value={shareUrlForReferral(profile.referralCode)} size={220} title={`Code ${profile.referralCode}`} />
          <div style={{marginTop:14, fontFamily:'var(--font-display)', fontSize:26, color:'var(--gold)', letterSpacing:'0.2em'}}>{profile.referralCode}</div>
          <p className="card-help" style={{marginTop:8}}>Vos amis scannent ce QR en présentiel pour vous ajouter instantanément.</p>
          <button className="btn btn-gold" style={{marginTop:14}} onClick={onShareQR}>Partager l’image stylée</button>
          <button className="btn btn-outline" style={{marginTop:8}} onClick={()=>copyText(shareUrlForReferral(profile.referralCode),'Lien')}>Copier le lien</button>
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
