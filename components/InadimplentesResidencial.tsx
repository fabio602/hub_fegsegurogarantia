import React, { useState, useEffect, useCallback } from 'react';
import { Upload, MessageCircle, CheckCircle2, Clock, AlertCircle, FileText, Loader2, X, RefreshCw, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast.tsx';

const ZAPI_INSTANCE_ID = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT_TOKEN = 'F1febfc77e5734fc38a3de6979b7c9bd8S';

interface Inadimplente {
  id: number;
  cpf: string;
  nome: string;
  apolice: string;
  parcela: number;
  vencimento: string;
  valor: number;
  telefone_pdf: string | null;
  telefone_base: string | null;
  status: 'inadimplente' | 'contatado' | 'boleto_solicitado' | 'aguardando' | 'pago' | 'arquivado';
  obs: string | null;
  data_contato: string | null;
  data_pagamento: string | null;
  relatorio_data: string | null;
  created_at: string;
}

const STATUS_CONFIG = {
  inadimplente:     { label: 'Inadimplente',       bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     dot: 'bg-red-500' },
  contatado:        { label: 'Contatado',           bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    dot: 'bg-blue-500' },
  boleto_solicitado:{ label: 'Boleto Solicitado',   bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  aguardando:       { label: 'Aguardando Pgto.',    bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200',  dot: 'bg-yellow-500' },
  pago:             { label: 'Pago',                bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  arquivado:        { label: 'Arquivado',           bg: 'bg-slate-50',   text: 'text-slate-500',   border: 'border-slate-200',   dot: 'bg-slate-400' },
};

function fmtBRL(v: number | null) {
  if (!v) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function cleanPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.length === 10 ? `55${digits}` : digits.startsWith('55') ? digits : `55${digits}`;
}

export default function InadimplentesResidencial() {
  const { toast, confirm: confirmDialog } = useToast();
  const [items, setItems] = useState<Inadimplente[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [sendingId, setSendingId] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('inadimplentes_residencial')
      .select('*')
      .neq('status', 'arquivado')
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'xls' || ext === 'xlsx') {
        // Parse Excel no browser com SheetJS
        const XLSX = await import('https://esm.sh/xlsx@0.18.5' as any);
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        // Encontra linha de cabeçalho (contém "Segurado")
        const headerIdx = rows.findIndex((r: any[]) => r.some((c: any) => String(c).includes('Segurado')));
        if (headerIdx < 0) throw new Error('Formato não reconhecido. Cabeçalho não encontrado.');

        const header: string[] = rows[headerIdx].map((c: any) => String(c || ''));
        const iNome    = header.findIndex(h => h.trim() === 'Segurado');
        const iCpf     = header.findIndex(h => h.toLowerCase().includes('cpf'));
        // Apólice = coluna "Negócio" (match exato, não "Parceiro de Negócio")
        const iApolice = header.findIndex(h => h.trim().toLowerCase() === 'negócio' || h.trim().toLowerCase() === 'negocio');
        const iEndosso = header.findIndex(h => h.toLowerCase().includes('endosso'));
        const iTel     = header.findIndex(h => h.toLowerCase().includes('telefone'));
        const iParcela = header.findIndex(h => h.toLowerCase().includes('parcela'));
        const iVenc    = header.findIndex(h => h.toLowerCase().includes('vencimento'));
        const iValor   = header.findIndex(h => h.toLowerCase().includes('valor'));

        const toIso = (d: string) => {
          if (!d) return null;
          const p = String(d).split('/');
          if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`;
          return null;
        };

        const dados = rows.slice(headerIdx + 1)
          .filter((r: any[]) => r[iCpf] && String(r[iCpf]).match(/\d{3}/))
          .map((r: any[]) => ({
            nome:       String(r[iNome] || '').trim(),
            cpf:        String(r[iCpf] || '').trim(),
            apolice:    String(r[iApolice] || '').trim(),
            endosso:    String(r[iEndosso] || '').trim(),
            telefone_pdf: r[iTel] ? String(r[iTel]).trim() : null,
            parcela:    r[iParcela] ? parseInt(String(r[iParcela])) : null,
            vencimento: toIso(String(r[iVenc] || '')),
            valor:      r[iValor] ? parseFloat(String(r[iValor])) : null,
            telefone_base: null,
            relatorio_data: null,
          }));

        if (!dados.length) throw new Error('Nenhum inadimplente encontrado no arquivo.');

        // Lookup de telefone na base por CPF
        const { data: clientes } = await supabase.from('residential_clients').select('cpf, telefone');
        const dadosComTel = dados.map((d: any) => {
          const cpfD = d.cpf?.replace(/\D/g, '');
          const match = (clientes || []).find((c: any) => c.cpf?.replace(/\D/g, '') === cpfD);
          return { ...d, telefone_base: match?.telefone || null };
        });

        setPreview(dadosComTel);
        toast(`${dadosComTel.length} inadimplente(s) extraído(s) do Excel`, 'success');

      } else {
        // PDF → Edge Function
        const form = new FormData();
        form.append('pdf', file);
        const res = await fetch('https://hfjvwibucplyhsvnwfor.supabase.co/functions/v1/parse-inadimplentes-pdf', {
          method: 'POST',
          headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmanZ3aWJ1Y3BseWhzdm53Zm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODA4NTIsImV4cCI6MjA4Nzk1Njg1Mn0.jCBS1YnDcKuVzJSVhGiJM0kyafPMZxFi52kszTJCxZQ' },
          body: form,
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Erro ao processar PDF');
        setPreview(json.dados);
        toast(`${json.total} inadimplente(s) extraído(s) do PDF`, 'success');
      }
    } catch (err: any) {
      toast('Erro ao processar arquivo: ' + err.message, 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleImport = async () => {
    if (!preview?.length) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('inadimplentes_residencial').insert(
        preview.map(p => ({
          cpf: p.cpf, nome: p.nome, apolice: p.apolice,
          parcela: p.parcela, vencimento: p.vencimento, valor: p.valor,
          telefone_pdf: p.telefone_pdf, telefone_base: p.telefone_base,
          relatorio_data: p.relatorio_data, status: 'inadimplente',
        }))
      );
      if (error) throw error;
      toast(`${preview.length} inadimplente(s) importado(s)!`, 'success');
      setPreview(null);
      fetchItems();
    } catch (err: any) {
      toast('Erro ao importar: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendWhatsApp = async (item: Inadimplente, tipo: 'cobranca' | 'boleto') => {
    const phone = cleanPhone(item.telefone_pdf || item.telefone_base);
    if (!phone) {
      toast('Nenhum telefone disponível para este cliente.', 'error');
      return;
    }

    const valor = fmtBRL(item.valor);
    const venc = fmtData(item.vencimento);
    const nome = item.nome.split(' ')[0];

    let message = '';
    let novoStatus: Inadimplente['status'] = 'contatado';

    if (tipo === 'cobranca') {
      message = `Olá ${nome}! Tudo bem? 😊\n\nAqui é a F&G Seguro Garantia.\n\nSou o corretor responsável pelo seu seguro residencial Tokio Marine e gostaria de te ajudar com uma pendência no seu seguro (apólice ${item.apolice || '—'}, parcela ${item.parcela || '—'} de ${valor}).\n\nQuando tiver um minutinho, podemos resolver isso juntos? É bem rápido 🙏`;
    } else {
      message = `Certo, vou providenciar o boleto atualizado e te envio em instantes.\n\nUm momento! 😊`;
      novoStatus = 'boleto_solicitado';
    }

    setSendingId(item.id);
    try {
      const res = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
        body: JSON.stringify({ phone, message }),
      });
      if (!res.ok) throw new Error('Erro Z-API');
      await supabase.from('inadimplentes_residencial')
        .update({ status: novoStatus, data_contato: new Date().toISOString() })
        .eq('id', item.id);
      toast('WhatsApp enviado!', 'success');
      fetchItems();
    } catch (err: any) {
      toast('Erro ao enviar WhatsApp: ' + err.message, 'error');
    } finally {
      setSendingId(null);
    }
  };

  const marcarPago = async (item: Inadimplente) => {
    const ok = await confirmDialog(`Confirma pagamento de ${item.nome}?`);
    if (!ok) return;
    await supabase.from('inadimplentes_residencial')
      .update({ status: 'pago', data_pagamento: new Date().toISOString().slice(0, 10) })
      .eq('id', item.id);
    toast('Marcado como pago!', 'success');
    fetchItems();
  };

  const filtered = filterStatus ? items.filter(i => i.status === filterStatus) : items;
  const totalPendente = items.filter(i => !['pago', 'arquivado'].includes(i.status)).reduce((s, i) => s + (i.valor || 0), 0);
  const counts = Object.fromEntries(Object.keys(STATUS_CONFIG).map(k => [k, items.filter(i => i.status === k).length]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800">Inadimplentes</h2>
          <p className="text-slate-500 font-medium mt-1">Relatório Tokio Marine — cobrança via WhatsApp</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchItems} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:border-[#C69C6D] transition-all">
            <RefreshCw size={16} />
          </button>
          <label className="flex items-center gap-2 px-5 py-3 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-sm rounded-xl transition-all cursor-pointer">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {uploading ? 'Processando...' : 'Importar Relatório Tokio'}
            <input type="file" accept=".pdf,.xls,.xlsx" className="hidden" onChange={handleFileUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#1B263B] rounded-2xl p-5">
          <p className="text-white/50 text-xs font-black uppercase tracking-widest mb-1">Total Pendente</p>
          <p className="text-[#C69C6D] text-2xl font-black">{fmtBRL(totalPendente)}</p>
        </div>
        {(['inadimplente', 'contatado', 'boleto_solicitado', 'pago'] as const).map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <div key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`bg-white rounded-2xl p-5 border cursor-pointer transition-all hover:shadow-md ${filterStatus === s ? 'border-[#1B263B]' : 'border-slate-100'}`}>
              <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">{cfg.label}</p>
              <p className="text-2xl font-black text-slate-800">{counts[s] || 0}</p>
            </div>
          );
        })}
      </div>

      {/* Preview after PDF parse */}
      {preview && (
        <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black text-slate-800 flex items-center gap-2">
              <FileText size={18} className="text-amber-600" />
              {preview.length} inadimplente(s) extraído(s) — confirme antes de importar
            </h3>
            <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
          </div>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead><tr className="bg-amber-100">
                {['CPF','Nome','Apólice','Parcela','Vencimento','Valor','Tel. PDF','Tel. Base'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-amber-800">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} className="border-t border-amber-100">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.cpf}</td>
                    <td className="px-3 py-2 font-bold text-slate-800">{p.nome}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.apolice || '—'}</td>
                    <td className="px-3 py-2 text-center">{p.parcela || '—'}</td>
                    <td className="px-3 py-2">{fmtData(p.vencimento)}</td>
                    <td className="px-3 py-2 font-bold text-red-700">{fmtBRL(p.valor)}</td>
                    <td className="px-3 py-2 text-xs">{p.telefone_pdf || '—'}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={p.telefone_base || ''}
                        onChange={e => setPreview(prev => prev!.map((item, idx) => idx === i ? { ...item, telefone_base: e.target.value } : item))}
                        placeholder="(00) 00000-0000"
                        className="w-full text-xs font-bold text-emerald-700 bg-transparent border-b border-dashed border-amber-300 outline-none focus:border-amber-500 placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button onClick={handleImport} disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-[#1B263B] text-white font-black text-sm rounded-xl disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin"/> : <CheckCircle2 size={15}/>}
              {saving ? 'Importando...' : `Confirmar e importar ${preview.length} registros`}
            </button>
            <button onClick={() => setPreview(null)} className="px-6 py-3 bg-white border border-slate-200 text-slate-600 font-black text-sm rounded-xl">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <p className="font-black text-slate-800">{filtered.length} registro(s)</p>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-[#C69C6D]">
            <option value="">Todos os status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="text-[#C69C6D] animate-spin"/></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <AlertCircle size={32} className="text-slate-300 mx-auto mb-3"/>
            <p className="font-black text-slate-400">Nenhum inadimplente{filterStatus ? ' com este status' : ''}</p>
            <p className="text-sm text-slate-300 mt-1">Importe o relatório PDF da Tokio Marine</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filtered.map(item => {
              const cfg = STATUS_CONFIG[item.status];
              const phone = cleanPhone(item.telefone_pdf || item.telefone_base);
              const isSending = sendingId === item.id;
              return (
                <div key={item.id} className="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap mb-1">
                        <p className="font-black text-slate-800">{item.nome}</p>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}/>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500 font-medium">
                        <span>Apólice {item.apolice || '—'}</span>
                        <span>Parcela {item.parcela || '—'}</span>
                        <span>Vence {fmtData(item.vencimento)}</span>
                        <span className="font-black text-red-700">{fmtBRL(item.valor)}</span>
                        {phone && <span className="flex items-center gap-1"><Phone size={11}/>{item.telefone_pdf || item.telefone_base}</span>}
                        {!phone && <span className="text-slate-300">Sem telefone</span>}
                      </div>
                      {item.data_contato && (
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                          <Clock size={11}/> Contatado em {new Date(item.data_contato).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      {item.status !== 'pago' && item.status !== 'arquivado' && (
                        <>
                          {item.status === 'boleto_solicitado' ? (
                            <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
                              ⏳ Enviar boleto via WhatsApp Hub
                            </span>
                          ) : (
                            <button onClick={() => sendWhatsApp(item, 'boleto')} disabled={!phone || isSending}
                              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-all disabled:opacity-40 border border-slate-200">
                              📄 Enviar Boleto
                            </button>
                          )}
                          <button onClick={() => sendWhatsApp(item, 'cobranca')} disabled={!phone || isSending}
                            className="flex items-center gap-1.5 px-3 py-2 bg-[#1B263B] hover:bg-[#243447] text-white font-black text-xs rounded-xl transition-all disabled:opacity-40">
                            {isSending ? <Loader2 size={12} className="animate-spin"/> : <MessageCircle size={12}/>}
                            {item.status === 'inadimplente' ? 'Contatar' : 'Recontatar'}
                          </button>
                          <button onClick={() => marcarPago(item)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl transition-all">
                            <CheckCircle2 size={12}/> Pago
                          </button>
                        </>
                      )}
                      {item.status === 'pago' && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                          ✅ Pago{item.data_pagamento ? ' em ' + fmtData(item.data_pagamento) : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
