import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Bottom sheet accessible : fermeture Escape, focus piégé et retour du focus.
 *
 * Le focus initial n'est donné à la feuille que si l'utilisateur n'est pas déjà
 * dans un champ de saisie. Auparavant, la première itération de l'effet visait
 * le premier élément focusable — la croix de fermeture — et le faisait à chaque
 * rendu du parent (identité de `onClose` changée) : la saisie perdait le focus
 * à chaque lettre tapée dans le pseudo, la bio, la recherche, etc.
 */
export default function Sheet({ open, onClose, title, children, testId }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    const focusables = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );

    // Ne jamais voler le focus à un champ déjà en cours de saisie : la feuille
    // ne doit pas rejouer son focus à chaque frappe.
    const active = document.activeElement as HTMLElement | null;
    const alreadyInside = !!active && !!sheet && sheet.contains(active);
    if (!alreadyInside) {
      requestAnimationFrame(() => {
        if (!sheet) return;
        const current = document.activeElement as HTMLElement | null;
        if (current && sheet.contains(current)) return;
        sheet.focus();
      });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Focus rendu au déclencheur uniquement s'il est toujours dans la page.
      const prev = previousFocus.current;
      if (prev && prev.isConnected) prev.focus();
    };
    // `onClose` volontairement absent : une nouvelle identité de la fonction à
    // chaque rendu ne doit pas relancer l'effet (cf. commentaire ci-dessus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={onClose} data-testid={testId || 'bottom-sheet'}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Fenêtre'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {title && <h3 className="sheet-title">{title}</h3>}
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
