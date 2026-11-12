import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  buildDiagnosticsReport,
  clearDiagnostics,
  deviceInfo,
  readDiagnostics,
  subscribeDiagnostics,
  type LogEntry,
} from '../lib/diagnostics';
import { currentSyncState, retryFailedSync, subscribeQueue, type SyncState } from '../lib/syncQueue';
import { getAdConsent } from '../lib/adConsent';
import { notificationDiagnostics } from '../lib/notifications';
import { shareJsonFile } from '../lib/export';

/**
 * Écran « Diagnostic » (F06).
 *
 * Donne à l'utilisateur les moyens de décrire une panne sans capture d'écran
 * floue, et au développement un rapport reproductible. Le rapport est **local**
 * et n'est partagé que sur action explicite : rien ne part automatiquement.
 */
export default function DiagnosticsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<LogEntry[]>(readDiagnostics());
  const [sync, setSync] = useState<SyncState>(currentSyncState());
  const [consent, setConsent] = useState('inconnu');
  const [notifications, setNotifications] = useState('en cours');
  const [scheduled, setScheduled] = useState(0);

  useEffect(() => subscribeDiagnostics(setEntries), []);
  useEffect(() => subscribeQueue(setSync), []);
  useEffect(() => {
    getAdConsent().then(setConsent).catch(() => setConsent('inconnu'));
    notificationDiagnostics()
      .then((d) => {
        setNotifications(`permission ${d.permission}${d.token ? ' · jeton enregistré' : ' · aucun jeton'}`);
        setScheduled(d.scheduledReminders);
      })
      .catch(() => setNotifications('indisponible'));
  }, []);

  const info = useMemo(() => deviceInfo(), []);
  const report = useMemo(
    () => buildDiagnosticsReport({
      pendingSync: sync.pending + sync.failed,
      adConsent: consent,
      notifications,
      uid: user?.uid,
    }),
    [sync.pending, sync.failed, consent, notifications, user?.uid],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast('Rapport copié.', 'success');
    } catch {
      toast('Copie impossible sur cet appareil.', 'error');
    }
  };

  const share = async () => {
    try {
      await shareJsonFile(
        JSON.stringify({ report, entries }, null, 2),
        `elywalk-diagnostic-${new Date().toISOString().slice(0, 10)}.json`,
        'Diagnostic ElyWalk',
      );
      toast('Rapport envoyé.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="screen" data-testid="diagnostics-screen">
      <div className="screen-header">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Diagnostic</h1>
      </div>

      <div className="card">
        <div className="card-title">Appareil</div>
        <ul className="diagnostics-list">
          <li><span>Version</span><strong>{info.version}</strong></li>
          <li><span>Plateforme</span><strong>{info.platform}{info.native ? ' · natif' : ' · web'}</strong></li>
          <li><span>Écran</span><strong>{info.screen} @{info.pixelRatio}x</strong></li>
          <li><span>Réseau</span><strong>{info.online ? 'en ligne' : 'hors connexion'}</strong></li>
          <li><span>Notifications</span><strong>{notifications}</strong></li>
          <li><span>Consentement pub.</span><strong>{consent}</strong></li>
          <li><span>Synchronisation</span><strong>{sync.pending + sync.failed} en attente</strong></li>
          <li><span>Rappels programmés</span><strong>{scheduled}</strong></li>
        </ul>
        {sync.pending + sync.failed > 0 ? (
          <button className="btn btn-outline" onClick={() => void retryFailedSync()} disabled={sync.running}>
            {sync.running ? 'Envoi…' : 'Réessayer maintenant'}
          </button>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">Journal ({entries.length})</div>
        {entries.length === 0 ? (
          <p className="muted-xs">Aucune anomalie enregistrée. C’est bon signe.</p>
        ) : (
          <ul className="diagnostics-list diagnostics-log">
            {entries.slice().sort((a, b) => b.at - a.at).map((entry) => (
              <li key={entry.signature}>
                <span>{new Date(entry.at).toLocaleTimeString()} · {entry.scope}{entry.count > 1 ? ` ×${entry.count}` : ''}</span>
                <strong>{entry.message}</strong>
              </li>
            ))}
          </ul>
        )}
        <div className="row-gap">
          <button className="btn btn-gold" onClick={copy} data-testid="copy-diagnostics">Copier le rapport</button>
          <button className="btn btn-outline" onClick={share}>Envoyer le rapport</button>
          <button className="btn btn-ghost" onClick={() => { clearDiagnostics(); toast('Journal vidé.', 'info'); }}>Vider</button>
        </div>
        <p className="muted-xs">
          Le rapport ne contient ni coordonnées GPS, ni adresse e-mail, ni contenu de message.
          Il n’est transmis que si vous choisissez de l’envoyer.
        </p>
      </div>
    </div>
  );
}
