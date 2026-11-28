import React, { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, ChevronDown, ChevronUp, FileText, Paperclip, User } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Aba "Repasses ativos" do Repasse Imobiliárias (layout de 28/11/2026,
 * aprovado pelo Fábio em prévia).
 *
 * Uma linha por cliente, agrupada por imobiliária. Esta tela é de consulta e
 * cadastro: a baixa do repasse é feita na aba Comprovantes. A baixa sem
 * comprovante no portal continua existindo, discreta, no menu "⋯".
 *
 * As ações (editar, adiar, baixa, desfazer, excluir) continuam morando na
 * tela-mãe (ImobiliariaRepasse.tsx) e chegam por props: aqui é só a vista.
 */

export interface ClienteAtivo {
  id: string;
  partner_id?: number | null;
  inquilino_nome: string;
  seguradora?: string | null;
  numero_apolice?: string | null;
  valor_seguro: number;
  parcela_atual: number;
  total_parcelas: number;
  tipo_seguro?: string | null;
  status_residencial?: string | null;
  status_garantia?: string | null;
  apolice_residencial_url?: string | null;
  apolice_garantia_url?: string | null;
  contrato_fianca_url?: string | null;
  doc_contrato_url?: string | null;
  doc_termo_vistoria_url?: string | null;
  doc_fotos_vistoria_url?: string | null;
  dia_vencimento_aluguel?: number | null;
  proximo_vencimento?: string | null;
  is_repasse?: boolean | null;
  repasse_baixa_anterior?: { parcela_atual: number; proximo_vencimento: string | null } | null;
}

interface Props {
  clientes: ClienteAtivo[];
  parceiros: { id: number; name: string }[];
  totalMensal: number;
  /** Texto do status de cada cobertura (o mesmo usado no resto da tela). */
  rotuloResidencial: (c: ClienteAtivo) => string;
  rotuloGarantia: (c: ClienteAtivo) => string;
  onEditar: (c: ClienteAtivo) => void;
  onAdiar: (c: ClienteAtivo) => void;
  onBaixaSemComprovante: (c: ClienteAtivo) => void;
  onDesfazerBaixa: (c: ClienteAtivo) => void;
  onExcluir: (c: ClienteAtivo) => void;
  onAbrirComprovantes: () => void;
}

const DIAS_PERTO = 10;
const DOCS: [keyof ClienteAtivo, string][] = [
  ['doc_contrato_url', 'Contrato'],
  ['doc_termo_vistoria_url', 'Vistoria'],
  ['doc_fotos_vistoria_url', 'Fotos'],
];

const fmtBRL = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000);

const temGarantia = (c: ClienteAtivo) => c.tipo_seguro === 'residencial_garantia' || c.tipo_seguro === 'garantia';
const temResidencial = (c: ClienteAtivo) => c.tipo_seguro !== 'garantia';
const coberturaOk = (status?: string | null) => status === 'emitido' || status === 'aprovado';
/** Sem emoji: o rótulo da tela-mãe vem com um na frente. */
const limpo = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();

const Etiqueta: React.FC<{ nome: string; status?: string | null; rotulo: string; onClick: () => void }> = ({ nome, status, rotulo, onClick }) => {
  const ok = coberturaOk(status);
  const encerrado = status === 'recusado';
  return (
    <button type="button" onClick={onClick} title="Ver apólice e documentos"
      className={ok
        ? 'px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors'
        : encerrado
          ? 'px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors'
          : 'px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 transition-colors'}>
      {ok ? nome : `${nome} · ${limpo(rotulo).toLowerCase()}`}
    </button>
  );
};

const RepassesAtivosTabela: React.FC<Props> = ({
  clientes, parceiros, totalMensal, rotuloResidencial, rotuloGarantia,
  onEditar, onAdiar, onBaixaSemComprovante, onDesfazerBaixa, onExcluir, onAbrirComprovantes,
}) => {
  const hoje = hojeISO();
  const [aberto, setAberto] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  // "client_id|parcela" com comprovante esperando conferência, e clientes com
  // parcela já recebida que ainda falta pagar à seguradora.
  const [emConferencia, setEmConferencia] = useState<Set<string>>(new Set());
  const [aPagar, setAPagar] = useState<Map<string, number>>(new Map());

  // Recarrega quando alguma parcela muda (baixa, desfazer, cliente novo).
  const assinatura = clientes.map(c => `${c.id}:${c.parcela_atual}`).join(',');
  useEffect(() => {
    let vivo = true;
    supabase.from('imobiliaria_repasse_pagamentos')
      .select('client_id, parcela, status').in('status', ['enviado', 'recebido'])
      .then(({ data }) => {
        if (!vivo || !data) return;
        setEmConferencia(new Set(data.filter(p => p.status === 'enviado').map(p => `${p.client_id}|${p.parcela}`)));
        const m = new Map<string, number>();
        data.filter(p => p.status === 'recebido' && p.client_id).forEach(p => m.set(p.client_id as string, p.parcela as number));
        setAPagar(m);
      });
    return () => { vivo = false; };
  }, [assinatura]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, { nome: string; linhas: ClienteAtivo[] }>();
    for (const c of clientes) {
      const p = parceiros.find(x => x.id === c.partner_id);
      const chave = p ? String(p.id) : 'sem';
      if (!mapa.has(chave)) mapa.set(chave, { nome: p?.name || 'Sem imobiliária', linhas: [] });
      mapa.get(chave)!.linhas.push(c);
    }
    const lista = [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    for (const g of lista) {
      g.linhas.sort((a, b) =>
        String(a.proximo_vencimento || '9999').localeCompare(String(b.proximo_vencimento || '9999')) ||
        a.inquilino_nome.localeCompare(b.inquilino_nome, 'pt-BR'));
    }
    return lista;
  }, [clientes, parceiros]);

  const situacaoVenc = (c: ClienteAtivo): 'vencido' | 'perto' | 'longe' | 'sem' => {
    if (!c.proximo_vencimento) return 'sem';
    const d = diasEntre(hoje, c.proximo_vencimento.slice(0, 10));
    if (d < 0) return 'vencido';
    return d <= DIAS_PERTO ? 'perto' : 'longe';
  };
  const conferindo = (c: ClienteAtivo) => emConferencia.has(`${c.id}|${c.parcela_atual}`);
  const vencidos = clientes.filter(c => situacaoVenc(c) === 'vencido' && !conferindo(c)).length;
  const perto = clientes.filter(c => situacaoVenc(c) === 'perto').length;

  const abrirMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    if (menu?.id === id) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ id, top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const clienteDoMenu = menu ? clientes.find(c => c.id === menu.id) : null;
  const escolher = (acao: (c: ClienteAtivo) => void) => () => {
    const c = clienteDoMenu;
    setMenu(null);
    if (c) acao(c);
  };
  const itemMenu = 'text-left px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-navy rounded-2xl p-5 text-white">
          <p className="text-white/70 text-xs font-bold mb-1">Total mensal</p>
          <p className="text-2xl font-black text-gold">{fmtBRL(totalMensal)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-slate-500 text-xs font-bold mb-1">Clientes ativos</p>
          <p className="text-2xl font-black text-slate-800">{clientes.length}</p>
        </div>
        <div className={vencidos > 0 ? 'bg-rose-50 rounded-2xl border border-rose-200 p-5' : 'bg-white rounded-2xl border border-slate-100 shadow-sm p-5'}>
          <p className={vencidos > 0 ? 'text-rose-700 text-xs font-bold mb-1' : 'text-slate-500 text-xs font-bold mb-1'}>Vencidos sem repasse</p>
          <p className={vencidos > 0 ? 'text-2xl font-black text-rose-700' : 'text-2xl font-black text-slate-800'}>{vencidos}</p>
        </div>
        <div className={perto > 0 ? 'bg-amber-50 rounded-2xl border border-amber-200 p-5' : 'bg-white rounded-2xl border border-slate-100 shadow-sm p-5'}>
          <p className={perto > 0 ? 'text-amber-800 text-xs font-bold mb-1' : 'text-slate-500 text-xs font-bold mb-1'}>Vencem nos próximos {DIAS_PERTO} dias</p>
          <p className={perto > 0 ? 'text-2xl font-black text-amber-800' : 'text-2xl font-black text-slate-800'}>{perto}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        A baixa do repasse é feita na aba Comprovantes. Clique no nome para editar o cadastro e nas etiquetas para ver apólice e documentos.
      </p>

      {grupos.map(g => {
        const subtotal = g.linhas.reduce((s, c) => s + Number(c.valor_seguro || 0), 0);
        return (
          <div key={g.nome} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h3 className="text-base font-bold text-slate-800">{g.nome}</h3>
                <span className="text-xs text-slate-500">{g.linhas.length} {g.linhas.length === 1 ? 'cliente' : 'clientes'}</span>
              </div>
              <p className="text-xs text-slate-500">Subtotal do mês <strong className="text-slate-800 text-base ml-1.5">{fmtBRL(subtotal)}</strong></p>
            </div>
            <div className="overflow-x-auto">
              {/* Larguras fixas: as colunas ficam alinhadas entre uma imobiliária e outra. */}
              <table className="w-full min-w-[1040px] table-fixed">
                <colgroup>
                  <col style={{ width: '25%' }} /><col style={{ width: '27%' }} /><col style={{ width: '9%' }} />
                  <col style={{ width: '13%' }} /><col style={{ width: '7%' }} /><col style={{ width: '14%' }} /><col style={{ width: '5%' }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50/70">
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500">Inquilino</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Coberturas</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500">Valor</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Vencimento</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Parcela</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Repasse</th>
                    <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-500">Mais</th>
                  </tr>
                </thead>
                <tbody>
                  {g.linhas.map(c => {
                    const v = situacaoVenc(c);
                    const garantia = temGarantia(c);
                    const pendentes = garantia ? DOCS.filter(([k]) => !c[k]).length : 0;
                    const expandido = aberto === c.id;
                    const alternar = () => setAberto(expandido ? null : c.id);
                    const seguradora = c.seguradora && c.seguradora !== 'Importado' ? c.seguradora : 'Seguradora não informada';
                    const ultima = c.parcela_atual === c.total_parcelas;
                    return (
                      <React.Fragment key={c.id}>
                        <tr className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-2.5">
                            <button type="button" onClick={() => onEditar(c)} title="Clique para editar este cliente" className="group text-left">
                              <span className="block font-bold text-sm text-slate-800 group-hover:text-gold-dark transition-colors">{c.inquilino_nome}</span>
                              <span className="block text-xs text-slate-500 mt-0.5">
                                {seguradora}{c.numero_apolice ? ` · apólice ${c.numero_apolice}` : ''}
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {temResidencial(c) && <Etiqueta nome="Residencial" status={c.status_residencial} rotulo={rotuloResidencial(c)} onClick={alternar} />}
                              {garantia && <Etiqueta nome="Garantia" status={c.status_garantia} rotulo={rotuloGarantia(c)} onClick={alternar} />}
                              {pendentes > 0 && (
                                <button type="button" onClick={alternar}
                                  className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 transition-colors">
                                  {pendentes} {pendentes === 1 ? 'documento pendente' : 'documentos pendentes'}
                                </button>
                              )}
                              <button type="button" onClick={alternar} aria-label={expandido ? 'Fechar detalhes' : 'Ver apólice e documentos'}
                                className="p-1 text-slate-400 hover:text-slate-600">
                                {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-800 whitespace-nowrap">{fmtBRL(Number(c.valor_seguro))}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {v === 'vencido' && (
                              <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">
                                {fmtData(c.proximo_vencimento!)} · {diasEntre(c.proximo_vencimento!.slice(0, 10), hoje)} {diasEntre(c.proximo_vencimento!.slice(0, 10), hoje) === 1 ? 'dia' : 'dias'}
                              </span>
                            )}
                            {v === 'perto' && <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">{fmtData(c.proximo_vencimento!)}</span>}
                            {v === 'longe' && <span className="text-sm text-slate-600">{fmtData(c.proximo_vencimento!)}</span>}
                            {v === 'sem' && (c.dia_vencimento_aluguel
                              ? <span className="text-sm text-slate-600" title="Sem data completa calculada; mostrando só o dia">dia {c.dia_vencimento_aluguel}</span>
                              : <span className="text-xs text-amber-700 font-bold">sem data</span>)}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className={ultima ? 'text-sm font-bold text-amber-700' : 'text-sm text-slate-600'} title={ultima ? 'Última parcela' : undefined}>
                              {c.parcela_atual} de {c.total_parcelas}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {conferindo(c) ? (
                              <button type="button" onClick={onAbrirComprovantes}
                                className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold hover:bg-blue-200 transition-colors whitespace-nowrap">
                                Comprovante para conferir
                              </button>
                            ) : (
                              <span className="text-sm text-slate-500">Aguardando</span>
                            )}
                            {aPagar.has(c.id) && (
                              <button type="button" onClick={onAbrirComprovantes} className="block mt-1 text-xs font-semibold text-slate-500 hover:text-navy whitespace-nowrap">
                                Parcela {aPagar.get(c.id)} a pagar à seguradora
                              </button>
                            )}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <button type="button" onClick={(e) => abrirMenu(e, c.id)} aria-label={`Mais ações de ${c.inquilino_nome}`}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-navy transition-colors">
                              <MoreHorizontal size={16} />
                            </button>
                          </td>
                        </tr>
                        {expandido && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={7} className="px-5 py-3">
                              <div className="flex gap-x-8 gap-y-3 flex-wrap">
                                {temResidencial(c) && (
                                  <div>
                                    <p className="text-xs font-bold text-slate-600 mb-1">Seguro residencial · {limpo(rotuloResidencial(c))}</p>
                                    {c.apolice_residencial_url
                                      ? <a href={c.apolice_residencial_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"><FileText size={12} /> Apólice</a>
                                      : <span className="text-xs text-slate-500">Apólice ainda não anexada</span>}
                                  </div>
                                )}
                                {garantia && (
                                  <div>
                                    <p className="text-xs font-bold text-slate-600 mb-1">Garantia locatícia · {limpo(rotuloGarantia(c))}</p>
                                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
                                      {c.apolice_garantia_url
                                        ? <a href={c.apolice_garantia_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"><FileText size={12} /> Apólice</a>
                                        : <span className="text-xs text-slate-500">Apólice ainda não anexada</span>}
                                      {c.contrato_fianca_url && <a href={c.contrato_fianca_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"><FileText size={12} /> Contrato de fiança</a>}
                                      {DOCS.map(([k, rotulo]) => (c[k]
                                        ? <a key={k} href={c[k] as string} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"><Paperclip size={12} /> {rotulo}</a>
                                        : <span key={k} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><Paperclip size={12} /> {rotulo} pendente</span>))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {clientes.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <User size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="font-bold text-slate-500">Nenhum cliente ativo</p>
          <p className="text-slate-400 text-sm mt-1">Clique em "Novo Cliente" para começar</p>
        </div>
      )}

      {clientes.length > 0 && (
        <div className="bg-navy rounded-2xl px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-bold text-white">{grupos.length > 1 ? 'Total mensal, todas as imobiliárias' : 'Total mensal'}</span>
          <span className="text-xl font-black text-gold">{fmtBRL(totalMensal)}</span>
        </div>
      )}

      {/* Menu "⋯": fixo na tela para não ser cortado pela rolagem da tabela. */}
      {menu && clienteDoMenu && (
        <>
          <button type="button" aria-label="Fechar menu" onClick={() => setMenu(null)} className="fixed inset-0 z-40 cursor-default" />
          <div className="fixed z-50 w-60 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 flex flex-col" style={{ top: menu.top, right: menu.right }}>
            <button type="button" className={itemMenu} onClick={escolher(onEditar)}>Status e apólice</button>
            {clienteDoMenu.is_repasse && clienteDoMenu.proximo_vencimento && (
              <button type="button" className={itemMenu} onClick={escolher(onAdiar)}>Adiar 1 mês</button>
            )}
            {clienteDoMenu.is_repasse && !conferindo(clienteDoMenu) && (
              <button type="button" className={itemMenu} onClick={escolher(onBaixaSemComprovante)}>Dar baixa sem comprovante</button>
            )}
            {clienteDoMenu.repasse_baixa_anterior && (
              <button type="button" className={itemMenu} onClick={escolher(onDesfazerBaixa)}>Desfazer última baixa</button>
            )}
            <button type="button" onClick={escolher(onExcluir)}
              className="text-left px-3 py-2 mt-1 border-t border-slate-100 rounded-b-lg text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors">
              Excluir cadastro
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default RepassesAtivosTabela;
