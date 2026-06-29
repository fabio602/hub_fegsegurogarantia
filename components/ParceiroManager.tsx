import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Eye, EyeOff, Loader2, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Parceiro {
    id: number;
    name: string;
    username: string;
    password: string;
    commission_pct: number;
}

const emptyForm = { name: '', username: '', password: '', commission_pct: 20 };

const ParceiroManager: React.FC = () => {
    const [parceiros, setParceiros] = useState<Parceiro[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassId, setShowPassId] = useState<number | null>(null);

    const fetch = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('partners')
            .select('id, name, username, password, commission_pct')
            .order('name');
        setParceiros(data || []);
        setLoading(false);
    };

    useEffect(() => { fetch(); }, []);

    const handleEdit = (p: Parceiro) => {
        setEditingId(p.id);
        setForm({ name: p.name, username: p.username, password: p.password, commission_pct: p.commission_pct });
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
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Comissão (%)</label>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.5"
                                value={form.commission_pct}
                                onChange={e => setForm(f => ({ ...f, commission_pct: parseFloat(e.target.value) }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all"
                            />
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
                                        <span className="inline-flex items-center px-3 py-1 bg-[#C69C6D]/10 text-[#C69C6D] rounded-lg text-xs font-black">
                                            {p.commission_pct}%
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex justify-center gap-2">
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
