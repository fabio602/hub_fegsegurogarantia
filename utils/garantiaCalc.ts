export interface GarantiaConfig {
  taxa_anual: number;
  setup_centavos: number;
  fator_boleto: number;
  parcelas: number;
  garantidora: string;
}

export const DEFAULT_CONFIG: GarantiaConfig = {
  taxa_anual: 0.10,
  setup_centavos: 25000,
  fator_boleto: 1.291824,
  parcelas: 12,
  garantidora: 'Fiantec',
};

export interface ParcelaItem {
  numero: number;
  data_vencimento: string;
  valor_centavos: number;
}

export interface GarantiaResultCartao {
  forma: 'cartao';
  base_mensal: number;
  base_anual: number;
  premio: number;
  setup: number;
  total_avista: number;
  total_forma: number;
  parcelas: ParcelaItem[];
  parcela_display: number;
  desembolso_mensal: number;
}

export interface GarantiaResultBoleto {
  forma: 'boleto';
  base_mensal: number;
  base_anual: number;
  premio: number;
  setup: number;
  total_avista: number;
  total_forma: number;
  total_boleto: number;
  parcelas: ParcelaItem[];
  parcela_boleto: number;
  desembolso_mes1: number;
  desembolso_demais: number;
  custo_financiamento: number;
  taxa_mensal_efetiva: number;
}

export type GarantiaResult = GarantiaResultCartao | GarantiaResultBoleto;

function addMonths(base: string, months: number): string {
  const d = new Date(base + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function calcIRR(principal: number, payments: number[]): number {
  const npv = (r: number) =>
    payments.reduce((s, p, i) => s + p / Math.pow(1 + r, i + 1), -principal);
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    npv(mid) > 0 ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

export function calcGarantia(
  aluguel_centavos: number,
  outros_centavos: number,
  forma: 'cartao' | 'boleto',
  data_primeiro_pagamento: string,
  config: GarantiaConfig,
): GarantiaResult {
  const base_mensal = aluguel_centavos + outros_centavos;
  const base_anual = base_mensal * 12;
  const premio = Math.round(base_anual * config.taxa_anual);
  const setup = config.setup_centavos;
  const total_avista = premio + setup;
  const n = config.parcelas;

  if (forma === 'cartao') {
    const base_parc = Math.floor(total_avista / n);
    const resto = total_avista - base_parc * n;
    const parcelas: ParcelaItem[] = Array.from({ length: n }, (_, i) => ({
      numero: i + 1,
      data_vencimento: addMonths(data_primeiro_pagamento, i),
      valor_centavos: i === n - 1 ? base_parc + resto : base_parc,
    }));
    return {
      forma: 'cartao',
      base_mensal, base_anual, premio, setup,
      total_avista, total_forma: total_avista,
      parcelas, parcela_display: base_parc,
      desembolso_mensal: aluguel_centavos + base_parc,
    };
  }

  const total_boleto = Math.round(total_avista * config.fator_boleto);
  const base_parc = Math.floor((total_boleto - setup) / n);
  const resto = total_boleto - setup - base_parc * n;
  const parcelas: ParcelaItem[] = [
    { numero: 1, data_vencimento: addMonths(data_primeiro_pagamento, 0), valor_centavos: setup + base_parc },
    ...Array.from({ length: n - 2 }, (_, i) => ({
      numero: i + 2,
      data_vencimento: addMonths(data_primeiro_pagamento, i + 1),
      valor_centavos: base_parc,
    })),
    { numero: n, data_vencimento: addMonths(data_primeiro_pagamento, n - 1), valor_centavos: base_parc + resto },
  ];
  return {
    forma: 'boleto',
    base_mensal, base_anual, premio, setup,
    total_avista, total_forma: total_boleto, total_boleto,
    parcelas, parcela_boleto: base_parc,
    desembolso_mes1: aluguel_centavos + setup + base_parc,
    desembolso_demais: aluguel_centavos + base_parc,
    custo_financiamento: total_boleto - total_avista,
    taxa_mensal_efetiva: calcIRR(total_avista, parcelas.map(p => p.valor_centavos)),
  };
}

export function fmtBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function maskCurrency(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10);
  return (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseCurrencyMask(masked: string): number {
  const clean = masked.replace(/\./g, '').replace(',', '.');
  return Math.round(parseFloat(clean || '0') * 100);
}
