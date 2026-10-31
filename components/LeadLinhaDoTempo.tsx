import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Mail, Phone, StickyNote, AlertTriangle, Flag, Send, Loader2, History } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Prospect } from '../types';
import {
    montarLinhaDoTempo, EventoLinha, TipoEvento, IconeEvento,
    ToqueCompleto, ContatoTrilha, EnvioTrilha, EtapaTrilha, Observacao,
} from '../lib/linhaDoTempo.ts';
import { rotuloDia } from '../lib/contatoLead.ts';

// Linha do tempo do lead, na ficha: contatos registrados, e-mails das
// trilhas, observações e marcos, do mais recente para o mais antigo.
// As regras de montagem ficam em lib/linhaDoTempo.ts.

interface Props {
    lead: Prospect;
    /** Observações da ficha já lidas (inclui as acabadas de adicionar). */
    observacoes: Observacao[];
    nomeDe: (email: string | null) => string;
    /** Muda quando um contato novo é registrado, para recarregar. */
    versao?: number;
}

type Filtro = 'todos' | Exclude<TipoEvento, 'marco'>;
const FILTROS: { id: Filtro; rotulo: string }[] = [
    { id: 'todos', rotulo: 'Tudo' },
    { id: 'contato', rotulo: 'Contatos' },
    { id: 'email', rotulo: 'E-mails' },
    { id: 'nota', rotulo: 'Notas' },
];
const LIMITE_INICIAL = 12;

const ICONE: Record<IconeEvento, React.ElementType> = {
    whatsapp: MessageCircle, email: Mail, ligacao: Phone, nota: StickyNote,
    alerta: AlertTriangle, marco: Flag, trilha: Send,
};
const COR_ICONE: Record<EventoLinha['tom'], string> = {
    normal: 'bg-white text-slate-500 border-slate-200',
    alerta: 'bg-amber-50 text-amber-700 border-amber-200',
    sucesso: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const quando = (ev: EventoLinha): string => {
    const d = new Date(ev.em);
    if (Number.isNaN(d.getTime())) return '';
    const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    if (ev.soData) return rotuloDia(dia);
    const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${rotuloDia(dia)} · ${hora}`;
};

const LeadLinhaDoTempo: React.FC<Props> = ({ lead, observacoes, nomeDe, versao = 0 }) => {
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState('');
    const [dados, setDados] = useState<{ toques: ToqueCompleto[]; contatos: ContatoTrilha[]; envios: EnvioTrilha[]; etapas: EtapaTrilha[] }>(
        { toques: [], contatos: [], envios: [], etapas: [] });
    const [filtro, setFiltro] = useState<Filtro>('todos');
    const [verTudo, setVerTudo] = useState(false);
    const [abertos, setAbertos] = useState<Set<string>>(new Set());

    useEffect(() => {
        let vivo = true;
        (async () => {
            setCarregando(true);
            setErro('');
            try {
                const [rToques, rContatos] = await Promise.all([
                    supabase.from('prospect_toques')
                        .select('created_at, canal, resultado, roteiro, assunto, mensagem, nota, proximo_passo, autor_email')
                        .eq('prospect_id', lead.id),
                    supabase.from('email_cadencia')
                        .select('id, trilha, nome_empresa, email, bounce_status, bounce_motivo, bounce_em')
                        .eq('prospect_id', lead.id),
                ]);
                if (rToques.error) throw rToques.error;
                if (rContatos.error) throw rContatos.error;
                const contatos = (rContatos.data || []) as ContatoTrilha[];
                const ids = contatos.map(c => c.id);
                const trilhas = [...new Set(contatos.map(c => c.trilha).filter(Boolean))] as string[];
                const [rEnvios, rEtapas] = await Promise.all([
                    ids.length
                        ? supabase.from('email_envios').select('contato_id, ordem, enviado_em').in('contato_id', ids)
                        : Promise.resolve({ data: [], error: null }),
                    trilhas.length
                        ? supabase.from('email_trilha_etapas').select('trilha, ordem, assunto').in('trilha', trilhas)
                        : Promise.resolve({ data: [], error: null }),
                ]);
                if (rEnvios.error) throw rEnvios.error;
                if (rEtapas.error) throw rEtapas.error;
                if (!vivo) return;
                setDados({
                    toques: (rToques.data || []) as ToqueCompleto[],
                    contatos,
                    envios: (rEnvios.data || []) as EnvioTrilha[],
                    etapas: (rEtapas.data || []) as EtapaTrilha[],
                });
            } catch (e) {
                console.error('Erro ao montar a linha do tempo:', e);
                if (vivo) setErro('Não consegui carregar o histórico deste lead.');
            } finally {
                if (vivo) setCarregando(false);
            }
        })();
        return () => { vivo = false; };
    }, [lead.id, versao]);

    const eventos = useMemo(
        () => montarLinhaDoTempo({ lead, ...dados, observacoes, nomeDe }),
        [lead, dados, observacoes, nomeDe],
    );
    const contagem = useMemo(() => {
        const c: Record<Filtro, number> = { todos: eventos.length, contato: 0, email: 0, nota: 0 };
        for (const e of eventos) if (e.tipo !== 'marco') c[e.tipo] += 1;
        return c;
    }, [eventos]);
    const filtrados = filtro === 'todos' ? eventos : eventos.filter(e => e.tipo === filtro);
    const visiveis = verTudo ? filtrados : filtrados.slice(0, LIMITE_INICIAL);

    const alternar = (chave: string) => setAbertos(prev => {
        const novo = new Set(prev);
        if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
        return novo;
    });

    return (
        <section className="space-y-3">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <History size={14} /> Linha do tempo
            </h4>

            <div className="flex flex-wrap gap-1.5">
                {FILTROS.map(f => (
                    <button
                        key={f.id}
                        type="button"
                        onClick={() => { setFiltro(f.id); setVerTudo(false); }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${filtro === f.id
                            ? 'bg-navy text-areia border-navy'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy'}`}
                    >
                        {f.rotulo} · {contagem[f.id]}
                    </button>
                ))}
            </div>

            {carregando ? (
                <p className="text-xs text-slate-400 flex items-center gap-2 py-2"><Loader2 size={14} className="animate-spin" /> Carregando o histórico</p>
            ) : erro ? (
                <p className="text-xs font-bold text-rose-600">{erro}</p>
            ) : filtrados.length === 0 ? (
                <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    {filtro === 'todos' ? 'Nada registrado ainda.' : 'Nada deste tipo registrado ainda.'}
                </p>
            ) : (
                <ol className="relative">
                    {visiveis.map((ev, i) => {
                        const Icone = ICONE[ev.icone];
                        const ultimo = i === visiveis.length - 1;
                        const aberto = abertos.has(ev.chave);
                        const ehNota = ev.tipo === 'nota';
                        const notaLonga = ehNota && !!ev.texto && ev.texto.length > 180;
                        return (
                            <li key={ev.chave} className="relative flex gap-3 pb-4">
                                {!ultimo && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-slate-200" aria-hidden />}
                                <span className={`relative z-10 shrink-0 w-7 h-7 rounded-full border flex items-center justify-center ${COR_ICONE[ev.tom]}`}>
                                    <Icone size={13} />
                                </span>
                                <div className="min-w-0 flex-1 pt-0.5">
                                    <p className="text-[11px] font-bold text-slate-400">
                                        {quando(ev)}{ev.autor ? ` · ${ev.autor}` : ''}
                                    </p>
                                    <p className="text-[13px] font-bold text-slate-700 leading-snug">{ev.titulo}</p>
                                    {ev.detalhes.map((d, j) => (
                                        <p key={j} className="text-[12px] text-slate-500 leading-snug break-words">{d}</p>
                                    ))}
                                    {ev.texto && ehNota && (
                                        <>
                                            <p className={`text-[12px] text-slate-600 leading-snug whitespace-pre-wrap break-words ${notaLonga && !aberto ? 'line-clamp-4' : ''}`}>
                                                {ev.texto}
                                            </p>
                                            {notaLonga && (
                                                <button type="button" onClick={() => alternar(ev.chave)} className="mt-0.5 text-[11px] font-bold text-blue-700 hover:underline">
                                                    {aberto ? 'Mostrar menos' : 'Ver observação inteira'}
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {ev.texto && !ehNota && (
                                        <>
                                            {aberto && (
                                                <p className="mt-1 text-[12px] text-slate-600 leading-snug whitespace-pre-wrap break-words rounded-lg bg-slate-50 border border-slate-200 p-2">
                                                    {ev.texto}
                                                </p>
                                            )}
                                            <button type="button" onClick={() => alternar(ev.chave)} className="mt-0.5 text-[11px] font-bold text-blue-700 hover:underline">
                                                {aberto ? 'Esconder texto' : 'Ver o texto enviado'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}

            {!carregando && !erro && filtrados.length > LIMITE_INICIAL && (
                <button type="button" onClick={() => setVerTudo(v => !v)} className="text-[12px] font-bold text-navy hover:text-gold-dark">
                    {verTudo ? 'Mostrar menos' : `Ver tudo (${filtrados.length})`}
                </button>
            )}
        </section>
    );
};

export default LeadLinhaDoTempo;
