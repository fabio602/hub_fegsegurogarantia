import React, { useCallback, useEffect, useState } from 'react';
import {
    Loader2, Play, Save, Download, AlertTriangle, CheckCircle2,
    PauseCircle, FlaskConical, Bot,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/formatters';
import type { ProspeccaoPncpConfig, ProspeccaoPncpExecucao } from '../types';

interface TrilhaOption { slug: string; nome: string; }

/**
 * Prospecção Automática PNCP: configuração dos filtros, execuções e relatórios.
 *
 * O motor roda todo dia às 07h (pg_cron chama a Edge Function prospeccao-pncp).
 * Esta tela só edita a configuração e mostra o histórico; nenhuma lógica de
 * coleta mora aqui.
 */
export default function ProspeccaoPncpAuto() {
    const [config, setConfig] = useState<ProspeccaoPncpConfig | null>(null);
    const [execucoes, setExecucoes] = useState<ProspeccaoPncpExecucao[]>([]);
    const [trilhas, setTrilhas] = useState<TrilhaOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

    // Campos de lista editados como texto (separado por vírgula).
    const [ufsText, setUfsText] = useState('');
    const [incluirText, setIncluirText] = useState('');
    const [excluirText, setExcluirText] = useState('');
    const [contadorText, setContadorText] = useState('');
    const [genericosText, setGenericosText] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: cfg }, { data: execs }, { data: trilhasData }] = await Promise.all([
            supabase.from('prospeccao_pncp_config').select('*').eq('id', 1).single(),
            supabase.from('prospeccao_pncp_execucoes').select('*').order('executado_em', { ascending: false }).limit(30),
            supabase.from('email_trilhas').select('slug, nome').eq('ativo', true).order('ordem'),
        ]);
        if (cfg) {
            setConfig(cfg);
            setUfsText((cfg.ufs ?? []).join(', '));
            setIncluirText((cfg.cnae_divisoes_incluir ?? []).join(', '));
            setExcluirText((cfg.cnae_divisoes_excluir ?? []).join(', '));
            setContadorText((cfg.email_padroes_contador ?? []).join(', '));
            setGenericosText((cfg.email_prefixos_genericos ?? []).join(', '));
        }
        setExecucoes(execs ?? []);
        setTrilhas(trilhasData ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const parseLista = (t: string) =>
        t.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    // Padrões de e-mail são comparados em minúsculas, ao contrário de UFs/CNAEs.
    const parseListaMinuscula = (t: string) =>
        t.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const salvar = async () => {
        if (!config) return;
        setSaving(true);
        setFeedback(null);
        const { error } = await supabase.from('prospeccao_pncp_config').update({
            ativo: config.ativo,
            dry_run: config.dry_run,
            pausado: config.pausado,
            pausado_motivo: config.pausado ? config.pausado_motivo : null,
            pausado_em: config.pausado ? config.pausado_em : null,
            ufs: parseLista(ufsText),
            valor_minimo: config.valor_minimo,
            dispensa_inexig_valor_minimo: config.dispensa_inexig_valor_minimo,
            cnae_divisoes_incluir: parseLista(incluirText),
            cnae_divisoes_excluir: parseLista(excluirText),
            limite_diario: config.limite_diario,
            max_consultas_brasilapi: config.max_consultas_brasilapi,
            pausa_entre_consultas_ms: config.pausa_entre_consultas_ms,
            bounce_max_percentual: config.bounce_max_percentual,
            bounce_min_quantidade: config.bounce_min_quantidade,
            trilha: config.trilha,
            email_relatorio: config.email_relatorio,
            email_padroes_contador: parseListaMinuscula(contadorText),
            email_prefixos_genericos: parseListaMinuscula(genericosText),
            fila_validade_dias: config.fila_validade_dias,
            updated_at: new Date().toISOString(),
        }).eq('id', 1);
        setSaving(false);
        setFeedback(error
            ? { tipo: 'erro', texto: `Falha ao salvar: ${error.message}` }
            : { tipo: 'ok', texto: 'Configuração salva.' });
        if (!error) load();
    };

    const rodarDryRun = async () => {
        setRunning(true);
        setFeedback(null);
        try {
            const { data, error } = await supabase.functions.invoke('prospeccao-pncp', {
                body: { dry_run: true },
            });
            if (error) throw new Error(error.message);
            if (data?.success === false) throw new Error(data?.error || 'falha na execução');
            // A função roda em background (leva alguns minutos por causa do
            // rate limit das APIs de e-mail). A lista abaixo é recarregada
            // algumas vezes para o resultado aparecer sozinho.
            setFeedback({
                tipo: 'ok',
                texto: 'Lote de dry run iniciado. Cada lote processa o que cabe em ~2 minutos; o cron continua os demais lotes a cada 10 minutos e o relatório chega por e-mail quando o dia fechar.',
            });
            [30, 90, 180, 300].forEach(s => setTimeout(load, s * 1000));
        } catch (e: any) {
            setFeedback({ tipo: 'erro', texto: `Dry run falhou: ${e?.message || e}` });
        }
        setRunning(false);
        load();
    };

    const despausar = async () => {
        if (!config) return;
        const { error } = await supabase.from('prospeccao_pncp_config').update({
            pausado: false, pausado_motivo: null, pausado_em: null,
        }).eq('id', 1);
        if (!error) {
            setConfig({ ...config, pausado: false, pausado_motivo: null, pausado_em: null });
            setFeedback({ tipo: 'ok', texto: 'Automação despausada. Volta a rodar no próximo ciclo das 07h.' });
        }
    };

    const baixarRelatorio = async (caminho: string) => {
        const { data, error } = await supabase.storage.from('prospeccao-pncp').createSignedUrl(caminho, 120);
        if (error || !data?.signedUrl) {
            setFeedback({ tipo: 'erro', texto: `Não consegui gerar o link do arquivo: ${error?.message}` });
            return;
        }
        window.open(data.signedUrl, '_blank');
    };

    if (loading) {
        return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-gold" size={32} /></div>;
    }
    if (!config) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-800 font-medium">
                Configuração não encontrada. Rode a migração 033_prospeccao_pncp_auto.sql no Supabase.
            </div>
        );
    }

    const campo = 'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all';
    const rotulo = 'block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';

    return (
        <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col lg:flex-row justify-between gap-4 items-start">
                <div>
                    <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3">
                        <Bot className="text-gold" size={30} /> Prospecção Automática PNCP
                    </h2>
                    <p className="text-slate-500 font-medium">
                        Todo dia às 07h: vencedores de licitação do dia anterior entram na trilha de e-mail.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {config.dry_run && (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
                            <FlaskConical size={14} /> Dry run: nenhum e-mail sai para leads
                        </span>
                    )}
                    {config.pausado && (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                            <PauseCircle size={14} /> Pausada por bounce
                        </span>
                    )}
                    {!config.ativo && (
                        <span className="px-3 py-1.5 bg-slate-200 text-slate-600 rounded-full text-xs font-bold">Desligada</span>
                    )}
                </div>
            </div>

            {config.pausado && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
                        <div>
                            <p className="font-bold text-red-800 text-sm">Automação pausada pela proteção de reputação</p>
                            <p className="text-red-700 text-sm mt-1">{config.pausado_motivo}</p>
                        </div>
                    </div>
                    <button onClick={despausar} className="shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-all">
                        Despausar
                    </button>
                </div>
            )}

            {feedback && (
                <div className={`rounded-2xl p-4 flex items-center gap-3 text-sm font-medium border ${
                    feedback.tipo === 'ok'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {feedback.tipo === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                    {feedback.texto}
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-6">
                <div className="flex flex-wrap items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={config.ativo}
                            onChange={e => setConfig({ ...config, ativo: e.target.checked })}
                            className="w-4 h-4 accent-navy" />
                        <span className="text-sm font-bold text-slate-700">Automação ligada</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={config.dry_run}
                            onChange={e => setConfig({ ...config, dry_run: e.target.checked })}
                            className="w-4 h-4 accent-navy" />
                        <span className="text-sm font-bold text-slate-700">Modo de teste (dry run)</span>
                    </label>
                    <span className="text-xs text-slate-400">
                        No dry run tudo roda e o relatório chega por e-mail, mas nenhum lead entra no Kanban nem recebe e-mail.
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className={rotulo}>UFs (vazio = todas)</label>
                        <input className={campo} value={ufsText} onChange={e => setUfsText(e.target.value)} placeholder="SP, RJ, MG" />
                    </div>
                    <div>
                        <label className={rotulo}>Valor mínimo do contrato (R$)</label>
                        <input className={campo} type="number" value={config.valor_minimo}
                            onChange={e => setConfig({ ...config, valor_minimo: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label className={rotulo}>Dispensa/inexigibilidade só acima de (R$)</label>
                        <input className={campo} type="number" value={config.dispensa_inexig_valor_minimo}
                            onChange={e => setConfig({ ...config, dispensa_inexig_valor_minimo: Number(e.target.value) })} />
                    </div>
                    <div className="md:col-span-2">
                        <label className={rotulo}>Divisões CNAE incluídas</label>
                        <input className={campo} value={incluirText} onChange={e => setIncluirText(e.target.value)} placeholder="41, 42, 43, 71..." />
                    </div>
                    <div>
                        <label className={rotulo}>Divisões CNAE excluídas</label>
                        <input className={campo} value={excluirText} onChange={e => setExcluirText(e.target.value)} placeholder="86, 85, 56..." />
                    </div>
                    <div>
                        <label className={rotulo}>Limite de empresas novas por dia</label>
                        <input className={campo} type="number" value={config.limite_diario}
                            onChange={e => setConfig({ ...config, limite_diario: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label className={rotulo}>Teto de consultas BrasilAPI por dia</label>
                        <input className={campo} type="number" value={config.max_consultas_brasilapi}
                            onChange={e => setConfig({ ...config, max_consultas_brasilapi: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label className={rotulo}>Pausa entre consultas (ms)</label>
                        <input className={campo} type="number" value={config.pausa_entre_consultas_ms}
                            onChange={e => setConfig({ ...config, pausa_entre_consultas_ms: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label className={rotulo}>Pausar com bounce acima de (%)</label>
                        <input className={campo} type="number" value={config.bounce_max_percentual}
                            onChange={e => setConfig({ ...config, bounce_max_percentual: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label className={rotulo}>Mínimo de bounces para pausar</label>
                        <input className={campo} type="number" value={config.bounce_min_quantidade}
                            onChange={e => setConfig({ ...config, bounce_min_quantidade: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label className={rotulo}>Trilha de e-mail</label>
                        <select className={`${campo} cursor-pointer`} value={config.trilha}
                            onChange={e => setConfig({ ...config, trilha: e.target.value })}>
                            {trilhas.map(t => <option key={t.slug} value={t.slug}>{t.nome}</option>)}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label className={rotulo}>E-mail marcado como "contador" quando contiver</label>
                        <input className={campo} value={contadorText} onChange={e => setContadorText(e.target.value)} placeholder="contab, contabil, itax..." />
                    </div>
                    <div>
                        <label className={rotulo}>Prefixos de e-mail "genérico corporativo"</label>
                        <input className={campo} value={genericosText} onChange={e => setGenericosText(e.target.value)} placeholder="fiscal, juridico, dl-..." />
                    </div>
                    <div>
                        <label className={rotulo}>Validade da fila (dias)</label>
                        <input className={campo} type="number" min={1} value={config.fila_validade_dias}
                            onChange={e => setConfig({ ...config, fila_validade_dias: Number(e.target.value) })} />
                    </div>
                    <div className="md:col-span-2">
                        <label className={rotulo}>E-mail do relatório diário</label>
                        <input className={campo} type="email" value={config.email_relatorio}
                            onChange={e => setConfig({ ...config, email_relatorio: e.target.value })} />
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
                    <button onClick={salvar} disabled={saving}
                        className="flex items-center gap-2 px-5 py-2.5 bg-navy hover:bg-navy-light text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50">
                        {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar configuração
                    </button>
                    <button onClick={rodarDryRun} disabled={running}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 hover:border-gold text-slate-700 text-sm font-bold rounded-xl transition-all disabled:opacity-50">
                        {running ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
                        {running ? 'Rodando (pode levar minutos)...' : 'Rodar agora em dry run'}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800">Execuções</h3>
                </div>
                {execucoes.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-slate-400 font-medium">Nenhuma execução ainda. A primeira roda no próximo ciclo das 07h, ou use o dry run acima.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                                    <th className="px-6 py-3">Execução</th>
                                    <th className="px-3 py-3">Referência</th>
                                    <th className="px-3 py-3">Modo</th>
                                    <th className="px-3 py-3 text-right">Coletados</th>
                                    <th className="px-3 py-3 text-right">Consultas</th>
                                    <th className="px-3 py-3 text-right">Enviados</th>
                                    <th className="px-3 py-3 text-right">Sem e-mail</th>
                                    <th className="px-3 py-3 text-right">Fora do perfil</th>
                                    <th className="px-3 py-3 text-right">Bounces</th>
                                    <th className="px-3 py-3 text-right">Erros</th>
                                    <th className="px-6 py-3 text-right">Relatório</th>
                                </tr>
                            </thead>
                            <tbody>
                                {execucoes.map(ex => (
                                    <tr key={ex.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                                        <td className="px-6 py-3 font-medium text-slate-700">
                                            {new Date(ex.executado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                        </td>
                                        <td className="px-3 py-3 text-slate-500">{ex.data_referencia.split('-').reverse().join('/')}</td>
                                        <td className="px-3 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${ex.dry_run ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                {ex.dry_run ? 'dry run' : 'real'}
                                            </span>
                                            {ex.fase !== 'finalizada' && (
                                                <span className="ml-1.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">em andamento</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-right text-slate-600">{ex.coletados}</td>
                                        <td className="px-3 py-3 text-right text-slate-600">{ex.enriquecidos}</td>
                                        <td className="px-3 py-3 text-right font-bold text-slate-800">{ex.enviados}</td>
                                        <td className="px-3 py-3 text-right text-slate-600">{ex.sem_email}</td>
                                        <td className="px-3 py-3 text-right text-slate-600">{ex.fora_do_perfil}</td>
                                        <td className={`px-3 py-3 text-right ${ex.bounces > 0 ? 'font-bold text-red-600' : 'text-slate-600'}`}>{ex.bounces}</td>
                                        <td className={`px-3 py-3 text-right ${ex.erros > 0 ? 'font-bold text-amber-600' : 'text-slate-600'}`}>{ex.erros}</td>
                                        <td className="px-6 py-3 text-right">
                                            {ex.arquivo_relatorio && (
                                                <button onClick={() => baixarRelatorio(ex.arquivo_relatorio!)}
                                                    className="inline-flex items-center gap-1.5 text-navy hover:text-gold font-bold text-xs transition-colors">
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

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-xs text-slate-500 leading-relaxed space-y-1">
                <p className="font-bold text-slate-600 text-sm mb-2">Como funciona</p>
                <p>1. Coleta os contratos publicados no PNCP no dia anterior e filtra por valor mínimo ({formatCurrency(config.valor_minimo)}), UF e modalidade.</p>
                <p>2. Enriquece os CNPJs (maiores contratos primeiro): cadastro e CNAE pela BrasilAPI, e-mail pela CNPJá aberta com fallback no cnpj.ws. As APIs de e-mail têm rate limit baixo, então o que não couber no tempo de uma execução fica para o dia seguinte, sem repetir consulta já feita.</p>
                <p>3. Deduplica contra o Kanban, a carteira, os leads PNCP manuais e a lista de bloqueio. CNPJs que a janela do dia não alcançou entram como primeiros da fila do dia seguinte, dentro da validade configurada.</p>
                <p>4. Insere os aprovados em Novos Leads e dispara o primeiro e-mail da trilha existente. Bounce permanente ou spam tira o lead da trilha, bloqueia o e-mail e move o card para "Sem e-mail válido"; clique no e-mail move para "Em contato".</p>
                <p>5. O relatório XLSX do dia fica no bucket prospeccao-pncp e chega no seu e-mail com o resumo.</p>
                <p className="pt-1 text-slate-400">Item aberto: detectar resposta de e-mail (Resend Inbound) ainda não está configurado; hoje a trilha é interrompida por clique ou manualmente.</p>
            </div>
        </section>
    );
}
