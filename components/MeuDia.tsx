import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { carregarFuncoes, carregarFuncoesDaEquipe, rotuloFuncoes, type FuncaoKey } from '../lib/funcoes.ts';
import { situacaoDoLead, diasDesdeTimestamp, type SituacaoLead } from '../lib/situacaoLead.ts';
import { hojeSaoPaulo, rotuloDia, ROTULO_ETAPA, RESUMO_RESULTADO } from '../lib/contatoLead.ts';
import { formatCurrency } from '../utils/formatters';
import BlocoOperacoes from './meuDia/BlocoOperacoes.tsx';
import BlocoResidencial from './meuDia/BlocoResidencial.tsx';
import BlocoGestao from './meuDia/BlocoGestao.tsx';
import type { EtapaLead, ResultadoContato } from '../types';

/**
 * Início "Meu dia" (10/11/2026).
 *
 * Mostra a cada pessoa o que ela tem para fazer hoje, conforme a função dela
 * (lib/funcoes.ts). Este arquivo traz a estrutura da tela e o bloco de
 * prospecção (SDR e Closer); Operações, Residencial e Gestão ficam em
 * components/meuDia/. Quem tem a função Gestão vê todos os blocos e pode
 * abrir o dia de outra pessoa da equipe.
 *
 * A tela só lê. Registrar contato, pegar lead e mudar etapa continuam no
 * Kanban de Leads: cada linha leva para lá.
 */

interface LeadDoDia {
  id: string;
  company: string | null;
  etapa: EtapaLead | null;
  proximo_passo: string | null;
  situacao_manual: SituacaoLead | null;
  situacao_manual_em: string | null;
  source: string | null;
  data_homologacao: string | null;
  valor_contrato: number | null;
  orgao_licitante: string | null;
  created_at: string;
}

interface UltimoContato { em: string; resultado: ResultadoContato | null }

type Filtro = 'tudo' | 'contatar' | 'retomar';

interface MeuDiaProps {
  email: string | undefined;
  onAbrir: (view: string) => void;
}

const saudacao = (): string => {
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
};

const dataPorExtenso = (): string => {
  const texto = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const MeuDia: React.FC<MeuDiaProps> = ({ email, onAbrir }) => {
  const eu = (email || '').toLowerCase();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [funcoes, setFuncoes] = useState<FuncaoKey[]>([]);
  const [nome, setNome] = useState('');
  const [leads, setLeads] = useState<LeadDoDia[]>([]);
  const [ultimo, setUltimo] = useState<Record<string, UltimoContato>>({});
  const [fila, setFila] = useState(0);
  const [contatosHoje, setContatosHoje] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  // Gestão: funções de quem está logado, equipe e de quem é o dia aberto.
  const [minhasFuncoes, setMinhasFuncoes] = useState<FuncaoKey[]>([]);
  const [equipe, setEquipe] = useState<{ email: string; nome: string }[]>([]);
  const [vendo, setVendo] = useState('');
  const alvo = vendo || eu;
  const vendoOutro = alvo !== eu;

  useEffect(() => {
    if (!eu) return;
    let vivo = true;
    (async () => {
      const [minhas, deTodos, membros] = await Promise.all([
        carregarFuncoes(eu),
        carregarFuncoesDaEquipe(),
        supabase.from('prospeccao_equipe').select('email, nome, ativo'),
      ]);
      if (!vivo) return;
      setMinhasFuncoes(minhas);
      const nomes: Record<string, string> = {};
      for (const m of membros.data || []) if (m.ativo !== false) nomes[String(m.email).toLowerCase()] = String(m.nome || '').trim();
      const lista = Object.keys(deTodos)
        .filter(e => e !== eu && deTodos[e].length > 0)
        .map(e => ({ email: e, nome: nomes[e] || e.split('@')[0] }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setEquipe(lista);
    })();
    return () => { vivo = false; };
  }, [eu]);

  useEffect(() => {
    if (!alvo) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [fs, membro, meus, naFila] = await Promise.all([
          carregarFuncoes(alvo),
          supabase.from('prospeccao_equipe').select('nome').eq('email', alvo).maybeSingle(),
          supabase.from('prospects')
            .select('id, company, etapa, proximo_passo, situacao_manual, situacao_manual_em, source, data_homologacao, valor_contrato, orgao_licitante, created_at')
            .eq('responsavel_email', alvo)
            .neq('status', 'Arquivo PNCP'),
          supabase.from('prospects').select('id', { count: 'exact', head: true })
            .eq('status', 'Novos Leads').is('responsavel_email', null),
        ]);
        if (meus.error) throw new Error(meus.error.message);
        const ativos = ((meus.data || []) as LeadDoDia[]).filter(l => l.etapa !== 'ganho' && l.etapa !== 'perdido');

        // Último contato de cada lead e contatos que eu fiz hoje.
        const mapa: Record<string, UltimoContato> = {};
        let hojeMeus = 0;
        const ids = ativos.map(l => l.id);
        const hoje = hojeSaoPaulo();
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await supabase.from('prospect_toques')
            .select('prospect_id, created_at, resultado, autor_email')
            .in('prospect_id', ids.slice(i, i + 200))
            .order('created_at', { ascending: false });
          if (error) throw new Error(error.message);
          for (const t of data || []) {
            if (!mapa[t.prospect_id]) mapa[t.prospect_id] = { em: t.created_at, resultado: t.resultado };
            const dia = new Date(t.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            if (dia === hoje && String(t.autor_email || '').toLowerCase() === alvo) hojeMeus += 1;
          }
        }
        if (!vivo) return;
        setFuncoes(fs);
        setNome(String(membro.data?.nome || '').trim().split(/\s+/)[0] || (alvo !== eu ? alvo.split('@')[0] : ''));
        setLeads(ativos);
        setUltimo(mapa);
        setContatosHoje(hojeMeus);
        setFila(naFila.count || 0);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [alvo, eu]);

  const fazProspeccao = funcoes.includes('sdr') || funcoes.includes('closer');
  // Gestão vê tudo no próprio dia; ao abrir o dia de outra pessoa, vê o que ela vê.
  const souGestor = minhasFuncoes.includes('gestao');
  const gestaoNoMeuDia = souGestor && !vendoOutro;
  const fazOperacoes = funcoes.includes('operacoes') || gestaoNoMeuDia;
  const fazResidencial = funcoes.includes('residencial') || gestaoNoMeuDia;
  const temBloco = fazProspeccao || fazOperacoes || fazResidencial || gestaoNoMeuDia;

  const { contatar, retomar, emConversa, paraAgir } = useMemo(() => {
    const comSituacao = leads.map(l => ({ lead: l, situacao: situacaoDoLead(ultimo[l.id]?.em, l) }));
    const c = comSituacao.filter(x => x.situacao === 'contatar').map(x => x.lead)
      // Sem contato ainda: homologação mais recente primeiro, como na fila do Kanban.
      .sort((a, b) => (b.data_homologacao || '').localeCompare(a.data_homologacao || '') || (b.created_at || '').localeCompare(a.created_at || ''));
    const r = comSituacao.filter(x => x.situacao === 'retomar').map(x => x.lead)
      .sort((a, b) => (a.proximo_passo || ultimo[a.id]?.em || '').localeCompare(b.proximo_passo || ultimo[b.id]?.em || ''));
    const conv = leads.filter(l => l.etapa === 'conversa' || l.etapa === 'cotacao')
      .sort((a, b) => (b.valor_contrato || 0) - (a.valor_contrato || 0));
    return { contatar: c, retomar: r, emConversa: conv, paraAgir: [...r, ...c] };
  }, [leads, ultimo]);

  const lista = filtro === 'contatar' ? contatar : filtro === 'retomar' ? retomar : paraAgir;
  const LIMITE = 12;

  const contexto = (l: LeadDoDia): string => {
    const partes: string[] = [];
    if (l.orgao_licitante) partes.push(l.orgao_licitante);
    if (l.valor_contrato) partes.push(formatCurrency(l.valor_contrato));
    const u = ultimo[l.id];
    if (u) {
      const dias = diasDesdeTimestamp(u.em);
      const quando = dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
      const resultado = u.resultado ? RESUMO_RESULTADO[u.resultado] : null;
      partes.push(`Último contato ${quando}${resultado ? `: ${resultado.toLowerCase()}` : ''}`);
    } else if (l.data_homologacao) {
      partes.push(`Homologada em ${rotuloDia(l.data_homologacao)}`);
    }
    return partes.join(' · ');
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-3 text-slate-500 text-sm font-medium py-16 justify-center">
        <Loader2 size={18} className="animate-spin" /> Montando o seu dia…
      </div>
    );
  }

  const numeros: { rotulo: string; valor: number; apoio: string; alerta?: boolean }[] = [
    { rotulo: 'Para agir hoje', valor: paraAgir.length, apoio: `${plural(contatar.length, 'novo', 'novos')}, ${plural(retomar.length, 'retomada', 'retomadas')}` },
    { rotulo: 'Para retomar', valor: retomar.length, apoio: retomar.length ? 'Chegou o dia do próximo contato' : 'Nenhum contato vencido', alerta: retomar.length > 0 },
    { rotulo: 'Em conversa ou cotação', valor: emConversa.length, apoio: 'Leads que já responderam' },
    { rotulo: 'Contatos feitos hoje', valor: contatosHoje, apoio: `${plural(fila, 'lead', 'leads')} na fila sem dono` },
  ];

  const abas: { chave: Filtro; rotulo: string; qtd: number }[] = [
    { chave: 'tudo', rotulo: 'Tudo', qtd: paraAgir.length },
    { chave: 'retomar', rotulo: 'Retomar', qtd: retomar.length },
    { chave: 'contatar', rotulo: 'Para contatar', qtd: contatar.length },
  ];

  return (
    <div className="space-y-8 animate-fade-in text-navy">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {vendoOutro ? `Dia de ${nome || alvo}` : `${saudacao()}${nome ? `, ${nome}` : ''}`}
          </h1>
          <p className="text-base text-slate-600 mt-1">
            {dataPorExtenso()}.{' '}
            {fazProspeccao
              ? (paraAgir.length
                ? `${vendoOutro ? 'Tem' : 'Você tem'} ${plural(paraAgir.length, 'lead', 'leads')} para agir hoje.`
                : 'Nenhum lead pendente para hoje.')
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {souGestor && equipe.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              Ver o dia de
              <select
                value={vendo}
                onChange={(e) => { setVendo(e.target.value); setFiltro('tudo'); }}
                className="px-3 py-2 bg-white border border-linha rounded-lg text-sm font-bold text-navy outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold cursor-pointer"
              >
                <option value="">Meu dia</option>
                {equipe.map(m => <option key={m.email} value={m.email}>{m.nome}</option>)}
              </select>
            </label>
          )}
          {funcoes.length > 0 && (
            <span className="text-xs font-semibold text-slate-600 bg-white border border-linha rounded-lg px-3 py-1.5">
              Função: {rotuloFuncoes(funcoes)}
            </span>
          )}
        </div>
      </header>

      {erro && (
        <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          Não consegui carregar o seu dia: {erro}
        </p>
      )}

      {!temBloco && !erro && (
        <div className="bg-white border border-linha rounded-xl p-6">
          <p className="text-base font-bold">
            {vendoOutro ? 'Esta pessoa ainda não tem função definida.' : 'Você ainda não tem função definida.'}
          </p>
          <p className="text-sm text-slate-600 mt-1">
            A função é marcada em Usuários do Hub (menu Ferramentas) e define o que aparece aqui.
          </p>
        </div>
      )}

      {gestaoNoMeuDia && <BlocoGestao onAbrir={onAbrir} />}

      {fazProspeccao && (
        <>
          {gestaoNoMeuDia && <h2 className="text-2xl font-extrabold tracking-tight pt-4 border-t border-linha">Prospecção</h2>}
          {/* Números do dia: uma faixa só, sem cartão por número */}
          <section aria-label="Resumo do dia" className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-linha rounded-xl divide-x divide-y lg:divide-y-0 divide-linha overflow-hidden">
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
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-linha">
                <h2 className="text-xl font-extrabold pb-2.5">Para fazer agora</h2>
                <div role="tablist" aria-label="Filtrar leads" className="flex">
                  {abas.map(a => (
                    <button
                      key={a.chave}
                      role="tab"
                      aria-selected={filtro === a.chave}
                      onClick={() => setFiltro(a.chave)}
                      className={`px-4 pb-2.5 pt-1 text-sm border-b-2 -mb-px transition-colors ${
                        filtro === a.chave ? 'border-gold text-navy font-bold' : 'border-transparent text-slate-600 font-semibold hover:text-navy'
                      }`}
                    >
                      {a.rotulo} <span className="text-slate-500 font-semibold">{a.qtd}</span>
                    </button>
                  ))}
                </div>
              </div>

              {lista.length === 0 && (
                <p className="text-sm text-slate-600 py-6">Nada pendente neste filtro.</p>
              )}

              <ul>
                {lista.slice(0, LIMITE).map(l => {
                  const retomada = retomar.includes(l);
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 border-b border-linha">
                      <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${retomada ? 'bg-amber-500' : 'bg-sky-500'}`} />
                      <div className="flex-1 min-w-[220px]">
                        <p className="text-base font-bold truncate">{l.company || 'Lead sem nome'}</p>
                        <p className="text-sm text-slate-600 truncate">{contexto(l) || 'Sem detalhes da licitação'}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${retomada ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>
                        {retomada ? (l.proximo_passo ? `Retomar: ${rotuloDia(l.proximo_passo)}` : 'Retomar') : 'Primeiro contato'}
                      </span>
                      <button
                        onClick={() => onAbrir('prospeccao')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold border border-navy rounded-lg hover:bg-navy hover:text-white transition-colors"
                      >
                        Abrir <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>

              {lista.length > LIMITE && (
                <button onClick={() => onAbrir('prospeccao')} className="mt-4 text-sm font-bold underline underline-offset-4 hover:text-gold-dark">
                  Ver os outros {lista.length - LIMITE} na prospecção
                </button>
              )}
            </section>

            <aside className="xl:col-span-2 min-w-0 space-y-9">
              <section>
                <div className="flex items-baseline justify-between gap-3 border-b border-linha pb-2.5">
                  <h2 className="text-xl font-extrabold">Em conversa ou cotação</h2>
                  <button onClick={() => onAbrir('prospeccao')} className="text-sm font-bold underline underline-offset-4 hover:text-gold-dark">Ver todos</button>
                </div>
                {emConversa.length === 0 && <p className="text-sm text-slate-600 py-5">Nenhum lead nessa etapa.</p>}
                <ul>
                  {emConversa.slice(0, 6).map(l => (
                    <li key={l.id} className="py-3.5 border-b border-linha">
                      <div className="flex justify-between gap-3">
                        <p className="text-base font-bold truncate">{l.company || 'Lead sem nome'}</p>
                        {l.valor_contrato ? <p className="text-base font-bold whitespace-nowrap">{formatCurrency(l.valor_contrato)}</p> : null}
                      </div>
                      <p className="text-sm text-slate-600 truncate mt-0.5">
                        {l.etapa ? ROTULO_ETAPA[l.etapa] : ''}{l.orgao_licitante ? ` · ${l.orgao_licitante}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="bg-white border border-linha rounded-xl p-6">
                <h2 className="text-lg font-extrabold">Fila de novos leads</h2>
                <p className="text-sm text-slate-600 mt-1">
                  {fila > 0 ? `${plural(fila, 'lead aguarda', 'leads aguardam')} um responsável.` : 'A fila está vazia.'}
                </p>
                {fila > 0 && (
                  <button
                    onClick={() => onAbrir('prospeccao')}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-navy text-white text-sm font-bold rounded-lg hover:bg-navy-light transition-colors"
                  >
                    Pegar leads <ArrowRight size={14} aria-hidden="true" />
                  </button>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      {fazOperacoes && (
        <>
          {(fazProspeccao || gestaoNoMeuDia) && <h2 className="text-2xl font-extrabold tracking-tight pt-4 border-t border-linha">Operações</h2>}
          <BlocoOperacoes onAbrir={onAbrir} />
        </>
      )}

      {fazResidencial && (
        <>
          {(fazProspeccao || fazOperacoes) && <h2 className="text-2xl font-extrabold tracking-tight pt-4 border-t border-linha">Residencial</h2>}
          <BlocoResidencial onAbrir={onAbrir} />
        </>
      )}
    </div>
  );
};

export default MeuDia;
