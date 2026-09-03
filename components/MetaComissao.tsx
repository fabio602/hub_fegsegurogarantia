import React, { useEffect, useMemo, useState } from 'react';
import { Target, ChevronLeft, ChevronRight, Save, Mail, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { parseNumber, formatCurrency } from '../utils/formatters';
import {
  hojeBrt, somarDias, primeiroDiaDoMes, ultimoDiaDoMes, diasUteisDoMes, diasUteisEntre,
  diasUteisRestantesNoMes, inicioDaSemana, fimDaSemana, ehDiaUtil, ehFimDeSemana, ehFeriado,
  nomeDoMes, formatarDataBr, paraData, paraISO,
} from '../supabase/functions/_shared/diasUteis';

/**
 * Meta de Comissão (Gestão Financeira).
 *
 * Referência: comissão das vendas com `vendeu = 'Sim'`, pela `data` da venda
 * (decisão do Fábio em 03/09/2026: é a única data preenchida em todas as
 * vendas e representa o momento da venda, não da emissão nem do pagamento).
 *
 * Meta: configurável por mês em `metas_comissao`. A meta diária é sempre
 * meta mensal ÷ dias úteis base (20), como o Fábio definiu; o ritmo e a
 * projeção usam os dias úteis reais do mês. Num mês de 22 dias úteis a
 * meta diária continua R$ 1.000 e o mês pode fechar acima.
 *
 * A Edge Function weekly-goal-report faz as mesmas contas com o mesmo módulo
 * de dias úteis (supabase/functions/_shared/diasUteis.ts).
 */

/** Antes deste mês o formulário recalculava a comissão para 20% do prêmio. */
const MES_CONTAGEM_CORRETA = '2026-09-01';
const META_PADRAO = 20000;
const DIAS_BASE_PADRAO = 20;
const DESTINATARIOS_PADRAO = ['fabio@fegsegurogarantia.com.br'];

interface VendaResumo {
  id: number;
  data: string;
  nome: string | null;
  seguradora: string | null;
  tipo: string | null;
  premio: string | null;
  comissao: string | null;
}

interface MetaMes {
  mes: string;
  meta_mensal: number;
  dias_uteis_base: number;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brlCents = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n: number) => `${Math.round(n * 100)}%`;

const MetaComissao: React.FC = () => {
  const hoje = hojeBrt();
  const [mes, setMes] = useState<string>(primeiroDiaDoMes(hoje));
  const [vendas, setVendas] = useState<VendaResumo[]>([]);
  const [metas, setMetas] = useState<MetaMes[]>([]);
  const [destinatarios, setDestinatarios] = useState<string[]>(DESTINATARIOS_PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Edição da configuração do mês selecionado
  const [editando, setEditando] = useState(false);
  const [metaInput, setMetaInput] = useState('');
  const [diasInput, setDiasInput] = useState('');
  const [destInput, setDestInput] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      // Seis meses para trás para a faixa de histórico, até o fim do mês selecionado.
      const inicioHistorico = somarDias(primeiroDiaDoMes(mes), -1);
      const inicioJanela = primeiroDiaDoMes(somarDias(primeiroDiaDoMes(inicioHistorico), -150));
      // A semana atual pode invadir o mês seguinte.
      const fimJanela = fimDaSemana(hoje) > ultimoDiaDoMes(mes) ? fimDaSemana(hoje) : ultimoDiaDoMes(mes);
      const [{ data: v, error: ev }, { data: m, error: em }, { data: cfg }] = await Promise.all([
        supabase.from('sales').select('id, data, nome, seguradora, tipo, premio, comissao')
          .eq('vendeu', 'Sim').gte('data', inicioJanela).lte('data', fimJanela).order('data'),
        supabase.from('metas_comissao').select('mes, meta_mensal, dias_uteis_base').order('mes'),
        supabase.from('hub_config').select('valor').eq('chave', 'relatorio_meta_destinatarios').maybeSingle(),
      ]);
      if (ev) throw ev;
      if (em) throw em;
      setVendas((v || []) as VendaResumo[]);
      setMetas((m || []).map((r: any) => ({ mes: String(r.mes).slice(0, 10), meta_mensal: Number(r.meta_mensal), dias_uteis_base: Number(r.dias_uteis_base) })));
      const lista = Array.isArray(cfg?.valor) ? (cfg!.valor as string[]) : null;
      if (lista && lista.length) setDestinatarios(lista);
    } catch (e: any) {
      setErro(e?.message || 'Não foi possível carregar a meta.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mes]);

  /** Meta do mês: registro do mês ou o último anterior; sem nada, o padrão. */
  const metaDoMes = useMemo<MetaMes>(() => {
    const aplicaveis = metas.filter(r => r.mes <= mes);
    const ultima = aplicaveis[aplicaveis.length - 1];
    return ultima ? { ...ultima, mes } : { mes, meta_mensal: META_PADRAO, dias_uteis_base: DIAS_BASE_PADRAO };
  }, [metas, mes]);
  const metaDefinidaNesteMes = metas.some(r => r.mes === mes);

  const calc = useMemo(() => {
    const inicioMes = primeiroDiaDoMes(mes);
    const fimMes = ultimoDiaDoMes(mes);
    const mesAtual = inicioMes === primeiroDiaDoMes(hoje);
    const mesPassado = fimMes < hoje;
    // Data de referência do ritmo: hoje no mês corrente, o último dia num mês fechado.
    const ref = mesAtual ? hoje : mesPassado ? fimMes : null;

    const metaDiaria = metaDoMes.meta_mensal / Math.max(1, metaDoMes.dias_uteis_base);
    const metaSemanal = metaDiaria * 5;

    const noMes = vendas.filter(v => v.data >= inicioMes && v.data <= fimMes);
    const acumulado = noMes.reduce((s, v) => s + parseNumber(v.comissao || ''), 0);
    const falta = Math.max(0, metaDoMes.meta_mensal - acumulado);
    const progresso = metaDoMes.meta_mensal > 0 ? acumulado / metaDoMes.meta_mensal : 0;

    const uteisMes = diasUteisDoMes(inicioMes);
    const uteisPassados = ref ? diasUteisEntre(inicioMes, ref) : 0;
    const uteisRestantes = ref ? diasUteisRestantesNoMes(ref) : uteisMes;
    const esperado = metaDiaria * uteisPassados;
    const diferenca = acumulado - esperado;
    const projecao = uteisPassados > 0 ? (acumulado / uteisPassados) * uteisMes : 0;

    // Por dia do mês, para o gráfico.
    const porDia = new Map<string, number>();
    for (const v of noMes) porDia.set(v.data, (porDia.get(v.data) || 0) + parseNumber(v.comissao || ''));
    const dias: { iso: string; dia: number; valor: number; util: boolean; futuro: boolean }[] = [];
    for (let d = inicioMes; d <= fimMes; d = somarDias(d, 1)) {
      dias.push({ iso: d, dia: paraData(d).getUTCDate(), valor: porDia.get(d) || 0, util: ehDiaUtil(d), futuro: d > hoje });
    }

    // Semana atual (segunda a domingo), independente do mês selecionado.
    const semIni = inicioDaSemana(hoje);
    const semFim = fimDaSemana(hoje);
    const naSemana = vendas.filter(v => v.data >= semIni && v.data <= semFim);
    const acumuladoSemana = naSemana.reduce((s, v) => s + parseNumber(v.comissao || ''), 0);

    // Histórico: seis meses até o selecionado.
    const historico: { mes: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = paraData(inicioMes); d.setUTCMonth(d.getUTCMonth() - i);
      const m = paraISO(d).slice(0, 7) + '-01';
      const fim = ultimoDiaDoMes(m);
      const total = vendas.filter(v => v.data >= m && v.data <= fim).reduce((s, v) => s + parseNumber(v.comissao || ''), 0);
      historico.push({ mes: m, total });
    }

    return {
      mesAtual, mesPassado, ref, metaDiaria, metaSemanal, noMes, acumulado, falta, progresso,
      uteisMes, uteisPassados, uteisRestantes, esperado, diferenca, projecao, dias,
      semIni, semFim, naSemana, acumuladoSemana, historico,
    };
  }, [vendas, metaDoMes, mes, hoje]);

  const abrirEdicao = () => {
    setMetaInput(formatCurrency(metaDoMes.meta_mensal));
    setDiasInput(String(metaDoMes.dias_uteis_base));
    setDestInput(destinatarios.join(', '));
    setEditando(true);
    setAviso(null);
  };

  const salvarConfig = async () => {
    const metaNum = parseNumber(metaInput);
    const diasNum = parseInt(diasInput, 10);
    if (!(metaNum > 0)) { setAviso('Informe a meta mensal em reais.'); return; }
    if (!(diasNum > 0 && diasNum <= 31)) { setAviso('Dias úteis base deve ficar entre 1 e 31.'); return; }
    const lista = destInput.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    if (!lista.length) { setAviso('Informe ao menos um e-mail válido para o relatório.'); return; }
    setSalvando(true);
    setAviso(null);
    try {
      const { error: e1 } = await supabase.from('metas_comissao').upsert(
        { mes, meta_mensal: metaNum, dias_uteis_base: diasNum, atualizado_em: new Date().toISOString() },
        { onConflict: 'mes' },
      );
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('hub_config').upsert(
        { chave: 'relatorio_meta_destinatarios', valor: lista, atualizado_em: new Date().toISOString() },
        { onConflict: 'chave' },
      );
      if (e2) throw e2;
      setEditando(false);
      await carregar();
    } catch (e: any) {
      setAviso('Erro ao salvar: ' + (e?.message || 'tente de novo.'));
    } finally {
      setSalvando(false);
    }
  };

  const mudarMes = (delta: number) => {
    const d = paraData(mes); d.setUTCMonth(d.getUTCMonth() + delta);
    setMes(paraISO(d).slice(0, 7) + '-01');
    setEditando(false);
  };

  const mostraNotaHistorico = calc.historico.some(h => h.mes < MES_CONTAGEM_CORRETA) || mes < MES_CONTAGEM_CORRETA;

  // ── Gráfico ──────────────────────────────────────────────────────────────
  const W = 960, H = 260, padL = 56, padR = 12, padT = 18, padB = 34;
  const larguraUtil = W - padL - padR;
  const alturaUtil = H - padT - padB;
  const maxValor = Math.max(calc.metaDiaria, ...calc.dias.map(d => d.valor)) * 1.15 || 1;
  const yDe = (v: number) => padT + alturaUtil - (v / maxValor) * alturaUtil;
  const larguraBarra = larguraUtil / calc.dias.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => maxValor * f);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Cabeçalho + navegação de mês */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-navy text-gold flex items-center justify-center"><Target size={18} /></div>
          <div>
            <h2 className="text-lg font-bold text-navy leading-tight">Meta de Comissão</h2>
            <p className="text-xs text-slate-500">Vendas com "Vendeu = Sim", pela data da venda.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => mudarMes(-1)} className="p-2 rounded-lg border border-linha bg-white hover:bg-areia-clara text-navy" aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-[180px] text-center font-bold text-navy">{nomeDoMes(mes).charAt(0).toUpperCase() + nomeDoMes(mes).slice(1)}</span>
          <button type="button" onClick={() => mudarMes(1)} disabled={mes >= primeiroDiaDoMes(hoje)} className="p-2 rounded-lg border border-linha bg-white hover:bg-areia-clara text-navy disabled:opacity-40" aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
      </div>

      {erro && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">{erro}</div>}

      {/* Configuração da meta */}
      <div className="rounded-2xl border border-linha bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2 text-sm">
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Meta mensal</p><p className="font-bold text-navy text-base tabular-nums">{brl(metaDoMes.meta_mensal)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dias úteis base</p><p className="font-bold text-navy text-base tabular-nums">{metaDoMes.dias_uteis_base}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Meta diária</p><p className="font-bold text-navy text-base tabular-nums">{brl(calc.metaDiaria)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Meta semanal</p><p className="font-bold text-navy text-base tabular-nums">{brl(calc.metaSemanal)}</p></div>
          </div>
          {!editando && (
            <button type="button" onClick={abrirEdicao} className="text-xs font-bold text-gold-dark hover:text-navy underline underline-offset-4">
              {metaDefinidaNesteMes ? 'Editar meta deste mês' : 'Definir meta para este mês'}
            </button>
          )}
        </div>
        {!metaDefinidaNesteMes && !editando && (
          <p className="mt-2 text-xs text-slate-500">Este mês herda a meta do último mês configurado. Defina uma meta própria se ela mudou.</p>
        )}
        {editando && (
          <div className="mt-4 pt-4 border-t border-linha grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Meta mensal (R$)
              <input value={metaInput} onChange={e => setMetaInput(formatCurrency(parseFloat(e.target.value.replace(/\D/g, '') || '0') / 100))} className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-navy outline-none focus:border-gold" />
            </label>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Dias úteis base
              <input type="number" min={1} max={31} value={diasInput} onChange={e => setDiasInput(e.target.value)} className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-navy outline-none focus:border-gold" />
            </label>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Relatório semanal para
              <input value={destInput} onChange={e => setDestInput(e.target.value)} placeholder="e-mails separados por vírgula" className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal normal-case tracking-normal text-navy outline-none focus:border-gold" />
            </label>
            <div className="md:col-span-3 flex items-center gap-3">
              <button type="button" onClick={salvarConfig} disabled={salvando} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-navy text-gold text-xs font-bold uppercase tracking-widest hover:bg-navy-light disabled:opacity-60"><Save size={14} /> {salvando ? 'Salvando' : 'Salvar'}</button>
              <button type="button" onClick={() => setEditando(false)} className="text-xs font-bold text-slate-500 hover:text-navy">Cancelar</button>
              {aviso && <span className="text-xs text-rose-600">{aviso}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Painel principal */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Cartao titulo="Acumulado no mês" destaque>
          <p className="text-3xl font-bold text-navy tabular-nums">{brlCents(calc.acumulado)}</p>
          <div className="mt-3 h-2 rounded-full bg-areia-escura overflow-hidden">
            <div className="h-full bg-gold" style={{ width: `${Math.min(100, calc.progresso * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500"><span className="font-bold text-navy">{pct(calc.progresso)}</span> da meta de {brl(metaDoMes.meta_mensal)}. {calc.falta > 0 ? <>Faltam <span className="font-bold text-navy">{brlCents(calc.falta)}</span>.</> : <span className="font-bold text-emerald-600">Meta batida.</span>}</p>
        </Cartao>

        <Cartao titulo="Ritmo">
          {calc.ref ? (
            <>
              <p className={`text-2xl font-bold tabular-nums ${calc.diferenca >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{calc.diferenca >= 0 ? '+' : ''}{brlCents(calc.diferenca)}</p>
              <p className="mt-1 text-xs text-slate-500">{calc.diferenca >= 0 ? 'Acima' : 'Abaixo'} do esperado até {formatarDataBr(calc.ref)}.</p>
              <p className="mt-2 text-xs text-slate-500">Esperado: <span className="font-bold text-navy">{brlCents(calc.esperado)}</span> ({calc.uteisPassados} de {calc.uteisMes} dias úteis).</p>
            </>
          ) : <p className="text-sm text-slate-400">Mês ainda não começou.</p>}
        </Cartao>

        <Cartao titulo="Projeção de fechamento">
          {calc.uteisPassados > 0 ? (
            <>
              <p className={`text-2xl font-bold tabular-nums ${calc.projecao >= metaDoMes.meta_mensal ? 'text-emerald-600' : 'text-navy'}`}>{brlCents(calc.projecao)}</p>
              <p className="mt-1 text-xs text-slate-500">No ritmo atual, {pct(metaDoMes.meta_mensal > 0 ? calc.projecao / metaDoMes.meta_mensal : 0)} da meta.</p>
              <p className="mt-2 text-xs text-slate-500">Restam <span className="font-bold text-navy">{calc.uteisRestantes}</span> dias úteis{calc.falta > 0 && calc.uteisRestantes > 0 ? <>, {brlCents(calc.falta / calc.uteisRestantes)} por dia para fechar</> : null}.</p>
            </>
          ) : <p className="text-sm text-slate-400">Sem dias úteis decorridos.</p>}
        </Cartao>

        <Cartao titulo={`Semana atual · ${formatarDataBr(calc.semIni).slice(0, 5)} a ${formatarDataBr(calc.semFim).slice(0, 5)}`} realce>
          <p className="text-2xl font-bold text-navy tabular-nums">{brlCents(calc.acumuladoSemana)}</p>
          <div className="mt-3 h-2 rounded-full bg-white/60 overflow-hidden">
            <div className={`h-full ${calc.acumuladoSemana >= calc.metaSemanal ? 'bg-emerald-500' : 'bg-navy'}`} style={{ width: `${Math.min(100, calc.metaSemanal > 0 ? (calc.acumuladoSemana / calc.metaSemanal) * 100 : 0)}%` }} />
          </div>
          <p className="mt-2 text-xs text-navy/80">{pct(calc.metaSemanal > 0 ? calc.acumuladoSemana / calc.metaSemanal : 0)} da meta semanal de {brl(calc.metaSemanal)} · {calc.naSemana.length} {calc.naSemana.length === 1 ? 'venda' : 'vendas'}.</p>
        </Cartao>
      </div>

      {/* Gráfico por dia */}
      <div className="rounded-2xl border border-linha bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-navy">Comissão por dia</h3>
          <div className="flex items-center gap-4 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-navy inline-block" /> dia útil</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-areia-escura inline-block" /> fim de semana ou feriado</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-gold inline-block" /> meta diária {brl(calc.metaDiaria)}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Comissão por dia do mês com linha da meta diária">
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={padL} x2={W - padR} y1={yDe(t)} y2={yDe(t)} stroke="#EFE7DB" strokeWidth={1} />
                <text x={padL - 8} y={yDe(t) + 4} fontSize={10} textAnchor="end" fill="#94A3B8" fontFamily="Arial, sans-serif">{brl(t)}</text>
              </g>
            ))}
            {calc.dias.map((d, i) => {
              const x = padL + i * larguraBarra;
              const h = d.valor > 0 ? Math.max(2, (d.valor / maxValor) * alturaUtil) : 0;
              const cor = d.util ? '#1B263B' : '#EFE7DB';
              const ehHoje = d.iso === hoje;
              return (
                <g key={d.iso}>
                  {!d.util && <rect x={x} y={padT} width={larguraBarra} height={alturaUtil} fill="#F8F4ED" />}
                  {h > 0 && <rect x={x + larguraBarra * 0.18} y={padT + alturaUtil - h} width={larguraBarra * 0.64} height={h} rx={2} fill={d.util ? cor : '#C69C6D'} opacity={d.futuro ? 0.3 : 1}>
                    <title>{formatarDataBr(d.iso)}: {brlCents(d.valor)}{ehFeriado(d.iso) ? ' (feriado)' : ehFimDeSemana(d.iso) ? ' (fim de semana)' : ''}</title>
                  </rect>}
                  <text x={x + larguraBarra / 2} y={H - padB + 14} fontSize={10} textAnchor="middle" fill={ehHoje ? '#8B6C3E' : d.util ? '#475569' : '#B8B0A4'} fontWeight={ehHoje ? 700 : 400} fontFamily="Arial, sans-serif">{d.dia}</text>
                  {ehHoje && <line x1={x + larguraBarra / 2} x2={x + larguraBarra / 2} y1={padT + alturaUtil} y2={padT + alturaUtil + 6} stroke="#8B6C3E" strokeWidth={2} />}
                </g>
              );
            })}
            <line x1={padL} x2={W - padR} y1={yDe(calc.metaDiaria)} y2={yDe(calc.metaDiaria)} stroke="#C69C6D" strokeWidth={2} strokeDasharray="6 4" />
            <line x1={padL} x2={W - padR} y1={padT + alturaUtil} y2={padT + alturaUtil} stroke="#E8E4DC" strokeWidth={1} />
          </svg>
        </div>
      </div>

      {/* Histórico e vendas do mês */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-linha bg-white p-5">
          <h3 className="text-sm font-bold text-navy mb-3">Últimos seis meses</h3>
          <div className="space-y-2">
            {calc.historico.map(h => {
              const maxH = Math.max(metaDoMes.meta_mensal, ...calc.historico.map(x => x.total)) || 1;
              return (
                <div key={h.mes} className="flex items-center gap-3 text-xs">
                  <span className="w-20 text-slate-500">{nomeDoMes(h.mes).slice(0, 3)}/{h.mes.slice(2, 4)}</span>
                  <div className="flex-1 h-2 rounded-full bg-areia-escura overflow-hidden">
                    <div className={`h-full ${h.mes === mes ? 'bg-gold' : 'bg-navy opacity-70'}`} style={{ width: `${Math.min(100, (h.total / maxH) * 100)}%` }} />
                  </div>
                  <span className="w-24 text-right font-bold text-navy tabular-nums">{brl(h.total)}</span>
                </div>
              );
            })}
          </div>
          {mostraNotaHistorico && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400"><Info size={12} className="mt-0.5 shrink-0" /> Dados anteriores a setembro de 2026 podem ter comissão subestimada.</p>
          )}
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-linha bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-navy">Vendas do mês</h3>
            <span className="text-xs text-slate-500">{calc.noMes.length} {calc.noMes.length === 1 ? 'venda' : 'vendas'}</span>
          </div>
          {carregando ? <p className="text-sm text-slate-400">Carregando...</p> : calc.noMes.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma venda com "Vendeu = Sim" neste mês.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-slate-400 border-b border-linha">
                    <th className="py-2 pr-3">Data</th><th className="py-2 pr-3">Cliente</th><th className="py-2 pr-3">Seguradora</th><th className="py-2 pr-3">Modalidade</th><th className="py-2 pr-3 text-right">Prêmio</th><th className="py-2 text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {[...calc.noMes].reverse().map(v => (
                    <tr key={v.id} className="border-b border-linha/60">
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-500 tabular-nums">{formatarDataBr(v.data)}</td>
                      <td className="py-2 pr-3 font-bold text-navy max-w-[260px] truncate">{v.nome || '-'}</td>
                      <td className="py-2 pr-3 text-slate-600">{v.seguradora || '-'}</td>
                      <td className="py-2 pr-3 text-slate-600">{v.tipo || '-'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{v.premio || '-'}</td>
                      <td className="py-2 text-right tabular-nums font-bold text-gold-dark">{v.comissao || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Mail size={12} /> Relatório semanal enviado aos sábados, 8h, para {destinatarios.join(', ')}.</p>
    </div>
  );
};

const Cartao: React.FC<{ titulo: string; destaque?: boolean; realce?: boolean; children: React.ReactNode }> = ({ titulo, destaque, realce, children }) => (
  <div className={`rounded-2xl p-5 border ${realce ? 'bg-areia border-gold/40' : 'bg-white border-linha'} ${destaque ? 'lg:col-span-1' : ''}`}>
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{titulo}</p>
    {children}
  </div>
);

export default MetaComissao;
