/**
 * Valor estimado da contratação (valor_global_edital).
 *
 * Princípio herdado do analyze-edital: a única fonte válida é o número que o órgão
 * declarou como valor estimado/total — em qualquer parte do edital, inclusive anexos.
 * Cada rótulo forte ("Total Geral", "valor total estimado", "custo estimado total"...)
 * vota no primeiro valor em reais logo depois dele; vence o valor com mais votos
 * ponderados. Preço de proposta, "até R$ X" (limites legais) e valores de lance ficam fora.
 */
import { Documento, ocorrencias, paginaDe, trecho } from '../documento.ts';
import { parseBRL, RE_MOEDA } from '../numeros.ts';
import type { Evidencia } from '../../editalSchema.ts';

const ROTULOS: { re: RegExp; peso: number }[] = [
  { re: /total\s+geral/g, peso: 5 },
  { re: /valor\s+total\s+estimad[oa]/g, peso: 5 },
  { re: /custo\s+(?:total\s+)?estimad[oa]\s+(?:total\s+)?(?:da|de|para\s+a)\s+contratacao/g, peso: 5 },
  { re: /valor\s+global\s+estimad[oa]/g, peso: 5 },
  { re: /valor\s+(?:total|global)\s+da\s+(?:contratacao|licitacao|aquisicao)/g, peso: 5 },
  { re: /valor\s+estimad[oa]\s+(?:total\s+)?(?:da|de|para\s+a)\s+(?:contratacao|licitacao|aquisicao|obra|servico)/g, peso: 4 },
  { re: /valor\s+(?:maximo|global|total)\s+(?:estimado\s+)?(?:do\s+certame|do\s+objeto|do\s+edital)/g, peso: 4 },
  { re: /valor\s+de\s+referencia\s+(?:total|global)/g, peso: 4 },
  { re: /orcamento\s+(?:estimado|base|de\s+referencia)/g, peso: 3 },
  { re: /valor\s+(?:total\s+)?estimad[oa]/g, peso: 2 },
  { re: /(?:^|\n)\s*total\b/g, peso: 1 },
];

/** O que fica entre o rótulo e o número e desqualifica o voto. */
const RE_DESQUALIFICA =
  /\bate\b|limite|proposta|lance|unitari|por\s+item|do\s+item|\bitem\b|contrato|mensal|anual|minimo|patrimonio|capital|sem\s+bdi|do\s+bdi|multa|lote\s*\d/;

export interface ResultadoValor {
  valor: number;
  evidencia: Evidencia;
  /** Outros valores com voto forte (≥ 4), para alerta de divergência */
  alternativos: { valor: number; pagina: number }[];
}

export function extrairValorGlobal(doc: Documento): ResultadoValor | null {
  type Voto = { valor: number; peso: number; ini: number; fim: number };
  const votos: Voto[] = [];
  const usados = new Set<number>(); // um número só vota uma vez por rótulo mais forte

  for (const { re, peso } of ROTULOS) {
    for (const m of ocorrencias(doc, re)) {
      const ini = m.index + m[0].length;
      const janela = doc.busca.slice(ini, ini + 170);
      const mm = new RegExp(RE_MOEDA.source).exec(janela);
      if (!mm) continue;
      const pos = ini + mm.index;
      if (usados.has(pos)) continue;
      const entre = janela.slice(0, mm.index);
      if (RE_DESQUALIFICA.test(entre)) continue;
      // Texto entre rótulo e número não pode atravessar outra frase longa
      if (entre.length > 120 && !/\n/.test(entre.slice(-40))) continue;
      const valor = parseBRL(mm[0]);
      if (valor == null || valor < 100) continue;
      usados.add(pos);
      votos.push({ valor, peso, ini: m.index, fim: pos + mm[0].length });
    }
  }
  if (!votos.length) return null;

  const placar = new Map<number, { total: number; melhor: Voto }>();
  for (const v of votos) {
    const p = placar.get(v.valor);
    if (!p) placar.set(v.valor, { total: v.peso, melhor: v });
    else {
      p.total += v.peso;
      if (v.peso > p.melhor.peso) p.melhor = v;
    }
  }
  const ordenado = [...placar].sort((a, b) => b[1].total - a[1].total || b[0] - a[0]);
  const [valor, { melhor }] = ordenado[0];
  // Precisa de pelo menos um rótulo forte; "Total" solto numa tabela não basta
  if (melhor.peso < 2) return null;

  return {
    valor,
    evidencia: { trecho: trecho(doc, melhor.ini, melhor.fim, 150), pagina: paginaDe(doc, melhor.ini) },
    alternativos: ordenado.slice(1)
      .filter(([, p]) => p.melhor.peso >= 4)
      .map(([v, p]) => ({ valor: v, pagina: paginaDe(doc, p.melhor.ini) })),
  };
}
