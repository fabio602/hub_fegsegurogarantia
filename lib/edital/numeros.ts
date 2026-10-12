/** Conversões de números, moeda e datas no formato dos editais brasileiros. */

/** Valor em reais escrito como "1.393.413,10" ou "R$ 468.380,42" → número. */
export function parseBRL(s: string): number | null {
  const m = s.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Regex de valor monetário (com ou sem "R$"). Sempre exige os centavos. */
export const RE_MOEDA = /(?:r\$\s*)?\d{1,3}(?:\.\d{3})+,\d{2}|(?:r\$\s*)\d+,\d{2}/g;

/** "1%", "0,5 %", "1 % (um por cento)" → 1 / 0.5 */
export function parsePercentual(s: string): number | null {
  const m = s.match(/(\d+(?:,\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function arredondar2(n: number): number {
  return Math.round(n * 100 + Number.EPSILON) / 100;
}

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export interface DataHora { dia: number; mes: number; ano: number; hora?: number; minuto?: number }

/**
 * Primeira data num trecho já "dobrado" (minúsculo e sem acento).
 * Aceita "24/08/2026", "24.08.2026" e "24 de agosto de 2026".
 */
export function acharData(s: string): { data: DataHora; fim: number } | null {
  const num = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);
  const ext = /(\d{1,2})\s*(?:º|o)?\s*de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/.exec(s);
  const m = [num, ext].filter(Boolean).sort((a, b) => a!.index - b!.index)[0];
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = m === ext ? MESES[m[2]] : Number(m[2]);
  const ano = Number(m[3]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return { data: { dia, mes, ano }, fim: m.index + m[0].length };
}

/**
 * Primeiro horário num trecho dobrado: "09:00", "09:00hs", "9h30", "09h00min", "às 09 h", "10 horas".
 */
export function acharHora(s: string): { hora: number; minuto: number } | null {
  const re = /(?:^|[^\d/.,])(\d{1,2})\s*(?::|h|hs|horas?)\s*(\d{2})?(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const hora = Number(m[1]);
    const minuto = m[2] ? Number(m[2]) : 0;
    // "10 dias" não chega aqui; mas "1 h" de duração pode — horário de sessão fica entre 6h e 22h
    if (hora >= 6 && hora <= 22 && minuto < 60) return { hora, minuto };
  }
  return null;
}

const dois = (n: number) => String(n).padStart(2, '0');

/** "DD/MM/YYYY HH:MM" (ou só "DD/MM/YYYY" sem hora). */
export function formatarDataHora(d: DataHora): string {
  const base = `${dois(d.dia)}/${dois(d.mes)}/${d.ano}`;
  return d.hora != null ? `${base} ${dois(d.hora)}:${dois(d.minuto ?? 0)}` : base;
}

/**
 * Dígitos verificadores do CNPJ (aceita com ou sem máscara).
 * Pega erro de digitação da seguradora e erro de leitura do OCR.
 */
export function cnpjValido(cnpj: string | null | undefined): boolean {
  const d = String(cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}
