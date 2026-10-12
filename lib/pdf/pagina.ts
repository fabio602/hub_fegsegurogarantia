/**
 * Desenha uma página do PDF como imagem e calcula onde está um trecho de texto
 * nela, para o visualizador "ver trecho" destacar a origem de cada dado.
 */
import { getDocumentProxy } from 'unpdf';
import { dobrar } from '../edital/documento.ts';

export interface Destaque { x: number; y: number; w: number; h: number } // em % da página
export interface PaginaDesenhada { imagem: string; largura: number; altura: number; destaques: Destaque[] }

const normalizar = (s: string) => dobrar(s).replace(/…/g, ' ').replace(/\s+/g, ' ').trim();

/** Localiza `trecho` no texto da página; tenta o trecho inteiro e depois pedaços do meio. */
function acharTrecho(texto: string, trecho: string): [number, number] | null {
  const alvo = normalizar(trecho);
  if (alvo.length < 4) return null;
  const i = texto.indexOf(alvo);
  if (i >= 0) return [i, i + alvo.length];
  for (const tam of [80, 50, 30, 18]) {
    if (alvo.length <= tam) continue;
    for (let ini = Math.floor((alvo.length - tam) / 2), passo = 0; passo < 6; passo++) {
      const desloc = ini + (passo % 2 ? 1 : -1) * Math.ceil(passo / 2) * Math.floor(tam / 2);
      if (desloc < 0 || desloc + tam > alvo.length) continue;
      const pedaco = alvo.slice(desloc, desloc + tam);
      const j = texto.indexOf(pedaco);
      if (j >= 0) return [Math.max(0, j - desloc), Math.min(texto.length, j - desloc + alvo.length)];
    }
  }
  return null;
}

export async function desenharPagina(bytes: ArrayBuffer, numero: number, trecho?: string, escala = 1.6): Promise<PaginaDesenhada> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  try {
    const page = await pdf.getPage(numero);
    const viewport = page.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;

    const destaques: Destaque[] = [];
    if (trecho) {
      const conteudo = await page.getTextContent();
      type Item = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
      const itens = (conteudo.items as Item[]).filter(it => it.str != null);
      // Texto da página montado como o unpdf monta (itens colados, quebra só no fim de linha),
      // já normalizado, guardando o intervalo de cada item
      let texto = '';
      let quebra = false;
      const faixas: { ini: number; fim: number; it: Item }[] = [];
      for (const it of itens) {
        const s = dobrar(it.str).replace(/\s+/g, ' ');
        if (quebra && texto && !texto.endsWith(' ')) texto += ' ';
        quebra = !!it.hasEOL;
        if (!s) continue;
        if (s.startsWith(' ') && texto.endsWith(' ')) texto = texto.slice(0, -1);
        faixas.push({ ini: texto.length, fim: texto.length + s.length, it });
        texto += s;
      }
      const achado = acharTrecho(texto, trecho);
      if (achado) {
        for (const f of faixas) {
          if (f.fim <= achado[0] || f.ini >= achado[1]) continue;
          const [, , , d, e, fy] = f.it.transform;
          const h = f.it.height || Math.abs(d) || 10;
          const [x1, y1] = viewport.convertToViewportPoint(e, fy - h * 0.25) as number[];
          const [x2, y2] = viewport.convertToViewportPoint(e + f.it.width, fy + h) as number[];
          destaques.push({
            x: (Math.min(x1, x2) / viewport.width) * 100,
            y: (Math.min(y1, y2) / viewport.height) * 100,
            w: (Math.abs(x2 - x1) / viewport.width) * 100,
            h: (Math.abs(y2 - y1) / viewport.height) * 100,
          });
        }
      }
    }
    return { imagem: canvas.toDataURL('image/png'), largura: canvas.width, altura: canvas.height, destaques };
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}
