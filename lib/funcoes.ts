import { supabase } from './supabase';

/**
 * Função de cada pessoa no dia a dia (tabela hub_funcoes, migração 140).
 *
 * Diferente de lib/permissoes.ts: permissão diz o que a pessoa VÊ no menu;
 * função diz o que ela FAZ. A função decide os blocos do "Meu dia" e para quem
 * aparecem as tarefas que o hub gera sozinho. Uma pessoa pode ter várias.
 */
export type FuncaoKey = 'sdr' | 'closer' | 'operacoes' | 'residencial' | 'gestao';

export interface Funcao {
  key: FuncaoKey;
  label: string;
  descricao: string;
}

export const FUNCOES: Funcao[] = [
  { key: 'sdr', label: 'SDR', descricao: 'Primeiro contato com os leads e qualificação.' },
  { key: 'closer', label: 'Closer', descricao: 'Conduz os leads qualificados até o fechamento.' },
  { key: 'operacoes', label: 'Operações', descricao: 'Cotações, registro de vendas e pós-venda.' },
  { key: 'residencial', label: 'Residencial', descricao: 'Seguro residencial, garantia locatícia e repasses.' },
  { key: 'gestao', label: 'Gestão', descricao: 'Vê o dia de toda a equipe, com filtro por pessoa.' },
];

const CHAVES = new Set<string>(FUNCOES.map(f => f.key));

function limpar(lista: unknown): FuncaoKey[] {
  return (Array.isArray(lista) ? lista : []).filter((k): k is FuncaoKey => CHAVES.has(String(k)));
}

/** Funções de um e-mail. Lista vazia = sem função definida. */
export async function carregarFuncoes(email: string | undefined): Promise<FuncaoKey[]> {
  if (!email) return [];
  const { data, error } = await supabase
    .from('hub_funcoes')
    .select('funcoes')
    .eq('user_email', email.toLowerCase())
    .maybeSingle();
  if (error || !data) return [];
  return limpar(data.funcoes);
}

/** Funções de toda a equipe, por e-mail (minúsculo). */
export async function carregarFuncoesDaEquipe(): Promise<Record<string, FuncaoKey[]>> {
  const { data, error } = await supabase.from('hub_funcoes').select('user_email, funcoes');
  const mapa: Record<string, FuncaoKey[]> = {};
  if (error) return mapa;
  for (const l of data ?? []) mapa[String(l.user_email).toLowerCase()] = limpar(l.funcoes);
  return mapa;
}

/** Rótulos das funções, na ordem do cadastro: "SDR, Closer". */
export function rotuloFuncoes(funcoes: FuncaoKey[] | undefined): string {
  if (!funcoes?.length) return '';
  return FUNCOES.filter(f => funcoes.includes(f.key)).map(f => f.label).join(', ');
}
