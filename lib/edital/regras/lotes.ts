/**
 * Valor estimado de cada lote, para editais cuja garantia incide sobre
 * "o(s) lote(s) em que o licitante participar".
 *
 * Formatos cobertos:
 *  - título "LOTE 1 – descrição" e, mais adiante no mesmo bloco, "SUBTOTAL R$ X"
 *    (ou "TOTAL DO LOTE", "VALOR TOTAL DO LOTE", "VALOR ESTIMADO DO LOTE");
 *  - quadro-resumo com o valor na própria linha: "LOTE 01 ... R$ 379.550,00".
 * O mesmo lote costuma reaparecer no modelo de proposta com "R$ ......"; vale o
 * primeiro bloco que traz valor. Se a soma dos lotes não fecha com o valor global,
 * o resultado é devolvido mesmo assim, e o chamador emite o alerta.
 */
import { Documento, ocorrencias, paginaDe } from '../documento.ts';
import { parseBRL, RE_MOEDA } from '../numeros.ts';

export interface Lote { numero: number; descricao: string | null; valor: number; pagina: number }

const RE_TITULO = /(?:^|\n)\s*lote\s*(?:n[º°o.]*\s*)?0*(\d{1,3})\b\s*[-–—:.]?\s*([^\n]*)/g;
const RE_TOTAL_LOTE = /sub\s*-?\s*total|total\s+(?:estimado\s+)?do\s+lote|valor\s+(?:total|global|estimado|maximo)\s+(?:estimado\s+)?do\s+lote|total\s+lote/;

export function extrairLotes(doc: Documento): Lote[] {
  const titulos = ocorrencias(doc, RE_TITULO).map(m => ({
    numero: Number(m[1]),
    ini: m.index + (m[0].startsWith('\n') ? 1 : 0),
    fimLinha: m.index + m[0].length,
  }));
  const achados = new Map<number, Lote>();

  titulos.forEach((t, i) => {
    if (achados.has(t.numero) || t.numero < 1 || t.numero > 200) return;
    const linha = doc.texto.slice(t.ini, t.fimLinha);
    const descricao = linha.replace(/^\s*lote\s*(?:n[º°o.]*\s*)?0*\d{1,3}\b\s*[-–—:.]?\s*/i, '')
      .replace(new RegExp(RE_MOEDA.source, 'gi'), '').replace(/\s+/g, ' ').trim() || null;

    // 1) Valor na própria linha (quadro-resumo)
    const naLinha = [...doc.busca.slice(t.ini, t.fimLinha).matchAll(new RegExp(RE_MOEDA.source, 'g'))];
    if (naLinha.length) {
      const v = parseBRL(naLinha[naLinha.length - 1][0]);
      if (v != null && v >= 100) {
        achados.set(t.numero, { numero: t.numero, descricao, valor: v, pagina: paginaDe(doc, t.ini) });
        return;
      }
    }

    // 2) Subtotal no bloco do lote (até o próximo título ou 15 mil caracteres)
    const fimBloco = Math.min(titulos[i + 1]?.ini ?? doc.texto.length, t.ini + 15000);
    let melhor: { valor: number; pos: number } | null = null;
    for (const m of ocorrencias(doc, new RegExp(RE_TOTAL_LOTE.source, 'g'), t.fimLinha, fimBloco)) {
      const depois = doc.busca.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const mm = new RegExp(RE_MOEDA.source).exec(depois);
      if (!mm || /\n.*\n/.test(depois.slice(0, mm.index))) continue;
      const v = parseBRL(mm[0]);
      if (v != null && v >= 100) melhor = { valor: v, pos: m.index }; // o último do bloco fecha o lote
    }
    if (melhor) achados.set(t.numero, { numero: t.numero, descricao, valor: melhor.valor, pagina: paginaDe(doc, melhor.pos) });
  });

  const lotes = [...achados.values()].sort((a, b) => a.numero - b.numero);
  // Um lote só não serve para escolher combinação; numeração com buraco indica leitura incompleta
  if (lotes.length < 2) return [];
  return lotes;
}
