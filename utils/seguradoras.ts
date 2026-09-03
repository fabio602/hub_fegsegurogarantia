/**
 * Seguradora é texto em `sales.seguradora`, mas o nome válido é o do painel
 * (tabela `insurers`). Este helper casa um texto livre (PDF importado,
 * minuta lida por IA, registro antigo) com um nome do painel. Se não
 * reconhecer, devolve o texto como veio: a tela mostra como "(nome antigo)"
 * e nada se perde. Migração 064 normalizou o histórico com o mesmo critério.
 */

const GENERICAS = new Set(['seguradora', 'seguros', 'seguro', 'cia', 'companhia', 'sa', 's']);

/** Chave de comparação: sem acento, minúscula, só letras e números. */
function chave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Grafias erradas frequentes que não batem nem pela primeira palavra. */
const APELIDOS: Record<string, string> = {
  potencial: 'pottencial',
};

export function normalizarSeguradora(
  texto: string | null | undefined,
  nomesDoPainel: string[],
): string {
  const bruto = (texto || '').trim();
  if (!bruto) return '';
  const alvo = chave(bruto);
  const exato = nomesDoPainel.find(n => chave(n) === alvo);
  if (exato) return exato;

  const palavra = alvo.split(' ').find(p => !GENERICAS.has(p));
  if (!palavra) return bruto;
  const primeira = APELIDOS[palavra] || palavra;
  const porPalavra = nomesDoPainel.find(n => chave(n).split(' ').includes(primeira));
  return porPalavra || bruto;
}

/** True quando o texto já é exatamente um nome do painel. */
export function seguradoraNoPainel(texto: string | null | undefined, nomesDoPainel: string[]): boolean {
  const t = (texto || '').trim();
  return !!t && nomesDoPainel.includes(t);
}
