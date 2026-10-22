import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Save, Printer, Plus, Copy, FolderOpen, Search } from 'lucide-react';
import { supabase } from '../lib/supabase.ts';
import { useToast } from './Toast.tsx';
import { imprimirProposta, type DadosProposta } from '../lib/proposta/template.ts';

// Gerar Proposta (menu Cotações): Controle Interno fica só na tela; o PDF leva
// tomador, vigência, resumo de valores, observações e o rodapé padrão.

interface Proposta {
  id: string;
  numero: string;
  tomador_nome: string;
  tomador_cnpj: string | null;
  responsavel: string | null;
  importancia_segurada: number;
  taxa_aa: number | null;
  prazo_dias: number | null;
  premio_minimo: number | null;
  premio_cotado: number | null;
  premio: number;
  comissao_perc: number | null;
  comissao_valor: number | null;
  honorario_perc: number | null;
  honorario_valor: number;
  total: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  observacoes: string | null;
  status: 'aberta' | 'aceita' | 'recusada';
  autor_email: string | null;
  created_at: string;
}

interface Tomador { nome: string; cnpj: string; responsavel: string }

interface Form {
  id: string | null;
  numero: string | null;
  is: string; taxa: string; prazo: string; pmin: string; pcot: string; com: string; hon: string;
  empresa: string; cnpj: string; resp: string; ini: string; fim: string; obs: string;
}

const FORM_VAZIO: Form = {
  id: null, numero: null,
  is: '', taxa: '2,00', prazo: '365', pmin: '', pcot: '', com: '40,00', hon: '0,00',
  empresa: '', cnpj: '', resp: '', ini: '', fim: '', obs: '',
};

// Aceita "150.000,00", "150000", "2,5" e "2.5".
const num = (v: string): number => {
  let s = (v || '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s) || 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dec = (n: number | null | undefined, casas = 2) =>
  n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
const mascaraCnpj = (s: string) => {
  const d = soDigitos(s).slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
};
const diasEntre = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

const STATUS_ROTULO: Record<Proposta['status'], string> = { aberta: 'Aberta', aceita: 'Aceita', recusada: 'Recusada' };
const STATUS_COR: Record<Proposta['status'], string> = {
  aberta: 'bg-blue-50 text-blue-700 border-blue-200',
  aceita: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  recusada: 'bg-rose-50 text-rose-700 border-rose-200',
};

function calcular(f: Form) {
  const IS = num(f.is);
  let prazo = Math.round(num(f.prazo));
  if (f.ini && f.fim) { const d = diasEntre(f.ini, f.fim); if (d > 0) prazo = d; }
  const pcot = num(f.pcot), pmin = num(f.pmin);
  let premio = pcot > 0 ? pcot : IS * (num(f.taxa) / 100) * (prazo / 365);
  if (pcot <= 0 && pmin > premio) premio = pmin;
  premio = r2(premio);
  const honorarios = r2(IS * (num(f.hon) / 100));
  const comissao = r2(premio * (num(f.com) / 100));
  return { IS, prazo, premio, honorarios, comissao, total: r2(premio + honorarios), receita: r2(comissao + honorarios) };
}

const Campo: React.FC<{ id: string; rotulo: string; dica?: string; children: React.ReactNode; className?: string }> =
  ({ id, rotulo, dica, children, className = '' }) => (
    <label htmlFor={id} className={`flex flex-col gap-1 min-w-0 ${className}`}>
      <span className="text-xs font-semibold text-navy/70">{rotulo}</span>
      {children}
      {dica && <span className="text-[10px] text-slate-500">{dica}</span>}
    </label>
  );

const inputCls = 'w-full rounded-lg border border-linha bg-white px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/60';

const PropostaGarantia: React.FC = () => {
  const { toast } = useToast();
  const [f, setF] = useState<Form>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [lista, setLista] = useState<Proposta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [tomadores, setTomadores] = useState<Tomador[]>([]);

  const c = useMemo(() => calcular(f), [f]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF(prev => ({ ...prev, [k]: k === 'cnpj' ? mascaraCnpj(e.target.value) : e.target.value }));
  const formataMoeda = (k: keyof Form) => () =>
    setF(prev => { const n = num(prev[k] as string); return n ? { ...prev, [k]: dec(n) } : prev; });

  const carregarLista = async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('propostas').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) toast('Não foi possível carregar o histórico de propostas.', 'error');
    setLista((data as Proposta[]) ?? []);
    setCarregando(false);
  };

  useEffect(() => {
    carregarLista();
    // Tomadores já cadastrados no Registro de Vendas, para preencher CNPJ e responsável.
    supabase.from('sales').select('nome, cnpj, decisor').not('nome', 'is', null).order('data', { ascending: false }).limit(3000)
      .then(({ data }) => {
        const vistos = new Map<string, Tomador>();
        for (const s of (data ?? []) as { nome: string; cnpj: string | null; decisor: string | null }[]) {
          const nome = (s.nome || '').trim();
          if (!nome || vistos.has(nome.toUpperCase())) continue;
          vistos.set(nome.toUpperCase(), { nome, cnpj: s.cnpj ?? '', responsavel: s.decisor ?? '' });
        }
        setTomadores([...vistos.values()]);
      });
  }, []);

  const escolherTomador = (valor: string) => {
    const t = tomadores.find(x => x.nome.toUpperCase() === valor.trim().toUpperCase());
    setF(prev => ({
      ...prev, empresa: valor,
      ...(t ? { cnpj: t.cnpj ? mascaraCnpj(t.cnpj) : prev.cnpj, resp: prev.resp || t.responsavel } : {}),
    }));
  };

  const linhaParaForm = (p: Proposta, duplicar = false): Form => ({
    id: duplicar ? null : p.id, numero: duplicar ? null : p.numero,
    is: dec(p.importancia_segurada), taxa: dec(p.taxa_aa), prazo: p.prazo_dias != null ? String(p.prazo_dias) : '',
    pmin: p.premio_minimo ? dec(p.premio_minimo) : '', pcot: p.premio_cotado ? dec(p.premio_cotado) : '',
    com: dec(p.comissao_perc), hon: dec(p.honorario_perc, p.honorario_perc != null && !Number.isInteger(r2(p.honorario_perc * 100)) ? 3 : 2),
    empresa: p.tomador_nome, cnpj: p.tomador_cnpj ?? '', resp: p.responsavel ?? '',
    ini: p.vigencia_inicio ?? '', fim: p.vigencia_fim ?? '', obs: p.observacoes ?? '',
  });

  const paraPdf = (p: Proposta): DadosProposta => ({
    numero: p.numero, emitidaEm: new Date(p.created_at),
    tomadorNome: p.tomador_nome, tomadorCnpj: p.tomador_cnpj, responsavel: p.responsavel,
    vigenciaInicio: p.vigencia_inicio, vigenciaFim: p.vigencia_fim,
    importanciaSegurada: Number(p.importancia_segurada), premio: Number(p.premio),
    honorarios: Number(p.honorario_valor), total: Number(p.total), observacoes: p.observacoes,
  });

  const salvar = async (gerarPdf: boolean) => {
    if (!f.empresa.trim()) { toast('Preencha o nome da empresa do tomador.', 'warning'); return; }
    if (c.IS <= 0) { toast('Preencha a Importância Segurada.', 'warning'); return; }
    if (c.premio <= 0) { toast('O prêmio ficou zerado. Confira taxa e prazo ou informe o prêmio cotado.', 'warning'); return; }
    if (f.ini && f.fim && diasEntre(f.ini, f.fim) <= 0) { toast('O fim da vigência está antes do início.', 'warning'); return; }
    setSalvando(true);
    const registro = {
      tomador_nome: f.empresa.trim(), tomador_cnpj: f.cnpj || null, responsavel: f.resp.trim() || null,
      importancia_segurada: c.IS, taxa_aa: num(f.taxa), prazo_dias: c.prazo,
      premio_minimo: num(f.pmin) || null, premio_cotado: num(f.pcot) || null, premio: c.premio,
      comissao_perc: num(f.com), comissao_valor: c.comissao,
      honorario_perc: num(f.hon), honorario_valor: c.honorarios, total: c.total,
      vigencia_inicio: f.ini || null, vigencia_fim: f.fim || null, observacoes: f.obs.trim() || null,
    };
    const q = f.id
      ? supabase.from('propostas').update(registro).eq('id', f.id).select().single()
      : supabase.from('propostas').insert(registro).select().single();
    const { data, error } = await q;
    setSalvando(false);
    if (error || !data) { toast('Não foi possível salvar a proposta. Tente de novo.', 'error'); return; }
    const p = data as Proposta;
    setF(prev => ({ ...prev, id: p.id, numero: p.numero }));
    toast(`Proposta ${p.numero} salva.`, 'success');
    carregarLista();
    if (gerarPdf) imprimirProposta(paraPdf(p));
  };

  const mudarStatus = async (p: Proposta, status: Proposta['status']) => {
    const { error } = await supabase.from('propostas').update({ status }).eq('id', p.id);
    if (error) { toast('Não foi possível mudar o status.', 'error'); return; }
    setLista(prev => prev.map(x => (x.id === p.id ? { ...x, status } : x)));
  };

  const filtrada = useMemo(() => {
    const t = busca.trim().toUpperCase();
    if (!t) return lista;
    const d = soDigitos(t);
    return lista.filter(p => p.tomador_nome.toUpperCase().includes(t) || p.numero.toUpperCase().includes(t) ||
      (d.length >= 3 && soDigitos(p.tomador_cnpj ?? '').includes(d)));
  }, [lista, busca]);

  return (
    <div className="space-y-6">
      {/* Controle Interno: não vai para o PDF */}
      <section className="bg-areia-clara border border-dashed border-gold/60 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-black text-navy">Controle Interno</h2>
          <span className="text-[10px] font-bold uppercase tracking-widest bg-gold text-white rounded-full px-3 py-1">não aparece no PDF</span>
          {f.numero && <span className="ml-auto text-sm font-semibold text-navy">Editando {f.numero}</span>}
        </div>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <Campo id="pg-is" rotulo="Importância Segurada (R$)">
            <input id="pg-is" inputMode="decimal" className={inputCls} value={f.is} onChange={set('is')} onBlur={formataMoeda('is')} placeholder="0,00" />
          </Campo>
          <Campo id="pg-taxa" rotulo="Taxa (% a.a.)">
            <input id="pg-taxa" inputMode="decimal" className={inputCls} value={f.taxa} onChange={set('taxa')} />
          </Campo>
          <Campo id="pg-prazo" rotulo="Prazo (dias)" dica={f.ini && f.fim ? 'Calculado pela vigência' : undefined}>
            <input id="pg-prazo" inputMode="numeric" className={inputCls} value={f.ini && f.fim ? String(c.prazo) : f.prazo} onChange={set('prazo')} disabled={!!(f.ini && f.fim)} />
          </Campo>
          <Campo id="pg-pmin" rotulo="Prêmio mínimo (R$)">
            <input id="pg-pmin" inputMode="decimal" className={inputCls} value={f.pmin} onChange={set('pmin')} onBlur={formataMoeda('pmin')} placeholder="opcional" />
          </Campo>
          <Campo id="pg-pcot" rotulo="Prêmio cotado (R$)" dica="Substitui o cálculo pela taxa">
            <input id="pg-pcot" inputMode="decimal" className={inputCls} value={f.pcot} onChange={set('pcot')} onBlur={formataMoeda('pcot')} placeholder="opcional" />
          </Campo>
          <Campo id="pg-com" rotulo="Comissão (%)">
            <input id="pg-com" inputMode="decimal" className={inputCls} value={f.com} onChange={set('com')} />
          </Campo>
          <Campo id="pg-hon" rotulo="Honorário (% da IS)" dica="Zero tira a linha do PDF">
            <input id="pg-hon" inputMode="decimal" className={inputCls} value={f.hon} onChange={set('hon')} />
          </Campo>
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {[
            ['Prêmio da garantia', c.premio], ['Comissão estimada', c.comissao],
            ['Honorários', c.honorarios], ['Receita F&G', c.receita],
          ].map(([rot, v], i) => (
            <div key={rot as string} className="bg-white border border-gold/40 rounded-xl px-4 py-3">
              <span className="block text-[10px] uppercase tracking-widest text-slate-500">{rot}</span>
              <strong className={`text-xl tabular-nums ${i === 3 ? 'text-gold-dark' : 'text-navy'}`}>{brl(v as number)}</strong>
            </div>
          ))}
        </div>
      </section>

      {/* O que vai para o PDF */}
      <section className="bg-white border border-linha rounded-2xl p-6 space-y-5">
        <h2 className="text-lg font-black text-navy">Dados do Tomador</h2>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
          <Campo id="pg-empresa" rotulo="Empresa" className="md:col-span-2" dica="Digite para buscar no Registro de Vendas">
            <input id="pg-empresa" list="pg-tomadores" className={inputCls} value={f.empresa} onChange={e => escolherTomador(e.target.value)} placeholder="Razão social" />
            <datalist id="pg-tomadores">{tomadores.map(t => <option key={t.nome} value={t.nome}>{t.cnpj}</option>)}</datalist>
          </Campo>
          <Campo id="pg-cnpj" rotulo="CNPJ">
            <input id="pg-cnpj" inputMode="numeric" className={inputCls} value={f.cnpj} onChange={set('cnpj')} placeholder="00.000.000/0000-00" />
          </Campo>
          <Campo id="pg-resp" rotulo="Responsável">
            <input id="pg-resp" className={inputCls} value={f.resp} onChange={set('resp')} placeholder="Nome do responsável" />
          </Campo>
        </div>
        <h2 className="text-lg font-black text-navy pt-2">Vigência da Garantia</h2>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Campo id="pg-ini" rotulo="Início"><input id="pg-ini" type="date" className={inputCls} value={f.ini} onChange={set('ini')} /></Campo>
          <Campo id="pg-fim" rotulo="Fim"><input id="pg-fim" type="date" className={inputCls} value={f.fim} onChange={set('fim')} /></Campo>
        </div>

        <h2 className="text-lg font-black text-navy pt-2">Resumo da Proposta</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b-2 border-linha">
              <th className="text-left py-2 px-3">Descrição</th><th className="text-right py-2 px-3">Valor (R$)</th></tr></thead>
            <tbody>
              <tr className="border-b border-linha"><td className="py-2 px-3">Importância Segurada (IS)</td><td className="py-2 px-3 text-right">{brl(c.IS)}</td></tr>
              <tr className="border-b border-linha"><td className="py-2 px-3">Prêmio da Garantia</td><td className="py-2 px-3 text-right">{brl(c.premio)}</td></tr>
              {c.honorarios > 0 && <tr className="border-b border-linha"><td className="py-2 px-3">Honorários de Estruturação e Suporte Técnico</td><td className="py-2 px-3 text-right">{brl(c.honorarios)}</td></tr>}
              <tr className="bg-navy text-white font-bold"><td className="py-3 px-3 rounded-l-lg">Valor Total da Proposta</td><td className="py-3 px-3 text-right rounded-r-lg">{brl(c.total)}</td></tr>
            </tbody>
          </table>
        </div>

        <Campo id="pg-obs" rotulo="Observações" dica="Em branco, o quadro não sai no PDF">
          <textarea id="pg-obs" rows={3} className={inputCls} value={f.obs} onChange={set('obs')} placeholder="Escreva aqui observações ou condições adicionais..." />
        </Campo>

        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" disabled={salvando} onClick={() => salvar(true)}
            className="inline-flex items-center gap-2 bg-gold hover:bg-gold-hover text-white font-bold rounded-lg px-5 py-2.5 disabled:opacity-60">
            <Printer size={16} /> {f.id ? 'Salvar alterações e gerar PDF' : 'Salvar e gerar PDF'}
          </button>
          <button type="button" disabled={salvando} onClick={() => salvar(false)}
            className="inline-flex items-center gap-2 bg-navy hover:bg-navy-light text-white font-bold rounded-lg px-5 py-2.5 disabled:opacity-60">
            <Save size={16} /> Salvar
          </button>
          <button type="button" onClick={() => setF(FORM_VAZIO)}
            className="inline-flex items-center gap-2 border border-navy text-navy font-bold rounded-lg px-5 py-2.5 hover:bg-areia">
            <Plus size={16} /> Nova proposta
          </button>
        </div>
      </section>

      {/* Histórico */}
      <section className="bg-white border border-linha rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-black text-navy">Propostas geradas</h2>
          <span className="text-xs text-slate-500">{lista.length} no total</span>
          <div className="relative ml-auto w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input id="pg-busca" aria-label="Buscar proposta" className={`${inputCls} pl-8`} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Tomador, CNPJ ou número" />
          </div>
        </div>
        {carregando ? <p className="text-sm text-slate-500">Carregando...</p> : filtrada.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-slate-500 py-6">
            <FileText size={18} aria-hidden="true" />
            {lista.length === 0 ? 'Nenhuma proposta ainda. Preencha os dados acima e clique em Salvar e gerar PDF.' : 'Nenhuma proposta encontrada para essa busca.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b-2 border-linha text-left">
                <th className="py-2 px-3">Nº</th><th className="py-2 px-3">Data</th><th className="py-2 px-3">Tomador</th>
                <th className="py-2 px-3 text-right">IS</th><th className="py-2 px-3 text-right">Prêmio</th>
                <th className="py-2 px-3 text-right">Honorários</th><th className="py-2 px-3 text-right">Total</th>
                <th className="py-2 px-3">Status</th><th className="py-2 px-3 text-right">Ações</th>
              </tr></thead>
              <tbody>
                {filtrada.map(p => (
                  <tr key={p.id} className={`border-b border-linha ${f.id === p.id ? 'bg-areia-clara' : ''}`}>
                    <td className="py-2 px-3 font-semibold text-navy whitespace-nowrap">{p.numero}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2 px-3 min-w-[12rem]"><div className="font-medium text-navy">{p.tomador_nome}</div>
                      {p.tomador_cnpj && <div className="text-[10px] text-slate-500">{p.tomador_cnpj}</div>}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{brl(Number(p.importancia_segurada))}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{brl(Number(p.premio))}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{Number(p.honorario_valor) > 0 ? brl(Number(p.honorario_valor)) : '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-semibold">{brl(Number(p.total))}</td>
                    <td className="py-2 px-3">
                      <select aria-label={`Status da proposta ${p.numero}`} value={p.status} onChange={e => mudarStatus(p, e.target.value as Proposta['status'])}
                        className={`text-xs font-semibold border rounded-full px-2 py-1 ${STATUS_COR[p.status]}`}>
                        {(Object.keys(STATUS_ROTULO) as Proposta['status'][]).map(s => <option key={s} value={s}>{STATUS_ROTULO[s]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" title="Abrir para editar" aria-label={`Abrir ${p.numero}`} onClick={() => { setF(linhaParaForm(p)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          className="p-2 rounded-lg text-navy hover:bg-areia"><FolderOpen size={15} /></button>
                        <button type="button" title="Duplicar como nova proposta" aria-label={`Duplicar ${p.numero}`} onClick={() => { setF(linhaParaForm(p, true)); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('Cópia carregada. Ajuste e salve para gerar um número novo.', 'info'); }}
                          className="p-2 rounded-lg text-navy hover:bg-areia"><Copy size={15} /></button>
                        <button type="button" title="Gerar PDF" aria-label={`Gerar PDF de ${p.numero}`} onClick={() => imprimirProposta(paraPdf(p))}
                          className="p-2 rounded-lg text-gold-dark hover:bg-areia"><Printer size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PropostaGarantia;
