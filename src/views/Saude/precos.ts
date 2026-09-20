/**
 * Tipos e helpers de faixa etária do módulo Saúde.
 *
 * Aqui NÃO existe cálculo de preço, de propósito. A conta é uma só e mora no
 * banco, na função `unimed_calcular_cotacao`. Reimplementar a fórmula em
 * TypeScript criaria divergência silenciosa de valor em cotação, que é pior
 * que erro visível. Ver docs/saude/HUB-SAUDE-FASE1.md, decisão 3.
 */

export type PlanoId = 'facil' | 'max_a' | 'max_b';

export interface Faixa {
  faixa: string;
  faixa_ordem: number;
  idade_min: number;
  idade_max: number;
}

/** Quantas vidas em cada faixa, na chave que a função do banco espera. */
export type Composicao = Record<string, number>;

export interface Adicional {
  codigo: string;
  nome: string;
  valor: number;
  padrao: boolean;
  descricao: string | null;
}

export interface LinhaCotacao {
  faixa: string;
  vidas: number;
  valor_unitario: number;
  subtotal: number;
}

export interface Cotacao {
  plano: PlanoId;
  tabela: string;
  vidas: number;
  linhas: LinhaCotacao[];
  subtotal_base: number;
  subtotal_adicionais: number;
  total_mensal: number;
}

export const PLANOS: { id: PlanoId; nome: string; acomodacao: string; rede: string }[] = [
  { id: 'facil', nome: 'Unipart Fácil', acomodacao: 'Enfermaria', rede: 'Rede regional, cerca de 583 médicos cooperados' },
  { id: 'max_a', nome: 'Unipart Max A', acomodacao: 'Enfermaria', rede: 'Rede ampliada, cerca de 1.229 cooperados, com Hospital Dr. Miguel Soeiro' },
  { id: 'max_b', nome: 'Unipart Max B', acomodacao: 'Apartamento', rede: 'Rede ampliada, cerca de 1.229 cooperados, com Hospital Dr. Miguel Soeiro' },
];

/** Acima disso a Unimed exige consulta de reserva de mercado e carta de nomeação. */
export const LIMITE_VIDAS = 29;

export function totalVidas(c: Composicao): number {
  return Object.values(c).reduce((s, n) => s + (Number(n) || 0), 0);
}

export function faixaDaIdade(idade: number, faixas: Faixa[]): Faixa | null {
  return faixas.find(f => idade >= f.idade_min && idade <= f.idade_max) ?? null;
}

/**
 * Lê idades soltas e devolve a composição por faixa.
 *
 * O corretor está ao telefone com o cliente e digita rápido, então aceita
 * vírgula, ponto e vírgula, espaço e quebra de linha na mesma caixa:
 * "34, 31 8; 45". O que não vira idade válida volta em `invalidas`, para a
 * tela avisar em vez de somar errado em silêncio.
 */
export function lerIdades(
  texto: string,
  faixas: Faixa[],
): { composicao: Composicao; lidas: number; invalidas: string[] } {
  const composicao: Composicao = {};
  const invalidas: string[] = [];
  let lidas = 0;

  const pedacos = texto.split(/[\s,;/]+/).filter(Boolean);
  for (const pedaco of pedacos) {
    const n = Number(pedaco.replace(',', '.'));
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 120) {
      invalidas.push(pedaco);
      continue;
    }
    const faixa = faixaDaIdade(n, faixas);
    if (!faixa) {
      invalidas.push(pedaco);
      continue;
    }
    composicao[faixa.faixa] = (composicao[faixa.faixa] ?? 0) + 1;
    lidas++;
  }

  return { composicao, lidas, invalidas };
}

/** "3 na faixa de 24 a 28, 1 na de 39 a 43", para o resumo do WhatsApp. */
export function descreverComposicao(c: Composicao, faixas: Faixa[]): string {
  return faixas
    .filter(f => (c[f.faixa] ?? 0) > 0)
    .map(f => `${c[f.faixa]} de ${f.faixa} anos`)
    .join(', ');
}
