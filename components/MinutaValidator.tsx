import React, { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RotateCcw, ClipboardCheck, ChevronDown, ChevronUp,
  MessageSquare, Copy, Check
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

export default function MinutaValidator({ dadosOriginais, tipo, campoLabels }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showMsg, setShowMsg] = useState(false);
  const [copied, setCopied] = useState(false);
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
    setLoading(true); setError(null); setResult(null); setShowMsg(false);
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

  const reset = () => { setFile(null); setResult(null); setError(null); setShowMsg(false); setCopied(false); };

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

  const mensagem = result?.minuta_dados && tipo === 'licitante'
    ? buildMensagemLicitante(result.minuta_dados)
    : null;

  const copyMsg = () => {
    if (!mensagem) return;
    navigator.clipboard.writeText(mensagem).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-8 border-t border-slate-100 pt-8 space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#1B263B] flex items-center justify-center shrink-0">
          <ClipboardCheck size={16} className="text-[#C69C6D]" />
        </div>
        <div>
          <h3 className="font-black text-slate-800 text-lg">Double Check — Minuta do Seguro</h3>
          <p className="text-slate-400 text-sm">Faça upload da minuta emitida pela seguradora para validar os dados automaticamente.</p>
        </div>
      </div>

      {/* Upload area */}
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

      {/* Validation result */}
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

          {/* Toggle show all OK */}
          {okCount > 0 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-all border border-slate-200 rounded-xl hover:bg-slate-50">
              {showAll
                ? <><ChevronUp size={14} /> Ocultar campos OK</>
                : <><ChevronDown size={14} /> Ver todos os {okCount} campos OK</>}
            </button>
          )}

          {/* ── Mensagem para o cliente (apenas Licitante) ── */}
          {mensagem && (
            <div className="border-t border-slate-100 pt-5 space-y-3">
              <button
                onClick={() => setShowMsg(!showMsg)}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-[#1B263B] hover:bg-[#243447] text-white rounded-2xl transition-all font-black text-sm shadow"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-[#C69C6D]" />
                  <span>Gerar Mensagem para o Cliente</span>
                </div>
                {showMsg ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showMsg && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-[2px]">Mensagem WhatsApp</span>
                    <button
                      onClick={copyMsg}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                        copied
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {copied ? <><Check size={12} /> Copiado!</> : <><Copy size={12} /> Copiar</>}
                    </button>
                  </div>

                  {/* Mensagem */}
                  <pre className="px-5 py-4 text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {mensagem}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Nova validação */}
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
