import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hojeSaoPaulo } from '../../lib/contatoLead.ts';
import { fmt } from '../../lib/posvendaGatilhos.ts';

/**
 * "Meu dia", bloco de Residencial: o que chegou para atender, o que está
 * vencendo e os repasses das imobiliárias.
 *
 * As regras são as mesmas das telas de origem:
 *  - vencendo: Ativo, fim da vigência em até 30 dias, sem "não renovar" e fora
 *    do Repasse (mesma conta do aviso do menu, em App.tsx);
 *  - repasse: próximo vencimento em até 10 dias (mesma janela do aviso
 *    automático imobiliaria-repasse-aviso).
 *
 * Só leitura. Tudo se resolve no Registro de Vendas do residencial e no
 * Repasse Imobiliárias.
 */

interface Cliente { id: string | number; nome: string | null; cpf: string | null; produto: string | null; fim_vigencia: string | null; nao_renovar: boolean | null; situacao: string | null; created_at: string | null }
interface Imob { id: string | number; inquilino_nome: string | null; cpf: string | null; kanban_status: string | null; kanban_status_em: string | null; tipo_seguro: string | null; is_repasse: boolean | null; proximo_vencimento: string | null; parcela_atual: number | null; total_parcelas: number | null }

const maisDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (deIso: string, ateIso: string): number =>
  Math.round((Date.parse(ateIso.slice(0, 10)) - Date.parse(deIso.slice(0, 10))) / 86400000);

const nomeChave = (n: string | null) => (n || '').trim().toUpperCase();
const cpfChave = (c: string | null) => (c || '').replace(/\D/g, '');

const BlocoResidencial: React.FC<{ onAbrir: (view: string) => void }> = ({ onAbrir }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [vencendo, setVencendo] = useState<Cliente[]>([]);
  const [leadsSite, setLeadsSite] = useState<Cliente[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Imob[]>([]);
  const [repasses, setRepasses] = useState<Imob[]>([]);
  const hoje = hojeSaoPaulo();

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [v, l, imob] = await Promise.all([
          supabase.from('residential_clients')
            .select('id, nome, cpf, produto, fim_vigencia, nao_renovar, situacao, created_at')
            .eq('situacao', 'Ativo').gte('fim_vigencia', hoje).lte('fim_vigencia', maisDias(hoje, 30))
            .order('fim_vigencia', { ascending: true }),
          supabase.from('residential_clients')
            .select('id, nome, cpf, produto, fim_vigencia, nao_renovar, situacao, created_at')
            .eq('situacao', 'Lead (site)')
            .order('created_at', { ascending: false }),
          supabase.from('imobiliaria_clientes')
            .select('id, inquilino_nome, cpf, kanban_status, kanban_status_em, tipo_seguro, is_repasse, proximo_vencimento, parcela_atual, total_parcelas'),
        ]);
        const falha = v.error || l.error || imob.error;
        if (falha) throw new Error(falha.message);
        const todosImob = (imob.data || []) as Imob[];
        const nomesRepasse = new Set(todosImob.map(r => nomeChave(r.inquilino_nome)).filter(Boolean));
        const cpfsRepasse = new Set(todosImob.map(r => cpfChave(r.cpf)).filter(c => c.length >= 11));
        const venc = ((v.data || []) as Cliente[]).filter(r =>
          !r.nao_renovar && !nomesRepasse.has(nomeChave(r.nome)) && !(cpfChave(r.cpf).length >= 11 && cpfsRepasse.has(cpfChave(r.cpf))));
        const limite = maisDias(hoje, 10);
        if (!vivo) return;
        setVencendo(venc);
        setLeadsSite((l.data || []) as Cliente[]);
        setSolicitacoes(todosImob.filter(r => r.kanban_status === 'solicitado' || r.kanban_status === 'atendimento_iniciado'));
        setRepasses(todosImob
          .filter(r => r.is_repasse && r.proximo_vencimento && r.proximo_vencimento.slice(0, 10) <= limite)
          .sort((a, b) => (a.proximo_vencimento || '').localeCompare(b.proximo_vencimento || '')));
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
        <Loader2 size={18} className="animate-spin" /> Carregando o residencial…
      </div>
    );
  }

  if (erro) {
    return (
      <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
        Não consegui carregar o residencial: {erro}
      </p>
    );
  }

  const repassesAtrasados = repasses.filter(r => (r.proximo_vencimento || '') < hoje).length;
  const numeros: { rotulo: string; valor: number; apoio: string; alerta?: boolean }[] = [
    { rotulo: 'Solicitações das imobiliárias', valor: solicitacoes.length, apoio: solicitacoes.length ? 'Aguardando atendimento' : 'Nenhuma pendente', alerta: solicitacoes.length > 0 },
    { rotulo: 'Leads do site', valor: leadsSite.length, apoio: 'Formulário público, sem atendimento ainda' },
    { rotulo: 'Vencendo em 30 dias', valor: vencendo.length, apoio: vencendo[0]?.fim_vigencia ? `Próximo em ${fmt(vencendo[0].fim_vigencia)}` : 'Nenhum no período' },
    { rotulo: 'Repasses em 10 dias', valor: repasses.length, apoio: repassesAtrasados ? `${repassesAtrasados} já vencido${repassesAtrasados === 1 ? '' : 's'}` : 'Nenhum vencido', alerta: repassesAtrasados > 0 },
  ];

  const paraAtender = [
    ...solicitacoes.map(s => ({ chave: `s${s.id}`, nome: s.inquilino_nome, detalhe: [s.tipo_seguro, s.kanban_status === 'atendimento_iniciado' ? 'Atendimento iniciado' : 'Solicitação nova'].filter(Boolean).join(' · '), selo: 'Imobiliária', view: 'imobiliaria-repasse', alerta: true })),
    ...leadsSite.map(l => ({ chave: `l${l.id}`, nome: l.nome, detalhe: [l.produto, l.created_at ? `Chegou em ${fmt(l.created_at.slice(0, 10))}` : ''].filter(Boolean).join(' · '), selo: 'Site', view: 'residential', alerta: false })),
  ];
  const LIMITE = 10;

  return (
    <div className="space-y-8">
      <section aria-label="Resumo do residencial" className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-linha rounded-xl divide-x divide-y lg:divide-y-0 divide-linha overflow-hidden">
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
          <div className="border-b border-linha pb-2.5">
            <h2 className="text-xl font-extrabold">Para atender</h2>
          </div>
          {paraAtender.length === 0 && <p className="text-sm text-slate-600 py-6">Nada novo para atender.</p>}
          <ul>
            {paraAtender.slice(0, LIMITE).map(p => (
              <li key={p.chave} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 border-b border-linha">
                <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.alerta ? 'bg-amber-500' : 'bg-sky-500'}`} />
                <div className="flex-1 min-w-[220px]">
                  <p className="text-base font-bold truncate">{p.nome || 'Sem nome'}</p>
                  <p className="text-sm text-slate-600 truncate">{p.detalhe || 'Sem detalhes'}</p>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-md ${p.alerta ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>{p.selo}</span>
                <button
                  onClick={() => onAbrir(p.view)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border border-navy rounded-lg hover:bg-navy hover:text-white transition-colors"
                >
                  Abrir <ArrowRight size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {paraAtender.length > LIMITE && (
            <button onClick={() => onAbrir('residential')} className="mt-4 text-sm font-bold underline underline-offset-4 hover:text-gold-dark">
              Ver os outros {paraAtender.length - LIMITE} no Registro de Vendas
            </button>
          )}
        </section>

        <aside className="xl:col-span-2 min-w-0 space-y-9">
          <section>
            <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2.5">
              <h2 className="text-xl font-extrabold">Vencendo em 30 dias</h2>
              <button onClick={() => onAbrir('residential')} className="text-sm font-bold underline underline-offset-4 hover:text-gold-dark">Registro de Vendas</button>
            </div>
            {vencendo.length === 0 && <p className="text-sm text-slate-600 py-5">Nenhuma apólice vence nos próximos 30 dias.</p>}
            <ul>
              {vencendo.slice(0, 8).map(v => (
                <li key={v.id} className="py-3.5 border-b border-linha flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold truncate">{v.nome || 'Sem nome'}</p>
                    <p className="text-sm text-slate-600 truncate mt-0.5">{v.produto || 'Produto não informado'}</p>
                  </div>
                  <p className="text-sm font-bold whitespace-nowrap">{fmt(v.fim_vigencia)}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2.5">
              <h2 className="text-xl font-extrabold">Repasses em 10 dias</h2>
              <button onClick={() => onAbrir('imobiliaria-repasse')} className="text-sm font-bold underline underline-offset-4 hover:text-gold-dark">Repasse Imobiliárias</button>
            </div>
            {repasses.length === 0 && <p className="text-sm text-slate-600 py-5">Nenhum repasse vence nos próximos 10 dias.</p>}
            <ul>
              {repasses.slice(0, 8).map(r => {
                const atraso = r.proximo_vencimento ? diasEntre(r.proximo_vencimento, hoje) : 0;
                return (
                  <li key={r.id} className="py-3.5 border-b border-linha flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold truncate">{r.inquilino_nome || 'Sem nome'}</p>
                      <p className="text-sm text-slate-600 truncate mt-0.5">
                        {r.parcela_atual && r.total_parcelas ? `Parcela ${r.parcela_atual} de ${r.total_parcelas}` : 'Repasse'}
                      </p>
                    </div>
                    <p className={`text-sm whitespace-nowrap ${atraso > 0 ? 'font-bold text-amber-800' : 'font-bold'}`}>
                      {fmt(r.proximo_vencimento?.slice(0, 10))}{atraso > 0 ? ' · vencido' : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default BlocoResidencial;
