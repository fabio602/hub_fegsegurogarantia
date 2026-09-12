import React from 'react';
import { Search, ShieldCheck, RotateCcw } from 'lucide-react';
import {
  FILTROS_INICIAIS, RECEITAS, STATUS_FILTRAVEIS, STATUS_LABEL, UFS,
  type RadarFiltros as Filtros, type RadarStatus,
} from './radarTipos.ts';

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
}

const campo = 'px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all';
const rotulo = 'block text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1';

/**
 * Barra de filtros do Radar. Componente controlado: quem debounça a busca e
 * reseta a página é o RadarView.
 */
export default function RadarFiltros({ filtros, onChange }: Props) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onChange({ ...filtros, [k]: v });

  const alternarLista = <T extends string>(lista: T[], item: T): T[] =>
    lista.includes(item) ? lista.filter(x => x !== item) : [...lista, item];

  const temFiltro = JSON.stringify(filtros) !== JSON.stringify(FILTROS_INICIAIS);

  const chip = (ativo: boolean) =>
    `px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
      ativo
        ? 'bg-navy text-areia border-navy'
        : 'bg-white text-slate-600 border-slate-200 hover:border-gold hover:text-navy'
    }`;

  return (
    <section aria-label="Filtros do Radar" className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-5">
          <label htmlFor="radar-busca" className={rotulo}>Buscar</label>
          <div className="relative">
            <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              id="radar-busca"
              type="search"
              value={filtros.busca}
              onChange={e => set('busca', e.target.value)}
              placeholder="Nome, razão social ou CNPJ"
              className={`${campo} w-full pl-9`}
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="radar-uf" className={rotulo}>UF</label>
          <select id="radar-uf" value={filtros.uf} onChange={e => set('uf', e.target.value)} className={`${campo} w-full cursor-pointer`}>
            <option value="">Todas</option>
            {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="radar-valor-min" className={rotulo}>Valor mínimo (R$)</label>
          <input id="radar-valor-min" type="number" min={0} step={1000} inputMode="numeric"
            value={filtros.valorMin} onChange={e => set('valorMin', e.target.value)} placeholder="0" className={`${campo} w-full`} />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="radar-valor-max" className={rotulo}>Valor máximo (R$)</label>
          <input id="radar-valor-max" type="number" min={0} step={1000} inputMode="numeric"
            value={filtros.valorMax} onChange={e => set('valorMax', e.target.value)} placeholder="Sem limite" className={`${campo} w-full`} />
        </div>

        <div className="md:col-span-1 flex items-end">
          <button
            type="button"
            onClick={() => set('somenteGarantia', !filtros.somenteGarantia)}
            aria-pressed={filtros.somenteGarantia}
            title="Só empresas com alguma inscrição garantida"
            className={`w-full h-[38px] flex items-center justify-center gap-1.5 ${chip(filtros.somenteGarantia)} rounded-xl`}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            Garantia
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="group" aria-label="Status" className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Status</span>
          {STATUS_FILTRAVEIS.map(s => (
            <button key={s} type="button" aria-pressed={filtros.status.includes(s)}
              onClick={() => set('status', alternarLista<RadarStatus>(filtros.status, s))} className={chip(filtros.status.includes(s))}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Receita" className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Receita</span>
          {RECEITAS.map(r => (
            <button key={r} type="button" aria-pressed={filtros.receitas.includes(r)}
              onClick={() => set('receitas', alternarLista<string>(filtros.receitas, r))} className={chip(filtros.receitas.includes(r))}>
              {r}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={filtros.mostrarExcluidos} onChange={e => set('mostrarExcluidos', e.target.checked)}
            className="w-3.5 h-3.5 accent-navy" />
          Mostrar excluídos
        </label>

        {temFiltro && (
          <button type="button" onClick={() => onChange(FILTROS_INICIAIS)}
            className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-slate-600 hover:text-navy transition-colors">
            <RotateCcw size={12} aria-hidden="true" />
            Limpar filtros
          </button>
        )}
      </div>
    </section>
  );
}
