import React, { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2, MessageCircle, Mail, Phone, Inbox, Flag, StickyNote, Bell, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import ModalPortal from './ModalPortal.tsx';
import { hojeSaoPaulo, rotuloDia } from '../lib/contatoLead.ts';
import {
    montarResumo, somarNumeros, limitesDoDia, numerosVazios, SEM_DONO,
    ToqueDia, LeadDia, TarefaDia, NumerosPessoa, ItemDia,
} from '../lib/resumoDoDia.ts';

// Resumo do dia da prospecção: o que cada pessoa fez num dia, com os totais
// da equipe, uma linha por pessoa e a lista do que foi feito. Abre pela
// Agenda e pelo Kanban. As contas ficam em lib/resumoDoDia.ts.

interface Props { onFechar: () => void }

const somarDias = (dia: string, n: number) => {
    const [a, m, d] = dia.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

const ICONE_ITEM: Record<ItemDia['tipo'], React.ElementType> = {
    contato: ClipboardList, recebido: Inbox, encerrado: Flag, observacao: StickyNote, lembrete: Bell,
};
const iconeDoContato = (titulo: string): React.ElementType =>
    titulo.startsWith('WhatsApp') ? MessageCircle : titulo.startsWith('Ligação') ? Phone : Mail;

const ResumoDoDia: React.FC<Props> = ({ onFechar }) => {
    const hoje = hojeSaoPaulo();
    const [dia, setDia] = useState(hoje);
    const [pessoa, setPessoa] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState('');
    const [equipe, setEquipe] = useState<{ email: string; nome: string }[]>([]);
    const [dados, setDados] = useState<{ toques: ToqueDia[]; leads: LeadDia[]; recebidos: LeadDia[]; encerrados: LeadDia[]; comObservacao: LeadDia[]; tarefas: TarefaDia[] }>(
        { toques: [], leads: [], recebidos: [], encerrados: [], comObservacao: [], tarefas: [] });

    useEffect(() => {
        let vivo = true;
        (async () => {
            setCarregando(true);
            setErro('');
            try {
                const { inicio, fim } = limitesDoDia(dia);
                const [aaaa, mm, dd] = dia.split('-');
                const [rT, rR, rE, rO, rTar, rEq] = await Promise.all([
                    supabase.from('prospect_toques').select('prospect_id, canal, resultado, nota, roteiro, autor_email, created_at').gte('created_at', inicio).lt('created_at', fim),
                    supabase.from('prospects').select('id, company, name, responsavel_email, responsavel_em').gte('responsavel_em', inicio).lt('responsavel_em', fim),
                    supabase.from('prospects').select('id, company, name, responsavel_email, encerrado_em, motivo_perda, etapa').gte('encerrado_em', inicio).lt('encerrado_em', fim),
                    supabase.from('prospects').select('id, company, name, responsavel_email, description').ilike('description', `%[${dd}/${mm}/${aaaa}%`),
                    supabase.from('crm_tasks').select('id, title, due_date, status, prospect_id').gte('due_date', inicio).lt('due_date', fim),
                    supabase.from('prospeccao_equipe').select('email, nome, ativo'),
                ]);
                for (const r of [rT, rR, rE, rO, rTar, rEq]) if (r.error) throw r.error;
                const toques = (rT.data || []) as ToqueDia[];
                const tarefas = ((rTar.data || []) as TarefaDia[]);
                const conhecidos = new Set([...(rR.data || []), ...(rE.data || []), ...(rO.data || [])].map((l: any) => l.id));
                const faltam = Array.from(new Set([...toques.map(t => t.prospect_id), ...tarefas.map(t => t.prospect_id)]
                    .filter((id): id is string => !!id && !conhecidos.has(id))));
                let leads: LeadDia[] = [];
                if (faltam.length) {
                    const rL = await supabase.from('prospects').select('id, company, name, responsavel_email').in('id', faltam);
                    if (rL.error) throw rL.error;
                    leads = (rL.data || []) as LeadDia[];
                }
                if (!vivo) return;
                setEquipe(((rEq.data || []) as any[]).filter(e => e.ativo !== false).map(e => ({ email: String(e.email).toLowerCase(), nome: String(e.nome) }))
                    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
                setDados({
                    toques, leads, tarefas,
                    recebidos: (rR.data || []) as LeadDia[],
                    encerrados: (rE.data || []) as LeadDia[],
                    comObservacao: (rO.data || []) as LeadDia[],
                });
            } catch (e) {
                console.error('Erro ao montar o resumo do dia:', e);
                if (vivo) setErro('Não consegui carregar o resumo deste dia.');
            } finally {
                if (vivo) setCarregando(false);
            }
        })();
        return () => { vivo = false; };
    }, [dia]);

    const { porPessoa, itens } = useMemo(() => montarResumo({ dia, ...dados }), [dia, dados]);
    const nomeDe = (email: string) => email === SEM_DONO ? 'Sem dono' : (equipe.find(m => m.email === email)?.nome || email.split('@')[0]);
    // A equipe inteira aparece, mesmo quem zerou o dia; depois quem mais apareceu.
    const pessoas = useMemo(() => {
        const lista = equipe.map(m => m.email);
        for (const p of porPessoa.keys()) if (!lista.includes(p) && p !== SEM_DONO) lista.push(p);
        if (porPessoa.has(SEM_DONO)) lista.push(SEM_DONO);
        return lista;
    }, [equipe, porPessoa]);
    const numerosDe = (p: string): NumerosPessoa => porPessoa.get(p) || numerosVazios();
    const totais = pessoa ? numerosDe(pessoa) : somarNumeros(pessoas.map(numerosDe));
    const itensVisiveis = pessoa ? itens.filter(i => i.pessoa === pessoa) : itens;

    const classeChip = (ativo: boolean) => `px-3 py-1.5 rounded-xl text-[12px] font-bold border transition-colors ${ativo
        ? 'bg-navy text-areia border-navy'
        : 'bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy'}`;
    const cartao = (rotulo: string, valor: React.ReactNode, sub?: string) => (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 min-w-0">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest truncate">{rotulo}</p>
            <p className="text-2xl font-black text-navy leading-tight">{valor}</p>
            {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
        </div>
    );

    return (
        <ModalPortal>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onFechar}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap justify-between items-center gap-3 p-6 border-b border-gold/20 bg-gold/10">
                        <div>
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><ClipboardList size={20} className="text-gold" /> Resumo do dia</h3>
                            <p className="text-sm text-slate-500 font-medium mt-1">O que a equipe fez na prospecção</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setDia(d => somarDias(d, -1))} className="p-2 rounded-xl border border-slate-200 bg-white hover:border-gold/50" aria-label="Dia anterior">
                                <ChevronLeft size={18} className="text-navy" />
                            </button>
                            <input
                                type="date"
                                value={dia}
                                max={hoje}
                                onChange={(e) => e.target.value && setDia(e.target.value)}
                                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-navy outline-none focus:ring-2 focus:ring-gold/20"
                                aria-label="Escolher o dia"
                            />
                            <button type="button" onClick={() => setDia(d => (d >= hoje ? d : somarDias(d, 1)))} disabled={dia >= hoje} className="p-2 rounded-xl border border-slate-200 bg-white hover:border-gold/50 disabled:opacity-40" aria-label="Próximo dia">
                                <ChevronRight size={18} className="text-navy" />
                            </button>
                            {dia !== hoje && (
                                <button type="button" onClick={() => setDia(hoje)} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-navy hover:border-gold/50">Hoje</button>
                            )}
                            <button onClick={onFechar} className="ml-2 w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm" aria-label="Fechar">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scroll p-6 space-y-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => setPessoa('')} className={classeChip(!pessoa)}>Equipe toda</button>
                            {pessoas.map(p => (
                                <button key={p} type="button" onClick={() => setPessoa(p)} className={classeChip(pessoa === p)}>{nomeDe(p)}</button>
                            ))}
                            <span className="ml-auto text-[12px] font-bold text-slate-500">{rotuloDia(dia)}{dia === hoje ? ' · hoje' : ''}</span>
                        </div>

                        {carregando ? (
                            <p className="text-sm text-slate-400 flex items-center gap-2 py-6"><Loader2 size={16} className="animate-spin" /> Carregando o dia</p>
                        ) : erro ? (
                            <p className="text-sm font-bold text-rose-600">{erro}</p>
                        ) : (
                            <>
                                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                                    {cartao('Contatos', totais.contatos, `WhatsApp ${totais.porCanal.whatsapp} · E-mail ${totais.porCanal.email} · Ligação ${totais.porCanal.ligacao}`)}
                                    {cartao('Responderam', totais.comResposta, `Não atendeu ${totais.naoAtendeu}`)}
                                    {cartao('Cotações pedidas', totais.cotacoes)}
                                    {cartao('Leads recebidos', totais.recebidos, 'Pegos da fila ou passados')}
                                    {cartao('Encerrados', totais.encerrados, `Sem interesse ${totais.semInteresse}`)}
                                    {cartao('Lembretes', `${totais.lembretesFeitos}/${totais.lembretes}`, 'Concluídos no dia')}
                                </div>

                                {!pessoa && (
                                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                                        <table className="w-full text-sm">
                                            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                                                <tr>
                                                    {['Pessoa', 'Contatos', 'WhatsApp', 'E-mail', 'Ligação', 'Responderam', 'Cotações', 'Não atendeu', 'Recebidos', 'Encerrados', 'Observações', 'Lembretes'].map(c => (
                                                        <th key={c} className={`px-2.5 py-2 ${c === 'Pessoa' ? 'text-left' : 'text-right'} whitespace-nowrap`}>{c}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pessoas.map(p => {
                                                    const n = numerosDe(p);
                                                    const zerado = !n.contatos && !n.recebidos && !n.encerrados && !n.observacoes && !n.lembretes;
                                                    return (
                                                        <tr key={p} onClick={() => setPessoa(p)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" title="Ver só esta pessoa">
                                                            <td className={`px-2.5 py-2 font-bold whitespace-nowrap ${zerado ? 'text-slate-400' : 'text-navy'}`}>{nomeDe(p)}</td>
                                                            {[n.contatos, n.porCanal.whatsapp, n.porCanal.email, n.porCanal.ligacao, n.comResposta, n.cotacoes, n.naoAtendeu, n.recebidos, n.encerrados, n.observacoes].map((v, i) => (
                                                                <td key={i} className={`px-2.5 py-2 text-right tabular-nums ${v ? 'text-slate-700 font-bold' : 'text-slate-300'}`}>{v}</td>
                                                            ))}
                                                            <td className={`px-2.5 py-2 text-right tabular-nums ${n.lembretes ? 'text-slate-700 font-bold' : 'text-slate-300'}`}>{n.lembretesFeitos}/{n.lembretes}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                <section className="space-y-2">
                                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">O que foi feito · {itensVisiveis.length}</h4>
                                    {itensVisiveis.length === 0 ? (
                                        <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-4">Nada registrado neste dia{pessoa ? ` por ${nomeDe(pessoa)}` : ''}.</p>
                                    ) : (
                                        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                                            {itensVisiveis.map(i => {
                                                const Icone = i.tipo === 'contato' ? iconeDoContato(i.titulo) : ICONE_ITEM[i.tipo];
                                                const tom = i.tipo === 'encerrado' ? 'text-amber-700 bg-amber-50 border-amber-200'
                                                    : i.titulo.includes('respondeu') || i.titulo.includes('conversou') || i.titulo.includes('cotação') ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                                    : 'text-slate-500 bg-white border-slate-200';
                                                return (
                                                    <li key={i.chave} className="flex items-start gap-3 px-4 py-2.5">
                                                        <span className="text-[12px] font-bold text-slate-400 tabular-nums w-11 shrink-0 pt-1">{hora(i.em)}</span>
                                                        <span className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center ${tom}`}><Icone size={13} /></span>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[13px] text-slate-700">
                                                                <span className="font-bold">{i.titulo}</span>
                                                                <span className="text-slate-400"> · </span>
                                                                <span className="font-bold text-navy">{i.lead}</span>
                                                                {!pessoa && <span className="text-slate-400"> · {nomeDe(i.pessoa)}</span>}
                                                            </p>
                                                            {i.detalhe && <p className="text-[12px] text-slate-500 break-words whitespace-pre-wrap line-clamp-3">{i.detalhe}</p>}
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                    <p className="text-[11px] text-slate-400">
                                        Contatos contam para quem registrou. Recebidos, encerrados, observações e lembretes contam para o dono do lead (a observação não guarda quem escreveu).
                                    </p>
                                </section>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};

export default ResumoDoDia;
