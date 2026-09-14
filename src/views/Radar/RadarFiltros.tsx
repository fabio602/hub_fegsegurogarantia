import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ShieldCheck, RotateCcw, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { REGIOES, municipiosDaRegiao, normalizarMunicipio, regiaoDosMunicipios } from './radarRegioes.ts';
import {
  DOSSIE_FILTRO_LABEL, FILTROS_INICIAIS, RECEITAS, STATUS_FILTRAVEIS, STATUS_LABEL, UFS,
  type DossieFiltro, type RadarFiltros as Filtros, type RadarStatus,
} from './radarTipos.ts';

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
}

const campo = 'px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all';
const rotulo = 'block text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1';

interface MunicipioOpcao { municipio: string; empresas: number; }

/** Cache por UF dos municípios distintos (RPC radar_municipios, migração 080). */
const cacheMunicipios = new Map<string, MunicipioOpcao[]>();

/** 'SANTANA DE PARNAIBA' -> 'Santana De Parnaiba', só para exibir no chip. */
const exibirMunicipio = (m: string): string =>
  m.toLowerCase().replace(/(^|\s)(\S)/g, (_, esp, c) => esp + c.toUpperCase()).replace(/ D([aeo]s?) /g, ' d$1 ');

/**
 * Barra de filtros do Radar. Componente controlado: quem debounça a busca e
 * reseta a página é o RadarView.
 */
export default function RadarFiltros({ filtros, onChange }: Props) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onChange({ ...filtros, [k]: v });

  // --- Município (chips com autocomplete por UF) e Região (presets) ---
  const [textoMunicipio, setTextoMunicipio] = useState('');
  const [opcoes, setOpcoes] = useState<MunicipioOpcao[]>([]);
  const [aberto, setAberto] = useState(false);
  const caixaMunicipio = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    if (!filtros.uf) { setOpcoes([]); return; }
    const emCache = cacheMunicipios.get(filtros.uf);
    if (emCache) { setOpcoes(emCache); return; }
    supabase.rpc('radar_municipios', { p_uf: filtros.uf }).then(({ data }) => {
      if (!vivo) return;
      const lista = (data ?? []) as MunicipioOpcao[];
      cacheMunicipios.set(filtros.uf, lista);
      setOpcoes(lista);
    });
    return () => { vivo = false; };
  }, [filtros.uf]);

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!caixaMunicipio.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const sugestoes = useMemo(() => {
    const t = normalizarMunicipio(textoMunicipio);
    return opcoes
      .filter(o => !filtros.municipios.includes(o.municipio) && (!t || o.municipio.includes(t)))
      .slice(0, 12);
  }, [opcoes, textoMunicipio, filtros.municipios]);

  const adicionarMunicipio = (m: string) => {
    const v = normalizarMunicipio(m);
    if (!v || filtros.municipios.includes(v)) return;
    set('municipios', [...filtros.municipios, v]);
    setTextoMunicipio('');
  };

  const removerMunicipio = (m: string) => set('municipios', filtros.municipios.filter(x => x !== m));

  // Trocar a UF invalida os municípios escolhidos.
  const mudarUf = (uf: string) => onChange({ ...filtros, uf, municipios: uf === filtros.uf ? filtros.municipios : [] });

  const escolherRegiao = (id: string) => {
    const r = REGIOES.find(x => x.id === id);
    if (!r) { set('municipios', []); return; }
    onChange({ ...filtros, uf: r.uf, municipios: municipiosDaRegiao(r) });
  };

  const regiaoAtual = regiaoDosMunicipios(filtros.uf, filtros.municipios);
  const regiaoPersonalizada = filtros.municipios.length > 0 && !regiaoAtual;

  const teclaMunicipio = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (sugestoes.length > 0) adicionarMunicipio(sugestoes[0].municipio);
      else if (textoMunicipio.trim()) adicionarMunicipio(textoMunicipio);
    } else if (e.key === 'Backspace' && !textoMunicipio && filtros.municipios.length > 0) {
      removerMunicipio(filtros.municipios[filtros.municipios.length - 1]);
    } else if (e.key === 'Escape') {
      setAberto(false);
    }
  };

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
        <div className="md:col-span-4">
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

        <div className="md:col-span-1">
          <label htmlFor="radar-uf" className={rotulo}>UF</label>
          <select id="radar-uf" value={filtros.uf} onChange={e => mudarUf(e.target.value)} className={`${campo} w-full cursor-pointer`}>
            <option value="">Todas</option>
            {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>

        <div className="md:col-span-4" ref={caixaMunicipio}>
          <label htmlFor="radar-municipio" className={rotulo}>Município</label>
          <div className="relative">
            <div
              className={`${campo} w-full flex flex-wrap items-center gap-1 min-h-[38px] py-1 ${!filtros.uf ? 'opacity-60' : ''}`}
              onClick={() => document.getElementById('radar-municipio')?.focus()}
            >
              {filtros.municipios.map(m => (
                <span key={m} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-navy text-areia text-[11px] font-bold">
                  {exibirMunicipio(m)}
                  <button type="button" onClick={ev => { ev.stopPropagation(); removerMunicipio(m); }} aria-label={`Remover ${exibirMunicipio(m)}`}
                    className="p-0.5 rounded hover:bg-navy-light transition-colors"><X size={11} /></button>
                </span>
              ))}
              <input
                id="radar-municipio"
                type="text"
                role="combobox"
                aria-expanded={aberto}
                aria-controls="radar-municipio-lista"
                aria-autocomplete="list"
                disabled={!filtros.uf}
                value={textoMunicipio}
                onChange={e => { setTextoMunicipio(e.target.value); setAberto(true); }}
                onFocus={() => setAberto(true)}
                onKeyDown={teclaMunicipio}
                placeholder={filtros.uf ? (filtros.municipios.length ? 'Adicionar...' : 'Digite o município') : 'Escolha a UF'}
                className="flex-1 min-w-[7rem] bg-transparent outline-none text-sm py-0.5"
              />
            </div>
            {aberto && filtros.uf && sugestoes.length > 0 && (
              <ul id="radar-municipio-lista" role="listbox"
                className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1">
                {sugestoes.map(o => (
                  <li key={o.municipio} role="option" aria-selected={false}>
                    <button type="button" onMouseDown={ev => ev.preventDefault()} onClick={() => { adicionarMunicipio(o.municipio); setAberto(true); }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-areia-clara transition-colors">
                      <span>{exibirMunicipio(o.municipio)}</span>
                      <span className="text-[10px] font-bold text-slate-500 tabular-nums">{o.empresas}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="md:col-span-3">
          <label htmlFor="radar-regiao" className={rotulo}>Região</label>
          <select id="radar-regiao" value={regiaoAtual} onChange={e => escolherRegiao(e.target.value)} className={`${campo} w-full cursor-pointer`}>
            <option value="">{regiaoPersonalizada ? 'Seleção própria' : 'Nenhuma'}</option>
            {REGIOES.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
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

        <div className="flex items-center gap-2">
          <label htmlFor="radar-dossie" className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Dossiê</label>
          <select id="radar-dossie" value={filtros.dossie} onChange={e => set('dossie', e.target.value as DossieFiltro)}
            className={`${campo} py-1.5 text-[11px] font-bold cursor-pointer`}>
            {(Object.keys(DOSSIE_FILTRO_LABEL) as DossieFiltro[]).map(d => (
              <option key={d || 'todos'} value={d}>{DOSSIE_FILTRO_LABEL[d]}</option>
            ))}
          </select>
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
