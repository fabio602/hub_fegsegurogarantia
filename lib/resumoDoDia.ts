// Resumo do dia da prospecção: o que cada pessoa fez num dia.
//  - contatos registrados (prospect_toques), por autor, com o resultado;
//  - leads recebidos (pegos da fila ou passados pelo gestor: responsavel_em);
//  - leads encerrados (encerrado_em), pelo dono;
//  - observações escritas na ficha naquele dia, pelo dono do lead
//    (a observação não guarda quem escreveu);
//  - lembretes da Agenda (crm_tasks) com vencimento no dia, pelo dono do lead.

import type { CanalContato } from './contatoLead.ts';
import { RESUMO_RESULTADO, ROTULO_MOTIVO_PERDA } from './contatoLead.ts';
import type { MotivoPerda, ResultadoContato } from '../types';

export const SEM_DONO = '(sem dono)';

export interface ToqueDia { prospect_id: string; canal: CanalContato; resultado: ResultadoContato | null; nota: string | null; roteiro: string | null; autor_email: string | null; created_at: string }
export interface LeadDia { id: string; company: string | null; name?: string | null; responsavel_email: string | null; responsavel_em?: string | null; encerrado_em?: string | null; motivo_perda?: MotivoPerda | null; etapa?: string | null; description?: string | null }
export interface TarefaDia { id: string; title: string | null; due_date: string; status: string | null; prospect_id: string | null }

export interface NumerosPessoa {
    contatos: number;
    porCanal: Record<CanalContato, number>;
    comResposta: number;
    cotacoes: number;
    naoAtendeu: number;
    semInteresse: number;
    recebidos: number;
    encerrados: number;
    observacoes: number;
    lembretes: number;
    lembretesFeitos: number;
}
export interface ItemDia {
    chave: string;
    em: string;
    pessoa: string;
    tipo: 'contato' | 'recebido' | 'encerrado' | 'observacao' | 'lembrete';
    titulo: string;
    lead: string;
    detalhe?: string;
}

const ROTULO_CANAL: Record<CanalContato, string> = { whatsapp: 'WhatsApp', email: 'E-mail', ligacao: 'Ligação' };
const RE_OBS = /\[(\d{2})\/(\d{2})\/(\d{4})(?:,\s*|\s+)(\d{2}):(\d{2})\]\s*/g;

export const numerosVazios = (): NumerosPessoa => ({
    contatos: 0, porCanal: { whatsapp: 0, email: 0, ligacao: 0 }, comResposta: 0, cotacoes: 0,
    naoAtendeu: 0, semInteresse: 0, recebidos: 0, encerrados: 0, observacoes: 0, lembretes: 0, lembretesFeitos: 0,
});

/** Início e fim do dia (AAAA-MM-DD) no horário de São Paulo, em ISO. */
export const limitesDoDia = (dia: string): { inicio: string; fim: string } => {
    const [a, m, d] = dia.split('-').map(Number);
    const seguinte = new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
    return { inicio: `${dia}T00:00:00-03:00`, fim: `${seguinte}T00:00:00-03:00` };
};

/** Observações de um texto de ficha que caem no dia (AAAA-MM-DD). */
export const observacoesDoDia = (texto: string | null | undefined, dia: string): { em: string; texto: string }[] => {
    if (!texto) return [];
    const [a, m, d] = dia.split('-');
    const saida: { em: string; texto: string }[] = [];
    const marcas = [...texto.matchAll(RE_OBS)];
    marcas.forEach((mk, i) => {
        const fimTexto = i + 1 < marcas.length ? marcas[i + 1].index! : texto.length;
        const corpo = texto.slice(mk.index! + mk[0].length, fimTexto).trim();
        if (mk[1] === d && mk[2] === m && mk[3] === a && corpo) {
            saida.push({ em: `${mk[3]}-${mk[2]}-${mk[1]}T${mk[4]}:${mk[5]}:00-03:00`, texto: corpo });
        }
    });
    return saida;
};

export function montarResumo(entrada: {
    dia: string;
    toques: ToqueDia[];
    leads: LeadDia[];        // leads citados nos toques e nas tarefas
    recebidos: LeadDia[];    // responsavel_em no dia
    encerrados: LeadDia[];   // encerrado_em no dia
    comObservacao: LeadDia[];// description com observação no dia
    tarefas: TarefaDia[];
}): { porPessoa: Map<string, NumerosPessoa>; itens: ItemDia[] } {
    const { dia, toques, leads, recebidos, encerrados, comObservacao, tarefas } = entrada;
    const porPessoa = new Map<string, NumerosPessoa>();
    const numeros = (pessoa: string) => {
        if (!porPessoa.has(pessoa)) porPessoa.set(pessoa, numerosVazios());
        return porPessoa.get(pessoa)!;
    };
    const leadPorId = new Map<string, LeadDia>();
    for (const l of [...leads, ...recebidos, ...encerrados, ...comObservacao]) leadPorId.set(l.id, { ...leadPorId.get(l.id), ...l });
    const nomeLead = (id: string | null) => {
        const l = id ? leadPorId.get(id) : undefined;
        return l?.company || l?.name || 'Lead';
    };
    const donoDe = (id: string | null) => (id && leadPorId.get(id)?.responsavel_email?.toLowerCase()) || SEM_DONO;
    const itens: ItemDia[] = [];

    for (const t of toques) {
        const pessoa = (t.autor_email || '').toLowerCase() || SEM_DONO;
        const n = numeros(pessoa);
        n.contatos += 1;
        n.porCanal[t.canal] += 1;
        if (t.resultado === 'respondeu' || t.resultado === 'conversou') n.comResposta += 1;
        if (t.resultado === 'pediu_cotacao') { n.cotacoes += 1; n.comResposta += 1; }
        if (t.resultado === 'nao_atendeu') n.naoAtendeu += 1;
        const base = t.roteiro === 'email_licitacao' ? 'E-mail da licitação' : ROTULO_CANAL[t.canal];
        itens.push({
            chave: `t-${t.prospect_id}-${t.created_at}`,
            em: t.created_at,
            pessoa,
            tipo: 'contato',
            titulo: t.resultado && t.roteiro !== 'email_licitacao' ? `${base} · ${RESUMO_RESULTADO[t.resultado]}` : base,
            lead: nomeLead(t.prospect_id),
            detalhe: t.nota || undefined,
        });
    }

    for (const l of recebidos) {
        if (!l.responsavel_email || !l.responsavel_em) continue;
        const pessoa = l.responsavel_email.toLowerCase();
        numeros(pessoa).recebidos += 1;
        itens.push({ chave: `r-${l.id}`, em: l.responsavel_em, pessoa, tipo: 'recebido', titulo: 'Lead recebido', lead: l.company || l.name || 'Lead' });
    }

    for (const l of encerrados) {
        if (!l.encerrado_em) continue;
        const pessoa = (l.responsavel_email || '').toLowerCase() || SEM_DONO;
        numeros(pessoa).encerrados += 1;
        // Conta pelo motivo do encerramento: vale tanto para o "Sem interesse" do
        // "Como foi?" quanto para o encerramento pelo menu do card.
        if (l.motivo_perda === 'sem_interesse') numeros(pessoa).semInteresse += 1;
        itens.push({
            chave: `e-${l.id}`, em: l.encerrado_em, pessoa, tipo: 'encerrado',
            titulo: l.etapa === 'ganho' ? 'Encerrado como ganho' : 'Encerrado como perdido',
            lead: l.company || l.name || 'Lead',
            detalhe: l.motivo_perda ? ROTULO_MOTIVO_PERDA[l.motivo_perda] : undefined,
        });
    }

    // Observação automática do E-mail da licitação repete o contato registrado.
    const comLicitacao = new Set(toques.filter(t => t.roteiro === 'email_licitacao').map(t => t.prospect_id));
    for (const l of comObservacao) {
        const pessoa = (l.responsavel_email || '').toLowerCase() || SEM_DONO;
        observacoesDoDia(l.description, dia).forEach((o, i) => {
            if (comLicitacao.has(l.id) && /^E-mail da licitação enviado em/.test(o.texto)) return;
            numeros(pessoa).observacoes += 1;
            itens.push({ chave: `o-${l.id}-${i}`, em: o.em, pessoa, tipo: 'observacao', titulo: 'Observação', lead: l.company || l.name || 'Lead', detalhe: o.texto });
        });
    }

    for (const t of tarefas) {
        const pessoa = donoDe(t.prospect_id);
        const n = numeros(pessoa);
        n.lembretes += 1;
        const feito = t.status === 'completed';
        if (feito) n.lembretesFeitos += 1;
        itens.push({
            chave: `l-${t.id}`, em: t.due_date, pessoa, tipo: 'lembrete',
            titulo: feito ? 'Lembrete concluído' : 'Lembrete pendente',
            lead: t.prospect_id ? nomeLead(t.prospect_id) : 'Sem lead',
            detalhe: t.title || undefined,
        });
    }

    itens.sort((a, b) => Date.parse(b.em) - Date.parse(a.em));
    return { porPessoa, itens };
}

/** Soma os números de várias pessoas (total da equipe). */
export const somarNumeros = (lista: NumerosPessoa[]): NumerosPessoa => lista.reduce((t, n) => ({
    contatos: t.contatos + n.contatos,
    porCanal: { whatsapp: t.porCanal.whatsapp + n.porCanal.whatsapp, email: t.porCanal.email + n.porCanal.email, ligacao: t.porCanal.ligacao + n.porCanal.ligacao },
    comResposta: t.comResposta + n.comResposta,
    cotacoes: t.cotacoes + n.cotacoes,
    naoAtendeu: t.naoAtendeu + n.naoAtendeu,
    semInteresse: t.semInteresse + n.semInteresse,
    recebidos: t.recebidos + n.recebidos,
    encerrados: t.encerrados + n.encerrados,
    observacoes: t.observacoes + n.observacoes,
    lembretes: t.lembretes + n.lembretes,
    lembretesFeitos: t.lembretesFeitos + n.lembretesFeitos,
}), numerosVazios());
