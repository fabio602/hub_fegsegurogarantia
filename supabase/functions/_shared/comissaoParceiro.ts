// Comissão do parceiro sobre UM negócio.
//
// Usado pela Edge Function parceiro-portal (o que o parceiro vê) e pelo HUB
// (repasse em ParceiroManager), para os dois lados darem sempre o mesmo número.
// Arquivo puro, sem nada de Deno nem de React, para poder ser importado dos dois.
//
// Regra escalonada do contrato de parceria (partners.comissao_faixas, migração
// 129): a comissão LÍQUIDA do negócio é a comissão da F&G menos o imposto
// (imposto_pct). Ela escolhe a faixa e é sobre ela que o percentual incide.
// Nunca sobre o prêmio. Até 05/11/2026 o percentual incidia sobre a comissão
// integral; o Fábio mudou para a líquida nessa data (migração 133).
//
// Exemplo com a tabela atual (imposto de 6%): comissão de R$ 1.000,00 tem
// líquida de R$ 940,00, cai na faixa "até R$ 10.000,00" (10%) e o parceiro
// recebe R$ 94,00.
//
// Sem faixas cadastradas vale o commission_pct fixo do parceiro.

export interface FaixaComissao {
  /** Teto da faixa em reais, comparado com a comissão líquida. null = sem teto. */
  ate: number | null;
  /** Percentual da faixa, aplicado sobre a comissão líquida do negócio. */
  pct: number;
}

export interface RegraFaixas {
  imposto_pct: number;
  faixas: FaixaComissao[];
}

/**
 * Tabela escalonada do contrato de parceria (passada pelo Fábio em 04/11/2026).
 * É a regra que o HUB grava quando o parceiro de seguro garantia fica com o
 * tipo de comissão "Escalonado (contrato)".
 */
export const FAIXAS_CONTRATO: RegraFaixas = {
  imposto_pct: 6,
  faixas: [
    { ate: 10000, pct: 10 },
    { ate: 30000, pct: 20 },
    { ate: 50000, pct: 30 },
    { ate: 80000, pct: 40 },
    { ate: null, pct: 50 },
  ],
};

export interface RegraParceiro {
  commission_pct?: number | string | null;
  comissao_faixas?: RegraFaixas | null;
}

export interface ComissaoCalculada {
  /** Percentual aplicado (ex.: 10). */
  pct: number;
  /** Valor do parceiro em reais, arredondado ao centavo. */
  valor: number;
  /** Comissão líquida do negócio (escolhe a faixa e é a base do %); null na regra fixa. */
  liquida: number | null;
  regra: 'escalonada' | 'fixa';
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Lê valor em reais vindo do banco. As colunas de dinheiro da sales são texto
 * ("R$ 12.501,20"); o ponto é milhar e a vírgula é decimal. Também aceita
 * número e texto já no formato americano ("1805.15").
 */
export function lerValor(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.805" sem vírgula: ponto de milhar, não decimal.
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Faixa que vale para a comissão líquida informada. */
export function faixaDaLiquida(liquida: number, regra: RegraFaixas): FaixaComissao | null {
  const faixas = [...(regra.faixas || [])].sort((a, b) => {
    if (a.ate === null) return 1;
    if (b.ate === null) return -1;
    return a.ate - b.ate;
  });
  for (const f of faixas) {
    if (f.ate === null || liquida <= f.ate) return f;
  }
  return null;
}

/** Comissão do parceiro em um negócio: na regra escalonada, % da faixa sobre a comissão líquida. */
export function comissaoDoParceiro(comissaoNegocio: unknown, parceiro: RegraParceiro): ComissaoCalculada {
  const comissao = lerValor(comissaoNegocio);
  const regra = parceiro.comissao_faixas;

  if (regra && Array.isArray(regra.faixas) && regra.faixas.length > 0) {
    const imposto = Number(regra.imposto_pct) || 0;
    const liquida = centavos(comissao * (1 - imposto / 100));
    const faixa = faixaDaLiquida(liquida, regra);
    const pct = faixa ? Number(faixa.pct) || 0 : 0;
    // Em centavos inteiros, para meio centavo arredondar sempre igual.
    const valor = Math.round(Math.round(liquida * 100) * pct / 100) / 100;
    return { pct, valor, liquida, regra: 'escalonada' };
  }

  // Zero é um valor válido (parceiro sem comissão); só o ausente cai no 20%
  // histórico do cadastro.
  const bruto = parceiro.commission_pct;
  const pct = bruto === null || bruto === undefined || bruto === '' ? 20 : Number(bruto) || 0;
  return { pct, valor: centavos(comissao * pct / 100), liquida: null, regra: 'fixa' };
}
