/**
 * Tipos e helpers da tela Radar (Fase 1).
 *
 * Espelham as tabelas radar_empresas e radar_inscricoes da migração 075.
 */

export type RadarStatus = 'novo' | 'excluido' | 'enviado_kanban' | 'descartado';

export interface RadarSocio {
  nome: string;
  qualificacao: string | null;
}

export interface RadarEmpresa {
  cnpj: string;
  nome_devedor: string;
  uf: string | null;
  competencia_ultima: string;
  qtd_inscricoes: number;
  valor_total: number;
  data_inscricao_mais_recente: string | null;
  tem_garantia: boolean;
  receitas: string[];
  score: number;
  enriquecido_em: string | null;
  enriquecimento_erro: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnae_principal: string | null;
  cnae_descricao: string | null;
  porte: string | null;
  optante_simples: boolean | null;
  optante_mei: boolean | null;
  situacao_cadastral: string | null;
  municipio: string | null;
  email: string | null;
  telefone: string | null;
  socios: RadarSocio[] | null;
  status: RadarStatus;
  motivo_exclusao: string | null;
  prospect_id: string | null;
  atualizado_em: string;
}

export interface RadarInscricao {
  id: number;
  numero_inscricao: string;
  receita_principal: string | null;
  tipo_situacao: string | null;
  situacao: string | null;
  data_inscricao: string | null;
  valor_consolidado: number;
}

export interface RadarFiltros {
  busca: string;
  uf: string;
  valorMin: string;
  valorMax: string;
  somenteGarantia: boolean;
  /** Vazio = todos os status visíveis. */
  status: RadarStatus[];
  /** Vazio = qualquer receita. */
  receitas: string[];
  mostrarExcluidos: boolean;
}

export const FILTROS_INICIAIS: RadarFiltros = {
  busca: '',
  uf: '',
  valorMin: '',
  valorMax: '',
  somenteGarantia: false,
  status: [],
  receitas: [],
  mostrarExcluidos: false,
};

export const POR_PAGINA = 50;

export const RECEITAS = ['PIS', 'COFINS', 'IPI'] as const;

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

/** Status que o usuário escolhe no filtro. Excluído entra só com "mostrar excluídos". */
export const STATUS_FILTRAVEIS: RadarStatus[] = ['novo', 'enviado_kanban', 'descartado'];

export const STATUS_LABEL: Record<RadarStatus, string> = {
  novo: 'Novo',
  enviado_kanban: 'No Kanban',
  descartado: 'Descartado',
  excluido: 'Excluído',
};

/**
 * Cor por status, conforme o mapa semântico do CLAUDE.md: emerald é sucesso
 * (foi para o Kanban), amber é alerta (descartado à mão), cinza é o que saiu
 * pelo filtro automático, blue é informação (ainda novo). Sem vermelho.
 */
export const STATUS_CLASSES: Record<RadarStatus, string> = {
  novo: 'bg-blue-50 text-blue-700 border-blue-200',
  enviado_kanban: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  descartado: 'bg-amber-50 text-amber-800 border-amber-200',
  excluido: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const MOTIVO_LABEL: Record<string, string> = {
  simples_nacional: 'Optante do Simples ou MEI',
  financeiro: 'Atividade financeira (CNAE 64/65)',
  cadastro_inativo: 'Cadastro não ativo na Receita',
  cnpj_nao_encontrado: 'CNPJ não encontrado na BrasilAPI',
  recuperacao_judicial: 'Empresa em recuperação judicial',
};

export const formatCnpj = (cnpj: string): string => {
  const d = (cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

/** '2024-03-05' -> '05/03/2024'. Sem fuso: a data vem como date do Postgres. */
export const formatDataBr = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  if (!a || !m || !d) return iso;
  return `${d}/${m}/${a}`;
};

/** '202506' -> '06/2025'. */
export const formatCompetencia = (c: string | null | undefined): string => {
  if (!c || c.length !== 6) return c ?? '';
  return `${c.slice(4, 6)}/${c.slice(0, 4)}`;
};

/** Receitas resumidas (PIS, COFINS, IPI) a partir dos textos completos da PGFN. */
export const receitasResumo = (receitas: string[] | null | undefined): string[] =>
  RECEITAS.filter(r => (receitas ?? []).some(t => t.toUpperCase().includes(r)));

export const nomeExibicao = (e: Pick<RadarEmpresa, 'razao_social' | 'nome_devedor'>): string =>
  e.razao_social || e.nome_devedor;

/** Texto livre da busca não pode carregar os separadores da sintaxe do PostgREST. */
export const sanitizarBusca = (s: string): string => s.replace(/[,().*\\%]/g, ' ').trim();
