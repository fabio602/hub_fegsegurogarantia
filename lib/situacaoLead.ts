import { proximoPassoVencido } from './contatoLead.ts';

/**
 * Situação de um lead com dono, calculada pelos contatos já registrados.
 * É a mesma regra dos blocos do Kanban de Leads e do "Meu dia": mudar aqui
 * muda nos dois lugares.
 *
 *  - contatar:   nenhum contato registrado ainda;
 *  - aguardando: próximo contato marcado para depois de hoje (ou, sem data,
 *                último contato há menos de TOQUE_ALERTA_DIAS);
 *  - retomar:    chegou o dia do próximo contato (ou, sem data, último contato
 *                há TOQUE_ALERTA_DIAS dias ou mais).
 */
export type SituacaoLead = 'contatar' | 'aguardando' | 'retomar';

export const TOQUE_ALERTA_DIAS = 3;

export interface LeadParaSituacao {
  proximo_passo?: string | null;
  situacao_manual?: SituacaoLead | null;
  situacao_manual_em?: string | null;
}

/** Dias inteiros desde um timestamp (nulo se vazio ou inválido). */
export const diasDesdeTimestamp = (ts?: string | null): number | null => {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

/**
 * @param ultimoContato timestamp do contato mais recente do lead; vazio = nenhum.
 */
export function situacaoDoLead(ultimoContato: string | null | undefined, p?: LeadParaSituacao | null): SituacaoLead {
  // Situação escolhida à mão vale até o próximo contato registrado depois dela.
  const manual = p?.situacao_manual;
  const manualEm = p?.situacao_manual_em ? Date.parse(p.situacao_manual_em) : NaN;
  if (manual && !Number.isNaN(manualEm) && (!ultimoContato || Date.parse(ultimoContato) <= manualEm)) {
    if (manual !== 'aguardando') return manual;
    const dias = diasDesdeTimestamp(p?.situacao_manual_em);
    return dias !== null && dias >= TOQUE_ALERTA_DIAS ? 'retomar' : 'aguardando';
  }
  if (!ultimoContato) return 'contatar';
  // Próximo contato combinado manda; sem ele, vale a regra dos dias sem contato.
  if (p?.proximo_passo) return proximoPassoVencido(p.proximo_passo) ? 'retomar' : 'aguardando';
  const dias = diasDesdeTimestamp(ultimoContato);
  return dias !== null && dias >= TOQUE_ALERTA_DIAS ? 'retomar' : 'aguardando';
}
