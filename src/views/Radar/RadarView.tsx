import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radar, Database, Sparkles, Terminal } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import RadarFiltros from './RadarFiltros.tsx';
import RadarTabela from './RadarTabela.tsx';
import RadarDrawer from './RadarDrawer.tsx';
import {
  FILTROS_INICIAIS, POR_PAGINA, STATUS_LABEL, formatCompetencia, sanitizarBusca,
  type RadarEmpresa, type RadarFiltros as Filtros, type RadarStatus,
} from './radarTipos.ts';

interface Resumo {
  temIngestao: boolean;
  competencia: string | null;
  porStatus: Record<RadarStatus, number>;
  semEnriquecimento: number;
}

interface Props {
  /** Abre o Kanban de prospecção (o hub não tem link direto para um card). */
  onAbrirKanban: () => void;
}

const COMANDO = 'python scripts/radar/pgfn_ingest.py --competencia AAAAMM --uf SP';

/**
 * Radar · Fase 1: empresas da base de devedores da PGFN, filtradas,
 * enriquecidas e pontuadas. Lista server-side (range do Supabase, 50 por
 * página) com drawer de detalhe e envio ao Kanban.
 */
export default function RadarView({ onAbrirKanban }: Props) {
  const { toast } = useToast();
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIAIS);
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(0);
  const [empresas, setEmpresas] = useState<RadarEmpresa[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [selecionada, setSelecionada] = useState<RadarEmpresa | null>(null);
  const requisicao = useRef(0);

  // Busca digitada só vai ao banco depois de 300 ms sem tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(sanitizarBusca(filtros.busca)), 300);
    return () => clearTimeout(t);
  }, [filtros.busca]);

  const filtrosServidor = useMemo(() => ({
    busca: buscaAplicada,
    uf: filtros.uf,
    valorMin: filtros.valorMin,
    valorMax: filtros.valorMax,
    somenteGarantia: filtros.somenteGarantia,
    status: filtros.status,
    receitas: filtros.receitas,
    mostrarExcluidos: filtros.mostrarExcluidos,
  }), [buscaAplicada, filtros.uf, filtros.valorMin, filtros.valorMax, filtros.somenteGarantia, filtros.status, filtros.receitas, filtros.mostrarExcluidos]);

  // Qualquer filtro novo volta para a primeira página.
  useEffect(() => { setPagina(0); }, [filtrosServidor]);

  const carregarResumo = useCallback(async () => {
    const contar = (aplicar: (q: any) => any) =>
      aplicar(supabase.from('radar_empresas').select('cnpj', { count: 'exact', head: true }))
        .then(({ count }: { count: number | null }) => count ?? 0);
    const [ingestoes, ultima, novo, enviado, descartado, excluido, semEnr] = await Promise.all([
      supabase.from('radar_ingestoes').select('id', { count: 'exact', head: true }).then(r => r.count ?? 0),
      supabase.from('radar_empresas').select('competencia_ultima').order('competencia_ultima', { ascending: false }).limit(1).maybeSingle().then(r => r.data?.competencia_ultima ?? null),
      contar(q => q.eq('status', 'novo')),
      contar(q => q.eq('status', 'enviado_kanban')),
      contar(q => q.eq('status', 'descartado')),
      contar(q => q.eq('status', 'excluido')),
      contar(q => q.eq('status', 'novo').is('enriquecido_em', null)),
    ]);
    setResumo({
      temIngestao: ingestoes > 0,
      competencia: ultima,
      porStatus: { novo, enviado_kanban: enviado, descartado, excluido },
      semEnriquecimento: semEnr,
    });
  }, []);

  const carregarLista = useCallback(async () => {
    const id = ++requisicao.current;
    setCarregando(true);
    const f = filtrosServidor;
    let q = supabase.from('radar_empresas').select('*', { count: 'exact' });

    if (f.status.length > 0) q = q.in('status', f.status);
    else if (!f.mostrarExcluidos) q = q.neq('status', 'excluido');
    if (f.uf) q = q.eq('uf', f.uf);
    if (f.valorMin !== '' && !Number.isNaN(Number(f.valorMin))) q = q.gte('valor_total', Number(f.valorMin));
    if (f.valorMax !== '' && !Number.isNaN(Number(f.valorMax))) q = q.lte('valor_total', Number(f.valorMax));
    if (f.somenteGarantia) q = q.eq('tem_garantia', true);
    // Coluna computada receitas_tipos (migração 076): PIS/COFINS/IPI a partir dos textos da PGFN.
    if (f.receitas.length > 0) q = q.overlaps('receitas_tipos', f.receitas);
    if (f.busca) {
      const digitos = f.busca.replace(/\D/g, '');
      q = digitos.length >= 4 && digitos.length === f.busca.replace(/[.\-\/\s]/g, '').length
        ? q.ilike('cnpj', `%${digitos}%`)
        : q.or(`nome_devedor.ilike.%${f.busca}%,razao_social.ilike.%${f.busca}%,nome_fantasia.ilike.%${f.busca}%`);
    }

    const de = pagina * POR_PAGINA;
    const { data, count, error } = await q
      .order('score', { ascending: false })
      .order('valor_total', { ascending: false })
      .range(de, de + POR_PAGINA - 1);

    if (id !== requisicao.current) return; // resposta atrasada de um filtro antigo
    if (error) {
      toast(`Erro ao carregar o Radar: ${error.message}`, 'error');
      setEmpresas([]);
      setTotal(0);
    } else {
      setEmpresas((data ?? []) as RadarEmpresa[]);
      setTotal(count ?? 0);
    }
    setCarregando(false);
  }, [filtrosServidor, pagina, toast]);

  useEffect(() => { carregarResumo(); }, [carregarResumo]);
  useEffect(() => { carregarLista(); }, [carregarLista]);

  const aoAtualizar = (e: RadarEmpresa) => {
    setEmpresas(prev => prev.map(x => (x.cnpj === e.cnpj ? e : x)));
    setSelecionada(e);
    carregarResumo();
  };

  const vazio = resumo && !resumo.temIngestao;

  return (
    <section className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* Cabeçalho */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-navy text-gold flex items-center justify-center shadow-md" aria-hidden="true">
              <Radar size={20} />
            </span>
            <div>
              <h2 className="font-black text-navy text-base leading-tight">Radar PGFN</h2>
              <p className="text-[12px] text-slate-600 font-medium">
                Indústrias com dívida federal ajuizada (PIS, COFINS, IPI), enriquecidas pela BrasilAPI.
                {resumo?.competencia && <> Competência mais recente: <strong className="text-navy">{formatCompetencia(resumo.competencia)}</strong>.</>}
              </p>
            </div>
          </div>
          {resumo && resumo.temIngestao && (
            <dl className="flex flex-wrap gap-2">
              {(['novo', 'enviado_kanban', 'descartado', 'excluido'] as RadarStatus[]).map(s => (
                <div key={s} className="px-3 py-2 rounded-xl bg-areia-clara border border-linha min-w-[5.5rem]">
                  <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{STATUS_LABEL[s]}</dt>
                  <dd className="text-base font-black text-navy tabular-nums leading-tight">{resumo.porStatus[s].toLocaleString('pt-BR')}</dd>
                </div>
              ))}
              <div className="px-3 py-2 rounded-xl bg-areia-clara border border-linha min-w-[5.5rem]">
                <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-1"><Sparkles size={9} aria-hidden="true" /> Sem enriquecer</dt>
                <dd className="text-base font-black text-navy tabular-nums leading-tight">{resumo.semEnriquecimento.toLocaleString('pt-BR')}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      {vazio ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center space-y-4">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-areia-escura text-gold-dark flex items-center justify-center" aria-hidden="true">
            <Database size={24} />
          </span>
          <h3 className="font-black text-navy text-base">Nenhuma base da PGFN carregada ainda</h3>
          <p className="text-sm text-slate-600 max-w-xl mx-auto">
            Baixe o ZIP de Dados Abertos da PGFN (Devedores inscritos em Dívida Ativa da União), coloque os CSVs em
            <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-100 text-navy text-[12px]">data/pgfn/AAAAMM/</code>
            e rode no terminal, na raiz do projeto:
          </p>
          <pre className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-navy text-areia text-[12px] font-mono text-left">
            <Terminal size={14} aria-hidden="true" className="text-gold" />{COMANDO}
          </pre>
          <p className="text-[12px] text-slate-600">O passo a passo completo está em docs/radar/README.md.</p>
        </div>
      ) : (
        <>
          <RadarFiltros filtros={filtros} onChange={setFiltros} />
          <RadarTabela
            empresas={empresas}
            total={total}
            pagina={pagina}
            carregando={carregando}
            selecionada={selecionada?.cnpj ?? null}
            onSelecionar={setSelecionada}
            onPagina={setPagina}
          />
        </>
      )}

      {selecionada && (
        <RadarDrawer
          empresa={selecionada}
          onFechar={() => setSelecionada(null)}
          onAtualizada={aoAtualizar}
          onAbrirKanban={onAbrirKanban}
        />
      )}
    </section>
  );
}
