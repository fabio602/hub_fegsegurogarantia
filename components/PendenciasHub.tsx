// -*- coding: utf-8 -*-
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, CheckCircle2, AlertCircle, Calendar, User, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Pendencia } from '../types';

const RESPONSAVEIS = ['Andréia', 'Grace', 'Geisa', 'Fábio'] as const;

type FiltroPendencia = 'todas' | 'alta' | 'media' | 'baixa' | 'concluidas';

function borderPorPrioridade(p: Pendencia['prioridade'], concluida: boolean): string {
    if (concluida) return 'border-l-slate-300';
    if (p === 'alta') return 'border-l-red-500';
    if (p === 'media') return 'border-l-amber-400';
    return 'border-l-emerald-500';
}

function labelPrioridade(p: Pendencia['prioridade']): string {
    if (p === 'alta') return 'Alta';
    if (p === 'media') return 'Média';
    return 'Baixa';
}

function diasRestantesPrazo(prazo: string | null | undefined): { texto: string; vencido: boolean } | null {
    if (!prazo) return null;
    const fim = new Date(prazo.includes('T') ? prazo : `${prazo}T12:00:00`);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    fim.setHours(0, 0, 0, 0);
    const diff = Math.ceil((fim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { texto: `Vencido há ${Math.abs(diff)} dia${Math.abs(diff) !== 1 ? 's' : ''}`, vencido: true };
    if (diff === 0) return { texto: 'Vence hoje', vencido: false };
    return { texto: `${diff} dia${diff !== 1 ? 's' : ''} restante${diff !== 1 ? 's' : ''}`, vencido: false };
}

const emptyForm = {
    titulo: '',
    descricao: '',
    responsavel: '',
    prazo: '',
    prioridade: 'media' as Pendencia['prioridade'],
};

const PendenciasHub: React.FC = () => {
    const [lista, setLista] = useState<Pendencia[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<FiltroPendencia>('todas');
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);

    const fetchLista = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let q = supabase.from('pendencias').select('*');

            if (filtro === 'concluidas') {
                q = q.eq('concluida', true).order('atualizado_em', { ascending: false });
            } else {
                q = q.eq('concluida', false);
                if (filtro !== 'todas') q = q.eq('prioridade', filtro);
                q = q.order('prazo', { ascending: true, nullsFirst: false });
            }

            const { data, error: err } = await q;
            if (err) throw err;
            setLista((data as Pendencia[]) || []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Erro ao carregar pendências.');
            setLista([]);
        } finally {
            setLoading(false);
        }
    }, [filtro]);

    useEffect(() => {
        fetchLista();
    }, [fetchLista]);

    const chipClass = (ativo: boolean) =>
        `px-4 py-2 rounded-xl font-bold text-xs transition-all border ${
            ativo
                ? 'bg-[#C69C6D] text-white border-[#C69C6D] shadow-md'
                : 'bg-white text-slate-600 border-slate-200 hover:border-[#C69C6D]/40'
        }`;

    const handleNova = async () => {
        if (!form.titulo.trim()) {
            setError('Informe o título.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const row = {
                titulo: form.titulo.trim(),
                descricao: form.descricao.trim() || null,
                responsavel: form.responsavel.trim() || null,
                prazo: form.prazo || null,
                prioridade: form.prioridade,
                concluida: false,
            };
            const { error: insErr } = await supabase.from('pendencias').insert(row);
            if (insErr) throw insErr;
            setForm(emptyForm);
            setModalOpen(false);
            await fetchLista();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    const marcarConcluida = async (id: string) => {
        setSaving(true);
        setError(null);
        try {
            const { error: upErr } = await supabase.from('pendencias').update({ concluida: true }).eq('id', id);
            if (upErr) throw upErr;
            await fetchLista();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Erro ao atualizar.');
        } finally {
            setSaving(false);
        }
    };

    const excluirPendencia = async (p: Pendencia) => {
        const ok = window.confirm(
            `Excluir permanentemente a pendência «${p.titulo}»?\n\nEsta ação não pode ser desfeita.`
        );
        if (!ok) return;
        setSaving(true);
        setError(null);
        try {
            const { error: delErr } = await supabase.from('pendencias').delete().eq('id', p.id);
            if (delErr) throw delErr;
            await fetchLista();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Erro ao excluir.');
        } finally {
            setSaving(false);
        }
    };

    const filtrosBar = useMemo(
        () =>
            (
                [
                    { key: 'todas' as const, label: 'Todas' },
                    { key: 'alta' as const, label: 'Alta' },
                    { key: 'media' as const, label: 'Média' },
                    { key: 'baixa' as const, label: 'Baixa' },
                    { key: 'concluidas' as const, label: 'Concluídas' },
                ] as const
            ).map(({ key, label }) => (
                <button key={key} type="button" onClick={() => setFiltro(key)} className={chipClass(filtro === key)}>
                    {label}
                </button>
            )),
        [filtro]
    );

    return (
        <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">Pendências</h2>
                    <p className="text-slate-500 font-medium">
                        Acompanhe tarefas internas, prazos e responsáveis.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setForm(emptyForm);
                        setError(null);
                        setModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 bg-[#1B263B] text-white px-5 py-3 rounded-xl font-black text-sm shadow-lg hover:bg-[#243347] transition-all shrink-0"
                >
                    <Plus size={18} /> Nova pendência
                </button>
            </div>

            <div className="flex flex-wrap gap-2">{filtrosBar}</div>

            {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-bold">
                    <AlertCircle size={18} />
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                    <Loader2 size={36} className="animate-spin mb-3 text-[#C69C6D]" />
                    <p className="font-bold uppercase tracking-widest text-xs">Carregando pendências…</p>
                </div>
            ) : lista.length === 0 ? (
                <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center text-slate-500 font-medium">
                    Nenhuma pendência neste filtro.
                </div>
            ) : (
                <div className="grid gap-4">
                    {lista.map((p) => {
                        const prazoInfo = diasRestantesPrazo(p.prazo);
                        return (
                            <article
                                key={p.id}
                                className={`bg-white rounded-2xl border border-slate-100 shadow-sm pl-5 pr-6 py-5 border-l-4 ${borderPorPrioridade(
                                    p.prioridade,
                                    p.concluida
                                )}`}
                            >
                                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-lg font-black text-[#1B263B] leading-tight">{p.titulo}</h3>
                                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                                {labelPrioridade(p.prioridade)}
                                            </span>
                                            {p.concluida && (
                                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                                    Concluída
                                                </span>
                                            )}
                                        </div>
                                        {p.descricao ? (
                                            <p className="text-sm text-slate-600 whitespace-pre-wrap">{p.descricao}</p>
                                        ) : null}
                                        <div className="flex flex-wrap gap-4 text-xs text-slate-500 font-bold">
                                            {p.responsavel ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <User size={14} className="text-[#C69C6D]" />
                                                    {p.responsavel}
                                                </span>
                                            ) : null}
                                            {p.prazo ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <Calendar size={14} className="text-[#C69C6D]" />
                                                    {new Date(p.prazo.includes('T') ? p.prazo : `${p.prazo}T12:00:00`).toLocaleDateString(
                                                        'pt-BR'
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 text-slate-400">
                                                    <Calendar size={14} /> Sem prazo
                                                </span>
                                            )}
                                        </div>
                                        {prazoInfo && !p.concluida ? (
                                            <p
                                                className={`text-xs font-black uppercase tracking-wide ${
                                                    prazoInfo.vencido ? 'text-red-600' : 'text-slate-600'
                                                }`}
                                            >
                                                {prazoInfo.texto}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 shrink-0">
                                        {!p.concluida ? (
                                            <button
                                                type="button"
                                                disabled={saving}
                                                onClick={() => marcarConcluida(p.id)}
                                                className="inline-flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-black text-xs px-4 py-2.5 rounded-xl transition-all disabled:opacity-50"
                                            >
                                                <CheckCircle2 size={16} />
                                                Marcar como concluída
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => excluirPendencia(p)}
                                            className="inline-flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 font-black text-xs px-4 py-2.5 rounded-xl transition-all disabled:opacity-50"
                                            title="Remover esta pendência"
                                        >
                                            <Trash2 size={16} />
                                            Excluir
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#1B263B]/55 backdrop-blur-sm">
                    <div className="bg-[#F8F4ED] rounded-3xl shadow-2xl max-w-lg w-full p-8 border border-[#C69C6D]/30 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-start mb-6">
                            <h4 className="text-xl font-black text-[#1B263B]">Nova pendência</h4>
                            <button
                                type="button"
                                onClick={() => !saving && setModalOpen(false)}
                                className="p-2 rounded-xl hover:bg-white/80 text-slate-600"
                                aria-label="Fechar"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                    Título *
                                </label>
                                <input
                                    value={form.titulo}
                                    onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30 bg-white"
                                    placeholder="Resumo da pendência"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                    Descrição
                                </label>
                                <textarea
                                    value={form.descricao}
                                    onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                                    rows={3}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30 bg-white resize-y"
                                    placeholder="Detalhes opcionais"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                    Responsável
                                </label>
                                <select
                                    value={form.responsavel}
                                    onChange={(e) => setForm((f) => ({ ...f, responsavel: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30 bg-white"
                                >
                                    <option value="">— Selecione —</option>
                                    {RESPONSAVEIS.map((r) => (
                                        <option key={r} value={r}>
                                            {r}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                        Prazo
                                    </label>
                                    <input
                                        type="date"
                                        value={form.prazo}
                                        onChange={(e) => setForm((f) => ({ ...f, prazo: e.target.value }))}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30 bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                                        Prioridade
                                    </label>
                                    <select
                                        value={form.prioridade}
                                        onChange={(e) =>
                                            setForm((f) => ({
                                                ...f,
                                                prioridade: e.target.value as Pendencia['prioridade'],
                                            }))
                                        }
                                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#C69C6D]/30 bg-white"
                                    >
                                        <option value="alta">Alta</option>
                                        <option value="media">Média</option>
                                        <option value="baixa">Baixa</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={handleNova}
                            className="mt-8 w-full flex items-center justify-center gap-2 bg-[#C69C6D] text-white font-black py-3.5 rounded-xl hover:opacity-95 disabled:opacity-60 transition-all"
                        >
                            {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                            Salvar pendência
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
};

export default PendenciasHub;
