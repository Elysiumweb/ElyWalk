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
import { Skeleton } from '../components/AsyncState';

type ConversionType = 'paypal' | 'donation';

const QUICK_AMOUNTS = [
  { id: '25', label: '25 %', ratio: 0.25 },
  { id: '50', label: '50 %', ratio: 0.5 },
  { id: 'max', label: 'Max', ratio: 1 },
];

const hintStyle = { color: 'var(--muted)', fontSize: 13 };
const errorStyle = { color: 'var(--danger)', fontSize: 13, marginTop: 6 };

const formatTime = (value: number) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const dayLabel = (value: number) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Aujourd’hui';
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
  });
};

function groupByDay<T extends { createdAt: number }>(items: T[]) {
  const groups: { key: string; label: string; items: T[] }[] = [];
  items.forEach((item) => {
    const key = new Date(item.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.createdAt), items: [item] });
  });
  return groups;
}

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
  const [txLoading, setTxLoading] = useState(true);
  const [wdLoading, setWdLoading] = useState(true);
  const [historyTab, setHistoryTab] = useState<'tx' | 'wd'>('tx');
  const [attempted, setAttempted] = useState(false);

  const isExcluded = isPresidentUid(profile?.uid);
  const balance = profile?.elycoins || 0;
  const missingCoins = Math.max(0, MIN_PAYPAL_COINS - balance);
  const canWithdraw = missingCoins === 0;
  const progress = Math.min(100, Math.round((balance / MIN_PAYPAL_COINS) * 100));

  const reload = () => {
    if (!profile) return;
    listMyWithdrawals(profile.uid).then(setWithdrawals).catch(() => undefined).finally(() => setWdLoading(false));
    listMyTransactions(profile.uid).then(setTransactions).catch(() => undefined).finally(() => setTxLoading(false));
  };

  useEffect(reload, [profile?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (profile?.paypalEmail) setPaypalEmail(profile.paypalEmail);
  }, [profile?.paypalEmail]);

  // Confirmation explicite avant toute opération (D06) ; une annulation conserve la saisie.
  const [pending, setPending] = useState<{ type: ConversionType; coins: number } | null>(null);

  const submit = async (type: ConversionType) => {
    if (!profile) return;
    setAttempted(true);
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

  const runConversion = async (type: ConversionType, coins: number) => {
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
      setAttempted(false);
      reload();
    } catch (e) {
      // Échec : la confirmation reste ouverte avec la saisie, pour réessayer sans ressaisir.
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openSheet = (type: ConversionType) => {
    setAttempted(false);
    if (type === 'paypal') setPaypalOpen(true);
    else setDonateOpen(true);
  };

  const amountCoins = Math.floor(Number(amount));
  const amountValid = Number.isFinite(amountCoins) && amountCoins > 0;
  const amountError = (type: ConversionType) => {
    if (amount.trim() === '' && !attempted) return null;
    if (!amountValid) return 'Saisissez un montant valide.';
    if (type === 'paypal' && amountCoins < MIN_PAYPAL_COINS) return `Minimum ${MIN_PAYPAL_COINS} ElyCoins (1 €) pour un retrait.`;
    if (amountCoins > balance) return `Ce montant dépasse votre solde de ${fmtCoins(balance)} EC.`;
    return null;
  };
  const emailError = (paypalEmail.trim() !== '' || attempted) && !paypalEmail.includes('@')
    ? 'Renseignez une adresse PayPal valide.'
    : null;
  const paypalAmountError = amountError('paypal');
  const donateAmountError = amountError('donation');

  const quickAmounts = (prefix: string) => (
    <div className="chip-row" style={{ marginTop: 8 }} data-testid={`${prefix}-quick-amounts`}>
      {QUICK_AMOUNTS.map((q) => (
        <button
          key={q.id}
          type="button"
          className="chip"
          disabled={balance <= 0}
          onClick={() => setAmount(String(Math.floor(balance * q.ratio)))}
          aria-label={`Utiliser ${q.label} du solde`}
          data-testid={`${prefix}-quick-amount-${q.id}`}
        >
          {q.label}
        </button>
      ))}
    </div>
  );

  const transactionIcon = (type: CoinTransaction['type']) => ({ steps: '👟', ad: '▶', referral: '🤝', paypal: '↗', donation: '♥', partner: '✦', challenge: '🏆' }[type]);

  const statusBadge = (s: Withdrawal['status']) => {
    if (s === 'paid') return <span className="badge badge-success">Payé</span>;
    if (s === 'rejected') return <span className="badge badge-danger">Refusé</span>;
    if (s === 'received') return <span className="badge badge-success">Reçue 💛</span>;
    return <span className="badge badge-muted">En attente</span>;
  };

  const dayHeading = (label: string) => (
    <div className="row-sub" style={{ fontWeight: 600, marginTop: 16, textTransform: 'capitalize' }} data-testid="history-day-heading">
      {label}
    </div>
  );

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
          {fmtCoins(balance)} <span style={{ fontSize: 17 }}>EC</span>
        </div>
        <div className="gc-euro" data-testid="wallet-euro-value">
          ≈ {coinsToEuros(balance).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
        </div>
        {!isExcluded && (
          <div style={{ marginTop: 14 }} data-testid="withdraw-progress">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Progression vers le minimum de retrait"
              style={{ position: 'relative', height: 4, borderRadius: 4, overflow: 'hidden' }}
            >
              <div style={{ position: 'absolute', inset: 0, background: 'currentColor', opacity: 0.2 }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${progress}%`, background: 'currentColor' }} />
            </div>
            <div className="gc-label" style={{ marginTop: 8 }} data-testid="withdraw-progress-label">
              {canWithdraw
                ? 'Retrait disponible'
                : `Il vous manque ${fmtCoins(missingCoins)} EC pour retirer (minimum ${fmtCoins(MIN_PAYPAL_COINS)} EC)`}
            </div>
          </div>
        )}
      </div>

      {isExcluded && (
        <div className="card" data-testid="president-excluded-notice">
          <p style={hintStyle}>
            👑 En tant que {profile?.role === 'president' ? 'Président' : 'Co-Président'}, vous êtes
            exclu de la conversion en argent et des avantages partenaires mais vos ElyCoins
            comptent au classement ! Les donations restent possibles.
          </p>
        </div>
      )}

      <div className="card wallet-actions">
        <div className="card-title">Actions</div>
        {!isExcluded && (
          <>
            <button
              type="button"
              className="btn btn-gold"
              onClick={() => openSheet('paypal')}
              disabled={!canWithdraw}
              aria-describedby={canWithdraw ? undefined : 'withdraw-disabled-reason'}
              data-testid="paypal-withdraw-button"
            >
              Retirer via PayPal
            </button>
            {!canWithdraw && (
              <p id="withdraw-disabled-reason" style={{ ...hintStyle, marginTop: 8 }} data-testid="withdraw-disabled-reason">
                Retrait possible à partir de {fmtCoins(MIN_PAYPAL_COINS)} EC (1 €). Encore {fmtCoins(missingCoins)} EC à gagner.
              </p>
            )}
          </>
        )}
        <div className="secondary-actions">
          <button type="button" className="text-button" onClick={() => openSheet('donation')} data-testid="donate-button">Faire un don</button>
          <button type="button" className="text-button" onClick={() => navigate('/partners')} data-testid="partner-offers-button">Offres partenaires</button>
        </div>
      </div>

      <div className="card">
        <div className="chip-row" role="tablist" aria-label="Historique du portefeuille">
          <button
            type="button"
            role="tab"
            aria-selected={historyTab === 'tx'}
            className={`chip ${historyTab === 'tx' ? 'chip-active' : ''}`}
            onClick={() => setHistoryTab('tx')}
            data-testid="history-tab-transactions"
          >
            Historique
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={historyTab === 'wd'}
            className={`chip ${historyTab === 'wd' ? 'chip-active' : ''}`}
            onClick={() => setHistoryTab('wd')}
            data-testid="history-tab-withdrawals"
          >
            Retraits &amp; dons
          </button>
        </div>

        {historyTab === 'tx' &&
          (txLoading ? (
            <Skeleton rows={4} label="Chargement de l’historique" />
          ) : transactions.length === 0 ? (
            <div className="empty-state" data-testid="transactions-empty-state">
              <div className="display">Aucune transaction</div>
              Validez vos pas pour gagner vos premiers ElyCoins !
            </div>
          ) : (
            groupByDay(transactions).map((group) => (
              <div key={group.key} data-testid="transaction-day-group">
                {dayHeading(group.label)}
                {group.items.map((t) => (
                  <div className="list-row" key={t.id} data-testid="transaction-row">
                    <span className="transaction-icon" aria-hidden="true">{transactionIcon(t.type)}</span>
                    <div className="row-main">
                      <div className="row-title" style={{ fontSize: 14 }}>{t.note}</div>
                      <div className="row-sub">{formatTime(t.createdAt)}</div>
                    </div>
                    <div
                      className="row-value"
                      style={{ color: t.coins >= 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}
                      aria-label={`${t.coins >= 0 ? 'Gain de' : 'Dépense de'} ${fmtCoins(Math.abs(t.coins))} ElyCoins`}
                    >
                      {t.coins >= 0 ? '+' : ''}{fmtCoins(t.coins)} EC
                    </div>
                  </div>
                ))}
              </div>
            ))
          ))}

        {historyTab === 'wd' &&
          (wdLoading ? (
            <Skeleton rows={3} label="Chargement des retraits et dons" />
          ) : withdrawals.length === 0 ? (
            <div className="empty-state" data-testid="withdrawals-empty-state">
              <div className="display">Aucun retrait ni don</div>
            </div>
          ) : (
            groupByDay(withdrawals).map((group) => (
              <div key={group.key} data-testid="withdrawal-day-group">
                {dayHeading(group.label)}
                {group.items.map((w) => (
                  <div className="list-row" key={w.id} data-testid="withdrawal-row">
                    <div className="row-main">
                      <div className="row-title" style={{ fontSize: 14 }}>
                        {w.type === 'paypal' ? `PayPal · ${w.paypalEmail}` : w.type === 'donation' ? 'Donation Elysium' : 'Partenaire'}
                      </div>
                      <div className="row-sub">
                        {fmtCoins(w.coins)} EC · {formatTime(w.createdAt)}
                      </div>
                    </div>
                    {statusBadge(w.status)}
                  </div>
                ))}
              </div>
            ))
          ))}
      </div>

      {/* Vrais formulaires : Entrée valide, libellés associés, saisie conservée en cas d'erreur (D06). */}
      <Sheet open={paypalOpen} onClose={() => setPaypalOpen(false)} title="Retrait PayPal" testId="paypal-sheet">
        <form noValidate onSubmit={(event) => { event.preventDefault(); void submit('paypal'); }}>
          <p style={{ ...hintStyle, marginBottom: 14 }}>
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
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'paypal-email-error' : undefined}
              data-testid="paypal-email-input"
            />
            {emailError && (
              <div id="paypal-email-error" role="alert" style={errorStyle} data-testid="paypal-email-error">{emailError}</div>
            )}
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
              aria-invalid={!!paypalAmountError}
              aria-describedby={paypalAmountError ? 'paypal-amount-error' : 'paypal-amount-hint'}
              data-testid="paypal-amount-input"
            />
            {quickAmounts('paypal')}
            {paypalAmountError ? (
              <div id="paypal-amount-error" role="alert" style={errorStyle} data-testid="paypal-amount-error">{paypalAmountError}</div>
            ) : (
              <div id="paypal-amount-hint" style={{ ...hintStyle, marginTop: 6 }} data-testid="paypal-amount-euros">
                {amountValid
                  ? <span style={{ color: 'var(--gold)' }}>Vous recevrez {fmtEuros(amountCoins)}</span>
                  : `Solde disponible : ${fmtCoins(balance)} EC`}
              </div>
            )}
          </div>
          <button className="btn btn-gold" type="submit" disabled={busy} data-testid="confirm-paypal-button">
            {busy ? '…' : 'Demander le retrait'}
          </button>
        </form>
      </Sheet>

      <Sheet open={donateOpen} onClose={() => setDonateOpen(false)} title="Donation à Elysium" testId="donate-sheet">
        <form noValidate onSubmit={(event) => { event.preventDefault(); void submit('donation'); }}>
          <p style={{ ...hintStyle, marginBottom: 14 }}>
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
              aria-invalid={!!donateAmountError}
              aria-describedby={donateAmountError ? 'donate-amount-error' : 'donate-amount-hint'}
              data-testid="donate-amount-input"
            />
            {quickAmounts('donate')}
            {donateAmountError ? (
              <div id="donate-amount-error" role="alert" style={errorStyle} data-testid="donate-amount-error">{donateAmountError}</div>
            ) : (
              <div id="donate-amount-hint" style={{ ...hintStyle, marginTop: 6 }} data-testid="donate-amount-euros">
                {amountValid
                  ? <span style={{ color: 'var(--gold)' }}>Soit un don d’une valeur de {fmtEuros(amountCoins)}</span>
                  : `Solde disponible : ${fmtCoins(balance)} EC`}
              </div>
            )}
          </div>
          <button className="btn btn-gold" type="submit" disabled={busy} data-testid="confirm-donate-button">
            {busy ? '…' : 'Faire le don'}
          </button>
        </form>
      </Sheet>

      {/* Confirmation structurée : le résultat est annoncé avant validation (débit, montant, délai). */}
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
