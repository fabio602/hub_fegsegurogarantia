/**
 * Tipos e helpers para análise de edital — sem dependência de Zod.
 * Zod é usado apenas na Edge Function (Deno), não no browser.
 */

// ── Alerta estruturado ────────────────────────────────────────────────────────
export interface Alerta {
  /**
   * dado_ausente: campo esperado não encontrado no documento
   * escala: valor existe mas escala suspeita (fator 10/100/1000)
   * plausibilidade: valor existe mas implausível para o contexto
   * juridico: ponto de atenção legal (não é prazo nem escala)
   * outro: alertas gerais
   * prazo: RESERVADO para uso interno do TypeScript — modelo não deve emitir
   */
  tipo: 'dado_ausente' | 'escala' | 'plausibilidade' | 'prazo' | 'juridico' | 'outro';
  severidade: 'info' | 'atencao' | 'bloqueante';
  /** Campo do JSON afetado, ou null se for alerta geral */
  campo_afetado: string | null;
  /** Texto do alerta, máx 300 chars */
  texto: string;
}

// ── Quatro estados para garantia de execução ─────────────────────────────────
export type GarantiaExecucaoState = boolean | 'condicionada' | null | undefined;

// ── Tipo completo da resposta do analyze-edital v9 ────────────────────────────
export interface EditalData {
  // Identificação
  orgao_nome?:                     string | null;
  orgao_cnpj?:                     string | null;
  orgao_endereco?:                 string | null;
  modalidade?:                     string | null;
  numero_edital?:                  string | null;
  numero_processo?:                string | null;
  portal_eletronico?:              string | null;
  objeto?:                         string | null;
  criterio_julgamento?:            string | null;
  sistema_registro_precos?:        boolean | null;

  // Datas
  data_sessao_publica?:            string | null;
  data_limite_propostas?:          string | null;
  prazo_impugnacao_dias?:          number | null;
  prazo_esclarecimento_dias?:      number | null;
  inversao_fases?:                 boolean | null;

  // Garantia de proposta
  exige_garantia_proposta?:        boolean;
  percentual_garantia_proposta?:   number | null;
  base_calculo_garantia?:          'global' | 'por_item' | 'nao_especificado' | null;
  modalidades_aceitas_garantia?:   string[] | null;
  vigencia_garantia_proposta_dias?: number | null;
  vigencia_garantia_termo_inicial?: string | null;
  consequencia_nao_apresentacao?:  string | null;
  hipoteses_execucao?:             string | null;

  // Valor estimado com proveniência documental obrigatória
  valor_global_edital?:            number | null;
  valor_global_edital_trecho?:     string | null;
  valor_global_edital_pagina?:     string | null;
  /** @deprecated campo interno da edge function */
  valor_global_edital_fonte?:      string | null;

  // Cálculo
  valor_garantia_proposta_calculado?: number | null;
  formula_calculo?:                string | null;

  // Validade da proposta
  validade_proposta_dias?:         number | null;
  validade_proposta_fonte?:        string | null;
  divergencia_validade_proposta?:  string | null;

  // Garantia de execução
  exige_garantia_execucao?:        GarantiaExecucaoState;
  percentual_garantia_execucao?:   number | null;

  // Outras garantias
  garantia_legal_aplicavel?:       boolean | null;
  periodo_conservacao_aplicavel?:  boolean | null;

  // Alertas estruturados (v9+) — retro-compatível com string[] (v8-)
  alertas?:                        Alerta[] | string[];
  pendencias_bloqueantes?:         string[];
  observacoes_relevantes?:         string | null;

  // Pendências e recomendações — dois níveis distintos
  /** Bloqueia o Double Check. Apenas itens que impedem a emissão. */
  pendencias_bloqueantes?:         string[];
  /** Exibe mas NÃO bloqueia. Itens de atenção operacional. */
  recomendacoes?:                  string[];

  // Campos internos
  raw?:                            string;
  raw_tail?:                       string;
  parse_error?:                    boolean;
  schema_validation_error?:        string;
}

// ── Helpers para display ─────────────────────────────────────────────────────

export function describeTriState(
  val: boolean | 'condicionada' | null | undefined,
  labels: { verdadeiro: string; falso: string; indeterminado: string; condicionada?: string }
): { text: string; kind: 'true' | 'false' | 'indeterminate' | 'conditional' } {
  if (val === true)           return { text: labels.verdadeiro, kind: 'true' };
  if (val === false)          return { text: labels.falso, kind: 'false' };
  if (val === 'condicionada') return { text: labels.condicionada ?? 'Condicionada (ver edital)', kind: 'conditional' };
  return { text: labels.indeterminado, kind: 'indeterminate' };
}

/** Cor e label por tipo de alerta */
export const ALERTA_CONFIG: Record<Alerta['tipo'], { color: string; bg: string; label: string }> = {
  dado_ausente:   { color: 'text-red-700',     bg: 'bg-red-50 border-red-200',      label: 'Ausente' },
  escala:         { color: 'text-red-700',     bg: 'bg-red-50 border-red-200',      label: 'Escala' },
  plausibilidade: { color: 'text-red-700',     bg: 'bg-red-50 border-red-200',      label: 'Plausibilidade' },
  prazo:          { color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200', label: 'Prazo' },
  juridico:       { color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',    label: 'Jurídico' },
  outro:          { color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',  label: 'Atenção' },
};

export const SEVERIDADE_ORDER: Record<Alerta['severidade'], number> = {
  bloqueante: 0, atencao: 1, info: 2,
};

/** Normaliza alertas: aceita string[] (legado) e Alerta[] (v9+) */
export function normalizeAlertas(raw: Alerta[] | string[] | undefined): Alerta[] {
  if (!raw?.length) return [];
  return (raw as unknown[]).map((a) =>
    typeof a === 'string'
      ? { tipo: 'outro' as const, severidade: 'atencao' as const, campo_afetado: null, texto: a }
      : (a as Alerta)
  );
}
