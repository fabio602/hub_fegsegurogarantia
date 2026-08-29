// -*- coding: utf-8 -*-
// Prospecção PNCP manual, restaurada do histórico (removida no commit 518c223).
// Diferenças para a versão original:
//   - consulta o PNCP direto (pncp.gov.br libera CORS), sem o proxy PHP da Hostinger
//   - enriquece contatos pela BrasilAPI (gratuita, sem token), no lugar do Empresas Aqui
// O envio para LEADS (tabela leads_seguro_garantia) continua igual.
import React, { useMemo, useState, useCallback } from 'react';
import {
    Search,
    Loader2,
    Building2,
    MapPin,
    Calendar,
    Download,
    Phone,
    Mail,
    User,
    Briefcase,
    DollarSign,
    AlertCircle,
    CheckCircle2,
    Send,
    X,
    Factory,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/formatters';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';
import type { BrasilApiEmpresa, PncpContratoNormalizado, PncpProbabilidadeSg, PncpTipoLeadEnviado } from '../types';

const PNCP_API = 'https://pncp.gov.br/api/consulta/v1/contratos';
const BRASILAPI_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1';
const PNCP_PAGE_SIZE = 50;
const PARALLEL_RANDOM_PAGES = 30;

const BRAZIL_UFS = [
    '', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
    'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const TIPO_LEAD_OPTIONS: PncpTipoLeadEnviado[] = [
    'Seguro Garantia',
    'Judicial',
    'Energia',
    'Seguro de Crédito',
];

const RE_OBRAS =
    /obra|obras|engenharia|constru(c|ç)(a|ã)o|reforma|infraestrutura|civil\b|pavimenta|ponte|viaduto|drenagem|aterro|supervis(a|ã)o de obra|empreitada|edifica(c|ç)(a|ã)o|pavimento/i;

const RE_CONTINUADOS =
    /manuten(c|ç)(a|ã)o|limpeza|vigil(â|a)ncia|seguran(c|ç)a patrimonial|terceiriza|outsourcing|continuado|fornecimento continuado|loca(c|ç)(a|ã)o de m(a|ã)o de obra|servi(c|ç)o continuad|conservação|zona escolar|recep(c|ç)(a|ã)o/i;

function cleanCnpj(ni: string): string {
    return (ni || '').replace(/\D/g, '').slice(0, 14);
}

function probabilidadeSg(objeto: string, valor: number): PncpProbabilidadeSg {
    const o = (objeto || '').toLowerCase();
    if (valor >= 200_000 && RE_OBRAS.test(o)) return 'alta';
    if (valor >= 200_000 && RE_CONTINUADOS.test(o)) return 'media';
    return 'verificar';
}

function isLikelyContador(razao: string): boolean {
    const n = (razao || '').toLowerCase();
    return /contábil|contabil|contador|contabilidade|escrit[oó]rio cont|ecac\b|crc\b/.test(n);
}

function randomDistinctPages(count: number, maxPage: number): number[] {
    const set = new Set<number>();
    const cap = Math.max(1, maxPage);
    const limit = Math.min(count, cap);
    while (set.size < limit) {
        set.add(1 + Math.floor(Math.random() * cap));
    }
    return [...set];
}

function mapPncpItem(raw: Record<string, unknown>): PncpContratoNormalizado | null {
    const nome = (raw.nomeRazaoSocialFornecedor as string) || '';
    const ni = (raw.niFornecedor as string) || '';
    if (!nome && !ni) return null;

    const orgaoEnt = raw.orgaoEntidade as Record<string, unknown> | undefined;
    const orgaoRazao = (orgaoEnt?.razaoSocial as string) || '';

    const unidade = raw.unidadeOrgao as Record<string, unknown> | undefined;
    const municipio = (unidade?.municipioNome as string) || '';
    const uf = (unidade?.ufSigla as string) || '';

    const objeto = (raw.objetoContrato as string) || '';
    const valor = Number(raw.valorGlobal ?? raw.valorInicial ?? 0) || 0;
    const dataAss = (raw.dataAssinatura as string) || '';

    const cnpjLimpo = cleanCnpj(ni);
    const dedupKey = `${cnpjLimpo}|${dataAss}|${orgaoRazao}|${valor}`;

    return {
        dedupKey,
        nomeRazaoSocialFornecedor: nome || '—',
        niFornecedor: ni,
        objetoContrato: objeto,
        valorGlobal: valor,
        orgaoRazaoSocial: orgaoRazao,
        municipioNome: municipio,
        ufSigla: uf,
        dataAssinatura: dataAss,
        probabilidadeSg: probabilidadeSg(objeto, valor),
    };
}

function parseBrasilApi(d: Record<string, unknown>): BrasilApiEmpresa {
    // Prefere o sócio administrador (pela qualificação); na falta, o primeiro do QSA.
    const qsa = Array.isArray(d.qsa)
        ? (d.qsa as { nome_socio?: unknown; qualificacao_socio?: unknown }[])
        : [];
    const admin = qsa.find((q) => /adminis/i.test(String(q?.qualificacao_socio ?? '')));
    const capital = Number(d.capital_social ?? 0);
    return {
        razaoSocial: String(d.razao_social ?? ''),
        nomeFantasia: String(d.nome_fantasia ?? ''),
        telefone: String(d.ddd_telefone_1 ?? '').trim(),
        email: String(d.email ?? '').trim().toLowerCase(),
        socioResponsavel: String((admin ?? qsa[0])?.nome_socio ?? ''),
        porte: String(d.porte ?? ''),
        capitalSocial: capital > 0 ? formatCurrency(capital) : '',
        cidade: String(d.municipio ?? ''),
        uf: String(d.uf ?? ''),
        cnaePrincipal: String(d.cnae_fiscal ?? ''),
        cnaeDescricao: String(d.cnae_fiscal_descricao ?? ''),
        situacao: String(d.descricao_situacao_cadastral ?? ''),
    };
}

function formatAssinatura(raw: string): string {
    if (!raw) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const [y, m, d] = raw.slice(0, 10).split('-');
        return `${d}/${m}/${y}`;
    }
    return raw;
}

function probBadgeClasses(p: PncpProbabilidadeSg): string {
    if (p === 'alta') return 'bg-blue-600 text-white';
    if (p === 'media') return 'bg-emerald-600 text-white';
    return 'bg-slate-400 text-white';
}

function probLabel(p: PncpProbabilidadeSg): string {
    if (p === 'alta') return 'Seguro Garantia: alta';
    if (p === 'media') return 'Seguro Garantia: média';
    return 'Seguro Garantia: verificar';
}

function qualityEvaluation(
    empresaNome: string,
    contact: BrasilApiEmpresa | undefined,
    hideContador: boolean
): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!contact) {
        reasons.push('Contato não consultado');
        return { ok: false, reasons };
    }
    if (hideContador && isLikelyContador(empresaNome)) {
        reasons.push('Perfil sugere serviços contábeis');
    }
    if (contact.situacao && contact.situacao.toUpperCase() !== 'ATIVA') {
        reasons.push(`Situação cadastral: ${contact.situacao}`);
    }
    const hasChannel = !!(contact.telefone?.replace(/\D/g, '') || contact.email);
    if (!hasChannel) {
        reasons.push('Sem telefone nem e-mail úteis');
    }
    if (reasons.length === 0) return { ok: true, reasons: [] };
    return { ok: false, reasons };
}

const PncpProspection: React.FC = () => {
    const [periodDays, setPeriodDays] = useState<15 | 30 | 60>(30);
    const [ufFilter, setUfFilter] = useState('');
    const [minValor, setMinValor] = useState(300_000);
    const [hideContador, setHideContador] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rawContracts, setRawContracts] = useState<PncpContratoNormalizado[]>([]);

    const [contactsByCnpj, setContactsByCnpj] = useState<Record<string, BrasilApiEmpresa>>({});
    const [contactLoad, setContactLoad] = useState<Record<string, boolean>>({});

    const [leadModal, setLeadModal] = useState<PncpContratoNormalizado | null>(null);
    const [leadTipo, setLeadTipo] = useState<PncpTipoLeadEnviado>('Seguro Garantia');
    const [sendingLead, setSendingLead] = useState(false);
    const [sentCnpjs, setSentCnpjs] = useState<Set<string>>(new Set());

    const dateRange = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - periodDays);
        const fmt = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
        return { dataInicial: fmt(start), dataFinal: fmt(end) };
    }, [periodDays]);

    const filtered = useMemo(() => {
        return rawContracts.filter((c) => {
            if (ufFilter && c.ufSigla !== ufFilter) return false;
            if (c.valorGlobal < minValor) return false;
            if (hideContador && isLikelyContador(c.nomeRazaoSocialFornecedor)) return false;
            return true;
        });
    }, [rawContracts, ufFilter, minValor, hideContador]);

    const fetchPncpPage = useCallback(async (pagina: number) => {
        const url = `${PNCP_API}?dataInicial=${dateRange.dataInicial}&dataFinal=${dateRange.dataFinal}` +
            `&pagina=${pagina}&tamanhoPagina=${PNCP_PAGE_SIZE}`;
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }, [dateRange]);

    const runSearch = async () => {
        setError(null);
        setLoading(true);
        setRawContracts([]);
        try {
            // A primeira página informa o total; as demais são amostradas
            // aleatoriamente dentro do período, como na versão original.
            const first = await fetchPncpPage(1);
            if (!first) {
                throw new Error('Não foi possível consultar o PNCP. Verifique a conexão e o período.');
            }
            const totalPaginas = Math.max(1, Number(first.totalPaginas) || 1);
            const extras = randomDistinctPages(PARALLEL_RANDOM_PAGES, totalPaginas).filter((p) => p !== 1);
            const results = await Promise.allSettled(extras.map((p) => fetchPncpPage(p)));

            const merged: PncpContratoNormalizado[] = [];
            const seen = new Set<string>();
            const pushRows = (rows: unknown[]) => {
                for (const row of rows) {
                    if (!row || typeof row !== 'object') continue;
                    const mapped = mapPncpItem(row as Record<string, unknown>);
                    if (!mapped) continue;
                    if (seen.has(mapped.dedupKey)) continue;
                    seen.add(mapped.dedupKey);
                    merged.push(mapped);
                }
            };

            pushRows(first.data ?? []);
            for (const r of results) {
                if (r.status !== 'fulfilled' || r.value == null) continue;
                pushRows(r.value.data ?? []);
            }

            merged.sort((a, b) => b.valorGlobal - a.valorGlobal);
            setRawContracts(merged);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Erro na busca PNCP');
        } finally {
            setLoading(false);
        }
    };

    const fetchContact = async (c: PncpContratoNormalizado) => {
        const cnpj = cleanCnpj(c.niFornecedor);
        if (!cnpj || cnpj.length < 14) {
            setError('CNPJ inválido para consulta.');
            return;
        }
        setContactLoad((m) => ({ ...m, [cnpj]: true }));
        setError(null);
        try {
            const res = await fetch(`${BRASILAPI_CNPJ}/${cnpj}`);
            if (!res.ok) throw new Error(`BrasilAPI HTTP ${res.status}`);
            const json = await res.json();
            const parsed = parseBrasilApi(json);

            // A BrasilAPI não retorna e-mail (a Receita retirou o campo dos
            // dados abertos). O e-mail vem da CNPJá aberta, com fallback no
            // cnpj.ws. As duas têm rate limit baixo (5/min e 3/min): em uso
            // manual não incomoda, mas consultas em sequência podem falhar.
            try {
                const r1 = await fetch(`https://open.cnpja.com/office/${cnpj}`);
                if (r1.ok) {
                    const d1 = await r1.json();
                    parsed.email = String(d1?.emails?.[0]?.address ?? '').toLowerCase();
                }
                if (!parsed.email) {
                    const r2 = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`);
                    if (r2.ok) {
                        const d2 = await r2.json();
                        parsed.email = String(d2?.estabelecimento?.email ?? '').toLowerCase();
                    }
                }
            } catch { /* sem e-mail é um estado válido; o card mostra o traço */ }

            setContactsByCnpj((m) => ({ ...m, [cnpj]: parsed }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao consultar a BrasilAPI');
        } finally {
            setContactLoad((m) => ({ ...m, [cnpj]: false }));
        }
    };

    const exportCsv = () => {
        const headers = [
            'empresa',
            'cnpj',
            'objeto_contrato',
            'valor_global',
            'orgao_contratante',
            'municipio',
            'uf',
            'data_assinatura',
            'probabilidade_sg',
            'telefone',
            'email',
            'socio_responsavel',
            'porte',
            'capital_social',
            'cnae_principal',
        ];
        const lines = filtered.map((c) => {
            const key = cleanCnpj(c.niFornecedor);
            const ct = contactsByCnpj[key];
            const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
            return [
                esc(c.nomeRazaoSocialFornecedor),
                esc(key),
                esc(c.objetoContrato),
                esc(c.valorGlobal),
                esc(c.orgaoRazaoSocial),
                esc(c.municipioNome),
                esc(c.ufSigla),
                esc(c.dataAssinatura),
                esc(c.probabilidadeSg),
                esc(ct?.telefone ?? ''),
                esc(ct?.email ?? ''),
                esc(ct?.socioResponsavel ?? ''),
                esc(ct?.porte ?? ''),
                esc(ct?.capitalSocial ?? ''),
                esc(ct ? `${ct.cnaePrincipal} ${ct.cnaeDescricao}` : ''),
            ].join(',');
        });
        const bom = '\uFEFF';
        const blob = new Blob([bom + [headers.join(','), ...lines].join('\n')], {
            type: 'text/csv;charset=utf-8;',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pncp_prospeccao_${dateRange.dataInicial}_${dateRange.dataFinal}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const confirmSendLead = async () => {
        if (!leadModal) return;
        const cnpj = cleanCnpj(leadModal.niFornecedor);
        const contact = contactsByCnpj[cnpj];
        setSendingLead(true);
        setError(null);
        try {
            const row = {
                tipo_lead: leadTipo,
                empresa: leadModal.nomeRazaoSocialFornecedor,
                cnpj,
                telefone: contact?.telefone || null,
                email: contact?.email || null,
                site: null,
                socio_responsavel: contact?.socioResponsavel || null,
                valor_contrato: leadModal.valorGlobal,
                objeto_contrato: leadModal.objetoContrato,
                orgao_contratante: leadModal.orgaoRazaoSocial,
                uf: leadModal.ufSigla,
                municipio: leadModal.municipioNome,
                data_assinatura: leadModal.dataAssinatura,
                probabilidade_sg: leadModal.probabilidadeSg,
                origem: 'PNCP',
                status: 'novo',
            };
            const { error: insErr } = await supabase.from('leads_seguro_garantia').insert(row);
            if (insErr) throw insErr;
            setSentCnpjs((prev) => new Set(prev).add(cnpj));
            setLeadModal(null);
        } catch (e: any) {
            setError(e?.message || 'Falha ao enviar lead. Rode o SQL 013 no Supabase se a tabela não existir.');
        } finally {
            setSendingLead(false);
        }
    };

    return (
        <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col lg:flex-row justify-between gap-4 items-start">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">Prospecção PNCP</h2>
                    <p className="text-slate-500 font-medium">
                        Amostragem aleatória de contratos (30 páginas em paralelo) no período escolhido, direto do PNCP.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    <button
                        type="button"
                        onClick={exportCsv}
                        disabled={filtered.length === 0}
                        className="bg-white text-[#1B263B] px-5 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"
                    >
                        <Download size={18} />
                        Exportar CSV
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-[2rem] p-6 md:p-8 shadow-sm border border-slate-100 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                            UF
                        </label>
                        <select
                            value={ufFilter}
                            onChange={(e) => setUfFilter(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30"
                        >
                            <option value="">Todas</option>
                            {BRAZIL_UFS.filter(Boolean).map((u) => (
                                <option key={u} value={u}>
                                    {u}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                            Valor mínimo (R$)
                        </label>
                        <input
                            type="number"
                            min={0}
                            step={1000}
                            value={minValor}
                            onChange={(e) => setMinValor(Number(e.target.value) || 0)}
                            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                            Período (dias)
                        </label>
                        <select
                            value={periodDays}
                            onChange={(e) => setPeriodDays(Number(e.target.value) as 15 | 30 | 60)}
                            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30"
                        >
                            <option value={15}>Últimos 15 dias</option>
                            <option value={30}>Últimos 30 dias</option>
                            <option value={60}>Últimos 60 dias</option>
                        </select>
                    </div>
                    <div className="flex flex-col justify-end gap-3">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={hideContador}
                                onChange={(e) => setHideContador(e.target.checked)}
                                className="rounded border-slate-300 text-[#C69C6D] focus:ring-[#C69C6D]"
                            />
                            Ocultar contador / contábil
                        </label>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    <button
                        type="button"
                        onClick={runSearch}
                        disabled={loading}
                        className="inline-flex items-center gap-2 bg-[#1B263B] text-white px-6 py-3 rounded-xl font-black text-sm shadow-lg hover:bg-[#243347] disabled:opacity-60 transition-all"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                        Buscar contratos PNCP
                    </button>
                </div>

                {error && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-bold">
                        <AlertCircle size={18} />
                        {error}
                    </div>
                )}

                <p className="text-xs text-slate-500 font-medium">
                    Exibindo <strong>{filtered.length}</strong> contratos (após filtros) de{' '}
                    <strong>{rawContracts.length}</strong> únicos na amostra.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {filtered.map((c) => {
                    const cnpjK = cleanCnpj(c.niFornecedor);
                    const contact = contactsByCnpj[cnpjK];
                    const loadingC = !!contactLoad[cnpjK];
                    const q = qualityEvaluation(c.nomeRazaoSocialFornecedor, contact, hideContador);

                    return (
                        <article
                            key={c.dedupKey}
                            className="bg-white rounded-[2rem] p-6 md:p-8 shadow-sm border border-slate-100 space-y-4"
                        >
                            <div className="flex flex-wrap justify-between gap-3 items-start">
                                <div className="space-y-1 min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Building2 size={18} className="text-[#C69C6D] shrink-0" />
                                        <h3 className="text-lg font-black text-[#1B263B] leading-tight break-words">
                                            {c.nomeRazaoSocialFornecedor}
                                        </h3>
                                    </div>
                                    <p className="text-xs font-mono text-slate-500">
                                        CNPJ: {cnpjK || c.niFornecedor}
                                    </p>
                                </div>
                                <span
                                    className={`shrink-0 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full ${probBadgeClasses(
                                        c.probabilidadeSg
                                    )}`}
                                >
                                    {probLabel(c.probabilidadeSg)}
                                </span>
                            </div>

                            <p className="text-sm text-slate-700 leading-relaxed">{c.objetoContrato || '—'}</p>

                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                                <div className="flex items-start gap-2">
                                    <DollarSign size={16} className="text-[#C69C6D] mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-slate-400">Valor global</p>
                                        <p className="font-bold text-slate-800">{formatCurrency(c.valorGlobal)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Briefcase size={16} className="text-[#C69C6D] mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-slate-400">Órgão</p>
                                        <p className="font-bold text-slate-800 leading-snug">{c.orgaoRazaoSocial || '—'}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <MapPin size={16} className="text-[#C69C6D] mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-slate-400">Local</p>
                                        <p className="font-bold text-slate-800">
                                            {c.municipioNome || '—'} / {c.ufSigla || '—'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 sm:col-span-2 lg:col-span-1">
                                    <Calendar size={16} className="text-[#C69C6D] mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-slate-400">Assinatura</p>
                                        <p className="font-bold text-slate-800">{formatAssinatura(c.dataAssinatura)}</p>
                                    </div>
                                </div>
                            </div>

                            {contact && (
                                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                        BrasilAPI (Receita Federal)
                                    </p>
                                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                                        <div className="flex items-center gap-2">
                                            <Phone size={14} className="text-[#C69C6D] shrink-0" />
                                            {contact.telefone ? (
                                                <WhatsAppPhoneLink phone={contact.telefone} className="font-medium text-slate-800" />
                                            ) : (
                                                <span className="font-medium text-slate-800">{'—'}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Mail size={14} className="text-[#C69C6D]" />
                                            <span className="font-medium text-slate-800 break-all">{contact.email || '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <User size={14} className="text-[#C69C6D]" />
                                            <span className="font-medium text-slate-800">{contact.socioResponsavel || '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Factory size={14} className="text-[#C69C6D] shrink-0" />
                                            <span className="text-slate-700 leading-snug">
                                                CNAE: {contact.cnaeDescricao || '—'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Briefcase size={14} className="text-[#C69C6D]" />
                                            <span className="text-slate-700">Porte: {contact.porte || '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <DollarSign size={14} className="text-[#C69C6D]" />
                                            <span className="text-slate-700">Capital social: {contact.capitalSocial || '—'}</span>
                                        </div>
                                    </div>
                                    <div
                                        className={`mt-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide px-3 py-2 rounded-xl ${
                                            q.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                                        }`}
                                    >
                                        {q.ok ? (
                                            <>
                                                <CheckCircle2 size={16} />
                                                Contato aprovado
                                            </>
                                        ) : (
                                            <>
                                                <AlertCircle size={16} />
                                                Atenção: {q.reasons.join(' · ')}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => fetchContact(c)}
                                    disabled={loadingC}
                                    className="inline-flex items-center gap-2 bg-[#C69C6D]/15 text-[#1B263B] border border-[#C69C6D]/40 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-[#C69C6D]/25 disabled:opacity-50"
                                >
                                    {loadingC ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                                    Buscar contatos
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLeadTipo('Seguro Garantia');
                                        setLeadModal(c);
                                    }}
                                    disabled={sentCnpjs.has(cnpjK)}
                                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm border transition-all ${
                                        sentCnpjs.has(cnpjK)
                                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                            : 'bg-[#1B263B] text-white border-[#1B263B] hover:bg-[#243347]'
                                    }`}
                                >
                                    {sentCnpjs.has(cnpjK) ? '✓ Enviado' : 'Enviar para LEADS'}
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>

            {leadModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#1B263B]/60 backdrop-blur-sm">
                    <div className="bg-[#F8F4ED] rounded-3xl shadow-2xl max-w-md w-full p-8 border border-[#C69C6D]/30 animate-in zoom-in-95">
                        <div className="flex justify-between items-start mb-4">
                            <h4 className="text-xl font-black text-[#1B263B]">Enviar para LEADS</h4>
                            <button
                                type="button"
                                onClick={() => !sendingLead && setLeadModal(null)}
                                className="p-2 rounded-xl hover:bg-white/80 text-slate-600"
                                aria-label="Fechar"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-sm text-slate-600 font-medium mb-6">
                            Para qual tipo de lead deseja enviar <strong>{leadModal.nomeRazaoSocialFornecedor}</strong>?
                        </p>
                        <div className="space-y-2 mb-6">
                            {TIPO_LEAD_OPTIONS.map((t) => (
                                <label
                                    key={t}
                                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition-all ${
                                        leadTipo === t
                                            ? 'border-[#C69C6D] bg-white'
                                            : 'border-transparent bg-white/50 hover:bg-white'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="tipoLead"
                                        checked={leadTipo === t}
                                        onChange={() => setLeadTipo(t)}
                                        className="text-[#C69C6D]"
                                    />
                                    <span className="font-bold text-slate-800">{t}</span>
                                </label>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={confirmSendLead}
                            disabled={sendingLead}
                            className="w-full flex items-center justify-center gap-2 bg-[#C69C6D] text-white font-black py-3.5 rounded-xl hover:opacity-95 disabled:opacity-60"
                        >
                            {sendingLead ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                            Confirmar envio
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
};

export default PncpProspection;
