import React, { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  DollarSign, Shield, Calendar, RotateCcw,
  Info, ChevronDown, ChevronUp, AlertTriangle, Plus, X, History, Copy, Check
} from 'lucide-react';

const LICITANTE_HISTORY_KEY = 'cotacao_history_licitante';
const MAX_HISTORY = 5;

import { supabase } from '../lib/supabase';
import { setAnalysisContext, clearAnalysisContext } from '../lib/analysisContext';
import MinutaValidator from './MinutaValidator';
import { type EditalData, type Alerta, describeTriState, ALERTA_CONFIG, SEVERIDADE_ORDER, normalizeAlertas } from '../lib/editalSchema.ts';

interface HistoryEntry { timestamp: string; fileName: string; data: EditalData; }

const LICITANTE_LABELS: Record<string, string> = {
  orgao_nome: 'Órgão Licitante',
  orgao_cnpj: 'CNPJ do Órgão',
  numero_edital: 'Número do Edital',
  modalidade: 'Modalidade',
  objeto: 'Objeto',
  valor_global_edital: 'Valor Global do Edital (R$)',
  exige_seguro_garantia_proposta: 'Exige Seguro-Garantia de Proposta',
  percentual_garantia_proposta: '% da Garantia de Proposta',
  valor_garantia_proposta_calculado: 'Valor da Garantia de Proposta (R$)',
  validade_proposta_dias: 'Validade da Proposta (dias)',
  vigencia_garantia_proposta: 'Vigência da Garantia de Proposta',
  data_sessao_publica: 'Data da Sessão Pública / Pregão',
};

// EditalData importado de lib/editalSchema.ts — fonte única de verdade

const fmtBRL = (val?: number | null) =>
  val != null
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
    : null;

function CopyBtn({ text, light }: { text: string; light?: boolean }) {
  const [done, setDone] = React.useState(false);
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button onClick={handle} title="Copiar" className={`shrink-0 p-1 rounded-xl transition-colors ${light ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
      {done ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

function Card({ icon, label, value, highlight, copyValue }: { icon: React.ReactNode; label: string; value: React.ReactNode; highlight?: boolean; copyValue?: string }) {
  return (
    <div className={`rounded-2xl border p-6 shadow-sm ${highlight ? 'bg-navy border-navy' : 'bg-white border-slate-100'}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={highlight ? 'text-gold' : 'text-slate-400'}>{icon}</span>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${highlight ? 'text-white/50' : 'text-slate-400'}`}>{label}</span>
        </div>
        {copyValue && <CopyBtn text={copyValue} light={highlight} />}
      </div>
      <div className={`text-xl font-black leading-tight ${highlight ? 'text-white' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(LICITANTE_HISTORY_KEY) ?? '[]'); } catch { return []; }
}
function saveToHistory(entry: HistoryEntry) {
  const prev = loadHistory();
  const updated = [entry, ...prev].slice(0, MAX_HISTORY);
  localStorage.setItem(LICITANTE_HISTORY_KEY, JSON.stringify(updated));
}

export default function LicitanteAnalyzer({ onVerVendas }: { onVerVendas?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EditalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showObs, setShowObs] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const invalid = arr.find(f => !ACCEPTED_TYPES.includes(f.type));
    if (invalid) { setError('Selecione apenas PDFs ou imagens (JPG, PNG, WEBP).'); return; }
    const tooBig = arr.find(f => f.size > 30 * 1024 * 1024);
    if (tooBig) { setError('Cada arquivo deve ter no máximo 30MB.'); return; }
    setFiles(prev => [...prev, ...arr]);
    setError(null);
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

  const toBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(f);
    });

  const analyze = async () => {
    if (files.length === 0) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const filesData = await Promise.all(files.map(async f => ({
        data: await toBase64(f),
        mediaType: f.type,
        name: f.name,
      })));
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/analyze-edital`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ filesData, additionalInstructions: additionalInstructions.trim() || undefined }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao analisar');
      setResult(json.data);
      setAnalysisContext(json.data, 'licitante', (updates) => setResult(r => r ? { ...r, ...updates } : r));
      const entry: HistoryEntry = { timestamp: new Date().toISOString(), fileName: files[0].name, data: json.data };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao analisar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFiles([]); setResult(null); setError(null); clearAnalysisContext(); };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Seguro Licitante</h2>
          <p className="text-slate-500 font-semibold mt-1">Envie o edital em PDF. A IA extrai os dados para a cotação do seguro-garantia.</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm transition-colors shrink-0"
          >
            <History size={15} /> Histórico ({history.length})
          </button>
        )}
      </div>

      {/* History panel */}
      {showHistory && history.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Últimas {MAX_HISTORY} cotações</p>
          {history.map((entry, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 text-sm truncate">{entry.data.orgao_nome ?? entry.fileName}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {entry.data.numero_edital ? `Edital ${entry.data.numero_edital} · ` : ''}
                  {new Date(entry.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
                {entry.data.valor_garantia_proposta_calculado && (
                  <p className="text-xs font-bold text-gold mt-0.5">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(entry.data.valor_garantia_proposta_calculado)}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setResult(entry.data); setShowHistory(false); }}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors"
              >
                Restaurar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload */}
      {!result && (
        <div className="space-y-3">
          {/* Drop zone (sempre visível enquanto sem resultado) */}
          <div
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            onDragOver={e => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-4 transition-all cursor-pointer border-slate-200 bg-white hover:border-gold hover:bg-amber-50/10"
          >
            <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }} />
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Upload size={24} className="text-slate-400" />
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-700">Arraste os arquivos aqui</p>
              <p className="text-slate-400 text-sm mt-1">PDF, JPG, PNG · até 30MB cada</p>
            </div>
          </div>

          {/* Lista de arquivos adicionados */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-amber-50 border border-gold/30 rounded-2xl px-5 py-3.5">
                  <FileText size={18} className="text-gold shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{f.name}</p>
                    <p className="text-xs text-slate-400">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-rose-500 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              ))}

              {/* Additional instructions */}
              <div className="pt-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Instrução adicional (opcional)</label>
                <textarea
                  value={additionalInstructions}
                  onChange={e => setAdditionalInstructions(e.target.value)}
                  placeholder="Ex: O edital é para obras de engenharia. Considere que a sessão pública é presencial. Foque no item 10 sobre garantias..."
                  rows={2}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none focus:border-gold"
                />
              </div>

              <div className="flex gap-3">
                <button onClick={analyze} disabled={loading}
                  className="flex-1 bg-navy text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-navy-light transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-60">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                  {loading ? 'Analisando...' : `Analisar ${files.length > 1 ? `${files.length} arquivos` : 'Edital'} com IA`}
                </button>
                <button onClick={reset}
                  className="bg-slate-100 text-slate-600 px-5 py-3.5 rounded-2xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2">
                  <RotateCcw size={15} /> Limpar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 flex flex-col items-center gap-4">
          <Loader2 size={36} className="text-gold animate-spin" />
          <div className="text-center">
            <p className="font-black text-slate-800 text-lg">Lendo o edital...</p>
            <p className="text-slate-400 text-sm mt-1">O Claude está analisando o PDF e extraindo os dados do seguro</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-rose-700">Erro na análise</p>
            <p className="text-rose-600 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && !loading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">

          {/* Cabeçalho do órgão */}
          <div className="bg-navy rounded-2xl p-7 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0 space-y-2">
                {/* Modalidade + Edital */}
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gold">
                    {result.modalidade || 'Licitação Pública'}{result.numero_edital ? ` · ${result.numero_edital}` : ''}
                  </p>
                  {result.numero_edital && <CopyBtn text={result.numero_edital} light />}
                </div>
                {/* Órgão */}
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-white leading-tight">{result.orgao_nome || '—'}</h3>
                  {result.orgao_nome && <CopyBtn text={result.orgao_nome} light />}
                </div>
                {/* CNPJ */}
                {result.orgao_cnpj && (
                  <div className="flex items-center gap-2">
                    <p className="text-white/50 text-sm font-mono">{result.orgao_cnpj}</p>
                    <CopyBtn text={result.orgao_cnpj} light />
                  </div>
                )}
                {/* Objeto */}
                {result.objeto && (
                  <div className="flex items-start gap-2 border-t border-white/10 pt-3 mt-1">
                    <p className="text-white/60 text-sm leading-relaxed flex-1">{result.objeto}</p>
                    <CopyBtn text={result.objeto} light />
                  </div>
                )}
              </div>
              <button onClick={reset}
                className="shrink-0 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-all">
                <RotateCcw size={13} /> Novo
              </button>
            </div>
          </div>

          {/* Dados financeiros */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card
              icon={<DollarSign size={15} />}
              label="Valor Global do Edital"
              value={result.valor_global_edital != null ? (fmtBRL(result.valor_global_edital) ?? '—') : 'Não informado no edital'}
              copyValue={fmtBRL(result.valor_global_edital) ?? undefined}
            />
            <Card
              icon={<Shield size={15} />}
              label="% Garantia de Proposta"
              value={result.percentual_garantia_proposta != null ? `${result.percentual_garantia_proposta}%` : '—'}
              copyValue={result.percentual_garantia_proposta != null ? `${result.percentual_garantia_proposta}%` : undefined}
            />
            <Card
              icon={<DollarSign size={15} />}
              label="Valor da Garantia"
              value={result.valor_garantia_proposta_calculado != null
                ? (fmtBRL(result.valor_garantia_proposta_calculado) ?? '—')
                : result.formula_calculo
                  ? `A confirmar: ${result.formula_calculo}`
                  : 'A confirmar (valor estimado ausente no edital)'}
              highlight={!!result.valor_garantia_proposta_calculado}
              copyValue={fmtBRL(result.valor_garantia_proposta_calculado) ?? undefined}
            />
          </div>

          {/* Fórmula em aberto + divergência de validade */}
          {(result.formula_calculo || result.divergencia_validade_proposta) && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 space-y-2">
              {result.formula_calculo && (
                <p className="text-sm text-slate-600"><span className="font-bold text-slate-700">Fórmula:</span> {result.formula_calculo}</p>
              )}
              {result.divergencia_validade_proposta &&
               !/nenhuma diverg|sem diverg|não há diverg|nao ha diverg/i.test(result.divergencia_validade_proposta) && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="font-bold">Divergência de validade:</span> {result.divergencia_validade_proposta}
                </p>
              )}
            </div>
          )}

          {/* Datas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card
              icon={<Calendar size={15} />}
              label="Data da Sessão Pública / Pregão"
              value={result.data_sessao_publica ?? '—'}
              copyValue={result.data_sessao_publica ?? undefined}
            />
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-slate-400"><Calendar size={15} /></span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vigência da Garantia de Proposta</span>
              </div>
              {(() => {
                const BUFFER_DIAS = 30;
                const dias = result.vigencia_garantia_proposta_dias;
                const termo = result.vigencia_garantia_termo_inicial;

                // data_base selecionada pelo termo inicial declarado; null = fallback conservador
                type DataBase = { dateStr: string | null; label: string; isFallback: boolean };
                const dataBase: DataBase = (() => {
                  if (termo === 'entrega_proposta' && result.data_limite_propostas)
                    return { dateStr: result.data_limite_propostas, label: 'entrega da proposta', isFallback: false };
                  if (termo === 'emissao')
                    return { dateStr: null, label: 'emissão da apólice (data não calculável antecipadamente)', isFallback: false };
                  if (termo === 'sessao_publica')
                    return { dateStr: result.data_sessao_publica ?? null, label: 'sessão pública', isFallback: false };
                  // termo === null: padrão conservador (modelo não identificou o marco inicial)
                  return { dateStr: result.data_sessao_publica ?? null, label: 'sessão pública', isFallback: true };
                })();

                let dataFimMinimo: string | null = null;
                let dataFimSugerido: string | null = null;
                if (dias && dataBase.dateStr) {
                  try {
                    const partes = dataBase.dateStr.split(/[/\s]/);
                    const d = parseInt(partes[0]), m = parseInt(partes[1]), y = parseInt(partes[2]);
                    const baseMs = Date.UTC(y, m - 1, d);
                    const fmt = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
                    dataFimMinimo  = fmt(baseMs + dias * 86400000);
                    dataFimSugerido = fmt(baseMs + (dias + BUFFER_DIAS) * 86400000);
                  } catch { /* mantém null */ }
                }

                // Linha de auditoria: distingue dado extraído de padrão conservador aplicado
                const regraContagem = dataBase.isFallback
                  ? `Padrão conservador: termo inicial não declarado no edital; usei a data da sessão pública. Contado de ${dataBase.dateStr ? dataBase.dateStr.split(' ')[0] : '?'}. Art. 183, Lei 14.133/2021.`
                  : `Contado de ${dataBase.dateStr ? dataBase.dateStr.split(' ')[0] : '?'} (${dataBase.label}). Exclui o dia do início, inclui o do vencimento. Art. 183, Lei 14.133/2021.`;

                if (result.vigencia_garantia_proposta) return (
                  <div className="space-y-1">
                    <p className="text-xl font-black text-slate-800">{result.vigencia_garantia_proposta}</p>
                    {dataFimMinimo && <p className="text-xs text-slate-600">Mínimo legal: <strong>{dataFimMinimo}</strong></p>}
                    {dataFimSugerido && <p className="text-xs text-emerald-700">Sugerido (+{BUFFER_DIAS} dias): <strong>{dataFimSugerido}</strong></p>}
                    <p className="text-[10px] text-slate-400 mt-1">{regraContagem}</p>
                  </div>
                );
                if (dias) return (
                  <div className="space-y-1">
                    <p className="text-xl font-black text-slate-800">{dias} dias</p>
                    {dataFimMinimo && <p className="text-xs text-slate-600">Mínimo legal: <strong>{dataFimMinimo}</strong></p>}
                    {dataFimSugerido && <p className="text-xs text-emerald-700">Sugerido (+{BUFFER_DIAS} dias): <strong>{dataFimSugerido}</strong></p>}
                    {termo === 'emissao' && <p className="text-[10px] text-amber-600 mt-1">Termo inicial: emissão da apólice. Data de término não calculável antecipadamente.</p>}
                    <p className={`text-[10px] mt-1 ${dataBase.isFallback ? 'text-amber-600' : 'text-slate-400'}`}>{regraContagem}</p>
                  </div>
                );
                if (result.validade_proposta_dias) return (
                  <div>
                    <p className="text-xl font-black text-slate-800">{result.validade_proposta_dias} dias</p>
                    <p className="text-[10px] text-amber-600 mt-1">Validade da proposta. Vigência da garantia não especificada no edital.</p>
                  </div>
                );
                return <p className="text-xl font-black text-slate-500">Não informado</p>;
              })()}
            </div>
          </div>

          {/* Badge: exige garantia de proposta — três estados */}
          {(() => {
            const desc = describeTriState(result.exige_garantia_proposta, {
              verdadeiro: 'Este edital EXIGE seguro-garantia de proposta como condição de participação.',
              falso: 'Este edital NÃO exige seguro-garantia de proposta.',
              indeterminado: 'Não foi possível determinar se o edital exige seguro-garantia de proposta. Verifique manualmente.',
            });
            const styles = {
              true:          'bg-emerald-50 border-emerald-200 text-emerald-800',
              false:         'bg-slate-50 border-slate-200 text-slate-600',
              indeterminate: 'bg-amber-50 border-amber-200 text-amber-800',
              conditional:   'bg-blue-50 border-blue-200 text-blue-800',
            };
            const icons = {
              true:          <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />,
              false:         <XCircle size={20} className="text-slate-400 shrink-0" />,
              indeterminate: <AlertTriangle size={20} className="text-amber-500 shrink-0" />,
              conditional:   <AlertTriangle size={20} className="text-blue-500 shrink-0" />,
            };
            return (
              <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl border font-bold ${styles[desc.kind]}`}>
                {icons[desc.kind]}
                <span>{desc.text}</span>
              </div>
            );
          })()}

          {/* Erros de schema ou parse — nunca silenciosos */}
          {(result.schema_validation_error || result.parse_error) && (
            <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-rose-600 shrink-0" />
                <p className="font-bold text-rose-800 text-sm">
                  {result.parse_error ? 'Erro de parsing: resposta do modelo não é JSON válido' : 'Erro de validação de schema'}
                </p>
              </div>
              {result.schema_validation_error && (
                <p className="text-rose-700 text-xs font-mono bg-rose-100 rounded-xl px-3 py-2">{String(result.schema_validation_error)}</p>
              )}
              {result.parse_error && result.raw && (
                <details className="mt-2">
                  <summary className="text-rose-600 text-xs font-bold cursor-pointer">Ver resposta bruta</summary>
                  <pre className="text-xs text-rose-600 bg-rose-100 rounded-xl px-3 py-2 mt-1 whitespace-pre-wrap overflow-auto max-h-48">{String(result.raw)}</pre>
                </details>
              )}
            </div>
          )}

          {/* Observações */}
          {result.observacoes_relevantes && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl overflow-hidden">
              <button onClick={() => setShowObs(!showObs)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-amber-100/50 transition-all">
                <div className="flex items-center gap-2">
                  <Info size={15} className="text-amber-600" />
                  <span className="font-bold text-amber-800 text-xs uppercase tracking-[1.5px]">Observações da IA</span>
                </div>
                {showObs ? <ChevronUp size={15} className="text-amber-600" /> : <ChevronDown size={15} className="text-amber-600" />}
              </button>
              {showObs && (
                <p className="px-6 pb-5 text-amber-800 text-sm leading-relaxed">{result.observacoes_relevantes}</p>
              )}
            </div>
          )}

          {result.parse_error && (
            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Resposta bruta</p>
              <pre className="text-xs text-slate-600 whitespace-pre-wrap">{result.raw}</pre>
            </div>
          )}

          {/* Alertas de sanidade — renderização por tipo estruturado */}
          {result.alertas && result.alertas.length > 0 && (() => {
            // Normaliza string[] (legado) e Alerta[] (v9+), ordena por severidade
            const alertas: Alerta[] = normalizeAlertas(result.alertas as Alerta[] | string[])
              .sort((a, b) => (SEVERIDADE_ORDER[a.severidade] ?? 2) - (SEVERIDADE_ORDER[b.severidade] ?? 2));

            // Agrupa por tipo para cabeçalhos diferenciados
            const bloqueantes = alertas.filter(a => a.severidade === 'bloqueante');
            const outros = alertas.filter(a => a.severidade !== 'bloqueante');

            return (
              <div className="space-y-2">
                {bloqueantes.length > 0 && (
                  <div className="border border-rose-200 rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 bg-rose-50 border-b border-rose-200">
                      <AlertTriangle size={14} className="text-rose-600 shrink-0" />
                      <span className="font-bold text-rose-800 text-xs uppercase tracking-widest">Alertas Bloqueantes</span>
                    </div>
                    <ul className="px-5 py-3 space-y-2">
                      {bloqueantes.map((a, i) => {
                        const cfg = ALERTA_CONFIG[a.tipo];
                        return (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-xl shrink-0 mt-0.5 ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                            <span className="text-sm text-rose-800">{a.texto}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {outros.length > 0 && (
                  <div className="border border-amber-200 rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3 bg-amber-50 border-b border-amber-200">
                      <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                      <span className="font-bold text-amber-800 text-xs uppercase tracking-widest">Alertas de Sanidade</span>
                    </div>
                    <ul className="px-5 py-3 space-y-2">
                      {outros.map((a, i) => {
                        const cfg = ALERTA_CONFIG[a.tipo];
                        return (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-xl shrink-0 mt-0.5 ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                            <span className="text-sm text-amber-800">{a.texto}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Pendências bloqueantes — impedem emissão e bloqueiam Double Check */}
          {result.pendencias_bloqueantes && result.pendencias_bloqueantes.length > 0 && (
            <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-rose-100 border-b border-rose-200">
                <AlertTriangle size={15} className="text-rose-600 shrink-0" />
                <span className="font-bold text-rose-800 text-xs uppercase tracking-widest">Pendências Bloqueantes</span>
                <span className="ml-auto text-[10px] font-bold text-rose-600 bg-rose-200 px-2 py-0.5 rounded-xl">Confirme antes do Double Check</span>
              </div>
              <ul className="px-5 py-3 space-y-1.5">
                {result.pendencias_bloqueantes.map((p, i) => (
                  <li key={i} className="text-sm text-rose-800 flex items-start gap-2">
                    <span className="text-rose-500 mt-0.5 shrink-0">!</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recomendações — atenção operacional, NÃO bloqueia Double Check */}
          {result.recomendacoes && result.recomendacoes.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
                <Info size={14} className="text-slate-500 shrink-0" />
                <span className="font-bold text-slate-600 text-xs uppercase tracking-widest">Recomendações Operacionais</span>
              </div>
              <ul className="px-5 py-3 space-y-1.5">
                {result.recomendacoes.map((r, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                    <span className="text-slate-400 mt-0.5 shrink-0">→</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Double Check da Minuta — bloqueado quando há pendências */}
          {!result.parse_error && (
            result.pendencias_bloqueantes && result.pendencias_bloqueantes.length > 0 ? (
              <div className="bg-slate-100 border border-slate-200 rounded-2xl p-6 text-center space-y-2">
                <AlertTriangle size={24} className="text-slate-400 mx-auto" />
                <p className="font-bold text-slate-600 text-sm">Double Check indisponível</p>
                <p className="text-slate-400 text-xs">Resolva as pendências bloqueantes listadas acima antes de validar a minuta. Exemplo: confirme o valor estimado junto ao órgão licitante.</p>
              </div>
            ) : (
              <MinutaValidator
                dadosOriginais={result as unknown as Record<string, unknown>}
                tipo="licitante"
                campoLabels={LICITANTE_LABELS}
                onVerVendas={onVerVendas}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
