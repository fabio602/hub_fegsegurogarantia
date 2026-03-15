
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
  vigencia_fim?: string;
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
}


export interface LeadCost {
  key: string;
  value: number;
  created_at?: string;
}

export interface Prospect {
  id: string;
  created_at: string;
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
  decisor?: string;
  ult_contato?: string;
  product_type?: string;
  judicial_process_number?: string;
  judicial_court?: string;
  tasks?: CRMTask[];
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
}
