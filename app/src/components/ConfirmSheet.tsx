import { useEffect, useRef, useState } from 'react';
import Sheet from './Sheet';

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  /** Conséquences de l'action, une ligne par point. */
  consequences?: string[];
  /** Texte du bouton de confirmation. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action irréversible ou coûteuse : présentation rouge, séparée du reste. */
  danger?: boolean;
  /** Champ texte facultatif (encouragement, note…) envoyé avec la confirmation. */
  textField?: { label: string; placeholder?: string; maxLength?: number; required?: boolean };
  /** Valeur initiale du champ texte (ex. note de modération pré-remplie). */
  initialText?: string;
  busy?: boolean;
  onConfirm: (text: string) => void | Promise<void>;
  onClose: () => void;
  testId?: string;
}

/**
 * Confirmation structurée, en remplacement de `confirm()` / `prompt()` (D06).
 *
 * Les boîtes natives du navigateur (et de la WebView) ne disent pas *ce qui va
 * se passer*, ne se mettent pas en forme, ne sont pas traduisibles et cassent
 * le parcours clavier sur Android. Cette feuille :
 *  - énonce la conséquence **avant** le bouton de validation ;
 *  - sépare visuellement les actions dangereuses (`danger`) ;
 *  - conserve la saisie si la validation échoue (pas d'effacement) ;
 *  - accepte la touche Entrée dans un champ texte ;
 *  - reste un dialogue accessible (Escape, focus piégé, retour du focus).
 */
export default function ConfirmSheet({
  open,
  title,
  consequences = [],
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  textField,
  initialText,
  busy = false,
  onConfirm,
  onClose,
  testId,
}: ConfirmSheetProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Réinitialise la saisie à chaque ouverture : une annulation ne laisse rien
  // traîner d'une action précédente.
  useEffect(() => {
    if (!open) {
      setText('');
      setError(null);
      return;
    }
    // Une note pré-remplie (modération) reste modifiable et survit à un échec.
    setText(initialText ?? '');
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, initialText]);

  const submit = async () => {
    if (busy) return;
    if (textField?.required && !text.trim()) {
      setError('Ce champ est nécessaire pour continuer.');
      return;
    }
    setError(null);
    await onConfirm(text.trim());
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} testId={testId || 'confirm-sheet'}>
      <form
        className={`confirm-body ${danger ? 'confirm-danger' : ''}`.trim()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {consequences.length > 0 && (
          <ul className="confirm-consequences">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {textField && (
          <div className="field">
            <label htmlFor={`confirm-text-${testId || 'default'}`}>{textField.label}</label>
            <input
              id={`confirm-text-${testId || 'default'}`}
              ref={inputRef}
              className="input"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError(null);
              }}
              placeholder={textField.placeholder}
              maxLength={textField.maxLength || 200}
              aria-invalid={!!error}
              aria-describedby={error ? `confirm-error-${testId || 'default'}` : undefined}
              data-testid="confirm-text-input"
            />
            {error && (
              <small className="field-error" id={`confirm-error-${testId || 'default'}`} role="alert">
                {error}
              </small>
            )}
          </div>
        )}

        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`btn ${danger ? 'btn-danger confirm-danger-action' : 'btn-gold'}`}
            disabled={busy}
            data-testid="confirm-submit"
          >
            {busy ? 'Traitement…' : confirmLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
