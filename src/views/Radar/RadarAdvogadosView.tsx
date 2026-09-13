import React, { useEffect, useState } from 'react';
import { Scale, Copy, Loader2, Search } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import type { RadarAdvogadoResumo } from './radarTipos.ts';

/**
 * Radar · Fase 2: advogados que mais defendem executados fiscais no TRF3,
 * a partir da vw_radar_advogados (polo passivo, contagem de processos e de
 * empresas distintas). Canal de parceria: escritório que já cuida de
 * execuções fiscais é quem indica seguro garantia judicial.
 */
export default function RadarAdvogadosView() {
  const { toast } = useToast();
  const [linhas, setLinhas] = useState<RadarAdvogadoResumo[] | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    let vivo = true;
    supabase
      .from('vw_radar_advogados')
      .select('nome, oab, processos, empresas')
      .order('empresas', { ascending: false })
      .order('processos', { ascending: false })
      .order('nome')
      .limit(1000)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { toast(`Erro ao carregar os advogados: ${error.message}`, 'error'); setLinhas([]); return; }
        setLinhas((data ?? []) as RadarAdvogadoResumo[]);
      });
    return () => { vivo = false; };
  }, [toast]);

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast('Copiado.', 'success', 2000);
    } catch {
      toast('Não foi possível copiar.', 'error');
    }
  };

  const termo = busca.trim().toUpperCase();
  const visiveis = (linhas ?? []).filter(l => !termo || l.nome.toUpperCase().includes(termo) || (l.oab ?? '').toUpperCase().includes(termo));

  return (
    <section className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-navy text-gold flex items-center justify-center shadow-md" aria-hidden="true">
            <Scale size={20} />
          </span>
          <div>
            <h2 className="font-black text-navy text-base leading-tight">Advogados do TRF3</h2>
            <p className="text-[12px] text-slate-600 font-medium">
              Quem defende os executados fiscais do Radar, pelo número de empresas e de processos em que aparece no polo passivo.
            </p>
          </div>
        </div>
        <div className="relative w-full md:w-72">
          <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome ou OAB" aria-label="Buscar advogado"
            className="w-full pl-9 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" />
        </div>
      </div>

      <section aria-label="Advogados" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                <th scope="col" className="px-5 py-3">Advogado</th>
                <th scope="col" className="px-3 py-3">OAB</th>
                <th scope="col" className="px-3 py-3 text-right">Empresas</th>
                <th scope="col" className="px-3 py-3 text-right">Processos</th>
                <th scope="col" className="px-5 py-3 text-right"><span className="sr-only">Copiar</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas === null && (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-600">
                  <Loader2 size={18} aria-hidden="true" className="inline animate-spin mr-2 text-gold-dark" /> Carregando...
                </td></tr>
              )}
              {linhas !== null && visiveis.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-600 text-sm">
                  {linhas.length === 0 ? 'Nenhum advogado ainda. Os dossiês do PJe vão preenchendo esta lista.' : 'Nenhum advogado com esse nome ou OAB.'}
                </td></tr>
              )}
              {visiveis.map(l => {
                const texto = l.oab ? `${l.nome} (OAB ${l.oab})` : l.nome;
                return (
                  <tr key={`${l.nome}|${l.oab}`} className="border-t border-slate-100 hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-2.5 font-bold text-navy">{l.nome}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-slate-700 whitespace-nowrap">{l.oab ?? ''}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-navy">{l.empresas}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{l.processos}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button type="button" onClick={() => copiar(texto)} aria-label={`Copiar ${texto}`}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-gold hover:text-navy transition-all">
                        <Copy size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 text-[11px] font-bold text-slate-600">
          {linhas === null ? '' : `${visiveis.length.toLocaleString('pt-BR')} advogado${visiveis.length === 1 ? '' : 's'}`}
        </p>
      </section>
    </section>
  );
}
