import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, RefreshCw, Send, CheckCircle, AlertCircle, Loader2,
  Clock, Building2, User, Calendar, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpiringClient {
  key: string; // unique across sources
  id: number;
  source: 'Seguro Garantia' | 'Residencial' | 'Auto';
  nome: string;
  email: string | null;
  produto: string;
  vencimento: string;
  seguradora?: string;
  daysLeft: number;
  saleId?: number; // only for 'Seguro Garantia' — used for logging
  recentlySent: boolean;
}

interface StaleProspect {
  id: string;
  nome: string;
  email: string | null;
  company: string | null;
  ult_contato: string | null;
  daysSince: number; // 999 = never contacted
  email_enviado: boolean;
}

type Tab = 'vencimentos' | 'prospectos' | 'avulso';
type SendKey = string;
type SendState = 'sending' | 'sent' | 'error';

// ─── Utils ────────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T12:00:00Z');
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function fmtDate(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function urgencyOf(days: number): 'critical' | 'urgent' | 'soon' {
  if (days <= 7) return 'critical';
  if (days <= 30) return 'urgent';
  return 'soon';
}

const BAND = {
  critical: { label: 'Crítico — ≤7 dias', dot: 'bg-red-500', text: 'text-red-700', badge: 'bg-red-100 text-red-700', row: 'border-red-100 hover:bg-red-50/40' },
  urgent:   { label: 'Urgente — 8 a 30 dias', dot: 'bg-amber-400', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', row: 'border-amber-100 hover:bg-amber-50/40' },
  soon:     { label: 'Em breve — 31 a 90 dias', dot: 'bg-blue-400', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700', row: 'border-blue-100 hover:bg-blue-50/30' },
};

const SOURCE_BADGE: Record<string, string> = {
  'Seguro Garantia': 'bg-navy/10 text-navy',
  'Residencial': 'bg-emerald-100 text-emerald-700',
  'Auto': 'bg-sky-100 text-sky-700',
};

// ─── Call edge function ───────────────────────────────────────────────────────

async function callEmailFn(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const supabaseUrl = (supabase as any).supabaseUrl as string;
  const supabaseKey = (supabase as any).supabaseKey as string;

  const res = await fetch(`${supabaseUrl}/functions/v1/email-followup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token || supabaseKey}`,
      'apikey': supabaseKey,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmailFollowUp() {
  const [tab, setTab] = useState<Tab>('vencimentos');
  const [loading, setLoading] = useState(true);

  // Vencimentos
  const [expiring, setExpiring] = useState<ExpiringClient[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Prospectos
  const [prospects, setProspects] = useState<StaleProspect[]>([]);
  const [prospectTemplate, setProspectTemplate] = useState<Record<string, 'intro' | 'followup'>>({});

  // Avulso
  const [avulso, setAvulso] = useState({ toName: '', toEmail: '', subject: '', message: '' });

  // Send state
  const [sends, setSends] = useState<Record<SendKey, SendState>>({});

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const today = todayISO();
    const in90  = futureISO(90);

    // Parallel fetches
    const [salesRes, resRes, autoRes, prospectsRes, logsRes] = await Promise.all([
      supabase.from('sales')
        .select('id, nome, tipo, seguradora, email, vigencia_fim')
        .eq('vendeu', 'Sim')
        .gte('vigencia_fim', today)
        .lte('vigencia_fim', in90)
        .not('tipo', 'eq', 'Licitante'),

      supabase.from('residential_clients')
        .select('id, nome, email, fim_vigencia')
        .gte('fim_vigencia', today)
        .lte('fim_vigencia', in90)
        .eq('nao_renovar', false),

      supabase.from('auto_clients')
        .select('id, nome, email, fim_vigencia')
        .eq('situacao', 'Ativo')
        .gte('fim_vigencia', today)
        .lte('fim_vigencia', in90),

      supabase.from('prospects')
        .select('id, name, email, company, ult_contato, email_enviado')
        .not('email', 'is', null)
        .or(`ult_contato.is.null,ult_contato.lt.${futureISO(-30)}`)
        .order('ult_contato', { ascending: true, nullsFirst: true })
        .limit(100),

      supabase.from('email_reminder_logs')
        .select('sale_id')
        .eq('reminder_key', 'manual_renewal')
        .gte('reminder_date', futureISO(-60)),
    ]);

    const recentlySentSaleIds = new Set((logsRes.data ?? []).map((r: any) => r.sale_id));

    const clients: ExpiringClient[] = [
      ...(salesRes.data ?? []).map((s: any) => ({
        key: `sale-${s.id}`,
        id: s.id,
        source: 'Seguro Garantia' as const,
        nome: s.nome || '—',
        email: s.email,
        produto: s.tipo || 'Seguro Garantia',
        vencimento: s.vigencia_fim,
        seguradora: s.seguradora,
        daysLeft: daysUntil(s.vigencia_fim),
        saleId: s.id,
        recentlySent: recentlySentSaleIds.has(s.id),
      })),
      ...(resRes.data ?? []).map((r: any) => ({
        key: `res-${r.id}`,
        id: r.id,
        source: 'Residencial' as const,
        nome: r.nome || '—',
        email: r.email,
        produto: 'Seguro Residencial',
        vencimento: r.fim_vigencia,
        daysLeft: daysUntil(r.fim_vigencia),
        recentlySent: false,
      })),
      ...(autoRes.data ?? []).map((a: any) => ({
        key: `auto-${a.id}`,
        id: a.id,
        source: 'Auto' as const,
        nome: a.nome || '—',
        email: a.email,
        produto: 'Seguro Auto',
        vencimento: a.fim_vigencia,
        daysLeft: daysUntil(a.fim_vigencia),
        recentlySent: false,
      })),
    ].sort((a, b) => a.daysLeft - b.daysLeft);

    setExpiring(clients);

    setProspects(
      (prospectsRes.data ?? []).map((p: any) => ({
        id: p.id,
        nome: p.name || '—',
        email: p.email,
        company: p.company,
        ult_contato: p.ult_contato,
        daysSince: daysSince(p.ult_contato),
        email_enviado: p.email_enviado ?? false,
      }))
    );

    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Send helpers ─────────────────────────────────────────────────────────────

  function setSend(key: SendKey, state: SendState) {
    setSends(prev => ({ ...prev, [key]: state }));
  }

  async function sendRenewal(client: ExpiringClient) {
    if (!client.email) return;
    setSend(client.key, 'sending');
    const result = await callEmailFn({
      type: 'renewal',
      toEmail: client.email,
      toName: client.nome,
      saleId: client.saleId,
      produto: client.produto,
      vencimento: client.vencimento,
      daysLeft: client.daysLeft,
      seguradora: client.seguradora,
    });
    setSend(client.key, result.success ? 'sent' : 'error');
    if (result.success) {
      setExpiring(prev => prev.map(c => c.key === client.key ? { ...c, recentlySent: true } : c));
    }
  }

  async function sendProspect(prospect: StaleProspect) {
    if (!prospect.email) return;
    const template = prospectTemplate[prospect.id] ?? (prospect.email_enviado ? 'followup' : 'intro');
    setSend(prospect.id, 'sending');
    const result = await callEmailFn({
      type: 'prospect',
      toEmail: prospect.email,
      toName: prospect.nome,
      company: prospect.company,
      prospectId: prospect.id,
      template,
    });
    setSend(prospect.id, result.success ? 'sent' : 'error');
    if (result.success) {
      setProspects(prev => prev.map(p => p.id === prospect.id ? { ...p, email_enviado: true, ult_contato: new Date().toISOString(), daysSince: 0 } : p));
    }
  }

  async function sendAvulso() {
    if (!avulso.toEmail || !avulso.subject || !avulso.message) return;
    setSend('avulso', 'sending');
    const result = await callEmailFn({
      type: 'custom',
      toEmail: avulso.toEmail,
      toName: avulso.toName || avulso.toEmail,
      subject: avulso.subject,
      message: avulso.message,
    });
    setSend('avulso', result.success ? 'sent' : 'error');
    if (result.success) setAvulso({ toName: '', toEmail: '', subject: '', message: '' });
  }

  // ── Render helpers ───────────────────────────────────────────────────────────

  function SendBtn({ id, onClick, disabled }: { id: string; onClick: () => void; disabled?: boolean }) {
    const state = sends[id];
    if (state === 'sent') return (
      <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold">
        <CheckCircle size={13} /> Enviado
      </span>
    );
    if (state === 'error') return (
      <span className="flex items-center gap-1 text-red-500 text-xs font-bold">
        <AlertCircle size={13} /> Erro
      </span>
    );
    return (
      <button
        onClick={onClick}
        disabled={disabled || state === 'sending'}
        className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-navy text-gold disabled:opacity-40 hover:bg-navy-light transition-all"
      >
        {state === 'sending' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        {state === 'sending' ? 'Enviando…' : 'Enviar'}
      </button>
    );
  }

  function toggleBand(band: string) {
    setCollapsed(prev => ({ ...prev, [band]: !prev[band] }));
  }

  // ── Band section (Vencimentos) ────────────────────────────────────────────────

  function BandSection({ band, clients }: { band: 'critical' | 'urgent' | 'soon'; clients: ExpiringClient[] }) {
    const cfg = BAND[band];
    const isOpen = !collapsed[band];
    if (clients.length === 0) return null;
    return (
      <div className="mb-4">
        <button
          onClick={() => toggleBand(band)}
          className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border ${cfg.row} transition-all`}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
            <span className={`font-bold text-xs ${cfg.text}`}>{cfg.label}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{clients.length}</span>
          </div>
          {isOpen ? <ChevronUp size={13} className={cfg.text} /> : <ChevronDown size={13} className={cfg.text} />}
        </button>

        {isOpen && (
          <div className="mt-1 rounded-xl border border-slate-100 overflow-hidden">
            {clients.map((c, i) => (
              <div
                key={c.key}
                className={`flex items-center gap-3 px-4 py-3 ${i < clients.length - 1 ? 'border-b border-slate-100' : ''} bg-white`}
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  <User size={13} className="text-slate-400" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800 text-xs">{c.nome}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${SOURCE_BADGE[c.source]}`}>
                      {c.source}
                    </span>
                    {c.recentlySent && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase">
                        Email enviado
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-slate-500 text-[10px]">{c.produto}{c.seguradora ? ` · ${c.seguradora}` : ''}</span>
                    <span className={`text-[10px] font-bold flex items-center gap-1 ${cfg.text}`}>
                      <Calendar size={10} /> {fmtDate(c.vencimento)} ({c.daysLeft}d)
                    </span>
                  </div>
                </div>

                {/* Email + send */}
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {c.email ? (
                    <span className="text-[10px] text-slate-400 max-w-[160px] truncate">{c.email}</span>
                  ) : (
                    <span className="text-[10px] text-slate-300 italic">sem email</span>
                  )}
                  <SendBtn id={c.key} onClick={() => sendRenewal(c)} disabled={!c.email} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Grouped expiring clients ──────────────────────────────────────────────────

  const byBand = {
    critical: expiring.filter(c => urgencyOf(c.daysLeft) === 'critical'),
    urgent:   expiring.filter(c => urgencyOf(c.daysLeft) === 'urgent'),
    soon:     expiring.filter(c => urgencyOf(c.daysLeft) === 'soon'),
  };

  const withEmail    = expiring.filter(c => c.email).length;
  const withoutEmail = expiring.filter(c => !c.email).length;

  // ── Avulso templates ─────────────────────────────────────────────────────────

  const TEMPLATES = [
    { label: 'Apresentação', subject: '🛡️ Seguro Garantia para sua empresa — F&G Corretora', message: 'Olá,\n\nSou o Fábio da F&G Corretora de Seguros. Entramos em contato pois acreditamos que sua empresa pode se beneficiar das nossas soluções em Seguro Garantia.\n\nEstamos à disposição para apresentar uma proposta personalizada. Aguardo seu retorno!' },
    { label: 'Renovação',    subject: '📋 Renovação de apólice — F&G Corretora', message: 'Olá,\n\nPassando para avisar que sua apólice está se aproximando do vencimento. Para evitar qualquer interrupção na sua cobertura, entre em contato conosco para iniciarmos o processo de renovação.\n\nContamos com você!' },
    { label: 'Follow-up',   subject: '📩 Retomando nosso contato — F&G Corretora', message: 'Olá,\n\nRecentemente entrei em contato e queria verificar se surgiu alguma dúvida ou necessidade que possamos ajudar.\n\nEstou à disposição!' },
  ];

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-navy flex items-center justify-center">
            <Mail size={15} className="text-gold" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800 text-base leading-none">Follow-up de Email</h2>
            <p className="text-slate-400 text-[11px] mt-0.5">Vencimentos, prospectos e envio avulso</p>
          </div>
        </div>
        <button onClick={loadData} className="text-slate-400 hover:text-gold transition-colors" title="Atualizar">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['vencimentos', 'prospectos', 'avulso'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
              tab === t ? 'bg-white text-navy shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'vencimentos' ? `Vencimentos${expiring.length > 0 ? ` (${expiring.length})` : ''}` :
             t === 'prospectos'  ? `Prospectos${prospects.length > 0 ? ` (${prospects.length})` : ''}` :
             'Avulso'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={22} className="text-gold animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Tab: Vencimentos ───────────────────────────────── */}
          {tab === 'vencimentos' && (
            <div>
              {expiring.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle size={28} className="text-emerald-400 mx-auto mb-3" />
                  <p className="font-bold text-slate-500 text-sm">Nenhum vencimento nos próximos 90 dias</p>
                </div>
              ) : (
                <>
                  {/* Stats bar */}
                  <div className="flex gap-3 mb-4">
                    {[
                      { label: 'Total', value: expiring.length, color: 'text-slate-700' },
                      { label: 'Com email', value: withEmail, color: 'text-emerald-600' },
                      { label: 'Sem email', value: withoutEmail, color: 'text-slate-400' },
                      { label: 'Críticos', value: byBand.critical.length, color: 'text-red-600' },
                    ].map(s => (
                      <div key={s.label} className="bg-white border border-slate-100 rounded-xl px-4 py-2.5 text-center">
                        <p className={`font-black text-lg leading-none ${s.color}`}>{s.value}</p>
                        <p className="text-slate-400 text-[10px] mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  <BandSection band="critical" clients={byBand.critical} />
                  <BandSection band="urgent"   clients={byBand.urgent} />
                  <BandSection band="soon"     clients={byBand.soon} />
                </>
              )}
            </div>
          )}

          {/* ── Tab: Prospectos ────────────────────────────────── */}
          {tab === 'prospectos' && (
            <div>
              {prospects.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle size={28} className="text-emerald-400 mx-auto mb-3" />
                  <p className="font-bold text-slate-500 text-sm">Todos os prospectos foram contatados recentemente</p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-100 overflow-hidden">
                  {prospects.map((p, i) => {
                    const template = prospectTemplate[p.id] ?? (p.email_enviado ? 'followup' : 'intro');
                    const neverContacted = p.daysSince >= 999;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-3 px-4 py-3 bg-white ${i < prospects.length - 1 ? 'border-b border-slate-100' : ''}`}
                      >
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          <Building2 size={13} className="text-slate-400" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-800 text-xs">{p.nome}</span>
                            {p.company && <span className="text-slate-400 text-[10px]">{p.company}</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            <span className="text-slate-400 text-[10px] truncate max-w-[200px]">{p.email}</span>
                            <span className={`flex items-center gap-1 text-[10px] font-bold ${neverContacted ? 'text-slate-400' : p.daysSince > 60 ? 'text-red-500' : 'text-amber-600'}`}>
                              <Clock size={10} />
                              {neverContacted ? 'Nunca contatado' : `${p.daysSince}d sem contato`}
                            </span>
                          </div>
                        </div>

                        {/* Template toggle + send */}
                        <div className="shrink-0 flex items-center gap-2">
                          <select
                            value={template}
                            onChange={e => setProspectTemplate(prev => ({ ...prev, [p.id]: e.target.value as 'intro' | 'followup' }))}
                            className="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 text-slate-600 bg-white focus:outline-none focus:border-gold/50 cursor-pointer"
                          >
                            <option value="intro">Apresentação</option>
                            <option value="followup">Follow-up</option>
                          </select>
                          <SendBtn id={p.id} onClick={() => sendProspect(p)} disabled={!p.email} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Avulso ────────────────────────────────────── */}
          {tab === 'avulso' && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 max-w-xl">
              <p className="text-xs font-bold text-slate-400 mb-4 uppercase tracking-wide">Email personalizado</p>

              {/* Quick templates */}
              <div className="flex gap-2 mb-5 flex-wrap">
                {TEMPLATES.map(t => (
                  <button
                    key={t.label}
                    onClick={() => setAvulso(prev => ({ ...prev, subject: t.subject, message: t.message }))}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-gold/50 hover:text-navy transition-all"
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Nome do destinatário</label>
                    <input
                      value={avulso.toName}
                      onChange={e => setAvulso(p => ({ ...p, toName: e.target.value }))}
                      placeholder="Ex: João Silva"
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-gold/50 text-slate-800 placeholder-slate-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Email *</label>
                    <input
                      type="email"
                      value={avulso.toEmail}
                      onChange={e => setAvulso(p => ({ ...p, toEmail: e.target.value }))}
                      placeholder="email@empresa.com"
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-gold/50 text-slate-800 placeholder-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Assunto *</label>
                  <input
                    value={avulso.subject}
                    onChange={e => setAvulso(p => ({ ...p, subject: e.target.value }))}
                    placeholder="Assunto do email"
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-gold/50 text-slate-800 placeholder-slate-300"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Mensagem *</label>
                  <textarea
                    value={avulso.message}
                    onChange={e => setAvulso(p => ({ ...p, message: e.target.value }))}
                    placeholder="Corpo do email…"
                    rows={6}
                    className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-gold/50 text-slate-800 placeholder-slate-300 resize-none leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  {sends['avulso'] === 'sent' ? (
                    <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold">
                      <CheckCircle size={14} /> Email enviado com sucesso!
                    </span>
                  ) : sends['avulso'] === 'error' ? (
                    <span className="flex items-center gap-1.5 text-red-500 text-xs font-bold">
                      <AlertCircle size={14} /> Erro ao enviar
                    </span>
                  ) : <span />}

                  <button
                    onClick={sendAvulso}
                    disabled={!avulso.toEmail || !avulso.subject || !avulso.message || sends['avulso'] === 'sending'}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-navy text-gold font-bold text-xs disabled:opacity-40 hover:bg-navy-light transition-all"
                  >
                    {sends['avulso'] === 'sending' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {sends['avulso'] === 'sending' ? 'Enviando…' : 'Enviar email'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
