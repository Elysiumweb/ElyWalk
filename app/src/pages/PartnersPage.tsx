import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { createPartnerRequest, listPartnerOffers, redeemPartnerOffer } from '../lib/db';
import type { PartnerOffer } from '../lib/types';
import { fmtCoins } from '../lib/coins';

export default function PartnersPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [organization, setOrganization] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  useEffect(()=>{listPartnerOffers().then(setOffers).catch(()=>undefined)},[]);
  const redeem = async (offer: PartnerOffer) => { if(!profile||!confirm(`Dépenser ${fmtCoins(offer.coins)} EC pour « ${offer.title} » ?`))return; setBusy(true); try{await redeemPartnerOffer(profile,offer);toast('Offre réservée ! Présentez la demande au partenaire.','success')}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)} };

  const submit = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      if (!organization.trim() || !contactEmail.includes('@') || !message.trim()) {
        throw new Error('Remplissez tous les champs (e-mail valide requis).');
      }
      await createPartnerRequest(profile, organization.trim(), contactEmail.trim(), message.trim());
      setSent(true);
      toast('Demande de partenariat envoyée !', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen" data-testid="partners-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Partenaires</h1>
          <div className="screen-sub">Offres &amp; partenariats Elysium</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} data-testid="partners-back-button">
          Retour
        </button>
      </div>

      <div className="card">
        <div className="card-title">Offres partenaires</div>
        {offers.length===0?<div className="empty-state" data-testid="partner-offers-empty-state"><div className="display">Aucune offre pour le moment</div>De nouvelles offres seront publiées prochainement.</div>:offers.map(o=><div className="list-row" key={o.id}><div className="row-main"><div className="row-title">{o.title}</div><div className="row-sub">{o.partnerName} · {o.description}</div></div><button className="btn btn-gold btn-sm" disabled={busy} onClick={()=>redeem(o)}>{fmtCoins(o.coins)} EC</button></div>)}
      </div>

      <div className="card" data-testid="partner-request-card">
        <div className="card-title">Devenir partenaire</div>
        {sent ? (
          <div className="empty-state" data-testid="partner-request-sent">
            <div className="display">Demande envoyée ✓</div>
            L’équipe Elysium examinera votre demande.
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
              Vous représentez une organisation et souhaitez proposer des offres aux
              marcheurs d’ElyWalk ? Envoyez votre demande au Président et au Co-Président.
            </p>
            <div className="field">
              <label>Organisation</label>
              <input
                className="input"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Nom de votre organisation"
                data-testid="partner-organization-input"
              />
            </div>
            <div className="field">
              <label>E-mail de contact</label>
              <input
                className="input"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@organisation.com"
                data-testid="partner-email-input"
              />
            </div>
            <div className="field">
              <label>Votre proposition</label>
              <textarea
                className="input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Décrivez votre proposition de partenariat..."
                data-testid="partner-message-input"
              />
            </div>
            <button className="btn btn-gold" onClick={submit} disabled={busy} data-testid="submit-partner-request-button">
              {busy ? '...' : 'Envoyer la demande'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
