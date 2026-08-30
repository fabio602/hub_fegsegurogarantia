import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, X, Loader2, ShieldCheck, Key, UserX, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ADMIN_EMAIL, MODULOS } from '../lib/permissoes.ts';

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

    // Permissões por usuário. `permMap` guarda só quem TEM linha na tabela —
    // ausência significa acesso total, então não dá para preencher com [] por
    // padrão sem tirar o acesso de todo mundo.
    const [permMap, setPermMap] = useState<Record<string, string[]>>({});
    const [permForm, setPermForm] = useState<{ email: string; modulos: string[] } | null>(null);
    const [permSaving, setPermSaving] = useState(false);

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

    const fetchPerms = async () => {
        const { data } = await supabase.from('hub_permissoes').select('user_email, modulos');
        const map: Record<string, string[]> = {};
        (data ?? []).forEach((p: any) => { map[p.user_email] = p.modulos ?? []; });
        setPermMap(map);
    };

    useEffect(() => { fetchUsers(); fetchPerms(); }, []);

    const TODOS_MODULOS = MODULOS.map(m => m.key);

    /** Quem não tem linha vê tudo — abre o modal com tudo marcado. */
    const abrirPermissoes = (email: string) =>
        setPermForm({ email, modulos: permMap[email] ?? TODOS_MODULOS });

    const salvarPermissoes = async () => {
        if (!permForm) return;
        setPermSaving(true);
        try {
            // Tudo marcado volta a ser "sem restrição": apaga a linha em vez de
            // gravar a lista cheia. Assim um módulo novo criado no futuro já
            // nasce liberado para quem nunca foi restringido.
            if (permForm.modulos.length === TODOS_MODULOS.length) {
                await supabase.from('hub_permissoes').delete().eq('user_email', permForm.email);
            } else {
                await supabase.from('hub_permissoes').upsert({
                    user_email: permForm.email,
                    modulos: permForm.modulos,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_email' });
            }
            await fetchPerms();
            setPermForm(null);
        } catch (e: any) {
            alert('Erro ao salvar permissões: ' + e.message);
        } finally {
            setPermSaving(false);
        }
    };

    const resumoAcesso = (email: string) => {
        if (email === ADMIN_EMAIL) return 'Administrador';
        const m = permMap[email];
        if (!m) return 'Acesso total';
        if (!m.length) return 'Só a Visão Geral';
        return `${m.length} de ${TODOS_MODULOS.length} módulos`;
    };

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
                    className="flex items-center gap-2 px-5 py-3 bg-navy hover:bg-navy-light text-white font-bold text-sm rounded-xl transition-all shadow"
                >
                    <Plus size={16} /> Novo Usuário
                </button>
            </div>

            {/* Create Form */}
            {showForm && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                    <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                        <ShieldCheck size={18} className="text-gold" /> Novo Acesso ao Hub
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                placeholder="email@exemplo.com"
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
                    </div>
                    {error && <p className="text-sm text-rose-500 font-bold bg-rose-50 px-4 py-2 rounded-xl">{error}</p>}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handleCreate}
                            disabled={saving}
                            className="flex items-center gap-2 px-6 py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all"
                        >
                            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {saving ? 'Criando...' : 'Criar Acesso'}
                        </button>
                        <button onClick={() => { setShowForm(false); setError(null); }} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all">
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
                            <Key size={18} className="text-gold" /> Alterar Senha
                        </h3>
                        <p className="text-sm text-slate-500 font-medium">{pwForm.email}</p>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nova senha</label>
                            <input
                                type="text"
                                value={pwForm.password}
                                onChange={e => setPwForm(f => f ? { ...f, password: e.target.value } : f)}
                                placeholder="Nova senha"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold transition-all font-mono"
                            />
                        </div>
                        {pwError && <p className="text-sm text-rose-500 font-bold bg-rose-50 px-4 py-2 rounded-xl">{pwError}</p>}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={handleUpdatePassword}
                                disabled={pwSaving}
                                className="flex items-center gap-2 px-6 py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all"
                            >
                                {pwSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                {pwSaving ? 'Salvando...' : 'Salvar'}
                            </button>
                            <button onClick={() => { setPwForm(null); setPwError(null); }} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all">
                                <X size={15} /> Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Permissions Modal */}
            {permForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    {/* Cabeçalho e botões ficam presos; só a lista de módulos rola.
                        Antes o modal inteiro rolava: em tela de notebook o e-mail de
                        quem estava sendo editado saía do campo de visão e o Salvar
                        só aparecia no fim da rolagem. */}
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                        <div className="shrink-0 p-8 pb-4 space-y-4 border-b border-slate-100">
                            <div>
                                <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                                    <Lock size={18} className="text-gold" /> O que este usuário vê
                                </h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">{permForm.email}</p>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPermForm(f => f ? { ...f, modulos: TODOS_MODULOS } : f)}
                                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
                                >
                                    Marcar tudo
                                </button>
                                <button
                                    onClick={() => setPermForm(f => f ? { ...f, modulos: [] } : f)}
                                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
                                >
                                    Desmarcar tudo
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-1.5">
                            {MODULOS.map(m => {
                                const marcado = permForm.modulos.includes(m.key);
                                return (
                                    <label
                                        key={m.key}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer border transition-all ${
                                            marcado ? 'bg-gold/10 border-gold/40' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={marcado}
                                            onChange={() => setPermForm(f => f ? {
                                                ...f,
                                                modulos: marcado ? f.modulos.filter(k => k !== m.key) : [...f.modulos, m.key],
                                            } : f)}
                                            className="w-4 h-4 accent-gold"
                                        />
                                        <div className="min-w-0">
                                            <p className="font-bold text-slate-800 text-sm">{m.label}</p>
                                            <p className="text-[11px] text-slate-400 font-medium">
                                                {m.views.length} {m.views.length === 1 ? 'tela' : 'telas'}
                                            </p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="shrink-0 p-8 pt-4 space-y-4 border-t border-slate-100">
                            <p className="text-[11px] text-slate-500 font-medium bg-slate-50 rounded-xl px-4 py-3 leading-relaxed">
                                A Visão Geral fica sempre visível — sem ela a pessoa abriria o hub numa tela em branco.
                                A mudança vale na hora, sem precisar deslogar. Marcar todos os módulos equivale a acesso total.
                            </p>

                            <div className="flex gap-3">
                                <button
                                    onClick={salvarPermissoes}
                                    disabled={permSaving}
                                    className="flex items-center gap-2 px-6 py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all"
                                >
                                    {permSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                    {permSaving ? 'Salvando...' : 'Salvar'}
                                </button>
                                <button onClick={() => setPermForm(null)} className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all">
                                    <X size={15} /> Cancelar
                                </button>
                            </div>
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
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Acesso</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Criado em</th>
                                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Último acesso</th>
                                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-slate-50/80 transition-all">
                                    <td className="px-6 py-4 font-bold text-slate-800">{u.email}</td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                                            u.email === ADMIN_EMAIL ? 'bg-navy text-gold'
                                            : permMap[u.email] ? 'bg-amber-50 text-amber-700'
                                            : 'bg-slate-100 text-slate-500'
                                        }`}>
                                            {resumoAcesso(u.email)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-500 text-xs">{fmtDate(u.created_at)}</td>
                                    <td className="px-6 py-4 text-slate-500 text-xs">{fmtDate(u.last_sign_in_at)}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex justify-center gap-2">
                                            {/* O admin não tem o que restringir: vê tudo por definição. */}
                                            {u.email !== ADMIN_EMAIL && (
                                                <button
                                                    onClick={() => abrirPermissoes(u.email)}
                                                    className="p-2 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-lg transition-all"
                                                    title="Definir o que este usuário vê"
                                                >
                                                    <Lock size={15} />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setPwForm({ userId: u.id, email: u.email, password: '' })}
                                                className="p-2 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-lg transition-all"
                                                title="Alterar senha"
                                            >
                                                <Key size={15} />
                                            </button>
                                            {u.email !== ADMIN_EMAIL && (
                                                <button
                                                    onClick={() => handleDelete(u.id, u.email)}
                                                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
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
