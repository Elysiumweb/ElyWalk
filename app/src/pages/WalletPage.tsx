import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import { requestConversion, listMyWithdrawals, listMyTransactions } from '../lib/db';
import { fmtCoins, fmtEuros, coinsToEuros } from '../lib/coins';
import { MIN_PAYPAL_COINS, isPresidentUid } from '../lib/constants';
import { updateUserFields } from '../lib/db';
import { showWithdrawalAd } from '../lib/ads';
import type { Withdrawal, CoinTransaction } from '../lib/types';
import NotificationBell from '../components/NotificationBell';
import ConfirmSheet from '../components/ConfirmSheet';

export default function WalletPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [paypalOpen, setPaypalOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [historyTab, setHistoryTab] = useState<'tx' | 'wd'>('tx');

  const isExcluded = isPresidentUid(profile?.uid);

  const reload = () => {
    if (!profile) return;
    listMyWithdrawals(profile.uid).then(setWithdrawals).catch(() => undefined);
    listMyTransactions(profile.uid).then(setTransactions).catch(() => undefined);
  };

  useEffect(reload, [profile?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (profile?.paypalEmail) setPaypalEmail(profile.paypalEmail);
  }, [profile?.paypalEmail]);

  /**
   * Étape de confirmation : l'opération n'est plus lancée depuis un `confirm()`
   * natif. La feuille explique d'abord le résultat (débit, minimum, délai) puis
   * l'utilisateur valide explicitement (D06). Une annulation laisse le montant
   * et l'e-mail saisis.
   */
  const [pending, setPending] = useState<{ type: 'paypal' | 'donation'; coins: number } | null>(null);

  const submit = async (type: 'paypal' | 'donation') => {
    if (!profile) return;
    const coins = Math.floor(Number(amount));
    if (!Number.isFinite(coins) || coins <= 0) {
      toast('Saisissez un montant valide avant de confirmer.', 'error');
      return;
    }
    if (type === 'paypal') {
      if (coins < MIN_PAYPAL_COINS) {
        toast(`Minimum ${MIN_PAYPAL_COINS} ElyCoins (1 €) pour un retrait.`, 'error');
        return;
      }
      if (!paypalEmail.includes('@')) {
        toast('Renseignez une adresse PayPal valide.', 'error');
        return;
      }
    }
    setPending({ type, coins });
  };

  /** Exécution réelle, après confirmation explicite. */
  const runConversion = async (type: 'paypal' | 'donation', coins: number) => {
    if (!profile) return;
    setBusy(true);
    try {
      if (!coins || coins <= 0) throw new Error('Montant invalide.');
      if (type === 'paypal') {
        if (coins < MIN_PAYPAL_COINS) {
          throw new Error(`Minimum ${MIN_PAYPAL_COINS} ElyCoins (1 €).`);
        }
        if (!paypalEmail.includes('@')) throw new Error('E-mail PayPal invalide.');
        await updateUserFields(profile.uid, { paypalEmail });
      }
      // Annonce avant le retrait (medium rectangle 300×250, Meta Audience Network).
      if (type === 'paypal') await showWithdrawalAd();
      await requestConversion(profile, type, coins, paypalEmail);
      toast(
        type === 'paypal'
          ? `Demande de retrait de ${fmtEuros(coins)} envoyée !`
          : `Merci pour votre donation de ${fmtCoins(coins)} EC à Elysium ! 💛`,
        'success'
      );
      setPaypalOpen(false);
      setDonateOpen(false);
      setPending(null);
      setAmount('');
      reload();
    } catch (e) {
      // Échec : la feuille de confirmation reste ouverte avec la saisie, donc
      // l'utilisateur peut réessayer sans tout ressaisir.
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const transactionIcon = (type: CoinTransaction['type']) => ({ steps: '👟', ad: '▶', referral: '🤝', paypal: '↗', donation: '♥', partner: '✦', challenge: '🏆' }[type]);
  const formatDateTime = (value: number) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  const statusBadge = (s: Withdrawal['status']) => {
    if (s === 'paid') return <span className="badge badge-success">Payé</span>;
    if (s === 'rejected') return <span className="badge badge-danger">Refusé</span>;
    if (s === 'received') return <span className="badge badge-success">Reçue 💛</span>;
    return <span className="badge badge-muted">En attente</span>;
  };

  return (
    <div className="screen" data-testid="wallet-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Portefeuille</h1>
          <div className="screen-sub">Vos ElyCoins</div>
        </div>
        <div className="header-actions"><NotificationBell /></div>
      </div>

      <div className="gold-card">
        <img src="/deco-2.webp" className="gc-deco" alt="" />
        <div className="gc-label">Solde actuel</div>
        <div className="gc-balance" data-testid="wallet-balance">
          {fmtCoins(profile?.elycoins || 0)} <span style={{ fontSize: 17 }}>EC</span>
        </div>
        <div className="gc-euro" data-testid="wallet-euro-value">
          ≈ {coinsToEuros(profile?.elycoins || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
        </div>
      </div>

      {isExcluded && (
        <div className="card" data-testid="president-excluded-notice">
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            👑 En tant que {profile?.role === 'president' ? 'Président' : 'Co-Président'}, vous êtes
            exclu de la conversion en argent et des avantages partenaires mais vos ElyCoins
            comptent au classement ! Les donations restent possibles.
          </p>
        </div>
      )}

      <div className="card wallet-actions">
        <div className="card-title">Actions</div>
        {!isExcluded && <button type="button" className="btn btn-gold" onClick={() => setPaypalOpen(true)} data-testid="paypal-withdraw-button">Retirer via PayPal</button>}
        <div className="secondary-actions">
          <button type="button" className="text-button" onClick={() => setDonateOpen(true)} data-testid="donate-button">Faire un don</button>
          <button type="button" className="text-button" onClick={() => navigate('/partners')} data-testid="partner-offers-button">Offres partenaires</button>
        </div>
      </div>
      <div className="card">
        <div className="chip-row">
          <button
            className={`chip ${historyTab === 'tx' ? 'chip-active' : ''}`}
            onClick={() => setHistoryTab('tx')}
            data-testid="history-tab-transactions"
          >
            Historique
          </button>
          <button
            className={`chip ${historyTab === 'wd' ? 'chip-active' : ''}`}
            onClick={() => setHistoryTab('wd')}
            data-testid="history-tab-withdrawals"
          >
            Retraits &amp; dons
          </button>
        </div>

        {historyTab === 'tx' &&
          (transactions.length === 0 ? (
            <div className="empty-state" data-testid="transactions-empty-state">
              <div className="display">Aucune transaction</div>
              Validez vos pas pour gagner vos premiers ElyCoins !
            </div>
          ) : (
            transactions.map((t) => (
              <div className="list-row" key={t.id} data-testid="transaction-row">
                <span className="transaction-icon" aria-hidden="true">{transactionIcon(t.type)}</span>
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 14 }}>{t.note}</div>
                  <div className="row-sub">{formatDateTime(t.createdAt)}</div>
                </div>
                <div className="row-value" style={{ color: t.coins >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {t.coins >= 0 ? '+' : ''}{fmtCoins(t.coins)} EC
                </div>
              </div>
            ))
          ))}

        {historyTab === 'wd' &&
          (withdrawals.length === 0 ? (
            <div className="empty-state" data-testid="withdrawals-empty-state">
              <div className="display">Aucun retrait ni don</div>
            </div>
          ) : (
            withdrawals.map((w) => (
              <div className="list-row" key={w.id} data-testid="withdrawal-row">
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 14 }}>
                    {w.type === 'paypal' ? `PayPal · ${w.paypalEmail}` : w.type === 'donation' ? 'Donation Elysium' : 'Partenaire'}
                  </div>
                  <div className="row-sub">
                    {fmtCoins(w.coins)} EC · {formatDateTime(w.createdAt)}
                  </div>
                </div>
                {statusBadge(w.status)}
              </div>
            ))
          ))}
      </div>

      {/* Vrais formulaires : Entrée valide, libellés associés, saisie conservée
          en cas d'erreur (D06). */}
      <Sheet open={paypalOpen} onClose={() => setPaypalOpen(false)} title="Retrait PayPal" testId="paypal-sheet">
        <form onSubmit={(event) => { event.preventDefault(); void submit('paypal'); }}>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            1000 ElyCoins = 1 €. Le paiement sera envoyé sur votre compte PayPal après validation.
          </p>
          <div className="field">
            <label htmlFor="paypal-email">E-mail du compte PayPal</label>
            <input
              id="paypal-email"
              className="input"
              type="email"
              autoComplete="email"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              placeholder="vous@paypal.com"
              data-testid="paypal-email-input"
            />
          </div>
          <div className="field">
            <label htmlFor="paypal-amount">ElyCoins à convertir (min. {MIN_PAYPAL_COINS})</label>
            <input
              id="paypal-amount"
              className="input"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              data-testid="paypal-amount-input"
            />
            {Number(amount) > 0 && (
              <div style={{ color: 'var(--gold)', fontSize: 13, marginTop: 6 }}>
                = {fmtEuros(Math.floor(Number(amount)))}
              </div>
            )}
          </div>
          <button className="btn btn-gold" type="submit" disabled={busy} data-testid="confirm-paypal-button">
            {busy ? '…' : 'Demander le retrait'}
          </button>
        </form>
      </Sheet>

      <Sheet open={donateOpen} onClose={() => setDonateOpen(false)} title="Donation à Elysium" testId="donate-sheet">
        <form onSubmit={(event) => { event.preventDefault(); void submit('donation'); }}>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            Transformez vos ElyCoins en soutien direct à l’association Elysium. 💛
          </p>
          <div className="field">
            <label htmlFor="donate-amount">ElyCoins à donner</label>
            <input
              id="donate-amount"
              className="input"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
              data-testid="donate-amount-input"
            />
          </div>
          <button className="btn btn-gold" type="submit" disabled={busy} data-testid="confirm-donate-button">
            {busy ? '…' : 'Faire le don'}
          </button>
        </form>
      </Sheet>

      {/*
        Confirmation structurée : le résultat de l'opération est annoncé avant
        validation (débit, montant, délai), et l'action est séparée visuellement
        des actions courantes.
      */}
      <ConfirmSheet
        open={!!pending}
        title={pending?.type === 'donation' ? 'Confirmer la donation' : 'Confirmer le retrait'}
        danger
        busy={busy}
        confirmLabel={pending?.type === 'donation' ? 'Donner ces ElyCoins' : 'Demander le retrait'}
        consequences={
          pending
            ? pending.type === 'donation'
              ? [
                  `${fmtCoins(pending.coins)} ElyCoins seront définitivement débités de votre solde.`,
                  'Les ElyCoins donnés ne peuvent pas être récupérés ni convertis en euros.',
                  'La donation soutient directement l’association Elysium.',
                ]
              : [
                  `${fmtCoins(pending.coins)} ElyCoins seront débités (soit ${fmtEuros(pending.coins)}).`,
                  `Le paiement sera envoyé à ${paypalEmail || 'votre compte PayPal'} après traitement.`,
                  'Le délai de traitement dépend de PayPal ; vous serez notifié du résultat.',
                ]
            : []
        }
        onConfirm={() => { if (pending) return runConversion(pending.type, pending.coins); }}
        onClose={() => setPending(null)}
        testId="wallet-confirm-sheet"
      />
    </div>
  );
}
