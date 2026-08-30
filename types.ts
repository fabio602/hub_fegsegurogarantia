
export interface Insurer {
  id: number;
  nome: string;
  logoUrl?: string;
  premioMinimo?: string;
  premio_minimo?: string;
  portal?: string;
  login?: string;
  senha?: string;
  gerente?: string;
  contato?: string;
  email?: string;
  obs?: string;
  ccg?: string;
  rank_position?: number | null;
  card_color?: string | null;
}

export interface GoalMonth {
  mes: string;
  meta: number;
  vendas: number;
}

/** Vendedor (tabela `sellers` no Supabase). */
export interface Seller {
  id: string;
  name: string;
  email: string | null;
  share: number;
  days_per_week: number;
  active: boolean;
  created_at?: string;
}

/** Meta mensal por vendedor (tabela `monthly_targets`). */
export interface MonthlyTarget {
  id: string;
  seller_id: string;
  year: number;
  month: number;
  target: number;
}

export interface NominationData {
  dataInicio: string;
  cidade: string;
  razaoSocial: string;
  cnpj: string;
  responsavel: string;
  telefone: string;
  email: string;
  seguradorasSelecionadas: string[];
}
export interface Sale {
  id: number;
  data: string;
  nome: string;
  origem: string;
  qualificado: string;
  tipo: string;
  is?: string;
  seguradora?: string;
  premio?: string;
  dataProposta?: string;
  vendeu: string;
  motivoPerda?: string;
  comissao?: string;
  vendedor: string;
  indicacao: string;
  limites: string;
  catalogo: string;
  vigencia_inicio?: string;
  /** Fim da vigência (coluna na tabela `sales`) */
  vigencia_fim?: string;
  /** Legado / outras tabelas — não confundir com `sales.vigencia_fim` */
  fim_vigencia?: string;
  /** Prazo do contrato garantido — informativo, não gera lembrete */
  vigencia_contrato_inicio?: string;
  vigencia_contrato_fim?: string;
  telefone?: string;
  email?: string;
  cnpj?: string;
  limites_seguradoras?: string;
  decisor?: string;
  created_at?: string;
  product_type?: string;
  process_number?: string;
  court?: string;
  valorLote?: string;
  orgaoLicitante?: string;
  dataPregao?: string;
  numeroContrato?: string;
  objetoContrato?: string;
  segurado?: string;
  valorContrato?: string;
  /** Observações internas (carteira / vendas) */
  obs?: string | null;
}


export interface LeadCost {
  key: string;
  value: number;
  created_at?: string;
}

export interface Prospect {
  id: string;
  created_at: string;
  // Data em que o lead entrou na fase/coluna atual (mantida por trigger quando `status` muda).
  status_entered_at?: string;
  name?: string;
  position?: string;
  company?: string;
  description?: string;
  country?: string;
  zip?: string;
  city?: string;
  state?: string;
  address?: string;
  status: string;
  source?: string;
  email?: string;
  website?: string;
  phonenumber?: string;
  lead_value?: number;
  tags?: string[];
  cnpj?: string;
  ramo?: string;
  segmento?: string;
  decisor?: string;
  ult_contato?: string;
  product_type?: string;
  judicial_process_number?: string;
  judicial_court?: string;
  limites_seguradoras?: string;
  tasks?: CRMTask[];
}

/** Pendências da aba Gestão de Resultados (tabela `pendencias`). */
export interface Pendencia {
  id: string;
  titulo: string;
  descricao?: string | null;
  responsavel?: string | null;
  prazo?: string | null;
  prioridade: 'alta' | 'media' | 'baixa';
  concluida: boolean;
  criado_em?: string;
  atualizado_em?: string;
}

export interface CRMTask {
  id: string;
  created_at: string;
  title: string;
  description?: string;
  due_date: string;
  status: 'pending' | 'completed';
  type: 'task' | 'call' | 'email' | 'meeting' | 'renewal';
  prospect_id?: string;
  sale_id?: number;
  /**
   * Vínculo opcional com a Agenda (assignee por nome/função).
   * Usado pela integração automática para espelhar tarefas em `agenda_tasks`.
   */
  assigned_staff_id?: string;
}

/** Leads enviados da aba Prospecção PNCP (tabela `leads_seguro_garantia`). */
export type PncpTipoLeadEnviado = 'Seguro Garantia' | 'Judicial' | 'Energia' | 'Seguro de Crédito';

export type PncpProbabilidadeSg = 'alta' | 'media' | 'verificar';

export interface PncpContratoNormalizado {
  /** Chave estável para dedup e React key */
  dedupKey: string;
  nomeRazaoSocialFornecedor: string;
  niFornecedor: string;
  objetoContrato: string;
  valorGlobal: number;
  orgaoRazaoSocial: string;
  municipioNome: string;
  ufSigla: string;
  dataAssinatura: string;
  probabilidadeSg: PncpProbabilidadeSg;
}

/** Dados enriquecidos via BrasilAPI (consulta pública de CNPJ). */
export interface BrasilApiEmpresa {
  razaoSocial: string;
  nomeFantasia: string;
  telefone: string;
  email: string;
  socioResponsavel: string;
  porte: string;
  capitalSocial: string;
  cidade: string;
  uf: string;
  cnaePrincipal: string;
  cnaeDescricao: string;
  situacao: string;
}

/** Configuração da prospecção automática PNCP (tabela `prospeccao_pncp_config`). */
export interface ProspeccaoPncpConfig {
  id: number;
  ativo: boolean;
  dry_run: boolean;
  pausado: boolean;
  pausado_motivo: string | null;
  pausado_em: string | null;
  ufs: string[];
  valor_minimo: number;
  dispensa_inexig_valor_minimo: number;
  cnae_divisoes_incluir: string[];
  cnae_divisoes_excluir: string[];
  limite_diario: number;
  max_consultas_brasilapi: number;
  pausa_entre_consultas_ms: number;
  bounce_max_percentual: number;
  bounce_min_quantidade: number;
  trilha: string;
  email_relatorio: string;
  /** Trechos que marcam o e-mail como de contabilidade (só marcação, não bloqueia). */
  email_padroes_contador: string[];
  /** Prefixos (antes do @) que marcam o e-mail como caixa genérica corporativa. */
  email_prefixos_genericos: string[];
  /** Por quantos dias um CNPJ pendente da fila migra para os dias seguintes. */
  fila_validade_dias: number;
}

/** Uma execução da prospecção automática (tabela `prospeccao_pncp_execucoes`). */
export interface ProspeccaoPncpExecucao {
  id: string;
  executado_em: string;
  data_referencia: string;
  dry_run: boolean;
  /** processando = a fila do dia ainda tem candidatos; finalizada = relatório enviado. */
  fase: 'processando' | 'finalizada';
  coletados: number;
  enriquecidos: number;
  enviados: number;
  sem_email: number;
  fora_do_perfil: number;
  bounces: number;
  erros: number;
  arquivo_relatorio: string | null;
  detalhes: Record<string, unknown> | null;
}

/** Uma campanha de garimpo no Google Maps (tabela `campanhas_garimpo`). */
export interface CampanhaGarimpo {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  dry_run: boolean;
  fonte: 'maps' | 'instagram' | 'ccee';
  /** Parágrafo do [GANCHO_ADESAO], só para leads novos no diff da fonte. */
  gancho_adesao_texto: string | null;
  /** Config da fonte (ccee: recurso_atual, recurso_anterior, diff_inicial_feito). */
  fonte_config: Record<string, unknown>;
  termos_busca: string[];
  cidades: string[];
  palavras_exclusao: string[];
  trilha: string;
  tipo_prospect: string;
  limite_diario: number;
  cadencia_garimpo_dias: number;
  exigir_cnpj: boolean;
  garimpo_cursor: number;
  garimpo_ciclo_iniciado: string | null;
  apify_run_id: string | null;
  apify_cidade: string | null;
  criado_em: string;
}

/** Uma execução diária de uma campanha (tabela `garimpo_execucoes`). */
export interface GarimpoExecucao {
  id: string;
  campanha_id: string;
  data_referencia: string;
  executado_em: string;
  dry_run: boolean;
  fase: 'processando' | 'finalizada';
  garimpados: number;
  enriquecidos: number;
  enviados: number;
  so_whatsapp: number;
  descartados: number;
  bounces: number;
  erros: number;
  arquivo_relatorio: string | null;
  detalhes: Record<string, unknown> | null;
}

/** Pausa global por domínio remetente (tabela `reputacao_envio`). */
export interface ReputacaoEnvio {
  dominio: string;
  pausado: boolean;
  pausado_motivo: string | null;
  pausado_em: string | null;
  bounce_max_percentual: number;
  bounce_min_quantidade: number;
}
