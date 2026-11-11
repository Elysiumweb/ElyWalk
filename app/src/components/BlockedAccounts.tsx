import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { useI18n } from '../context/LocaleContext';
import { unblockAccount, watchBlockedAccounts } from '../lib/safety';
import type { BlockedAccount } from '../lib/types';

export default function BlockedAccounts() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<BlockedAccount[]>([]);
  useEffect(() => profile ? watchBlockedAccounts(profile.uid, setItems) : undefined, [profile?.uid]);
  const unblock = async (item: BlockedAccount) => {
    if (!profile) return;
    try { await unblockAccount(profile.uid, item.blockedUid); toast(`${item.blockedName} n’est plus bloqué.`, 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  return <div className="card" data-testid="blocked-accounts"><div className="card-title">{t('safety.blocked')} ({items.length})</div><p className="card-help">Les comptes bloqués sont masqués de vos recherches et ne peuvent plus vous envoyer de demandes, messages ou encouragements. Vous ne pouvez pas non plus interagir avec eux. Le blocage ne supprime pas les signalements.</p>{items.length === 0 ? <div className="empty-state">{t('safety.none')}</div> : items.map(item => <div className="list-row" key={item.id}><div className="row-main"><div className="row-title">{item.blockedName}</div><div className="row-sub">Bloqué le {formatDate(item.createdAt)}</div></div><button className="btn btn-outline btn-sm" onClick={() => void unblock(item)}>{t('safety.unblock')}</button></div>)}</div>;
}
