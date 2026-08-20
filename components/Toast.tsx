import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  confirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  confirm: () => Promise.resolve(false),
});

export const useToast = () => useContext(ToastContext);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const COLORS = {
  success: { bg: '#f0fdf4', border: '#c3dfd4', icon: '#16a34a', text: '#2d6a4f' },
  error:   { bg: '#fef2f2', border: '#fecaca', icon: '#dc2626', text: '#991b1b' },
  info:    { bg: '#f0f6ff', border: '#bfdbfe', icon: '#2563eb', text: '#1e40af' },
  warning: { bg: '#fefce8', border: '#fde68a', icon: '#d97706', text: '#92400e' },
};

// Confirm dialog component
function ConfirmDialog({ message, onYes, onNo }: { message: string; onYes: () => void; onNo: () => void }) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '20px', padding: '28px', maxWidth: '380px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={18} style={{ color: '#dc2626' }} />
          </div>
          <p style={{ fontSize: '14px', color: '#1B263B', lineHeight: 1.6, margin: 0, fontWeight: 600 }}>{message}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onNo} style={{ padding: '9px 20px', background: '#f4f1ec', border: '1.5px solid #e8e4dc', borderRadius: '12px', fontSize: '13px', fontWeight: 700, color: '#78716c', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={onYes} style={{ padding: '9px 20px', background: '#dc2626', border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: 900, color: '#fff', cursor: 'pointer' }}>
            Confirmar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message, duration }]);
    if (duration > 0) setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmState({ message, resolve });
    });
  }, []);

  const handleConfirm = (result: boolean) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={{ toast, confirm }}>
      {children}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onYes={() => handleConfirm(true)}
          onNo={() => handleConfirm(false)}
        />
      )}
      {createPortal(
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '380px', width: '100%' }}>
          {toasts.map(t => {
            const Icon = ICONS[t.type];
            const c = COLORS[t.type];
            return (
              <div key={t.id} style={{ background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', boxShadow: '0 4px 20px rgba(0,0,0,.08)', animation: 'slideInRight .25s ease' }}>
                <Icon size={18} style={{ color: c.icon, flexShrink: 0, marginTop: '1px' }} />
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: c.text, flex: 1, lineHeight: 1.5 }}>{t.message}</p>
                <button onClick={() => removeToast(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.icon, padding: '0', flexShrink: 0, opacity: 0.7 }}>
                  <X size={15} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
