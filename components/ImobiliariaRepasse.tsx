import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Send, RefreshCw,
  User, Shield, FileText, DollarSign, Calendar, CheckCircle2, X, Loader2, AlertTriangle
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Cliente {
  id: string;
  inquilino_nome: string;
  seguradora: string;
  numero_apolice: string;
  valor_seguro: number;
  parcela_atual: number;
  total_parcelas: number;
  data_inicio: string;
  status: 'ativo' | 'encerrado';
  observacoes?: string;
  created_at: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const EMPTY_FORM = {
  inquilino_nome: '',
  seguradora: '',
  numero_apolice: '',
  valor_seguro: '',
  parcela_atual: '1',
  total_parcelas: '12',
  data_inicio: new Date().toISOString().split('T')[0],
  observacoes: '',
};

export default function ImobiliariaRepasse() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showEncerrados, setShowEncerrados] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('imobiliaria_clientes')
      .select('*')
      .order('inquilino_nome');
    setClientes(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ativos = clientes.filter(c => c.status === 'ativo');
  const encerrados = clientes.filter(c => c.status === 'encerrado');
  const totalMensal = ativos.reduce((s, c) => s + Number(c.valor_seguro), 0);

  const handleSave = async () => {
    if (!form.inquilino_nome || !form.seguradora || !form.numero_apolice || !form.valor_seguro) return;
    setSaving(true);
    await supabase.from('imobiliaria_clientes').insert({
      inquilino_nome: form.inquilino_nome,
      seguradora: form.seguradora,
      numero_apolice: form.numero_apolice,
      valor_seguro: parseFloat(form.valor_seguro.replace(',', '.')),
      parcela_atual: parseInt(form.parcela_atual),
      total_parcelas: parseInt(form.total_parcelas),
      data_inicio: form.data_inicio,
      observacoes: form.observacoes || null,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setSaving(false);
    load();
  };

  const avancarParcela = async (c: Cliente) => {
    const proxima = c.parcela_atual + 1;
    if (proxima > c.total_parcelas) {
      await supabase.from('imobiliaria_clientes').update({ status: 'encerrado', updated_at: new Date().toISOString() }).eq('id', c.id);
    } else {
      await supabase.from('imobiliaria_clientes').update({ parcela_atual: proxima, updated_at: new Date().toISOString() }).eq('id', c.id);
    }
    load();
  };

  const deletar = async (id: string) => {
    await supabase.from('imobiliaria_clientes').delete().eq('id', id);
    setConfirmDelete(null);
    load();
  };

  const enviarRelatorio = async () => {
    setSending(true);
    setSendError('');
    setSendSuccess(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/imobiliaria-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao enviar');
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 5000);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Erro ao enviar relatório');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Repasse Bordimezanolla</h2>
          <p className="text-slate-500 font-semibold mt-1">
            Gestão de clientes com repasse via imobiliária · PIX 56.123.874/0001-90 · vencimento dia 15
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 transition-colors" title="Atualizar">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={enviarRelatorio}
            disabled={sending || ativos.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B263B] hover:bg-[#243447] text-white font-bold text-sm rounded-xl transition-all disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {sending ? 'Enviando...' : 'Enviar Relatório'}
          </button>
          <button
            onClick={() => setShowForm(f => !f)}
            className="flex items-center gap-2 px-4 py-2 bg-[#C69C6D] hover:bg-[#b8895a] text-white font-bold text-sm rounded-xl transition-all"
          >
            <Plus size={15} /> Novo Cliente
          </button>
        </div>
      </div>

      {/* Feedback */}
      {sendSuccess && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 px-5 py-3 rounded-xl font-bold text-sm">
          <CheckCircle2 size={16} /> Relatório enviado para bordimezanolla@gmail.com com sucesso!
        </div>
      )}
      {sendError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-600 px-5 py-3 rounded-xl font-bold text-sm">
          <AlertTriangle size={16} /> {sendError}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#1B263B] rounded-2xl p-5 text-white">
          <p className="text-white/50 text-xs font-black uppercase tracking-widest mb-1">Total Mensal</p>
          <p className="text-2xl font-black text-[#C69C6D]">{fmtBRL(totalMensal)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Clientes Ativos</p>
          <p className="text-2xl font-black text-slate-800">{ativos.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Envio Automático</p>
          <p className="text-2xl font-black text-slate-800">Todo dia 10</p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-7">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-black text-slate-800">Novo Cliente</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Nome do Inquilino *</label>
              <input value={form.inquilino_nome} onChange={e => setForm(f => ({ ...f, inquilino_nome: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" placeholder="Ex: Maria da Silva" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Seguradora *</label>
              <input value={form.seguradora} onChange={e => setForm(f => ({ ...f, seguradora: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" placeholder="Ex: Porto Seguro" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Número da Apólice *</label>
              <input value={form.numero_apolice} onChange={e => setForm(f => ({ ...f, numero_apolice: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" placeholder="Ex: APL-2024-001" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Valor do Seguro (R$) *</label>
              <input value={form.valor_seguro} onChange={e => setForm(f => ({ ...f, valor_seguro: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" placeholder="Ex: 150,00" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Parcela Inicial</label>
              <input type="number" min="1" max="12" value={form.parcela_atual} onChange={e => setForm(f => ({ ...f, parcela_atual: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Total de Parcelas</label>
              <input type="number" min="1" value={form.total_parcelas} onChange={e => setForm(f => ({ ...f, total_parcelas: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Data de Início</label>
              <input type="date" value={form.data_inicio} onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest block mb-1">Observações</label>
              <input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" placeholder="Opcional" />
            </div>
          </div>
          <div className="flex gap-3 mt-6 justify-end">
            <button onClick={() => setShowForm(false)} className="px-6 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !form.inquilino_nome || !form.seguradora || !form.numero_apolice || !form.valor_seguro}
              className="px-6 py-2.5 bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-all disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {saving ? 'Salvando...' : 'Salvar Cliente'}
            </button>
          </div>
        </div>
      )}

      {/* Active clients table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="text-[#C69C6D] animate-spin" /></div>
      ) : ativos.length === 0 ? (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-12 text-center">
          <User size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="font-black text-slate-400">Nenhum cliente ativo</p>
          <p className="text-slate-300 text-sm mt-1">Clique em "Novo Cliente" para começar</p>
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-7 py-4 border-b border-slate-100 flex items-center justify-between">
            <p className="font-black text-slate-800 text-sm">{ativos.length} cliente(s) ativo(s)</p>
            <p className="text-xs font-bold text-slate-400">Clique em "Avançar Parcela" quando o pagamento do mês for confirmado</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Inquilino</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Seguradora</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Apólice</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Valor</th>
                  <th className="text-center px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Parcela</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {ativos.map(c => (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-[#1B263B] flex items-center justify-center shrink-0">
                          <User size={13} className="text-[#C69C6D]" />
                        </div>
                        <span className="font-bold text-slate-800 text-sm">{c.inquilino_nome}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{c.seguradora}</td>
                    <td className="px-5 py-4 text-sm font-mono text-slate-500">{c.numero_apolice}</td>
                    <td className="px-5 py-4 text-sm font-black text-slate-800">{fmtBRL(Number(c.valor_seguro))}</td>
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black ${
                        c.parcela_atual === c.total_parcelas
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {c.parcela_atual}/{c.total_parcelas}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => avancarParcela(c)}
                          className="px-3 py-1.5 bg-[#C69C6D]/15 hover:bg-[#C69C6D]/30 text-[#C69C6D] text-xs font-black rounded-lg transition-colors"
                          title={c.parcela_atual === c.total_parcelas ? 'Encerrar contrato' : 'Avançar para próxima parcela'}
                        >
                          {c.parcela_atual === c.total_parcelas ? 'Encerrar' : 'Avançar Parcela'}
                        </button>
                        {confirmDelete === c.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deletar(c.id)} className="text-red-500 text-xs font-bold hover:text-red-700">Confirmar</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-slate-400 text-xs hover:text-slate-600">Cancelar</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(c.id)} className="p-1.5 text-slate-300 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#1B263B]">
                  <td colSpan={3} className="px-5 py-3 text-white font-black text-sm">TOTAL MENSAL</td>
                  <td className="px-5 py-3 text-[#C69C6D] font-black text-sm">{fmtBRL(totalMensal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Encerrados */}
      {encerrados.length > 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <button onClick={() => setShowEncerrados(e => !e)}
            className="w-full flex items-center justify-between px-7 py-4 hover:bg-slate-50 transition-colors">
            <p className="font-black text-slate-500 text-sm">{encerrados.length} cliente(s) encerrado(s)</p>
            {showEncerrados ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </button>
          {showEncerrados && (
            <div className="border-t border-slate-100">
              {encerrados.map(c => (
                <div key={c.id} className="flex items-center justify-between px-7 py-3 border-b border-slate-50 opacity-50">
                  <span className="text-sm font-bold text-slate-600">{c.inquilino_nome}</span>
                  <span className="text-xs text-slate-400">{c.seguradora} · {c.numero_apolice} · {fmtBRL(Number(c.valor_seguro))} · {c.total_parcelas}/{c.total_parcelas}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
