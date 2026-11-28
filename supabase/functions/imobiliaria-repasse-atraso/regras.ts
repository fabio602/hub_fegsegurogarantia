// Regras do lembrete de repasse em atraso (sem banco, para poder testar):
// quem entra no e-mail de hoje.
//
//   - a parcela venceu (proximo_vencimento antes de hoje) e tem valor;
//   - não há comprovante enviado esperando a conferência da F&G;
//   - primeiro lembrete no dia seguinte ao vencimento, depois um a cada
//     INTERVALO_DIAS, para não virar e-mail diário que ninguém abre.
//
// repasse_atraso_avisado_em guarda o dia do último lembrete. Como só se avisa
// depois do vencimento, um carimbo anterior ao vencimento atual é de parcela
// antiga e não conta.

export const INTERVALO_DIAS = 7;

export interface ClienteAtraso {
  id: string;
  partner_id: number;
  inquilino_nome: string | null;
  numero_apolice: string | null;
  valor_seguro: number | string | null;
  parcela_atual: number | null;
  total_parcelas: number | null;
  proximo_vencimento: string | null;
  repasse_atraso_avisado_em: string | null;
}

const dias = (de: string, ate: string) =>
  Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000);

/** chaves "client_id|parcela" com comprovante em conferência */
export function quemAvisar<T extends ClienteAtraso>(clientes: T[], emConferencia: Set<string>, hoje: string): (T & { dias_atraso: number })[] {
  const saida: (T & { dias_atraso: number })[] = [];
  for (const c of clientes) {
    const venc = c.proximo_vencimento ? c.proximo_vencimento.slice(0, 10) : null;
    if (!venc || venc >= hoje) continue;
    if (!(Number(c.valor_seguro) > 0)) continue;
    if (emConferencia.has(`${c.id}|${c.parcela_atual}`)) continue;
    const avisado = c.repasse_atraso_avisado_em ? c.repasse_atraso_avisado_em.slice(0, 10) : null;
    if (avisado && avisado > venc && dias(avisado, hoje) < INTERVALO_DIAS) continue;
    saida.push({ ...c, dias_atraso: dias(venc, hoje) });
  }
  return saida;
}
