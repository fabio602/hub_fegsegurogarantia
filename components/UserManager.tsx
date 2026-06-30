import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, X, Loader2, ShieldCheck, Key, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface HubUser {
    id: string;
    email: string;
    created_at: string;
    last_sign_in_at?: string;
    banned_until?: string;
}

const emptyForm = { email: '', password: '' };

const FUNCTION_URL = 'https://hfjvwibucplyhsvnwfor.supabase.co/functions/v1/manage-users';

const UserManager: React.FC = () => {
    const [users, setUsers] = useState<HubUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pwForm, setPwForm] = useState<{ userId: string; email: string; password: string } | null>(null);
    const [pwSaving, setPwSaving] = useState(false);
    const [pwError, setPwError] = useState<string | null>(null);

    const getToken = async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token || '';
    };

    const callFn = async (body: object) => {
        const token = await getToken();
        const res = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro desconhecido');
        return json;
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const { users } = await callFn({ action: 'list' });
            setUsers(users || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleCreate = async () => {
        if (!form.email.trim() || !form.password.trim()) {
            setError('Preencha email e senha.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await callFn({ action: 'create', email: form.email.trim(), password: form.password });
            await fetchUsers();
            setShowForm(false);
            setForm(emptyForm);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (userId: string, email: string) => {
        if (!confirm(`Remover acesso de "${email}"? Essa ação não pode ser desfeita.`)) return;
        try {
            await callFn({ action: 'delete', userId });
            await fetchUsers();
        } catch (e: any) {
            alert('Erro: ' + e.message);
        }
    };

    const handleUpdatePassword = async () => {
        if (!pwForm || !pwForm.password.trim()) { setPwError('Digite a nova senha.'); return; }
        setPwSaving(true);
        setPwError(null);
        try {
            await callFn({ action: 'update_password', userId: pwForm.userId, password: pwForm.password });
            setPwForm(null);
        } catch (e: any) {
            setPwError(e.message);
        } finally {
            setPwSaving(false);
        }
    };

    const fmtDate = (d?: string) => {
        if (!d) return '—';
        return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">Usuários do Hub</h2>
                    <p className="text-slate-500 font-medium mt-1">Gerencie quem tem acesso ao sistema interno.</p>
                </div>
                <button
                    onClick={() => { setShowForm(true); setForm(emptyForm); setError(null); }}
                    className="flex items-center gap-2 px-5 py-3 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-sm rounded-xl transition-all shadow"
                >
                    <Plus size={16} /> Novo Usuário
                </button>
            </div>

            {/* Create Form */}
            {showForm && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                    <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                        <ShieldCheck size={18} className="text-[#C69C6D]" /> Novo Acesso ao Hub
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                placeholder="email@exemplo.com"
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
                    </div>
                    {error && <p className="text-sm text-red-500 font-bold bg-red-50 px-4 py-2 rounded-xl">{error}</p>}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handleCreate}
                            disabled={saving}
                            className="flex items-center gap-2 px-6 py-3 bg-[#1B263B] hover:bg-[#243447] disabled:opacity-50 text-white font-black text-sm rounded-xl transition-all"
                        >
                            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {saving ? 'Criando...' : 'Criar Acesso'}
                        </button>
                        <button onClick={() => { setShowForm(false); setError(null); }} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm rounded-xl transition-all">
                            <X size={15} /> Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Change Password Modal */}
            {pwForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md space-y-5">
                        <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                            <Key size={18} className="text-[#C69C6D]" /> Alterar Senha
                        </h3>
                        <p className="text-sm text-slate-500 font-medium">{pwForm.email}</p>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nova senha</label>
                            <input
                                type="text"
                                value={pwForm.password}
                                onChange={e => setPwForm(f => f ? { ...f, password: e.target.value } : f)}
                                placeholder="Nova senha"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#C69C6D] transition-all font-mono"
                            />
                        </div>
                        {pwError && <p className="text-sm text-red-500 font-bold bg-red-50 px-4 py-2 rounded-xl">{pwError}</p>}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={handleUpdatePassword}
                                disabled={pwSaving}
                                className="flex items-center gap-2 px-6 py-3 bg-[#1B263B] hover:bg-[#243447] disabled:opacity-50 text-white font-black text-sm rounded-xl transition-all"
                            >
                                {pwSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                {pwSaving ? 'Salvando...' : 'Salvar'}
                            </button>
                            <button onClick={() => { setPwForm(null); setPwError(null); }} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-sm rounded-xl transition-all">
                                <X size={15} /> Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Users Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-slate-400">
                        <Loader2 size={24} className="animate-spin mr-3" /> Carregando...
                    </div>
                ) : users.length === 0 ? (
                    <div className="py-16 text-center text-slate-400 font-semibold">Nenhum usuário encontrado.</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</th>
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Criado em</th>
                                <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Último acesso</th>
                                <th className="px-6 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-slate-50/80 transition-all">
                                    <td className="px-6 py-4 font-black text-slate-800">{u.email}</td>
                                    <td className="px-6 py-4 text-slate-500 text-xs">{fmtDate(u.created_at)}</td>
                                    <td className="px-6 py-4 text-slate-500 text-xs">{fmtDate(u.last_sign_in_at)}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex justify-center gap-2">
                                            <button
                                                onClick={() => setPwForm({ userId: u.id, email: u.email, password: '' })}
                                                className="p-2 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"
                                                title="Alterar senha"
                                            >
                                                <Key size={15} />
                                            </button>
                                            {u.email !== 'fabio@fegsegurogarantia.com.br' && (
                                                <button
                                                    onClick={() => handleDelete(u.id, u.email)}
                                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                    title="Remover acesso"
                                                >
                                                    <UserX size={15} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 text-sm text-amber-700 font-medium">
                ⚠️ Esta tela é visível apenas para o administrador. Remover um usuário revoga imediatamente o acesso ao hub.
            </div>
        </div>
    );
};

export default UserManager;
