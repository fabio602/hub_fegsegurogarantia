import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, Loader2, Handshake, ShieldCheck, RefreshCw, ExternalLink, AlertTriangle, X, Send, CheckCircle2, MessageSquareWarning, Clock, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast.tsx';
import { formatCurrency } from '../utils/formatters.ts';

/**
 * Demandas que o parceiro envia pelo portal (public/parceiros.html) entram na
 * `sales` como "Em andamento" com o edital ou contrato em `anexos_demanda`
 * (migração 129). Os arquivos ficam no bucket privado parceiro-demandas e só
 * abrem por link assinado, gerado na hora do clique.
 */

export interface AnexoDemanda {
    path: string;
    nome?: string;
    tamanho?: number;
    tipo?: string;
}

const BUCKET = 'parceiro-demandas';

export function anexosDaVenda(sale: unknown): AnexoDemanda[] {
    const lista = (sale as { anexos_demanda?: unknown })?.anexos_demanda;
    return Array.isArray(lista) ? (lista as AnexoDemanda[]).filter((a) => a && typeof a.path === 'string') : [];
}

const tamanhoTexto = (b?: number) => {
    if (!b || b <= 0) return '';
    return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};

/** Abre o anexo numa aba nova. A aba abre antes do await para o navegador não bloquear. */
function useAbrirAnexo(bucket: string = BUCKET) {
    const { toast } = useToast();
    const [abrindo, setAbrindo] = useState<string | null>(null);
    const abrir = async (a: AnexoDemanda) => {
        const aba = window.open('', '_blank');
        setAbrindo(a.path);
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(a.path, 600);
        setAbrindo(null);
        if (error || !data?.signedUrl) {
            aba?.close();
            toast(`Não consegui abrir "${a.nome || 'o arquivo'}": ${error?.message || 'tente de novo.'}`, 'error');
            return;
        }
        if (aba) aba.location.href = data.signedUrl;
        else window.location.href = data.signedUrl;
    };
    return { abrir, abrindo };
}

function ListaArquivos({ anexos }: { anexos: AnexoDemanda[] }) {
    const { abrir, abrindo } = useAbrirAnexo();
    return (
        <ul className="flex flex-col gap-1.5">
            {anexos.map((a) => (
                <li key={a.path}>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void abrir(a); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-left text-xs font-semibold text-navy hover:border-gold hover:bg-areia-clara transition-colors"
                    >
                        {abrindo === a.path ? <Loader2 size={14} className="animate-spin shrink-0 text-gold-dark" /> : <FileText size={14} className="shrink-0 text-gold-dark" />}
                        <span className="truncate flex-1" title={a.nome}>{a.nome || a.path.split('/').pop()}</span>
                        <span className="text-[10px] font-medium text-slate-400 shrink-0">{tamanhoTexto(a.tamanho)}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

// ── Cotação na Junto feita pelo parceiro no portal (migração 131) ──────────
//
// O parceiro cota o Licitante na Junto pelo portal e pede a emissão; a minuta
// já sai gerada. Aqui a F&G confere e emite. A emissão é irreversível e passa
// pela Edge Function junto-emissao, que exige a confirmação daquele documento.

export interface CotacaoPortal {
    id: number;
    cotacao_externa_id: number | null;
    status: 'cotada' | 'recusada' | 'emissao_solicitada' | 'emitindo' | 'em_analise' | 'emitida' | 'cancelada';
    motivo_recusa: string | null;
    erro: string | null;
    tomador_cnpj: string;
    tomador_nome: string | null;
    segurado_cnpj: string;
    segurado_nome: string | null;
    valor_garantia: number;
    inicio_vigencia: string;
    dias: number;
    premio: number | null;
    comissao_fg: number | null;
    comissao_parceiro: number | null;
    comissao_parceiro_pct: number | null;
    edital: string | null;
    minuta_url: string | null;
    minuta_pendencias: boolean | null;
    sale_id: number | null;
    numero_apolice: string | null;
    emitida_em: string | null;
    emitida_por: string | null;
    created_at: string;
}

const PENDENTES = ['emissao_solicitada', 'emitindo', 'em_analise'];

// Situação das cotações que esperam a F&G, lida uma vez e dividida entre as
// etiquetas da tabela (uma consulta só, não uma por linha).
let pendentesCache: Promise<Map<number, string>> | null = null;
const ouvintesPendentes = new Set<() => void>();

function carregarPendentes(): Promise<Map<number, string>> {
    if (!pendentesCache) {
        pendentesCache = Promise.resolve(
            supabase.from('cotacoes_portal').select('sale_id, status').in('status', PENDENTES).not('sale_id', 'is', null),
        ).then(({ data }) => new Map((data || []).map((c: { sale_id: number; status: string }) => [c.sale_id, c.status])))
            .catch(() => new Map<number, string>());
    }
    return pendentesCache;
}

function avisarMudancaPendentes() {
    pendentesCache = null;
    ouvintesPendentes.forEach((f) => f());
}

function useStatusPedidoJunto(saleId: number | undefined) {
    const [status, setStatus] = useState<string | null>(null);
    useEffect(() => {
        if (!saleId) return;
        let vivo = true;
        const ler = () => { void carregarPendentes().then((m) => { if (vivo) setStatus(m.get(saleId) || null); }); };
        ler();
        ouvintesPendentes.add(ler);
        return () => { vivo = false; ouvintesPendentes.delete(ler); };
    }, [saleId]);
    return status;
}

async function chamarFuncao(nome: string, body: Record<string, unknown>, erroPadrao = 'Erro ao falar com o servidor.') {
    const { data, error } = await supabase.functions.invoke(nome, { body });
    if (error) {
        // A função responde 4xx com a mensagem no corpo; o supabase-js esconde o corpo no context.
        let msg = error.message || erroPadrao;
        try {
            const corpo = await (error as { context?: Response }).context?.json?.();
            if (corpo?.error) msg = corpo.error;
        } catch { /* mantém a mensagem genérica */ }
        throw new Error(msg);
    }
    if (!data?.success) throw new Error(data?.error || 'A função recusou o pedido.');
    return data;
}

const chamarEmissao = (body: Record<string, unknown>) => chamarFuncao('junto-emissao', body, 'Erro ao falar com a Junto.');

const dataBr = (iso?: string | null) => (iso ? String(iso).slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') : '');
function fimVigencia(inicio: string, dias: number) {
    const d = new Date(`${inicio}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

const SITUACAO: Record<CotacaoPortal['status'], { rotulo: string; classe: string }> = {
    emissao_solicitada: { rotulo: 'Aguardando a sua aprovação', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
    emitindo: { rotulo: 'Emitindo na Junto', classe: 'bg-blue-50 text-blue-800 border-blue-200' },
    em_analise: { rotulo: 'Em análise na Junto', classe: 'bg-blue-50 text-blue-800 border-blue-200' },
    emitida: { rotulo: 'Emitida', classe: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    cancelada: { rotulo: 'Não emitida', classe: 'bg-slate-50 text-slate-600 border-slate-200' },
    cotada: { rotulo: 'Cotada, sem pedido', classe: 'bg-slate-50 text-slate-600 border-slate-200' },
    recusada: { rotulo: 'A Junto não cotou', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
};

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-400">{rotulo}</div>
            <div className="text-xs font-semibold text-navy mt-0.5 break-words">{children}</div>
        </div>
    );
}

function ModalEmitir({ cot, onFechar, onConfirmar, emitindo }: {
    cot: CotacaoPortal; onFechar: () => void; onConfirmar: () => void; emitindo: boolean;
}) {
    const [conferi, setConferi] = useState(false);
    const fim = fimVigencia(cot.inicio_vigencia, cot.dias);
    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-navy/60" onClick={() => { if (!emitindo) onFechar(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="titulo-emitir" className="w-full max-w-lg rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 p-6 border-b border-linha">
                    <div>
                        <h3 id="titulo-emitir" className="text-base font-black text-navy">Emitir a apólice na Junto?</h3>
                        <p className="text-xs text-slate-500 mt-1">A emissão não pode ser desfeita. A Junto manda apólice e boleto para a F&amp;G e para o e-mail do cliente.</p>
                    </div>
                    <button type="button" onClick={onFechar} disabled={emitindo} className="p-1.5 rounded-lg text-slate-400 hover:text-navy disabled:opacity-40" aria-label="Fechar"><X size={18} /></button>
                </div>
                <div className="p-6 grid grid-cols-2 gap-4">
                    <div className="col-span-2"><Dado rotulo="Tomador">{cot.tomador_nome || cot.tomador_cnpj}<span className="block text-[10px] font-medium text-slate-400">{cot.tomador_cnpj}</span></Dado></div>
                    <div className="col-span-2"><Dado rotulo="Órgão (segurado)">{cot.segurado_nome || cot.segurado_cnpj}<span className="block text-[10px] font-medium text-slate-400">{cot.segurado_cnpj}</span></Dado></div>
                    <Dado rotulo="Edital ou processo">{cot.edital || 'Não informado'}</Dado>
                    <Dado rotulo="Garantia">{formatCurrency(cot.valor_garantia)}</Dado>
                    <Dado rotulo="Vigência">{dataBr(cot.inicio_vigencia)} a {dataBr(fim)} ({cot.dias} dias)</Dado>
                    <Dado rotulo="Prêmio">{cot.premio != null ? formatCurrency(cot.premio) : 'Sem prêmio'}</Dado>
                    <Dado rotulo="Cotação na Junto">nº {cot.cotacao_externa_id}</Dado>
                    <Dado rotulo="Minuta">
                        {cot.minuta_url
                            ? <a href={cot.minuta_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gold-dark hover:underline">Abrir <ExternalLink size={11} /></a>
                            : 'Não gerada'}
                    </Dado>
                </div>
                <div className="px-6 pb-6">
                    <label className="flex items-start gap-2 p-3 rounded-xl border border-linha bg-areia-clara cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={conferi} onChange={(e) => setConferi(e.target.checked)} disabled={emitindo} />
                        <span className="text-xs text-navy font-semibold">Conferi a minuta com o edital e quero emitir esta apólice.</span>
                    </label>
                    <div className="flex gap-2 justify-end mt-4">
                        <button type="button" onClick={onFechar} disabled={emitindo} className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Voltar</button>
                        <button type="button" onClick={onConfirmar} disabled={!conferi || emitindo} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-white text-xs font-black hover:bg-navy-light disabled:opacity-40">
                            {emitindo ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                            {emitindo ? 'Emitindo...' : 'Emitir apólice agora'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Bloco do pedido feito pela cotação na hora: valores da Junto, minuta e os
 * botões de aprovação. `antesDeEmitir` grava o que estiver pendente no
 * formulário; `aposEmitir` fecha o formulário sem salvar por cima e recarrega,
 * porque a emissão muda a venda no banco (vendeu, apólice, boleto).
 */
/**
 * Mesmos avisos ao parceiro que o Registro de Vendas manda quando a venda vira
 * "Sim" pelo botão de salvar (ResultsDashboard.handleSave). Apólice e boleto
 * para o cliente quem manda é a Junto, pelos contatos da minuta.
 */
async function avisarParceiroEmissao(sale: { id: number; parceiro?: string | null; nome?: string | null; tipo?: string | null }) {
    if (!sale.parceiro) return;
    const { data: p } = await supabase.from('partners').select('name, email').eq('name', sale.parceiro).maybeSingle();
    if (!p?.email) return;
    supabase.functions.invoke('parceiro-status-changed', {
        body: { saleId: sale.id, oldVendeu: 'Em andamento', newVendeu: 'Sim', parceiro: sale.parceiro },
    }).catch((e) => console.warn('aviso de emissão ao parceiro:', e));
    supabase.functions.invoke('parceiro-referral-thanks', {
        body: { partnerName: p.name, partnerEmail: p.email, clientName: sale.nome || '', productType: sale.tipo || 'Seguro Garantia' },
    }).catch((e) => console.warn('agradecimento ao parceiro:', e));
}

function PainelCotacaoJunto({ sale, antesDeEmitir, aposEmitir }: {
    sale: { id: number; parceiro?: string | null; nome?: string | null; tipo?: string | null };
    antesDeEmitir?: () => Promise<unknown> | void; aposEmitir?: () => void;
}) {
    const saleId = sale.id;
    const { toast } = useToast();
    const [cot, setCot] = useState<CotacaoPortal | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [ocupado, setOcupado] = useState<'' | 'consultar' | 'emitir' | 'cancelar'>('');
    const [modal, setModal] = useState(false);
    const [situacaoJunto, setSituacaoJunto] = useState<string | null>(null);

    const ler = useCallback(async () => {
        const { data } = await supabase.from('cotacoes_portal').select('*')
            .eq('sale_id', saleId).order('id', { ascending: false }).limit(1).maybeSingle();
        setCot((data as CotacaoPortal) || null);
        setCarregando(false);
    }, [saleId]);

    useEffect(() => { void ler(); }, [ler]);

    if (carregando || !cot) return null;
    const sit = SITUACAO[cot.status] || SITUACAO.cotada;
    const pode = cot.status === 'emissao_solicitada' || cot.status === 'em_analise';
    const fim = fimVigencia(cot.inicio_vigencia, cot.dias);

    const consultar = async () => {
        setOcupado('consultar');
        try {
            const r = await chamarEmissao({ acao: 'consultar', cotacao_id: cot.id });
            setSituacaoJunto(r.junto?.emitida ? `Emitida na Junto (apólice ${r.junto.numero_apolice || ''})` : (r.junto?.situacao || null));
            await ler();
            toast('Situação atualizada com a Junto.', 'success');
        } catch (e) {
            toast(e instanceof Error ? e.message : String(e), 'error');
        } finally { setOcupado(''); }
    };

    const emitir = async () => {
        setOcupado('emitir');
        try {
            await antesDeEmitir?.();
            const r = await chamarEmissao({ acao: 'emitir', cotacao_id: cot.id, confirmacao: String(cot.cotacao_externa_id) });
            setModal(false);
            avisarMudancaPendentes();
            if (r.status === 'emitida') {
                toast(`Apólice ${r.numero_apolice || ''} emitida na Junto. A venda foi marcada como vendida.`, 'success', 6000);
                if (!r.ja_emitida) void avisarParceiroEmissao(sale);
                aposEmitir?.();
                return;
            }
            toast(`A Junto segurou a emissão: ${r.situacao || 'em análise'}. Acompanhe por "Atualizar da Junto".`, 'warning', 7000);
            await ler();
        } catch (e) {
            toast(e instanceof Error ? e.message : String(e), 'error', 7000);
            await ler();
        } finally { setOcupado(''); }
    };

    const cancelar = async () => {
        if (!window.confirm('Não emitir esta cotação pela Junto? O parceiro deixa de ver "Emissão pedida" e a venda continua aqui para cotar de outro jeito.')) return;
        setOcupado('cancelar');
        try {
            await chamarEmissao({ acao: 'cancelar', cotacao_id: cot.id });
            avisarMudancaPendentes();
            await ler();
            toast('Cotação da Junto marcada como não emitida.', 'info');
        } catch (e) {
            toast(e instanceof Error ? e.message : String(e), 'error');
        } finally { setOcupado(''); }
    };

    return (
        <div className="mt-4 p-4 rounded-2xl border border-linha bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={15} className="text-navy" />
                    <span className="text-xs font-black text-navy">Cotação na hora pela Junto</span>
                    {cot.cotacao_externa_id && <span className="text-[10px] font-semibold text-slate-400">nº {cot.cotacao_externa_id}</span>}
                </div>
                <span className={`px-2.5 py-1 rounded-full border text-[10px] font-black ${sit.classe}`}>{sit.rotulo}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Dado rotulo="Prêmio">{cot.premio != null ? formatCurrency(cot.premio) : 'Sem prêmio'}</Dado>
                <Dado rotulo="Comissão F&G">{cot.comissao_fg != null ? formatCurrency(cot.comissao_fg) : '-'}</Dado>
                <Dado rotulo="Comissão do parceiro">{cot.comissao_parceiro != null ? `${formatCurrency(cot.comissao_parceiro)} (${String(cot.comissao_parceiro_pct ?? '').replace('.', ',')}%)` : '-'}</Dado>
                <Dado rotulo="Garantia">{formatCurrency(cot.valor_garantia)}</Dado>
                <Dado rotulo="Vigência">{dataBr(cot.inicio_vigencia)} a {dataBr(fim)} ({cot.dias} dias)</Dado>
                <Dado rotulo="Órgão">{cot.segurado_nome || cot.segurado_cnpj}</Dado>
                <Dado rotulo="Edital ou processo">{cot.edital || 'Não informado'}</Dado>
                <Dado rotulo="Minuta">
                    {cot.minuta_url
                        ? <a href={cot.minuta_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gold-dark hover:underline">Abrir a minuta <ExternalLink size={11} /></a>
                        : 'Não gerada'}
                </Dado>
            </div>

            {cot.minuta_pendencias && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    A Junto pediu documentos antes de emitir. Anexe pela plataforma da Junto e depois emita aqui.
                </div>
            )}
            {cot.status === 'emitida' && (
                <p className="mt-3 text-xs text-emerald-800">Apólice {cot.numero_apolice || ''} emitida em {dataBr(cot.emitida_em)}{cot.emitida_por ? ` por ${cot.emitida_por}` : ''}.</p>
            )}
            {cot.erro && cot.status !== 'emitida' && (
                <p className="mt-3 text-[11px] text-slate-500">{cot.erro}</p>
            )}
            {situacaoJunto && <p className="mt-2 text-[11px] text-blue-800">Na Junto agora: {situacaoJunto}</p>}

            {(pode || cot.status === 'emitindo') && (
                <div className="flex flex-wrap gap-2 mt-4">
                    {pode && (
                        <button type="button" onClick={() => setModal(true)} disabled={!!ocupado || !cot.minuta_url}
                            title={cot.minuta_url ? '' : 'A minuta ainda não foi gerada na Junto'}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-white text-xs font-black hover:bg-navy-light disabled:opacity-40">
                            <ShieldCheck size={14} /> {cot.status === 'em_analise' ? 'Tentar emitir de novo' : 'Emitir na Junto'}
                        </button>
                    )}
                    <button type="button" onClick={consultar} disabled={!!ocupado}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-navy hover:bg-slate-50 disabled:opacity-40">
                        {ocupado === 'consultar' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Atualizar da Junto
                    </button>
                    {pode && (
                        <button type="button" onClick={cancelar} disabled={!!ocupado}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40">
                            {ocupado === 'cancelar' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Não emitir
                        </button>
                    )}
                </div>
            )}

            {modal && <ModalEmitir cot={cot} emitindo={ocupado === 'emitir'} onFechar={() => setModal(false)} onConfirmar={emitir} />}
        </div>
    );
}

// ── Minuta devolvida ao parceiro para validação (migração 146) ─────────────
//
// A F&G anexa a minuta aqui; o parceiro recebe o e-mail, abre no portal e
// responde "Aprovar" ou "Pedir ajuste". Cada envio é uma rodada (versão) da
// tabela demanda_minutas. Quem grava é a Edge Function demanda-minuta; a
// tela só sobe o arquivo no bucket privado e lê as rodadas.

const BUCKET_MINUTAS = 'demanda-minutas';
const MINUTA_MAX_BYTES = 30 * 1024 * 1024;
const MINUTA_EXTENSOES = ['pdf', 'doc', 'docx'];

type StatusMinuta = 'aguardando' | 'aprovada' | 'ajuste_solicitado' | 'substituida';

interface RodadaMinuta {
    id: number;
    sale_id: number;
    versao: number;
    arquivo_path: string;
    arquivo_nome: string;
    arquivo_tamanho: number | null;
    observacao_fg: string | null;
    enviada_por: string;
    enviada_em: string;
    status: StatusMinuta;
    resposta_parceiro: string | null;
    respondida_em: string | null;
}

const SITUACAO_MINUTA: Record<StatusMinuta, { rotulo: string; curto: string; classe: string }> = {
    aguardando: { rotulo: 'Aguardando o parceiro', curto: 'Minuta com o parceiro', classe: 'bg-blue-50 text-blue-800 border-blue-200' },
    aprovada: { rotulo: 'Aprovada pelo parceiro', curto: 'Minuta aprovada', classe: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    ajuste_solicitado: { rotulo: 'Ajuste solicitado', curto: 'Ajuste pedido', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
    substituida: { rotulo: 'Substituída por versão nova', curto: 'Substituída', classe: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const dataHoraBr = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
};

function nomeArquivoSeguro(nome: string): string {
    const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return (base || 'minuta').slice(-90);
}

// Situação da última rodada de cada venda, lida uma vez para as etiquetas da tabela.
let minutasCache: Promise<Map<number, StatusMinuta>> | null = null;
const ouvintesMinutas = new Set<() => void>();

function carregarSituacaoMinutas(): Promise<Map<number, StatusMinuta>> {
    if (!minutasCache) {
        minutasCache = Promise.resolve(
            supabase.from('demanda_minutas').select('sale_id, versao, status').neq('status', 'substituida').order('versao', { ascending: true }),
        ).then(({ data }) => new Map((data || []).map((r: { sale_id: number; status: StatusMinuta }) => [r.sale_id, r.status])))
            .catch(() => new Map<number, StatusMinuta>());
    }
    return minutasCache;
}

function avisarMudancaMinutas() {
    minutasCache = null;
    ouvintesMinutas.forEach((f) => f());
}

/** Etiqueta curta na tabela: em que pé está a minuta com o parceiro. */
function SeloMinutaParceiro({ saleId }: { saleId?: number }) {
    const [status, setStatus] = useState<StatusMinuta | null>(null);
    useEffect(() => {
        if (!saleId) return;
        let vivo = true;
        const ler = () => { void carregarSituacaoMinutas().then((m) => { if (vivo) setStatus(m.get(saleId) || null); }); };
        ler();
        ouvintesMinutas.add(ler);
        return () => { vivo = false; ouvintesMinutas.delete(ler); };
    }, [saleId]);
    if (!status) return null;
    const sit = SITUACAO_MINUTA[status];
    return (
        <span className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-xl border text-[11px] font-bold ${sit.classe}`}
            title="Minuta enviada ao parceiro pelo portal para validação">
            <FileText size={11} /> {sit.curto}
        </span>
    );
}

function PainelMinutaParceiro({ sale }: { sale: { id: number; parceiro?: string | null } }) {
    const { toast } = useToast();
    const { abrir, abrindo } = useAbrirAnexo(BUCKET_MINUTAS);
    const [rodadas, setRodadas] = useState<RodadaMinuta[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [arquivo, setArquivo] = useState<File | null>(null);
    const [observacao, setObservacao] = useState('');
    const [enviando, setEnviando] = useState(false);
    const campoArquivo = useRef<HTMLInputElement>(null);

    const ler = useCallback(async () => {
        const { data } = await supabase.from('demanda_minutas').select('*')
            .eq('sale_id', sale.id).order('versao', { ascending: false });
        setRodadas((data as RodadaMinuta[]) || []);
        setCarregando(false);
    }, [sale.id]);

    useEffect(() => { void ler(); }, [ler]);

    const escolher = (f: File | null) => {
        if (!f) { setArquivo(null); return; }
        const ext = (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] || '').toLowerCase();
        if (!MINUTA_EXTENSOES.includes(ext)) { toast('A minuta precisa ser PDF ou Word.', 'error'); return; }
        if (f.size > MINUTA_MAX_BYTES) { toast('O arquivo passa de 30 MB.', 'error'); return; }
        setArquivo(f);
    };

    const enviar = async () => {
        if (!arquivo || enviando) return;
        setEnviando(true);
        try {
            const path = `v${sale.id}/${Date.now()}-${nomeArquivoSeguro(arquivo.name)}`;
            const { error: eUp } = await supabase.storage.from(BUCKET_MINUTAS)
                .upload(path, arquivo, { contentType: arquivo.type || undefined, upsert: false });
            if (eUp) throw new Error(`Não consegui subir o arquivo: ${eUp.message}`);
            const r = await chamarFuncao('demanda-minuta', {
                acao: 'enviar', sale_id: sale.id,
                arquivo: { path, nome: arquivo.name, tamanho: arquivo.size },
                observacao,
            });
            setArquivo(null);
            setObservacao('');
            if (campoArquivo.current) campoArquivo.current.value = '';
            avisarMudancaMinutas();
            await ler();
            if (r.email_enviado) toast(`Minuta enviada. O parceiro foi avisado em ${r.parceiro_email}.`, 'success', 6000);
            else if (!r.parceiro_email) toast('Minuta enviada ao portal, mas o parceiro não tem e-mail no cadastro. Avise por outro canal.', 'warning', 8000);
            else toast('Minuta enviada ao portal, mas o e-mail de aviso falhou. Avise o parceiro por outro canal.', 'warning', 8000);
        } catch (e) {
            toast(e instanceof Error ? e.message : String(e), 'error', 7000);
        } finally { setEnviando(false); }
    };

    if (carregando) return null;
    const atual = rodadas[0];
    const esperando = atual?.status === 'aguardando';

    return (
        <div className="mt-4 p-4 rounded-2xl border border-linha bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                    <Send size={15} className="text-navy" />
                    <span className="text-xs font-bold text-navy">Minuta para o parceiro validar</span>
                </div>
                {atual && <span className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${SITUACAO_MINUTA[atual.status].classe}`}>{SITUACAO_MINUTA[atual.status].rotulo}</span>}
            </div>

            {rodadas.length === 0 && (
                <p className="text-xs text-slate-500 mb-3">Anexe a minuta da seguradora. O parceiro recebe o e-mail, abre no portal e responde "Aprovar" ou "Pedir ajuste".</p>
            )}

            {rodadas.length > 0 && (
                <ol className="flex flex-col gap-2 mb-4">
                    {rodadas.map((r) => {
                        const Icone = r.status === 'aprovada' ? CheckCircle2 : r.status === 'ajuste_solicitado' ? MessageSquareWarning : Clock;
                        return (
                            <li key={r.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-bold text-slate-500">Versão {r.versao}</span>
                                    <button type="button" onClick={() => void abrir({ path: r.arquivo_path, nome: r.arquivo_nome })}
                                        className="inline-flex items-center gap-1.5 min-w-0 text-xs font-semibold text-navy hover:text-gold-dark">
                                        {abrindo === r.arquivo_path ? <Loader2 size={13} className="animate-spin shrink-0" /> : <FileText size={13} className="shrink-0 text-gold-dark" />}
                                        <span className="truncate" title={r.arquivo_nome}>{r.arquivo_nome}</span>
                                    </button>
                                    <span className="text-[11px] text-slate-400">enviada em {dataHoraBr(r.enviada_em)} por {r.enviada_por.split('@')[0]}</span>
                                </div>
                                {r.observacao_fg && <p className="mt-1.5 text-xs text-slate-600 whitespace-pre-line">F&amp;G: {r.observacao_fg}</p>}
                                <div className="mt-2 flex items-start gap-1.5 text-xs">
                                    <Icone size={13} className={`shrink-0 mt-0.5 ${r.status === 'aprovada' ? 'text-emerald-700' : r.status === 'ajuste_solicitado' ? 'text-amber-700' : 'text-slate-400'}`} />
                                    <div className="min-w-0">
                                        <span className="font-semibold text-navy">{SITUACAO_MINUTA[r.status].rotulo}</span>
                                        {r.respondida_em && <span className="text-slate-400"> em {dataHoraBr(r.respondida_em)}</span>}
                                        {r.resposta_parceiro && <p className="mt-0.5 text-slate-700 whitespace-pre-line break-words">{r.resposta_parceiro}</p>}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}

            {esperando && (
                <p className="mb-3 text-[11px] text-slate-500">O parceiro ainda não respondeu. Enviar outra minuta agora substitui a versão {atual.versao}.</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <input ref={campoArquivo} type="file" accept=".pdf,.doc,.docx" className="hidden"
                        onChange={(e) => escolher(e.target.files?.[0] || null)} />
                    <button type="button" onClick={() => campoArquivo.current?.click()} disabled={enviando}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 bg-white text-left text-xs font-semibold text-navy hover:border-gold hover:bg-areia-clara disabled:opacity-40">
                        <Upload size={14} className="shrink-0 text-gold-dark" />
                        <span className="truncate flex-1">{arquivo ? arquivo.name : (rodadas.length ? 'Escolher a minuta ajustada (PDF ou Word)' : 'Escolher a minuta (PDF ou Word)')}</span>
                        {arquivo && <span className="text-[11px] font-medium text-slate-400 shrink-0">{tamanhoTexto(arquivo.size)}</span>}
                    </button>
                </div>
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} disabled={enviando} maxLength={1000} rows={2}
                    placeholder="Recado para o parceiro (opcional)"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-navy placeholder:text-slate-400 focus:outline-none focus:border-gold resize-y" />
            </div>
            <div className="flex justify-end mt-3">
                <button type="button" onClick={enviar} disabled={!arquivo || enviando}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-40">
                    {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {enviando ? 'Enviando...' : rodadas.length ? 'Enviar versão nova ao parceiro' : 'Enviar minuta para validação'}
                </button>
            </div>
        </div>
    );
}

/** Etiqueta curta na tabela quando a cotação da Junto espera a F&G. */
function SeloPedidoJunto({ saleId }: { saleId?: number }) {
    const status = useStatusPedidoJunto(saleId);
    if (!status) return null;
    const em = status === 'emissao_solicitada';
    return (
        <span className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-xl border text-[10px] font-bold ${em ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}
            title="Cotação na hora pela Junto feita no portal do parceiro">
            <ShieldCheck size={11} /> {em ? 'Emissão pedida' : 'Na Junto'}
        </span>
    );
}

/**
 * Etiqueta na linha do Registro de Vendas: mostra que veio do portal e abre os
 * anexos. A lista abre embaixo da etiqueta, dentro da própria célula, porque a
 * tabela rola na horizontal e um menu flutuante ficaria cortado nas últimas linhas.
 */
export function ChipAnexosParceiro({ sale }: { sale: unknown }) {
    const anexos = anexosDaVenda(sale);
    const [aberto, setAberto] = useState(false);
    if (anexos.length === 0) return null;
    return (
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                onClick={() => setAberto((v) => !v)}
                aria-expanded={aberto}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl border border-gold/40 bg-areia-clara text-[10px] font-bold text-gold-dark hover:border-gold transition-colors"
                title="Demanda enviada pelo portal do parceiro"
            >
                <Paperclip size={11} /> Portal · {anexos.length} {anexos.length === 1 ? 'anexo' : 'anexos'}
            </button>
            <SeloPedidoJunto saleId={(sale as { id?: number })?.id} />
            <SeloMinutaParceiro saleId={(sale as { id?: number })?.id} />
            {aberto && (
                <div className="mt-1.5 max-w-[260px]">
                    <ListaArquivos anexos={anexos} />
                </div>
            )}
        </div>
    );
}

/** Painel no formulário de edição: dados que o parceiro mandou, os arquivos e a cotação da Junto. */
export function PainelDemandaParceiro({ sale, antesDeEmitir, aposEmitir }: {
    sale: unknown; antesDeEmitir?: () => Promise<unknown> | void; aposEmitir?: () => void;
}) {
    const anexos = anexosDaVenda(sale);
    if (anexos.length === 0) return null;
    const s = sale as { id?: number; parceiro?: string | null; obs?: string | null; nome?: string | null; tipo?: string | null };
    return (
        <div className="mb-8 p-5 rounded-2xl border border-gold/30 bg-areia-clara">
            <div className="flex items-center gap-2 mb-3">
                <Handshake size={16} className="text-gold-dark" />
                <span className="text-sm font-black text-navy">Demanda enviada pelo portal do parceiro</span>
                {s.parceiro && <span className="text-xs font-semibold text-slate-500">· {s.parceiro}</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {s.obs && (
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{s.obs}</p>
                )}
                <ListaArquivos anexos={anexos} />
            </div>
            {s.id ? <PainelCotacaoJunto sale={{ id: s.id, parceiro: s.parceiro, nome: s.nome, tipo: s.tipo }} antesDeEmitir={antesDeEmitir} aposEmitir={aposEmitir} /> : null}
            {s.id && s.parceiro ? <PainelMinutaParceiro sale={{ id: s.id, parceiro: s.parceiro }} /> : null}
        </div>
    );
}
