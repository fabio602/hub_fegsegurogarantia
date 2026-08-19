import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Eye, EyeOff, Loader2, Users, Send, CheckCircle2, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';

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
            .select('id, name, username, password, commission_pct, cnpj, email, banco_nome, pix_key, conta_corrente, agencia, commission_type, partner_type')
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
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">Parceiros</h2>
                    <p className="text-slate-500 font-medium mt-1">Gerencie os acessos e comissões dos parceiros comerciais.</p>
                </div>
                <button
                    onClick={handleNew}
                    className="flex items-center gap-2 px-5 py-3 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-sm rounded-xl transition-all shadow"
                >
                    <Plus size={16} /> Novo Parceiro
                </button>
            </div>

            {/* Form */}
            {showForm && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                    <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                        <Users size={18} className="text-[#C69C6D]" />
                        {editingId ? 'Editar Parceiro' : 'Novo Parceiro'}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome completo</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Ex: Raphael Icaro Licitações"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Usuário (login)</label>
                            <input
                                type="text"
                                value={form.username}
                                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                                placeholder="Ex: raphael2024"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha</label>
                            <input
                                type="text"
                                value={form.password}
                                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                                placeholder="Senha de acesso"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all font-mono"
                            />
                        </div>
                        <div className="space-y-1 col-span-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de Parceiro</label>
                            <select value={form.partner_type} onChange={e => setForm(f => ({ ...f, partner_type: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all">
                                <option value="seguro_garantia">🏢 Seguro Garantia — Parceiro comercial (comissões)</option>
                                <option value="imobiliaria">🏠 Imobiliária — Repasse mensal de seguros residenciais</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Comissão (%)</label>
                            <input type="number" min="0" max="100" step="0.5" value={form.commission_pct}
                                onChange={e => setForm(f => ({ ...f, commission_pct: parseFloat(e.target.value) }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de comissão</label>
                            <select value={form.commission_type} onChange={e => setForm(f => ({ ...f, commission_type: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all">
                                <option value="escalonado">Escalonado (contrato)</option>
                                <option value="fixo">Percentual fixo</option>
                            </select>
                        </div>
                    </div>

                    {/* Dados de contato e pagamento */}
                    <div className="border-t border-slate-100 pt-5 mt-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Dados de Contato e Pagamento</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CNPJ</label>
                                <input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))}
                                    placeholder="Ex: 58.546.651/0001-61"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">E-mail para relatório</label>
                                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="Ex: gestao@parceiro.com.br"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Banco</label>
                                <input value={form.banco_nome} onChange={e => setForm(f => ({ ...f, banco_nome: e.target.value }))}
                                    placeholder="Ex: BTG Pactual"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chave PIX</label>
                                <input value={form.pix_key} onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))}
                                    placeholder="Ex: 58.546.651/0001-61"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conta Corrente</label>
                                <input value={form.conta_corrente} onChange={e => setForm(f => ({ ...f, conta_corrente: e.target.value }))}
                                    placeholder="Ex: 851629-5"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Agência</label>
                                <input value={form.agencia} onChange={e => setForm(f => ({ ...f, agencia: e.target.value }))}
                                    placeholder="Ex: 0050"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                            </div>
                        </div>
                    </div>
                    {error && <p className="text-sm text-red-500 font-bold bg-red-50 px-4 py-2 rounded-xl">{error}</p>}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-6 py-3 bg-[#1B263B] hover:bg-[#243447] disabled:opacity-50 text-white font-black text-sm rounded-xl transition-all"
                        >
                            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {saving ? 'Salvando...' : 'Salvar'}
                        </button>
                        <button onClick={handleCancel} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm rounded-xl transition-all">
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
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome</th>
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Usuário</th>
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha</th>
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Comissão</th>
                                <th className="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {parceiros.map(p => (
                                <tr key={p.id} className="hover:bg-slate-50/80 transition-all">
                                    <td className="px-6 py-4 font-black text-slate-800">{p.name}</td>
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
                                          <span className="inline-flex items-center px-3 py-1 bg-[#C69C6D]/10 text-[#C69C6D] rounded-lg text-xs font-black w-fit">
                                              {p.commission_pct}%
                                          </span>
                                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md w-fit ${p.partner_type === 'imobiliaria' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
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
                                                    className="p-2 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all disabled:opacity-40">
                                                    {testSendingId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                                </button>
                                            )}
                                            <button onClick={() => setWelcomeModal(p)} title="Enviar e-mail de boas-vindas"
                                                className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"><Mail size={15} /></button>
                                            <button onClick={() => handleEdit(p)} className="p-2 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"><Edit2 size={15} /></button>
                                            <button onClick={() => handleDelete(p.id, p.name)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

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
                            <p>Atenciosamente,<br /><strong>Equipe F&G Seguro Garantia</strong><br />fabio@fegsegurogarantia.com.br</p>
                        </div>
                        {!welcomeModal.email && (
                            <p className="text-xs text-amber-600 font-bold mt-3 bg-amber-50 px-3 py-2 rounded-lg">⚠️ Cadastre o e-mail deste parceiro antes de enviar.</p>
                        )}
                        <div className="flex gap-3 mt-4">
                            {welcomeModal.email && (
                                <a
                                    href={`mailto:${welcomeModal.email}?subject=${encodeURIComponent('Bem-vindo ao Portal de Parceiros — F&G Seguro Garantia')}&body=${encodeURIComponent(`Prezados ${welcomeModal.name},\n\nÉ com prazer que disponibilizamos o seu acesso ao Portal de Parceiros F&G Seguro Garantia, onde vocês podem acompanhar em tempo real todas as apólices emitidas através das indicações de vocês e o histórico de comissões.\n\nAcesso ao portal:\n🔗 hub.fegsegurogarantia.com/parceiros-login.html\n👤 Login: ${welcomeModal.username}\n🔒 Senha: ${welcomeModal.password}\n\nRecomendamos alterar a senha no primeiro acesso — há uma opção disponível diretamente no portal.\n\nQualquer dúvida, estamos à disposição!\n\nAtenciosamente,\nEquipe F&G Seguro Garantia\nfabio@fegsegurogarantia.com.br`)}`}
                                    className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-sm rounded-xl transition-all"
                                >
                                    <Mail size={15} /> Abrir no meu e-mail
                                </a>
                            )}
                            <button onClick={() => setWelcomeModal(null)} className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm rounded-xl transition-all">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Link do portal */}
            <div className="bg-[#1B263B]/5 rounded-2xl px-6 py-4 border border-[#C69C6D]/20 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Link do portal do parceiro</p>
                    <p className="text-sm font-bold text-[#1B263B]">hub.fegsegurogarantia.com/parceiros-login.html</p>
                </div>
                <button
                    onClick={() => navigator.clipboard.writeText('https://hub.fegsegurogarantia.com/parceiros-login.html')}
                    className="text-xs font-black px-4 py-2 bg-[#C69C6D]/20 text-[#C69C6D] rounded-xl hover:bg-[#C69C6D]/30 transition-all"
                >
                    Copiar link
                </button>
            </div>
        </div>
    );
};

export default ParceiroManager;
