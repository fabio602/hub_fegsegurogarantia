// Linha do tempo do lead: junta, em ordem, tudo o que aconteceu com ele.
//  - contatos registrados no card (prospect_toques, com resultado e nota);
//  - e-mails automáticos das trilhas (email_envios + assunto da etapa);
//  - eventos do Resend guardados por contato (voltou, spam, clique);
//  - observações da ficha;
//  - marcos: entrada do lead, homologação (PNCP), dono atual, encerramento.
// O E-mail da licitação aparece em até três fontes (envio ordem 1 da trilha,
// observação automática e, desde o "Como foi?", o contato registrado): aqui
// vira uma entrada só.

import type { Prospect, ResultadoContato } from '../types';
import { RESUMO_RESULTADO, ROTULO_MOTIVO_PERDA, rotuloDia } from './contatoLead.ts';
import type { CanalContato } from './contatoLead.ts';

export interface ToqueCompleto {
    created_at: string;
    canal: CanalContato;
    resultado: ResultadoContato | null;
    roteiro: string | null;
    assunto: string | null;
    mensagem: string | null;
    nota: string | null;
    proximo_passo: string | null;
    autor_email: string | null;
}
export interface ContatoTrilha {
    id: string;
    trilha: string | null;
    nome_empresa: string | null;
    email: string | null;
    bounce_status: string | null;
    bounce_motivo: string | null;
    bounce_em: string | null;
}
export interface EnvioTrilha { contato_id: string; ordem: number; enviado_em: string }
export interface EtapaTrilha { trilha: string; ordem: number; assunto: string | null }
export interface Observacao { timestamp: string; text: string }

export type TipoEvento = 'contato' | 'email' | 'nota' | 'marco';
export type IconeEvento = 'whatsapp' | 'email' | 'ligacao' | 'nota' | 'alerta' | 'marco' | 'trilha';

export interface EventoLinha {
    chave: string;
    em: string;
    tipo: TipoEvento;
    icone: IconeEvento;
    titulo: string;
    autor?: string;
    detalhes: string[];
    texto?: string;
    tom: 'normal' | 'alerta' | 'sucesso';
    /** Só a data é conhecida (marcos com dia, sem hora). */
    soData?: boolean;
}

const ROTULO_CANAL: Record<CanalContato, string> = { whatsapp: 'WhatsApp', email: 'E-mail', ligacao: 'Ligação' };
const ROTULO_TRILHA: Record<string, string> = {
    garantia: 'Garantia', energia: 'Energia', locaticia: 'Locatícia', consultores: 'Consultores',
    judicial: 'Judicial', endosso: 'Endosso', 'risco-engenharia': 'Risco de engenharia',
};
const ROTULO_ORIGEM: Record<string, string> = {
    pncp_auto: 'PNCP (vencedor de licitação)',
    radar: 'Radar PGFN',
    garimpo_energia: 'Garimpo de energia',
    garimpo_imobiliarias: 'Garimpo de imobiliárias',
    garimpo_consultores: 'Garimpo de consultores',
    whatsapp: 'WhatsApp',
};
const EVENTO_RESEND: Record<string, { titulo: string; tom: EventoLinha['tom'] }> = {
    bounced_permanent: { titulo: 'E-mail voltou: endereço não recebe', tom: 'alerta' },
    bounced_transient: { titulo: 'E-mail não entregue (falha temporária)', tom: 'alerta' },
    complained: { titulo: 'Marcou o e-mail como spam', tom: 'alerta' },
    delivery_delayed: { titulo: 'Entrega do e-mail atrasada', tom: 'alerta' },
    clicked: { titulo: 'Clicou no link do e-mail', tom: 'sucesso' },
};
const RE_OBS_LICITACAO = /^E-mail da licitação enviado em \d{2}\/\d{2} para (\S+)/;

const ordinal = (n: number) => `${n}º`;

/** 'DD/MM/AAAA HH:MM' (horário de São Paulo) -> ISO com fuso. */
export const isoDeTimestampBr = (ts: string): string | null => {
    const m = ts.trim().match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00` : null;
};

/** 'energia/whatsapp/1B' -> 'Roteiro de energia, WhatsApp 1'. */
export const rotuloRoteiro = (roteiro: string | null): string | null => {
    if (!roteiro) return null;
    if (roteiro === 'email_licitacao') return 'E-mail da licitação';
    const [grupo, canal, etapa] = roteiro.split('/');
    if (!grupo || !canal) return `Roteiro ${roteiro}`;
    const nomeCanal = canal === 'whatsapp' ? 'WhatsApp' : canal === 'ligacao' ? 'ligação' : 'e-mail';
    const numero = (etapa || '').replace(/\D/g, '');
    return `Roteiro de ${grupo}, ${nomeCanal}${numero ? ` ${numero}` : ''}`;
};

const preencher = (assunto: string, empresa: string) =>
    assunto.replace(/\[NOME_EMPRESA\]/g, empresa).replace(/\[[A-Z_]+\]/g, '').replace(/\s{2,}/g, ' ').trim();

export function montarLinhaDoTempo(entrada: {
    lead: Prospect;
    toques: ToqueCompleto[];
    contatos: ContatoTrilha[];
    envios: EnvioTrilha[];
    etapas: EtapaTrilha[];
    observacoes: Observacao[];
    nomeDe: (email: string | null) => string;
}): EventoLinha[] {
    const { lead, toques, contatos, envios, etapas, observacoes, nomeDe } = entrada;
    const eventos: EventoLinha[] = [];
    const empresa = lead.company || lead.name || '';

    // E-mail da licitação: de onde ele aparece.
    const obsLicitacao = observacoes.find(o => RE_OBS_LICITACAO.test(o.text.trim()));
    const paraLicitacao = obsLicitacao?.text.trim().match(RE_OBS_LICITACAO)?.[1] ?? null;
    const toqueLicitacao = toques.some(t => t.roteiro === 'email_licitacao');

    // 1. Contatos registrados no card
    toques.forEach((t, i) => {
        const detalhes: string[] = [];
        const roteiro = rotuloRoteiro(t.roteiro);
        if (roteiro && t.roteiro !== 'email_licitacao') detalhes.push(roteiro);
        if (t.roteiro === 'email_licitacao' && paraLicitacao) detalhes.push(`Para ${paraLicitacao}`);
        if (t.assunto) detalhes.push(`Assunto: ${t.assunto}`);
        if (t.nota) detalhes.push(`Nota: ${t.nota}`);
        if (t.proximo_passo) detalhes.push(`Próximo contato: ${rotuloDia(t.proximo_passo)}`);
        const base = t.roteiro === 'email_licitacao' ? 'E-mail da licitação' : ROTULO_CANAL[t.canal];
        eventos.push({
            chave: `toque-${i}-${t.created_at}`,
            em: t.created_at,
            tipo: 'contato',
            icone: t.canal,
            titulo: t.resultado && t.roteiro !== 'email_licitacao' ? `${base} · ${RESUMO_RESULTADO[t.resultado]}` : base,
            autor: t.autor_email ? nomeDe(t.autor_email) : undefined,
            detalhes,
            texto: t.mensagem || undefined,
            tom: t.resultado && ['respondeu', 'conversou', 'pediu_cotacao'].includes(t.resultado) ? 'sucesso'
                : t.resultado === 'sem_interesse' ? 'alerta' : 'normal',
        });
    });

    // 2. E-mails das trilhas
    const contatoPorId = new Map(contatos.map(c => [c.id, c]));
    const assuntoDa = new Map(etapas.map(e => [`${e.trilha}:${e.ordem}`, e.assunto]));
    for (const envio of envios) {
        const contato = contatoPorId.get(envio.contato_id);
        if (!contato) continue;
        const trilha = contato.trilha || '';
        const ehLicitacao = envio.ordem === 1 && trilha === 'garantia' && (toqueLicitacao || !!obsLicitacao);
        if (ehLicitacao && toqueLicitacao) continue; // o contato registrado já mostra este envio
        if (ehLicitacao) {
            eventos.push({
                chave: `envio-${envio.contato_id}-${envio.ordem}`,
                em: envio.enviado_em,
                tipo: 'email',
                icone: 'email',
                titulo: 'E-mail da licitação',
                detalhes: paraLicitacao ? [`Para ${paraLicitacao}`] : [],
                tom: 'normal',
            });
            continue;
        }
        const assunto = assuntoDa.get(`${trilha}:${envio.ordem}`);
        const detalhes: string[] = [];
        if (assunto) detalhes.push(`Assunto: ${preencher(assunto, contato.nome_empresa || empresa)}`);
        if (contato.email) detalhes.push(`Para ${contato.email}`);
        eventos.push({
            chave: `envio-${envio.contato_id}-${envio.ordem}`,
            em: envio.enviado_em,
            tipo: 'email',
            icone: 'trilha',
            titulo: `E-mail automático · trilha ${ROTULO_TRILHA[trilha] || trilha} (${ordinal(envio.ordem)})`,
            autor: 'HUB',
            detalhes,
            tom: 'normal',
        });
    }

    // 3. Eventos do Resend (um por contato da trilha)
    for (const c of contatos) {
        if (!c.bounce_status || !c.bounce_em) continue;
        const info = EVENTO_RESEND[c.bounce_status];
        if (!info) continue;
        const detalhes: string[] = [];
        if (c.email) detalhes.push(c.email);
        if (c.bounce_motivo && c.bounce_status !== 'clicked') detalhes.push(c.bounce_motivo);
        eventos.push({ chave: `resend-${c.id}`, em: c.bounce_em, tipo: 'email', icone: 'alerta', titulo: info.titulo, detalhes, tom: info.tom });
    }

    // 4. Observações da ficha (a da licitação já virou o e-mail acima)
    observacoes.forEach((o, i) => {
        const em = isoDeTimestampBr(o.timestamp);
        if (!em) return;
        const envioLicitacao = envios.some(e => e.ordem === 1 && contatoPorId.get(e.contato_id)?.trilha === 'garantia');
        if (o === obsLicitacao && (toqueLicitacao || envioLicitacao)) return;
        eventos.push({ chave: `obs-${i}-${o.timestamp}`, em, tipo: 'nota', icone: 'nota', titulo: 'Observação', detalhes: [], texto: o.text, tom: 'normal' });
    });

    // 5. Marcos
    if (lead.created_at) {
        const origem = lead.source ? (ROTULO_ORIGEM[lead.source] || lead.source) : null;
        eventos.push({ chave: 'marco-entrada', em: lead.created_at, tipo: 'marco', icone: 'marco', titulo: 'Lead entrou no HUB', detalhes: origem ? [`Origem: ${origem}`] : [], tom: 'normal' });
    }
    if (lead.source === 'pncp_auto' && lead.data_homologacao) {
        eventos.push({
            chave: 'marco-homologacao', em: `${lead.data_homologacao.slice(0, 10)}T12:00:00-03:00`, soData: true,
            tipo: 'marco', icone: 'marco', titulo: 'Licitação homologada no PNCP',
            detalhes: lead.orgao_licitante ? [lead.orgao_licitante] : [], tom: 'normal',
        });
    }
    if (lead.responsavel_email && lead.responsavel_em) {
        eventos.push({ chave: 'marco-dono', em: lead.responsavel_em, tipo: 'marco', icone: 'marco', titulo: `Passou para ${nomeDe(lead.responsavel_email)}`, detalhes: [], tom: 'normal' });
    }
    if ((lead.etapa === 'perdido' || lead.etapa === 'ganho') && lead.encerrado_em) {
        eventos.push({
            chave: 'marco-encerrado', em: lead.encerrado_em, tipo: 'marco', icone: 'marco',
            titulo: lead.etapa === 'ganho' ? 'Encerrado como ganho' : 'Encerrado como perdido',
            detalhes: lead.motivo_perda ? [ROTULO_MOTIVO_PERDA[lead.motivo_perda]] : [],
            tom: lead.etapa === 'ganho' ? 'sucesso' : 'alerta',
        });
    }

    return eventos.sort((a, b) => Date.parse(b.em) - Date.parse(a.em));
}
