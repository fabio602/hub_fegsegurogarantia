/**
 * Lê um arquivo (PDF ou imagem) e devolve o texto de cada página, no navegador.
 *
 *  - PDF com texto: unpdf num Web Worker (rápido, nada sai da máquina);
 *  - PDF escaneado (quase sem texto) ou imagem: OCR local (lib/pdf/ocr.ts).
 *
 * As regras de extração (lib/edital, lib/minuta) recebem só o texto das páginas.
 */
import { ocrImagem } from './ocr.ts';

export interface DocumentoLido {
  paginas: string[];
  origem: 'texto' | 'ocr';
  /** Páginas que ficaram de fora do OCR por causa do limite */
  paginasIgnoradas: number;
}

export type Progresso = (msg: string) => void;

/** Média de caracteres por página abaixo disso = PDF escaneado. */
const MIN_CARACTERES_POR_PAGINA = 50;
/** OCR é lento (~2 a 5 s por página): teto para não travar a análise. */
export const MAX_PAGINAS_OCR = 40;

const TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function textoDoPdf(bytes: ArrayBuffer, progresso?: Progresso): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./textoPdf.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data;
      // Dentro de um Web Worker o pdf.js também conversa pelo mesmo canal ("ready" etc.); ignora
      if (!m || typeof m.tipo !== 'string') return;
      if (m.tipo === 'progresso') progresso?.(`Lendo página ${m.pagina} de ${m.total}…`);
      else {
        worker.terminate();
        if (m.tipo === 'ok') resolve(m.paginas);
        else reject(new Error(`Não consegui ler o PDF: ${m.mensagem}`));
      }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(`Não consegui ler o PDF: ${e.message}`)); };
    // Cópia: o buffer é transferido para o worker e o original continua utilizável (visualizador)
    const copia = bytes.slice(0);
    worker.postMessage({ bytes: copia }, [copia]);
  });
}

async function ocrDoPdf(bytes: ArrayBuffer, totalPaginas: number, progresso?: Progresso): Promise<{ paginas: string[]; ignoradas: number }> {
  const { renderPageAsImage } = await import('unpdf');
  const limite = Math.min(totalPaginas, MAX_PAGINAS_OCR);
  const paginas: string[] = [];
  for (let n = 1; n <= limite; n++) {
    progresso?.(`Lendo por OCR a página ${n} de ${limite} (documento escaneado)…`);
    // pdf.js consome o buffer; cada página recebe uma cópia
    const png = await renderPageAsImage(new Uint8Array(bytes.slice(0)), n, { scale: 2 });
    paginas.push(await ocrImagem(png));
  }
  return { paginas, ignoradas: totalPaginas - limite };
}

/**
 * Muitas apólices vêm com assinatura digital CMS/PKCS#7 envolvendo o PDF: o arquivo não
 * começa com "%PDF-" e o PDF de verdade está dentro. Recorta do primeiro "%PDF-" até o
 * último "%%EOF". Se já é um PDF comum (ou não há marcador), devolve os bytes como vieram.
 * Portado da Edge Function parse-documento-seguro.
 */
export function desembrulharPdfAssinado(bytes: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(bytes);
  const ehPdf = (i: number) => b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d;
  if (ehPdf(0)) return bytes;
  let ini = -1;
  for (let i = 0; i < b.length - 4; i++) if (ehPdf(i)) { ini = i; break; }
  if (ini < 0) return bytes;
  let fim = b.length;
  for (let i = b.length - 1; i > ini + 4; i--) {
    // "%%EOF"
    if (b[i] === 0x46 && b[i - 1] === 0x4f && b[i - 2] === 0x45 && b[i - 3] === 0x25 && b[i - 4] === 0x25) { fim = i + 1; break; }
  }
  return bytes.slice(ini, fim);
}

export async function lerDocumento(arquivo: File, progresso?: Progresso): Promise<DocumentoLido> {
  const bytes = desembrulharPdfAssinado(await arquivo.arrayBuffer());

  if (TIPOS_IMAGEM.includes(arquivo.type)) {
    progresso?.('Lendo a imagem por OCR…');
    return { paginas: [await ocrImagem(new Blob([bytes], { type: arquivo.type }))], origem: 'ocr', paginasIgnoradas: 0 };
  }

  const paginas = await textoDoPdf(bytes, progresso);
  const caracteres = paginas.reduce((s, p) => s + p.replace(/\s/g, '').length, 0);
  if (paginas.length && caracteres / paginas.length >= MIN_CARACTERES_POR_PAGINA) {
    return { paginas, origem: 'texto', paginasIgnoradas: 0 };
  }
  const ocr = await ocrDoPdf(bytes, paginas.length, progresso);
  return { paginas: ocr.paginas, origem: 'ocr', paginasIgnoradas: ocr.ignoradas };
}

/** Vários arquivos (edital + anexos) viram um documento só, na ordem em que foram anexados. */
export async function lerDocumentos(arquivos: File[], progresso?: Progresso): Promise<DocumentoLido & { inicioDeCada: number[] }> {
  const paginas: string[] = [];
  const inicioDeCada: number[] = [];
  let origem: 'texto' | 'ocr' = 'texto';
  let ignoradas = 0;
  for (const [i, a] of arquivos.entries()) {
    const prefixo = arquivos.length > 1 ? `[${i + 1}/${arquivos.length}] ` : '';
    const lido = await lerDocumento(a, progresso && ((m) => progresso(prefixo + m)));
    inicioDeCada.push(paginas.length);
    paginas.push(...lido.paginas);
    if (lido.origem === 'ocr') origem = 'ocr';
    ignoradas += lido.paginasIgnoradas;
  }
  return { paginas, origem, paginasIgnoradas: ignoradas, inicioDeCada };
}
