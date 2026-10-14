/**
 * Lê por OCR só o topo de uma página do PDF (o timbre), onde muitos órgãos põem o CNPJ
 * como imagem. É rápido (uma faixa de ~18% da página) e nada sai da máquina.
 */
import { ocrImagem } from './ocr.ts';

/** Fração da altura da página tratada como timbre. */
const FRACAO_TOPO = 0.18;

export async function ocrTimbre(bytes: ArrayBuffer, pagina: number): Promise<string> {
  const { renderPageAsImage } = await import('unpdf');
  const png = await renderPageAsImage(new Uint8Array(bytes.slice(0)), pagina, { scale: 2 });
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const altura = Math.max(1, Math.round(bitmap.height * FRACAO_TOPO));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = altura;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, bitmap.width, altura, 0, 0, bitmap.width, altura);
  bitmap.close();
  const recorte = await new Promise<Blob>((ok, falha) =>
    canvas.toBlob(b => (b ? ok(b) : falha(new Error('Falha ao recortar o timbre'))), 'image/png'));
  return ocrImagem(recorte);
}
