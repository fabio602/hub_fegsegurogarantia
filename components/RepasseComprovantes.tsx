import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, FileText, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { lerDocumento } from '../lib/pdf/lerDocumento.ts';
import { lerComprovantePix, conferirComprovante, type LeituraComprovante, type ConferenciaComprovante } from '../lib/repasse/lerComprovantePix.ts';

/**
 * Aba "Comprovantes" do Repasse Imobiliárias (migração 147).
 *
 * O repasse anda da esquerda para a direita:
 *   Aguardando a imobiliária -> Para conferir -> A pagar para a seguradora -> Concluído no mês
 *
 * Nada aqui dá baixa sozinho. A imobiliária anexa o comprovante no portal, o
 * Fábio confere no banco e clica em "Confirmar recebimento" (decisão dele em
 * 28/11/2026). A leitura do comprovante (valor, pagador, recebedor) é só ajuda
 * para essa conferência: roda no navegador, por regras, com o OCR local.
 * As colunas da seguradora existem só no HUB; a imobiliária vê "pago".
 */

const BUCKET = 'repasse-comprovantes';

interface Pagamento {
  id: string;
  client_id: string | null;
  partner_id: number;
  inquilino_nome: string | null;
  numero_apolice: string | null;
  seguradora: string | null;
  parcela: number;
  total_parcelas: number | null;
  vencimento: string | null;
  valor_esperado: number | null;
  origem: 'portal' | 'manual';
  status: 'enviado' | 'recusado' | 'recebido' | 'pago_seguradora';
  comprovante_path: string | null;
  comprovante_nome: string | null;
  comprovante_enviado_em: string | null;
  leitura: (LeituraComprovante & ConferenciaComprovante & { duplicado?: boolean; ilegivel?: boolean }) | null;
  leitura_confere: boolean | null;
  recebido_em: string | null;
  pago_seguradora_em: string | null;
}

/** Parcela em aberto no cadastro, vinda da tela do Repasse. */
export interface RepasseEmAberto {
  id: string;
  partner_id?: number | null;
  inquilino_nome: string;
  valor_seguro: number;
  parcela_atual: number;
  total_parcelas: number;
  proximo_vencimento?: string | null;
}

interface Props {
  emAberto: RepasseEmAberto[];
  parceiros: { id: number; name: string }[];
  /** A baixa mexe no cadastro: a tela do Repasse recarrega. */
  onMudou: () => void;
  /** Quantos itens pedem ação (para conferir + a pagar), para o número da aba. */
  onContagem?: (n: number) => void;
}

const fmtBRL = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
/** Data e hora de um carimbo (timestamptz) no horário de Brasília. */
const fmtQuando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const diaBrasilia = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const TIPO_POR_EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

const Coluna: React.FC<{ titulo: string; qtd: number; ajuda: React.ReactNode; borda: string; selo: string; children: React.ReactNode }> =
  ({ titulo, qtd, ajuda, borda, selo, children }) => (
    <div className={`bg-white rounded-2xl border ${borda} shadow-sm p-4 flex flex-col gap-3 min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-slate-800">{titulo}</h3>
        <span className={`min-w-[26px] text-center text-xs font-bold px-2 py-0.5 rounded-xl ${selo}`}>{qtd}</span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{ajuda}</p>
      {children}
    </div>
  );

const Vazio: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-4 py-5 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400 text-center">{children}</div>
);

const RepasseComprovantes: React.FC<Props> = ({ emAberto, parceiros, onMudou, onContagem }) => {
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lendo, setLendo] = useState<string | null>(null);
  const tentados = useRef<Set<string>>(new Set());

  const nomeParceiro = useCallback(
    (id: number | null | undefined) => parceiros.find(p => p.id === id)?.name || 'Imobiliária',
    [parceiros],
  );

  const carregar = useCallback(async () => {
    // Vivos (enviado, recebido) sempre; concluídos e recusados, só os recentes.
    const desde = new Date(Date.now() - 62 * 86400000).toISOString();
    const { data, error } = await supabase
      .from('imobiliaria_repasse_pagamentos')
      .select('*')
      .or(`status.in.(enviado,recebido),created_at.gte.${desde}`)
      .order('created_at', { ascending: true });
    if (error) { setErro(error.message); setCarregando(false); return; }
    setErro(null);
    setPagamentos((data || []) as Pagamento[]);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const paraConferir = pagamentos.filter(p => p.status === 'enviado');
  const aPagar = pagamentos.filter(p => p.status === 'recebido');
  const mes = hojeISO().slice(0, 7);
  const concluidos = pagamentos
    .filter(p => p.status === 'pago_seguradora' && (p.pago_seguradora_em || '').slice(0, 7) === mes)
    .sort((a, b) => String(b.pago_seguradora_em).localeCompare(String(a.pago_seguradora_em)));
  const comComprovante = new Set(paraConferir.map(p => `${p.client_id}|${p.parcela}`));
  const hoje = hojeISO();
  const aguardando = emAberto
    .filter(c => Number(c.valor_seguro) > 0 && !comComprovante.has(`${c.id}|${c.parcela_atual}`))
    .sort((a, b) => String(a.proximo_vencimento || '9999').localeCompare(String(b.proximo_vencimento || '9999')));
  const totalAPagar = aPagar.reduce((s, p) => s + Number(p.valor_esperado || 0), 0);

  useEffect(() => { onContagem?.(paraConferir.length + aPagar.length); }, [paraConferir.length, aPagar.length, onContagem]);

  // ── leitura do comprovante (no navegador, por regras) ──────────────────────
  const lerComprovante = useCallback(async (p: Pagamento) => {
    if (!p.comprovante_path) return;
    setLendo(p.id);
    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(p.comprovante_path);
      if (error || !blob) throw new Error(error?.message || 'Não consegui baixar o comprovante');
      const ext = (p.comprovante_path.split('.').pop() || '').toLowerCase();
      // HEIC (foto de iPhone) o navegador não abre: fica para conferência no olho.
      let leitura: Pagamento['leitura'];
      if (!TIPO_POR_EXT[ext]) {
        leitura = { valor: null, data: null, pagador: null, recebedor: null, idTransacao: null, valorConfere: null, pagadorConfere: null, recebedorConfere: null, confere: false, ilegivel: true };
      } else {
        const arquivo = new File([blob], p.comprovante_nome || `comprovante.${ext}`, { type: TIPO_POR_EXT[ext] });
        const doc = await lerDocumento(arquivo);
        const lido = lerComprovantePix(doc.paginas.join('\n'));
        const conf = conferirComprovante(lido, { valor: p.valor_esperado, imobiliaria: nomeParceiro(p.partner_id) });
        leitura = { ...lido, ...conf, ilegivel: lido.valor === null && !lido.pagador && !lido.recebedor };
      }

      let { error: errSalvar } = await supabase.from('imobiliaria_repasse_pagamentos')
        .update({ leitura, leitura_confere: leitura.confere, id_transacao: leitura.idTransacao })
        .eq('id', p.id).eq('status', 'enviado');
      // 23505: o mesmo PIX já está em outro repasse (índice único do id da transação).
      if (errSalvar?.code === '23505') {
        leitura = { ...leitura, duplicado: true, confere: false };
        ({ error: errSalvar } = await supabase.from('imobiliaria_repasse_pagamentos')
          .update({ leitura, leitura_confere: false, id_transacao: null })
          .eq('id', p.id).eq('status', 'enviado'));
      }
      if (errSalvar) throw new Error(errSalvar.message);
      setPagamentos(ps => ps.map(x => (x.id === p.id ? { ...x, leitura, leitura_confere: leitura!.confere } : x)));
    } catch (e) {
      console.error('[leitura do comprovante]', e);
    } finally {
      setLendo(null);
    }
  }, [nomeParceiro]);

  // Lê sozinho, um por vez, os comprovantes que ainda não têm leitura.
  useEffect(() => {
    if (lendo) return;
    const proximo = paraConferir.find(p => !p.leitura && p.comprovante_path && !tentados.current.has(p.id + p.comprovante_path));
    if (!proximo) return;
    tentados.current.add(proximo.id + proximo.comprovante_path);
    lerComprovante(proximo);
  }, [paraConferir, lendo, lerComprovante]);

  // ── ações ──────────────────────────────────────────────────────────────────
  const rpc = async (p: Pagamento, fn: string, args: Record<string, unknown>, mexeNoCadastro: boolean) => {
    setOcupado(p.id);
    const { error } = await supabase.rpc(fn, args);
    setOcupado(null);
    if (error) { alert(error.message); return false; }
    await carregar();
    if (mexeNoCadastro) onMudou();
    return true;
  };

  const verComprovante = async (p: Pagamento) => {
    if (!p.comprovante_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(p.comprovante_path, 600);
    if (error || !data?.signedUrl) { alert('Não consegui abrir o comprovante.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const confirmar = (p: Pagamento) => {
    const aviso = p.leitura?.duplicado
      ? '\n\nATENÇÃO: este PIX já aparece em outro repasse.'
      : p.leitura && p.leitura.valorConfere === false
        ? `\n\nATENÇÃO: o comprovante é de ${fmtBRL(p.leitura.valor)} e a parcela é de ${fmtBRL(p.valor_esperado)}.`
        : '';
    if (!confirm(
      `Confirmar o recebimento de ${fmtBRL(p.valor_esperado)} de ${p.inquilino_nome}?\n\n` +
      `Confira antes no extrato do banco. A parcela ${p.parcela}/${p.total_parcelas ?? '?'} recebe baixa e a imobiliária passa a ver "pago".${aviso}`,
    )) return;
    rpc(p, 'confirmar_recebimento_repasse', { p_id: p.id }, true);
  };

  const recusar = (p: Pagamento) => {
    const motivo = prompt(`Por que o comprovante de ${p.inquilino_nome} está sendo devolvido?\n\nA imobiliária vai ler este texto no portal.`,
      p.leitura && p.leitura.valorConfere === false ? `O valor do PIX (${fmtBRL(p.leitura.valor)}) é diferente do valor da parcela (${fmtBRL(p.valor_esperado)}).` : '');
    if (!motivo || !motivo.trim()) return;
    rpc(p, 'recusar_comprovante_repasse', { p_id: p.id, p_motivo: motivo.trim() }, false);
  };

  const pagarSeguradora = (p: Pagamento) => rpc(p, 'marcar_repasse_pago_seguradora', { p_id: p.id }, false);
  const desmarcarSeguradora = (p: Pagamento) => rpc(p, 'desmarcar_repasse_pago_seguradora', { p_id: p.id }, false);
  const desfazerRecebimento = (p: Pagamento) => {
    if (!confirm(`Desfazer o recebimento de ${p.inquilino_nome}?\n\nA parcela ${p.parcela} volta a ficar em aberto${p.origem === 'portal' ? ' e o comprovante volta para a conferência' : ''}.`)) return;
    rpc(p, 'desfazer_recebimento_repasse', { p_id: p.id }, true);
  };

  // ── pedaços da tela ────────────────────────────────────────────────────────
  const Leitura: React.FC<{ p: Pagamento }> = ({ p }) => {
    if (lendo === p.id) return <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2"><Loader2 size={13} className="animate-spin" /> Lendo o comprovante…</div>;
    const l = p.leitura;
    if (!l) return null;
    if (l.duplicado) return <div className="text-xs font-bold text-rose-700 bg-rose-50 rounded-lg px-3 py-2">Este PIX já foi usado em outro repasse. Abra o comprovante antes de confirmar.</div>;
    if (l.ilegivel) return <div className="text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg px-3 py-2">Não consegui ler este comprovante. Abra o arquivo e confira no olho.</div>;
    if (l.confere) return <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2"><CheckCircle2 size={13} /> Leitura: valor, pagador e recebedor conferem</div>;
    const itens: string[] = [];
    if (l.valorConfere === false) itens.push(`comprovante de ${fmtBRL(l.valor)}, parcela de ${fmtBRL(p.valor_esperado)}`);
    if (l.valorConfere === null) itens.push('não achei o valor');
    if (l.pagadorConfere === false) itens.push(`pagador "${l.pagador}"`);
    if (l.pagadorConfere === null) itens.push('não achei o pagador');
    if (l.recebedorConfere === false) itens.push(`recebedor "${l.recebedor}"`);
    if (l.recebedorConfere === null) itens.push('não achei o recebedor');
    return <div className="flex items-start gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 rounded-lg px-3 py-2"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>Atenção: {itens.join('; ')}.</span></div>;
  };

  if (carregando) return <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-400">Carregando os comprovantes…</div>;
  if (erro) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
        Não consegui carregar os comprovantes de repasse: {erro}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          O repasse anda da esquerda para a direita: a imobiliária envia, você confirma no banco, você paga a seguradora.
        </p>
        <button type="button" onClick={carregar} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-xs font-bold rounded-xl transition-colors">
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        <Coluna titulo="Aguardando a imobiliária" qtd={aguardando.length} borda="border-slate-100" selo="bg-amber-100 text-amber-800"
          ajuda="Parcela em aberto, ainda sem comprovante. Nada a fazer aqui, só acompanhar.">
          {aguardando.length === 0 && <Vazio>Nenhuma parcela esperando comprovante.</Vazio>}
          {aguardando.map(c => {
            const atrasado = !!c.proximo_vencimento && c.proximo_vencimento.slice(0, 10) < hoje;
            const dias = atrasado ? Math.round((new Date(hoje + 'T00:00:00').getTime() - new Date(c.proximo_vencimento!.slice(0, 10) + 'T00:00:00').getTime()) / 86400000) : 0;
            return (
              <div key={c.id} className={atrasado ? 'border border-rose-200 bg-rose-50/60 rounded-xl px-3.5 py-3' : 'border border-slate-200 rounded-xl px-3.5 py-3'}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-sm text-slate-800 truncate">{c.inquilino_nome}</span>
                  <span className="font-bold text-sm text-slate-700 shrink-0">{fmtBRL(c.valor_seguro)}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {nomeParceiro(c.partner_id)} · parcela {c.parcela_atual}/{c.total_parcelas}
                  {c.proximo_vencimento ? ` · ${atrasado ? 'venceu' : 'vence'} ${fmtData(c.proximo_vencimento)}` : ''}
                </div>
                {atrasado && <div className="text-xs font-bold text-rose-700 mt-1.5">Atrasado há {dias} {dias === 1 ? 'dia' : 'dias'}</div>}
              </div>
            );
          })}
        </Coluna>

        <Coluna titulo="Para conferir" qtd={paraConferir.length} borda="border-blue-200" selo="bg-blue-100 text-blue-700"
          ajuda="Comprovante recebido pelo portal. Confira no extrato do banco e confirme.">
          {paraConferir.length === 0 && <Vazio>Nenhum comprovante esperando conferência.</Vazio>}
          {paraConferir.map(p => (
            <div key={p.id} className="border border-slate-200 rounded-xl p-3.5 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-sm text-slate-800 truncate">{p.inquilino_nome}</span>
                <span className="font-black text-lg text-slate-800 shrink-0">{fmtBRL(p.valor_esperado)}</span>
              </div>
              <div className="text-xs text-slate-500">
                {nomeParceiro(p.partner_id)} · parcela {p.parcela}/{p.total_parcelas ?? '?'}
                {p.seguradora ? ` · ${p.seguradora}` : ''} · enviado em {fmtQuando(p.comprovante_enviado_em)}
              </div>
              <Leitura p={p} />
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" disabled={ocupado === p.id} onClick={() => confirmar(p)}
                  className="px-3.5 py-2 bg-navy hover:bg-navy-light text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50">
                  Confirmar recebimento
                </button>
                <button type="button" onClick={() => verComprovante(p)}
                  className="flex items-center gap-1 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl transition-colors">
                  <FileText size={12} /> Ver comprovante
                </button>
                <button type="button" disabled={ocupado === p.id} onClick={() => recusar(p)}
                  className="px-3 py-2 text-slate-500 hover:text-rose-600 text-xs font-bold rounded-xl transition-colors">
                  Devolver
                </button>
              </div>
            </div>
          ))}
        </Coluna>

        <Coluna titulo="A pagar para a seguradora" qtd={aPagar.length} borda="border-slate-100" selo="bg-navy text-white"
          ajuda={<>Você já recebeu e ainda não repassou. Total: <strong className="text-slate-800">{fmtBRL(totalAPagar)}</strong></>}>
          {aPagar.length === 0 && <Vazio>Nada pendente com seguradora.</Vazio>}
          {aPagar.map(p => (
            <div key={p.id} className="border border-slate-200 rounded-xl p-3.5 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-sm text-slate-800 truncate">{p.inquilino_nome}</span>
                <span className="font-black text-lg text-slate-800 shrink-0">{fmtBRL(p.valor_esperado)}</span>
              </div>
              <div className="text-xs text-slate-500">
                <strong className="text-slate-700">{p.seguradora || 'Seguradora não informada'}</strong>
                {p.numero_apolice ? ` · apólice ${p.numero_apolice}` : ''} · parcela {p.parcela}/{p.total_parcelas ?? '?'}
              </div>
              <div className="text-xs text-slate-500">
                Recebido de {nomeParceiro(p.partner_id)} em {p.recebido_em ? fmtData(diaBrasilia(p.recebido_em)) : ''}
                {p.origem === 'manual' ? ' (baixa sem comprovante no portal)' : ''}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" disabled={ocupado === p.id} onClick={() => pagarSeguradora(p)}
                  className="px-3.5 py-2 bg-white border border-navy hover:bg-navy hover:text-white text-navy text-xs font-bold rounded-xl transition-colors disabled:opacity-50">
                  Já paguei a seguradora
                </button>
                {p.comprovante_path && (
                  <button type="button" onClick={() => verComprovante(p)} className="px-3 py-2 text-blue-700 hover:text-blue-900 text-xs font-bold">
                    Ver comprovante
                  </button>
                )}
                <button type="button" disabled={ocupado === p.id} onClick={() => desfazerRecebimento(p)}
                  className="px-3 py-2 text-slate-400 hover:text-amber-700 text-xs font-bold">
                  Desfazer
                </button>
              </div>
            </div>
          ))}
        </Coluna>

        <Coluna titulo="Concluído no mês" qtd={concluidos.length} borda="border-emerald-200" selo="bg-emerald-100 text-emerald-700"
          ajuda="Recebido da imobiliária e pago à seguradora.">
          {concluidos.length === 0 && <Vazio>Nenhum repasse concluído neste mês.</Vazio>}
          {concluidos.map(p => (
            <div key={p.id} className="border border-emerald-100 bg-emerald-50/50 rounded-xl px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-sm text-slate-800 truncate">{p.inquilino_nome}</span>
                <span className="font-bold text-sm text-slate-700 shrink-0">{fmtBRL(p.valor_esperado)}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {p.seguradora || 'Seguradora'} · pago em {fmtData(p.pago_seguradora_em)}
              </div>
              <button type="button" disabled={ocupado === p.id} onClick={() => desmarcarSeguradora(p)}
                className="mt-1.5 text-xs font-bold text-slate-400 hover:text-amber-700">
                Desmarcar pagamento
              </button>
            </div>
          ))}
        </Coluna>
      </div>
    </div>
  );
};

export default RepasseComprovantes;
