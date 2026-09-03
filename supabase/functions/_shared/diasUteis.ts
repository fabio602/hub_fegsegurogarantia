/**
 * Dias úteis, feriados e semanas. Fonte única para a tela "Meta de Comissão"
 * e para a Edge Function weekly-goal-report, para as duas contarem igual.
 *
 * Só TypeScript puro, sem Deno nem DOM: o front importa por caminho relativo
 * e a function por `../_shared/diasUteis.ts`.
 *
 * Datas circulam como 'YYYY-MM-DD'. Toda conta usa Date.UTC para o fuso do
 * navegador ou do servidor não deslocar o dia.
 */

/** Feriados nacionais. Carnaval (segunda e terça) entra porque a corretora não
 *  trabalha nesses dias, embora oficialmente seja ponto facultativo. */
export const FERIADOS: readonly string[] = [
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01',
  '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  // 2027
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01',
  '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25',
];

const FERIADOS_SET = new Set(FERIADOS);

export type ISODate = string;

export function paraData(iso: ISODate): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function paraISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function somarDias(iso: ISODate, dias: number): ISODate {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraISO(d);
}

/** Hoje no fuso de Brasília, como 'YYYY-MM-DD'. Funciona no navegador e no Deno. */
export function hojeBrt(): ISODate {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const pega = (t: string) => partes.find(p => p.type === t)?.value ?? '';
  return `${pega('year')}-${pega('month')}-${pega('day')}`;
}

export function ehFimDeSemana(iso: ISODate): boolean {
  const dia = paraData(iso).getUTCDay();
  return dia === 0 || dia === 6;
}

export function ehFeriado(iso: ISODate): boolean {
  return FERIADOS_SET.has(iso);
}

export function ehDiaUtil(iso: ISODate): boolean {
  return !ehFimDeSemana(iso) && !ehFeriado(iso);
}

/** Conta dias úteis entre duas datas, ambas inclusas. */
export function diasUteisEntre(inicio: ISODate, fim: ISODate): number {
  if (fim < inicio) return 0;
  let n = 0;
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) if (ehDiaUtil(d)) n++;
  return n;
}

export function primeiroDiaDoMes(iso: ISODate): ISODate {
  return iso.slice(0, 7) + '-01';
}

export function ultimoDiaDoMes(iso: ISODate): ISODate {
  const [a, m] = iso.split('-').map(Number);
  return paraISO(new Date(Date.UTC(a, m, 0)));
}

/** Total de dias úteis do mês da data informada. */
export function diasUteisDoMes(iso: ISODate): number {
  return diasUteisEntre(primeiroDiaDoMes(iso), ultimoDiaDoMes(iso));
}

/** Dias úteis do mês já decorridos até a data, inclusive ela, se for útil. */
export function diasUteisPassadosNoMes(iso: ISODate): number {
  return diasUteisEntre(primeiroDiaDoMes(iso), iso);
}

/** Dias úteis que ainda faltam no mês depois da data (exclusiva). */
export function diasUteisRestantesNoMes(iso: ISODate): number {
  return diasUteisEntre(somarDias(iso, 1), ultimoDiaDoMes(iso));
}

/** Segunda-feira da semana da data. */
export function inicioDaSemana(iso: ISODate): ISODate {
  const dia = paraData(iso).getUTCDay(); // 0 = domingo
  const recuo = dia === 0 ? 6 : dia - 1;
  return somarDias(iso, -recuo);
}

/** Domingo da semana da data. */
export function fimDaSemana(iso: ISODate): ISODate {
  return somarDias(inicioDaSemana(iso), 6);
}

export function formatarDataBr(iso: ISODate): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export const NOMES_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function nomeDoMes(iso: ISODate): string {
  const [a, m] = iso.split('-').map(Number);
  return `${NOMES_MESES[m - 1]} de ${a}`;
}

/** Converte "R$ 1.234,56" (ou número) em número. Igual ao parseNumber do front. */
export function valorBrl(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const limpo = v.replace(/[^\d,]/g, '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

export function formatarBrl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
