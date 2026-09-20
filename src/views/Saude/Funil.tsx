import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, Plus } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import { formatCurrency } from '../../../utils/formatters.ts';
import LeadDrawer from './LeadDrawer.tsx';
import { PLANOS } from './precos.ts';
import {
  STATUS, CABECALHO_COLUNA, diasDesde,
  type Lead, type Status,
} from './funilTipos.ts';

/**
 * Funil de leads de plano de saúde.
 *
 * Kanban próprio, e não o de `prospects`: saúde tem etapas que Seguro Garantia
 * não tem (entrevista médica, documentação por beneficiário) e misturar as duas
 * na mesma tabela quebraria as duas telas.
 *
 * Arrastar um cartão faz update só do campo `status`. `status_entered_at` é
 * reescrito por trigger no banco, então a tela nunca manda esse campo.
 */

const PARADO_DIAS = 7;

const Funil: React.FC = () => {
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ultimaCotacao, setUltimaCotacao] = useState<Record<string, number>>({});
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobreColuna, setSobreColuna] = useState<Status | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from('unimed_leads').select('*').order('created_at', { ascending: false });
    if (error) {
      toast('Não consegui carregar os leads', 'error');
      setCarregando(false);
      return;
    }
    const lista = (data ?? []) as Lead[];
    setLeads(lista);

    if (lista.length) {
      /* Valor da última cotação de cada lead. Vem em uma consulta só,
         ordenada, e fica o primeiro que aparecer por lead. */
      const { data: cots } = await supabase
        .from('unimed_cotacoes')
        .select('lead_id, total_mensal, created_at')
        .in('lead_id', lista.map(l => l.id))
        .order('created_at', { ascending: false });
      const mapa: Record<string, number> = {};
      for (const c of (cots ?? [])) {
        const id = (c as any).lead_id as string | null;
        if (id && mapa[id] === undefined) mapa[id] = Number((c as any).total_mensal);
      }
      setUltimaCotacao(mapa);
    } else {
      setUltimaCotacao({});
    }
    setCarregando(false);
  }, [toast]);

  useEffect(() => { carregar(); }, [carregar]);

  const porStatus = useMemo(() => {
    const mapa = {} as Record<Status, Lead[]>;
    STATUS.forEach(s => { mapa[s] = []; });
    leads.forEach(l => { (mapa[l.status] ?? mapa['Novo']).push(l); });
    return mapa;
  }, [leads]);

  const paradosPorStatus = useMemo(() => {
    const mapa = {} as Record<Status, number>;
    STATUS.forEach(s => {
      mapa[s] = porStatus[s].filter(l => {
        const d = diasDesde(l.status_entered_at);
        return d !== null && d > PARADO_DIAS;
      }).length;
    });
    return mapa;
  }, [porStatus]);

  const mover = async (lead: Lead, novo: Status) => {
    if (lead.status === novo) return;
    const anterior = lead.status;
    /* Otimista: o cartão muda de coluna na hora e volta se o banco recusar. */
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: novo } : l));
    const { error } = await supabase
      .from('unimed_leads').update({ status: novo }).eq('id', lead.id);
    if (error) {
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: anterior } : l));
      toast('Não consegui mover o lead', 'error');
    } else {
      /* status_entered_at foi reescrito pela trigger; recarrega para o contador
         de parados não mentir. */
      carregar();
    }
  };

  const nomePlano = (codigo: string | null) =>
    PLANOS.find(p => p.id === codigo)?.nome ?? codigo ?? '';

  const aberto = leads.find(l => l.id === abertoId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-navy/60">
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'} no funil
        </p>
        <button onClick={carregar}
          className="flex items-center gap-2 border border-linha px-3 py-1.5 rounded-lg text-navy/70 hover:bg-areia transition-colors text-sm">
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {carregando && <p className="text-navy/50 text-sm">Carregando...</p>}

      {!carregando && leads.length === 0 && (
        <div className="border border-linha rounded-xl p-8 text-center">
          <p className="text-navy font-semibold">Nenhum lead ainda.</p>
          <p className="text-navy/60 text-sm mt-1">
            Os leads chegam pelo formulário do site e pela promoção de prospects
            da trilha de saúde.
          </p>
        </div>
      )}

      {!carregando && leads.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STATUS.map(status => {
            const daColuna = porStatus[status];
            const parados = paradosPorStatus[status];
            return (
              <div key={status}
                onDragOver={e => { e.preventDefault(); setSobreColuna(status); }}
                onDragLeave={() => setSobreColuna(prev => prev === status ? null : prev)}
                onDrop={e => {
                  e.preventDefault();
                  setSobreColuna(null);
                  const lead = leads.find(l => l.id === arrastando);
                  if (lead) mover(lead, status);
                  setArrastando(null);
                }}
                className={sobreColuna === status
                  ? 'w-64 shrink-0 bg-areia-clara rounded-xl p-2 ring-2 ring-gold'
                  : 'w-64 shrink-0 bg-areia rounded-xl p-2'}>

                <div className={`bg-white rounded-lg px-3 py-2 mb-2 ${CABECALHO_COLUNA[status]}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-navy text-sm">{status}</span>
                    <span className="text-navy/50 text-xs tabular-nums">{daColuna.length}</span>
                  </div>
                  {parados > 0 && (
                    <p className="flex items-center gap-1 text-[11px] text-amber-700 mt-1">
                      <AlertTriangle size={11} />
                      {parados} parado{parados > 1 ? 's' : ''} há mais de {PARADO_DIAS} dias
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  {daColuna.map(lead => {
                    const dias = diasDesde(lead.status_entered_at);
                    const parado = dias !== null && dias > PARADO_DIAS;
                    const valor = ultimaCotacao[lead.id];
                    return (
                      <button key={lead.id}
                        draggable
                        onDragStart={() => setArrastando(lead.id)}
                        onDragEnd={() => setArrastando(null)}
                        onClick={() => setAbertoId(lead.id)}
                        className={arrastando === lead.id
                          ? 'w-full text-left bg-white border border-gold rounded-lg p-3 opacity-50 cursor-grabbing'
                          : 'w-full text-left bg-white border border-linha rounded-lg p-3 hover:border-gold-dark transition-colors cursor-grab'}>
                        <p className="font-semibold text-navy text-sm leading-snug">{lead.empresa}</p>
                        <p className="text-navy/60 text-xs mt-0.5">
                          {[lead.cidade, lead.vidas ? `${lead.vidas} vidas` : null]
                            .filter(Boolean).join(' · ')}
                        </p>
                        {lead.plano_interesse && (
                          <p className="text-navy/60 text-xs mt-1">{nomePlano(lead.plano_interesse)}</p>
                        )}
                        {valor !== undefined && (
                          <p className="text-navy font-semibold text-sm mt-2 tabular-nums">
                            {formatCurrency(valor)}
                          </p>
                        )}
                        {parado && (
                          <p className="flex items-center gap-1 text-[11px] text-amber-700 mt-2">
                            <AlertTriangle size={11} /> {dias} dias parado
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {aberto && (
        <LeadDrawer
          lead={aberto}
          onFechar={() => setAbertoId(null)}
          onSalvo={carregar}
        />
      )}
    </div>
  );
};

export default Funil;
