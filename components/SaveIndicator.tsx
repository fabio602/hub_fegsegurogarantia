import React from 'react';
import { Check, Loader2, RotateCw } from 'lucide-react';
import type { EstadoSalvamento } from '../hooks/useAutoSave.ts';

interface SaveIndicatorProps {
  estado: EstadoSalvamento;
  /** Chamado no botão "tentar de novo" quando o salvamento falhou. */
  aoTentarNovamente?: () => void;
  /** Use 'escuro' quando o indicador ficar sobre fundo escuro (cabeçalho azul). */
  tom?: 'claro' | 'escuro';
  className?: string;
}

/**
 * Indicador discreto de salvamento automático.
 *
 * Regras de calma visual, propositais:
 * - largura mínima fixa, para o texto aparecer e sumir sem empurrar o layout;
 * - troca de estado por opacidade (200ms), sem piscar nem chamar atenção;
 * - "Salvo" some sozinho depois de ~2,6s (controlado pelo hook);
 * - só o estado de erro usa cor forte, porque aí sim precisa ser visto.
 */
export const SaveIndicator: React.FC<SaveIndicatorProps> = ({
  estado,
  aoTentarNovamente,
  tom = 'claro',
  className = '',
}) => {
  const visivel = estado !== 'ocioso';
  const escuro = tom === 'escuro';
  const corNeutra = escuro ? 'text-slate-300' : 'text-slate-400';
  const corPonto = escuro ? 'bg-slate-400' : 'bg-slate-300';
  const corSucesso = escuro ? 'text-emerald-300' : 'text-emerald-600';
  const corErro = escuro ? 'text-red-300' : 'text-red-600';

  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 min-w-[104px] text-[11px] font-semibold select-none transition-opacity duration-200 ease-out ${
        visivel ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    >
      {estado === 'pendente' && (
        <>
          <span className={`w-1.5 h-1.5 rounded-full ${corPonto}`} />
          <span className={corNeutra}>Editando…</span>
        </>
      )}

      {estado === 'salvando' && (
        <>
          <Loader2 size={12} className={`animate-spin ${corNeutra}`} />
          <span className={corNeutra}>Salvando…</span>
        </>
      )}

      {estado === 'salvo' && (
        <>
          <Check size={12} className={corSucesso} />
          <span className={corSucesso}>Salvo</span>
        </>
      )}

      {estado === 'erro' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className={corErro}>Não salvou</span>
          {aoTentarNovamente && (
            <button
              type="button"
              onClick={aoTentarNovamente}
              className={`inline-flex items-center gap-1 underline underline-offset-2 ${corErro} hover:opacity-80`}
            >
              <RotateCw size={10} />
              tentar de novo
            </button>
          )}
        </>
      )}
    </span>
  );
};

export default SaveIndicator;
