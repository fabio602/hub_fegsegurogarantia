import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Loader2, Play, Save, Download, AlertTriangle, CheckCircle2,
    FlaskConical, Pickaxe, Plus, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { CampanhaGarimpo, GarimpoExecucao, ReputacaoEnvio } from '../types';

interface TrilhaOption { slug: string; nome: string; }

interface ResumoReputacao {
    limitePncp: number;
    limitesCampanhas: number;
    enviadosPncpHoje: number;
    enviadosGarimpoHoje: number;
    bouncesHoje: number;
}

/**
 * Garimpo Automático: campanhas de prospecção no Google Maps (via Apify).
 *
 * O motor é a Edge Function `garimpo` (tiques do pg_cron); esta tela só edita
 * campanhas e mostra estoque, execuções e o painel único de reputação, que
 * soma os limites e bounces de todas as automações (PNCP incluído).
 */
export default function GarimpoAutomatico() {
    const [campanhas, setCampanhas] = useState<CampanhaGarimpo[]>([]);
    const [trilhas, setTrilhas] = useState<TrilhaOption[]>([]);
    const [reputacao, setReputacao] = useState<ReputacaoEnvio | null>(null);
    const [resumo, setResumo] = useState<ResumoReputacao | null>(null);
    const [execucoes, setExecucoes] = useState<GarimpoExecucao[]>([]);
    const [estoque, setEstoque] = useState<Record<string, number>>({});
    const [abaAtiva, setAbaAtiva] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

    // Campos de lista da campanha ativa, editados como texto.
    const [termosText, setTermosText] = useState('');
    const [cidadesText, setCidadesText] = useState('');
    const [exclusoesText, setExclusoesText] = useState('');
    const [form, setForm] = useState<CampanhaGarimpo | null>(null);

    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: camps }, { data: trilhasData }, { data: rep }] = await Promise.all([
            supabase.from('campanhas_garimpo').select('*').order('criado_em'),
            supabase.from('email_trilhas').select('slug, nome').eq('ativo', true).order('ordem'),
            supabase.from('reputacao_envio').select('*').limit(1).maybeSingle(),
        ]);
        setCampanhas(camps ?? []);
        setTrilhas(trilhasData ?? []);
        setReputacao(rep ?? null);
        setAbaAtiva(prev => prev || camps?.[0]?.slug || '');

        // Painel de reputação: limites e envios do dia, todas as origens.
        const inicio = `${hoje}T00:00:00-03:00`;
        const [cfgPncp, pncpHoje, garimpoHoje, bouncesPncp, bouncesGarimpo] = await Promise.all([
            supabase.from('prospeccao_pncp_config').select('limite_diario').eq('id', 1).maybeSingle(),
            supabase.from('prospeccao_pncp_leads').select('id', { count: 'exact', head: true })
                .eq('resultado', 'enviado').gte('enviado_em', inicio),
            supabase.from('garimpo_estoque').select('id', { count: 'exact', head: true })
                .gte('enviado_em', inicio),
            supabase.from('prospeccao_pncp_leads').select('id', { count: 'exact', head: true })
                .in('resend_status', ['bounced_permanent', 'complained']).gte('enviado_em', inicio),
            supabase.from('garimpo_estoque').select('id', { count: 'exact', head: true })
                .eq('estado', 'bounce').gte('atualizado_em', inicio),
        ]);
        setResumo({
            limitePncp: Number(cfgPncp.data?.limite_diario ?? 0),
            limitesCampanhas: (camps ?? []).filter(c => c.ativo).reduce((s, c) => s + Number(c.limite_diario), 0),
            enviadosPncpHoje: Number(pncpHoje.count ?? 0),
            enviadosGarimpoHoje: Number(garimpoHoje.count ?? 0),
            bouncesHoje: Number(bouncesPncp.count ?? 0) + Number(bouncesGarimpo.count ?? 0),
        });
        setLoading(false);
    }, [hoje]);

    useEffect(() => { load(); }, [load]);

    // Carrega os dados da aba ativa.
    useEffect(() => {
        const camp = campanhas.find(c => c.slug === abaAtiva);
        if (!camp) { setForm(null); return; }
        setForm(camp);
        setTermosText((camp.termos_busca ?? []).join(', '));
        setCidadesText((camp.cidades ?? []).join('; '));
        setExclusoesText((camp.palavras_exclusao ?? []).join('; '));
        (async () => {
            const [{ data: execs }, { data: est }] = await Promise.all([
                supabase.from('garimpo_execucoes').select('*')
                    .eq('campanha_id', camp.id).order('executado_em', { ascending: false }).limit(20),
                supabase.from('garimpo_estoque').select('estado').eq('campanha_id', camp.id),
            ]);
            setExecucoes(execs ?? []);
            const contagem: Record<string, number> = {};
            for (const r of (est ?? [])) contagem[r.estado] = (contagem[r.estado] ?? 0) + 1;
            setEstoque(contagem);
        })();
    }, [abaAtiva, campanhas]);

    const parseVirgula = (t: string) => t.split(',').map(s => s.trim()).filter(Boolean);
    const parsePontoVirgula = (t: string) => t.split(';').map(s => s.trim()).filter(Boolean);

    const salvar = async () => {
        if (!form) return;
        setSaving(true);
        setFeedback(null);
        const { error } = await supabase.from('campanhas_garimpo').update({
            nome: form.nome,
            ativo: form.ativo,
            dry_run: form.dry_run,
            termos_busca: parseVirgula(termosText),
            cidades: parsePontoVirgula(cidadesText),
            palavras_exclusao: parsePontoVirgula(exclusoesText),
            trilha: form.trilha,
            tipo_prospect: form.tipo_prospect,
            limite_diario: form.limite_diario,
            cadencia_garimpo_dias: form.cadencia_garimpo_dias,
            exigir_cnpj: form.exigir_cnpj,
            updated_at: new Date().toISOString(),
        }).eq('id', form.id);
        setSaving(false);
        setFeedback(error
            ? { tipo: 'erro', texto: `Falha ao salvar: ${error.message}` }
            : { tipo: 'ok', texto: 'Campanha salva.' });
        if (!error) load();
    };

    const novaCampanha = async () => {
        const nome = prompt('Nome da nova campanha:');
        if (!nome?.trim()) return;
        const slug = nome.trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const { error } = await supabase.from('campanhas_garimpo').insert({
            slug, nome: nome.trim(),
            trilha: trilhas[0]?.slug ?? 'garantia',
            limite_diario: 5,
        });
        if (error) {
            setFeedback({ tipo: 'erro', texto: `Falha ao criar: ${error.message}` });
        } else {
            setFeedback({ tipo: 'ok', texto: `Campanha "${nome.trim()}" criada em dry run. Preencha termos e cidades e salve.` });
            setAbaAtiva(slug);
            load();
        }
    };

    const rodarTique = async () => {
        if (!form) return;
        setRunning(true);
        setFeedback(null);
        try {
            const { data, error } = await supabase.functions.invoke('garimpo', {
                body: { campanha: form.slug },
            });
            if (error) throw new Error(error.message);
            if (data?.success === false) throw new Error(data?.error || 'falha');
            setFeedback({ tipo: 'ok', texto: 'Tique iniciado. Cada tique processa ~2 minutos de trabalho; recarregue em instantes para ver o efeito.' });
            [30, 90, 180].forEach(s => setTimeout(load, s * 1000));
        } catch (e: any) {
            setFeedback({ tipo: 'erro', texto: `Tique falhou: ${e?.message || e}` });
        }
        setRunning(false);
    };

    const despausarGlobal = async () => {
        if (!reputacao) return;
        await supabase.from('reputacao_envio').update({
            pausado: false, pausado_motivo: null, pausado_em: null, updated_at: new Date().toISOString(),
        }).eq('dominio', reputacao.dominio);
        await supabase.from('prospeccao_pncp_config').update({
            pausado: false, pausado_motivo: null, pausado_em: null,
        }).eq('id', 1);
        setFeedback({ tipo: 'ok', texto: 'Envios despausados em todas as automações.' });
        load();
    };

    const salvarLimitesReputacao = async () => {
        if (!reputacao) return;
        const { error } = await supabase.from('reputacao_envio').update({
            bounce_max_percentual: reputacao.bounce_max_percentual,
            bounce_min_quantidade: reputacao.bounce_min_quantidade,
            updated_at: new Date().toISOString(),
        }).eq('dominio', reputacao.dominio);
        setFeedback(error
            ? { tipo: 'erro', texto: `Falha ao salvar limites: ${error.message}` }
            : { tipo: 'ok', texto: 'Limites de reputação salvos.' });
    };

    const baixarRelatorio = async (caminho: string) => {
        const { data, error } = await supabase.storage.from('garimpo').createSignedUrl(caminho, 120);
        if (error || !data?.signedUrl) {
            setFeedback({ tipo: 'erro', texto: `Não consegui gerar o link: ${error?.message}` });
            return;
        }
        window.open(data.signedUrl, '_blank');
    };

    const totalLimites = useMemo(() =>
        (resumo?.limitePncp ?? 0) + (resumo?.limitesCampanhas ?? 0), [resumo]);
    const enviadosHoje = (resumo?.enviadosPncpHoje ?? 0) + (resumo?.enviadosGarimpoHoje ?? 0);
    const taxaBounce = enviadosHoje > 0 ? ((resumo?.bouncesHoje ?? 0) / enviadosHoje) * 100 : 0;

    if (loading && !campanhas.length) {
        return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-[#C69C6D]" size={32} /></div>;
    }

    const campo = 'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all';
    const rotulo = 'block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';

    return (
        <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col lg:flex-row justify-between gap-4 items-start">
                <div>
                    <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3">
                        <Pickaxe className="text-[#C69C6D]" size={30} /> Garimpo Automático
                    </h2>
                    <p className="text-slate-500 font-medium">
                        Campanhas de prospecção no Google Maps. O estoque enche sozinho e o envio diário respeita o limite de cada campanha.
                    </p>
                </div>
                <button onClick={novaCampanha}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#1B263B] hover:bg-[#243347] text-white text-sm font-bold rounded-xl transition-all">
                    <Plus size={16} /> Nova campanha
                </button>
            </div>

            {/* Painel único de reputação */}
            <div className={`rounded-2xl border p-5 ${reputacao?.pausado ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-100 shadow-sm'}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        {reputacao?.pausado
                            ? <ShieldAlert className="text-rose-500" size={24} />
                            : <ShieldCheck className="text-emerald-500" size={24} />}
                        <div>
                            <p className="font-bold text-slate-800 text-sm">Reputação de envio ({reputacao?.dominio})</p>
                            <p className="text-xs text-slate-500 font-medium">
                                {reputacao?.pausado
                                    ? reputacao.pausado_motivo
                                    : 'Bounces somados de todas as automações. Estourou o limite, tudo pausa de uma vez.'}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-6 text-center">
                        <div>
                            <p className="text-2xl font-black text-slate-800">{enviadosHoje}<span className="text-sm text-slate-400 font-bold"> / {totalLimites}</span></p>
                            <p className="text-[10px] font-bold uppercase text-slate-400">Enviados hoje</p>
                        </div>
                        <div>
                            <p className="text-2xl font-black text-slate-800">{resumo?.enviadosPncpHoje ?? 0}</p>
                            <p className="text-[10px] font-bold uppercase text-slate-400">PNCP ({resumo?.limitePncp ?? 0}/dia)</p>
                        </div>
                        <div>
                            <p className="text-2xl font-black text-slate-800">{resumo?.enviadosGarimpoHoje ?? 0}</p>
                            <p className="text-[10px] font-bold uppercase text-slate-400">Garimpo ({resumo?.limitesCampanhas ?? 0}/dia)</p>
                        </div>
                        <div>
                            <p className={`text-2xl font-black ${(resumo?.bouncesHoje ?? 0) > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                                {resumo?.bouncesHoje ?? 0}<span className="text-sm text-slate-400 font-bold"> ({taxaBounce.toFixed(1)}%)</span>
                            </p>
                            <p className="text-[10px] font-bold uppercase text-slate-400">Bounces hoje</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div>
                                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Pausar em (%)</label>
                                <input type="number" className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                                    value={reputacao?.bounce_max_percentual ?? 5}
                                    onChange={e => reputacao && setReputacao({ ...reputacao, bounce_max_percentual: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Mín. bounces</label>
                                <input type="number" className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                                    value={reputacao?.bounce_min_quantidade ?? 2}
                                    onChange={e => reputacao && setReputacao({ ...reputacao, bounce_min_quantidade: Number(e.target.value) })} />
                            </div>
                            <button onClick={salvarLimitesReputacao} className="mt-4 p-2 text-slate-500 hover:text-[#1B263B]" title="Salvar limites">
                                <Save size={16} />
                            </button>
                        </div>
                        {reputacao?.pausado && (
                            <button onClick={despausarGlobal}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition-all">
                                Despausar tudo
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {feedback && (
                <div className={`rounded-2xl p-4 flex items-center gap-3 text-sm font-medium border ${
                    feedback.tipo === 'ok'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                    {feedback.tipo === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                    {feedback.texto}
                </div>
            )}

            {/* Abas por campanha */}
            <div className="flex flex-wrap gap-2 border-b border-slate-200">
                {campanhas.map(c => (
                    <button key={c.slug} onClick={() => setAbaAtiva(c.slug)}
                        className={`px-5 py-2.5 text-sm font-bold rounded-t-xl transition-all border-b-2 ${
                            abaAtiva === c.slug
                                ? 'border-[#C69C6D] text-[#1B263B] bg-white'
                                : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                        {c.nome}
                        {c.dry_run && <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-xl text-[10px]">dry run</span>}
                        {!c.ativo && <span className="ml-2 px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded-xl text-[10px]">off</span>}
                    </button>
                ))}
            </div>

            {form && (
                <>
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6">
                        <div className="flex flex-wrap items-center gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={form.ativo}
                                    onChange={e => setForm({ ...form, ativo: e.target.checked })}
                                    className="w-4 h-4 accent-[#1B263B]" />
                                <span className="text-sm font-bold text-slate-700">Campanha ligada</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={form.dry_run}
                                    onChange={e => setForm({ ...form, dry_run: e.target.checked })}
                                    className="w-4 h-4 accent-[#1B263B]" />
                                <span className="text-sm font-bold text-slate-700">Modo de teste (dry run)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={form.exigir_cnpj}
                                    onChange={e => setForm({ ...form, exigir_cnpj: e.target.checked })}
                                    className="w-4 h-4 accent-[#1B263B]" />
                                <span className="text-sm font-bold text-slate-700">Exigir CNPJ no site</span>
                            </label>
                            {form.apify_run_id && (
                                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold">
                                    <FlaskConical size={13} /> Garimpando {form.apify_cidade}
                                </span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className={rotulo}>Nome</label>
                                <input className={campo} value={form.nome}
                                    onChange={e => setForm({ ...form, nome: e.target.value })} />
                            </div>
                            <div className="md:col-span-2">
                                <label className={rotulo}>Termos de busca no Maps (separados por vírgula)</label>
                                <input className={campo} value={termosText} onChange={e => setTermosText(e.target.value)} />
                            </div>
                            <div className="md:col-span-3">
                                <label className={rotulo}>Cidades (separadas por ponto e vírgula) — cursor do ciclo: {form.garimpo_cursor}/{(form.cidades ?? []).length}</label>
                                <textarea className={`${campo} h-24`} value={cidadesText} onChange={e => setCidadesText(e.target.value)} />
                            </div>
                            <div className="md:col-span-3">
                                <label className={rotulo}>Palavras de exclusão (ponto e vírgula; aceita "X sem menção a Y")</label>
                                <input className={campo} value={exclusoesText} onChange={e => setExclusoesText(e.target.value)} />
                            </div>
                            <div>
                                <label className={rotulo}>Trilha de e-mail</label>
                                <select className={`${campo} cursor-pointer`} value={form.trilha}
                                    onChange={e => setForm({ ...form, trilha: e.target.value })}>
                                    {trilhas.map(t => <option key={t.slug} value={t.slug}>{t.nome}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={rotulo}>Tipo de prospect (Kanban)</label>
                                <input className={campo} value={form.tipo_prospect}
                                    onChange={e => setForm({ ...form, tipo_prospect: e.target.value })} />
                            </div>
                            <div>
                                <label className={rotulo}>Limite diário de envios</label>
                                <input className={campo} type="number" min={1} value={form.limite_diario}
                                    onChange={e => setForm({ ...form, limite_diario: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label className={rotulo}>Cadência do garimpo (dias)</label>
                                <input className={campo} type="number" min={1} value={form.cadencia_garimpo_dias}
                                    onChange={e => setForm({ ...form, cadencia_garimpo_dias: Number(e.target.value) })} />
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
                            <button onClick={salvar} disabled={saving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-[#1B263B] hover:bg-[#243347] text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50">
                                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar campanha
                            </button>
                            <button onClick={rodarTique} disabled={running}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 hover:border-[#C69C6D] text-slate-700 text-sm font-bold rounded-xl transition-all disabled:opacity-50">
                                {running ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />} Rodar um tique agora
                            </button>
                        </div>
                    </div>

                    {/* Estoque */}
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                        {[
                            ['novo', 'Aguardando enriquecimento'],
                            ['enriquecido', 'Prontos para envio'],
                            ['enviado', 'Enviados'],
                            ['so_whatsapp', 'Só WhatsApp'],
                            ['descartado', 'Descartados'],
                            ['bounce', 'Bounces'],
                        ].map(([estado, label]) => (
                            <div key={estado} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-center">
                                <p className="text-2xl font-black text-slate-800">{estoque[estado] ?? 0}</p>
                                <p className="text-[10px] font-bold uppercase text-slate-400 leading-tight">{label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Execuções */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800">Execuções de {form.nome}</h3>
                        </div>
                        {execucoes.length === 0 ? (
                            <p className="px-6 py-8 text-sm text-slate-400 font-medium">
                                Nenhuma execução ainda. O cron roda a cada 10 minutos entre 08h05 e 11h55, ou use "Rodar um tique agora".
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                                            <th className="px-6 py-3">Dia</th>
                                            <th className="px-3 py-3">Modo</th>
                                            <th className="px-3 py-3 text-right">Garimpados</th>
                                            <th className="px-3 py-3 text-right">Enviados</th>
                                            <th className="px-3 py-3 text-right">Só WhatsApp</th>
                                            <th className="px-3 py-3 text-right">Descartados</th>
                                            <th className="px-3 py-3 text-right">Bounces</th>
                                            <th className="px-6 py-3 text-right">Relatório</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {execucoes.map(ex => (
                                            <tr key={ex.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                                                <td className="px-6 py-3 font-medium text-slate-700">
                                                    {ex.data_referencia.split('-').reverse().join('/')}
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className={`px-2 py-0.5 rounded-xl text-xs font-bold ${ex.dry_run ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                        {ex.dry_run ? 'dry run' : 'real'}
                                                    </span>
                                                    {ex.fase !== 'finalizada' && (
                                                        <span className="ml-1.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold">em andamento</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 text-right text-slate-600">{ex.garimpados}</td>
                                                <td className="px-3 py-3 text-right font-bold text-slate-800">{ex.enviados}</td>
                                                <td className="px-3 py-3 text-right text-slate-600">{ex.so_whatsapp}</td>
                                                <td className="px-3 py-3 text-right text-slate-600">{ex.descartados}</td>
                                                <td className={`px-3 py-3 text-right ${ex.bounces > 0 ? 'font-bold text-rose-600' : 'text-slate-600'}`}>{ex.bounces}</td>
                                                <td className="px-6 py-3 text-right">
                                                    {ex.arquivo_relatorio && (
                                                        <button onClick={() => baixarRelatorio(ex.arquivo_relatorio!)}
                                                            className="inline-flex items-center gap-1.5 text-[#1B263B] hover:text-[#C69C6D] font-bold text-xs transition-colors">
                                                            <Download size={14} /> XLSX
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-xs text-slate-500 leading-relaxed space-y-1">
                <p className="font-bold text-slate-600 text-sm mb-2">Como funciona</p>
                <p>1. O garimpo busca os termos no Google Maps (Apify, US$ 1,50 por 1.000 lugares), cidade a cidade, e guarda tudo no estoque. Só busca de novo quando o estoque baixa ou a cadência vence.</p>
                <p>2. O enriquecimento visita o site de cada lugar, extrai e-mail e CNPJ, valida na BrasilAPI e aplica as exclusões da campanha.</p>
                <p>3. O envio diário respeita o limite da campanha e prioriza e-mail direto, site próprio e mais avaliações. Quem só tem telefone vai para a coluna "Contato por WhatsApp" do Kanban, para a Bruna.</p>
                <p>4. A trilha da campanha recebe as variáveis [CIDADE] e [SITE] para personalizar os e-mails.</p>
                <p>5. Deduplicação por place_id, telefone e e-mail contra o Kanban, a cadência, os parceiros, a lista de bloqueio e as outras campanhas.</p>
            </div>
        </section>
    );
}
