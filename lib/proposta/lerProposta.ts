/**
 * Leitura, por regras (sem IA), da proposta de seguro garantia emitida pela seguradora,
 * para preencher o Controle Interno da tela Gerar Proposta.
 *
 * Cada seguradora apresenta a proposta de um jeito, então há um leitor por seguradora.
 * Para acrescentar uma nova: escrever `reconhece` (marca d'água do texto da seguradora)
 * e `ler` (rótulos dela), e incluir no array LEITORES. Campo não achado fica undefined
 * e a tela pede para digitar à mão: nunca inventar valor.
 *
 * Entrada: texto de cada página, como devolvido por lib/pdf/lerDocumento.ts.
 */

export interface PropostaLida {
  seguradora: string;
  numeroProposta?: string;
  tomadorNome?: string;
  tomadorCnpj?: string;
  importanciaSegurada?: number;
  /** % ao ano, como a seguradora mostra (pode vir arredondada) */
  taxaAa?: number;
  prazoDias?: number;
  /** ISO yyyy-mm-dd */
  vigenciaInicio?: string;
  vigenciaFim?: string;
  premioLiquido?: number;
  iof?: number;
  custoApolice?: number;
  /** Valor que o tomador paga: é este que vai no "Prêmio da seguradora" */
  premioTotal?: number;
  comissaoPerc?: number;
}

export interface ResultadoLeitura {
  ok: boolean;
  dados?: PropostaLida;
  /** Campos importantes que não foram achados no PDF */
  faltando: string[];
  mensagem?: string;
}

interface Leitor {
  seguradora: string;
  reconhece: (texto: string) => boolean;
  ler: (texto: string) => PropostaLida;
}

// ---------- utilitários ----------

/** "161.880,00" -> 161880; "0,4633" -> 0.4633 */
export function numeroBr(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const limpo = s.replace(/[^\d,.-]/g, '');
  if (!limpo) return undefined;
  const n = parseFloat(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
  return Number.isFinite(n) ? n : undefined;
}

/** "16/10/2026" -> "2026-10-16" */
function dataIso(s: string | undefined): string | undefined {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

const VALOR = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2,})';
/** Valor em reais logo depois do rótulo (aceita "R$" e espaços no meio). */
function valorApos(texto: string, rotulo: string): number | undefined {
  const m = texto.match(new RegExp(`${rotulo}\\s*:?\\s*(?:R\\$)?\\s*${VALOR}`, 'i'));
  return numeroBr(m?.[1]);
}

/** Trecho entre dois marcadores (o fim é opcional). */
function trecho(texto: string, inicio: RegExp, fim?: RegExp): string {
  const i = texto.search(inicio);
  if (i < 0) return '';
  const resto = texto.slice(i);
  const j = fim ? resto.slice(1).search(fim) : -1;
  return j < 0 ? resto : resto.slice(0, j + 1);
}

// ---------- leitores por seguradora ----------

const POTTENCIAL: Leitor = {
  seguradora: 'Pottencial',
  reconhece: t => /pottencial/i.test(t) && /PROPOSTA DE SEGURO/i.test(t),
  ler: t => {
    const tomador = trecho(t, /DADOS DO TOMADOR/i, /DADOS DO SEGURADO/i);
    const vig = t.match(/VIG[ÊE]NCIA:\s*De\s*(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i);
    return {
      seguradora: 'Pottencial',
      numeroProposta: t.match(/PROPOSTA DE SEGURO N[º°o]?\s*:?\s*(\d+)/i)?.[1],
      tomadorNome: tomador.match(/RAZ[ÃA]O\/DENOMINA[ÇC][ÃA]O SOCIAL:\s*(.+?)\s+CNPJ:/i)?.[1]?.trim(),
      tomadorCnpj: tomador.match(/CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i)?.[1],
      importanciaSegurada: valorApos(t, 'IMPORT[ÂA]NCIA SEGURADA'),
      taxaAa: numeroBr(t.match(/TAXA DO TOMADOR:\s*%?\s*(\d+,\d+)/i)?.[1]),
      prazoDias: numeroBr(t.match(/PRAZO DIAS:\s*(\d+)/i)?.[1]),
      vigenciaInicio: dataIso(vig?.[1]),
      vigenciaFim: dataIso(vig?.[2]),
      premioLiquido: valorApos(t, 'PR[ÊE]MIO L[ÍI]QUIDO'),
      iof: valorApos(t, 'IOF'),
      premioTotal: valorApos(t, 'PR[ÊE]MIO TOTAL'),
      comissaoPerc: numeroBr(t.match(/CORRETAGEM\s*%:\s*(\d+,\d+)/i)?.[1]),
    };
  },
};

export const LEITORES: Leitor[] = [POTTENCIAL];
export const SEGURADORAS_COM_LEITOR = LEITORES.map(l => l.seguradora);

// ---------- entrada ----------

const ROTULO_CAMPO: Partial<Record<keyof PropostaLida, string>> = {
  importanciaSegurada: 'Importância Segurada',
  premioTotal: 'Prêmio total',
  taxaAa: 'Taxa',
  prazoDias: 'Prazo',
  comissaoPerc: 'Comissão',
};

export function lerProposta(paginas: string[]): ResultadoLeitura {
  // A proposta tem os dados na primeira página; o resto são condições gerais.
  const texto = paginas.slice(0, 3).join('\n');
  const leitor = LEITORES.find(l => l.reconhece(texto));
  if (!leitor) {
    if (/AP[ÓO]LICE\s+DE SEGURO GARANTIA|N[º°]\s*AP[ÓO]LICE/i.test(texto) && !/PROPOSTA DE SEGURO N/i.test(texto)) {
      return { ok: false, faltando: [], mensagem: 'Esse PDF parece ser a minuta ou a apólice. Importe a proposta da seguradora, que traz taxa e prêmio.' };
    }
    return {
      ok: false, faltando: [],
      mensagem: `Ainda não sei ler a proposta dessa seguradora (hoje leio: ${SEGURADORAS_COM_LEITOR.join(', ')}). Preencha à mão e mande o PDF para incluirmos o leitor.`,
    };
  }
  const dados = leitor.ler(texto);
  const faltando = (Object.keys(ROTULO_CAMPO) as (keyof PropostaLida)[])
    .filter(k => dados[k] == null).map(k => ROTULO_CAMPO[k]!);
  if (dados.premioTotal == null && dados.importanciaSegurada == null) {
    return { ok: false, faltando, mensagem: `Reconheci a proposta da ${leitor.seguradora}, mas não achei IS nem prêmio. Confira se o PDF é a proposta (não a minuta).` };
  }
  return { ok: true, dados, faltando };
}

/** Taxa equivalente ao prêmio cobrado: anual (base 365) e no período. */
export function taxaEfetiva(premio: number, is: number, prazoDias: number) {
  if (!(premio > 0 && is > 0 && prazoDias > 0)) return null;
  const periodo = (premio / is) * 100;
  return { periodo, anual: periodo * 365 / prazoDias };
}
