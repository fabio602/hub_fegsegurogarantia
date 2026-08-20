import React, { useState, useEffect } from 'react';
import { AlertCircle, Clock, Users, FileText, ChevronRight, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase.ts';

interface ActionItem {
  id: string;
  type: 'urgent' | 'warning' | 'info';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action: string;
  view: string;
}

interface CommandCenterProps {
  onNavigate: (view: string) => void;
  userEmail?: string;
}

export function CommandCenter({ onNavigate }: CommandCenterProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ vendas30: 0, premio30: 0, renovacoes: 0, leads: 0 });
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = async () => {
    setLoading(true);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const em7  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const em30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const ha30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      const [venc7, venc30, pendImob, wppLeads, vendas30] = await Promise.allSettled([
        supabase.from('residential_clients').select('id', { count: 'exact', head: true }).eq('situacao', 'Ativo').gte('fim_vigencia', hoje).lte('fim_vigencia', em7),
        supabase.from('residential_clients').select('id', { count: 'exact', head: true }).eq('situacao', 'Ativo').gte('fim_vigencia', hoje).lte('fim_vigencia', em30),
        supabase.from('imobiliaria_clientes').select('id', { count: 'exact', head: true }).in('kanban_status', ['solicitado', 'atendimento_iniciado']),
        supabase.from('whatsapp_leads').select('id', { count: 'exact', head: true }).eq('bot_active', false),
        supabase.from('sales').select('id, premio').eq('vendeu', 'Sim').gte('data', ha30),
      ]);

      const newItems: ActionItem[] = [];

      const venc7Count = venc7.status === 'fulfilled' ? (venc7.value.count || 0) : 0;
      const venc30Count = venc30.status === 'fulfilled' ? (venc30.value.count || 0) : 0;
      const pendImobCount = pendImob.status === 'fulfilled' ? (pendImob.value.count || 0) : 0;
      const wppCount = wppLeads.status === 'fulfilled' ? (wppLeads.value.count || 0) : 0;
      const vendas30Data = vendas30.status === 'fulfilled' ? (vendas30.value.data || []) : [];

      if (venc7Count > 0) {
        newItems.push({
          id: 'venc7', type: 'urgent',
          icon: <AlertCircle size={16} />,
          title: `${venc7Count} apólice(s) vencendo esta semana`,
          subtitle: 'Contate os clientes para renovação imediata',
          action: 'Ver clientes', view: 'residential',
        });
      }

      if (pendImobCount > 0) {
        newItems.push({
          id: 'imob', type: 'warning',
          icon: <Clock size={16} />,
          title: `${pendImobCount} solicitação(ões) da imobiliária pendentes`,
          subtitle: 'Novas cotações aguardando sua análise',
          action: 'Atender agora', view: 'imobiliaria-repasse',
        });
      }

      if (wppCount > 0) {
        newItems.push({
          id: 'wpp', type: 'warning',
          icon: <Users size={16} />,
          title: `${wppCount} lead(s) no WhatsApp sem bot ativo`,
          subtitle: 'Conversas que precisam de atendimento humano',
          action: 'Ver WhatsApp', view: 'whatsapp',
        });
      }

      if (venc30Count > 0) {
        newItems.push({
          id: 'venc30', type: 'info',
          icon: <FileText size={16} />,
          title: `${venc30Count} apólice(s) vencendo em 30 dias`,
          subtitle: 'Programe as renovações com antecedência',
          action: 'Ver lista', view: 'residential',
        });
      }

      const totalPremio = vendas30Data.reduce((s: number, v: any) => {
        const raw = (v.premio || '0').toString().replace(/[^\d,]/g, '').replace(',', '.');
        const n = parseFloat(raw) || 0;
        return s + n;
      }, 0);

      setStats({
        vendas30: vendas30Data.length,
        premio30: totalPremio,
        renovacoes: venc30Count,
        leads: wppCount,
      });

      setItems(newItems);
      setLastUpdated(new Date());
    } catch (_e) {
      // falha silenciosa — exibe o que foi carregado
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const typeStyle = {
    urgent:  { bg: '#fef2f2', border: '#fecaca', icon: '#dc2626', dot: '#dc2626' },
    warning: { bg: '#fefce8', border: '#fde68a', icon: '#d97706', dot: '#f59e0b' },
    info:    { bg: '#f0f6ff', border: '#bfdbfe', icon: '#2563eb', dot: '#3b82f6' },
  };

  const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-800">Centro de Comando</h2>
          <p className="text-slate-500 font-medium mt-1">
            Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:border-[#C69C6D] transition-all disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Vendas (30d)', value: stats.vendas30.toString(), color: '#16a34a', onClick: () => onNavigate('goals') },
          { label: 'Prêmio (30d)', value: fmtBRL(stats.premio30), color: '#1d4ed8', onClick: () => onNavigate('goals') },
          { label: 'Renovações', value: `${stats.renovacoes} em 30d`, color: '#d97706', onClick: () => onNavigate('residential') },
          { label: 'Leads WhatsApp', value: stats.leads.toString(), color: '#C69C6D', onClick: () => onNavigate('whatsapp') },
        ].map(s => (
          <div key={s.label} onClick={s.onClick}
            className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm cursor-pointer hover:shadow-md hover:border-[#C69C6D]/30 transition-all">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{s.label}</p>
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Action items */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-black text-slate-800">O que precisa de atenção agora</h3>
          {items.length === 0 && !loading && (
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">Tudo em dia</span>
          )}
        </div>
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-black text-slate-800 mb-1">Nada pendente!</p>
            <p className="text-sm text-slate-400">Todos os itens estão em dia. Bom trabalho!</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map(item => {
              const s = typeStyle[item.type];
              return (
                <div key={item.id}
                  onClick={() => onNavigate(item.view)}
                  className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors group">
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: s.bg, border: `1px solid ${s.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: s.icon }}>
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-800 text-sm">{item.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-[#C69C6D] opacity-0 group-hover:opacity-100 transition-opacity">{item.action}</span>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-[#C69C6D] transition-colors" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Nova Venda', icon: '💰', view: 'goals' },
          { label: 'Novo Cliente Res.', icon: '🏠', view: 'residential' },
          { label: 'Novo Prospect', icon: '🎯', view: 'prospeccao' },
          { label: 'WhatsApp', icon: '💬', view: 'whatsapp' },
        ].map(a => (
          <button key={a.label} onClick={() => onNavigate(a.view)}
            className="bg-white border border-slate-200 rounded-2xl p-4 text-center hover:border-[#C69C6D] hover:shadow-sm transition-all cursor-pointer">
            <div className="text-2xl mb-2">{a.icon}</div>
            <div className="text-xs font-black text-slate-700">{a.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
