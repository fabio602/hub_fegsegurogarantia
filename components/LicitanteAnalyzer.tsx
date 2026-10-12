import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload, FileText, Loader2, CheckCircle2, XCircle,
  DollarSign, Shield, Calendar, RotateCcw,
  Info, ChevronDown, ChevronUp, AlertTriangle, X, History, Copy, Check, Pencil, Search, Building2
} from 'lucide-react';

const LICITANTE_HISTORY_KEY = 'cotacao_history_licitante';
const MAX_HISTORY = 5;

import { setAnalysisContext, clearAnalysisContext } from '../lib/analysisContext';
import MinutaValidator from './MinutaValidator';
import VisualizadorTrecho from './VisualizadorTrecho';
import { type EditalData, type Alerta, type Evidencia, describeTriState, ALERTA_CONFIG, SEVERIDADE_ORDER, normalizeAlertas } from '../lib/editalSchema.ts';
import { extrairEdital, finalizarEdital, corrigirCampo } from '../lib/edital/index.ts';
import { makeAlerta } from '../lib/edital/travas.ts';
import { lerDocumentos, MAX_PAGINAS_OCR } from '../lib/pdf/lerDocumento.ts';
import { encerrarOcr } from '../lib/pdf/ocr.ts';

interface HistoryEntry { timestamp: string; fileName: string; data: EditalData; }

/** PDFs da análise atual, mantidos em memória para o "ver trecho" (não vão para o histórico). */
interface ArquivoLido { nome: string; tipo: string; bytes: ArrayBuffer; primeiraPagina: number }

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

/** "R$ 1.393.413,10", "1393413,10" ou "1393413.10" → número */
function lerNumeroBR(s: string): number | null {
  const t = s.replace(/[R$\s]/g, '');
  if (!t) return null;
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Link "p. 16 · ver trecho" que abre a origem do dado no PDF. */
function OrigemLink({ evidencia, onVer, light }: { evidencia?: Evidencia; onVer: () => void; light?: boolean }) {
  if (!evidencia) return null;
  const manual = evidencia.pagina === 0;
  return (
    <div className="mt-1.5 leading-none">
      <button type="button" onClick={onVer}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-1.5 py-0.5 -ml-1.5 transition-colors ${light ? 'text-white/50 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-gold-dark hover:bg-areia-clara'}`}>
        {manual ? <Pencil size={11} /> : <Search size={11} />}
        {manual ? 'Informado manualmente' : `p. ${evidencia.pagina} · ver trecho`}
      </button>
    </div>
  );
}

type TipoEdicao = 'moeda' | 'numero' | 'texto' | 'termo' | 'simnao';

/** Campo com botão de correção manual (substitui a correção pelo chat). */
function Editavel({ valor, tipo, placeholder, onSalvar, light, children }: {
  valor: unknown; tipo: TipoEdicao; placeholder?: string; light?: boolean;
  onSalvar: (v: unknown) => void; children: React.ReactNode;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const abrir = () => {
    setTexto(valor == null ? '' : tipo === 'moeda' ? Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      : tipo === 'simnao' ? (valor === true ? 'sim' : valor === false ? 'nao' : '') : String(valor));
    setEditando(true);
  };
  const salvar = () => {
    let v: unknown = texto.trim() || null;
    if (v != null && (tipo === 'moeda' || tipo === 'numero')) v = lerNumeroBR(String(v));
    if (tipo === 'simnao') v = texto === 'sim' ? true : texto === 'nao' ? false : null;
    onSalvar(v);
    setEditando(false);
  };
  const campoCls = 'w-full px-3 py-2 bg-white border border-gold rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-gold/30';
  if (editando) return (
    <div className="space-y-2" onKeyDown={e => { if (e.key === 'Enter' && tipo !== 'termo' && tipo !== 'simnao') salvar(); if (e.key === 'Escape') { e.stopPropagation(); setEditando(false); } }}>
      {tipo === 'termo' ? (
        <select autoFocus value={texto} onChange={e => setTexto(e.target.value)} className={campoCls}>
          <option value="">Não informado</option>
          <option value="sessao_publica">Sessão pública / abertura</option>
          <option value="entrega_proposta">Entrega da proposta</option>
          <option value="emissao">Emissão da apólice</option>
        </select>
      ) : tipo === 'simnao' ? (
        <select autoFocus value={texto} onChange={e => setTexto(e.target.value)} className={campoCls}>
          <option value="">Indeterminado</option>
          <option value="sim">Sim, exige</option>
          <option value="nao">Não exige</option>
        </select>
      ) : (
        <input autoFocus value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder} className={campoCls} />
      )}
      <div className="flex gap-2">
        <button type="button" onClick={salvar} className="px-3 py-1.5 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors">Salvar</button>
        <button type="button" onClick={() => setEditando(false)} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-colors">Cancelar</button>
      </div>
    </div>
  );
  return (
    <div className="group flex items-start gap-2">
      <div className="flex-1 min-w-0">{children}</div>
      <button type="button" onClick={abrir} title="Corrigir"
        className={`shrink-0 p-1 rounded-lg transition-colors ${light ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-300 hover:text-gold-dark hover:bg-areia-clara'}`}>
        <Pencil size={13} />
      </button>
    </div>
  );
}

const NAO_ENCONTRADO = <span className="text-base font-bold text-amber-600">Não encontrado — preencher</span>;

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
  const [progresso, setProgresso] = useState('');
  const [arquivosLidos, setArquivosLidos] = useState<ArquivoLido[]>([]);
  const [origemAberta, setOrigemAberta] = useState<{ titulo: string; campo: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Libera o OCR (se foi usado) ao sair da tela
  useEffect(() => () => { encerrarOcr(); }, []);

  /** Aplica o resultado na tela e no contexto do chat (que pode corrigir campos). */
  const publicar = (dados: EditalData) => {
    setResult(dados);
    setAnalysisContext(dados as unknown as Record<string, unknown>, 'licitante', (updates) => setResult(r => {
      if (!r) return r;
      let novo = r;
      for (const [campo, valor] of Object.entries(updates)) novo = corrigirCampo(novo, campo as keyof EditalData, valor);
      return novo;
    }));
  };

  const corrigir = (campo: keyof EditalData) => (valor: unknown) => {
    setResult(r => {
      if (!r) return r;
      const novo = corrigirCampo(r, campo, valor);
      setAnalysisContext(novo as unknown as Record<string, unknown>, 'licitante', (updates) => setResult(x => x ? Object.entries(updates).reduce((acc, [c, v]) => corrigirCampo(acc, c as keyof EditalData, v), x) : x));
      return novo;
    });
  };

  const ev = (campo: string) => result?._evidencias?.[campo];
  const verOrigem = (titulo: string, campo: string) => () => setOrigemAberta({ titulo, campo });
  const fecharOrigem = React.useCallback(() => setOrigemAberta(null), []);

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

  /**
   * Leitura 100% local: texto do PDF (ou OCR) no navegador + regras de lib/edital.
   * Nenhum arquivo sai da máquina e não há chamada de IA.
   */
  const analyze = async () => {
    if (files.length === 0) return;
    setLoading(true); setError(null); setResult(null); setProgresso('Abrindo o arquivo…');
    try {
      const lido = await lerDocumentos(files, setProgresso);
      if (!lido.paginas.some(p => p.trim())) throw new Error('Não encontrei texto no arquivo. Confira se é o edital correto.');
      setProgresso('Procurando os dados do seguro…');
      let dados = extrairEdital(lido.paginas, lido.origem);
      if (lido.paginasIgnoradas > 0) {
        dados = finalizarEdital({
          ...dados,
          _alertas_extracao: [...(dados._alertas_extracao ?? []), makeAlerta('outro', 'atencao', null,
            `Documento escaneado: li por OCR só as ${MAX_PAGINAS_OCR} primeiras páginas de cada arquivo (${lido.paginasIgnoradas} ficaram de fora). Se faltar algum dado, anexe só as páginas da garantia e do valor estimado.`)],
        });
      }
      setArquivosLidos(await Promise.all(files.map(async (f, i) => ({
        nome: f.name, tipo: f.type, bytes: await f.arrayBuffer(), primeiraPagina: lido.inicioDeCada[i] + 1,
      }))));
      publicar(dados);
      const entry: HistoryEntry = { timestamp: new Date().toISOString(), fileName: files[0].name, data: dados };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao ler o edital. Tente novamente.');
    } finally {
      setLoading(false);
      setProgresso('');
    }
  };

  const reset = () => { setFiles([]); setResult(null); setError(null); setArquivosLidos([]); clearAnalysisContext(); };

  /** Página global (somando os arquivos) → PDF e página dentro dele, para o visualizador. */
  const evidenciaAberta = origemAberta ? result?._evidencias?.[origemAberta.campo] : undefined;
  const pdfAberto = useMemo(() => {
    const pagina = evidenciaAberta?.pagina ?? 0;
    if (pagina < 1) return null;
    const arq = [...arquivosLidos].reverse().find(a => a.primeiraPagina <= pagina);
    if (!arq || arq.tipo !== 'application/pdf') return null;
    return { bytes: arq.bytes, nome: arq.nome, paginaLocal: pagina - arq.primeiraPagina + 1 };
  }, [evidenciaAberta?.pagina, arquivosLidos]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Seguro Licitante</h2>
          <p className="text-slate-500 font-semibold mt-1">Envie o edital em PDF. O hub lê o documento no seu computador e extrai os dados da cotação, sem IA e sem enviar o arquivo.</p>
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
                onClick={() => { setArquivosLidos([]); publicar(finalizarEdital(entry.data)); setShowHistory(false); }}
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

              {files.length > 1 && (
                <p className="text-xs text-slate-400 px-1">Os arquivos são lidos como um documento só (edital + anexos), na ordem acima.</p>
              )}

              <div className="flex gap-3">
                <button onClick={analyze} disabled={loading}
                  className="flex-1 bg-navy text-white px-8 py-3.5 rounded-2xl font-bold hover:bg-navy-light transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-60">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                  {loading ? 'Lendo...' : `Ler ${files.length > 1 ? `${files.length} arquivos` : 'edital'}`}
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
            <p className="text-slate-400 text-sm mt-1">{progresso || 'Extraindo os dados do seguro'}</p>
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
                <Editavel valor={result.orgao_nome} tipo="texto" light onSalvar={corrigir('orgao_nome')}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-black text-white leading-tight">{result.orgao_nome || '—'}</h3>
                    {result.orgao_nome && <CopyBtn text={result.orgao_nome} light />}
                  </div>
                </Editavel>
                {/* CNPJ do beneficiário (segurado) */}
                <Editavel valor={result.orgao_cnpj} tipo="texto" placeholder="00.000.000/0000-00" light onSalvar={corrigir('orgao_cnpj')}>
                  <div className="flex items-center gap-2">
                    <Building2 size={13} className="text-white/40 shrink-0" />
                    <p className="text-white/60 text-sm font-mono">{result.orgao_cnpj || 'CNPJ do beneficiário não encontrado'}</p>
                    {result.orgao_cnpj && <CopyBtn text={result.orgao_cnpj} light />}
                  </div>
                  <OrigemLink light evidencia={ev('orgao_cnpj')} onVer={verOrigem('CNPJ do beneficiário', 'orgao_cnpj')} />
                </Editavel>
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

          {/* Como o edital foi lido */}
          <div className={`flex items-start gap-2 rounded-xl px-4 py-2.5 text-xs border ${result._origem === 'ocr' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-areia-clara border-linha text-slate-500'}`}>
            <Info size={14} className="shrink-0 mt-px" />
            <span>
              {result._origem === 'ocr'
                ? 'Documento escaneado, lido por OCR no seu computador. Confira cada número no trecho de origem.'
                : `Lido por regras no seu computador${result._total_paginas ? ` (${result._total_paginas} páginas)` : ''}, sem IA. Clique em "ver trecho" para conferir de onde veio cada dado e no lápis para corrigir.`}
              {(result._editados?.length ?? 0) > 0 && ` ${result._editados!.length} campo(s) corrigido(s) à mão.`}
            </span>
          </div>

          {/* Dados financeiros */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card
              icon={<DollarSign size={15} />}
              label="Valor Global do Edital"
              value={
                <Editavel valor={result.valor_global_edital} tipo="moeda" placeholder="Ex.: 1.393.413,10" onSalvar={corrigir('valor_global_edital')}>
                  {result.valor_global_edital != null ? fmtBRL(result.valor_global_edital) : NAO_ENCONTRADO}
                  <OrigemLink evidencia={ev('valor_global_edital')} onVer={verOrigem('Valor global do edital', 'valor_global_edital')} />
                </Editavel>
              }
              copyValue={fmtBRL(result.valor_global_edital) ?? undefined}
            />
            <Card
              icon={<Shield size={15} />}
              label="% Garantia de Proposta"
              value={
                <Editavel valor={result.percentual_garantia_proposta} tipo="numero" placeholder="Ex.: 1" onSalvar={corrigir('percentual_garantia_proposta')}>
                  {result.percentual_garantia_proposta != null
                    ? `${String(result.percentual_garantia_proposta).replace('.', ',')}%`
                    : result.exige_garantia_proposta === false ? '—' : NAO_ENCONTRADO}
                  <OrigemLink evidencia={ev('percentual_garantia_proposta')} onVer={verOrigem('Percentual da garantia de proposta', 'percentual_garantia_proposta')} />
                </Editavel>
              }
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
              value={
                <Editavel valor={result.data_sessao_publica} tipo="texto" placeholder="DD/MM/AAAA HH:MM" onSalvar={corrigir('data_sessao_publica')}>
                  {result.data_sessao_publica ?? NAO_ENCONTRADO}
                  <OrigemLink evidencia={ev('data_sessao_publica')} onVer={verOrigem('Data da sessão pública', 'data_sessao_publica')} />
                </Editavel>
              }
              copyValue={result.data_sessao_publica ?? undefined}
            />
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-slate-400"><Calendar size={15} /></span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vigência da Garantia de Proposta</span>
              </div>
              <Editavel valor={result.vigencia_garantia_proposta_dias} tipo="numero" placeholder="Dias (ex.: 90)" onSalvar={corrigir('vigencia_garantia_proposta_dias')}>
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
              <OrigemLink evidencia={ev('vigencia_garantia_proposta_dias')} onVer={verOrigem('Vigência da garantia de proposta', 'vigencia_garantia_proposta_dias')} />
              </Editavel>
              {result.vigencia_garantia_proposta_dias != null && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <Editavel valor={result.vigencia_garantia_termo_inicial} tipo="termo" onSalvar={corrigir('vigencia_garantia_termo_inicial')}>
                    <p className="text-xs text-slate-500">
                      Contada a partir de: <strong className="text-slate-700">{
                        result.vigencia_garantia_termo_inicial === 'sessao_publica' ? 'sessão pública / abertura'
                          : result.vigencia_garantia_termo_inicial === 'entrega_proposta' ? 'entrega da proposta'
                          : result.vigencia_garantia_termo_inicial === 'emissao' ? 'emissão da apólice'
                          : 'não informado'}</strong>
                    </p>
                  </Editavel>
                </div>
              )}
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
              <div className={`px-6 py-4 rounded-2xl border font-bold ${styles[desc.kind]}`}>
                <Editavel valor={result.exige_garantia_proposta} tipo="simnao" onSalvar={corrigir('exige_garantia_proposta')}>
                  <div className="flex items-center gap-3">
                    {icons[desc.kind]}
                    <span>{desc.text}</span>
                  </div>
                  <div className="pl-8"><OrigemLink evidencia={ev('exige_garantia_proposta')} onVer={verOrigem('Exigência da garantia de proposta', 'exige_garantia_proposta')} /></div>
                </Editavel>
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
                  <span className="font-bold text-amber-800 text-xs uppercase tracking-[1.5px]">Observações</span>
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

      {origemAberta && evidenciaAberta && (
        <VisualizadorTrecho
          titulo={origemAberta.titulo}
          evidencia={evidenciaAberta}
          pdf={pdfAberto}
          onFechar={fecharOrigem}
        />
      )}
    </div>
  );
}
