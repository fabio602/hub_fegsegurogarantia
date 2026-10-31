// Regras do registro de contato no Kanban ("Como foi?").
// Cada contato grava o resultado e o próximo passo; o resultado decide a
// etapa do lead (migração 122). Ficam aqui para o card e o modal usarem a
// mesma lógica.

import type { EtapaLead, MotivoPerda, ResultadoContato } from '../types';

export type CanalContato = 'whatsapp' | 'email' | 'ligacao';

export const ROTULO_RESULTADO: Record<ResultadoContato, string> = {
    enviado: 'Enviei',
    respondeu: 'Respondeu',
    conversou: 'Conversei',
    nao_atendeu: 'Não atendeu',
    pediu_retorno: 'Pediu retorno',
    pediu_cotacao: 'Pediu cotação',
    numero_errado: 'Número errado',
    sem_interesse: 'Sem interesse',
};

/** Como o resultado aparece no card, depois do canal ("Ligação 30/10 · não atendeu"). */
export const RESUMO_RESULTADO: Record<ResultadoContato, string> = {
    enviado: 'enviado',
    respondeu: 'respondeu',
    conversou: 'conversou',
    nao_atendeu: 'não atendeu',
    pediu_retorno: 'pediu retorno',
    pediu_cotacao: 'pediu cotação',
    numero_errado: 'número errado',
    sem_interesse: 'sem interesse',
};

export const RESULTADOS_POR_CANAL: Record<CanalContato, ResultadoContato[]> = {
    ligacao: ['conversou', 'nao_atendeu', 'pediu_retorno', 'pediu_cotacao', 'numero_errado', 'sem_interesse'],
    whatsapp: ['enviado', 'respondeu', 'pediu_cotacao', 'numero_errado', 'sem_interesse'],
    email: ['enviado', 'respondeu', 'pediu_cotacao', 'sem_interesse'],
};

/** O lead deu sinal de vida: zera a contagem de tentativas sem resposta. */
export const RESULTADOS_COM_RESPOSTA: ResultadoContato[] = ['respondeu', 'conversou', 'pediu_cotacao'];

/** Regra de desistência: a partir desta tentativa sem resposta, sugere encerrar. */
export const TENTATIVAS_PARA_DESISTIR = 5;
export const JANELA_DESISTENCIA_DIAS = 15;

export const ROTULO_ETAPA: Record<EtapaLead, string> = {
    contatar: 'A contatar',
    tentando: 'Tentando contato',
    conversa: 'Em conversa',
    cotacao: 'Cotação',
    ganho: 'Ganho',
    perdido: 'Perdido',
};

export const ROTULO_MOTIVO_PERDA: Record<MotivoPerda, string> = {
    sem_interesse: 'Sem interesse',
    ja_tem_corretora: 'Já tem corretora',
    nao_precisa: 'Não precisa de garantia',
    contato_invalido: 'Contato inválido',
    sem_retorno: 'Sem retorno',
};
export const MOTIVOS_PERDA = Object.keys(ROTULO_MOTIVO_PERDA) as MotivoPerda[];

const ORDEM_ETAPA: Record<'contatar' | 'tentando' | 'conversa' | 'cotacao', number> = {
    contatar: 0, tentando: 1, conversa: 2, cotacao: 3,
};

/**
 * Etapa do lead depois do contato. Nunca volta etapa: um e-mail de
 * acompanhamento para quem já está em conversa não o devolve a "tentando".
 * Lead encerrado que recebe contato é reaberto.
 */
export const etapaAposResultado = (atual: EtapaLead | null | undefined, resultado: ResultadoContato): EtapaLead => {
    if (resultado === 'sem_interesse') return 'perdido';
    const alvo = resultado === 'pediu_cotacao' ? 'cotacao'
        : resultado === 'respondeu' || resultado === 'conversou' ? 'conversa'
        : 'tentando';
    const base = atual && atual in ORDEM_ETAPA ? (atual as keyof typeof ORDEM_ETAPA) : 'contatar';
    return ORDEM_ETAPA[alvo] >= ORDEM_ETAPA[base] ? alvo : base;
};

/** Dias úteis até o próximo contato, sugeridos pelo resultado. null = sem próximo passo. */
export const DIAS_PADRAO: Record<ResultadoContato, number | null> = {
    enviado: 3,
    respondeu: 2,
    conversou: 2,
    nao_atendeu: 1,
    pediu_retorno: 1,
    pediu_cotacao: 1,
    numero_errado: 1,
    sem_interesse: null,
};

/** Hoje (AAAA-MM-DD) no horário de São Paulo. */
export const hojeSaoPaulo = (): string =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Soma dias úteis (pula sábado e domingo; feriado não entra na conta). */
export const somarDiasUteis = (diaIso: string, dias: number): string => {
    const [a, m, d] = diaIso.split('-').map(Number);
    const data = new Date(Date.UTC(a, m - 1, d));
    let faltam = dias;
    while (faltam > 0) {
        data.setUTCDate(data.getUTCDate() + 1);
        const semana = data.getUTCDay();
        if (semana !== 0 && semana !== 6) faltam -= 1;
    }
    return data.toISOString().slice(0, 10);
};

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** 'AAAA-MM-DD' -> 'seg 03/11'. */
export const rotuloDia = (diaIso?: string | null): string => {
    if (!diaIso) return '';
    const [a, m, d] = diaIso.slice(0, 10).split('-').map(Number);
    if (!a || !m || !d) return '';
    const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
    return `${DIA_SEMANA[semana]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

/** Próximo passo vencido (hoje ou antes). */
export const proximoPassoVencido = (diaIso?: string | null): boolean =>
    !!diaIso && diaIso.slice(0, 10) <= hojeSaoPaulo();
