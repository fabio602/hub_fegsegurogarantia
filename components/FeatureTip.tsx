import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Lightbulb } from 'lucide-react';

const STORAGE_KEY = 'fg_hub_seen_tips';

function getSeenTips(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function markSeen(id: string) {
  const seen = getSeenTips();
  seen.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
}

export function useTipSeen(id: string): boolean {
  return getSeenTips().has(id);
}

interface FeatureTipProps {
  id: string;           // unique ID, stored in localStorage
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactElement;
}

export function FeatureTip({ id, title, description, position = 'bottom', children }: FeatureTipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (getSeenTips().has(id)) return;
    // Small delay so layout is settled
    const timer = setTimeout(() => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const scrollY = window.scrollY;
      let top = rect.bottom + scrollY + 10;
      let left = rect.left + rect.width / 2 - 170;
      if (position === 'top') top = rect.top + scrollY - 10;
      if (position === 'right') { left = rect.right + 10; top = rect.top + scrollY; }
      if (position === 'left') { left = rect.left - 350; top = rect.top + scrollY; }
      // Keep within viewport
      left = Math.max(8, Math.min(left, window.innerWidth - 348));
      setCoords({ top, left });
      setVisible(true);
    }, 800);
    return () => clearTimeout(timer);
  }, [id, position]);

  const dismiss = () => {
    setVisible(false);
    markSeen(id);
  };

  return (
    <>
      <div ref={ref} style={{ display: 'contents' }}>{children}</div>
      {visible && createPortal(
        <>
          {/* Backdrop highlight */}
          <div onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 8998 }} />
          {/* Tooltip */}
          <div style={{
            position: 'absolute', top: coords.top, left: coords.left,
            width: '340px', background: '#1B263B', borderRadius: '16px',
            padding: '16px 18px', zIndex: 8999, boxShadow: '0 12px 40px rgba(0,0,0,.25)',
            animation: 'fadeInUp .3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ width: '30px', height: '30px', background: '#C69C6D20', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Lightbulb size={16} style={{ color: '#C69C6D' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 900, color: '#fff' }}>{title}</p>
                <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,.65)', lineHeight: 1.5 }}>{description}</p>
              </div>
              <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.4)', padding: '2px', flexShrink: 0 }}>
                <X size={15} />
              </button>
            </div>
            <button onClick={dismiss} style={{ marginTop: '12px', width: '100%', padding: '9px', background: '#C69C6D', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: 900, color: '#1B263B', cursor: 'pointer' }}>
              Entendi! ✓
            </button>
            {/* Arrow */}
            <div style={{ position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid #1B263B' }} />
          </div>
          <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
        </>,
        document.body
      )}
    </>
  );
}

// Utility to reset all tips (for testing)
export function resetAllTips() {
  localStorage.removeItem(STORAGE_KEY);
}
