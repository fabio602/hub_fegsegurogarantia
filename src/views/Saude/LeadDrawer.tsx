import React, { useCallback, useEffect, useState } from 'react';
import { X, MessageCircle, AlertTriangle, Calculator } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import { formatCurrency } from '../../../utils/formatters.ts';
import { whatsappUrlFromPhone } from '../../../utils/whatsapp.ts';
import { PLANOS, LIMITE_VIDAS } from './precos.ts';
import Documentos from './Documentos.tsx';
import {
  MESES, diasDesde, mascararCnpj, renovacaoProxima,
  type Lead,
} from './funilTipos.ts';

/**
 * Painel lateral de um lead de saúde.
 *
 * Os campos salvam ao sair do campo (blur), não por um botão de salvar no fim:
 * o uso real é o Fábio corrigindo um telefone no meio de uma ligação, e um
 * formulário inteiro para confirmar uma linha atrapalha mais do que ajuda.
 *
 * `updated_at` e `status_entered_at` nunca são enviados: a trigger
 * `unimed_leads_touch_trg` cuida dos dois no banco.
 */

const PARADO_ALERTA_DIAS = 14;

interface Cotacao {
  id: string;
  created_at: string;
  plano: string;
  vidas_total: number;
  total_mensal: number;
  tabela: string;
}

interface Props {
  lead: Lead;
  onFechar: () => void;
  onSalvo: () => void;
}

const LeadDrawer: React.FC<Props> = ({ lead, onFechar, onSalvo }) => {
  const { toast } = useToast();
  const [rascunho, setRascunho] = useState<Lead>(lead);
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setRascunho(lead); }, [lead]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('unimed_cotacoes')
        .select('id, created_at, plano, vidas_total, total_mensal, tabela')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false });
      setCotacoes((data ?? []) as Cotacao[]);
    })();
  }, [lead.id]);

  /* Fecha no Esc, como o resto do hub. */
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onFechar]);

  const salvarCampo = useCallback(async (campo: keyof Lead, valor: unknown) => {
    if ((lead as any)[campo] === valor) return;
    if (campo === 'motivo_perda' && lead.status === 'Perdido' && !valor) {
      toast('Em Perdido o motivo é obrigatório', 'error');
      return;
    }
    setSalvando(true);
    const { error } = await supabase
      .from('unimed_leads').update({ [campo]: valor }).eq('id', lead.id);
    setSalvando(false);
    if (error) {
      toast(`Não consegui salvar ${String(campo)}`, 'error');
      setRascunho(lead);
    } else {
      onSalvo();
    }
  }, [lead, onSalvo, toast]);

  const campo = (
    rotulo: string,
    chave: keyof Lead,
    tipo: 'text' | 'number' | 'date' | 'email' = 'text',
  ) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-navy/50">{rotulo}</span>
      <input
        type={tipo}
        value={(rascunho[chave] as string | number | null) ?? ''}
        onChange={e => setRascunho(p => ({
          ...p,
          [chave]: tipo === 'number'
            ? (e.target.value === '' ? null : Number(e.target.value))
            : e.target.value,
        }))}
        onBlur={e => salvarCampo(chave, tipo === 'number'
          ? (e.target.value === '' ? null : Number(e.target.value))
          : (e.target.value || null))}
        className="mt-1 w-full border border-linha rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
      />
    </label>
  );

  const diasParado = diasDesde(lead.status_entered_at);
  const zap = whatsappUrlFromPhone(rascunho.telefone);
  const nomePlano = (c: string | null) => PLANOS.find(p => p.id === c)?.nome ?? c ?? '';

  const alertas: string[] = [];
  if ((rascunho.vidas ?? 0) > LIMITE_VIDAS) {
    alertas.push(`Acima de ${LIMITE_VIDAS} vidas. Passa por reserva de mercado e precisa de carta de nomeação.`);
  }
  if (renovacaoProxima(rascunho.mes_renovacao)) {
    alertas.push('Renovação do plano atual está próxima.');
  }
  if (diasParado !== null && diasParado > PARADO_ALERTA_DIAS) {
    alertas.push(`Parado há ${diasParado} dias em ${lead.status}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-navy/30" onClick={onFechar} aria-hidden="true" />

      <aside className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-xl animate-in slide-in-from-right">
        <header className="sticky top-0 bg-white border-b border-linha px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h2 className="font-bold text-navy leading-snug">{lead.empresa}</h2>
            <p className="text-xs text-navy/60 mt-0.5">
              {lead.status}
              {diasParado !== null && ` · ${diasParado} dias nesta etapa`}
              {salvando && ' · salvando...'}
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="text-navy/50 hover:text-navy p-1">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-6">

          {alertas.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
              {alertas.map(a => (
                <p key={a} className="flex gap-2 text-xs text-navy/80">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                  {a}
                </p>
              ))}
            </div>
          )}

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-gold-dark font-semibold">Empresa</h3>
            {campo('Empresa', 'empresa')}
            <div>
              <span className="text-[11px] uppercase tracking-wider text-navy/50">CNPJ</span>
              <p className="mt-1 text-sm text-navy tabular-nums">
                {mascararCnpj(rascunho.cnpj) || 'não informado'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {campo('Cidade', 'cidade')}
              {campo('UF', 'uf')}
            </div>
            {campo('Site', 'site')}
            {campo('CNAE principal', 'cnae_principal')}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-gold-dark font-semibold">Contato</h3>
            <div className="grid grid-cols-2 gap-3">
              {campo('Nome', 'contato')}
              {campo('Cargo', 'cargo')}
            </div>
            {campo('E-mail', 'email', 'email')}
            {campo('Telefone', 'telefone')}
            {zap && (
              <a href={zap} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-whatsapp text-white px-3 py-1.5 rounded-lg text-sm hover:bg-whatsapp-hover transition-colors">
                <MessageCircle size={14} /> Falar no WhatsApp
              </a>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-gold-dark font-semibold">Qualificação</h3>
            <div className="grid grid-cols-2 gap-3">
              {campo('Vidas', 'vidas', 'number')}
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-navy/50">Plano de interesse</span>
                <select
                  value={rascunho.plano_interesse ?? ''}
                  onChange={e => {
                    const v = e.target.value || null;
                    setRascunho(p => ({ ...p, plano_interesse: v }));
                    salvarCampo('plano_interesse', v);
                  }}
                  className="mt-1 w-full border border-linha rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold">
                  <option value="">Não definido</option>
                  {PLANOS.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy">
              <input type="checkbox"
                checked={!!rascunho.tem_plano_atual}
                onChange={e => {
                  setRascunho(p => ({ ...p, tem_plano_atual: e.target.checked }));
                  salvarCampo('tem_plano_atual', e.target.checked);
                }} />
              Já tem plano hoje
            </label>

            {rascunho.tem_plano_atual && (
              <div className="grid grid-cols-2 gap-3">
                {campo('Operadora atual', 'operadora_atual')}
                {campo('Valor atual', 'valor_atual', 'number')}
              </div>
            )}

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-navy/50">Mês de renovação</span>
              <select
                value={rascunho.mes_renovacao ?? ''}
                onChange={e => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setRascunho(p => ({ ...p, mes_renovacao: v }));
                  salvarCampo('mes_renovacao', v);
                }}
                className="mt-1 w-full border border-linha rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold">
                <option value="">Não sei</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>

            {campo('Próxima ação', 'proxima_acao')}

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-navy/50">Observações</span>
              <textarea rows={3}
                value={rascunho.observacoes ?? ''}
                onChange={e => setRascunho(p => ({ ...p, observacoes: e.target.value }))}
                onBlur={e => salvarCampo('observacoes', e.target.value || null)}
                className="mt-1 w-full border border-linha rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
            </label>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-gold-dark font-semibold">Cotações</h3>
            {cotacoes.length === 0 && (
              <p className="text-sm text-navy/50">Nenhuma cotação salva para este lead.</p>
            )}
            {cotacoes.map(c => (
              <div key={c.id} className="border border-linha rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-navy font-medium">{nomePlano(c.plano)}</p>
                  <p className="text-[11px] text-navy/50">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')} · {c.vidas_total} vidas
                  </p>
                </div>
                <p className="text-sm font-semibold text-navy tabular-nums">
                  {formatCurrency(c.total_mensal)}
                </p>
              </div>
            ))}
            <p className="flex items-center gap-2 text-xs text-navy/50">
              <Calculator size={13} />
              Para montar uma cotação nova, abra o Simulador de Cotação no menu.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-gold-dark font-semibold">Documentos</h3>
            <Documentos leadId={lead.id} />
          </section>

          {lead.status === 'Implantado' && (
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">Fechamento</h3>
              <div className="grid grid-cols-2 gap-3">
                {campo('Vigência prevista', 'vigencia_prevista', 'date')}
                {campo('Implantado em', 'implantado_em', 'date')}
                {campo('Vidas implantadas', 'vidas_implantadas', 'number')}
                {campo('Valor mensal', 'valor_mensal', 'number')}
              </div>
            </section>
          )}

          {lead.status === 'Perdido' && (
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-rose-700 font-semibold">Motivo da perda</h3>
              <textarea rows={3}
                value={rascunho.motivo_perda ?? ''}
                onChange={e => setRascunho(p => ({ ...p, motivo_perda: e.target.value }))}
                onBlur={e => salvarCampo('motivo_perda', e.target.value || null)}
                placeholder="Obrigatório para leads em Perdido"
                className="w-full border border-rose-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};

export default LeadDrawer;
