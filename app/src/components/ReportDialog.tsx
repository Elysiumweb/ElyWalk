import { useState } from 'react';
import Sheet from './Sheet';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { reportContent } from '../lib/safety';
import type { ContentReport, ReportTargetType } from '../lib/types';

const reasons: Array<{ value: ContentReport['reason']; label: string }> = [
  { value: 'harassment', label: 'Harcèlement ou intimidation' },
  { value: 'spam', label: 'Spam ou arnaque' },
  { value: 'inappropriate', label: 'Contenu inapproprié' },
  { value: 'safety', label: 'Menace ou mise en danger' },
  { value: 'other', label: 'Autre motif' },
];

export default function ReportDialog({ open, onClose, targetUid, targetType, targetId }: {
  open: boolean;
  onClose: () => void;
  targetUid: string;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState<ContentReport['reason']>('harassment');
  const [details, setDetails] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!profile || !confirmed) return;
    setBusy(true);
    try {
      await reportContent(profile, { targetUid, targetType, targetId, reason, details });
      toast('Signalement transmis. Les modérateurs vont l’examiner.', 'success');
      setDetails(''); setConfirmed(false); onClose();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  return <Sheet open={open} onClose={onClose} title="Signaler ce contenu" testId="report-dialog">
    <p className="card-help">Votre signalement est confidentiel. La personne signalée ne connaît pas votre identité.</p>
    <div className="field"><label htmlFor="report-reason">Motif</label><select id="report-reason" className="input" value={reason} onChange={e => setReason(e.target.value as ContentReport['reason'])}>{reasons.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
    <div className="field"><label htmlFor="report-details">Précisions {reason === 'other' ? '(obligatoires)' : '(facultatif)'}</label><textarea id="report-details" className="input" rows={4} maxLength={1000} value={details} onChange={e => setDetails(e.target.value)} placeholder="Décrivez les faits sans ajouter de données sensibles." /></div>
    <label className="check-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Je confirme que ce signalement est sincère.</label>
    <button className="btn btn-danger" onClick={submit} disabled={!confirmed || busy || (reason === 'other' && details.trim().length < 10)} data-testid="confirm-report">{busy ? 'Envoi…' : 'Confirmer le signalement'}</button>
  </Sheet>;
}
