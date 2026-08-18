import React, { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  DollarSign, Shield, Calendar, RotateCcw,
  Info, ChevronDown, ChevronUp, AlertTriangle, Plus, X, History, Copy, Check
} from 'lucide-react';

const LICITANTE_HISTORY_KEY = 'cotacao_history_licitante';
const MAX_HISTORY = 5;

interface HistoryEntry { timestamp: string; fileName: string; data: EditalData; }
import { supabase } from '../lib/supabase';
import { setAnalysisContext, clearAnalysisContext } from '../lib/analysisContext';
import MinutaValidator from './MinutaValidator';

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

interface EditalData {
  orgao_nome?: string | null;
  orgao_cnpj?: string | null;
  numero_edital?: string | null;
  modalidade?: string | null;
  objeto?: string | null;
  valor_global_edital?: number | null;
  exige_seguro_garantia_proposta?: boolean;
  percentual_garantia_proposta?: number | null;
  valor_garantia_proposta_calculado?: number | null;
  validade_proposta_dias?: number | null;
  vigencia_garantia_proposta?: string | null;
  data_sessao_publica?: string | null;
  observacoes_relevantes?: string | null;
  raw?: string;
  parse_error?: boolean;
}

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
    <button onClick={handle} title="Copiar" className={`shrink-0 p-1 rounded-lg transition-colors ${light ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-300 hover:text-slate-600 hover:bg-slate-100'}`}>
      {done ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

function Card({ icon, label, value, highlight, copyValue }: { icon: React.ReactNode; label: string; value: React.ReactNode; highlight?: boolean; copyValue?: string }) {
  return (
    <div className={`rounded-[1.5rem] border p-6 shadow-sm ${highlight ? 'bg-[#1B263B] border-[#1B263B]' : 'bg-white border-slate-100'}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={highlight ? 'text-[#C69C6D]' : 'text-slate-400'}>{icon}</span>
          <span className={`text-[10px] font-black uppercase tracking-[2px] ${highlight ? 'text-white/50' : 'text-slate-400'}`}>{label}</span>
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
          <p className="text-slate-500 font-semibold mt-1">Upload do edital em PDF — a IA extrai todos os dados para cotação do seguro-garantia.</p>
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
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 space-y-3">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Últimas {MAX_HISTORY} cotações</p>
          {history.map((entry, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 text-sm truncate">{entry.data.orgao_nome ?? entry.fileName}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {entry.data.numero_edital ? `Edital ${entry.data.numero_edital} · ` : ''}
                  {new Date(entry.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
                {entry.data.valor_garantia_proposta_calculado && (
                  <p className="text-xs font-black text-[#C69C6D] mt-0.5">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(entry.data.valor_garantia_proposta_calculado)}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setResult(entry.data); setShowHistory(false); }}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-[#1B263B] text-white text-xs font-bold hover:bg-[#243447] transition-colors"
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
            className="border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center gap-4 transition-all cursor-pointer border-slate-200 bg-white hover:border-[#C69C6D] hover:bg-amber-50/10"
          >
            <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }} />
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Upload size={24} className="text-slate-400" />
            </div>
            <div className="text-center">
              <p className="font-black text-slate-700">Arraste os arquivos aqui</p>
              <p className="text-slate-400 text-sm mt-1">PDF, JPG, PNG · até 30MB cada</p>
            </div>
          </div>

          {/* Lista de arquivos adicionados */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-amber-50 border border-[#C69C6D]/30 rounded-2xl px-5 py-3.5">
                  <FileText size={18} className="text-[#C69C6D] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{f.name}</p>
                    <p className="text-xs text-slate-400">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              ))}

              {/* Additional instructions */}
              <div className="pt-1">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1.5">Instrução adicional (opcional)</label>
                <textarea
                  value={additionalInstructions}
                  onChange={e => setAdditionalInstructions(e.target.value)}
                  placeholder="Ex: O edital é para obras de engenharia. Considere que a sessão pública é presencial. Foque no item 10 sobre garantias..."
                  rows={2}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none focus:border-[#C69C6D]"
                />
              </div>

              <div className="flex gap-3">
                <button onClick={analyze} disabled={loading}
                  className="flex-1 bg-[#1B263B] text-white px-8 py-3.5 rounded-2xl font-black hover:bg-[#243447] transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-60">
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
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-12 flex flex-col items-center gap-4">
          <Loader2 size={36} className="text-[#C69C6D] animate-spin" />
          <div className="text-center">
            <p className="font-black text-slate-800 text-lg">Lendo o edital...</p>
            <p className="text-slate-400 text-sm mt-1">O Claude está analisando o PDF e extraindo os dados do seguro</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-black text-red-700">Erro na análise</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {result && !loading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">

          {/* Cabeçalho do órgão */}
          <div className="bg-[#1B263B] rounded-[2rem] p-7 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0 space-y-2">
                {/* Modalidade + Edital */}
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black uppercase tracking-[3px] text-[#C69C6D]">
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
              value={fmtBRL(result.valor_global_edital) ?? '—'}
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
              value={fmtBRL(result.valor_garantia_proposta_calculado) ?? '—'}
              highlight={!!result.valor_garantia_proposta_calculado}
              copyValue={fmtBRL(result.valor_garantia_proposta_calculado) ?? undefined}
            />
          </div>

          {/* Datas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card
              icon={<Calendar size={15} />}
              label="Data da Sessão Pública / Pregão"
              value={result.data_sessao_publica ?? '—'}
              copyValue={result.data_sessao_publica ?? undefined}
            />
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-slate-400"><Calendar size={15} /></span>
                <span className="text-[10px] font-black uppercase tracking-[2px] text-slate-400">Vigência / Validade da Proposta</span>
              </div>
              {result.vigencia_garantia_proposta ? (
                <div>
                  <p className="text-xl font-black text-slate-800">{result.vigencia_garantia_proposta}</p>
                  <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[1px]">Vigência específica da garantia de proposta</p>
                </div>
              ) : result.validade_proposta_dias ? (
                <div>
                  <p className="text-xl font-black text-slate-800">{result.validade_proposta_dias} dias</p>
                  <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[1px]">Validade da proposta (vigência da garantia não especificada)</p>
                </div>
              ) : (
                <p className="text-xl font-black text-slate-500">—</p>
              )}
            </div>
          </div>

          {/* Badge: exige seguro proposta */}
          <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl border font-bold ${
            result.exige_seguro_garantia_proposta
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}>
            {result.exige_seguro_garantia_proposta
              ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
              : <XCircle size={20} className="text-slate-400 shrink-0" />
            }
            <span>
              {result.exige_seguro_garantia_proposta
                ? 'Este edital EXIGE seguro-garantia de proposta como condição de participação.'
                : 'Este edital NÃO exige (ou não menciona) seguro-garantia de proposta.'}
            </span>
          </div>

          {/* Observações */}
          {result.observacoes_relevantes && (
            <div className="bg-amber-50 border border-amber-100 rounded-[1.5rem] overflow-hidden">
              <button onClick={() => setShowObs(!showObs)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-amber-100/50 transition-all">
                <div className="flex items-center gap-2">
                  <Info size={15} className="text-amber-600" />
                  <span className="font-black text-amber-800 text-xs uppercase tracking-[1.5px]">Observações da IA</span>
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
              <p className="text-xs font-black text-slate-500 uppercase tracking-[2px] mb-2">Resposta bruta</p>
              <pre className="text-xs text-slate-600 whitespace-pre-wrap">{result.raw}</pre>
            </div>
          )}

          {/* Double Check da Minuta */}
          {!result.parse_error && (
            <MinutaValidator
              dadosOriginais={result as unknown as Record<string, unknown>}
              tipo="licitante"
              campoLabels={LICITANTE_LABELS}
              onVerVendas={onVerVendas}
            />
          )}
        </div>
      )}
    </div>
  );
}
