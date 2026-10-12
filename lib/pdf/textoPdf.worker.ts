/// <reference lib="webworker" />
/**
 * Web Worker: extrai o texto de cada página de um PDF com o unpdf (a mesma
 * biblioteca e versão usadas pela bateria regressao/rodar-local.ts), para que um
 * edital de centenas de páginas não trave a tela enquanto é lido.
 *
 * Entrada:  { bytes: ArrayBuffer }
 * Saídas:   { tipo: 'progresso', pagina, total }
 *           { tipo: 'ok', paginas: string[] }
 *           { tipo: 'erro', mensagem }
 */
import { getDocumentProxy } from 'unpdf';

self.onmessage = async (ev: MessageEvent<{ bytes: ArrayBuffer }>) => {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(ev.data.bytes));
    const total = pdf.numPages;
    const paginas: string[] = [];
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const conteudo = await page.getTextContent();
      // Mesma montagem de linhas do extractText do unpdf: quebra onde o item marca fim de linha
      let texto = '';
      for (const item of conteudo.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (item.str == null) continue;
        texto += item.str + (item.hasEOL ? '\n' : '');
      }
      paginas.push(texto);
      if (n % 5 === 0 || n === total) self.postMessage({ tipo: 'progresso', pagina: n, total });
    }
    await pdf.cleanup().catch(() => undefined);
    self.postMessage({ tipo: 'ok', paginas });
  } catch (e) {
    self.postMessage({ tipo: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
  }
};
