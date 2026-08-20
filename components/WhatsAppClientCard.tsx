import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Phone, Shield, Home } from 'lucide-react';
import { supabase } from '../lib/supabase.ts';

interface ClientInfo {
  source: 'sale' | 'residential' | null;
  nome: string;
  email?: string;
  telefone?: string;
  records: Array<{
    type: string;
    label: string;
    value: string;
    color: string;
  }>;
  lastSale?: { nome: string; seguradora: string; data: string };
  lastResidential?: { apolice: string; situacao: string; fim_vigencia: string };
}

interface WhatsAppClientCardProps {
  phone: string;
  leadName: string;
}

export function WhatsAppClientCard({ phone, leadName }: WhatsAppClientCardProps) {
  const [open, setOpen] = useState(true);
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!phone && !leadName) return;
    loadClientInfo();
  }, [phone, leadName]);

  const loadClientInfo = async () => {
    setLoading(true);
    try {
      const phoneDigits = phone.replace(/\D/g, '').slice(-10);
      const firstName = leadName?.split(' ')[0] || '';

      const { data: sales } = await supabase
        .from('sales')
        .select('nome, seguradora, data, vendeu, tipo, premio, telefone')
        .or(`telefone.ilike.%${phoneDigits}%,nome.ilike.%${firstName}%`)
        .eq('vendeu', 'Sim')
        .order('data', { ascending: false })
        .limit(3);

      const { data: residential } = await supabase
        .from('residential_clients')
        .select('nome, apolice, situacao, fim_vigencia, telefone, email')
        .or(`telefone.ilike.%${phoneDigits}%,nome.ilike.%${firstName}%`)
        .order('created_at', { ascending: false })
        .limit(3);

      const records: ClientInfo['records'] = [];

      if (sales && sales.length > 0) {
        records.push({
          type: 'sale',
          label: `${sales.length} venda(s) de garantia`,
          value: sales.map(s => s.seguradora || s.tipo || '—').join(', '),
          color: '#1d4ed8',
        });
      }

      if (residential && residential.length > 0) {
        const r = residential[0];
        const vencDate = r.fim_vigencia
          ? new Date(r.fim_vigencia + 'T12:00:00').toLocaleDateString('pt-BR')
          : '—';
        records.push({
          type: 'residential',
          label: 'Seguro Residencial',
          value: `${r.situacao} · Vence ${vencDate}`,
          color: '#16a34a',
        });
      }

      setInfo({
        source: sales?.length ? 'sale' : residential?.length ? 'residential' : null,
        nome: sales?.[0]?.nome || residential?.[0]?.nome || leadName,
        email: residential?.[0]?.email,
        telefone: phone,
        records,
        lastSale: sales?.[0]
          ? { nome: sales[0].nome, seguradora: sales[0].seguradora || '—', data: sales[0].data }
          : undefined,
        lastResidential: residential?.[0]
          ? {
              apolice: residential[0].apolice || '—',
              situacao: residential[0].situacao,
              fim_vigencia: residential[0].fim_vigencia,
            }
          : undefined,
      });
    } catch (e) {
      setInfo({ source: null, nome: leadName, records: [] });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: '#f8f5f0',
          borderRadius: '12px',
          fontSize: '12px',
          color: '#94a3b8',
          margin: '8px',
        }}
      >
        Buscando histórico do cliente...
      </div>
    );
  }

  return (
    <div
      style={{
        margin: '8px',
        background: '#fff',
        border: '1px solid #e8e4dc',
        borderRadius: '14px',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          background: '#f8f5f0',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            background: info?.source ? '#1B263B' : '#e8e4dc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {info?.source === 'sale' ? (
            <Shield size={13} style={{ color: '#C69C6D' }} />
          ) : info?.source === 'residential' ? (
            <Home size={13} style={{ color: '#C69C6D' }} />
          ) : (
            <Phone size={13} style={{ color: '#94a3b8' }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 900,
              color: '#1B263B',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {info?.nome || leadName || 'Cliente'}
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
            {info?.records.length
              ? `${info.records.length} registro(s) no CRM`
              : 'Sem histórico no CRM'}
          </div>
        </div>
        {open ? (
          <ChevronUp size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
        ) : (
          <ChevronDown size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <div style={{ padding: '12px 14px' }}>
          {info?.records.length === 0 ? (
            <p
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                textAlign: 'center',
                padding: '8px 0',
              }}
            >
              Nenhum registro encontrado no CRM para este contato.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {info?.records.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: r.color,
                      marginTop: '5px',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 900, color: '#1B263B' }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: '10px', color: '#78716c', marginTop: '1px' }}>
                      {r.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {info?.lastSale && (
            <div
              style={{
                marginTop: '10px',
                padding: '8px 10px',
                background: '#f0f6ff',
                borderRadius: '10px',
                fontSize: '11px',
              }}
            >
              <div style={{ fontWeight: 900, color: '#1d4ed8', marginBottom: '2px' }}>
                Última venda de garantia
              </div>
              <div style={{ color: '#475569' }}>
                {info.lastSale.nome} · {info.lastSale.seguradora}
              </div>
            </div>
          )}
          {info?.lastResidential && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px 10px',
                background: '#f0fdf4',
                borderRadius: '10px',
                fontSize: '11px',
              }}
            >
              <div style={{ fontWeight: 900, color: '#16a34a', marginBottom: '2px' }}>
                Seguro Residencial
              </div>
              <div style={{ color: '#475569' }}>
                Apólice {info.lastResidential.apolice} · {info.lastResidential.situacao}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
