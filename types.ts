
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
  limites_seguradoras?: string;
  created_at?: string;
}


export interface LeadCost {
  key: string;
  value: number;
  created_at?: string;
}
