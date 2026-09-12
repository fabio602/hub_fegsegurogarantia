import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters.ts';
import {
  POR_PAGINA, STATUS_CLASSES, STATUS_LABEL, formatCnpj, formatDataBr, nomeExibicao,
  type RadarEmpresa,
} from './radarTipos.ts';

interface Props {
  empresas: RadarEmpresa[];
  total: number;
  pagina: number;
  carregando: boolean;
  selecionada: string | null;
  onSelecionar: (e: RadarEmpresa) => void;
  onPagina: (p: number) => void;
}

/** Badge do score: gold só no número, sem cor de estado. */
export function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[2.6rem] px-2 py-0.5 rounded-lg bg-areia-escura text-gold-dark font-black text-[12px] tabular-nums">
      {score}
    </span>
  );
}

export function StatusBadge({ status }: { status: RadarEmpresa['status'] }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${STATUS_CLASSES[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const th = 'px-3 py-3 whitespace-nowrap';
const td = 'px-3 py-2.5 align-middle';

export default function RadarTabela({ empresas, total, pagina, carregando, selecionada, onSelecionar, onPagina }: Props) {
  const inicio = total === 0 ? 0 : pagina * POR_PAGINA + 1;
  const fim = Math.min(total, (pagina + 1) * POR_PAGINA);
  const ultima = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <section aria-label="Empresas do Radar" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              <th scope="col" className={`${th} pl-5`}>Score</th>
              <th scope="col" className={th}>Empresa</th>
              <th scope="col" className={th}>CNPJ</th>
              <th scope="col" className={th}>UF</th>
              <th scope="col" className={th}>Município</th>
              <th scope="col" className={`${th} text-right`}>Inscrições</th>
              <th scope="col" className={`${th} text-right`}>Valor total</th>
              <th scope="col" className={`${th} text-center`}>Garantia</th>
              <th scope="col" className={th}>Mais recente</th>
              <th scope="col" className={th}>Porte</th>
              <th scope="col" className={`${th} pr-5`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {carregando && empresas.length === 0 && (
              <tr>
                <td colSpan={11} className="px-5 py-12 text-center text-slate-600">
                  <Loader2 size={18} aria-hidden="true" className="inline animate-spin mr-2 text-gold-dark" />
                  Carregando empresas...
                </td>
              </tr>
            )}
            {!carregando && empresas.length === 0 && (
              <tr>
                <td colSpan={11} className="px-5 py-12 text-center text-slate-600 text-sm">
                  Nenhuma empresa com esses filtros.
                </td>
              </tr>
            )}
            {empresas.map(e => {
              const ativa = e.cnpj === selecionada;
              return (
                <tr
                  key={e.cnpj}
                  onClick={() => onSelecionar(e)}
                  aria-selected={ativa}
                  className={`border-t border-slate-100 cursor-pointer transition-colors ${
                    ativa ? 'bg-areia-clara' : 'hover:bg-slate-50/70'
                  } ${carregando ? 'opacity-60' : ''}`}
                >
                  <td className={`${td} pl-5`}><ScoreBadge score={e.score} /></td>
                  <td className={`${td} max-w-[22rem]`}>
                    <button
                      type="button"
                      onClick={ev => { ev.stopPropagation(); onSelecionar(e); }}
                      className="text-left font-bold text-navy hover:text-gold-dark transition-colors leading-tight line-clamp-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 rounded"
                    >
                      {nomeExibicao(e)}
                    </button>
                    {e.nome_fantasia && e.nome_fantasia !== e.razao_social && (
                      <p className="text-[11px] text-slate-600 truncate">{e.nome_fantasia}</p>
                    )}
                  </td>
                  <td className={`${td} font-mono text-[12px] text-slate-700 whitespace-nowrap`}>{formatCnpj(e.cnpj)}</td>
                  <td className={`${td} font-bold text-slate-700`}>{e.uf ?? ''}</td>
                  <td className={`${td} text-slate-700 whitespace-nowrap`}>{e.municipio ?? ''}</td>
                  <td className={`${td} text-right tabular-nums text-slate-700`}>{e.qtd_inscricoes}</td>
                  <td className={`${td} text-right tabular-nums font-bold text-navy whitespace-nowrap`}>{formatCurrency(Number(e.valor_total))}</td>
                  <td className={`${td} text-center`}>
                    {e.tem_garantia
                      ? <span className="text-[11px] font-bold text-navy">Sim</span>
                      : <span className="text-[11px] text-slate-500">Não</span>}
                  </td>
                  <td className={`${td} tabular-nums text-slate-700 whitespace-nowrap`}>{formatDataBr(e.data_inscricao_mais_recente)}</td>
                  <td className={`${td} text-[11px] text-slate-700 whitespace-nowrap`}>{e.porte ?? ''}</td>
                  <td className={`${td} pr-5`}><StatusBadge status={e.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav aria-label="Paginação" className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/60 text-[11px] font-bold text-slate-600">
        <span>
          {total === 0 ? 'Nenhuma empresa' : `${inicio}–${fim} de ${total.toLocaleString('pt-BR')}`}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPagina(pagina - 1)} disabled={pagina === 0 || carregando} aria-label="Página anterior"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">Página {total === 0 ? 0 : pagina + 1} de {total === 0 ? 0 : ultima + 1}</span>
          <button type="button" onClick={() => onPagina(pagina + 1)} disabled={pagina >= ultima || carregando} aria-label="Próxima página"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-gold disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            <ChevronRight size={14} />
          </button>
        </div>
      </nav>
    </section>
  );
}
