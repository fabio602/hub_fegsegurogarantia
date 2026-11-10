import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, Pin } from 'lucide-react';
import { hojeSaoPaulo, somarDiasUteis, rotuloDia } from '../../lib/contatoLead.ts';

/**
 * Ações de um item do "Meu dia": fixar no topo e adiar.
 *
 *  - Fixar é pessoal (meu_dia_fixados): só muda a ordem da lista de quem fixou.
 *  - Adiar grava na origem do item (próximo contato do lead, vencimento da
 *    tarefa de pós-venda), então vale para todas as telas.
 *
 * `onAdiar` ausente = item que não tem como ser adiado (o botão não aparece).
 */
interface AcoesItemProps {
  nome: string;
  fixado: boolean;
  onFixar: (fixar: boolean) => void;
  onAdiar?: (diaIso: string) => void;
}

const AcoesItem: React.FC<AcoesItemProps> = ({ nome, fixado, onFixar, onAdiar }) => {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const hoje = hojeSaoPaulo();
  const amanha = somarDiasUteis(hoje, 1);

  // Fecha o menu ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const opcoes = [
    { rotulo: 'Amanhã', dia: amanha },
    { rotulo: 'Em 3 dias úteis', dia: somarDiasUteis(hoje, 3) },
    { rotulo: 'Semana que vem', dia: somarDiasUteis(hoje, 5) },
  ];
  const escolher = (dia: string) => { setAberto(false); onAdiar?.(dia); };

  const classeIcone = 'inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors';

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => onFixar(!fixado)}
        aria-pressed={fixado}
        aria-label={fixado ? `Soltar ${nome} do topo` : `Fixar ${nome} no topo`}
        title={fixado ? 'Soltar do topo' : 'Fixar no topo'}
        className={`${classeIcone} ${fixado ? 'bg-navy border-navy text-white' : 'bg-white border-linha text-slate-500 hover:border-navy hover:text-navy'}`}
      >
        <Pin size={15} aria-hidden="true" />
      </button>

      {onAdiar && (
        <div ref={caixa} className="relative">
          <button
            type="button"
            onClick={() => setAberto(a => !a)}
            aria-expanded={aberto}
            aria-label={`Adiar ${nome}`}
            title="Adiar"
            className={`${classeIcone} ${aberto ? 'bg-navy border-navy text-white' : 'bg-white border-linha text-slate-500 hover:border-navy hover:text-navy'}`}
          >
            <CalendarClock size={15} aria-hidden="true" />
          </button>
          {aberto && (
            <div role="menu" aria-label="Adiar para" className="absolute right-0 top-full mt-1.5 z-20 w-56 bg-white border border-linha rounded-xl shadow-lg p-2">
              <p className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-slate-500">Adiar para</p>
              {opcoes.map(o => (
                <button
                  key={o.rotulo}
                  type="button"
                  role="menuitem"
                  onClick={() => escolher(o.dia)}
                  className="flex w-full items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-sm font-semibold text-navy hover:bg-areia"
                >
                  <span>{o.rotulo}</span>
                  <span className="text-xs font-medium text-slate-500">{rotuloDia(o.dia)}</span>
                </button>
              ))}
              <label className="block px-2.5 pt-2 pb-1 mt-1 border-t border-linha text-xs font-semibold text-slate-500">
                Outra data
                <input
                  type="date"
                  min={amanha}
                  onChange={(e) => { if (e.target.value && e.target.value >= amanha) escolher(e.target.value); }}
                  className="mt-1 w-full px-2 py-1.5 border border-linha rounded-lg text-sm font-semibold text-navy outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AcoesItem;
