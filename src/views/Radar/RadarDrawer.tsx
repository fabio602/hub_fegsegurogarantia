import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, KanbanSquare, Ban, RotateCcw, Loader2, ExternalLink, Mail, Phone, Building2, Users, FileText, Gavel, Scale, ChevronDown, ChevronRight, Search, ShieldCheck, CircleAlert, Pencil, Undo2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { formatCurrency } from '../../../utils/formatters.ts';
import ModalPortal from '../../../components/ModalPortal.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { ScoreBadge, StatusBadge } from './RadarTabela.tsx';
import {
  DOSSIE_CLASSES, DOSSIE_LABEL, GARANTIA_OPCOES, MOTIVO_LABEL, alertaSemAdvogado, classeCurta, dossieAntigo, formatCnpj, formatCompetencia,
  emailEfetivo, formatDataBr, formatDataHoraBr, formatTelefone, inscricaoGarantida, leituraDossie, nomeExibicao, receitasResumo, telefoneEfetivo,
  type GarantiaInformada, type RadarAdvogadoProcesso, type RadarEmpresa, type RadarInscricao, type RadarMovimento, type RadarProcesso,
} from './radarTipos.ts';

interface Props {
  empresa: RadarEmpresa;
  onFechar: () => void;
  /** Chamado com a linha já atualizada depois de enviar, descartar ou reverter. */
  onAtualizada: (e: RadarEmpresa) => void;
  onAbrirKanban: () => void;
}

const secao = 'text-[10px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-1.5';
const botaoCopiar = 'p-1 rounded-md text-slate-600 hover:text-navy hover:bg-slate-100 transition-colors';

interface AdvogadoAgrupado {
  nome: string;
  oab: string | null;
  processos: number;
}

/** Deduplica advogados do polo passivo entre os processos da empresa, contando em quantos aparecem. */
const agruparAdvogados = (lista: RadarAdvogadoProcesso[]): AdvogadoAgrupado[] => {
  const mapa = new Map<string, AdvogadoAgrupado & { ids: Set<number> }>();
  for (const a of lista) {
    if (a.polo !== 'passivo') continue;
    const chave = `${a.nome}|${a.oab ?? ''}`;
    const atual = mapa.get(chave) ?? { nome: a.nome, oab: a.oab, processos: 0, ids: new Set<number>() };
    atual.ids.add(a.processo_id);
    mapa.set(chave, atual);
  }
  return Array.from(mapa.values())
    .map(a => ({ nome: a.nome, oab: a.oab, processos: a.ids.size }))
    .sort((a, b) => b.processos - a.processos || a.nome.localeCompare(b.nome));
};
const dado = (rotulo: string, valor: React.ReactNode) => (
  <div>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{rotulo}</dt>
    <dd className="text-sm text-slate-800 font-medium break-words">{valor || <span className="text-slate-500">Não informado</span>}</dd>
  </div>
);

interface ContatoEditavelProps {
  rotulo: string;
  icone: React.ReactNode;
  /** Valor manual gravado (já formatado para exibir), ou null. */
  manual: string | null;
  /** Valor da BrasilAPI, ou null. */
  api: string | null;
  tipo: 'tel' | 'email';
  ocupado: boolean;
  onSalvar: (valor: string) => Promise<boolean>;
  onRestaurar: () => Promise<boolean>;
  onCopiar: (texto: string) => void;
}

/**
 * Telefone ou e-mail editável por clique, no padrão do card do Kanban:
 * clique abre o input, Enter salva, Esc cancela. Com valor manual, ele é o
 * principal e o da BrasilAPI aparece abaixo, menor, com botão Restaurar.
 */
function ContatoEditavel({ rotulo, icone, manual, api, tipo, ocupado, onSalvar, onRestaurar, onCopiar }: ContatoEditavelProps) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const principal = manual ?? api;
  const rotuloId = `radar-contato-${tipo}`;

  const abrir = () => { if (ocupado) return; setTexto(manual ?? api ?? ''); setEditando(true); };
  const confirmar = async () => {
    const ok = await onSalvar(texto);
    if (ok) setEditando(false);
  };

  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1">
        {icone} {rotulo}
        {manual && <span className="ml-1 px-1.5 py-px rounded bg-blue-50 text-blue-700 border border-blue-200 text-[9px] normal-case tracking-normal">manual</span>}
      </dt>
      <dd className="text-sm font-medium text-slate-800">
        {editando ? (
          <input
            autoFocus
            id={rotuloId}
            type={tipo}
            inputMode={tipo === 'tel' ? 'tel' : 'email'}
            value={texto}
            aria-label={`Editar ${rotulo.toLowerCase()}`}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
              else if (e.key === 'Escape') {
                // Esc cancela só a edição; o drawer também escuta Esc na window para fechar
                e.preventDefault();
                e.nativeEvent.stopPropagation();
                setEditando(false);
              }
            }}
            onBlur={() => setEditando(false)}
            placeholder={tipo === 'tel' ? 'DDD + número' : 'nome@empresa.com.br'}
            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white"
          />
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={abrir} disabled={ocupado} title="Clique para editar"
              className={`text-left rounded px-0.5 -mx-0.5 hover:bg-areia-clara transition-colors ${tipo === 'email' ? 'break-all' : ''} ${principal ? '' : 'text-slate-500'}`}>
              {principal ?? 'Não informado'}
            </button>
            <button type="button" onClick={abrir} disabled={ocupado} aria-label={`Editar ${rotulo.toLowerCase()}`} className={botaoCopiar}><Pencil size={12} /></button>
            {principal && (
              <button type="button" onClick={() => onCopiar(principal)} aria-label={`Copiar ${rotulo.toLowerCase()}`} className={botaoCopiar}><Copy size={12} /></button>
            )}
          </div>
        )}
        {manual && (
          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-slate-600">
            <span className="font-bold uppercase tracking-wider text-[9px]">BrasilAPI</span>
            <span className={tipo === 'email' ? 'break-all' : ''}>{api ?? 'não informado'}</span>
            <button type="button" onClick={onRestaurar} disabled={ocupado}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-slate-200 bg-white text-slate-700 text-[10px] font-bold uppercase tracking-wider hover:border-gold hover:text-navy disabled:opacity-50 transition-colors">
              <Undo2 size={10} aria-hidden="true" /> Restaurar
            </button>
          </div>
        )}
      </dd>
    </div>
  );
}

/**
 * Drawer lateral com o detalhe da empresa e as três ações do Radar.
 *
 * Vai por ModalPortal porque o wrapper .animate-fade-in do App.tsx cria um
 * bloco de contenção para position: fixed (ver comentário em ModalPortal).
 */
export default function RadarDrawer({ empresa, onFechar, onAtualizada, onAbrirKanban }: Props) {
  const { toast } = useToast();
  const [inscricoes, setInscricoes] = useState<RadarInscricao[] | null>(null);
  const [salvando, setSalvando] = useState<'kanban' | 'descartar' | 'reverter' | null>(null);
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [motivo, setMotivo] = useState('');
  // Fase 2: dossiê do PJe
  const [processos, setProcessos] = useState<RadarProcesso[] | null>(null);
  const [movimentos, setMovimentos] = useState<RadarMovimento[]>([]);
  const [advogadosProc, setAdvogadosProc] = useState<RadarAdvogadoProcesso[]>([]);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [enfileirando, setEnfileirando] = useState(false);
  const [garantia, setGarantia] = useState<GarantiaInformada | ''>(empresa.garantia_informada ?? '');
  const [garantiaObs, setGarantiaObs] = useState(empresa.garantia_obs ?? '');
  const [salvandoGarantia, setSalvandoGarantia] = useState(false);
  const advogados = useMemo(() => agruparAdvogados(advogadosProc), [advogadosProc]);
  const [salvandoContato, setSalvandoContato] = useState(false);

  useEffect(() => {
    let vivo = true;
    setInscricoes(null);
    setPedindoMotivo(false);
    setMotivo('');
    supabase
      .from('radar_inscricoes')
      .select('id, numero_inscricao, receita_principal, tipo_situacao, situacao, data_inscricao, valor_consolidado')
      .eq('cnpj', empresa.cnpj)
      .eq('competencia', empresa.competencia_ultima)
      .order('valor_consolidado', { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { toast('Não foi possível carregar as inscrições.', 'error'); setInscricoes([]); return; }
        setInscricoes((data ?? []) as RadarInscricao[]);
      });
    return () => { vivo = false; };
  }, [empresa.cnpj, empresa.competencia_ultima]);

  // Processos do PJe, movimentações e advogados (Fase 2). Recarrega quando o dossiê muda.
  useEffect(() => {
    let vivo = true;
    setProcessos(null);
    setMovimentos([]);
    setAdvogadosProc([]);
    setExpandido(null);
    setGarantia(empresa.garantia_informada ?? '');
    setGarantiaObs(empresa.garantia_obs ?? '');
    (async () => {
      const { data, error } = await supabase
        .from('radar_processos')
        .select('id, numero_cnj, classe_codigo, classe_nome, assunto, jurisdicao, orgao_julgador, data_distribuicao, polo_passivo_nome, cnpj_mascarado, ultima_movimentacao_texto, ultima_movimentacao_em, qtd_movimentacoes, capturado_em')
        .eq('cnpj', empresa.cnpj)
        .order('data_distribuicao', { ascending: false, nullsFirst: false })
        .order('numero_cnj', { ascending: false });
      if (!vivo) return;
      if (error) { toast('Não foi possível carregar os processos.', 'error'); setProcessos([]); return; }
      const lista = (data ?? []) as RadarProcesso[];
      setProcessos(lista);
      if (lista.length === 0) return;
      const ids = lista.map(p => p.id);
      const [movs, advs] = await Promise.all([
        supabase.from('radar_processo_movimentos').select('id, processo_id, ocorrido_em, texto').in('processo_id', ids).order('ocorrido_em', { ascending: false }),
        supabase.from('radar_processo_advogados').select('id, processo_id, nome, oab, polo').in('processo_id', ids).order('nome'),
      ]);
      if (!vivo) return;
      setMovimentos((movs.data ?? []) as RadarMovimento[]);
      setAdvogadosProc((advs.data ?? []) as RadarAdvogadoProcesso[]);
    })();
    return () => { vivo = false; };
  }, [empresa.cnpj, empresa.dossie_em, empresa.dossie_status]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast(`${rotulo} copiado.`, 'success', 2000);
    } catch {
      toast(`Não foi possível copiar o ${rotulo.toLowerCase()}.`, 'error');
    }
  };

  /** Relê a linha e devolve para a tabela (score e atualizado_em vêm do banco). */
  const recarregar = async () => {
    await supabase.rpc('radar_atualizar_score', { p_cnpj: empresa.cnpj });
    const { data } = await supabase.from('radar_empresas').select('*').eq('cnpj', empresa.cnpj).single();
    if (data) onAtualizada(data as RadarEmpresa);
  };

  const enviarKanban = async () => {
    setSalvando('kanban');
    try {
      const socio = empresa.socios?.[0]?.nome ?? null;
      const nomeEmpresa = empresa.nome_fantasia || empresa.razao_social || empresa.nome_devedor;
      const descricao = [
        'Origem: Radar PGFN (dívida ativa da União, ajuizada)',
        `Valor total inscrito: ${formatCurrency(Number(empresa.valor_total))}`,
        `Inscrições: ${empresa.qtd_inscricoes}`,
        `Receitas: ${receitasResumo(empresa.receitas).join(', ') || '-'}`,
        `Garantia em alguma inscrição: ${empresa.tem_garantia ? 'sim' : 'não'}`,
        `Competência PGFN: ${formatCompetencia(empresa.competencia_ultima)}`,
        empresa.cnae_descricao ? `CNAE: ${empresa.cnae_principal} - ${empresa.cnae_descricao}` : '',
        empresa.porte ? `Porte: ${empresa.porte}` : '',
        `Score Radar: ${empresa.score}`,
        // Fase 2: dossiê do PJe, quando houver
        (empresa.dossie_status === 'pronto' || empresa.dossie_status === 'sem_processos')
          ? `Execuções fiscais: ${empresa.qtd_execucoes}, Embargos: ${empresa.qtd_embargos}` : '',
        advogados.length > 0
          ? `Advogados: ${advogados.map(a => `${a.nome}${a.oab ? ` (${a.oab})` : ''}`).join(', ')}` : '',
      ].filter(Boolean).join('\n');

      // Mesmo mecanismo da Edge Function lead-cotacao: insert direto em
      // prospects, coluna "Novos Leads". Só colunas que já existem na tabela.
      const { data: prospect, error: pErr } = await supabase.from('prospects').insert({
        name: socio || nomeEmpresa,
        company: nomeEmpresa,
        cnpj: formatCnpj(empresa.cnpj),
        email: emailEfetivo(empresa),
        phonenumber: telefoneEfetivo(empresa),
        city: empresa.municipio,
        state: empresa.uf,
        status: 'Novos Leads',
        status_entered_at: new Date().toISOString(),
        source: 'radar',
        product_type: 'Seguro Garantia',
        segmento: empresa.cnae_descricao,
        decisor: socio,
        description: descricao,
        tags: ['radar', 'pgfn'],
        cnae_principal: empresa.cnae_principal,
      }).select('id').single();
      if (pErr || !prospect) throw new Error(pErr?.message ?? 'sem retorno');

      const { error: rErr } = await supabase.from('radar_empresas')
        .update({ status: 'enviado_kanban', prospect_id: prospect.id, motivo_exclusao: null, atualizado_em: new Date().toISOString() })
        .eq('cnpj', empresa.cnpj);
      if (rErr) throw new Error(rErr.message);

      await recarregar();
      toast('Lead criado em Novos Leads.', 'success');
    } catch (e) {
      toast(`Falha ao enviar ao Kanban: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setSalvando(null);
    }
  };

  const descartar = async () => {
    const m = motivo.trim();
    if (!m) { toast('Informe o motivo do descarte.', 'warning'); return; }
    setSalvando('descartar');
    const { error } = await supabase.from('radar_empresas')
      .update({ status: 'descartado', motivo_exclusao: m.slice(0, 200), atualizado_em: new Date().toISOString() })
      .eq('cnpj', empresa.cnpj);
    if (error) toast(`Falha ao descartar: ${error.message}`, 'error');
    else { await recarregar(); setPedindoMotivo(false); setMotivo(''); toast('Empresa descartada.', 'success'); }
    setSalvando(null);
  };

  const reverter = async () => {
    setSalvando('reverter');
    const { error } = await supabase.from('radar_empresas')
      .update({ status: 'novo', motivo_exclusao: null, prospect_id: null, atualizado_em: new Date().toISOString() })
      .eq('cnpj', empresa.cnpj);
    if (error) toast(`Falha ao reverter: ${error.message}`, 'error');
    else { await recarregar(); toast('Empresa de volta para novo.', 'success'); }
    setSalvando(null);
  };

  /**
   * Contato manual (migração 082): RPC radar_atualizar_contato_manual. Envia só
   * o campo editado (o outro vai null = manter); string vazia limpa. Em erro,
   * a tela mantém o valor anterior (só relê a linha quando dá certo).
   */
  const gravarContato = async (campo: 'telefone' | 'email', valor: string): Promise<boolean> => {
    setSalvandoContato(true);
    const { error } = await supabase.rpc('radar_atualizar_contato_manual', {
      p_cnpj: empresa.cnpj,
      p_telefone: campo === 'telefone' ? valor : null,
      p_email: campo === 'email' ? valor : null,
    });
    setSalvandoContato(false);
    if (error) { toast(error.message.replace(/^.*?:\s*/, '') || 'Não foi possível salvar.', 'error'); return false; }
    await recarregar();
    toast(valor.trim() ? (campo === 'telefone' ? 'Telefone salvo.' : 'E-mail salvo.') : 'Valor da BrasilAPI restaurado.', 'success');
    return true;
  };

  /** Coloca (ou recoloca) a empresa na fila do PJe com prioridade 100. */
  const buscarProcessos = async () => {
    setEnfileirando(true);
    const agoraIso = new Date().toISOString();
    const { error } = await supabase.from('radar_pje_fila').upsert({
      cnpj: empresa.cnpj, prioridade: 100, status: 'pendente', tentativas: 0,
      erro: null, iniciado_em: null, finalizado_em: null, criado_em: agoraIso,
    }, { onConflict: 'cnpj' });
    if (error) {
      toast(`Falha ao enfileirar: ${error.message}`, 'error');
    } else {
      const { error: eErr } = await supabase.from('radar_empresas')
        .update({ dossie_status: 'fila', atualizado_em: agoraIso }).eq('cnpj', empresa.cnpj);
      if (eErr) toast(`Falha ao marcar a fila: ${eErr.message}`, 'error');
      else { await recarregar(); toast('Empresa na fila do PJe com prioridade máxima. O worker roda das 07h às 23h.', 'success'); }
    }
    setEnfileirando(false);
  };

  const salvarGarantia = async () => {
    if (!garantia) { toast('Escolha a garantia informada.', 'warning'); return; }
    setSalvandoGarantia(true);
    const agoraIso = new Date().toISOString();
    const { error } = await supabase.from('radar_empresas').update({
      garantia_informada: garantia, garantia_obs: garantiaObs.trim().slice(0, 300) || null,
      garantia_informada_em: agoraIso, atualizado_em: agoraIso,
    }).eq('cnpj', empresa.cnpj);
    if (error) toast(`Falha ao salvar a garantia: ${error.message}`, 'error');
    else { await recarregar(); toast('Garantia informada salva.', 'success'); }
    setSalvandoGarantia(false);
  };

  const enviada = empresa.status === 'enviado_kanban';
  const ocupado = salvando !== null;
  const leitura = leituraDossie(empresa);
  const naFila = empresa.dossie_status === 'fila';
  const prontoRecente = (empresa.dossie_status === 'pronto' || empresa.dossie_status === 'sem_processos') && !dossieAntigo(empresa.dossie_em);
  const rotuloBusca = naFila ? 'Na fila' : (empresa.dossie_status === 'pronto' || empresa.dossie_status === 'sem_processos') ? 'Atualizar' : 'Buscar processos';
  const movimentosDo = (processoId: number) => movimentos.filter(m => m.processo_id === processoId).slice(0, 15);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="absolute inset-0 bg-navy/40 backdrop-blur-[2px] animate-in fade-in duration-200" onClick={onFechar} aria-hidden="true" />
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="radar-drawer-titulo"
          className="relative h-full w-full max-w-2xl bg-areia-clara shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        >
          <header className="bg-navy text-areia px-6 py-5 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <ScoreBadge score={empresa.score} />
                <StatusBadge status={empresa.status} />
              </div>
              <h2 id="radar-drawer-titulo" className="text-lg font-black leading-tight">{nomeExibicao(empresa)}</h2>
              <p className="text-[12px] text-slate-300 font-mono mt-0.5">{formatCnpj(empresa.cnpj)}{empresa.uf ? ` · ${empresa.uf}` : ''}{empresa.municipio ? ` · ${empresa.municipio}` : ''}</p>
            </div>
            <button type="button" onClick={onFechar} aria-label="Fechar detalhe"
              className="p-2 rounded-xl text-slate-300 hover:text-areia hover:bg-navy-light transition-colors">
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto custom-scroll px-6 py-5 space-y-6">
            {empresa.motivo_exclusao && (
              <p className={`rounded-xl px-4 py-3 text-[12px] font-medium border ${
                empresa.status === 'descartado' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}>
                {empresa.status === 'descartado' ? 'Descartada: ' : 'Excluída pelo enriquecimento: '}
                {MOTIVO_LABEL[empresa.motivo_exclusao] ?? empresa.motivo_exclusao}
              </p>
            )}

            {/* Dívida */}
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className={secao}><FileText size={12} aria-hidden="true" /> Dívida ativa (PGFN {formatCompetencia(empresa.competencia_ultima)})</h3>
              <p className="mt-3 text-xl font-black text-navy leading-tight">{formatCurrency(Number(empresa.valor_total))}</p>
              <p className="text-[12px] text-slate-700 font-medium mt-0.5">
                Inscrições: <strong className="text-navy">{empresa.qtd_em_cobranca ?? 0}</strong> em cobrança,{' '}
                <strong className="text-navy">{empresa.qtd_beneficio ?? 0}</strong> parceladas ou em negociação,{' '}
                <strong className="text-navy">{inscricoes === null ? '…' : inscricoes.filter(i => inscricaoGarantida(i.tipo_situacao)).length}</strong> garantidas
              </p>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                {dado('Inscrições', empresa.qtd_inscricoes)}
                {dado('Garantia', empresa.tem_garantia ? 'Sim' : 'Não')}
                {dado('Mais recente', formatDataBr(empresa.data_inscricao_mais_recente))}
                {dado('Receitas', receitasResumo(empresa.receitas).join(', '))}
                {dado('Nome na PGFN', empresa.nome_devedor)}
              </dl>
            </section>

            {/* Cadastro */}
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className={secao}><Building2 size={12} aria-hidden="true" /> Cadastro (Receita Federal via BrasilAPI)</h3>
              {!empresa.enriquecido_em ? (
                <p className="text-sm text-slate-600 mt-3">
                  Ainda não enriquecida. O enriquecimento roda de hora em hora, das 08h às 22h.
                  {empresa.enriquecimento_erro && <span className="block text-[12px] text-amber-800 mt-1">Última tentativa: {empresa.enriquecimento_erro}</span>}
                </p>
              ) : (
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  {dado('Razão social', empresa.razao_social)}
                  {dado('Nome fantasia', empresa.nome_fantasia)}
                  {dado('CNAE principal', empresa.cnae_principal ? `${empresa.cnae_principal} · ${empresa.cnae_descricao ?? ''}` : null)}
                  {dado('Porte', empresa.porte)}
                  {dado('Situação cadastral', empresa.situacao_cadastral)}
                  {dado('Simples / MEI', `${empresa.optante_simples ? 'Simples' : 'Não optante'}${empresa.optante_mei ? ' · MEI' : ''}`)}
                  <ContatoEditavel
                    rotulo="E-mail"
                    icone={<Mail size={10} aria-hidden="true" />}
                    tipo="email"
                    manual={empresa.email_manual ?? null}
                    api={empresa.email ?? null}
                    ocupado={salvandoContato || ocupado}
                    onSalvar={v => gravarContato('email', v)}
                    onRestaurar={() => gravarContato('email', '')}
                    onCopiar={t => copiar(t, 'E-mail')}
                  />
                  <ContatoEditavel
                    rotulo="Telefone"
                    icone={<Phone size={10} aria-hidden="true" />}
                    tipo="tel"
                    manual={empresa.telefone_manual ? formatTelefone(empresa.telefone_manual) : null}
                    api={empresa.telefone ?? null}
                    ocupado={salvandoContato || ocupado}
                    onSalvar={v => gravarContato('telefone', v)}
                    onRestaurar={() => gravarContato('telefone', '')}
                    onCopiar={t => copiar(t, 'Telefone')}
                  />
                </dl>
              )}
            </section>

            {/* Sócios */}
            {empresa.socios && empresa.socios.length > 0 && (
              <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className={secao}><Users size={12} aria-hidden="true" /> Sócios e administradores ({empresa.socios.length})</h3>
                <ul className="mt-3 space-y-1.5">
                  {empresa.socios.map((s, i) => (
                    <li key={i} className="text-sm text-slate-800 flex flex-wrap items-baseline">
                      <span className="font-medium">{s.nome}</span>
                      {s.qualificacao && <span className="ml-2 text-[11px] text-slate-600">{s.qualificacao}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Processos no TRF3 (Fase 2) */}
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4" aria-labelledby="radar-dossie-titulo">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="radar-dossie-titulo" className={secao}><Gavel size={12} aria-hidden="true" /> Processos no TRF3 (PJe)</h3>
                  <span className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${DOSSIE_CLASSES[empresa.dossie_status]}`}>
                    {DOSSIE_LABEL[empresa.dossie_status]}
                  </span>
                  {empresa.dossie_em && <span className="text-[11px] text-slate-600">em {formatDataHoraBr(empresa.dossie_em)}</span>}
                </div>
                <button type="button" onClick={buscarProcessos} disabled={naFila || prontoRecente || enfileirando}
                  title={naFila ? 'Já está na fila do worker' : prontoRecente ? 'Dossiê atualizado há menos de 30 dias' : 'Coloca a empresa na fila do PJe com prioridade máxima'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-[11px] font-bold uppercase tracking-wider hover:border-gold hover:text-navy disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {enfileirando ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Search size={13} aria-hidden="true" />}
                  {rotuloBusca}
                </button>
              </div>

              {alertaSemAdvogado(empresa.qtd_execucoes_sem_advogado) && (
                <p role="alert" className="rounded-xl px-4 py-3 text-[12px] font-bold border bg-amber-50 border-amber-200 text-amber-800 flex items-start gap-2">
                  <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>{alertaSemAdvogado(empresa.qtd_execucoes_sem_advogado)}</span>
                </p>
              )}

              {leitura && (
                <p className={`rounded-xl px-4 py-3 text-[12px] font-medium border ${
                  empresa.qtd_embargos > 0 ? 'bg-blue-50 border-blue-200 text-blue-800'
                    : empresa.qtd_execucoes > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}>
                  {leitura}
                </p>
              )}

              {processos === null ? (
                <p className="text-sm text-slate-600"><Loader2 size={14} aria-hidden="true" className="inline animate-spin mr-1" /> Carregando processos...</p>
              ) : processos.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {empresa.dossie_status === 'nenhum' && 'Ainda não consultado. Use "Buscar processos" para colocar na fila do worker.'}
                  {empresa.dossie_status === 'fila' && 'Na fila do worker do PJe. O resultado aparece aqui quando a consulta terminar.'}
                  {empresa.dossie_status === 'erro' && 'A consulta falhou três vezes. Tente de novo com "Buscar processos".'}
                  {empresa.dossie_status === 'sem_processos' && 'Nenhum processo das classes Execução Fiscal ou Embargos localizado.'}
                  {empresa.dossie_status === 'pronto' && 'Nenhum processo gravado.'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 -mx-2">
                  {processos.map(p => {
                    const aberto = expandido === p.id;
                    const movs = movimentosDo(p.id);
                    return (
                      <li key={p.id} className="px-2">
                        <button type="button" onClick={() => setExpandido(aberto ? null : p.id)} aria-expanded={aberto}
                          className="w-full text-left py-3 flex items-start gap-2 hover:bg-slate-50/70 rounded-lg transition-colors">
                          <span className="mt-0.5 text-slate-500" aria-hidden="true">{aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                          <span className="flex-1 min-w-0 space-y-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${
                                p.classe_codigo === 1118 ? 'bg-areia-escura text-navy border-linha' : 'bg-white text-navy border-linha'
                              }`}>{classeCurta(p.classe_codigo)}</span>
                              <span className="font-mono text-[12px] font-bold text-navy">{p.numero_cnj}</span>
                              <span role="presentation" onClick={ev => { ev.stopPropagation(); copiar(p.numero_cnj, 'Número'); }}
                                className={botaoCopiar} title="Copiar número"><Copy size={12} aria-hidden="true" /></span>
                              {p.data_distribuicao && <span className="text-[11px] text-slate-600">dist. {formatDataBr(p.data_distribuicao)}</span>}
                            </span>
                            {p.orgao_julgador && <span className="block text-[12px] text-slate-800 font-medium">{p.orgao_julgador}</span>}
                            {p.assunto && <span className="block text-[11px] text-slate-600 line-clamp-2">{p.assunto}</span>}
                            {p.ultima_movimentacao_texto && (
                              <span className="block text-[11px] text-slate-700">
                                <span className="font-bold">Última:</span> {p.ultima_movimentacao_texto}
                                {p.ultima_movimentacao_em && <span className="text-slate-500"> ({formatDataHoraBr(p.ultima_movimentacao_em)})</span>}
                              </span>
                            )}
                          </span>
                        </button>
                        {aberto && (
                          <div className="ml-6 mb-3 rounded-xl bg-areia-clara border border-linha px-4 py-3 animate-in fade-in duration-200">
                            {movs.length === 0 ? (
                              <p className="text-[11px] text-slate-600">Sem movimentações gravadas (só os dados da listagem foram capturados).</p>
                            ) : (
                              <ol className="space-y-1.5">
                                {movs.map(m => (
                                  <li key={m.id} className="text-[11px] text-slate-800 flex gap-2">
                                    <span className="tabular-nums text-slate-500 whitespace-nowrap">{formatDataHoraBr(m.ocorrido_em)}</span>
                                    <span>{m.texto}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                            {p.qtd_movimentacoes != null && p.qtd_movimentacoes > movs.length && (
                              <p className="mt-2 text-[10px] text-slate-500">{p.qtd_movimentacoes} movimentações no PJe; as {movs.length} mais recentes estão aqui.</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Advogados do executado */}
              {advogados.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <h4 className={secao}><Scale size={12} aria-hidden="true" /> Advogados do executado ({advogados.length})</h4>
                  <ul className="mt-2 space-y-1">
                    {advogados.map(a => {
                      const texto = a.oab ? `${a.nome} (OAB ${a.oab})` : a.nome;
                      return (
                        <li key={`${a.nome}|${a.oab}`} className="text-sm text-slate-800 flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{a.nome}</span>
                          {a.oab && <span className="font-mono text-[11px] text-slate-600">OAB {a.oab}</span>}
                          <span className="text-[11px] text-slate-500">{a.processos} processo{a.processos === 1 ? '' : 's'}</span>
                          <button type="button" onClick={() => copiar(texto, 'Advogado')} aria-label={`Copiar ${texto}`} className={botaoCopiar}><Copy size={12} /></button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Garantia informada */}
              <div className="pt-3 border-t border-slate-100">
                <h4 className={secao}><ShieldCheck size={12} aria-hidden="true" /> Garantia informada</h4>
                <p className="text-[11px] text-slate-600 mt-1">Preencha depois de conversar com o advogado ou a empresa.</p>
                <form onSubmit={e => { e.preventDefault(); salvarGarantia(); }} className="mt-2 grid grid-cols-1 md:grid-cols-[12rem_1fr_auto] gap-2 items-end">
                  <div>
                    <label htmlFor="radar-garantia" className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Garantia</label>
                    <select id="radar-garantia" value={garantia} onChange={e => setGarantia(e.target.value as GarantiaInformada | '')}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white cursor-pointer">
                      <option value="">Selecione</option>
                      {GARANTIA_OPCOES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="radar-garantia-obs" className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Observação</label>
                    <input id="radar-garantia-obs" maxLength={300} value={garantiaObs} onChange={e => setGarantiaObs(e.target.value)}
                      placeholder="Ex.: seguro da Junto vence em 03/2027"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white" />
                  </div>
                  <button type="submit" disabled={salvandoGarantia || !garantia}
                    className="px-4 py-2 rounded-xl bg-navy hover:bg-navy-light text-areia border border-gold/35 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    {salvandoGarantia ? <Loader2 size={14} className="animate-spin" aria-label="Salvando" /> : 'Salvar'}
                  </button>
                </form>
                {empresa.garantia_informada_em && (
                  <p className="text-[10px] text-slate-500 mt-1">Informada em {formatDataHoraBr(empresa.garantia_informada_em)}.</p>
                )}
              </div>
            </section>

            {/* Inscrições */}
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <h3 className={`${secao} px-5 pt-5 pb-3`}><FileText size={12} aria-hidden="true" /> Inscrições ({inscricoes?.length ?? '...'})</h3>
              {inscricoes === null ? (
                <p className="px-5 pb-5 text-sm text-slate-600"><Loader2 size={14} aria-hidden="true" className="inline animate-spin mr-1" /> Carregando...</p>
              ) : inscricoes.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-slate-600">Nenhuma inscrição nesta competência.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 border-y border-slate-200 text-left text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                      <tr>
                        <th scope="col" className="px-5 py-2">Número</th>
                        <th scope="col" className="px-3 py-2">Receita</th>
                        <th scope="col" className="px-3 py-2">Situação</th>
                        <th scope="col" className="px-3 py-2">Data</th>
                        <th scope="col" className="px-5 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inscricoes.map(i => (
                        <tr key={i.id} className="border-t border-slate-100">
                          <td className="px-5 py-2 font-mono whitespace-nowrap text-slate-800">{i.numero_inscricao}</td>
                          <td className="px-3 py-2 text-slate-700 max-w-[14rem] truncate" title={i.receita_principal ?? ''}>{i.receita_principal}</td>
                          <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{[i.tipo_situacao, i.situacao].filter(Boolean).join(' · ')}</td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap text-slate-700">{formatDataBr(i.data_inscricao)}</td>
                          <td className="px-5 py-2 text-right tabular-nums font-bold text-navy whitespace-nowrap">{formatCurrency(Number(i.valor_consolidado))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <footer className="border-t border-linha bg-white px-6 py-4 space-y-3">
            {pedindoMotivo && (
              <form onSubmit={e => { e.preventDefault(); descartar(); }} className="flex items-end gap-2 animate-in fade-in duration-200">
                <div className="flex-1">
                  <label htmlFor="radar-motivo" className="block text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">Motivo do descarte</label>
                  <input id="radar-motivo" autoFocus maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)}
                    placeholder="Ex.: já é cliente, fora do perfil, sem contato"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white" />
                </div>
                <button type="submit" disabled={ocupado || !motivo.trim()}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold uppercase tracking-wider disabled:opacity-50 transition-colors">
                  {salvando === 'descartar' ? <Loader2 size={14} className="animate-spin" aria-label="Salvando" /> : 'Confirmar'}
                </button>
                <button type="button" onClick={() => { setPedindoMotivo(false); setMotivo(''); }} disabled={ocupado}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-bold uppercase tracking-wider hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
              </form>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={enviarKanban} disabled={enviada || ocupado}
                title={enviada ? 'Esta empresa já está no Kanban' : 'Cria um lead em Novos Leads'}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy hover:bg-navy-light text-areia border border-gold/35 text-[11px] font-bold uppercase tracking-wider shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {salvando === 'kanban' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <KanbanSquare size={14} aria-hidden="true" />}
                {enviada ? 'Já no Kanban' : 'Enviar ao Kanban'}
              </button>
              {enviada && (
                <button type="button" onClick={onAbrirKanban}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold uppercase tracking-wider hover:bg-emerald-100 transition-colors">
                  <ExternalLink size={13} aria-hidden="true" /> Abrir no Kanban
                </button>
              )}
              {empresa.status === 'novo' && !pedindoMotivo && (
                <button type="button" onClick={() => setPedindoMotivo(true)} disabled={ocupado}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-bold uppercase tracking-wider hover:bg-amber-100 disabled:opacity-50 transition-colors">
                  <Ban size={13} aria-hidden="true" /> Descartar
                </button>
              )}
              {empresa.status !== 'novo' && (
                <button type="button" onClick={reverter} disabled={ocupado}
                  className="ml-auto flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-[11px] font-bold uppercase tracking-wider hover:border-gold hover:text-navy disabled:opacity-50 transition-colors">
                  {salvando === 'reverter' ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}
                  Reverter para novo
                </button>
              )}
            </div>
          </footer>
        </aside>
      </div>
    </ModalPortal>
  );
}
