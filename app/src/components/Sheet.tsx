import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testId?: string;
}

/** Bottom sheet simple, monté au-dessus de tout. */
export default function Sheet({ open, onClose, title, children, testId }: SheetProps) {
  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={onClose} data-testid={testId || 'bottom-sheet'}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
