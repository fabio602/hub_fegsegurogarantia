/**
 * Tipos e helpers da tela Radar (Fases 1 e 2).
 *
 * Espelham as tabelas radar_empresas e radar_inscricoes (migração 075) e
 * radar_processos, radar_processo_movimentos, radar_processo_advogados e
 * radar_pje_fila (migração 079).
 */

export type RadarStatus = 'novo' | 'excluido' | 'enviado_kanban' | 'descartado';
export type DossieStatus = 'nenhum' | 'fila' | 'pronto' | 'sem_processos' | 'erro';
export type GarantiaInformada = 'seguro' | 'penhora' | 'deposito' | 'fianca' | 'nenhuma' | 'nao_sei';

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
  // Fase 2 (PJe TRF3)
  dossie_status: DossieStatus;
  dossie_em: string | null;
  qtd_execucoes: number;
  qtd_embargos: number;
  garantia_informada: GarantiaInformada | null;
  garantia_obs: string | null;
  garantia_informada_em: string | null;
}

export interface RadarProcesso {
  id: number;
  numero_cnj: string;
  classe_codigo: number | null;
  classe_nome: string | null;
  assunto: string | null;
  jurisdicao: string | null;
  orgao_julgador: string | null;
  data_distribuicao: string | null;
  polo_passivo_nome: string | null;
  cnpj_mascarado: string | null;
  ultima_movimentacao_texto: string | null;
  ultima_movimentacao_em: string | null;
  qtd_movimentacoes: number | null;
  capturado_em: string;
}

export interface RadarMovimento {
  id: number;
  processo_id: number;
  ocorrido_em: string;
  texto: string;
}

export interface RadarAdvogadoProcesso {
  id: number;
  processo_id: number;
  nome: string;
  oab: string | null;
  polo: string | null;
}

/** Linha da vw_radar_advogados. */
export interface RadarAdvogadoResumo {
  nome: string;
  oab: string | null;
  processos: number;
  empresas: number;
}

export type DossieFiltro = '' | 'pronto' | 'com_embargos' | 'fila' | 'sem_processos';

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
  /** Fase 2: '' = todos. */
  dossie: DossieFiltro;
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
  dossie: '',
};

export const DOSSIE_FILTRO_LABEL: Record<DossieFiltro, string> = {
  '': 'Todos',
  pronto: 'Pronto',
  com_embargos: 'Com embargos',
  fila: 'Na fila',
  sem_processos: 'Sem processos',
};

export const DOSSIE_LABEL: Record<DossieStatus, string> = {
  nenhum: 'Sem dossiê',
  fila: 'Na fila',
  pronto: 'Pronto',
  sem_processos: 'Sem processos',
  erro: 'Erro',
};

/** Cores do dossiê conforme a especificação: fila blue, pronto emerald, erro amber, resto cinza. */
export const DOSSIE_CLASSES: Record<DossieStatus, string> = {
  nenhum: 'bg-slate-100 text-slate-600 border-slate-200',
  fila: 'bg-blue-50 text-blue-700 border-blue-200',
  pronto: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sem_processos: 'bg-slate-100 text-slate-600 border-slate-200',
  erro: 'bg-amber-50 text-amber-800 border-amber-200',
};

export const GARANTIA_OPCOES: { valor: GarantiaInformada; label: string }[] = [
  { valor: 'seguro', label: 'Seguro garantia' },
  { valor: 'penhora', label: 'Penhora' },
  { valor: 'deposito', label: 'Depósito judicial' },
  { valor: 'fianca', label: 'Fiança bancária' },
  { valor: 'nenhuma', label: 'Nenhuma' },
  { valor: 'nao_sei', label: 'Não sei' },
];

export const GARANTIA_LABEL: Record<GarantiaInformada, string> = Object.fromEntries(
  GARANTIA_OPCOES.map(o => [o.valor, o.label]),
) as Record<GarantiaInformada, string>;

/** Classe do processo em texto curto para badge. */
export const classeCurta = (codigo: number | null): string =>
  codigo === 1118 ? 'Embargos' : codigo === 1116 ? 'Execução Fiscal' : 'Processo';

/**
 * Leitura automática do dossiê, em uma frase (especificação da Fase 2).
 * Devolve null quando ainda não há dossiê.
 */
export const leituraDossie = (e: Pick<RadarEmpresa, 'dossie_status' | 'qtd_execucoes' | 'qtd_embargos'>): string | null => {
  if (e.qtd_embargos > 0) {
    return 'Há embargos: a empresa já garantiu o juízo em pelo menos um processo. Perguntar ao advogado qual garantia e quando vence.';
  }
  if (e.qtd_execucoes > 0) {
    return 'Execução em curso sem embargos localizados: risco de penhora ou bloqueio. Oferecer seguro garantia para garantir o juízo.';
  }
  if (e.dossie_status === 'sem_processos') {
    return 'Nenhuma execução fiscal federal localizada desde 2021 no TRF3.';
  }
  return null;
};

/** Dossiê pronto há mais de 30 dias pode ser atualizado. */
export const dossieAntigo = (dossieEm: string | null): boolean =>
  !!dossieEm && Date.now() - new Date(dossieEm).getTime() > 30 * 24 * 60 * 60 * 1000;

/** '2026-09-13T16:40:00+00:00' -> '13/09/2026 13:40' no fuso do navegador. */
export const formatDataHoraBr = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
