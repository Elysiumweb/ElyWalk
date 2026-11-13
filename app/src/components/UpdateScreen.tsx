import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../context/LocaleContext';
import { APP_VERSION_LABEL } from '../lib/version';
import { openPlayStore, snoozeUpdate } from '../lib/appUpdate';
import type { UpdateDecision } from '../lib/appRelease';

/**
 * Écran de mise à jour (exigence produit).
 *
 * Il s'affiche **au lancement**, avant l'application, dès que la version
 * installée est plus ancienne que celle publiée sur le Play Store :
 *  - mise à jour **recommandée** : « Plus tard » est proposé et le message ne
 *    revient pas avant 24 h (report mémorisé pour cette version précise) ;
 *  - mise à jour **obligatoire** : aucun bouton de fermeture, pas de touche
 *    Échap, pas de clic sur le fond — l'écran n'a qu'une issue, le Play Store.
 *
 * Il réutilise les styles de dialogue de l'application (`sheet-overlay`),
 * mais reste monté au niveau de l'application : un écran bloquant ne doit pas
 * dépendre du routeur ni être masqué par une navigation.
 */
export default function UpdateScreen({
  decision,
  onDismiss,
  testId = 'update-screen',
}: {
  decision: UpdateDecision;
  /** Appelé après un report réussi (ou une tentative d'ouverture du store). */
  onDismiss: () => void;
  testId?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const required = decision.severity === 'required';

  useEffect(() => {
    focusRef.current?.focus();
  }, []);

  // Échap ne doit rien faire sur une mise à jour obligatoire.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !required) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [required, onDismiss]);

  const update = async () => {
    setBusy(true);
    try {
      await openPlayStore();
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    if (required) return;
    setBusy(true);
    try {
      if (decision.latestVersion) await snoozeUpdate(decision.latestVersion);
    } finally {
      setBusy(false);
      onDismiss();
    }
  };

  return (
    <div
      className="sheet-overlay update-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      aria-describedby={`${testId}-desc`}
      data-testid={testId}
      data-severity={decision.severity}
      // Une mise à jour obligatoire ne se ferme pas en touchant le fond.
      onClick={required ? undefined : onDismiss}
    >
      <div
        className="sheet update-sheet"
        onClick={(event) => event.stopPropagation()}
        // Le dialogue prend le focus à l'ouverture : la touche Entrée n'active
        // pas un bouton resté derrière lui.
        tabIndex={-1}
        ref={focusRef}
      >
        <div className="update-emblem" aria-hidden="true">
          ⬆️
        </div>

        <h2 className="update-title" id={`${testId}-title`}>
          {required ? t('update.required.title') : t('update.recommended.title')}
        </h2>

        <p className="update-copy" id={`${testId}-desc`}>
          {required ? t('update.required.body') : t('update.recommended.body')}
        </p>

        <div className="update-versions">
          <span>
            <small>{t('update.installed')}</small>
            <strong data-testid="update-installed">{APP_VERSION_LABEL}</strong>
          </span>
          <span aria-hidden="true">→</span>
          <span>
            <small>{t('update.available')}</small>
            <strong data-testid="update-latest">ElyWalk {decision.latestVersion}</strong>
          </span>
        </div>

        {decision.notes ? (
          <div className="update-notes" data-testid="update-notes">
            <div className="update-notes-title">{t('update.whatsnew')}</div>
            <p>{decision.notes}</p>
          </div>
        ) : null}

        {required ? (
          <p className="update-warning" role="note">
            {t('update.required.note')}
          </p>
        ) : null}

        <div className="update-actions">
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => void update()}
            disabled={busy}
            data-testid="update-open-store"
          >
            {busy ? t('update.opening') : t('update.action')}
          </button>
          {!required && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void later()}
              disabled={busy}
              data-testid="update-later"
            >
              {t('update.later')}
            </button>
          )}
        </div>

        <p className="update-hint">{t('update.hint')}</p>
      </div>
    </div>
  );
}
