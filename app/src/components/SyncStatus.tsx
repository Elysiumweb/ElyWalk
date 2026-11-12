import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { currentSyncState, flushSyncQueue, retryFailedSync, subscribeQueue, watchConnectivity, type SyncState } from '../lib/syncQueue';

/**
 * Bandeau de synchronisation (F04).
 *
 * Une sortie vécue hors connexion doit se voir : tant qu'une tâche est en
 * attente, l'utilisateur lit « Synchronisation en attente » et peut relancer
 * l'envoi. Le bandeau disparaît de lui-même une fois la file vide, ce qui donne
 * une confirmation observable plutôt qu'une promesse implicite.
 */
export default function SyncStatus() {
  const [state, setState] = useState<SyncState>(currentSyncState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeQueue(setState), []);

  // Reprise au retour au premier plan : c'est le moment le plus probable où le
  // réseau est revenu sans que la WebView ait reçu d'événement `online`.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | null = null;
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void flushSyncQueue();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  useEffect(() => watchConnectivity(), []);

  if (state.pending === 0 && state.failed === 0) return null;

  const retry = async () => {
    setBusy(true);
    try { await retryFailedSync(); } finally { setBusy(false); }
  };

  const failed = state.failed > 0;
  return (
    <div
      className={`sync-status ${failed ? 'is-error' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="sync-status"
    >
      <span className="sync-status-text">
        {failed
          ? `Envoi impossible (${state.failed})`
          : `${state.pending} sortie${state.pending > 1 ? 's' : ''} en attente de synchronisation`}
      </span>
      <button type="button" className="sync-status-action" onClick={retry} disabled={busy || state.running}>
        {busy || state.running ? 'Envoi…' : 'Réessayer'}
      </button>
    </div>
  );
}
