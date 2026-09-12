import React, { useEffect, useState } from 'react';
import { X, Copy, KanbanSquare, Ban, RotateCcw, Loader2, ExternalLink, Mail, Phone, Building2, Users, FileText } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { formatCurrency } from '../../../utils/formatters.ts';
import ModalPortal from '../../../components/ModalPortal.tsx';
import { useToast } from '../../../components/Toast.tsx';
import { ScoreBadge, StatusBadge } from './RadarTabela.tsx';
import {
  MOTIVO_LABEL, formatCnpj, formatCompetencia, formatDataBr, nomeExibicao, receitasResumo,
  type RadarEmpresa, type RadarInscricao,
} from './radarTipos.ts';

interface Props {
  empresa: RadarEmpresa;
  onFechar: () => void;
  /** Chamado com a linha já atualizada depois de enviar, descartar ou reverter. */
  onAtualizada: (e: RadarEmpresa) => void;
  onAbrirKanban: () => void;
}

const secao = 'text-[10px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-1.5';
const dado = (rotulo: string, valor: React.ReactNode) => (
  <div>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{rotulo}</dt>
    <dd className="text-sm text-slate-800 font-medium break-words">{valor || <span className="text-slate-500">Não informado</span>}</dd>
  </div>
);

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
      ].filter(Boolean).join('\n');

      // Mesmo mecanismo da Edge Function lead-cotacao: insert direto em
      // prospects, coluna "Novos Leads". Só colunas que já existem na tabela.
      const { data: prospect, error: pErr } = await supabase.from('prospects').insert({
        name: socio || nomeEmpresa,
        company: nomeEmpresa,
        cnpj: formatCnpj(empresa.cnpj),
        email: empresa.email,
        phonenumber: empresa.telefone,
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

  const enviada = empresa.status === 'enviado_kanban';
  const ocupado = salvando !== null;

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
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                {dado('Valor total', <span className="font-black text-navy">{formatCurrency(Number(empresa.valor_total))}</span>)}
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
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1"><Mail size={10} aria-hidden="true" /> E-mail</dt>
                    <dd className="flex items-center gap-2 text-sm font-medium text-slate-800 break-all">
                      {empresa.email ? (
                        <>
                          <span>{empresa.email}</span>
                          <button type="button" onClick={() => copiar(empresa.email!, 'E-mail')} aria-label="Copiar e-mail"
                            className="p-1 rounded-md text-slate-600 hover:text-navy hover:bg-slate-100 transition-colors"><Copy size={12} /></button>
                        </>
                      ) : <span className="text-slate-500">Não informado</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1"><Phone size={10} aria-hidden="true" /> Telefone</dt>
                    <dd className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {empresa.telefone ? (
                        <>
                          <span>{empresa.telefone}</span>
                          <button type="button" onClick={() => copiar(empresa.telefone!, 'Telefone')} aria-label="Copiar telefone"
                            className="p-1 rounded-md text-slate-600 hover:text-navy hover:bg-slate-100 transition-colors"><Copy size={12} /></button>
                        </>
                      ) : <span className="text-slate-500">Não informado</span>}
                    </dd>
                  </div>
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
