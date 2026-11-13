import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { fmtCoins, fmtEuros, fmtNumber } from '../lib/coins';
import type { ContentReport, PartnerRequest, ReportStatus, Withdrawal } from '../lib/types';
import { getChallengeDefinitions } from '../lib/constants';
import { closeChallengeCatalogEntry, describeCatalogState, publishChallengeCatalog, setChallengeCatalogEntry, type ChallengeCatalogEntry } from '../lib/challenges';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { backfillBlockedUsers, reviewReport, watchReports } from '../lib/safety';
import Sheet from '../components/Sheet';
import ConfirmSheet from '../components/ConfirmSheet';

type Tab = 'partners' | 'withdrawals' | 'establishments' | 'reports' | 'challenges' | 'maintenance';

export default function AdminPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => location.key === 'default' ? navigate('/profile', { replace: true }) : navigate(-1);
  const [tab, setTab] = useState<Tab>('partners');
  const [partnerReqs, setPartnerReqs] = useState<PartnerRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reports,setReports]=useState<ContentReport[]>([]);
  // F02 — le barème des défis vit dans `challengeCatalog` (écriture réservée aux
  // présidents). Cet écran évite d'avoir à saisir les identifiants à la main
  // dans la console Firebase, où une faute de frappe crée une ligne orpheline.
  const [catalog,setCatalog] = useState<Map<string, ChallengeCatalogEntry>>(new Map());
  const [catalogBusy,setCatalogBusy] = useState(false);
  // Montants en cours de saisie, par identifiant de défi (chaîne pour laisser
  // l'utilisateur taper « 1 » avant « 15 » sans reformatage intempestif).
  const [rewardDrafts,setRewardDrafts] = useState<Record<string, string>>({});
  const reloadCatalog = async () => {
    try {
      const snaps = await getDocs(collection(db, 'challengeCatalog'));
      const next = new Map<string, ChallengeCatalogEntry>();
      snaps.docs.forEach((d) => next.set(d.id, d.data() as ChallengeCatalogEntry));
      setCatalog(next);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  useEffect(() => { if (isPresidentUid(profile?.uid)) void reloadCatalog(); }, [profile?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveReward = async (challengeId: string, fallback: number) => {
    if (!profile) return;
    const raw = rewardDrafts[challengeId];
    const reward = Number(raw ?? fallback);
    setCatalogBusy(true);
    try {
      await setChallengeCatalogEntry(profile.uid, challengeId, { reward, active: true });
      await reloadCatalog();
      setRewardDrafts((d) => { const { [challengeId]: _omit, ...rest } = d; return rest; });
      toast(`Barème enregistré : ${reward} EC.`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setCatalogBusy(false);
    }
  };

  const toggleCatalogEntry = async (challengeId: string, open: boolean) => {
    if (!profile) return;
    setCatalogBusy(true);
    try {
      if (open) {
        await publishChallengeCatalog(profile.uid);
      } else {
        await closeChallengeCatalogEntry(profile.uid, challengeId);
      }
      await reloadCatalog();
      toast(open ? 'Défi ouvert au versement.' : 'Défi fermé : plus aucun versement.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setCatalogBusy(false);
    }
  };

  // Migration des listes de blocage (F12) : les profils créés avant la 2.2.2
  // n'ont pas `blockedUsers`/`blockedBy`, donc un blocage ancien ne filtre pas
  // les listes tant que la migration n'a pas tourné. L'opération est idempotente.
  const runBlockedBackfill = async () => {
    if (!profile) return;
    setBackfillBusy(true);
    try {
      const result = await backfillBlockedUsers(profile.uid);
      toast(
        result.updated
          ? `${result.updated} profil(s) mis à jour, ${result.skipped} déjà à jour.`
          : 'Tous les profils sont déjà à jour.',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBackfillBusy(false);
    }
  };

  const publishCatalog = async () => {
    if (!profile) return;
    setCatalogBusy(true);
    try {
      const result = await publishChallengeCatalog(profile.uid);
      await reloadCatalog();
      toast(
        result.written.length
          ? `${result.written.length} défi(s) ouvert(s) au versement${result.skipped.length ? ` · ${result.skipped.length} déjà réglé(s)` : ''}.`
          : 'Tous les défis du jour ont déjà un barème valide.',
        'success',
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setCatalogBusy(false);
    }
  };
  useEffect(()=>isPresidentUid(profile?.uid)?watchReports(setReports):undefined,[profile?.uid]);

  // Formulaire établissement
  const [estName, setEstName] = useState('');
  const [estAddress, setEstAddress] = useState('');
  const [estDescription, setEstDescription] = useState('');
  const [estLogo, setEstLogo] = useState<string | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);

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

  /**
   * Modération d'un signalement (D06).
   *
   * La note d'action est conservée dans l'historique : elle est donc pré-remplie
   * selon la décision, modifiable, et sa valeur survit à un échec d'envoi. Plus
   * de `prompt()` natif, qui perdait le texte saisi en cas d'erreur réseau.
   */
  const [pendingModeration, setPendingModeration] = useState<{ report: ContentReport; status: ReportStatus } | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const openModeration = (report: ContentReport, status: ReportStatus) => {
    setPendingModeration({ report, status });
  };
  const defaultModerationNote = (status: ReportStatus) =>
    status === 'resolved' ? 'Contenu traité' : status === 'dismissed' ? 'Signalement non fondé' : 'Examen en cours';
  const moderate = async (note: string) => {
    if (!profile || !pendingModeration?.report.id) return;
    setModerationBusy(true);
    try {
      await reviewReport(pendingModeration.report.id, profile.uid, pendingModeration.status, note.trim());
      toast('Signalement mis à jour.', 'success');
      setPendingModeration(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setModerationBusy(false);
    }
  };
  const MODERATION_LABELS: Record<ReportStatus, { title: string; confirm: string; consequences: string[] }> = {
    open: { title: 'Rouvrir ce signalement ?', confirm: 'Rouvrir', consequences: ['Le signalement redevient visible dans la file.'] },
    reviewing: { title: 'Prendre en charge ce signalement ?', confirm: 'Prendre en charge', consequences: ['Le signalement passe en « en cours d’examen ».', 'Votre note est ajoutée à l’historique.'] },
    resolved: { title: 'Marquer ce signalement comme résolu ?', confirm: 'Résoudre', consequences: ['La décision est datée et conservée dans l’historique du signalement.', 'L’auteur du signalement en est informé.'] },
    dismissed: { title: 'Classer ce signalement sans suite ?', confirm: 'Classer', consequences: ['Le signalement est clos sans sanction.', 'La décision reste consultable dans l’historique.'] },
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

  // Édition d'une fiche : un seul formulaire au lieu de cinq `prompt()` en
  // cascade (annuler au troisième champ perdait les deux premiers).
  const [editTarget, setEditTarget] = useState<Establishment | null>(null);
  const [editDraft, setEditDraft] = useState({ description: '', openingHours: '', website: '', phone: '', offerText: '' });
  const [editBusy, setEditBusy] = useState(false);
  const editEstablishment = (e: Establishment) => {
    setEditDraft({
      description: e.description || '',
      openingHours: e.openingHours || '',
      website: e.website || '',
      phone: e.phone || '',
      offerText: e.offerText || '',
    });
    setEditTarget(e);
  };
  const saveEstablishment = async () => {
    if (!editTarget?.id) return;
    if (!editDraft.description.trim()) {
      toast('La description est requise.', 'error');
      return;
    }
    setEditBusy(true);
    try {
      await updateEstablishment(editTarget.id, editDraft);
      toast('Fiche mise à jour.', 'success');
      setEditTarget(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setEditBusy(false);
    }
  };

  // Suppression d'une fiche : confirmation structurée (D06).
  const [pendingEstDelete, setPendingEstDelete] = useState<Establishment | null>(null);
  const [estDeleteBusy, setEstDeleteBusy] = useState(false);
  const removeEstablishment = async () => {
    if (!pendingEstDelete?.id) return;
    setEstDeleteBusy(true);
    try {
      await deleteEstablishment(pendingEstDelete.id);
      toast('Établissement supprimé.', 'info');
      setPendingEstDelete(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setEstDeleteBusy(false);
    }
  };

  return (
    <div className="screen" data-testid="admin-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">👑 Administration</h1>
          <div className="screen-sub">Espace Président / Co-Président</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={goBack} data-testid="admin-back-button">
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
        <button className={`chip ${tab === 'reports' ? 'chip-active' : ''}`} onClick={() => setTab('reports')} data-testid="admin-tab-reports">Signalements ({reports.filter(r=>r.status==='open').length})</button>
        <button
          className={`chip ${tab === 'establishments' ? 'chip-active' : ''}`}
          onClick={() => setTab('establishments')}
          data-testid="admin-tab-establishments"
        >
          Établissements ({establishments.length})
        </button>
        <button
          className={`chip ${tab === 'challenges' ? 'chip-active' : ''}`}
          onClick={() => setTab('challenges')}
          data-testid="admin-tab-challenges"
        >
          Barème des défis
        </button>
        <button
          className={`chip ${tab === 'maintenance' ? 'chip-active' : ''}`}
          onClick={() => setTab('maintenance')}
          data-testid="admin-tab-maintenance"
        >
          Maintenance
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
      ) : tab === 'maintenance' ? (
        <div className="card" data-testid="admin-maintenance">
          <div className="card-title">Migration des blocages</div>
          <p className="card-help">
            Les profils créés avant la 2.2.2 n’ont pas les listes{' '}
            <code>blockedUsers</code> / <code>blockedBy</code>. Tant qu’elles manquent,
            un blocage ancien reste actif (lectures unitaires, messages, demandes
            d’ami refusés) mais le compte bloqué apparaît encore dans les listes
            et le classement. Cette migration les renseigne depuis la table de
            référence <code>blockedAccounts</code>.
          </p>
          <p className="card-help">
            Opération <strong>idempotente</strong> : seuls les profils à qui il manque
            une liste sont touchés, aucune liste existante n’est écrasée. Elle peut
            être relancée sans risque.
          </p>
          <button
            className="btn btn-gold"
            onClick={runBlockedBackfill}
            disabled={backfillBusy}
            data-testid="run-blocked-backfill"
          >
            {backfillBusy ? 'Migration…' : 'Renseigner les profils existants'}
          </button>
        </div>
      ) : tab === 'challenges' ? (
        <div className="card" data-testid="admin-challenge-catalog">
          <div className="card-title">Barème des défis</div>
          <p className="card-help">
            Un défi n’est rémunéré que s’il possède une ligne de catalogue
            <code> challengeCatalog/&lt;identifiant&gt;</code>. Les identifiants sont
            datés : « Sprint collectif » change chaque lundi, « Feu sacré » chaque
            jour. Le bouton ci-dessous crée les lignes du jour avec les montants
            ci-dessous — ajustez un montant puis validez-le défi par défi.
          </p>
          <button
            className="btn btn-gold"
            onClick={publishCatalog}
            disabled={catalogBusy}
            data-testid="publish-challenge-catalog"
          >
            {catalogBusy ? 'Publication…' : 'Ouvrir les défis du jour au versement'}
          </button>
          <div className="section-gap" />
          <ul className="challenge-catalog-list">
            {describeCatalogState(getChallengeDefinitions(), catalog).map(({ challenge, state, reward }) => {
              const draft = rewardDrafts[challenge.id];
              const value = draft ?? String(reward);
              const dirty = draft != null && Number(draft) !== reward;
              return (
                <li key={challenge.id} data-testid={`catalog-row-${challenge.id}`}>
                  <div className="catalog-row-head">
                    <span className="catalog-row-title">
                      {challenge.icon} <strong>{challenge.title}</strong>
                    </span>
                    <span className={`catalog-state is-${state}`}>
                      {state === 'paid' ? 'ouvert' : state === 'closed' ? 'fermé' : 'objectif seul'}
                    </span>
                  </div>
                  <div className="catalog-row-meta">
                    {challenge.startsAt} → {challenge.endsAt} · objectif{' '}
                    {challenge.metric === 'steps' ? fmtNumber(challenge.target) : challenge.target}
                    {challenge.metric === 'steps' ? ' pas' : challenge.metric === 'activeDays' ? ' jours actifs' : ' jours de série'}
                  </div>
                  <div className="catalog-row-actions">
                    <label className="catalog-reward">
                      <span>EC</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        inputMode="numeric"
                        value={value}
                        onChange={(e) => setRewardDrafts((d) => ({ ...d, [challenge.id]: e.target.value }))}
                        aria-label={`Montant en ElyCoins pour ${challenge.title}`}
                        data-testid={`catalog-reward-${challenge.id}`}
                      />
                    </label>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => void saveReward(challenge.id, challenge.reward)}
                      disabled={catalogBusy || !dirty}
                      data-testid={`catalog-save-${challenge.id}`}
                    >
                      Enregistrer
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void toggleCatalogEntry(challenge.id, state !== 'paid')}
                      disabled={catalogBusy}
                      data-testid={`catalog-toggle-${challenge.id}`}
                    >
                      {state === 'paid' ? 'Fermer' : 'Ouvrir'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted-xs">
            Montant autorisé : 1 à 50 EC. Une ligne déjà valide n’est jamais
            écrasée par « Ouvrir les défis du jour » : vos ajustements survivent
            à une republication. Fermer un défi coupe tout versement immédiatement.
          </p>
        </div>
      ) : tab === 'reports' ? (
        <div className="card" data-testid="moderation-queue"><div className="card-title">File de modération</div><p className="card-help">Chaque décision est datée et conservée dans l’historique du signalement.</p>{reports.length===0?<div className="empty-state">Aucun signalement.</div>:reports.map(report=><article key={report.id} style={{padding:'12px 0',borderBottom:'1px solid var(--gold-border)'}} data-testid="report-row"><div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong>{report.targetType} · {report.reason}</strong><span className="badge">{report.status}</span></div><div className="row-sub">Contenu {report.targetId} · signalé le {new Date(report.createdAt).toLocaleString('fr-FR')}</div>{report.details&&<p>{report.details}</p>}<div className="route-actions">{report.status==='open'&&<button className="btn btn-outline btn-sm" onClick={()=>openModeration(report,'reviewing')}>Prendre en charge</button>}<button className="btn btn-gold btn-sm" onClick={()=>openModeration(report,'resolved')}>Résoudre</button><button className="btn btn-ghost btn-sm" onClick={()=>openModeration(report,'dismissed')}>Classer sans suite</button></div>{report.history.length>0&&<div className="moderation-history">{report.history.map((action,index)=><div key={index}>{new Date(action.createdAt).toLocaleString('fr-FR')} · {action.status} · {action.note||'Sans note'}</div>)}</div>}</article>)}</div>
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
                  <button className="btn btn-ghost btn-sm" onClick={() => editEstablishment(e)}>Modifier</button><button className="btn btn-danger btn-sm" onClick={() => setPendingEstDelete(e)} data-testid="delete-establishment-button">
                    Supprimer
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
      <ConfirmSheet
        open={!!pendingModeration}
        onClose={() => setPendingModeration(null)}
        title={pendingModeration ? MODERATION_LABELS[pendingModeration.status].title : 'Signalement'}
        consequences={pendingModeration ? MODERATION_LABELS[pendingModeration.status].consequences : []}
        textField={{ label: 'Note d’action (conservée dans l’historique)', placeholder: 'Ex. contenu masqué, avertissement envoyé', maxLength: 300 }}
        initialText={pendingModeration ? defaultModerationNote(pendingModeration.status) : ''}
        confirmLabel={pendingModeration ? MODERATION_LABELS[pendingModeration.status].confirm : 'Confirmer'}
        busy={moderationBusy}
        onConfirm={moderate}
        testId="moderation-sheet"
      />

      <Sheet
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Modifier « ${editTarget.name} »` : 'Modifier la fiche'}
        testId="edit-establishment-sheet"
      >
        <div className="field">
          <label htmlFor="est-edit-description">Description</label>
          <textarea
            id="est-edit-description"
            className="input"
            value={editDraft.description}
            onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
            maxLength={400}
          />
        </div>
        <div className="field">
          <label htmlFor="est-edit-hours">Horaires</label>
          <input
            id="est-edit-hours"
            className="input"
            value={editDraft.openingHours}
            onChange={(e) => setEditDraft((d) => ({ ...d, openingHours: e.target.value }))}
            placeholder="Lun–Sam · 8h–20h"
          />
        </div>
        <div className="field">
          <label htmlFor="est-edit-website">Site web</label>
          <input
            id="est-edit-website"
            className="input"
            type="url"
            inputMode="url"
            value={editDraft.website}
            onChange={(e) => setEditDraft((d) => ({ ...d, website: e.target.value }))}
            placeholder="https://…"
          />
        </div>
        <div className="field">
          <label htmlFor="est-edit-phone">Téléphone</label>
          <input
            id="est-edit-phone"
            className="input"
            type="tel"
            inputMode="tel"
            value={editDraft.phone}
            onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="est-edit-offer">Offre ElyCoins / réduction</label>
          <input
            id="est-edit-offer"
            className="input"
            value={editDraft.offerText}
            onChange={(e) => setEditDraft((d) => ({ ...d, offerText: e.target.value }))}
            placeholder="Ex. −10 % avec 200 EC"
          />
        </div>
        <button className="btn btn-gold" onClick={saveEstablishment} disabled={editBusy} data-testid="save-establishment-button">
          {editBusy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </Sheet>

      <ConfirmSheet
        open={!!pendingEstDelete}
        onClose={() => setPendingEstDelete(null)}
        title={pendingEstDelete ? `Supprimer « ${pendingEstDelete.name} » ?` : 'Supprimer cet établissement ?'}
        danger
        consequences={[
          'La fiche disparaît de la carte pour tous les utilisateurs.',
          'Les avantages ElyCoins associés ne sont plus proposés.',
          'Cette action est définitive.',
        ]}
        confirmLabel="Supprimer"
        busy={estDeleteBusy}
        onConfirm={removeEstablishment}
        testId="delete-establishment-sheet"
      />
    </div>
  );
}
