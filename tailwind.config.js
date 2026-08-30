import animate from 'tailwindcss-animate'

/**
 * Tokens de design da F&G Seguro Garantia.
 *
 * Este é o lugar único para cor, raio, sombra e duração. Antes de escrever um
 * hexadecimal solto num componente, veja se ele já não existe aqui.
 *
 * Atenção: o index.css define `html { font-size: 80% }` como escala global,
 * então 1rem vale 12,8px e não 16px. Todo espaçamento definido aqui herda essa
 * escala.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Navy institucional. `light` é o tom usado em hover dentro do sidebar;
        // `dark` é o rodapé do sidebar (mais fechado que o DEFAULT).
        navy: {
          DEFAULT: '#1B263B',
          light: '#243447',
          dark: '#162033',
        },
        // Dourado da marca. `hover` é o tom mais fechado usado em botões;
        // `dark` é o dourado legível como TEXTO sobre fundo claro (contraste).
        gold: {
          DEFAULT: '#C69C6D',
          hover: '#B58A5B',
          dark: '#8B6C3E',
        },
        // Família de fundos quentes do hub. `clara` é o header e superfícies
        // elevadas; `escura` é o tom de pill/realce sobre a areia padrão.
        areia: {
          DEFAULT: '#F5F1EA',
          clara: '#F8F4ED',
          escura: '#EFE7DB',
        },
        // Linha de borda padrão.
        linha: '#E8E4DC',
        // Verde oficial do WhatsApp: usar SOMENTE em UI que representa o
        // WhatsApp de verdade (hub de conversas, links wa.me, bolha de chat).
        whatsapp: {
          DEFAULT: '#25D366',
          hover: '#1ebe5d',
          bolha: '#DCF8C6',
        },
      },
      transitionDuration: {
        // Já usado em 4 telas; sem registro aqui a classe não gerava nada.
        400: '400ms',
      },
      boxShadow: {
        // Idem: shadow-3xl era letra morta antes deste registro.
        '3xl': '0 35px 60px -15px rgba(27, 38, 59, 0.3)',
      },
    },
  },
  plugins: [
    // Fornece animate-in, slide-in-from-*, zoom-in-*, fade-in-*.
    // Essas classes já eram usadas em 19 telas, mas não funcionavam com o CDN,
    // que não carrega plugins.
    animate,
  ],
}
