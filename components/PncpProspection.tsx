// -*- coding: utf-8 -*-
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
    Search,
    Loader2,
    Building2,
    MapPin,
    Calendar,
    Download,
    Phone,
    Mail,
    Globe,
    User,
    Briefcase,
    DollarSign,
    AlertCircle,
    CheckCircle2,
    Send,
    X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/formatters';
import type { EmpresaAquiParsed, PncpContratoNormalizado, PncpProbabilidadeSg, PncpTipoLeadEnviado } from '../types';

const FALLBACK_PROXY_PNCP = 'https://darkslategray-turtle-936446.hostingersite.com/proxy_pncp.php';
const FALLBACK_PROXY_EQ = 'https://darkslategray-turtle-936446.hostingersite.com/proxy_empresaqui.php';

const PROXY_PNCP = String(import.meta.env.VITE_PROXY_PNCP_URL ?? '').trim() || FALLBACK_PROXY_PNCP;
const PROXY_EQ = String(import.meta.env.VITE_PROXY_EQ_URL ?? '').trim() || FALLBACK_PROXY_EQ;

const PNCP_TOTAL_CONTRATOS = 461_000;
const PNCP_PAGE_SIZE = 10;
const PNCP_MAX_PAGE = Math.max(1, Math.ceil(PNCP_TOTAL_CONTRATOS / PNCP_PAGE_SIZE));
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

function parsePncpMoney(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'string') return 0;
    const s = v.trim();
    if (!s) return 0;
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
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

function extractPncpArray(json: unknown): unknown[] {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    const o = json as Record<string, unknown>;
    const keys = ['data', 'contratos', 'items', 'resultado', 'licitacoes', 'registros', 'content'];
    for (const k of keys) {
        const v = o[k];
        if (Array.isArray(v)) return v;
    }
    return [];
}

function mapPncpItem(raw: Record<string, unknown>): PncpContratoNormalizado | null {
    const fornec = (raw.fornecedor || raw.fornecedorContratado) as Record<string, unknown> | undefined;
    const nome =
        (raw.nomeRazaoSocialFornecedor as string) ||
        (fornec?.nomeRazaoSocial as string) ||
        (fornec?.razaoSocial as string) ||
        '';
    const ni =
        (raw.niFornecedor as string) ||
        (fornec?.ni as string) ||
        (fornec?.cnpj as string) ||
        '';
    if (!nome && !ni) return null;

    const orgaoEnt = raw.orgaoEntidade as Record<string, unknown> | undefined;
    const orgaoRazao = (orgaoEnt?.razaoSocial as string) || (raw.nomeOrgao as string) || '';

    const unidade = (raw.unidadeOrgao || raw.unidade) as Record<string, unknown> | undefined;
    const municipio = (unidade?.municipioNome as string) || (unidade?.nomeMunicipio as string) || '';
    const uf = (unidade?.ufSigla as string) || (unidade?.siglaUf as string) || '';

    const objeto = (raw.objetoContrato as string) || (raw.objeto as string) || '';
    const valor = parsePncpMoney(raw.valorGlobal ?? raw.valorTotal ?? raw.valor);

    const dataAss =
        (raw.dataAssinatura as string) || (raw.dataCelebracao as string) || (raw.data as string) || '';

    const cnpjLimpo = cleanCnpj(ni);
    const dedupKey = `${cnpjLimpo}|${dataAss}|${orgaoRazao}|${valor}`;

    return {
        dedupKey,
        nomeRazaoSocialFornecedor: nome || '\u2014',
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

function parseEmpresaAqui(json: unknown): EmpresaAquiParsed {
    const empty: EmpresaAquiParsed = {
        telefone: '',
        email: '',
        site: '',
        socioResponsavel: '',
        porte: '',
        faturamentoEstimado: '',
        raw: json,
    };
    if (!json || typeof json !== 'object') return empty;
    const root = json as Record<string, unknown>;
    const d =
        (root.dados as Record<string, unknown>) ||
        (root.data as Record<string, unknown>) ||
        (root.empresa as Record<string, unknown>) ||
        root;

    const tel =
        pickStr(d.telefone, d.phone, d.telefone1) ||
        firstTel(d.telefones) ||
        firstTel(d.phones);
    const email = pickStr(d.email, d.email_principal, d.e_mail) || firstEmail(d.emails);
    const site =
        pickStr(d.site, d.website, d.url, d.dominio) ||
        (typeof d.website === 'object' ? pickStr((d.website as any)?.url) : '');

    const soc =
        firstSocio(d.socios) ||
        firstSocio(d.qsa) ||
        firstSocio(d.sociedade) ||
        pickStr(d.socio_responsavel, d.representanteLegal, d.nome_socio);

    const porte = pickStr(d.porte, d.porteEmpresa, d.descricaoPorte, d.classificacaoPorte);
    const fat = pickStr(d.faturamentoPresumido, d.faturamentoEstimado, d.capitalSocial, d.receitaEstimada);

    return {
        telefone: tel,
        email,
        site: normalizeSite(site),
        socioResponsavel: soc,
        porte,
        faturamentoEstimado: fat,
        raw: json,
    };
}

function pickStr(...vals: unknown[]): string {
    for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

function firstTel(arr: unknown): string {
    if (!Array.isArray(arr) || !arr[0]) return '';
    const x = arr[0];
    if (typeof x === 'string') return x;
    if (typeof x === 'object' && x) return pickStr((x as any).numero, (x as any).telefone, (x as any).ddd);
    return '';
}

function firstEmail(arr: unknown): string {
    if (!Array.isArray(arr) || !arr[0]) return '';
    const x = arr[0];
    if (typeof x === 'string') return x;
    if (typeof x === 'object' && x) return pickStr((x as any).email, (x as any).e_mail);
    return '';
}

function firstSocio(arr: unknown): string {
    if (!Array.isArray(arr) || !arr[0]) return '';
    const x = arr[0];
    if (typeof x === 'string') return x;
    if (typeof x === 'object' && x) {
        return pickStr(
            (x as any).nome,
            (x as any).nome_socio,
            (x as any).razao_social,
            (x as any).qualificacao
        );
    }
    return '';
}

function normalizeSite(s: string): string {
    const t = (s || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (t.includes('.') && !t.includes(' ')) return `https://${t}`;
    return t;
}

function formatAssinatura(raw: string): string {
    if (!raw) return '\u2014';
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
    contact: EmpresaAquiParsed | undefined,
    onlyWithSite: boolean,
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
    if (onlyWithSite && !contact.site) {
        reasons.push('Sem site cadastrado');
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
    const [onlyWithSite, setOnlyWithSite] = useState(false);
    const [hideContador, setHideContador] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rawContracts, setRawContracts] = useState<PncpContratoNormalizado[]>([]);

    const [contactsByCnpj, setContactsByCnpj] = useState<Record<string, EmpresaAquiParsed>>({});
    const [contactLoad, setContactLoad] = useState<Record<string, boolean>>({});

    const [leadModal, setLeadModal] = useState<PncpContratoNormalizado | null>(null);
    const [leadTipo, setLeadTipo] = useState<PncpTipoLeadEnviado>('Seguro Garantia');
    const [sendingLead, setSendingLead] = useState(false);
    const [sentCnpjs, setSentCnpjs] = useState<Set<string>>(new Set());

    const tokenOk = !!import.meta.env.VITE_EMPRESAQUI_TOKEN?.trim();
    const empresaquiToken = import.meta.env.VITE_EMPRESAQUI_TOKEN?.trim() ?? '';

    useEffect(() => {
        console.log('TOKEN:', import.meta.env.VITE_EMPRESAQUI_TOKEN);
        console.log('PROXY_PNCP:', PROXY_PNCP);
        console.log('PROXY_EQ:', PROXY_EQ);
    }, []);

    const dateRange = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - periodDays);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        return { dataInicial: fmt(start), dataFinal: fmt(end) };
    }, [periodDays]);

    const filtered = useMemo(() => {
        return rawContracts.filter((c) => {
            if (ufFilter && c.ufSigla !== ufFilter) return false;
            if (c.valorGlobal < minValor) return false;
            if (hideContador && isLikelyContador(c.nomeRazaoSocialFornecedor)) return false;
            if (onlyWithSite) {
                const key = cleanCnpj(c.niFornecedor);
                const contact = contactsByCnpj[key];
                if (!contact?.site) return false;
            }
            return true;
        });
    }, [rawContracts, ufFilter, minValor, hideContador, onlyWithSite, contactsByCnpj]);

    const fetchPncpPage = useCallback(async (pagina: number) => {
        const di = dateRange.dataInicial;
        const df = dateRange.dataFinal;
        const url = `${PROXY_PNCP}?dataInicial=${encodeURIComponent(di)}&dataFinal=${encodeURIComponent(
            df
        )}&pagina=${pagina}`;
        console.log('Fetching PNCP:', url);
        try {
            const res = await fetch(url);
            console.log('PNCP status:', res.status);
            const json = await res.json();
            console.log('PNCP response:', json);
            return json;
        } catch (e) {
            console.error('PNCP error:', e);
            return null;
        }
    }, [dateRange]);

    const runSearch = async () => {
        setError(null);
        setLoading(true);
        setRawContracts([]);
        try {
            const pages = randomDistinctPages(PARALLEL_RANDOM_PAGES, PNCP_MAX_PAGE);
            const results = await Promise.allSettled(pages.map((p) => fetchPncpPage(p)));

            const merged: PncpContratoNormalizado[] = [];
            const seen = new Set<string>();

            for (const r of results) {
                if (r.status !== 'fulfilled') continue;
                if (r.value == null) continue;
                const rows = extractPncpArray(r.value);
                for (const row of rows) {
                    if (!row || typeof row !== 'object') continue;
                    const mapped = mapPncpItem(row as Record<string, unknown>);
                    if (!mapped) continue;
                    if (seen.has(mapped.dedupKey)) continue;
                    seen.add(mapped.dedupKey);
                    merged.push(mapped);
                }
            }

            const allFailed = results.every(
                (r) =>
                    r.status === 'rejected' ||
                    (r.status === 'fulfilled' && (r.value === null || r.value === undefined))
            );
            if (merged.length === 0 && allFailed) {
                throw new Error('Não foi possível obter contratos do PNCP. Verifique o proxy e o período.');
            }

            setRawContracts(merged);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Erro na busca PNCP');
        } finally {
            setLoading(false);
        }
    };

    const fetchContact = async (c: PncpContratoNormalizado) => {
        const cnpj = cleanCnpj(c.niFornecedor);
        if (!cnpj || cnpj.length < 8) {
            setError('CNPJ inválido para consulta.');
            return;
        }
        if (!tokenOk) {
            setError('Configure VITE_EMPRESAQUI_TOKEN no .env.local (raiz do projeto, sem aspas) e reinicie o Vite.');
            return;
        }
        setContactLoad((m) => ({ ...m, [cnpj]: true }));
        setError(null);
        try {
            const url = `${PROXY_EQ}?token=${encodeURIComponent(empresaquiToken)}&cnpj=${encodeURIComponent(cnpj)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Empresas Aqui HTTP ${res.status}`);
            const json = await res.json();
            const parsed = parseEmpresaAqui(json);
            setContactsByCnpj((m) => ({ ...m, [cnpj]: parsed }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao consultar Empresas Aqui');
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
            'site',
            'socio_responsavel',
            'porte',
            'faturamento_estimado',
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
                esc(ct?.site ?? ''),
                esc(ct?.socioResponsavel ?? ''),
                esc(ct?.porte ?? ''),
                esc(ct?.faturamentoEstimado ?? ''),
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
                telefone: contact?.telefone ?? null,
                email: contact?.email ?? null,
                site: contact?.site ?? null,
                socio_responsavel: contact?.socioResponsavel ?? null,
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
                        Amostragem aleatória de contratos (30 páginas em paralelo) no período escolhido.
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
                                checked={onlyWithSite}
                                onChange={(e) => setOnlyWithSite(e.target.checked)}
                                className="rounded border-slate-300 text-[#C69C6D] focus:ring-[#C69C6D]"
                            />
                            Apenas com site
                        </label>
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
                    {!tokenOk && (
                        <p className="text-xs font-bold text-amber-700">
                            Defina VITE_EMPRESAQUI_TOKEN na raiz (.env.local, sem aspas) e reinicie o Vite para buscar contatos.
                        </p>
                    )}
                </div>

                {error && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-bold">
                        <AlertCircle size={18} />
                        {error}
                    </div>
                )}

                <p className="text-xs text-slate-500 font-medium">
                    Exibindo <strong>{filtered.length}</strong> contratos (após filtros) {'\u2014'}{' '}
                    <strong>{rawContracts.length}</strong> únicos na amostra.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {filtered.map((c) => {
                    const cnpjK = cleanCnpj(c.niFornecedor);
                    const contact = contactsByCnpj[cnpjK];
                    const loadingC = !!contactLoad[cnpjK];
                    const q = qualityEvaluation(c.nomeRazaoSocialFornecedor, contact, onlyWithSite, hideContador);

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

                            <p className="text-sm text-slate-700 leading-relaxed">{c.objetoContrato || '\u2014'}</p>

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
                                        <p className="font-bold text-slate-800 leading-snug">{c.orgaoRazaoSocial || '\u2014'}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <MapPin size={16} className="text-[#C69C6D] mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-slate-400">Local</p>
                                        <p className="font-bold text-slate-800">
                                            {c.municipioNome || '\u2014'} / {c.ufSigla || '\u2014'}
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
                                        Empresas Aqui
                                    </p>
                                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                                        <div className="flex items-center gap-2">
                                            <Phone size={14} className="text-[#C69C6D]" />
                                            <span className="font-medium text-slate-800">{contact.telefone || '\u2014'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Mail size={14} className="text-[#C69C6D]" />
                                            <span className="font-medium text-slate-800 break-all">{contact.email || '\u2014'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Globe size={14} className="text-[#C69C6D]" />
                                            {contact.site ? (
                                                <a
                                                    href={contact.site}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-bold text-[#1B263B] underline decoration-[#C69C6D]/50"
                                                >
                                                    {contact.site}
                                                </a>
                                            ) : (
                                                <span className="text-slate-500">{'\u2014'}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <User size={14} className="text-[#C69C6D]" />
                                            <span className="font-medium text-slate-800">{contact.socioResponsavel || '\u2014'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Briefcase size={14} className="text-[#C69C6D]" />
                                            <span className="text-slate-700">Porte: {contact.porte || '\u2014'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <DollarSign size={14} className="text-[#C69C6D]" />
                                            <span className="text-slate-700">Faturamento est.: {contact.faturamentoEstimado || '\u2014'}</span>
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
                                    {sentCnpjs.has(cnpjK) ? '\u2713 Enviado' : 'Enviar para LEADS'}
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