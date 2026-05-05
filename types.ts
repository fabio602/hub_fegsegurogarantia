
export interface Insurer {
  id: number;
  nome: string;
  logoUrl?: string;
  premioMinimo?: string;
  portal?: string;
  login?: string;
  senha?: string;
  gerente?: string;
  contato?: string;
  email?: string;
  obs?: string;
  ccg?: string;
}

export interface GoalMonth {
  mes: string;
  meta: number;
  vendas: number;
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
