import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testId?: string;
}

/** Bottom sheet accessible: fermeture Escape, focus piégé et retour du focus. */
export default function Sheet({ open, onClose, title, children, testId }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const sheet = sheetRef.current;
    const focusables = () => Array.from(sheet?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
    requestAnimationFrame(() => (focusables()[0] || sheet)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus.current?.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={onClose} data-testid={testId || 'bottom-sheet'}>
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-label={title || 'Fenêtre'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        {title && <h3 className="sheet-title">{title}</h3>}
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Fermer">✕</button>
        {children}
      </div>
    </div>
  );
}
