/**
 * Tipos e constantes do funil de leads de saúde.
 *
 * Os rótulos de status são gravados ACENTUADOS no banco (migração 087) e a
 * constraint da tabela usa exatamente estas strings. Não existe mapa de
 * tradução de propósito: o que está na tela é o que está na coluna.
 */

export const STATUS = [
  'Novo',
  'Contato feito',
  'Cotação enviada',
  'Documentação',
  'Entrevista médica',
  'Implantado',
  'Perdido',
] as const;

export type Status = typeof STATUS[number];

/**
 * Cor de cada coluna.
 *
 * Semântica do projeto: gold é identidade e nunca estado, emerald é sucesso,
 * rose é erro, blue é informação. `Entrevista médica` leva blue por ser a
 * etapa que depende de terceiro, não do escritório. As classes estão escritas
 * inteiras porque o Tailwind é compilado no build e não enxerga nome montado
 * por interpolação.
 */
export const CABECALHO_COLUNA: Record<Status, string> = {
  'Novo': 'border-t-2 border-navy/20',
  'Contato feito': 'border-t-2 border-navy/20',
  'Cotação enviada': 'border-t-2 border-navy/20',
  'Documentação': 'border-t-2 border-navy/20',
  'Entrevista médica': 'border-t-2 border-blue-400',
  'Implantado': 'border-t-2 border-emerald-500',
  'Perdido': 'border-t-2 border-rose-400',
};

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string | null;
  empresa: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  cnae_principal: string | null;
  porte: string | null;
  site: string | null;
  contato: string | null;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  vidas: number | null;
  tem_plano_atual: boolean | null;
  operadora_atual: string | null;
  valor_atual: number | null;
  mes_renovacao: number | null;
  plano_interesse: string | null;
  status: Status;
  status_entered_at: string | null;
  origem: string | null;
  proxima_acao: string | null;
  observacoes: string | null;
  motivo_perda: string | null;
  vigencia_prevista: string | null;
  vidas_implantadas: number | null;
  valor_mensal: number | null;
  implantado_em: string | null;
}

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Dias inteiros desde uma data ISO. Devolve null quando não há data. */
export function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

/** CNPJ só com dígitos no banco; a máscara é coisa de exibição. */
export function mascararCnpj(digitos: string | null): string {
  if (!digitos) return '';
  const d = digitos.replace(/\D/g, '');
  if (d.length !== 14) return digitos;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Renovação no mês corrente ou no seguinte, que é quando vale ligar. */
export function renovacaoProxima(mes: number | null): boolean {
  if (!mes) return false;
  const atual = new Date().getMonth() + 1;
  const seguinte = atual === 12 ? 1 : atual + 1;
  return mes === atual || mes === seguinte;
}
