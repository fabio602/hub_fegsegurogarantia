import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Arquivos do OCR (Tesseract) servidos pelo próprio hub, em /tesseract/*.
 *
 * O tesseract.js baixa por padrão o worker, o núcleo wasm e o idioma de uma CDN
 * externa. Aqui eles saem do node_modules: no `npm run dev` por um middleware e no
 * build como arquivos do dist/. Só são baixados pelo navegador quando alguém sobe
 * um edital escaneado ou uma imagem (lib/pdf/ocr.ts).
 */
const OCR_ARQUIVOS: Record<string, string> = {
  'tesseract/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract/lang/por.traineddata.gz': 'node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz',
};

function ocrLocal() {
  return {
    name: 'fg-ocr-local',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const rota = String(req.url ?? '').split('?')[0].replace(/^\//, '');
        const origem = OCR_ARQUIVOS[rota];
        if (!origem) return next();
        const fs = await import('fs');
        res.setHeader('Content-Type', rota.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(path.resolve(__dirname, origem)).pipe(res);
      });
    },
    async generateBundle(this: any) {
      const fs = await import('fs/promises');
      for (const [destino, origem] of Object.entries(OCR_ARQUIVOS)) {
        this.emitFile({ type: 'asset', fileName: destino, source: await fs.readFile(path.resolve(__dirname, origem)) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    // Um só timestamp para os dois usos abaixo. Se cada um chamasse `new Date()`
    // por conta própria daria diferença de milissegundos e o hub acharia que
    // está desatualizado no instante em que o deploy termina.
    const buildTime = new Date().toISOString();

    return {
      envDir: path.resolve(__dirname),
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        ocrLocal(),
        {
          // Publica o timestamp do build num arquivo à parte.
          //
          // É como o hub que já está aberto no navegador de alguém descobre que
          // saiu versão nova: ele consulta este arquivo de tempos em tempos e
          // compara com o `__BUILD_TIME__` que veio compilado dentro dele.
          // Precisa ser um arquivo separado justamente porque o bundle em
          // execução nunca muda sozinho.
          name: 'fg-version-json',
          apply: 'build' as const,
          generateBundle(this: any) {
            this.emitFile({
              type: 'asset',
              fileName: 'version.json',
              source: JSON.stringify({ buildTime }),
            });
          },
        },
        {
          // Carimba o mesmo timestamp nos portais estáticos de public/.
          //
          // Esses HTMLs não passam pelo bundle, então não recebem o
          // `__BUILD_TIME__` do `define` abaixo. O jeito de cada página saber a
          // própria versão é o build escrever o valor na <meta name="fg-build">.
          // Roda em `writeBundle` porque é só aí que o Vite já copiou public/
          // para dist/.
          name: 'fg-carimba-portais',
          apply: 'build' as const,
          async writeBundle(this: any, options: any) {
            const fs = await import('fs/promises');
            const dir = options.dir || path.resolve(__dirname, 'dist');
            const portais = [
              'imobiliaria.html',
              'parceiros.html',
              'apolices.html',
              'parceiros-login.html',
            ];
            for (const nome of portais) {
              const alvo = path.join(dir, nome);
              try {
                const html = await fs.readFile(alvo, 'utf-8');
                if (!html.includes('__FG_BUILD_TIME__')) continue;
                await fs.writeFile(alvo, html.split('__FG_BUILD_TIME__').join(buildTime), 'utf-8');
              } catch {
                // portal ausente no build: nada a carimbar
              }
            }
          },
        },
      ],
      // O leitor de PDF (lib/pdf/textoPdf.worker.ts) roda num Web Worker módulo:
      // o unpdf usa import dinâmico, que só funciona com saída ES.
      worker: { format: 'es' as const },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        // Timestamp gravado em build time — visível no hub para confirmar versão deployada
        __BUILD_TIME__: JSON.stringify(buildTime),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
