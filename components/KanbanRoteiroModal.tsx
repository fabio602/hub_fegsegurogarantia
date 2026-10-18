import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, MessageCircle, Mail, Phone, ExternalLink } from 'lucide-react';
import { Prospect } from '../types';
import ModalPortal from './ModalPortal.tsx';
import {
    Roteiro, GrupoRoteiro, camposDoLead, preencherRoteiro, escolherRoteiro, variacaoDoLead,
    normalizarTelefone, tipoTelefone, formatarTelefone, linkWhatsApp, linkEmail,
} from '../lib/roteiros.ts';

// Modal dos roteiros de abordagem do card (spec em docs/kanban/ROTEIROS-CARD.md).
// Nada é enviado daqui: os botões abrem o WhatsApp, o discador ou o e-mail da
// própria pessoa, e o toque só é gravado no "Confirmar".

export type ModoRoteiro = 'whatsapp' | 'ligacao' | 'email' | 'sem-email';

const ETAPAS_WHATSAPP = 3;
const RETOMADA_MIN_DIAS = 3;
const LIMITE_WHATS_DIA = 30;
const ROTULO_ETAPA: Record<number, string> = { 1: '1º contato', 2: 'Retomada', 3: 'Última mensagem' };
const CHAVE_REMETENTE = 'kanban_roteiro_remetente';

const lerRemetenteSalvo = (): string => {
    try { return localStorage.getItem(CHAVE_REMETENTE) || ''; } catch { return ''; }
};
const salvarRemetente = (nome: string) => {
    try { localStorage.setItem(CHAVE_REMETENTE, nome); } catch { /* navegador sem storage */ }
};

const diasDesde = (ts?: string | null): number | null => {
    if (!ts) return null;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

const rotuloDiasAtras = (dias: number): string =>
    dias === 0 ? 'hoje' : `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;

interface Props {
    lead: Prospect;
    grupo: GrupoRoteiro;
    modo: ModoRoteiro;
    roteiros: Roteiro[];
    /** Quantos toques de WhatsApp o lead já tem e quando foi o último. */
    whatsEnviados: number;
    ultimoWhatsEm?: string | null;
    /** WhatsApps que o usuário logado registrou hoje (horário de SP). */
    whatsHoje: number;
    /** Primeiro nome do usuário em `sellers`; vazio quando ele não está lá. */
    remetentePadrao: string;
    salvando: boolean;
    onRegistrar: (canal: 'whatsapp' | 'email' | 'ligacao') => Promise<boolean>;
    onTrocarModo: (modo: ModoRoteiro) => void;
    onFechar: () => void;
}

const KanbanRoteiroModal: React.FC<Props> = ({
    lead, grupo, modo, roteiros, whatsEnviados, ultimoWhatsEm, whatsHoje,
    remetentePadrao, salvando, onRegistrar, onTrocarModo, onFechar,
}) => {
    const [remetenteManual, setRemetenteManual] = useState(lerRemetenteSalvo);
    const remetente = remetentePadrao || remetenteManual.trim();
    const [texto, setTexto] = useState('');
    const [assunto, setAssunto] = useState('');
    const [confirmandoLigacao, setConfirmandoLigacao] = useState(false);

    const telefone = normalizarTelefone(lead.phonenumber);
    const tipoFone = tipoTelefone(telefone);
    const etapa = Math.min(whatsEnviados + 1, ETAPAS_WHATSAPP);
    const cicloEncerrado = whatsEnviados >= ETAPAS_WHATSAPP;

    const roteiro = useMemo(() => {
        if (modo === 'whatsapp') return escolherRoteiro(roteiros, grupo, 'whatsapp', etapa, etapa === 1 ? variacaoDoLead(lead.id) : 'A');
        if (modo === 'ligacao') return escolherRoteiro(roteiros, grupo, 'ligacao', 1);
        if (modo === 'email') return escolherRoteiro(roteiros, grupo, 'email', 1);
        return null;
    }, [modo, roteiros, grupo, etapa, lead.id]);

    // Texto preenchido; refaz quando muda o roteiro ou o nome de quem envia.
    useEffect(() => {
        if (!roteiro) { setTexto(''); setAssunto(''); return; }
        const campos = camposDoLead(lead, remetente);
        setTexto(preencherRoteiro(roteiro.corpo, campos));
        setAssunto(roteiro.assunto ? preencherRoteiro(roteiro.assunto, campos) : '');
    }, [roteiro, lead, remetente]);

    useEffect(() => { setConfirmandoLigacao(false); }, [modo]);

    const registrar = async (canal: 'whatsapp' | 'email' | 'ligacao') => {
        if (await onRegistrar(canal)) onFechar();
    };

    const diasUltimoWhats = diasDesde(ultimoWhatsEm);
    const avisos: string[] = [];
    if (modo === 'whatsapp' && !cicloEncerrado) {
        if (etapa === 2 && diasUltimoWhats !== null && diasUltimoWhats < RETOMADA_MIN_DIAS) {
            avisos.push(`Último contato ${rotuloDiasAtras(diasUltimoWhats)}; a retomada é a partir do 4º dia.`);
        }
        if (whatsHoje >= LIMITE_WHATS_DIA) avisos.push(`Você já registrou ${LIMITE_WHATS_DIA} WhatsApps hoje.`);
    }
    if (modo === 'ligacao' && tipoFone === 'erro') {
        avisos.push('Número incompleto. Procure o telefone no site ou no Google e corrija no card.');
    }

    const titulo =
        modo === 'whatsapp' ? (cicloEncerrado ? 'WhatsApp' : `WhatsApp · ${ROTULO_ETAPA[etapa]}`)
        : modo === 'ligacao' ? 'Ligação'
        : 'E-mail';
    const Icone = modo === 'whatsapp' ? MessageCircle : modo === 'ligacao' ? Phone : Mail;
    const precisaRemetente = !remetentePadrao && modo !== 'sem-email' && !(modo === 'whatsapp' && cicloEncerrado);
    const faltaRemetente = precisaRemetente && !remetente;
    const classeCampo = 'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all';

    return (
        <ModalPortal>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                onClick={onFechar}
            >
                <div
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center p-6 border-b border-gold/20 bg-gold/10">
                        <div className="min-w-0">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                <Icone size={20} className="text-gold" /> {titulo}
                            </h3>
                            <p className="text-sm text-slate-500 font-medium mt-1 truncate">
                                {lead.company || lead.name}
                                {lead.decisor ? ` · ${lead.decisor}` : ''}
                                {modo === 'whatsapp' && lead.phonenumber ? ` · ${formatarTelefone(lead.phonenumber)}` : ''}
                            </p>
                        </div>
                        <button onClick={onFechar} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm shrink-0">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scroll p-6 space-y-4">
                        {modo === 'sem-email' && (
                            <p className="text-sm font-bold text-slate-700">
                                Este lead ainda não tem e-mail. Peça na conversa e cadastre no card.
                            </p>
                        )}

                        {modo === 'whatsapp' && cicloEncerrado && (
                            <p className="text-sm font-bold text-slate-700">Ciclo de mensagens encerrado para este lead.</p>
                        )}

                        {precisaRemetente && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-slate-700">Seu nome</label>
                                <input
                                    type="text"
                                    value={remetenteManual}
                                    onChange={(e) => { setRemetenteManual(e.target.value); salvarRemetente(e.target.value.trim()); }}
                                    placeholder="Como você se apresenta na mensagem"
                                    className={classeCampo}
                                />
                            </div>
                        )}

                        {roteiro === null && modo !== 'sem-email' && !(modo === 'whatsapp' && cicloEncerrado) && (
                            <p className="text-sm font-bold text-slate-500">Nenhum roteiro ativo para este grupo.</p>
                        )}

                        {roteiro && modo === 'ligacao' && (
                            <>
                                <div className="flex items-center gap-3 flex-wrap">
                                    {tipoFone === 'erro' ? (
                                        <span className="text-sm font-bold text-slate-600">{lead.phonenumber || 'Sem telefone'}</span>
                                    ) : (
                                        <a href={`tel:+55${telefone}`} className="inline-flex items-center gap-1.5 text-sm font-black text-navy hover:text-gold-dark">
                                            <Phone size={14} /> {formatarTelefone(lead.phonenumber)}
                                        </a>
                                    )}
                                    {tipoFone === 'fixo' && (
                                        <button
                                            type="button"
                                            onClick={() => onTrocarModo('whatsapp')}
                                            className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline underline-offset-2"
                                        >
                                            Tentar WhatsApp mesmo assim
                                        </button>
                                    )}
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                    {texto}
                                </div>
                            </>
                        )}

                        {roteiro && modo === 'email' && (
                            <>
                                <p className="text-[12px] font-bold text-slate-500">Para: {lead.email}</p>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-bold text-slate-700">Assunto</label>
                                    <input type="text" value={assunto} onChange={(e) => setAssunto(e.target.value)} className={classeCampo} />
                                </div>
                            </>
                        )}

                        {roteiro && (modo === 'email' || (modo === 'whatsapp' && !cicloEncerrado)) && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-bold text-slate-700">Mensagem</label>
                                <textarea
                                    value={texto}
                                    onChange={(e) => setTexto(e.target.value)}
                                    rows={modo === 'email' ? 14 : 8}
                                    className={`${classeCampo} resize-y leading-relaxed`}
                                />
                            </div>
                        )}
                    </div>

                    <div className="border-t border-slate-100 bg-slate-50 p-5 space-y-3">
                        {avisos.length > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                                {avisos.map((a, i) => (
                                    <p key={i} className="text-[12px] text-amber-800 font-bold flex items-start gap-2">
                                        <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {a}
                                    </p>
                                ))}
                            </div>
                        )}
                        {faltaRemetente && roteiro && (
                            <p className="text-[12px] text-slate-500 font-bold">Preencha seu nome para montar a mensagem.</p>
                        )}
                        <div className="flex justify-end items-center gap-3 flex-wrap">
                            <button
                                onClick={onFechar}
                                disabled={salvando}
                                className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {modo === 'sem-email' || (modo === 'whatsapp' && cicloEncerrado) ? 'Fechar' : 'Cancelar'}
                            </button>

                            {roteiro && modo === 'whatsapp' && !cicloEncerrado && (
                                <>
                                    <a
                                        href={faltaRemetente ? undefined : linkWhatsApp(telefone, texto)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-disabled={faltaRemetente}
                                        className={`bg-whatsapp hover:bg-whatsapp-hover text-white px-5 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 ${faltaRemetente ? 'opacity-50 pointer-events-none' : ''}`}
                                    >
                                        <ExternalLink size={16} /> Abrir WhatsApp
                                    </a>
                                    <BotaoConfirmar disabled={salvando || faltaRemetente} salvando={salvando} onClick={() => registrar('whatsapp')}>
                                        Confirmar envio
                                    </BotaoConfirmar>
                                </>
                            )}

                            {roteiro && modo === 'email' && (
                                <>
                                    <a
                                        href={faltaRemetente ? undefined : linkEmail(lead.email || '', assunto, texto)}
                                        aria-disabled={faltaRemetente}
                                        className={`bg-white border border-slate-200 text-slate-700 hover:border-gold/40 hover:text-navy px-5 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 ${faltaRemetente ? 'opacity-50 pointer-events-none' : ''}`}
                                    >
                                        <ExternalLink size={16} /> Abrir no e-mail
                                    </a>
                                    <BotaoConfirmar disabled={salvando || faltaRemetente} salvando={salvando} onClick={() => registrar('email')}>
                                        Confirmar envio
                                    </BotaoConfirmar>
                                </>
                            )}

                            {roteiro && modo === 'ligacao' && (
                                confirmandoLigacao ? (
                                    <>
                                        <button
                                            onClick={() => setConfirmandoLigacao(false)}
                                            disabled={salvando}
                                            className="text-[12px] font-bold text-slate-500 hover:text-slate-700"
                                        >
                                            Voltar
                                        </button>
                                        <BotaoConfirmar disabled={salvando} salvando={salvando} onClick={() => registrar('ligacao')}>
                                            Confirmar ligação feita
                                        </BotaoConfirmar>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => setConfirmandoLigacao(true)}
                                        className="bg-white border border-slate-200 text-slate-700 hover:border-gold/40 hover:text-navy px-5 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2"
                                    >
                                        <Phone size={16} /> Registrar ligação
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};

const BotaoConfirmar: React.FC<{ disabled: boolean; salvando: boolean; onClick: () => void; children: React.ReactNode }> = ({ disabled, salvando, onClick, children }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className="bg-navy hover:bg-navy-light text-areia border border-gold/35 px-5 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-50"
    >
        {salvando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
        {children}
    </button>
);

export default KanbanRoteiroModal;
