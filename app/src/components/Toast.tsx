import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

const ToastCtx = createContext<{
  toast: (message: string, kind?: Toast['kind']) => void;
}>({ toast: () => undefined });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" data-testid="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid="toast-message">
            <span>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Fermer la notification">✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
