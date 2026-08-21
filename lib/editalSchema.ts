/**
 * Schema Zod — fonte única de verdade entre front e Edge Function.
 * v2: alertas estruturados (objeto tipado em vez de string livre).
 */

import { z } from 'zod';

// ── Alerta estruturado ────────────────────────────────────────────────────────
export const AlertaSchema = z.object({
  tipo: z.enum(['escala', 'plausibilidade', 'prazo', 'juridico', 'outro']),
  severidade: z.enum(['info', 'atencao', 'bloqueante']),
  /** Campo do JSON afetado, ou null se for alerta geral */
  campo_afetado: z.string().nullable(),
  /** Texto do alerta, máx 300 chars */
  texto: z.string().max(300),
});
export type Alerta = z.infer<typeof AlertaSchema>;

// ── Três estados para booleanos de decisão ────────────────────────────────────
export const TriState = z.union([z.boolean(), z.null()]).optional();
export const GarantiaExecucaoState = z
  .union([z.boolean(), z.literal('condicionada'), z.null()])
  .optional();

// ── Schema completo ───────────────────────────────────────────────────────────
export const EditalDataSchema = z.object({
  // Identificação
  orgao_nome:                     z.string().nullable().optional(),
  orgao_cnpj:                     z.string().nullable().optional(),
  orgao_endereco:                 z.string().nullable().optional(),
  modalidade:                     z.string().nullable().optional(),
  numero_edital:                  z.string().nullable().optional(),
  numero_processo:                z.string().nullable().optional(),
  portal_eletronico:              z.string().nullable().optional(),
  objeto:                         z.string(),
  criterio_julgamento:            z.string().nullable().optional(),
  sistema_registro_precos:        z.boolean().nullable().optional(),

  // Datas
  data_sessao_publica:            z.string().nullable().optional(),
  data_limite_propostas:          z.string().nullable().optional(),
  prazo_impugnacao_dias:          z.number().nullable().optional(),
  prazo_esclarecimento_dias:      z.number().nullable().optional(),
  inversao_fases:                 z.boolean().nullable().optional(),

  // Garantia de proposta
  exige_garantia_proposta:        z.boolean(), // OBRIGATÓRIO — falha alto se ausente
  percentual_garantia_proposta:   z.number().nullable().optional(),
  base_calculo_garantia:          z.enum(['global','por_item','nao_especificado']).nullable().optional(),
  modalidades_aceitas_garantia:   z.array(z.string()).nullable().optional(),
  vigencia_garantia_proposta_dias: z.number().nullable().optional(),
  vigencia_garantia_termo_inicial: z.string().nullable().optional(),
  consequencia_nao_apresentacao:  z.string().nullable().optional(),
  hipoteses_execucao:             z.string().nullable().optional(),

  // Valor estimado — exige proveniência documental
  valor_global_edital:            z.number().nullable().optional(),
  /** Trecho literal do documento que sustenta o valor. OBRIGATÓRIO se valor != null. */
  valor_global_edital_trecho:     z.string().max(200).nullable().optional(),
  /** Localização no documento (ex: "Item 5.3, página 8"). OBRIGATÓRIO se valor != null. */
  valor_global_edital_pagina:     z.string().nullable().optional(),

  // Cálculo
  valor_garantia_proposta_calculado: z.number().nullable().optional(),
  formula_calculo:                z.string().nullable().optional(),

  // Validade da proposta
  validade_proposta_dias:         z.number().nullable().optional(),
  validade_proposta_fonte:        z.string().max(150).nullable().optional(),
  divergencia_validade_proposta:  z.string().nullable().optional(),

  // Garantia de execução
  exige_garantia_execucao:        GarantiaExecucaoState,
  percentual_garantia_execucao:   z.number().nullable().optional(),

  // Outras garantias
  garantia_legal_aplicavel:       z.boolean().nullable().optional(),
  periodo_conservacao_aplicavel:  z.boolean().nullable().optional(),

  // Alertas ESTRUTURADOS (não mais strings livres)
  alertas:                        z.array(AlertaSchema).default([]),
  pendencias_bloqueantes:         z.array(z.string()).default([]),
  observacoes_relevantes:         z.string().nullable().optional(),

  // Campos internos
  raw:                            z.string().optional(),
  parse_error:                    z.boolean().optional(),
  schema_validation_error:        z.string().optional(),
});

export type EditalData = z.infer<typeof EditalDataSchema>;

// ── Helpers para display ─────────────────────────────────────────────────────

export function describeTriState(
  val: boolean | 'condicionada' | null | undefined,
  labels: { verdadeiro: string; falso: string; indeterminado: string; condicionada?: string }
): { text: string; kind: 'true' | 'false' | 'indeterminate' | 'conditional' } {
  if (val === true)          return { text: labels.verdadeiro, kind: 'true' };
  if (val === false)         return { text: labels.falso, kind: 'false' };
  if (val === 'condicionada') return { text: labels.condicionada ?? 'Condicionada (ver edital)', kind: 'conditional' };
  return { text: labels.indeterminado, kind: 'indeterminate' };
}

/** Cor e label por tipo de alerta */
export const ALERTA_CONFIG: Record<Alerta['tipo'], { color: string; bg: string; label: string }> = {
  escala:         { color: 'text-red-700',    bg: 'bg-red-50 border-red-200',     label: 'Escala' },
  plausibilidade: { color: 'text-red-700',    bg: 'bg-red-50 border-red-200',     label: 'Plausibilidade' },
  prazo:          { color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', label: 'Prazo' },
  juridico:       { color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',   label: 'Jurídico' },
  outro:          { color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200', label: 'Atenção' },
};

export const SEVERIDADE_ORDER: Record<Alerta['severidade'], number> = {
  bloqueante: 0, atencao: 1, info: 2,
};
