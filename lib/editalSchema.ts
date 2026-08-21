/**
 * Schema Zod para análise de edital (analyze-edital v6+).
 * Fonte única de verdade entre o front e a Edge Function.
 *
 * Regra: campo booleano de decisão NUNCA tem só dois estados.
 * true   = confirmado pelo documento
 * false  = explicitamente ausente/negado
 * null   = indeterminado (documento omisso ou ambíguo)
 * "condicionada" = campo existe mas depende de condição não resolvida no edital
 */

import { z } from 'zod';

// Booleano de três estados para campos de decisão
export const TriState = z.union([z.boolean(), z.null()]).optional();

// Booleano de quatro estados para garantia de execução (pode ser condicionada)
export const GarantiaExecucaoState = z
  .union([z.boolean(), z.literal('condicionada'), z.null()])
  .optional();

export const EditalDataSchema = z.object({
  // Identificação do certame
  orgao_nome:                    z.string().nullable().optional(),
  orgao_cnpj:                    z.string().nullable().optional(),
  orgao_endereco:                z.string().nullable().optional(),
  modalidade:                    z.string().nullable().optional(),
  numero_edital:                 z.string().nullable().optional(),
  numero_processo:               z.string().nullable().optional(),
  portal_eletronico:             z.string().nullable().optional(),
  objeto:                        z.string(),
  criterio_julgamento:           z.string().nullable().optional(),
  sistema_registro_precos:       z.boolean().nullable().optional(),

  // Datas críticas
  data_sessao_publica:           z.string().nullable().optional(),
  data_limite_propostas:         z.string().nullable().optional(),
  prazo_impugnacao_dias:         z.number().nullable().optional(),
  prazo_esclarecimento_dias:     z.number().nullable().optional(),
  inversao_fases:                z.boolean().nullable().optional(),

  // Garantia de proposta (bid bond, art. 58)
  // Campo obrigatório: se vier undefined, falha alto e visível
  exige_garantia_proposta:       z.boolean(),
  percentual_garantia_proposta:  z.number().nullable().optional(),
  base_calculo_garantia:         z.enum(['global', 'por_item', 'nao_especificado']).nullable().optional(),
  modalidades_aceitas_garantia:  z.array(z.string()).nullable().optional(),
  vigencia_garantia_proposta_dias: z.number().nullable().optional(),
  vigencia_garantia_termo_inicial: z.string().nullable().optional(),
  consequencia_nao_apresentacao: z.string().nullable().optional(),
  hipoteses_execucao:            z.string().nullable().optional(),

  // Cálculo do valor
  valor_global_edital:           z.number().nullable().optional(),
  valor_global_edital_fonte:     z.string().nullable().optional(),
  valor_garantia_proposta_calculado: z.number().nullable().optional(),
  formula_calculo:               z.string().nullable().optional(),

  // Validade da proposta (taxonomia separada, art. 59)
  validade_proposta_dias:        z.number().nullable().optional(),
  validade_proposta_fonte:       z.string().nullable().optional(),
  divergencia_validade_proposta: z.string().nullable().optional(),

  // Garantia de execução (performance bond, art. 96/98) — campo condicional
  exige_garantia_execucao:       GarantiaExecucaoState,
  percentual_garantia_execucao:  z.number().nullable().optional(),

  // Outras garantias (taxonomia separada)
  garantia_legal_aplicavel:      z.boolean().nullable().optional(),
  periodo_conservacao_aplicavel: z.boolean().nullable().optional(),

  // Meta / auditoria
  alertas:                       z.array(z.string().max(300)).default([]),
  pendencias_bloqueantes:        z.array(z.string()).default([]),
  observacoes_relevantes:        z.string().nullable().optional(),

  // Campos internos (parse e erro)
  raw:                           z.string().optional(),
  parse_error:                   z.boolean().optional(),
  schema_validation_error:       z.string().optional(),
});

export type EditalData = z.infer<typeof EditalDataSchema>;

/** Retorna `true` apenas quando explicitamente true. `null/undefined/false` = não exige. */
export function isExige(val: boolean | null | undefined): boolean {
  return val === true;
}

/** Retorna `false` apenas quando explicitamente false. Qualquer outra coisa = indeterminado. */
export function isExplicitlyFalse(val: boolean | null | undefined): boolean {
  return val === false;
}

/** Descrição do estado de um campo booleano de decisão para exibição na UI. */
export function describeTriState(
  val: boolean | 'condicionada' | null | undefined,
  labels: { verdadeiro: string; falso: string; indeterminado: string; condicionada?: string }
): { text: string; kind: 'true' | 'false' | 'indeterminate' | 'conditional' } {
  if (val === true) return { text: labels.verdadeiro, kind: 'true' };
  if (val === false) return { text: labels.falso, kind: 'false' };
  if (val === 'condicionada') return { text: labels.condicionada ?? 'Condicionada (ver edital)', kind: 'conditional' };
  return { text: labels.indeterminado, kind: 'indeterminate' };
}
