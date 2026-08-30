import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Eye, EyeOff, Loader2, Users, Send, CheckCircle2, Mail, DollarSign, Calendar, Upload, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

interface Repasse {
    id: number;
    partner_id: number;
    partner_name: string;
    periodo_mes: number;
    periodo_ano: number;
    valor_total: number;
    data_pagamento: string | null;
    comprovante_url: string | null;
    status: 'pendente' | 'pago';
    obs: string | null;
}

interface Parceiro {
    id: number;
    name: string;
    username: string;
    password: string;
    commission_pct: number;
    cnpj?: string;
    email?: string;
    banco_nome?: string;
    pix_key?: string;
    conta_corrente?: string;
    agencia?: string;
    commission_type?: string;
    partner_type?: string;
}

const emptyForm = {
    name: '', username: '', password: '', commission_pct: 20,
    cnpj: '', email: '', banco_nome: '', pix_key: '',
    conta_corrente: '', agencia: '', commission_type: 'escalonado', partner_type: 'seguro_garantia',
};

const ParceiroManager: React.FC = () => {
    const [parceiros, setParceiros] = useState<Parceiro[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassId, setShowPassId] = useState<number | null>(null);
    const [testSendingId, setTestSendingId] = useState<number | null>(null);
    const [testSuccessId, setTestSuccessId] = useState<number | null>(null);
    const [welcomeModal, setWelcomeModal] = useState<Parceiro | null>(null);
    const [sendingWelcome, setSendingWelcome] = useState(false);
    const [welcomeSent, setWelcomeSent] = useState(false);

    const enviarBoasVindas = async (p: Parceiro) => {
        if (!p.email) return;
        setSendingWelcome(true);
        setWelcomeSent(false);
        try {
            const { data, error } = await supabase.functions.invoke('parceiro-welcome-email', {
                body: { name: p.name, email: p.email, username: p.username, password: p.password },
            });
            if (error) throw new Error(error.message || String(error));
            if (data && !data.success) throw new Error(data.error || 'Erro desconhecido');
            setWelcomeSent(true);
            setTimeout(() => { setWelcomeSent(false); setWelcomeModal(null); }, 2500);
        } catch (e: any) {
            alert('Erro ao enviar: ' + e.message);
        } finally {
            setSendingWelcome(false);
        }
    };

    // ── Repasse ──────────────────────────────────────────────
    const [repasseModal, setRepasseModal] = useState<Parceiro | null>(null);
    const [repasseMes, setRepasseMes] = useState(new Date().getMonth() + 1);
    const [repasseAno, setRepasseAno] = useState(new Date().getFullYear());
    const [repasseVendas, setRepasseVendas] = useState<any[]>([]);
    const [repasseComprovante, setRepasseComprovante] = useState<File | null>(null);
    const [repasseObs, setRepasseObs] = useState('');
    const [repasseDataPag, setRepasseDataPag] = useState(new Date().toISOString().slice(0,10));
    const [loadingRepasse, setLoadingRepasse] = useState(false);
    const [savingRepasse, setSavingRepasse] = useState(false);
    const [repasseExistente, setRepasseExistente] = useState<Repasse | null>(null);
    const [repasseHistorico, setRepasseHistorico] = useState<Repasse[]>([]);

    const abrirRepasse = async (p: Parceiro) => {
        setRepasseModal(p);
        setRepasseComprovante(null);
        setRepasseObs('');
        setRepasseDataPag(new Date().toISOString().slice(0,10));
        await carregarRepasseData(p, repasseMes, repasseAno);
    };

    const carregarRepasseData = async (p: Parceiro, mes: number, ano: number) => {
        setLoadingRepasse(true);
        const mesStr = String(mes).padStart(2,'0');
        const inicio = `${ano}-${mesStr}-01`;
        const fim = `${ano}-${mesStr}-31`;

        const [{ data: vendas }, { data: repExist }, { data: historico }] = await Promise.all([
            supabase.from('sales').select('id, data, nome, premio, comissao, tipo, product_type')
                .eq('vendeu','Sim').eq('parceiro', p.name)
                .gte('data', inicio).lte('data', fim).order('data'),
            supabase.from('repasses').select('*')
                .eq('partner_id', p.id).eq('periodo_mes', mes).eq('periodo_ano', ano).single(),
            supabase.from('repasses').select('*')
                .eq('partner_id', p.id).order('periodo_ano', { ascending: false }).order('periodo_mes', { ascending: false }),
        ]);

        setRepasseVendas(vendas || []);
        setRepasseExistente(repExist || null);
        setRepasseHistorico(historico || []);
        if (repExist) {
            setRepasseObs(repExist.obs || '');
            setRepasseDataPag(repExist.data_pagamento || new Date().toISOString().slice(0,10));
        }
        setLoadingRepasse(false);
    };

    const totalComissaoRepasse = () => {
        const pct = (repasseModal?.commission_pct || 20) / 100;
        return repasseVendas.reduce((s, v) => {
            const c = parseFloat(String(v.comissao || '0').replace(/[^0-9.]/g,'')) || 0;
            return s + c * pct;
        }, 0);
    };

    const confirmarRepasse = async () => {
        if (!repasseModal) return;
        setSavingRepasse(true);
        try {
            const valor = totalComissaoRepasse();
            let comprovanteUrl = repasseExistente?.comprovante_url || null;

            if (repasseComprovante) {
                const path = `repasses/${repasseModal.id}/${repasseAno}-${String(repasseMes).padStart(2,'0')}.pdf`;
                const { error: upErr } = await supabase.storage.from('apolices')
                    .upload(path, repasseComprovante, { upsert: true, contentType: 'application/pdf' });
                if (!upErr) {
                    const { data: urlData } = supabase.storage.from('apolices').getPublicUrl(path);
                    comprovanteUrl = urlData.publicUrl;
                }
            }

            const payload = {
                partner_id: repasseModal.id,
                partner_name: repasseModal.name,
                periodo_mes: repasseMes,
                periodo_ano: repasseAno,
                valor_total: valor,
                data_pagamento: repasseDataPag,
                comprovante_url: comprovanteUrl,
                status: 'pago' as const,
                obs: repasseObs || null,
            };

            if (repasseExistente) {
                await supabase.from('repasses').update(payload).eq('id', repasseExistente.id);
            } else {
                await supabase.from('repasses').insert([payload]);
            }

            await carregarRepasseData(repasseModal, repasseMes, repasseAno);
            alert('✅ Repasse confirmado com sucesso!');
        } catch (e: any) {
            alert('Erro: ' + e.message);
        } finally {
            setSavingRepasse(false);
        }
    };

    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtData = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

    const sendTestReport = async (p: Parceiro) => {
        setTestSendingId(p.id);
        try {
            const { data, error } = await supabase.functions.invoke('parceiro-commission-report', {
                body: { parceiro_name: p.name, test_mode: true, to: 'fabio@fegsegurogarantia.com.br' },
            });
            if (error) throw new Error(error.message || String(error));
            if (data && !data.success) throw new Error(data.error || data.message || 'Erro desconhecido');
            setTestSuccessId(p.id);
            setTimeout(() => setTestSuccessId(null), 4000);
        } catch (err: any) {
            alert(`Erro ao enviar relatório de teste:\n${err?.message}`);
        } finally {
            setTestSendingId(null);
        }
    };

    const fetch = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('partners')
            .select('id, name, username, password, commission_pct, cnpj, email, email_2, banco_nome, pix_key, conta_corrente, agencia, commission_type, partner_type')
            .order('name');
        setParceiros(data || []);
        setLoading(false);
    };

    useEffect(() => { fetch(); }, []);

    const handleEdit = (p: Parceiro) => {
        setEditingId(p.id);
        setForm({
            name: p.name, username: p.username, password: p.password, commission_pct: p.commission_pct,
            cnpj: p.cnpj || '', email: p.email || '', banco_nome: p.banco_nome || '',
            pix_key: p.pix_key || '', conta_corrente: p.conta_corrente || '',
            agencia: p.agencia || '', commission_type: p.commission_type || 'escalonado',
            partner_type: p.partner_type || 'seguro_garantia',
        });
        setShowForm(true);
        setError(null);
    };

    const handleNew = () => {
        setEditingId(null);
        setForm(emptyForm);
        setShowForm(true);
        setError(null);
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
        setError(null);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.username.trim() || !form.password.trim()) {
            setError('Preencha nome, usuário e senha.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const payload = {
                name: form.name.trim(),
                username: form.username.trim(),
                password: form.password,
                commission_pct: Number(form.commission_pct) || 20,
                cnpj: form.cnpj?.trim() || null,
                email: form.email?.trim() || null,
                email_2: (form as any).email_2?.trim() || null,
                banco_nome: form.banco_nome?.trim() || null,
                pix_key: form.pix_key?.trim() || null,
                conta_corrente: form.conta_corrente?.trim() || null,
                agencia: form.agencia?.trim() || null,
                commission_type: form.commission_type || 'escalonado',
                partner_type: form.partner_type || 'seguro_garantia',
            };
            if (editingId) {
                const { error } = await supabase.from('partners').update(payload).eq('id', editingId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('partners').insert([payload]);
                if (error) throw error;
            }
            await fetch();
            handleCancel();
        } catch (err: any) {
            setError(err?.message || 'Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number, name: string) => {
        if (!confirm(`Excluir parceiro "${name}"? O acesso dele será removido.`)) return;
        await supabase.from('partners').delete().eq('id', id);
        await fetch();
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-xl lg:text-3xl font-black text-slate-800">Parceiros</h2>
                    <p className="text-slate-500 font-medium mt-1">Gerencie os acessos e comissões dos parceiros comerciais.</p>
                </div>
                <button
                    onClick={handleNew}
                    className="flex items-center gap-2 px-5 py-3 bg-navy hover:bg-navy-light text-white font-bold text-sm rounded-xl transition-all shadow"
                >
                    <Plus size={16} /> Novo Parceiro
                </button>
            </div>

            {/* Form */}
            {showForm && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                    <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                        <Users size={18} className="text-gold" />
                        {editingId ? 'Editar Parceiro' : 'Novo Parceiro'}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome completo</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Ex: Raphael Icaro Licitações"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usuário (login)</label>
                            <input
                                type="text"
                                value={form.username}
                                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                                placeholder="Ex: raphael2024"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Senha</label>
                            <input
                                type="text"
                                value={form.password}
                                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                                placeholder="Senha de acesso"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all font-mono"
                            />
                        </div>
                        <div className="space-y-1 col-span-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tipo de Parceiro</label>
                            <select value={form.partner_type} onChange={e => setForm(f => ({ ...f, partner_type: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all">
                                <option value="seguro_garantia">🏢 Seguro Garantia — Parceiro comercial (comissões)</option>
                                <option value="imobiliaria">🏠 Imobiliária — Repasse mensal de seguros residenciais</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comissão (%)</label>
                            <input type="number" min="0" max="100" step="0.5" value={form.commission_pct}
                                onChange={e => setForm(f => ({ ...f, commission_pct: parseFloat(e.target.value) }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tipo de comissão</label>
                            <select value={form.commission_type} onChange={e => setForm(f => ({ ...f, commission_type: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all">
                                <option value="escalonado">Escalonado (contrato)</option>
                                <option value="fixo">Percentual fixo</option>
                            </select>
                        </div>
                    </div>

                    {/* Dados de contato e pagamento */}
                    <div className="border-t border-slate-100 pt-5 mt-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Dados de Contato e Pagamento</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CNPJ</label>
                                <input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))}
                                    placeholder="Ex: 58.546.651/0001-61"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-mail 1</label>
                                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="Ex: gestao@parceiro.com.br"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">E-mail 2 <span className="font-normal text-slate-300">(opcional)</span></label>
                                <input type="email" value={(form as any).email_2 || ''} onChange={e => setForm(f => ({ ...f, email_2: e.target.value }))}
                                    placeholder="Ex: financeiro@parceiro.com.br"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Banco</label>
                                <input value={form.banco_nome} onChange={e => setForm(f => ({ ...f, banco_nome: e.target.value }))}
                                    placeholder="Ex: BTG Pactual"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Chave PIX</label>
                                <input value={form.pix_key} onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))}
                                    placeholder="Ex: 58.546.651/0001-61"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conta Corrente</label>
                                <input value={form.conta_corrente} onChange={e => setForm(f => ({ ...f, conta_corrente: e.target.value }))}
                                    placeholder="Ex: 851629-5"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Agência</label>
                                <input value={form.agencia} onChange={e => setForm(f => ({ ...f, agencia: e.target.value }))}
                                    placeholder="Ex: 0050"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all" />
                            </div>
                        </div>
                    </div>
                    {error && <p className="text-sm text-rose-500 font-bold bg-rose-50 px-4 py-2 rounded-xl">{error}</p>}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-6 py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all"
                        >
                            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {saving ? 'Salvando...' : 'Salvar'}
                        </button>
                        <button onClick={handleCancel} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all">
                            <X size={15} /> Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Lista */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-slate-400">
                        <Loader2 size={24} className="animate-spin mr-3" /> Carregando...
                    </div>
                ) : parceiros.length === 0 ? (
                    <div className="py-16 text-center text-slate-400 font-semibold">Nenhum parceiro cadastrado.</div>
                ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usuário</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Senha</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comissão</th>
                                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {parceiros.map(p => (
                                <tr key={p.id} className="hover:bg-slate-50/80 transition-all">
                                    <td className="px-6 py-4 font-bold text-slate-800">{p.name}</td>
                                    <td className="px-6 py-4 text-slate-600 font-mono text-xs">{p.username}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs text-slate-600">
                                                {showPassId === p.id ? p.password : '••••••••'}
                                            </span>
                                            <button
                                                onClick={() => setShowPassId(showPassId === p.id ? null : p.id)}
                                                className="p-1 text-slate-400 hover:text-slate-600 transition-all"
                                            >
                                                {showPassId === p.id ? <EyeOff size={13} /> : <Eye size={13} />}
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                          {p.partner_type !== 'imobiliaria' && (
                                            <span className="inline-flex items-center px-3 py-1 bg-gold/10 text-gold rounded-xl text-xs font-bold w-fit">
                                                {p.commission_pct}%
                                            </span>
                                          )}
                                          {p.partner_type === 'imobiliaria' && (
                                            <span className="inline-flex items-center px-3 py-1 bg-slate-100 text-slate-500 rounded-xl text-xs font-bold w-fit">
                                                Repasse mensal
                                            </span>
                                          )}
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-xl w-fit ${p.partner_type === 'imobiliaria' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                                              {p.partner_type === 'imobiliaria' ? '🏠 Imobiliária' : '🏢 Seg. Garantia'}
                                          </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex justify-center gap-2">
                                            {testSuccessId === p.id ? (
                                                <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold px-2"><CheckCircle2 size={13} /> Enviado!</span>
                                            ) : (
                                                <button onClick={() => sendTestReport(p)} disabled={testSendingId === p.id}
                                                    title="Enviar relatório de teste para mim"
                                                    className="p-2 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-xl transition-all disabled:opacity-40">
                                                    {testSendingId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                                </button>
                                            )}
                                            <button onClick={() => abrirRepasse(p)} title="Fechar repasse do mês"
                                                className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"><DollarSign size={15} /></button>
                                            <button onClick={() => setWelcomeModal(p)} title="Enviar e-mail de boas-vindas"
                                                className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"><Mail size={15} /></button>
                                            <button onClick={() => handleEdit(p)} className="p-2 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-xl transition-all"><Edit2 size={15} /></button>
                                            <button onClick={() => handleDelete(p.id, p.name)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>

            {/* Modal Repasse */}
            {repasseModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setRepasseModal(null)}>
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-4" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-navy rounded-t-2xl px-6 py-5 flex items-center justify-between">
                            <div>
                                <p className="text-gold text-xs font-bold uppercase tracking-widest mb-1">Fechar Repasse</p>
                                <h3 className="text-white font-black text-lg">{repasseModal.name}</h3>
                            </div>
                            <button onClick={() => setRepasseModal(null)} className="p-2 text-white/50 hover:text-white"><X size={20}/></button>
                        </div>

                        <div className="p-6 space-y-5">
                            {/* Seletor período */}
                            <div className="flex gap-3">
                                <div className="flex-1 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mês</label>
                                    <select value={repasseMes} onChange={e => { setRepasseMes(+e.target.value); carregarRepasseData(repasseModal, +e.target.value, repasseAno); }}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-gold">
                                        {MESES.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ano</label>
                                    <select value={repasseAno} onChange={e => { setRepasseAno(+e.target.value); carregarRepasseData(repasseModal, repasseMes, +e.target.value); }}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-gold">
                                        {[2024,2025,2026,2027].map(a => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1 space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data do pagamento</label>
                                    <input type="date" value={repasseDataPag} onChange={e => setRepasseDataPag(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-gold"/>
                                </div>
                            </div>

                            {/* Status existente */}
                            {repasseExistente && (
                                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                                    <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0"/>
                                    <p className="text-emerald-700 text-sm font-bold">
                                        Repasse já confirmado em {fmtData(repasseExistente.data_pagamento)} — {fmt(repasseExistente.valor_total)}
                                        {repasseExistente.comprovante_url && <a href={repasseExistente.comprovante_url} target="_blank" className="ml-2 underline">ver comprovante</a>}
                                    </p>
                                </div>
                            )}

                            {/* Vendas do período */}
                            {loadingRepasse ? (
                                <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={20} className="animate-spin mr-2"/> Carregando...</div>
                            ) : repasseVendas.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 text-sm font-semibold bg-slate-50 rounded-xl">Nenhuma venda de {MESES[repasseMes]}/{repasseAno}</div>
                            ) : (
                                <div className="border border-slate-100 rounded-xl overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead><tr className="bg-slate-50">
                                            <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cliente</th>
                                            <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Produto</th>
                                            <th className="px-4 py-2.5 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comissão F&G</th>
                                            <th className="px-4 py-2.5 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Repasse</th>
                                        </tr></thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {repasseVendas.map(v => {
                                                const c = parseFloat(String(v.comissao||'0').replace(/[^0-9.]/g,''))||0;
                                                const r = c * (repasseModal.commission_pct||20)/100;
                                                return <tr key={v.id} className="hover:bg-slate-50/50">
                                                    <td className="px-4 py-3 font-bold text-slate-800">{v.nome}</td>
                                                    <td className="px-4 py-3 text-slate-500 text-xs">{v.product_type || v.tipo || '—'}</td>
                                                    <td className="px-4 py-3 text-right text-slate-600">{fmt(c)}</td>
                                                    <td className="px-4 py-3 text-right font-bold text-gold">{fmt(r)}</td>
                                                </tr>;
                                            })}
                                        </tbody>
                                        <tfoot><tr className="bg-navy">
                                            <td colSpan={3} className="px-4 py-3 text-white font-bold text-sm">Total a repassar</td>
                                            <td className="px-4 py-3 text-right text-gold font-bold text-base">{fmt(totalComissaoRepasse())}</td>
                                        </tr></tfoot>
                                    </table>
                                </div>
                            )}

                            {/* Comprovante + obs */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comprovante PDF</label>
                                    <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold cursor-pointer transition-all ${repasseComprovante ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-gold'}`}>
                                        <input type="file" accept=".pdf" className="hidden" onChange={e => setRepasseComprovante(e.target.files?.[0] || null)}/>
                                        <Upload size={14}/> {repasseComprovante ? repasseComprovante.name.substring(0,20) : 'Anexar comprovante'}
                                    </label>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observação</label>
                                    <input value={repasseObs} onChange={e => setRepasseObs(e.target.value)} placeholder="Ex: PIX realizado às 14h"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-gold"/>
                                </div>
                            </div>

                            {/* Botões */}
                            <div className="flex gap-3 pt-2">
                                <button onClick={confirmarRepasse} disabled={savingRepasse || repasseVendas.length === 0}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition-all">
                                    {savingRepasse ? <Loader2 size={15} className="animate-spin"/> : <CheckCircle2 size={15}/>}
                                    {savingRepasse ? 'Salvando...' : repasseExistente ? 'Atualizar Repasse' : 'Confirmar Repasse'}
                                </button>
                                {repasseModal.email && repasseExistente?.status === 'pago' && (
                                    <a href={`mailto:${repasseModal.email}?subject=${encodeURIComponent(`Repasse de Comissão — ${MESES[repasseMes]}/${repasseAno} — F&G Seguro Garantia`)}&body=${encodeURIComponent(`Prezada ${repasseModal.name},\n\nInformamos que realizamos o repasse de comissão referente a ${MESES[repasseMes]}/${repasseAno} no valor de ${fmt(totalComissaoRepasse())}.\n\nO comprovante está disponível no seu portal de parceiro:\nhub.fegsegurogarantia.com/parceiros-login.html\n\nAgradecemos pela parceria e pela confiança!\n\nAtenciosamente,\nEquipe F&G Seguro Garantia\nfabio@fegsegurogarantia.com.br`)}`}
                                        className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-all">
                                        <Mail size={15}/> Avisar parceiro
                                    </a>
                                )}
                            </div>

                            {/* Histórico */}
                            {repasseHistorico.length > 0 && (
                                <div className="border-t border-slate-100 pt-4">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Histórico de Repasses</p>
                                    <div className="space-y-2">
                                        {repasseHistorico.map(r => (
                                            <div key={r.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === 'pago' ? 'bg-emerald-500' : 'bg-amber-400'}`}/>
                                                    <div>
                                                        <p className="font-bold text-slate-800 text-sm">{MESES[r.periodo_mes]}/{r.periodo_ano}</p>
                                                        <p className="text-xs text-slate-400">{r.status === 'pago' ? `Pago em ${fmtData(r.data_pagamento)}` : 'Pendente'}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-bold text-gold">{fmt(r.valor_total)}</span>
                                                    {r.comprovante_url && <a href={r.comprovante_url} target="_blank" className="p-1.5 text-slate-400 hover:text-slate-600"><FileText size={14}/></a>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal boas-vindas */}
            {welcomeModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setWelcomeModal(null)}>
                    <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-black text-slate-800 text-lg flex items-center gap-2"><Mail size={18} className="text-blue-500" /> E-mail de Boas-vindas</h3>
                            <button onClick={() => setWelcomeModal(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-700 space-y-2 border border-slate-200 font-mono text-xs leading-relaxed">
                            <p><strong>Para:</strong> {welcomeModal.email || '⚠️ E-mail não cadastrado'}</p>
                            <p><strong>Assunto:</strong> Bem-vindo ao Portal de Parceiros — F&G Seguro Garantia</p>
                            <hr className="border-slate-200 my-2" />
                            <p>Prezados {welcomeModal.name},</p>
                            <br />
                            <p>É com prazer que disponibilizamos o seu acesso ao <strong>Portal de Parceiros F&G Seguro Garantia</strong>, onde vocês podem acompanhar em tempo real todas as apólices emitidas através das indicações de vocês e o histórico de comissões.</p>
                            <br />
                            <p><strong>Acesso ao portal:</strong><br />
                            🔗 hub.fegsegurogarantia.com/parceiros-login.html<br />
                            👤 Login: <strong>{welcomeModal.username}</strong><br />
                            🔒 Senha: <strong>{welcomeModal.password}</strong></p>
                            <br />
                            <p>Recomendamos alterar a senha no primeiro acesso — há uma opção disponível diretamente no portal.</p>
                            <br />
                            <p>Qualquer dúvida, estamos à disposição!</p>
                            <br />
                            <p>Atenciosamente,<br /><strong>Equipe F&G Seguro Garantia</strong></p>
                        </div>
                        {!welcomeModal.email && (
                            <p className="text-xs text-amber-600 font-bold mt-3 bg-amber-50 px-3 py-2 rounded-xl">⚠️ Cadastre o e-mail deste parceiro antes de enviar.</p>
                        )}
                        <div className="flex gap-3 mt-4">
                            {welcomeModal.email && (
                                welcomeSent ? (
                                    <div className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-emerald-50 text-emerald-700 font-bold text-sm rounded-xl border border-emerald-200">
                                        <CheckCircle2 size={15}/> E-mail enviado com sucesso!
                                    </div>
                                ) : (
                                    <button onClick={() => enviarBoasVindas(welcomeModal)} disabled={sendingWelcome}
                                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all">
                                        {sendingWelcome ? <Loader2 size={15} className="animate-spin"/> : <Mail size={15}/>}
                                        {sendingWelcome ? 'Enviando...' : 'Enviar e-mail de boas-vindas'}
                                    </button>
                                )
                            )}
                            <button onClick={() => setWelcomeModal(null)} className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Link do portal */}
            <div className="bg-navy/5 rounded-2xl px-6 py-4 border border-gold/20 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Link do portal do parceiro</p>
                    <p className="text-sm font-bold text-navy">hub.fegsegurogarantia.com/parceiros-login.html</p>
                </div>
                <button
                    onClick={() => navigator.clipboard.writeText('https://hub.fegsegurogarantia.com/parceiros-login.html')}
                    className="text-xs font-bold px-4 py-2 bg-gold/20 text-gold rounded-xl hover:bg-gold/30 transition-all"
                >
                    Copiar link
                </button>
            </div>
        </div>
    );
};

export default ParceiroManager;
