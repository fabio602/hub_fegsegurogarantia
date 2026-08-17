import React, { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  DollarSign, Shield, Calendar, RotateCcw,
  Info, ChevronDown, ChevronUp, AlertTriangle, Briefcase, Hash, X, History
} from 'lucide-react';

const CONTRATO_HISTORY_KEY = 'cotacao_history_contrato';
const MAX_HISTORY = 5;

interface HistoryEntry { timestamp: string; fileName: string; data: ContratoData; }
import { supabase } from '../lib/supabase';
import MinutaValidator from './MinutaValidator';

const CONTRATO_LABELS: Record<string, string> = {
  numero_contrato: 'Número do Contrato',
  objeto_contrato: 'Objeto do Contrato',
  tomador_cnpj: 'CNPJ do Tomador (Contratada)',
  tomador_nome: 'Razão Social do Tomador',
  segurado_cnpj: 'CNPJ do Segurado (Órgão Público)',
  segurado_nome: 'Nome do Segurado (Órgão Público)',
  valor_contrato: 'Valor do Contrato (R$)',
  percentual_is: '% da Importância Segurada (IS)',
  valor_is_calculado: 'Valor da IS Calculado (R$)',
  vigencia_contrato_inicio: 'Início da Vigência do Contrato',
  vigencia_contrato_fim: 'Fim da Vigência do Contrato',
  vigencia_garantia: 'Vigência da Garantia',
  exige_dias_adicionais: 'Exige Dias Adicionais de Cobertura',
  dias_adicionais: 'Quantidade de Dias Adicionais',
  exige_multas_trabalhistas: 'Exige Cobertura de Multas e Trabalhistas',
  contrato_abaixo_85_percent: 'Contrato Abaixo de 85% (art. 59 §4º Lei 14.133/2021)',
};

interface ContratoData {
  numero_contrato?: string | null;
  objeto_contrato?: string | null;
  tomador_cnpj?: string | null;
  tomador_nome?: string | null;
  segurado_cnpj?: string | null;
  segurado_nome?: string | null;
  valor_contrato?: number | null;
  percentual_is?: number | null;
  valor_is_calculado?: number | null;
  vigencia_contrato_inicio?: string | null;
  vigencia_contrato_fim?: string | null;
  vigencia_garantia?: string | null;
  exige_dias_adicionais?: boolean;
  dias_adicionais?: number | null;
  exige_clausula_especifica?: boolean;
  clausula_garantia_descricao?: string | null;
  exige_multas_trabalhistas?: boolean;
  contrato_abaixo_85_percent?: boolean;
  observacoes_relevantes?: string | null;
  raw?: string;
  parse_error?: boolean;
}

const fmtBRL = (val?: number | null) =>
  val != null
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
    : null;

function Card({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; highlight?: boolean
}) {
  return (
    <div className={`rounded-[1.5rem] border p-6 shadow-sm ${highlight ? 'bg-[#1B263B] border-[#1B263B]' : 'bg-white border-slate-100'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={highlight ? 'text-[#C69C6D]' : 'text-slate-400'}>{icon}</span>
        <span className={`text-[10px] font-black uppercase tracking-[2px] ${highlight ? 'text-white/50' : 'text-slate-400'}`}>{label}</span>
      </div>
      <div className={`text-xl font-black leading-tight ${highlight ? 'text-white' : 'text-slate-800'}`}>{value}</div>
      {sub && <p className={`text-[10px] mt-1 uppercase tracking-[1px] ${highlight ? 'text-white/40' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl border font-bold ${
      ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'
    }`}>
      {ok
        ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
        : <XCircle size={20} className="text-slate-400 shrink-0" />
      }
      <span>{label}</span>
    </div>
  );
}

function WarnBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl border font-bold ${
      active ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-500'
    }`}>
      {active
        ? <AlertTriangle size={20} className="text-amber-500 shrink-0" />
        : <XCircle size={20} className="text-slate-400 shrink-0" />
      }
      <span>{label}</span>
    </div>
  );
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(CONTRATO_HISTORY_KEY) ?? '[]'); } catch { return []; }
}
function saveToHistory(entry: HistoryEntry) {
  const prev = loadHistory();
  const updated = [entry, ...prev].slice(0, MAX_HISTORY);
  localStorage.setItem(CONTRATO_HISTORY_KEY, JSON.stringify(updated));
}

export default function ContratoAnalyzer({ onVerVendas }: { onVerVendas?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContratoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showObs, setShowObs] = useState(false);
  const [showClausula, setShowClausula] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const invalid = arr.find(f => f.type !== 'application/pdf');
    if (invalid) { setError('Selecione apenas arquivos PDF.'); return; }
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
      const pdfBase64Array = await Promise.all(files.map(toBase64));
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/analyze-contrato`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ pdfBase64Array, fileName: files[0].name }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao analisar');
      setResult(json.data);
      const entry: HistoryEntry = { timestamp: new Date().toISOString(), fileName: files[0].name, data: json.data };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao analisar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFiles([]); setResult(null); setError(null); };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Seguro de Contrato</h2>
          <p className="text-slate-500 font-semibold mt-1">Upload do contrato em PDF — a IA extrai todos os dados para cotação do seguro garantia de execução.</p>
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
                <p className="font-bold text-slate-800 text-sm truncate">{entry.data.tomador_nome ?? entry.data.segurado_nome ?? entry.fileName}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {entry.data.numero_contrato ? `Contrato ${entry.data.numero_contrato} · ` : ''}
                  {new Date(entry.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
                {entry.data.valor_is_calculado && (
                  <p className="text-xs font-black text-[#C69C6D] mt-0.5">
                    IS: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(entry.data.valor_is_calculado)}
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
          <div
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            onDragOver={e => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center gap-4 transition-all cursor-pointer border-slate-200 bg-white hover:border-[#C69C6D] hover:bg-amber-50/10"
          >
            <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }} />
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Upload size={24} className="text-slate-400" />
            </div>
            <div className="text-center">
              <p className="font-black text-slate-700">Arraste os arquivos aqui</p>
              <p className="text-slate-400 text-sm mt-1">Contrato, Termo de Referência, Adendos · PDF até 30MB cada</p>
            </div>
          </div>

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

              <div className="flex gap-3 pt-1">
                <button onClick={analyze} disabled={loading}
                  className="flex-1 bg-[#1B263B] text-white px-8 py-3.5 rounded-2xl font-black hover:bg-[#243447] transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-60">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                  {loading ? 'Analisando...' : `Analisar ${files.length > 1 ? `${files.length} arquivos` : 'Contrato'} com IA`}
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
            <p className="font-black text-slate-800 text-lg">Lendo o contrato...</p>
            <p className="text-slate-400 text-sm mt-1">A IA está analisando o PDF e extraindo os dados do seguro garantia</p>
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

          {/* Cabeçalho do contrato */}
          <div className="bg-[#1B263B] rounded-[2rem] p-7 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {result.numero_contrato && (
                  <p className="text-[10px] font-black uppercase tracking-[3px] text-[#C69C6D] mb-1">
                    {result.numero_contrato}
                  </p>
                )}
                {result.objeto_contrato && (
                  <p className="text-white/80 text-sm mt-2 leading-relaxed border-t border-white/10 pt-3">{result.objeto_contrato}</p>
                )}
              </div>
              <button onClick={reset}
                className="shrink-0 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-all">
                <RotateCcw size={13} /> Novo
              </button>
            </div>
          </div>

          {/* Tomador e Segurado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase size={15} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase tracking-[2px] text-slate-400">Tomador (Contratada)</span>
              </div>
              <p className="text-lg font-black text-slate-800 leading-tight">{result.tomador_nome || '—'}</p>
              {result.tomador_cnpj && (
                <p className="text-xs text-slate-400 font-mono mt-1">{result.tomador_cnpj}</p>
              )}
            </div>
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={15} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase tracking-[2px] text-slate-400">Segurado (Órgão Público)</span>
              </div>
              <p className="text-lg font-black text-slate-800 leading-tight">{result.segurado_nome || '—'}</p>
              {result.segurado_cnpj && (
                <p className="text-xs text-slate-400 font-mono mt-1">{result.segurado_cnpj}</p>
              )}
            </div>
          </div>

          {/* Dados financeiros */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card
              icon={<DollarSign size={15} />}
              label="Valor do Contrato"
              value={fmtBRL(result.valor_contrato) ?? '—'}
            />
            <Card
              icon={<Shield size={15} />}
              label="% da IS (Importância Segurada)"
              value={result.percentual_is != null ? `${result.percentual_is}%` : '—'}
            />
            <Card
              icon={<DollarSign size={15} />}
              label="Valor da IS Calculado"
              value={fmtBRL(result.valor_is_calculado) ?? '—'}
              highlight={!!result.valor_is_calculado}
            />
          </div>

          {/* Vigência */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={15} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase tracking-[2px] text-slate-400">Vigência do Contrato</span>
              </div>
              {result.vigencia_contrato_inicio || result.vigencia_contrato_fim ? (
                <p className="text-xl font-black text-slate-800">
                  {result.vigencia_contrato_inicio ?? '?'} → {result.vigencia_contrato_fim ?? '?'}
                </p>
              ) : (
                <p className="text-xl font-black text-slate-500">—</p>
              )}
            </div>
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={15} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase tracking-[2px] text-slate-400">Vigência da Garantia</span>
              </div>
              {result.vigencia_garantia ? (
                <p className="text-xl font-black text-slate-800">{result.vigencia_garantia}</p>
              ) : result.exige_dias_adicionais && result.dias_adicionais ? (
                <div>
                  <p className="text-xl font-black text-slate-800">Vigência do contrato + {result.dias_adicionais} dias</p>
                  <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-[1px]">Prazo adicional exigido</p>
                </div>
              ) : (
                <p className="text-xl font-black text-slate-500">—</p>
              )}
            </div>
          </div>

          {/* Dias adicionais separado se tiver vigência garantia E dias */}
          {result.exige_dias_adicionais && result.dias_adicionais && result.vigencia_garantia && (
            <div className="bg-blue-50 border border-blue-100 rounded-2xl px-6 py-4 flex items-center gap-3">
              <Calendar size={18} className="text-blue-500 shrink-0" />
              <p className="text-blue-800 font-bold">
                Exige <span className="font-black">{result.dias_adicionais} dias adicionais</span> de cobertura após o término do contrato.
              </p>
            </div>
          )}

          {/* Badges de condições especiais */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Badge
              ok={!!result.exige_clausula_especifica}
              label={result.exige_clausula_especifica
                ? 'Contém cláusula específica de garantia'
                : 'Sem cláusula específica de garantia'}
            />
            <Badge
              ok={!!result.exige_dias_adicionais}
              label={result.exige_dias_adicionais
                ? `Exige ${result.dias_adicionais ?? '?'} dias adicionais de cobertura`
                : 'Não exige dias adicionais de cobertura'}
            />
            <WarnBadge
              active={!!result.exige_multas_trabalhistas}
              label={result.exige_multas_trabalhistas
                ? 'Exige cobertura adicional de multas e verbas trabalhistas'
                : 'Não exige cobertura adicional de multas/trabalhistas'}
            />
            <WarnBadge
              active={!!result.contrato_abaixo_85_percent}
              label={result.contrato_abaixo_85_percent
                ? 'Contrato abaixo de 85% — exige garantia adicional (art. 59 §4º Lei 14.133/2021)'
                : 'Contrato não enquadrado como abaixo de 85%'}
            />
          </div>

          {/* Cláusula específica */}
          {result.exige_clausula_especifica && result.clausula_garantia_descricao && (
            <div className="bg-blue-50 border border-blue-100 rounded-[1.5rem] overflow-hidden">
              <button onClick={() => setShowClausula(!showClausula)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-blue-100/50 transition-all">
                <div className="flex items-center gap-2">
                  <Hash size={15} className="text-blue-600" />
                  <span className="font-black text-blue-800 text-xs uppercase tracking-[1.5px]">Cláusula Específica de Garantia</span>
                </div>
                {showClausula ? <ChevronUp size={15} className="text-blue-600" /> : <ChevronDown size={15} className="text-blue-600" />}
              </button>
              {showClausula && (
                <p className="px-6 pb-5 text-blue-800 text-sm leading-relaxed">{result.clausula_garantia_descricao}</p>
              )}
            </div>
          )}

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
              tipo="contrato"
              campoLabels={CONTRATO_LABELS}
              onVerVendas={onVerVendas}
            />
          )}
        </div>
      )}
    </div>
  );
}
