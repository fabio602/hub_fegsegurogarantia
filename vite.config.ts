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
