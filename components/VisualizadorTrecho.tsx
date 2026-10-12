import React, { useEffect, useState } from 'react';
import { X, Loader2, FileText } from 'lucide-react';
import type { Evidencia } from '../lib/editalSchema.ts';
import { desenharPagina, type PaginaDesenhada } from '../lib/pdf/pagina.ts';

interface Props {
  /** Nome do dado (ex.: "Valor global do edital") */
  titulo: string;
  evidencia: Evidencia;
  /** PDF de onde veio o dado; sem ele (ex.: análise restaurada do histórico) mostra só o trecho */
  pdf?: { bytes: ArrayBuffer; nome: string; paginaLocal: number } | null;
  onFechar: () => void;
}

/**
 * Mostra de onde, no edital, veio um dado extraído: a página do PDF desenhada
 * com o trecho destacado. É a conferência visual que substitui a "confiança na IA".
 */
export default function VisualizadorTrecho({ titulo, evidencia, pdf, onFechar }: Props) {
  const [pagina, setPagina] = useState<PaginaDesenhada | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  useEffect(() => {
    if (!pdf || pdf.paginaLocal < 1) return;
    let vivo = true;
    setCarregando(true); setErro(null);
    desenharPagina(pdf.bytes, pdf.paginaLocal, evidencia.trecho)
      .then(p => { if (vivo) setPagina(p); })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : 'Não consegui desenhar a página.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [pdf, evidencia.trecho]);

  const manual = evidencia.pagina === 0;

  return (
    <div className="fixed inset-0 z-50 bg-navy-dark/70 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gold-dark">Origem do dado</p>
            <h3 className="font-black text-slate-800 text-lg leading-tight">{titulo}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {manual ? 'Informado manualmente na conferência' : `${pdf?.nome ?? 'Edital'} · página ${pdf?.paginaLocal ?? evidencia.pagina}`}
            </p>
          </div>
          <button onClick={onFechar} className="shrink-0 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="Fechar (Esc)">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 bg-areia-clara border-b border-linha">
          <p className="text-sm text-slate-700 leading-relaxed">“{evidencia.trecho}”</p>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          {manual ? null : !pdf ? (
            <div className="flex flex-col items-center gap-2 py-10 text-slate-400 text-sm">
              <FileText size={28} />
              <p>O PDF não está mais aberto (análise restaurada do histórico). Acima está o trecho de origem.</p>
            </div>
          ) : carregando ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
              <Loader2 size={18} className="animate-spin text-gold" /> Desenhando a página…
            </div>
          ) : erro ? (
            <p className="text-sm text-rose-600 py-10 text-center">{erro}</p>
          ) : pagina ? (
            <div className="relative mx-auto shadow-md bg-white" style={{ maxWidth: pagina.largura }}>
              <img src={pagina.imagem} alt={`Página ${pdf.paginaLocal}`} className="w-full h-auto block" />
              {pagina.destaques.map((d, i) => (
                <div key={i} className="absolute bg-gold/35 ring-1 ring-gold rounded-sm pointer-events-none"
                  style={{ left: `${d.x}%`, top: `${d.y}%`, width: `${d.w}%`, height: `${d.h}%` }} />
              ))}
              {pagina.destaques.length === 0 && (
                <p className="absolute top-2 left-2 right-2 text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2 py-1">
                  Não consegui marcar o trecho exato nesta página; procure pelo texto acima.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
