/**
 * OCR local (Tesseract, português) para editais escaneados e imagens.
 *
 * Tudo é servido pelo próprio hub em /tesseract/* (ver ocrLocal() no vite.config.ts):
 * nada é enviado para fora. O módulo tesseract.js só é carregado quando o OCR é
 * realmente necessário (import dinâmico), para não pesar no carregamento do hub.
 */
import type { Worker as TesseractWorker } from 'tesseract.js';

let workerPromise: Promise<TesseractWorker> | null = null;

async function obterWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = `${window.location.origin}/tesseract`;
      return createWorker('por', 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/core`,
        langPath: `${base}/lang`,
        workerBlobURL: false,
      });
    })();
    // Se falhar, permite tentar de novo na próxima leitura
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Reconhece o texto de uma imagem (PNG/JPG/WEBP, Blob ou ArrayBuffer). */
export async function ocrImagem(imagem: Blob | ArrayBuffer): Promise<string> {
  const worker = await obterWorker();
  const entrada = imagem instanceof Blob ? imagem : new Blob([imagem], { type: 'image/png' });
  const { data } = await worker.recognize(entrada);
  return data.text ?? '';
}

/** Libera a memória do OCR (≈ 30 MB) quando a tela é desmontada. */
export async function encerrarOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
