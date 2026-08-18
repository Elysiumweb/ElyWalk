import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  listAllPartnerRequests,
  updatePartnerRequestStatus,
  listAllWithdrawals,
  updateWithdrawalStatus,
} from '../lib/db';
import {
  createEstablishment,
  deleteEstablishment,
  updateEstablishment,
  listEstablishments,
  geocodeAddress,
  resizeLogoToDataUrl,
  type Establishment,
} from '../lib/establishments';
import { isPresidentUid } from '../lib/constants';
import { fmtCoins, fmtEuros } from '../lib/coins';
import type { PartnerRequest, Withdrawal } from '../lib/types';

type Tab = 'partners' | 'withdrawals' | 'establishments';

export default function AdminPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('partners');
  const [partnerReqs, setPartnerReqs] = useState<PartnerRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulaire établissement
  const [estName, setEstName] = useState('');
  const [estAddress, setEstAddress] = useState('');
  const [estDescription, setEstDescription] = useState('');
  const [estLogo, setEstLogo] = useState<string | null>(null);
  const [estBusy, setEstBusy] = useState(false);

  const isAdmin = isPresidentUid(profile?.uid);

  const reload = () => {
    setLoading(true);
    Promise.all([listAllPartnerRequests(), listAllWithdrawals(), listEstablishments()])
      .then(([p, w, e]) => {
        setPartnerReqs(p);
        setWithdrawals(w);
        setEstablishments(e);
      })
      .catch((e) => toast((e as Error).message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isAdmin) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="screen" data-testid="admin-screen">
        <div className="empty-state">
          <div className="display">Accès réservé</div>
          Cette section est réservée au Président et au Co-Président.
        </div>
      </div>
    );
  }

  const setPartnerStatus = async (id: string, status: PartnerRequest['status']) => {
    await updatePartnerRequestStatus(id, status);
    reload();
  };
  const setWdStatus = async (id: string, status: Withdrawal['status']) => {
    await updateWithdrawalStatus(id, status);
    reload();
  };

  const onLogoFile = async (file: File | null) => {
    if (!file) return;
    try {
      setEstLogo(await resizeLogoToDataUrl(file));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const submitEstablishment = async () => {
    if (!profile) return;
    setEstBusy(true);
    try {
      if (!estName.trim() || !estAddress.trim() || !estDescription.trim()) {
        throw new Error('Nom, adresse et description sont requis.');
      }
      const geo = await geocodeAddress(estAddress.trim());
      if (!geo) throw new Error('Adresse introuvable sur la carte. Précisez-la (rue, ville, pays).');
      await createEstablishment({
        name: estName.trim(),
        address: estAddress.trim(),
        description: estDescription.trim(),
        logoDataUrl: estLogo,
        lat: geo.lat,
        lng: geo.lng,
        createdBy: profile.uid,
      });
      toast('Établissement ajouté sur la carte !', 'success');
      setEstName('');
      setEstAddress('');
      setEstDescription('');
      setEstLogo(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setEstBusy(false);
    }
  };

  const editEstablishment = async (e: Establishment) => { const description=prompt('Nouvelle description',e.description); if(description===null)return; const openingHours=prompt('Horaires',e.openingHours||'')||''; const website=prompt('Site web',e.website||'')||''; const phone=prompt('Téléphone',e.phone||'')||''; const offerText=prompt('Offre ElyCoins / réduction',e.offerText||'')||''; await updateEstablishment(e.id!,{description,openingHours,website,phone,offerText}); toast('Fiche mise à jour.','success'); reload(); };
  const removeEstablishment = async (id: string) => {
    if (!confirm('Supprimer définitivement cet établissement ?')) return;
    try {
      await deleteEstablishment(id);
      toast('Établissement supprimé.', 'info');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="screen" data-testid="admin-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">👑 Administration</h1>
          <div className="screen-sub">Espace Président / Co-Président</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} data-testid="admin-back-button">
          Retour
        </button>
      </div>

      <div className="chip-row">
        <button
          className={`chip ${tab === 'partners' ? 'chip-active' : ''}`}
          onClick={() => setTab('partners')}
          data-testid="admin-tab-partners"
        >
          Partenariats ({partnerReqs.length})
        </button>
        <button
          className={`chip ${tab === 'withdrawals' ? 'chip-active' : ''}`}
          onClick={() => setTab('withdrawals')}
          data-testid="admin-tab-withdrawals"
        >
          Retraits ({withdrawals.filter((w) => w.status === 'pending').length})
        </button>
        <button
          className={`chip ${tab === 'establishments' ? 'chip-active' : ''}`}
          onClick={() => setTab('establishments')}
          data-testid="admin-tab-establishments"
        >
          Établissements ({establishments.length})
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Chargement...</div>
      ) : tab === 'partners' ? (
        <div className="card">
          <div className="card-title">Demandes de partenariat</div>
          {partnerReqs.length === 0 ? (
            <div className="empty-state" data-testid="admin-partners-empty">
              <div className="display">Aucune demande</div>
            </div>
          ) : (
            partnerReqs.map((p) => (
              <div key={p.id} style={{ padding: '12px 0', borderBottom: '1px solid rgba(216,202,130,0.08)' }} data-testid="admin-partner-row">
                <div className="row-title">{p.organization}</div>
                <div className="row-sub">
                  Par {p.userName} · {p.contactEmail} · {new Date(p.createdAt).toLocaleDateString('fr-FR')}
                </div>
                <p style={{ fontSize: 13.5, margin: '8px 0', color: 'var(--white)' }}>{p.message}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`badge ${p.status === 'accepted' ? 'badge-success' : p.status === 'rejected' ? 'badge-danger' : 'badge-muted'}`}>
                    {p.status === 'pending' ? 'Nouvelle' : p.status === 'read' ? 'Lue' : p.status === 'accepted' ? 'Acceptée' : 'Refusée'}
                  </span>
                  {p.status === 'pending' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setPartnerStatus(p.id!, 'read')} data-testid="admin-mark-read-button">
                      Marquer lue
                    </button>
                  )}
                  {p.status !== 'accepted' && (
                    <button className="btn btn-gold btn-sm" onClick={() => setPartnerStatus(p.id!, 'accepted')} data-testid="admin-accept-partner-button">
                      Accepter
                    </button>
                  )}
                  {p.status !== 'rejected' && (
                    <button className="btn btn-danger btn-sm" onClick={() => setPartnerStatus(p.id!, 'rejected')} data-testid="admin-reject-partner-button">
                      Refuser
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : tab === 'withdrawals' ? (
        <div className="card">
          <div className="card-title">Demandes de retrait &amp; donations</div>
          {withdrawals.length === 0 ? (
            <div className="empty-state" data-testid="admin-withdrawals-empty">
              <div className="display">Aucune demande</div>
            </div>
          ) : (
            withdrawals.map((w) => (
              <div key={w.id} style={{ padding: '12px 0', borderBottom: '1px solid rgba(216,202,130,0.08)' }} data-testid="admin-withdrawal-row">
                <div className="row-title">
                  {w.userName} — {w.type === 'paypal' ? fmtEuros(w.coins) : `${fmtCoins(w.coins)} EC`}
                </div>
                <div className="row-sub">
                  {w.type === 'paypal' ? `PayPal : ${w.paypalEmail}` : w.type === 'donation' ? 'Donation Elysium' : 'Partenaire'} ·{' '}
                  {new Date(w.createdAt).toLocaleDateString('fr-FR')}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <span className={`badge ${w.status === 'paid' || w.status === 'received' ? 'badge-success' : w.status === 'rejected' ? 'badge-danger' : 'badge-muted'}`}>
                    {w.status === 'pending' ? 'En attente' : w.status === 'paid' ? 'Payé' : w.status === 'received' ? 'Donation reçue' : 'Refusé'}
                  </span>
                  {w.status === 'pending' && (
                    <>
                      <button className="btn btn-gold btn-sm" onClick={() => setWdStatus(w.id!, w.type === 'donation' ? 'received' : 'paid')} data-testid="admin-mark-paid-button">
                        {w.type === 'donation' ? 'Marquer reçu' : 'Marquer payé'}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => setWdStatus(w.id!, 'rejected')} data-testid="admin-reject-withdrawal-button">
                        Refuser
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="card" data-testid="admin-establishment-form">
            <div className="card-title">Nouvelle fiche établissement</div>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
              La fiche apparaîtra sur la carte à l’adresse indiquée, pour promouvoir le partenaire.
            </p>
            <div className="field">
              <label>Nom de l’établissement</label>
              <input
                className="input"
                value={estName}
                onChange={(e) => setEstName(e.target.value)}
                placeholder="Ex. Café Elysium"
                data-testid="establishment-name-input"
              />
            </div>
            <div className="field">
              <label>Adresse</label>
              <input
                className="input"
                value={estAddress}
                onChange={(e) => setEstAddress(e.target.value)}
                placeholder="12 rue de la Paix, Paris, France"
                data-testid="establishment-address-input"
              />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                className="input"
                value={estDescription}
                onChange={(e) => setEstDescription(e.target.value)}
                placeholder="Présentez le partenaire, ses offres..."
                data-testid="establishment-description-input"
              />
            </div>
            <div className="field">
              <label>Logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {estLogo ? (
                  <img src={estLogo} alt="Logo" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', border: '1px solid var(--gold-border)' }} />
                ) : (
                  <div className="avatar" style={{ width: 52, height: 52, borderRadius: 12 }}>?</div>
                )}
                <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                  Choisir une image
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => onLogoFile(e.target.files?.[0] || null)}
                    data-testid="establishment-logo-input"
                  />
                </label>
              </div>
            </div>
            <button className="btn btn-gold" onClick={submitEstablishment} disabled={estBusy} data-testid="submit-establishment-button">
              {estBusy ? 'Localisation de l’adresse...' : 'Publier sur la carte'}
            </button>
          </div>

          <div className="card">
            <div className="card-title">Établissements publiés</div>
            {establishments.length === 0 ? (
              <div className="empty-state" data-testid="admin-establishments-empty">
                <div className="display">Aucun établissement</div>
              </div>
            ) : (
              establishments.map((e) => (
                <div className="list-row" key={e.id} data-testid="admin-establishment-row">
                  {e.logoDataUrl ? (
                    <img src={e.logoDataUrl} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--gold-border)' }} />
                  ) : (
                    <div className="avatar">{e.name.charAt(0).toUpperCase()}</div>
                  )}
                  <div className="row-main">
                    <div className="row-title">{e.name}</div>
                    <div className="row-sub">{e.address}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => editEstablishment(e)}>Modifier</button><button className="btn btn-danger btn-sm" onClick={() => removeEstablishment(e.id!)} data-testid="delete-establishment-button">
                    Supprimer
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
