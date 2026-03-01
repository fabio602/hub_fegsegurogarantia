import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Download, Edit2, Trash2, Calendar, Search,
    Loader2, Save, X, AlertCircle, CheckCircle2, Clock, Home
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ResidentialClient {
    id: number;
    nome: string;
    cpf: string;
    telefone: string;
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
    tem_garantia: string;
    garantia_inicio?: string;
    garantia_fim?: string;
    garantia_valor?: string;
    created_at?: string;
}

const EMPTY_FORM: Partial<ResidentialClient> = {
    nome: '', cpf: '', telefone: '', email: '',
    produto: '', apolice: '', premio_total: '',
    comissao: '', data_emissao: '', fim_vigencia: '',
    forma_pagamento: '', situacao: 'Ativo', obs: '',
    tem_garantia: 'Não', garantia_inicio: '', garantia_fim: '', garantia_valor: ''
};

const PRODUTOS = ['Residencial', 'Locatícia', 'Residencial + Locatícia', 'Condomínio'];
const FORMAS_PAGAMENTO = ['Boleto Mensal', 'Boleto Anual', 'Cartão de Crédito', 'Débito Automático', 'PIX'];
const SITUACOES = ['Ativo', 'Vencido', 'Cancelado', 'Pendente Renovação'];

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
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const fetchClients = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('residential_clients')
            .select('*')
            .order('nome', { ascending: true });
        if (error) console.error('Erro ao buscar clientes:', error);
        setClients(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { fetchClients(); }, [fetchClients]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        let { id, value } = e.target;

        // Aplicar máscaras
        if (id === 'cpf') value = formatCPF(value);
        if (id === 'telefone') value = formatPhone(value);
        if (id === 'premio_total' || id === 'comissao' || id === 'garantia_valor') {
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
            tem_garantia: formData.tem_garantia || 'Não',
            garantia_inicio: formData.tem_garantia === 'Sim' ? (formData.garantia_inicio || null) : null,
            garantia_fim: formData.tem_garantia === 'Sim' ? (formData.garantia_fim || null) : null,
            garantia_valor: formData.tem_garantia === 'Sim' ? (formData.garantia_valor || null) : null,
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
        setFormData(client);
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

    const filtered = clients.filter(c =>
        c.nome?.toLowerCase().includes(search.toLowerCase()) ||
        c.cpf?.includes(search) ||
        c.apolice?.includes(search)
    );

    const expiringAlerts = getExpiringAlerts();

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 size={40} className="animate-spin mb-4 text-[#C69C6D]" />
                <p className="font-bold uppercase tracking-widest text-xs">Carregando Base...</p>
            </div>
        );
    }

    const situacaoColor = (s: string) => {
        if (s === 'Ativo') return 'bg-emerald-50 text-emerald-600';
        if (s === 'Vencido') return 'bg-red-50 text-red-600';
        if (s === 'Cancelado') return 'bg-slate-100 text-slate-500';
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
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:flex-none">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text" placeholder="Buscar nome, CPF, apólice..."
                            value={search} onChange={e => setSearch(e.target.value)}
                            className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full md:w-64 focus:ring-2 focus:ring-[#C69C6D]/20"
                        />
                    </div>
                    <button onClick={exportCSV} className="bg-white text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2">
                        <Download size={16} /> Exportar
                    </button>
                </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
                    <div className="w-1.5 h-6 bg-[#C69C6D] rounded-full"></div>
                    {editingId ? 'Editar Cliente' : 'Novo Cliente'}
                </h3>

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
                        <textarea id="obs" value={formData.obs || ''} onChange={handleInputChange} rows={3} placeholder="Informações adicionais..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none resize-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all" />
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
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[2px] border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-5">Cliente</th>
                                <th className="px-6 py-5">Produto</th>
                                <th className="px-6 py-5">Apólice</th>
                                <th className="px-6 py-5">Prêmio</th>
                                <th className="px-6 py-5">Comissão</th>
                                <th className="px-6 py-5">Fim Vigência</th>
                                <th className="px-6 py-5">Pagamento</th>
                                <th className="px-6 py-5">Situação</th>
                                <th className="px-6 py-5">Garantia</th>
                                <th className="px-6 py-5 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-16 text-center text-slate-400 font-bold text-sm">
                                        {search ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
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
                                            <div className="font-black text-slate-800 text-sm">{c.nome}</div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-0.5">{c.cpf ? (c.cpf.includes('.') ? c.cpf : formatCPF(c.cpf)) : '-'} • {c.telefone ? (c.telefone.includes('(') ? c.telefone : formatPhone(c.telefone)) : '-'}</div>
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
                                                {c.situacao === 'Ativo' ? <CheckCircle2 size={12} /> : c.situacao === 'Vencido' ? <AlertCircle size={12} /> : <Clock size={12} />}
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
