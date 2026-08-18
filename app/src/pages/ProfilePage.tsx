import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import Avatar from '../components/Avatar';
import { logout, updateAuthProfile, changePassword, deleteAuthAccount, reauthenticateAccount, frAuthError } from '../lib/auth-service';
import { updateUserFields, setReferredBy, exportAccountData, deleteAccountData } from '../lib/db';
import { uploadAvatar, deleteAvatar } from '../lib/avatar';
import { isPresidentUid } from '../lib/constants';
import { fmtCoins } from '../lib/coins';

export default function ProfilePage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');

  const [referralOpen, setReferralOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const [paypalOpen, setPaypalOpen] = useState(false);
  const [paypalEmail, setPaypalEmail] = useState(profile?.paypalEmail || '');

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(profile?.displayName || '');
  const [editPreview, setEditPreview] = useState<string | null>(null);
  const [editFile, setEditFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (name.length < 2) {
      toast('Le pseudo doit contenir au moins 2 caractères.', 'error');
      return;
    }
    if (name.length > 24) {
      toast('Le pseudo est limité à 24 caractères.', 'error');
      return;
    }
    setBusy(true);
    try {
      const fields: { displayName: string; photoURL?: string } = { displayName: name };
      if (editFile) {
        fields.photoURL = await uploadAvatar(profile.uid, editFile);
      }
      await updateUserFields(profile.uid, fields);
      await updateAuthProfile({
        displayName: name,
        ...(fields.photoURL && fields.photoURL.startsWith('http') ? { photoURL: fields.photoURL } : {}),
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
  const onExport = async () => { if(!profile)return; const data=await exportAccountData(profile.uid); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.download=`elywalk-export-${profile.uid}.json`; a.click(); URL.revokeObjectURL(a.href); };
  const onDelete = async () => { if(!profile||!confirm('Suppression définitive : vos données et votre compte seront effacés. Continuer ?'))return; const pwd=prompt('Pour confirmer, saisissez votre mot de passe (laissez vide pour Google)')||undefined; setBusy(true); try { if(pwd) await reauthenticateAccount(pwd); await deleteAvatar(profile.uid); await deleteAccountData(profile.uid); await deleteAuthAccount(); } catch(e){toast(frAuthError(e),'error')} finally{setBusy(false)} };
  const onShare = async () => { if(!profile)return; const url=`${location.origin}/?ref=${profile.referralCode}`; const text=`Rejoins-moi sur ElyWalk avec le code ${profile.referralCode}`; if(navigator.share) await navigator.share({title:'ElyWalk',text,url}); else {await navigator.clipboard.writeText(`${text} ${url}`);toast('Lien copié !','success')} };

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
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{profile.email || 'Aucun e-mail'}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {isAdmin && (
              <span className="badge">👑 {profile.role === 'president' ? 'Président' : 'Co-Président'}</span>
            )}
            <span className="badge">{fmtCoins(profile.elycoins)} EC</span>
          </div>
        </div>
      </div>

      <button className="btn btn-outline" onClick={openEdit} data-testid="edit-profile-button">
        Modifier mon profil
      </button>
      <div className="section-gap" />

      <div className="card">
        <div className="card-title">Parrainage</div>
        <div className="list-row">
          <div className="row-main">
            <div className="row-title" style={{ fontSize: 14 }}>Mon code : {profile.referralCode}</div>
            <div className="row-sub">+10 EC par filleul</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onShare}>Partager</button>
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

      <div className="card"><div className="card-title">Compte & données</div>
        <button className="btn btn-ghost" onClick={()=>setSecurityOpen(true)}>Changer le mot de passe</button><div className="section-gap" />
        <button className="btn btn-outline" onClick={onExport}>Exporter mes données (RGPD)</button><div className="section-gap" />
        <button className="btn btn-danger" onClick={onDelete} disabled={busy}>Supprimer définitivement mon compte</button>
        <div className="legal-links"><a href="/legal/terms">CGU</a> · <a href="/legal/privacy">Confidentialité</a> · <a href="/legal/notices">Mentions légales</a> · <a href="mailto:contact@elysium-france.org?subject=Feedback%20ElyWalk">Donner mon avis</a> · <button className="text-button" style={{display:'inline',padding:0,width:'auto'}} onClick={()=>navigate('/whats-new')}>Nouveautés</button><br/>ElyWalk 1.1.0</div>
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
