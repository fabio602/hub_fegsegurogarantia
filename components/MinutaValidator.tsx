import React, { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RotateCcw, ClipboardCheck, ChevronDown, ChevronUp,
  MessageSquare, Copy, Check, TrendingUp, PartyPopper, ExternalLink
} from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface ValidationItem {
  campo: string;
  esperado: string;
  encontrado: string;
  status: 'ok' | 'divergencia' | 'nao_encontrado';
  observacao?: string | null;
}

interface MinutaDados {
  seguradora?: string | null;
  tomador?: string | null;
  segurado?: string | null;
  valor_garantia?: string | null;
  vigencia?: string | null;
  custo_seguro?: string | null;
  numero_apolice_minuta?: string | null;
}

export interface ValidationResult {
  status_geral: 'aprovado' | 'divergencias' | 'verificar';
  itens: ValidationItem[];
  resumo: string;
  minuta_dados?: MinutaDados;
  raw?: string;
  parse_error?: boolean;
}

interface Props {
  dadosOriginais: Record<string, unknown>;
  tipo: 'licitante' | 'contrato';
  campoLabels: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildContexto(dados: Record<string, unknown>, labels: Record<string, string>): string {
  return Object.entries(dados)
    .filter(([k, v]) => !['raw', 'parse_error'].includes(k) && v != null && v !== '' && v !== false)
    .map(([k, v]) => {
      const label = labels[k] || k;
      const val = typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v);
      return `- ${label}: ${val}`;
    })
    .join('\n');
}

/** Tenta extrair datas de "DD/MM/YYYY a DD/MM/YYYY" → { inicio, fim } em YYYY-MM-DD */
function parseVigencia(v: string): { inicio: string; fim: string } {
  const match = v?.match(/(\d{2}\/\d{2}\/\d{4})\s+(?:a|até|ao)\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (match) {
    const toISO = (d: string) => d.split('/').reverse().join('-');
    return { inicio: toISO(match[1]), fim: toISO(match[2]) };
  }
  return { inicio: '', fim: '' };
}

function buildMensagemLicitante(d: MinutaDados): string {
  return `Obrigado por ter aguardado. Consegui fazer o orçamento do seu edital. Vou te passar as informações:

*Resumo da Minuta para o Seguro de Proposta*
Seguradora: ${d.seguradora || '—'}
Tomador: ${d.tomador || '—'}
Segurado: ${d.segurado || '—'}
Modalidade: Garantia de Proposta (Licitante)
Valor da garantia: ${d.valor_garantia || '—'}
Vigência: ${d.vigencia || '—'}
Custo do seguro: ${d.custo_seguro || '—'}

Pode analisar a minuta e se estiver de acordo posso seguir com a emissão imediatamente.

Aguardo,`;
}

function buildMensagemContrato(d: MinutaDados): string {
  return `Obrigado por ter aguardado. Consegui fazer o orçamento do seu contrato. Vou te passar as informações:

*Resumo da Minuta para o Seguro Garantia de Contrato*
Seguradora: ${d.seguradora || '—'}
Tomador: ${d.tomador || '—'}
Segurado: ${d.segurado || '—'}
Modalidade: Garantia de Execução Contratual
Valor da garantia (IS): ${d.valor_garantia || '—'}
Vigência: ${d.vigencia || '—'}
Custo do seguro: ${d.custo_seguro || '—'}

Pode analisar a minuta e se estiver de acordo posso seguir com a emissão imediatamente.

Aguardo,`;
}

// ── Configs de UI ──────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  ok: {
    icon: <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />,
    row: 'bg-emerald-50 border-emerald-100',
    badge: 'bg-emerald-100 text-emerald-700',
    label: 'OK',
  },
  divergencia: {
    icon: <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />,
    row: 'bg-red-50 border-red-100',
    badge: 'bg-red-100 text-red-700',
    label: 'DIVERGÊNCIA',
  },
  nao_encontrado: {
    icon: <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />,
    row: 'bg-amber-50 border-amber-100',
    badge: 'bg-amber-100 text-amber-700',
    label: 'NÃO ENCONTRADO',
  },
};

const GERAL_CONFIG = {
  aprovado: {
    bg: 'bg-emerald-50 border-emerald-200',
    icon: <CheckCircle2 size={24} className="text-emerald-600" />,
    title: 'Minuta Aprovada',
    titleColor: 'text-emerald-800',
    text: 'Todos os campos conferem com os dados originais.',
  },
  divergencias: {
    bg: 'bg-red-50 border-red-200',
    icon: <XCircle size={24} className="text-red-600" />,
    title: 'Divergências Encontradas',
    titleColor: 'text-red-800',
    text: 'A minuta contém diferenças em relação aos dados originais. Corrija antes de emitir.',
  },
  verificar: {
    bg: 'bg-amber-50 border-amber-200',
    icon: <AlertTriangle size={24} className="text-amber-600" />,
    title: 'Verificação Necessária',
    titleColor: 'text-amber-800',
    text: 'Alguns campos não foram localizados na minuta. Verifique manualmente.',
  },
};

// ── Componente ─────────────────────────────────────────────────────────────

export default function MinutaValidator({ dadosOriginais, tipo, campoLabels }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showMsg, setShowMsg] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fechar venda
  const [showVenda, setShowVenda] = useState(false);
  const [sellers, setSellers] = useState<Array<{ id: string; name: string }>>([]);
  const [vendaForm, setVendaForm] = useState({ data: '', vendedor: '', comissao: '' });
  const [savingVenda, setSavingVenda] = useState(false);
  const [vendaSalva, setVendaSalva] = useState(false);
  const [vendaError, setVendaError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (f.type !== 'application/pdf') { setError('Selecione um arquivo PDF.'); return; }
    if (f.size > 30 * 1024 * 1024) { setError('Arquivo deve ter no máximo 30MB.'); return; }
    setFile(f); setResult(null); setError(null);
  };

  const toBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(f);
    });

  const validate = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null); setShowMsg(false); setShowVenda(false); setVendaSalva(false);
    try {
      const pdfBase64 = await toBase64(file);
      const contexto = buildContexto(dadosOriginais, campoLabels);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/validate-minuta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ pdfBase64, contexto, tipo }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao validar');
      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao validar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null); setResult(null); setError(null);
    setShowMsg(false); setCopied(false);
    setShowVenda(false); setVendaSalva(false); setVendaError(null);
  };

  const openVenda = async () => {
    setVendaSalva(false); setVendaError(null);
    setVendaForm({ data: new Date().toISOString().split('T')[0], vendedor: '', comissao: '' });
    const { data } = await supabase.from('sellers').select('id, name').eq('active', true).order('name');
    setSellers(data || []);
    setShowVenda(true);
  };

  const salvarVenda = async () => {
    if (!result?.minuta_dados || !vendaForm.vendedor) return;
    setSavingVenda(true); setVendaError(null);
    try {
      const d = result.minuta_dados;
      const { inicio, fim } = parseVigencia(d.vigencia || '');

      const salePayload: Record<string, unknown> = {
        data: vendaForm.data,
        vendedor: vendaForm.vendedor,
        nome: d.tomador || '',
        seguradora: d.seguradora || '',
        premio: d.custo_seguro || '',
        comissao: vendaForm.comissao || '',
        tipo: 'Seguro Garantia',
        product_type: tipo === 'licitante' ? 'garantia_proposta' : 'garantia_contrato',
        vendeu: 'Sim',
        origem: tipo === 'licitante' ? 'Licitante' : 'Contrato',
        qualificado: 'Sim',
        indicacao: 'Não',
        limites: '',
        catalogo: '',
        vigencia_inicio: inicio || null,
        vigencia_fim: fim || null,
        segurado: d.segurado || '',
      };

      if (tipo === 'licitante') {
        salePayload.orgaoLicitante = d.segurado || String(dadosOriginais.orgao_nome || '');
        salePayload.valorLote = dadosOriginais.valor_global_edital ? String(dadosOriginais.valor_global_edital) : '';
        salePayload.dataPregao = String(dadosOriginais.data_sessao_publica || '');
      } else {
        salePayload.numeroContrato = String(dadosOriginais.numero_contrato || '');
        salePayload.objetoContrato = String(dadosOriginais.objeto_contrato || '');
        salePayload.valorContrato = dadosOriginais.valor_contrato ? String(dadosOriginais.valor_contrato) : '';
        salePayload.cnpj = String(dadosOriginais.tomador_cnpj || '');
      }

      const { error: dbErr } = await supabase.from('sales').insert([salePayload]);
      if (dbErr) throw dbErr;
      setVendaSalva(true);
      setShowVenda(false);
    } catch (e) {
      setVendaError(e instanceof Error ? e.message : 'Erro ao registrar venda.');
    } finally {
      setSavingVenda(false);
    }
  };

  // ── Derivados ──────────────────────────────────────────────────────────────

  const okCount = result?.itens?.filter(i => i.status === 'ok').length ?? 0;
  const divCount = result?.itens?.filter(i => i.status === 'divergencia').length ?? 0;
  const naCount = result?.itens?.filter(i => i.status === 'nao_encontrado').length ?? 0;

  const sortedItens = result?.itens
    ? [...result.itens].sort((a, b) => {
        const order = { divergencia: 0, nao_encontrado: 1, ok: 2 };
        return order[a.status] - order[b.status];
      })
    : [];
  const visibleItens = showAll ? sortedItens : sortedItens.filter(i => i.status !== 'ok');

  const mensagem = result?.minuta_dados
    ? tipo === 'licitante'
      ? buildMensagemLicitante(result.minuta_dados)
      : buildMensagemContrato(result.minuta_dados)
    : null;

  const copyMsg = () => {
    if (!mensagem) return;
    navigator.clipboard.writeText(mensagem).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mt-8 border-t border-slate-100 pt-8 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#1B263B] flex items-center justify-center shrink-0">
          <ClipboardCheck size={16} className="text-[#C69C6D]" />
        </div>
        <div>
          <h3 className="font-black text-slate-800 text-lg">Double Check — Minuta do Seguro</h3>
          <p className="text-slate-400 text-sm">Faça upload da minuta emitida pela seguradora para validar os dados automaticamente.</p>
        </div>
      </div>

      {/* Upload */}
      {!result && (
        <div
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
          onDragOver={e => e.preventDefault()}
          onClick={() => !file && inputRef.current?.click()}
          className={`border-2 border-dashed rounded-[1.5rem] p-8 flex flex-col items-center gap-4 transition-all cursor-pointer
            ${file ? 'border-[#C69C6D] bg-amber-50/30 cursor-default' : 'border-slate-200 bg-slate-50/50 hover:border-[#C69C6D] hover:bg-amber-50/10'}`}
        >
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
          {file ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-[#C69C6D]/10 flex items-center justify-center">
                <FileText size={22} className="text-[#C69C6D]" />
              </div>
              <div className="text-center">
                <p className="font-black text-slate-800">{file.name}</p>
                <p className="text-slate-400 text-sm mt-0.5">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <div className="flex gap-3">
                <button onClick={e => { e.stopPropagation(); validate(); }} disabled={loading}
                  className="bg-[#1B263B] text-white px-7 py-3 rounded-xl font-black hover:bg-[#243447] transition-all shadow flex items-center gap-2 disabled:opacity-60 text-sm">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
                  {loading ? 'Validando...' : 'Validar Minuta'}
                </button>
                <button onClick={e => { e.stopPropagation(); reset(); }}
                  className="bg-slate-100 text-slate-600 px-4 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2 text-sm">
                  <RotateCcw size={13} /> Trocar
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-slate-200 flex items-center justify-center">
                <Upload size={20} className="text-slate-400" />
              </div>
              <div className="text-center">
                <p className="font-black text-slate-600">Arraste a minuta aqui</p>
                <p className="text-slate-400 text-sm mt-0.5">ou clique para selecionar · PDF até 30MB</p>
              </div>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 flex flex-col items-center gap-3">
          <Loader2 size={28} className="text-[#C69C6D] animate-spin" />
          <div className="text-center">
            <p className="font-black text-slate-800">Comparando dados...</p>
            <p className="text-slate-400 text-sm mt-0.5">A IA está conferindo campo a campo</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-black text-red-700 text-sm">Erro na validação</p>
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Resultado da validação */}
      {result && !loading && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-400">

          {/* Status geral */}
          {(() => {
            const cfg = GERAL_CONFIG[result.status_geral] ?? GERAL_CONFIG.verificar;
            return (
              <div className={`rounded-2xl border p-5 flex items-start gap-4 ${cfg.bg}`}>
                <div className="shrink-0 mt-0.5">{cfg.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`font-black text-lg ${cfg.titleColor}`}>{cfg.title}</p>
                  <p className={`text-sm mt-0.5 ${cfg.titleColor} opacity-80`}>{cfg.text}</p>
                  {result.resumo && (
                    <p className={`text-sm mt-2 leading-relaxed ${cfg.titleColor} opacity-70 border-t border-current/10 pt-2`}>{result.resumo}</p>
                  )}
                </div>
                <div className="shrink-0 flex gap-2 text-xs font-black">
                  {okCount > 0 && <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-lg">{okCount} OK</span>}
                  {divCount > 0 && <span className="bg-red-100 text-red-700 px-2.5 py-1 rounded-lg">{divCount} ✗</span>}
                  {naCount > 0 && <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-lg">{naCount} ⚠</span>}
                </div>
              </div>
            );
          })()}

          {/* Itens */}
          <div className="space-y-2">
            {visibleItens.map((item, i) => {
              const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.nao_encontrado;
              return (
                <div key={i} className={`rounded-xl border p-4 ${cfg.row}`}>
                  <div className="flex items-start gap-3">
                    {cfg.icon}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-700 text-sm">{item.campo}</span>
                        <span className={`text-[10px] font-black uppercase tracking-[1.5px] px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                        <div>
                          <span className="text-slate-400 uppercase tracking-[1px] font-bold">Esperado: </span>
                          <span className="text-slate-600 font-semibold">{item.esperado}</span>
                        </div>
                        {item.status !== 'ok' && (
                          <div>
                            <span className="text-slate-400 uppercase tracking-[1px] font-bold">Minuta: </span>
                            <span className={`font-semibold ${item.status === 'divergencia' ? 'text-red-700' : 'text-amber-700'}`}>{item.encontrado}</span>
                          </div>
                        )}
                      </div>
                      {item.observacao && (
                        <p className="text-xs text-slate-500 mt-1 italic">{item.observacao}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {okCount > 0 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-all border border-slate-200 rounded-xl hover:bg-slate-50">
              {showAll ? <><ChevronUp size={14} /> Ocultar campos OK</> : <><ChevronDown size={14} /> Ver todos os {okCount} campos OK</>}
            </button>
          )}

          {/* ── Mensagem para cliente ── */}
          {mensagem && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <button onClick={() => setShowMsg(!showMsg)}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-[#1B263B] hover:bg-[#243447] text-white rounded-2xl transition-all font-black text-sm shadow">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-[#C69C6D]" />
                  <span>Gerar Mensagem para o Cliente</span>
                </div>
                {showMsg ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showMsg && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-[2px]">Mensagem WhatsApp</span>
                    <button onClick={copyMsg}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {copied ? <><Check size={12} /> Copiado!</> : <><Copy size={12} /> Copiar</>}
                    </button>
                  </div>
                  <pre className="px-5 py-4 text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{mensagem}</pre>
                </div>
              )}
            </div>
          )}

          {/* ── Fechar Venda ── */}
          {result.minuta_dados && !result.parse_error && (
            <div className="border-t border-slate-100 pt-4 space-y-3">

              {/* Venda salva com sucesso */}
              {vendaSalva && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center gap-4">
                  <CheckCircle2 size={28} className="text-emerald-600 shrink-0" />
                  <div className="flex-1">
                    <p className="font-black text-emerald-800">Venda registrada com sucesso!</p>
                    <p className="text-emerald-700 text-sm mt-0.5">Os dados foram adicionados ao acompanhamento de vendas.</p>
                  </div>
                  <a href="#vendas" onClick={reset}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-black text-emerald-700 hover:text-emerald-900 transition-all border border-emerald-200 px-3 py-2 rounded-xl hover:bg-emerald-100">
                    <ExternalLink size={12} /> Ver em Vendas
                  </a>
                </div>
              )}

              {/* Botão abrir formulário */}
              {!vendaSalva && (
                <button onClick={showVenda ? () => setShowVenda(false) : openVenda}
                  className="w-full flex items-center justify-between px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl transition-all font-black text-sm shadow">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={16} />
                    <span>Fechar Venda — Registrar no Acompanhamento</span>
                  </div>
                  {showVenda ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              )}

              {/* Formulário de venda */}
              {showVenda && !vendaSalva && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">

                  {/* Preview dos dados pré-preenchidos */}
                  <div className="bg-slate-50 border-b border-slate-200 px-5 py-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[2px] mb-3">Dados pré-preenchidos da minuta</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                      {[
                        ['Cliente', result.minuta_dados.tomador],
                        ['Seguradora', result.minuta_dados.seguradora],
                        ['Prêmio', result.minuta_dados.custo_seguro],
                        ['Valor da Garantia', result.minuta_dados.valor_garantia],
                        ['Vigência', result.minuta_dados.vigencia],
                        ['Segurado', result.minuta_dados.segurado],
                      ].filter(([, v]) => v).map(([l, v]) => (
                        <div key={l as string}>
                          <span className="text-slate-400 font-bold">{l}: </span>
                          <span className="text-slate-700 font-semibold">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Campos a preencher */}
                  <div className="p-5 space-y-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[2px]">Complete para registrar</p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs font-black text-slate-600 uppercase tracking-[1px] block mb-1.5">Data da Venda *</label>
                        <input
                          type="date"
                          value={vendaForm.data}
                          onChange={e => setVendaForm(f => ({ ...f, data: e.target.value }))}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D]"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-black text-slate-600 uppercase tracking-[1px] block mb-1.5">Vendedor *</label>
                        <select
                          value={vendaForm.vendedor}
                          onChange={e => setVendaForm(f => ({ ...f, vendedor: e.target.value }))}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] bg-white"
                        >
                          <option value="">Selecionar...</option>
                          {sellers.map(s => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-black text-slate-600 uppercase tracking-[1px] block mb-1.5">Comissão (R$)</label>
                        <input
                          type="text"
                          placeholder="Ex: R$ 500,00"
                          value={vendaForm.comissao}
                          onChange={e => setVendaForm(f => ({ ...f, comissao: e.target.value }))}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D]"
                        />
                      </div>
                    </div>

                    {vendaError && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-2">
                        <AlertTriangle size={14} className="text-red-500 shrink-0" />
                        <p className="text-red-600 text-xs font-semibold">{vendaError}</p>
                      </div>
                    )}

                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={salvarVenda}
                        disabled={savingVenda || !vendaForm.vendedor || !vendaForm.data}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow">
                        {savingVenda ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : <><Check size={15} /> Confirmar e Registrar Venda</>}
                      </button>
                      <button onClick={() => setShowVenda(false)}
                        className="px-5 py-3 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-all">
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reset */}
          <button onClick={reset}
            className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-all">
            <RotateCcw size={13} /> Validar outra minuta
          </button>

          {result.parse_error && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <p className="text-xs font-black text-slate-500 uppercase tracking-[2px] mb-2">Resposta bruta</p>
              <pre className="text-xs text-slate-600 whitespace-pre-wrap">{result.raw}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
