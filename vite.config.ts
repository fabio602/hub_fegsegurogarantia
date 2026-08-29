import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
