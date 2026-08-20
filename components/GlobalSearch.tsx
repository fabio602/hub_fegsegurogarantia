import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Home, Users, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase.ts';

interface SearchResult {
  id: string | number;
  type: 'sale' | 'residential' | 'prospect';
  title: string;
  subtitle: string;
  view: string;
  meta?: string;
}

interface GlobalSearchProps {
  onNavigate: (view: string) => void;
}

const TYPE_CONFIG = {
  sale:        { icon: Shield,   label: 'Garantia',    color: '#1d4ed8' },
  residential: { icon: Home,     label: 'Residencial', color: '#16a34a' },
  prospect:    { icon: Users,    label: 'Prospect',    color: '#C69C6D' },
};

export function GlobalSearch({ onNavigate }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Open on Ctrl+K or Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(''); setResults([]); setSelected(0); }
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const [salesRes, resRes, prospRes] = await Promise.allSettled([
        supabase.from('sales').select('id, nome, cnpj, seguradora, vendedor').ilike('nome', `%${q}%`).limit(5),
        supabase.from('residential_clients').select('id, nome, cpf, situacao, apolice').ilike('nome', `%${q}%`).limit(5),
        supabase.from('prospects').select('id, nome, empresa, status').ilike('nome', `%${q}%`).limit(3),
      ]);
      const combined: SearchResult[] = [
        ...(salesRes.status === 'fulfilled' && salesRes.value.data ? salesRes.value.data.map((s: any) => ({
          id: s.id, type: 'sale' as const,
          title: s.nome || '—',
          subtitle: [s.seguradora, s.vendedor].filter(Boolean).join(' · '),
          meta: s.cnpj,
          view: 'goals',
        })) : []),
        ...(resRes.status === 'fulfilled' && resRes.value.data ? resRes.value.data.map((r: any) => ({
          id: r.id, type: 'residential' as const,
          title: r.nome || '—',
          subtitle: `${r.situacao || '—'}${r.apolice ? ' · Apólice ' + r.apolice : ''}`,
          meta: r.cpf,
          view: 'residential',
        })) : []),
        ...(prospRes.status === 'fulfilled' && prospRes.value.data ? prospRes.value.data.map((p: any) => ({
          id: p.id, type: 'prospect' as const,
          title: p.nome || '—',
          subtitle: [p.empresa, p.status].filter(Boolean).join(' · '),
          view: 'prospeccao',
        })) : []),
      ];
      setResults(combined);
      setSelected(0);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[selected]) {
      onNavigate(results[selected].view);
      setOpen(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh' }}
      onClick={() => setOpen(false)}>
      <div style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '580px', margin: '0 16px', boxShadow: '0 24px 80px rgba(0,0,0,.25)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', borderBottom: '1px solid #f0ece4' }}>
          <Search size={18} style={{ color: '#94a3b8', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar clientes, vendas, prospects..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '15px', color: '#1B263B', background: 'transparent' }}
          />
          {query && <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={15} /></button>}
          <kbd style={{ fontSize: '11px', background: '#f4f1ec', border: '1px solid #e8e4dc', borderRadius: '6px', padding: '2px 6px', color: '#78716c', flexShrink: 0 }}>ESC</kbd>
        </div>
        {/* Results */}
        {loading && <div style={{ padding: '20px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>Buscando...</div>}
        {!loading && query.length >= 2 && results.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
            Nenhum resultado para "<strong>{query}</strong>"
          </div>
        )}
        {!loading && results.length > 0 && (
          <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
            {results.map((r, i) => {
              const cfg = TYPE_CONFIG[r.type];
              const Icon = cfg.icon;
              return (
                <div key={`${r.type}-${r.id}`}
                  onClick={() => { onNavigate(r.view); setOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', cursor: 'pointer', background: i === selected ? '#f8f5f0' : '#fff', borderBottom: '1px solid #f8f5f0', transition: 'background .1s' }}
                  onMouseEnter={() => setSelected(i)}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: cfg.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} style={{ color: cfg.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#1B263B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>{r.subtitle}</div>
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: 900, background: cfg.color + '18', color: cfg.color, padding: '2px 8px', borderRadius: '20px', flexShrink: 0 }}>{cfg.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {!query && (
          <div style={{ padding: '20px 24px' }}>
            <p style={{ fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px', color: '#94a3b8', marginBottom: '12px' }}>Atalhos de teclado</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                ['Ctrl + K', 'Busca global'],
                ['↑ ↓', 'Navegar resultados'],
                ['Enter', 'Abrir selecionado'],
                ['Esc', 'Fechar'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#78716c' }}>{desc}</span>
                  <kbd style={{ fontSize: '11px', background: '#f4f1ec', border: '1px solid #e8e4dc', borderRadius: '6px', padding: '2px 8px', color: '#1B263B', fontWeight: 700 }}>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
