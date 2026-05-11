import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Download, Edit2, Trash2, Calendar, Search,
    Loader2, Save, X, AlertCircle, CheckCircle2, Clock, Home, Copy, ExternalLink
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getPublicResidentialFormPath, getPublicResidentialFormUrl } from '../utils/publicUrls';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';

interface ResidentialClient {
    id: number;
    nome: string;
    cpf: string;
    telefone: string;
    telefone_2?: string | null;
    email: string;
    produto: string;
    apolice: string;
    premio_total: string;
    comissao: string;
    data_emissao: string;
    fim_vigencia: string;
    forma_pagamento: string;
    situacao: string;
    obs: string;
    estado_civil?: string | null;
    cep_imovel?: string | null;
    numero_imovel?: string | null;
    tipo_imovel?: string | null;
    valor_imovel?: string | null;
    valor_aluguel?: string | null;
    data_primeiro_pag_aluguel?: string | null;
    valor_iptu_condominio?: string | null;
    tem_garantia: string;
    garantia_inicio?: string;
    garantia_fim?: string;
    garantia_valor?: string;
    created_at?: string;
    /** true = formulário público (RLS anon); legado: obs com marcador */
    origem_publica?: boolean | null;
}

const EMPTY_FORM: Partial<ResidentialClient> = {
    nome: '', cpf: '', telefone: '', telefone_2: '', email: '',
    produto: '', apolice: '', premio_total: '',
    comissao: '', data_emissao: '', fim_vigencia: '',
    forma_pagamento: '', situacao: 'Ativo', obs: '',
    estado_civil: '', cep_imovel: '', numero_imovel: '', tipo_imovel: '',
    valor_imovel: '', valor_aluguel: '', data_primeiro_pag_aluguel: '', valor_iptu_condominio: '',
    tem_garantia: 'Não', garantia_inicio: '', garantia_fim: '', garantia_valor: '',
    origem_publica: false,
};

const ESTADO_CIVIL_OPTS = ['Casado(a)', 'Solteiro(a)', 'Separado(a)', 'Viúvo(a)'] as const;
const TIPO_IMOVEL_OPTS = ['Casa', 'Apartamento', 'Casa em condomínio', 'Comercial'] as const;

const ORIGEM_PUBLIC = '[origem:formulario-publico]';

/** Preenche campos a partir de leads antigos que tinham tudo em `obs`. */
function parseStructuredObs(obs: string | null | undefined): Partial<Pick<ResidentialClient,
    'telefone_2' | 'estado_civil' | 'cep_imovel' | 'numero_imovel' | 'tipo_imovel' | 'valor_imovel' | 'valor_aluguel' | 'data_primeiro_pag_aluguel' | 'valor_iptu_condominio'
>> {
    if (!obs?.includes(ORIGEM_PUBLIC)) return {};
    const line = (prefix: string): string => {
        const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${esc}:\\s*(.+)$`, 'm');
        const m = obs.match(re);
        if (!m) return '';
        const v = m[1].trim();
        return v === '—' ? '' : v;
    };
    return {
        telefone_2: line('Telefone / Celular 2'),
        estado_civil: line('Estado civil'),
        cep_imovel: line('CEP do imóvel'),
        numero_imovel: line('Número do imóvel'),
        tipo_imovel: line('Tipo de imóvel'),
        valor_imovel: line('Valor do imóvel'),
        valor_aluguel: line('Valor do aluguel'),
        data_primeiro_pag_aluguel: line('Data do 1º pagamento do aluguel'),
        valor_iptu_condominio: line('Valor IPTU e/ou condomínio'),
    };
}

function pickDbOrParsed(db: string | null | undefined, fromObs: string | undefined): string {
    if (db != null && String(db).trim() !== '') return String(db);
    return (fromObs ?? '').trim();
}

function formatEntrada(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PRODUTOS = [
    'Apenas Garantia Locatícia',
    'Apenas Seguro Residencial',
    'Garantia Locatícia & Seguro Residencial',
    'Residencial',
    'Locatícia',
    'Residencial + Locatícia',
    'Condomínio',
];
const FORMAS_PAGAMENTO = ['Boleto Mensal', 'Boleto Anual', 'Cartão de Crédito', 'Débito Automático', 'PIX'];
const SITUACOES = ['Lead (site)', 'Ativo', 'Vencido', 'Cancelado', 'Pendente Renovação', 'Em Renovação', 'Reprovado'];

// Funções de Máscara e Formatação
const formatCPF = (value: string) => {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
};

const formatPhone = (value: string) => {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{4})\d+?$/, '$1');
};

const formatCEP = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 8);
    return d.replace(/(\d{5})(\d)/, '$1-$2');
};

const formatCurrency = (value: string) => {
    const numericValue = value.replace(/\D/g, '');
    if (!numericValue) return '';
    const formatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(Number(numericValue) / 100);
    return formatted;
};

const ResidentialInsurance: React.FC = () => {
    const [clients, setClients] = useState<ResidentialClient[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [formData, setFormData] = useState<Partial<ResidentialClient>>(EMPTY_FORM);
    const [search, setSearch] = useState('');
    const [filterProduto, setFilterProduto] = useState('');
    const [filterSituacao, setFilterSituacao] = useState('');
    const [filterPagamento, setFilterPagamento] = useState('');
    const [filterGarantia, setFilterGarantia] = useState('');
    const [sortBy, setSortBy] = useState<'entrada' | 'vigencia' | 'nome'>('entrada');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [publicFormCopied, setPublicFormCopied] = useState(false);

    const copyPublicFormUrl = () => {
        const url = getPublicResidentialFormUrl();
        if (!url) return;
        void navigator.clipboard.writeText(url);
        setPublicFormCopied(true);
        window.setTimeout(() => setPublicFormCopied(false), 2000);
    };

    const fetchClients = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('residential_clients')
            .select('*')
            .order('id', { ascending: false });
        if (error) console.error('Erro ao buscar clientes:', error);
        setClients(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { fetchClients(); }, [fetchClients]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        let { id, value } = e.target;

        // Aplicar máscaras
        if (id === 'cpf') value = formatCPF(value);
        if (id === 'telefone' || id === 'telefone_2') value = formatPhone(value);
        if (id === 'cep_imovel') value = formatCEP(value);
        if (id === 'premio_total' || id === 'comissao' || id === 'garantia_valor'
            || id === 'valor_imovel' || id === 'valor_aluguel' || id === 'valor_iptu_condominio') {
            value = formatCurrency(value);
        }

        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        const payload = {
            nome: formData.nome || null,
            cpf: formData.cpf || null,
            telefone: formData.telefone || null,
            telefone_2: formData.telefone_2?.trim() || null,
            email: formData.email || null,
            produto: formData.produto || null,
            apolice: formData.apolice || null,
            premio_total: formData.premio_total || null,
            comissao: formData.comissao || null,
            data_emissao: formData.data_emissao || null,
            fim_vigencia: formData.fim_vigencia || null,
            forma_pagamento: formData.forma_pagamento || null,
            situacao: formData.situacao || null,
            obs: formData.obs || null,
            estado_civil: formData.estado_civil?.trim() || null,
            cep_imovel: formData.cep_imovel?.trim() || null,
            numero_imovel: formData.numero_imovel?.trim() || null,
            tipo_imovel: formData.tipo_imovel?.trim() || null,
            valor_imovel: formData.valor_imovel?.trim() || null,
            valor_aluguel: formData.valor_aluguel?.trim() || null,
            data_primeiro_pag_aluguel: formData.data_primeiro_pag_aluguel?.trim() || null,
            valor_iptu_condominio: formData.valor_iptu_condominio?.trim() || null,
            tem_garantia: formData.tem_garantia || 'Não',
            garantia_inicio: formData.tem_garantia === 'Sim' ? (formData.garantia_inicio || null) : null,
            garantia_fim: formData.tem_garantia === 'Sim' ? (formData.garantia_fim || null) : null,
            garantia_valor: formData.tem_garantia === 'Sim' ? (formData.garantia_valor || null) : null,
            origem_publica: !!formData.origem_publica,
        };

        try {
            if (editingId) {
                const { error } = await supabase.from('residential_clients').update(payload).eq('id', editingId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('residential_clients').insert([payload]);
                if (error) throw error;
            }
            await fetchClients();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
            resetForm();
        } catch (error: any) {
            setSaveError(error?.message || 'Erro ao salvar. Tente novamente.');
        } finally {
            setSaving(false);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData(EMPTY_FORM);
    };

    const handleEdit = (client: ResidentialClient) => {
        setEditingId(client.id);
        const fromObs = parseStructuredObs(client.obs);
        setFormData({
            ...client,
            origem_publica: client.origem_publica === true || (client.obs || '').includes(ORIGEM_PUBLIC),
            telefone_2: pickDbOrParsed(client.telefone_2, fromObs.telefone_2),
            estado_civil: pickDbOrParsed(client.estado_civil, fromObs.estado_civil),
            cep_imovel: pickDbOrParsed(client.cep_imovel, fromObs.cep_imovel),
            numero_imovel: pickDbOrParsed(client.numero_imovel, fromObs.numero_imovel),
            tipo_imovel: pickDbOrParsed(client.tipo_imovel, fromObs.tipo_imovel),
            valor_imovel: pickDbOrParsed(client.valor_imovel, fromObs.valor_imovel),
            valor_aluguel: pickDbOrParsed(client.valor_aluguel, fromObs.valor_aluguel),
            data_primeiro_pag_aluguel: pickDbOrParsed(client.data_primeiro_pag_aluguel, fromObs.data_primeiro_pag_aluguel),
            valor_iptu_condominio: pickDbOrParsed(client.valor_iptu_condominio, fromObs.valor_iptu_condominio),
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Deseja excluir este cliente?')) return;
        await supabase.from('residential_clients').delete().eq('id', id);
        fetchClients();
    };

    const getExpiringAlerts = () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
        return clients.filter(c => {
            if (!c.fim_vigencia) return false;
            const fim = new Date(c.fim_vigencia);
            return fim >= today && fim <= in30 && c.situacao === 'Ativo';
        }).sort((a, b) => new Date(a.fim_vigencia).getTime() - new Date(b.fim_vigencia).getTime());
    };

    const exportCSV = () => {
        if (filtered.length === 0) return;
        const headers = ['Nome', 'CPF', 'Telefone', 'Email', 'Produto', 'Apólice', 'Prêmio Total', 'Comissão', 'Emissão', 'Fim Vigência', 'Pagamento', 'Situação', 'Garantia'];
        const rows = filtered.map(c => [
            `"${c.nome}"`, c.cpf, c.telefone, c.email,
            c.produto, c.apolice, c.premio_total, c.comissao,
            c.data_emissao, c.fim_vigencia, c.forma_pagamento,
            c.situacao, c.tem_garantia
        ].join(','));
        const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = 'Clientes_Residencial.csv'; a.click();
    };

    const filtered = clients
        .filter(c => {
            const q = search.toLowerCase();
            const qDigits = search.replace(/\D/g, '');
            const cepDigits = (c.cep_imovel || '').replace(/\D/g, '');
            const cepMatch = qDigits.length > 0 && cepDigits.includes(qDigits);
            return (
                c.nome?.toLowerCase().includes(q) ||
                c.cpf?.includes(search) ||
                c.apolice?.includes(search) ||
                (c.telefone_2 && c.telefone_2.includes(search)) ||
                cepMatch
            );
        })
        .filter(c => !filterProduto || c.produto === filterProduto)
        .filter(c => !filterSituacao || c.situacao === filterSituacao)
        .filter(c => !filterPagamento || c.forma_pagamento === filterPagamento)
        .filter(c => !filterGarantia || c.tem_garantia === filterGarantia)
        .sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            if (sortBy === 'nome') {
                return mul * (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
            }
            if (sortBy === 'vigencia') {
                const da = new Date(a.fim_vigencia || 0).getTime();
                const db = new Date(b.fim_vigencia || 0).getTime();
                const na = Number.isNaN(da) ? 0 : da;
                const nb = Number.isNaN(db) ? 0 : db;
                return mul * (na - nb);
            }
            const da = new Date(a.created_at || 0).getTime();
            const db = new Date(b.created_at || 0).getTime();
            return mul * (da - db);
        });

    const hasTableFilters = !!(filterProduto || filterSituacao || filterPagamento || filterGarantia);

    const expiringAlerts = getExpiringAlerts();

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 size={40} className="animate-spin mb-4 text-[#C69C6D]" />
                <p className="font-bold uppercase tracking-widest text-xs">Carregando Base...</p>
            </div>
        );
    }

    const isPublicLead = (c: ResidentialClient) =>
        c.origem_publica === true || (c.obs || '').includes(ORIGEM_PUBLIC);

    const isNovoLead = (c: ResidentialClient) => c.situacao === 'Lead (site)';

    const situacaoColor = (s: string) => {
        if (s === 'Lead (site)') return 'bg-[#C69C6D]/15 text-[#1B263B] border border-[#C69C6D]/40';
        if (s === 'Ativo') return 'bg-emerald-50 text-emerald-600';
        if (s === 'Vencido') return 'bg-red-50 text-red-600';
        if (s === 'Cancelado') return 'bg-slate-100 text-slate-500';
        if (s === 'Reprovado') return 'bg-red-100 text-red-700';
        return 'bg-blue-50 text-blue-600';
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-[1600px] mx-auto">

            {/* Expiry Alert */}
            {expiringAlerts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                            <AlertCircle size={18} className="text-amber-600" />
                        </div>
                        <div>
                            <p className="font-black text-amber-800 text-sm">⚠️ {expiringAlerts.length} apólice{expiringAlerts.length > 1 ? 's vencem' : ' vence'} nos próximos 30 dias</p>
                            <p className="text-amber-600 text-xs font-medium">Acione o cliente para renovação</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {expiringAlerts.map(c => {
                            const fim = new Date(c.fim_vigencia);
                            const today = new Date(); today.setHours(0, 0, 0, 0);
                            const daysLeft = Math.ceil((fim.getTime() - today.getTime()) / 86400000);
                            return (
                                <div key={c.id} className="flex justify-between items-center bg-white rounded-xl px-4 py-3 border border-amber-100 gap-4">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-slate-800 text-sm truncate">{c.nome}</p>
                                        <p className="text-xs text-slate-500">{c.produto} • {c.apolice}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-black text-amber-600 text-sm">{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</p>
                                        <p className="text-xs text-slate-400">Vence {fim.toLocaleDateString('pt-BR')}</p>
                                    </div>
                                    <button onClick={() => handleEdit(c)} className="shrink-0 flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 font-black text-xs px-3 py-2 rounded-lg transition-all">
                                        <Edit2 size={13} /> Editar
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">Seguro Residencial / Locatícia</h2>
                    <p className="text-slate-500 font-medium">Base de clientes e apólices residenciais.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:flex-none min-w-0">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text" placeholder="Buscar nome, CPF, apólice, CEP..."
                            value={search} onChange={e => setSearch(e.target.value)}
                            className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full md:w-64 focus:ring-2 focus:ring-[#C69C6D]/20"
                        />
                    </div>
                    {hasTableFilters && (
                        <button
                            type="button"
                            onClick={() => {
                                setFilterProduto('');
                                setFilterSituacao('');
                                setFilterPagamento('');
                                setFilterGarantia('');
                            }}
                            className="shrink-0 bg-white text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all whitespace-nowrap"
                        >
                            Limpar filtros
                        </button>
                    )}
                    <button onClick={exportCSV} className="shrink-0 bg-white text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2">
                        <Download size={16} /> Exportar
                    </button>
                </div>
            </div>

            <div className="bg-[#1B263B]/[0.04] border border-[#C69C6D]/25 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black text-[#C69C6D] uppercase tracking-widest">Link para o cliente (site público)</p>
                    <p className="text-xs text-slate-600 truncate font-mono mt-1" title={getPublicResidentialFormUrl()}>{getPublicResidentialFormUrl()}</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <a
                        href={getPublicResidentialFormPath()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-[#1B263B] text-white px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-[#243347] transition-all"
                    >
                        <ExternalLink size={14} /> Abrir
                    </a>
                    <button
                        type="button"
                        onClick={copyPublicFormUrl}
                        className="inline-flex items-center gap-2 bg-white text-[#1B263B] px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-200 hover:border-[#C69C6D]/40 transition-all"
                    >
                        <Copy size={14} /> {publicFormCopied ? 'Copiado!' : 'Copiar'}
                    </button>
                </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
                    <div className="w-1.5 h-6 bg-[#C69C6D] rounded-full"></div>
                    {editingId ? 'Editar Cliente' : 'Novo Cliente'}
                </h3>

                {editingId && (formData.created_at || formData.origem_publica) && (
                    <div className="mb-6 flex flex-wrap gap-3 items-center text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[#1B263B]">
                            <Calendar size={14} className="text-[#C69C6D]" />
                            Entrada no sistema:
                            <span className="font-black text-slate-800">{formatEntrada(formData.created_at)}</span>
                        </span>
                        {formData.origem_publica && (
                            <span className="text-[10px] font-black uppercase tracking-wider bg-[#1B263B] text-[#C69C6D] px-2 py-1 rounded-md">
                                Formulário do site
                            </span>
                        )}
                    </div>
                )}

                {saveError && (
                    <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-600 px-5 py-4 rounded-xl text-sm font-bold">
                        <AlertCircle size={18} />{saveError}
                    </div>
                )}
                {saveSuccess && (
                    <div className="mb-6 flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-600 px-5 py-4 rounded-xl text-sm font-bold">
                        <CheckCircle2 size={18} />Cliente salvo com sucesso!
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-8">
                    {/* Block 1: Client Data */}
                    <div>
                        <p className="text-[10px] font-black text-[#C69C6D] uppercase tracking-widest mb-4">Dados do Cliente</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            {[
                                { id: 'nome', label: 'Nome do Cliente', placeholder: 'Nome completo', required: true },
                                { id: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
                                { id: 'telefone', label: 'Telefone', placeholder: '(00) 00000-0000' },
                                { id: 'telefone_2', label: 'Telefone / Celular 2', placeholder: '(00) 00000-0000' },
                                { id: 'email', label: 'E-mail', placeholder: 'cliente@email.com' },
                            ].map(f => (
                                <div key={f.id} className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">{f.label}</label>
                                    <input
                                        type="text" id={f.id}
                                        value={(formData as any)[f.id] || ''}
                                        onChange={handleInputChange}
                                        required={f.required}
                                        placeholder={f.placeholder}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all outline-none"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Block 1b: Lead site / imóvel (preenchido pelo formulário público ou manualmente) */}
                    <div className="p-6 bg-[#F5F1EA]/80 rounded-2xl border border-[#C69C6D]/20">
                        <p className="text-[10px] font-black text-[#C69C6D] uppercase tracking-widest mb-4">Cotação e imóvel (formulário do site)</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Estado civil</label>
                                <select
                                    id="estado_civil"
                                    value={formData.estado_civil || ''}
                                    onChange={handleInputChange}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none"
                                >
                                    <option value="">Selecione...</option>
                                    {ESTADO_CIVIL_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">CEP do imóvel</label>
                                <input type="text" id="cep_imovel" value={formData.cep_imovel || ''} onChange={handleInputChange} placeholder="00000-000" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Número do imóvel</label>
                                <input type="text" id="numero_imovel" value={formData.numero_imovel || ''} onChange={handleInputChange} placeholder="Nº, bloco, apto..." className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tipo de imóvel</label>
                                <select id="tipo_imovel" value={formData.tipo_imovel || ''} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">Selecione...</option>
                                    {TIPO_IMOVEL_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor do imóvel</label>
                                <input type="text" id="valor_imovel" value={formData.valor_imovel || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor do aluguel</label>
                                <input type="text" id="valor_aluguel" value={formData.valor_aluguel || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">1º pagamento do aluguel</label>
                                <input type="date" id="data_primeiro_pag_aluguel" value={formData.data_primeiro_pag_aluguel || ''} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">IPTU / condomínio</label>
                                <input type="text" id="valor_iptu_condominio" value={formData.valor_iptu_condominio || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                        </div>
                    </div>

                    {/* Block 2: Policy Data */}
                    <div>
                        <p className="text-[10px] font-black text-[#C69C6D] uppercase tracking-widest mb-4">Dados da Apólice</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Produto</label>
                                <select id="produto" value={formData.produto || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">Selecione...</option>
                                    {PRODUTOS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Apólice</label>
                                <input type="text" id="apolice" value={formData.apolice || ''} onChange={handleInputChange} placeholder="Nº da apólice" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Prêmio Total</label>
                                <input type="text" id="premio_total" value={formData.premio_total || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Comissão</label>
                                <input type="text" id="comissao" value={formData.comissao || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Data Emissão</label>
                                <input type="date" id="data_emissao" value={formData.data_emissao || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Fim de Vigência</label>
                                <input type="date" id="fim_vigencia" value={formData.fim_vigencia || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Forma de Pagamento</label>
                                <select id="forma_pagamento" value={formData.forma_pagamento || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">Selecione...</option>
                                    {FORMAS_PAGAMENTO.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Situação</label>
                                <select id="situacao" value={formData.situacao || 'Ativo'} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    {SITUACOES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Block 3: Garantia Locatícia */}
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-4 mb-4">
                            <Home size={18} className="text-[#C69C6D]" />
                            <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Tem Garantia Locatícia?</p>
                            <div className="flex gap-3 ml-auto">
                                {['Sim', 'Não'].map(v => (
                                    <button
                                        key={v} type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, tem_garantia: v }))}
                                        className={`px-5 py-2 rounded-xl font-black text-sm transition-all ${formData.tem_garantia === v ? 'bg-[#C69C6D] text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:border-[#C69C6D]'}`}
                                    >{v}</button>
                                ))}
                            </div>
                        </div>
                        {formData.tem_garantia === 'Sim' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-4 pt-4 border-t border-slate-200">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Início Vigência Garantia</label>
                                    <input type="date" id="garantia_inicio" value={formData.garantia_inicio || ''} onChange={handleInputChange} className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Fim Vigência Garantia</label>
                                    <input type="date" id="garantia_fim" value={formData.garantia_fim || ''} onChange={handleInputChange} className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor da Garantia</label>
                                    <input type="text" id="garantia_valor" value={formData.garantia_valor || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Block 4: Obs */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observações</label>
                        <textarea id="obs" value={formData.obs || ''} onChange={handleInputChange} rows={3} placeholder="Anotações internas opcionais — dados do site ficam nos campos acima." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none resize-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all" />
                    </div>

                    <div className="flex justify-end gap-3">
                        {editingId && (
                            <button type="button" onClick={resetForm} className="px-8 py-3.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-all flex items-center gap-2">
                                <X size={18} /> Cancelar
                            </button>
                        )}
                        <button type="submit" disabled={saving} className="bg-[#C69C6D] text-white px-10 py-3.5 rounded-xl font-black text-sm hover:bg-[#b58a5b] transition-all shadow-lg active:scale-95 flex items-center gap-2 disabled:opacity-50">
                            {saving ? <Loader2 className="animate-spin" size={18} /> : (editingId ? <Save size={18} /> : <Plus size={18} />)}
                            {editingId ? 'Salvar Alterações' : 'Adicionar Cliente'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Table */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-100 bg-slate-50/40">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">
                        Ordenar lista
                    </p>
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm shrink-0">
                        {(['entrada', 'vigencia', 'nome'] as const).map(opt => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                    if (sortBy === opt) {
                                        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
                                    } else {
                                        setSortBy(opt);
                                        setSortDir(
                                            opt === 'nome' ? 'asc' : opt === 'vigencia' ? 'asc' : 'desc',
                                        );
                                    }
                                }}
                                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                    sortBy === opt
                                        ? 'bg-[#1B263B] text-white shadow'
                                        : 'text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                {opt === 'nome'
                                    ? 'A-Z'
                                    : opt === 'vigencia'
                                      ? 'Fim vigência'
                                      : 'Data entrada'}
                                {sortBy === opt && (
                                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[2px] border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-5 align-top">Cliente</th>
                                <th className="px-6 py-5 align-top">Entrada</th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Produto</span>
                                    <select
                                        value={filterProduto}
                                        onChange={(e) => setFilterProduto(e.target.value)}
                                        aria-label="Filtrar por produto"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todos</option>
                                        {PRODUTOS.map((p) => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">Apólice</th>
                                <th className="px-6 py-5 align-top">Prêmio</th>
                                <th className="px-6 py-5 align-top">Comissão</th>
                                <th className="px-6 py-5 align-top">Fim Vigência</th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Pagamento</span>
                                    <select
                                        value={filterPagamento}
                                        onChange={(e) => setFilterPagamento(e.target.value)}
                                        aria-label="Filtrar por forma de pagamento"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todas</option>
                                        {FORMAS_PAGAMENTO.map((f) => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Situação</span>
                                    <select
                                        value={filterSituacao}
                                        onChange={(e) => setFilterSituacao(e.target.value)}
                                        aria-label="Filtrar por situação"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todas</option>
                                        {SITUACOES.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Garantia</span>
                                    <select
                                        value={filterGarantia}
                                        onChange={(e) => setFilterGarantia(e.target.value)}
                                        aria-label="Filtrar por garantia"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todas</option>
                                        <option value="Sim">Sim</option>
                                        <option value="Não">Não</option>
                                    </select>
                                </th>
                                <th className="px-6 py-5 text-center align-top">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="px-6 py-16 text-center text-slate-400 font-bold text-sm">
                                        {search || hasTableFilters ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
                                    </td>
                                </tr>
                            ) : filtered.map(c => {
                                const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
                                const fim = c.fim_vigencia ? new Date(c.fim_vigencia) : null;
                                const dias = fim ? Math.ceil((fim.getTime() - hoje.getTime()) / 86400000) : null;
                                const nearExpiry = dias !== null && dias <= 30 && dias >= 0 && c.situacao === 'Ativo';
                                return (
                                    <tr key={c.id} className={`group hover:bg-slate-50/80 transition-all ${nearExpiry ? 'bg-amber-50/40' : ''}`}>
                                        <td className="px-6 py-5 min-w-[200px] max-w-[300px] whitespace-nowrap overflow-hidden text-ellipsis">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-black text-slate-800 text-sm truncate">{c.nome}</span>
                                                {isPublicLead(c) && (
                                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider bg-[#1B263B] text-[#C69C6D] px-2 py-0.5 rounded-md">
                                                        Site
                                                    </span>
                                                )}
                                                {isNovoLead(c) && (
                                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md">
                                                        Novo lead
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                                <span>{c.cpf ? (c.cpf.includes('.') ? c.cpf : formatCPF(c.cpf)) : '-'}</span>
                                                <span aria-hidden>•</span>
                                                {c.telefone ? (
                                                    <WhatsAppPhoneLink
                                                        phone={c.telefone}
                                                        display={c.telefone.includes('(') ? c.telefone : formatPhone(c.telefone)}
                                                        className="text-slate-500 font-bold"
                                                    />
                                                ) : (
                                                    <span>-</span>
                                                )}
                                                {c.telefone_2 ? (
                                                    <>
                                                        <span aria-hidden>•</span>
                                                        <WhatsAppPhoneLink
                                                            phone={c.telefone_2}
                                                            display={
                                                                c.telefone_2.includes('(') ? c.telefone_2 : formatPhone(c.telefone_2)
                                                            }
                                                            className="text-slate-500 font-bold"
                                                        />
                                                    </>
                                                ) : null}
                                                {c.cep_imovel ? (
                                                    <>
                                                        <span aria-hidden>•</span>
                                                        <span>
                                                            CEP {c.cep_imovel.includes('-') ? c.cep_imovel : formatCEP(c.cep_imovel)}
                                                        </span>
                                                    </>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-xs font-bold text-slate-600 whitespace-nowrap align-top">
                                            {formatEntrada(c.created_at)}
                                        </td>
                                        <td className="px-6 py-5 text-sm font-bold text-slate-700 whitespace-nowrap">{c.produto || '-'}</td>
                                        <td className="px-6 py-5 text-sm text-slate-600 whitespace-nowrap">{c.apolice || '-'}</td>
                                        <td className="px-6 py-5 text-sm font-black text-slate-800 whitespace-nowrap">{c.premio_total ? (c.premio_total.includes('R$') ? c.premio_total : formatCurrency(c.premio_total)) : '-'}</td>
                                        <td className="px-6 py-5 text-sm font-black text-[#C69C6D] whitespace-nowrap">{c.comissao ? (c.comissao.includes('R$') ? c.comissao : formatCurrency(c.comissao)) : '-'}</td>
                                        <td className="px-6 py-5 text-sm">
                                            <span className={nearExpiry ? 'text-amber-600 font-black' : 'text-slate-600'}>
                                                {c.fim_vigencia ? new Date(c.fim_vigencia).toLocaleDateString('pt-BR') : '-'}
                                                {nearExpiry && <span className="ml-2 text-[10px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-black">{dias}d</span>}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-sm text-slate-600">{c.forma_pagamento || '-'}</td>
                                        <td className="px-6 py-5">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${situacaoColor(c.situacao)}`}>
                                                {c.situacao === 'Lead (site)' ? <Home size={12} /> : c.situacao === 'Ativo' ? <CheckCircle2 size={12} /> : c.situacao === 'Vencido' ? <AlertCircle size={12} /> : <Clock size={12} />}
                                                {c.situacao}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-sm">
                                            {c.tem_garantia === 'Sim'
                                                ? <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 font-black text-[10px]"><Home size={11} /> Sim</span>
                                                : <span className="text-slate-400 text-xs">—</span>}
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex justify-center gap-2">
                                                <button onClick={() => handleEdit(c)} className="p-2 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"><Edit2 size={16} /></button>
                                                <button onClick={() => handleDelete(c.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ResidentialInsurance;
