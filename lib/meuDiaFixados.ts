import { supabase } from './supabase';

/**
 * Itens fixados no topo do "Meu dia" (tabela meu_dia_fixados, migração 141).
 * É uma marcação pessoal: não altera o lead nem a tarefa de pós-venda.
 */
export type TipoFixado = 'lead' | 'posvenda';

export const chaveFixado = (tipo: TipoFixado, id: string | number): string => `${tipo}:${id}`;

/** Chaves ("lead:<id>") dos itens fixados por um e-mail. */
export async function carregarFixados(email: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('meu_dia_fixados').select('tipo, item_id').eq('user_email', email.toLowerCase());
  if (error) return new Set();
  return new Set((data || []).map(l => chaveFixado(l.tipo as TipoFixado, l.item_id)));
}

/** Fixa ou solta um item. Devolve a mensagem de erro, ou null se deu certo. */
export async function gravarFixado(email: string, tipo: TipoFixado, id: string | number, fixar: boolean): Promise<string | null> {
  const linha = { user_email: email.toLowerCase(), tipo, item_id: String(id) };
  const { error } = fixar
    ? // ignoreDuplicates: fixar duas vezes não é erro, e a tabela não tem política de UPDATE.
      await supabase.from('meu_dia_fixados').upsert(linha, { onConflict: 'user_email,tipo,item_id', ignoreDuplicates: true })
    : await supabase.from('meu_dia_fixados').delete().eq('user_email', linha.user_email).eq('tipo', tipo).eq('item_id', linha.item_id);
  return error ? error.message : null;
}
