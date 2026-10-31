import React, { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, MessageCircle, Mail, Phone, CalendarDays } from 'lucide-react';
import { Prospect, ResultadoContato } from '../types';
import ModalPortal from './ModalPortal.tsx';
import {
    CanalContato, RESULTADOS_POR_CANAL, ROTULO_RESULTADO, RESULTADOS_COM_RESPOSTA, DIAS_PADRAO,
    TENTATIVAS_PARA_DESISTIR, JANELA_DESISTENCIA_DIAS, ROTULO_ETAPA,
    etapaAposResultado, hojeSaoPaulo, somarDiasUteis, rotuloDia,
} from '../lib/contatoLead.ts';

// "Como foi?": o registro do contato no card. Um clique no resultado, um no
// próximo passo (já vem sugerido) e Salvar. O resultado decide a etapa do
// lead e o próximo passo decide quando ele volta para "Retomar".

export interface DadosContato {
    canal: CanalContato;
    resultado: ResultadoContato;
    proximoPasso: string | null;
    nota: string;
    assunto: string;
    encerrarSemRetorno: boolean;
}

/** O que já se sabe do contato quando o modal abre (ex.: vindo do roteiro). */
export interface ContextoContato {
    resultado?: ResultadoContato;
    roteiro?: string | null;
    assunto?: string;
    mensagem?: string;
}

interface Props {
    lead: Prospect;
    canal: CanalContato;
    inicial?: ContextoContato;
    /** Tentativas sem resposta já registradas na janela da regra de desistência. */
    tentativasSemResposta: number;
    salvando: boolean;
    onSalvar: (dados: DadosContato) => void;
    onFechar: () => void;
}

const ROTULO_CANAL: Record<CanalContato, string> = { whatsapp: 'WhatsApp', email: 'E-mail', ligacao: 'Ligação' };
const OPCOES_DIAS = [
    { dias: 1, rotulo: 'Próximo dia útil' },
    { dias: 3, rotulo: 'Em 3 dias úteis' },
    { dias: 5, rotulo: 'Em 1 semana' },
];

const KanbanComoFoiModal: React.FC<Props> = ({ lead, canal, inicial, tentativasSemResposta, salvando, onSalvar, onFechar }) => {
    const hoje = hojeSaoPaulo();
    const padraoDoCanal: ResultadoContato | null = inicial?.resultado ?? (canal === 'ligacao' ? null : 'enviado');
    const [resultado, setResultado] = useState<ResultadoContato | null>(padraoDoCanal);
    const [proximo, setProximo] = useState<string | null>(() => {
        const dias = padraoDoCanal ? DIAS_PADRAO[padraoDoCanal] : null;
        return dias ? somarDiasUteis(hoje, dias) : null;
    });
    // Depois que a pessoa escolhe o próximo passo, trocar o resultado não mexe mais nele.
    const [proximoTocado, setProximoTocado] = useState(false);
    const [nota, setNota] = useState('');
    const [assunto, setAssunto] = useState(inicial?.assunto || '');
    const [encerrar, setEncerrar] = useState(false);
    const [erro, setErro] = useState('');

    useEffect(() => {
        if (!resultado || proximoTocado) return;
        const dias = DIAS_PADRAO[resultado];
        setProximo(dias ? somarDiasUteis(hoje, dias) : null);
    }, [resultado]);

    const escolherProximo = (valor: string | null) => {
        setProximoTocado(true);
        setProximo(valor);
        setErro('');
    };

    const semResposta = !!resultado && !RESULTADOS_COM_RESPOSTA.includes(resultado) && resultado !== 'sem_interesse';
    const numeroTentativa = tentativasSemResposta + 1;
    const sugereDesistir = semResposta && numeroTentativa >= TENTATIVAS_PARA_DESISTIR;
    const vaiEncerrar = resultado === 'sem_interesse' || (sugereDesistir && encerrar);
    const etapaNova = resultado ? (vaiEncerrar ? 'perdido' : etapaAposResultado(lead.etapa, resultado)) : null;
    const etapaAtual = lead.etapa && lead.etapa !== 'ganho' && lead.etapa !== 'perdido' ? lead.etapa : 'contatar';

    const salvar = () => {
        if (!resultado) { setErro('Escolha como foi o contato.'); return; }
        if (!vaiEncerrar && resultado === 'pediu_retorno' && !proximo) { setErro('Escolha o dia que ele pediu para retornar.'); return; }
        onSalvar({
            canal,
            resultado,
            proximoPasso: vaiEncerrar ? null : proximo,
            nota: nota.trim(),
            assunto: assunto.trim(),
            encerrarSemRetorno: sugereDesistir && encerrar,
        });
    };

    const Icone = canal === 'whatsapp' ? MessageCircle : canal === 'ligacao' ? Phone : Mail;
    const classeChip = (ativo: boolean) =>
        `px-3 py-1.5 rounded-xl text-[12px] font-bold border transition-colors ${ativo
            ? 'bg-navy text-areia border-navy'
            : 'bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy'}`;
    const classeCampo = 'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all';
    const opcaoAtiva = (dias: number) => proximo === somarDiasUteis(hoje, dias);
    const dataLivre = !!proximo && !OPCOES_DIAS.some(o => opcaoAtiva(o.dias));

    return (
        <ModalPortal>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                onClick={onFechar}
            >
                <div
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center p-6 border-b border-gold/20 bg-gold/10">
                        <div className="min-w-0">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <Icone size={20} className="text-gold" /> {ROTULO_CANAL[canal]} · como foi?
                            </h3>
                            <p className="text-sm text-slate-500 font-medium mt-1 truncate">
                                {lead.company || lead.name}{lead.decisor && lead.decisor !== 'nan' ? ` · ${lead.decisor}` : ''}
                            </p>
                        </div>
                        <button onClick={onFechar} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm shrink-0">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scroll p-6 space-y-5">
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-slate-700">Resultado</p>
                            <div className="flex flex-wrap gap-2">
                                {RESULTADOS_POR_CANAL[canal].map(r => (
                                    <button key={r} type="button" onClick={() => { setResultado(r); setErro(''); }} className={classeChip(resultado === r)}>
                                        {ROTULO_RESULTADO[r]}
                                    </button>
                                ))}
                            </div>
                            {etapaNova && (
                                <p className="text-[12px] text-slate-500">
                                    {etapaNova === etapaAtual
                                        ? <>Continua em <span className="font-bold text-slate-700">{ROTULO_ETAPA[etapaNova]}</span></>
                                        : <>Etapa: {ROTULO_ETAPA[etapaAtual]} → <span className="font-bold text-slate-700">{ROTULO_ETAPA[etapaNova]}</span></>}
                                </p>
                            )}
                        </div>

                        {sugereDesistir && (
                            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={encerrar}
                                    onChange={(e) => setEncerrar(e.target.checked)}
                                    className="mt-0.5 w-4 h-4 rounded border-amber-300 text-navy focus:ring-gold/30 cursor-pointer"
                                />
                                <span className="text-[12px] text-amber-800">
                                    <span className="font-bold flex items-center gap-1.5"><AlertTriangle size={13} /> {numeroTentativa}ª tentativa sem resposta em {JANELA_DESISTENCIA_DIAS} dias</span>
                                    Marque para encerrar o lead como "sem retorno". Ele sai do quadro e pode ser reaberto depois.
                                </span>
                            </label>
                        )}

                        {vaiEncerrar ? (
                            <p className="text-[12px] text-slate-600 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                O lead sai do quadro como <span className="font-bold">Perdido</span> ({resultado === 'sem_interesse' ? 'sem interesse' : 'sem retorno'}).
                                Para ver ou reabrir, marque "Ver encerrados" no alto do quadro.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-sm font-bold text-slate-700">Próximo contato</p>
                                <div className="flex flex-wrap gap-2">
                                    {OPCOES_DIAS.map(o => (
                                        <button key={o.dias} type="button" onClick={() => escolherProximo(somarDiasUteis(hoje, o.dias))} className={classeChip(opcaoAtiva(o.dias))}>
                                            {o.rotulo}
                                        </button>
                                    ))}
                                    <label className={`${classeChip(dataLivre)} inline-flex items-center gap-1.5 cursor-pointer`}>
                                        <CalendarDays size={13} />
                                        <input
                                            type="date"
                                            min={hoje}
                                            value={dataLivre ? proximo || '' : ''}
                                            onChange={(e) => escolherProximo(e.target.value || null)}
                                            className="bg-transparent outline-none text-[12px] font-bold w-[7.5rem] cursor-pointer"
                                            aria-label="Escolher a data do próximo contato"
                                        />
                                    </label>
                                    <button type="button" onClick={() => escolherProximo(null)} className={classeChip(!proximo)}>
                                        Sem data
                                    </button>
                                </div>
                                <p className="text-[12px] text-slate-500">
                                    {proximo
                                        ? <>O lead volta para <span className="font-bold text-slate-700">Retomar</span> em <span className="font-bold text-slate-700">{rotuloDia(proximo)}</span>.</>
                                        : <>Sem data, ele volta para Retomar depois de 3 dias sem contato.</>}
                                </p>
                            </div>
                        )}

                        {canal === 'email' && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-slate-700">Assunto do e-mail <span className="font-medium text-slate-400">(opcional)</span></label>
                                <input
                                    type="text"
                                    value={assunto}
                                    onChange={(e) => setAssunto(e.target.value)}
                                    placeholder="Para lembrar qual e-mail foi"
                                    className={classeCampo}
                                />
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-sm font-bold text-slate-700">Nota <span className="font-medium text-slate-400">(opcional)</span></label>
                            <textarea
                                value={nota}
                                onChange={(e) => setNota(e.target.value)}
                                rows={2}
                                placeholder="Ex.: falar com o Gerson, do financeiro"
                                className={`${classeCampo} resize-y`}
                            />
                        </div>
                    </div>

                    <div className="border-t border-slate-100 bg-slate-50 p-5 space-y-3">
                        {erro && <p className="text-[12px] font-bold text-rose-600">{erro}</p>}
                        <div className="flex justify-end items-center gap-3">
                            <button
                                onClick={onFechar}
                                disabled={salvando}
                                className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={salvar}
                                disabled={salvando}
                                className="bg-navy hover:bg-navy-light text-areia border border-gold/35 px-5 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-50"
                            >
                                {salvando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                Salvar contato
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};

export default KanbanComoFoiModal;
