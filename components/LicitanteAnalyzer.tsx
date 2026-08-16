import React, { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  Building2, DollarSign, Shield, Calendar, RotateCcw,
  Info, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';
import { supabase } from '../lib/supabase';

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

function Card({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-[1.5rem] border p-6 shadow-sm ${highlight ? 'bg-[#1B263B] border-[#1B263B]' : 'bg-white border-slate-100'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={highlight ? 'text-[#C69C6D]' : 'text-slate-400'}>{icon}</span>
        <span className={`text-[10px] font-black uppercase tracking-[2px] ${highlight ? 'text-white/50' : 'text-slate-400'}`}>{label}</span>
      </div>
      <div className={`text-xl font-black leading-tight ${highlight ? 'text-white' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

export default function LicitanteAnalyzer() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EditalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showObs, setShowObs] = useState(false);
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

  const analyze = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const pdfBase64 = await toBase64(file);
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
        body: JSON.stringify({ pdfBase64, fileName: file.name }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao analisar');
      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao analisar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(null); };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div>
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Seguro Licitante</h2>
        <p className="text-slate-500 font-semibold mt-1">Upload do edital em PDF — a IA extrai todos os dados para cotação do seguro-garantia.</p>
      </div>

      {/* Upload */}
      {!result && (
        <div
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
          onDragOver={e => e.preventDefault()}
          onClick={() => !file && inputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-[2rem] p-12 flex flex-col items-center gap-5 transition-all cursor-pointer
            ${file ? 'border-[#C69C6D] bg-amber-50/30 cursor-default' : 'border-slate-200 bg-white hover:border-[#C69C6D] hover:bg-amber-50/10'}`}
        >
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

          {file ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-[#C69C6D]/10 flex items-center justify-center">
                <FileText size={30} className="text-[#C69C6D]" />
              </div>
              <div className="text-center">
                <p className="font-black text-slate-800 text-lg">{file.name}</p>
                <p className="text-slate-400 text-sm mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB · PDF pronto</p>
              </div>
              <div className="flex gap-3">
                <button onClick={e => { e.stopPropagation(); analyze(); }} disabled={loading}
                  className="bg-[#1B263B] text-white px-8 py-3.5 rounded-2xl font-black hover:bg-[#243447] transition-all shadow-lg flex items-center gap-2 disabled:opacity-60">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                  {loading ? 'Analisando...' : 'Analisar Edital com IA'}
                </button>
                <button onClick={e => { e.stopPropagation(); reset(); }}
                  className="bg-slate-100 text-slate-600 px-5 py-3.5 rounded-2xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2">
                  <RotateCcw size={15} /> Trocar
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                <Upload size={28} className="text-slate-400" />
              </div>
              <div className="text-center">
                <p className="font-black text-slate-700 text-lg">Arraste o edital aqui</p>
                <p className="text-slate-400 text-sm mt-1">ou clique para selecionar · PDF até 30MB</p>
              </div>
            </>
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
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[3px] text-[#C69C6D] mb-1">
                  {result.modalidade || 'Licitação Pública'} {result.numero_edital ? `· ${result.numero_edital}` : ''}
                </p>
                <h3 className="text-xl font-black text-white leading-tight">{result.orgao_nome || '—'}</h3>
                {result.orgao_cnpj && (
                  <p className="text-white/50 text-sm mt-1 font-mono">{result.orgao_cnpj}</p>
                )}
                {result.objeto && (
                  <p className="text-white/60 text-sm mt-3 leading-relaxed border-t border-white/10 pt-3">{result.objeto}</p>
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
            />
            <Card
              icon={<Shield size={15} />}
              label="% Garantia de Proposta"
              value={result.percentual_garantia_proposta != null ? `${result.percentual_garantia_proposta}%` : '—'}
            />
            <Card
              icon={<DollarSign size={15} />}
              label="Valor da Garantia"
              value={fmtBRL(result.valor_garantia_proposta_calculado) ?? '—'}
              highlight={!!result.valor_garantia_proposta_calculado}
            />
          </div>

          {/* Datas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card
              icon={<Calendar size={15} />}
              label="Data da Sessão Pública / Pregão"
              value={result.data_sessao_publica ?? '—'}
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
        </div>
      )}
    </div>
  );
}
