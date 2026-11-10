import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { GATILHOS, fmt } from '../../lib/posvendaGatilhos.ts';
import { hojeSaoPaulo } from '../../lib/contatoLead.ts';
import { formatCurrency } from '../../utils/formatters';
import { rotuloDia } from '../../lib/contatoLead.ts';
import { chaveFixado } from '../../lib/meuDiaFixados.ts';
import AcoesItem from './AcoesItem.tsx';

/**
 * "Meu dia", bloco de Operações: cotações em andamento e pós-venda aberto.
 *
 * As tarefas de pós-venda abertas não têm dono no banco (staff_id só é gravado
 * na conclusão), então aparecem para todo mundo que tem a função Operações.
 * O endosso depende de o cliente pedir: aqui a pessoa vê quem avisar (garantia
 * vencendo, acompanhamento do contrato) e resolve na tela Pós-venda.
 *
 * Quem tem a função pode fixar e adiar uma tarefa de pós-venda daqui (o
 * adiamento vale para todos). Concluir e registrar contato continuam no Pós-venda.
 */

interface Toque {
  id: string;
  gatilho: string;
  vence_em: string;
  sale_id: number;
  sales: Record<string, any> | null;
}

interface Cotacao {
  id: number;
  nome: string | null;
  tipo: string | null;
  seguradora: string | null;
  data: string | null;
  created_at: string | null;
  parceiro: string | null;
  is: number | string | null;
}

interface Vencendo {
  id: number;
  nome: string | null;
  tipo: string | null;
  seguradora: string | null;
  vigencia_fim: string;
}

const diasEntre = (deIso: string, ateIso: string): number =>
  Math.round((Date.parse(ateIso.slice(0, 10)) - Date.parse(deIso.slice(0, 10))) / 86400000);

const maisDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

interface BlocoOperacoesProps {
  onAbrir: (view: string) => void;
  /** Chaves dos itens fixados por quem está vendo ("posvenda:<id>"). */
  fixados: Set<string>;
  /** Falso quando o gestor abre o dia de outra pessoa: não fixa nem adia. */
  podeEditar: boolean;
  onFixar: (id: string, marcar: boolean) => void;
  avisar: (texto: string, desfazer?: () => void) => void;
}

const BlocoOperacoes: React.FC<BlocoOperacoesProps> = ({ onAbrir, fixados, podeEditar, onFixar, avisar }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [toques, setToques] = useState<Toque[]>([]);
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [vencendo, setVencendo] = useState<Vencendo[]>([]);
  const hoje = hojeSaoPaulo();

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [t, c, v] = await Promise.all([
          supabase.from('posvenda_toques')
            .select('id, gatilho, vence_em, sale_id, sales(nome, tipo, seguradora, segurado, orgaoLicitante, vigencia_fim, valorContrato)')
            .eq('status', 'aberto').lte('vence_em', hoje)
            .order('vence_em', { ascending: true }),
          supabase.from('sales')
            .select('id, nome, tipo, seguradora, data, created_at, parceiro, is')
            .eq('vendeu', 'Em andamento')
            .order('created_at', { ascending: true }),
          supabase.from('sales')
            .select('id, nome, tipo, seguradora, vigencia_fim')
            .eq('vendeu', 'Sim')
            // Só garantia que se renova: a de proposta (Licitante) acaba com a licitação
            // e já tem a tarefa "Resultado da licitação" no pós-venda.
            .or('tipo.is.null,tipo.neq.Licitante')
            .or('posvenda_status.is.null,posvenda_status.eq.ativa')
            .gte('vigencia_fim', hoje).lte('vigencia_fim', maisDias(hoje, 30))
            .order('vigencia_fim', { ascending: true }),
        ]);
        const falha = t.error || c.error || v.error;
        if (falha) throw new Error(falha.message);
        if (!vivo) return;
        setToques((t.data || []) as unknown as Toque[]);
        setCotacoes((c.data || []) as Cotacao[]);
        setVencendo((v.data || []) as Vencendo[]);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [hoje]);

  if (carregando) {
    return (
      <div className="flex items-center gap-3 text-slate-500 text-sm font-medium py-10">
        <Loader2 size={18} className="animate-spin" /> Carregando cotações e pós-venda…
      </div>
    );
  }

  if (erro) {
    return (
      <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
        Não consegui carregar cotações e pós-venda: {erro}
      </p>
    );
  }

  // Adiar muda o vencimento da tarefa no banco: ela some daqui e do Pós-venda
  // até a data escolhida, para todo mundo.
  const adiar = async (t: Toque, dia: string) => {
    const gravar = async (valor: string) => {
      const { error } = await supabase.from('posvenda_toques').update({ vence_em: valor }).eq('id', t.id);
      return error ? error.message : null;
    };
    const falha = await gravar(dia);
    const nome = t.sales?.nome || 'Tarefa';
    if (falha) { avisar(`Não consegui adiar a tarefa de ${nome}: ${falha}`); return; }
    setToques(lista => lista.filter(x => x.id !== t.id));
    avisar(`Pós-venda de ${nome} adiado para ${rotuloDia(dia)}.`, async () => {
      const erroDesfazer = await gravar(t.vence_em);
      if (erroDesfazer) { avisar(`Não consegui desfazer: ${erroDesfazer}`); return; }
      setToques(lista => [...lista, t].sort((a, b) => a.vence_em.localeCompare(b.vence_em)));
      avisar(`Pós-venda de ${nome} voltou para a lista.`);
    });
  };

  const ordenados = [
    ...toques.filter(t => fixados.has(chaveFixado('posvenda', t.id))),
    ...toques.filter(t => !fixados.has(chaveFixado('posvenda', t.id))),
  ];
  const atrasados = toques.filter(t => t.vence_em < hoje).length;
  const paradas = cotacoes.filter(c => diasEntre(c.created_at || c.data || hoje, hoje) >= 3).length;
  const LIMITE = 10;

  const numeros: { rotulo: string; valor: number; apoio: string; alerta?: boolean }[] = [
    { rotulo: 'Pós-venda para hoje', valor: toques.length, apoio: atrasados ? `${atrasados} de dias anteriores` : 'Nenhum atrasado', alerta: atrasados > 0 },
    { rotulo: 'Cotações em andamento', valor: cotacoes.length, apoio: paradas ? `${paradas} aberta${paradas === 1 ? '' : 's'} há 3 dias ou mais` : 'Nenhuma parada', alerta: paradas > 0 },
    { rotulo: 'Execução vencendo em 30 dias', valor: vencendo.length, apoio: vencendo[0] ? `Próxima em ${fmt(vencendo[0].vigencia_fim)}` : 'Nenhuma no período' },
  ];

  return (
    <div className="space-y-8">
      <section aria-label="Resumo de operações" className="grid grid-cols-1 sm:grid-cols-3 bg-white border border-linha rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-linha overflow-hidden">
        {numeros.map(n => (
          <div key={n.rotulo} className="px-6 py-5">
            <p className="text-sm font-semibold text-slate-600">{n.rotulo}</p>
            <p className="text-4xl font-extrabold tracking-tight mt-1.5">{n.valor}</p>
            <p className={`text-xs mt-1.5 ${n.alerta ? 'font-bold text-amber-800' : 'text-slate-600'}`}>{n.apoio}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
        <section className="xl:col-span-3 min-w-0">
          <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2.5">
            <h2 className="text-xl font-extrabold">Pós-venda de hoje</h2>
            <button onClick={() => onAbrir('posvenda')} className="text-sm font-bold underline underline-offset-4 hover:text-gold-dark">Abrir o Pós-venda</button>
          </div>
          {toques.length === 0 && <p className="text-sm text-slate-600 py-6">Nenhuma tarefa de pós-venda para hoje.</p>}
          <ul>
            {ordenados.slice(0, LIMITE).map(t => {
              const g = GATILHOS[t.gatilho];
              const atraso = diasEntre(t.vence_em, hoje);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 border-b border-linha">
                  <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${atraso > 0 ? 'bg-amber-500' : 'bg-sky-500'}`} />
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-base font-bold truncate">{t.sales?.nome || 'Cliente sem nome'}</p>
                    <p className="text-sm text-slate-600">{g && t.sales ? g.acao(t.sales) : 'Tarefa de pós-venda.'}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap ${atraso > 0 ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>
                    {g?.rot || t.gatilho}{atraso > 0 ? ` · há ${atraso} dia${atraso === 1 ? '' : 's'}` : ''}
                  </span>
                  {podeEditar && (
                    <AcoesItem
                      nome={t.sales?.nome || 'tarefa'}
                      fixado={fixados.has(chaveFixado('posvenda', t.id))}
                      onFixar={(marcar) => onFixar(t.id, marcar)}
                      onAdiar={(dia) => adiar(t, dia)}
                    />
                  )}
                  <button
                    onClick={() => onAbrir('posvenda')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border border-navy rounded-lg hover:bg-navy hover:text-white transition-colors"
                  >
                    Abrir <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {toques.length > LIMITE && (
            <button onClick={() => onAbrir('posvenda')} className="mt-4 text-sm font-bold underline underline-offset-4 hover:text-gold-dark">
              Ver as outras {toques.length - LIMITE} no Pós-venda
            </button>
          )}
        </section>

        <aside className="xl:col-span-2 min-w-0 space-y-9">
          <section>
            <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2.5">
              <h2 className="text-xl font-extrabold">Cotações em andamento</h2>
              <button onClick={() => onAbrir('goals')} className="text-sm font-bold underline underline-offset-4 hover:text-gold-dark">Registro de Vendas</button>
            </div>
            {cotacoes.length === 0 && <p className="text-sm text-slate-600 py-5">Nenhuma cotação em andamento.</p>}
            <ul>
              {cotacoes.slice(0, 8).map(c => {
                const dias = diasEntre(c.created_at || c.data || hoje, hoje);
                // sales.is é texto: pode vir como número ("150000") ou já formatado ("R$ 150.000,00").
                const isNumero = Number(c.is);
                const isTexto = isNumero > 0 ? formatCurrency(isNumero) : String(c.is || '').trim();
                return (
                  <li key={c.id} className="py-3.5 border-b border-linha">
                    <div className="flex justify-between gap-3">
                      <p className="text-base font-bold truncate">{c.nome || 'Sem nome'}</p>
                      <p className={`text-sm whitespace-nowrap ${dias >= 3 ? 'font-bold text-amber-800' : 'font-semibold text-slate-600'}`}>
                        {dias === 0 ? 'aberta hoje' : `aberta há ${dias} dia${dias === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600 truncate mt-0.5">
                      {[c.tipo, c.seguradora, isTexto ? `IS ${isTexto}` : '', c.parceiro ? `Parceiro: ${c.parceiro}` : ''].filter(Boolean).join(' · ') || 'Sem detalhes'}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <div className="border-b border-linha pb-2.5">
              <h2 className="text-xl font-extrabold">Garantias de execução vencendo em 30 dias</h2>
              <p className="text-sm text-slate-600 mt-0.5">Para avisar o cliente e se colocar à disposição para o endosso.</p>
            </div>
            {vencendo.length === 0 && <p className="text-sm text-slate-600 py-5">Nenhuma garantia de execução vence nos próximos 30 dias.</p>}
            <ul>
              {vencendo.slice(0, 8).map(v => (
                <li key={v.id} className="py-3.5 border-b border-linha flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold truncate">{v.nome || 'Sem nome'}</p>
                    <p className="text-sm text-slate-600 truncate mt-0.5">{[v.tipo, v.seguradora].filter(Boolean).join(' · ')}</p>
                  </div>
                  <p className="text-sm font-bold whitespace-nowrap">{fmt(v.vigencia_fim)}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default BlocoOperacoes;
