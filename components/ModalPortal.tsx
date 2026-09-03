import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Renderiza o filho direto em document.body.
 *
 * Todo modal do hub usa position: fixed. Dentro da árvore da tela, qualquer
 * ancestral com transform, filter ou backdrop-filter vira o bloco de contenção
 * do fixed, e o modal passa a ocupar a área de conteúdo em vez da janela: o
 * backdrop cobre a view inteira e a caixa fica centralizada lá embaixo, fora
 * da tela. O wrapper .animate-fade-in do App.tsx é um desses ancestrais.
 *
 * Eventos do React continuam subindo pela árvore de componentes normalmente,
 * então onClick no pai que abriu o modal se comporta igual a antes.
 */
export default function ModalPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}
