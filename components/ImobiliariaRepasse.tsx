import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Send, RefreshCw,
  User, Shield, FileText, DollarSign, Calendar, CheckCircle2, X, Loader2, AlertTriangle, Pencil
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
  status: 'ativo' | 'encerrado' | 'aguardando_cotacao';
  tipo_seguro?: string;
  status_residencial?: string;
  status_garantia?: string | null;
  apolice_residencial_url?: string | null;
  apolice_garantia_url?: string | null;
  observacoes?: string;
  created_at: string;
  dia_vencimento_aluguel?: number | null;
  repasse_pago_em?: string | null;
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

function ApoliceUpload({ clienteId, field, onUploaded }: { clienteId: string; field: string; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = React.useState(false);
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `apolices/${clienteId}/${field}_${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from('imobiliaria-docs').upload(path, file, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('imobiliaria-docs').getPublicUrl(path);
      onUploaded(data.publicUrl);
    } catch (err: any) { alert('Erro ao enviar PDF: ' + err.message); }
    finally { setUploading(false); e.target.value = ''; }
  };
  return (
    <label className={`flex items-center gap-2 px-4 py-2.5 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploading ? 'border-slate-200 bg-slate-50' : 'border-[#C69C6D]/40 hover:border-[#C69C6D] hover:bg-[#C69C6D]/5'}`}>
      <input type="file" accept="application/pdf" className="hidden" onChange={handleFile} disabled={uploading} />
      {uploading ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <FileText size={15} className="text-[#C69C6D]" />}
      <span className="text-sm font-bold text-slate-600">{uploading ? 'Enviando...' : 'Clique para anexar PDF da apólice'}</span>
    </label>
  );
}

export default function ImobiliariaRepasse({ onGoToSale }: { onGoToSale?: (data: { nome: string; telefone: string }) => void } = {}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [parceiros, setParceiros] = useState<{id: number; name: string; email?: string}[]>([]);
  const [filterParceiro, setFilterParceiro] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showEncerrados, setShowEncerrados] = useState(false);
  const [repasseModal, setRepasseModal] = useState(false);
  const [repasseForm, setRepasseForm] = useState({ mes: new Date().getMonth() + 1, ano: new Date().getFullYear(), data_pagamento: '', observacoes: '' });
  const [repasseFile, setRepasseFile] = useState<File | null>(null);
  const [savingRepasse, setSavingRepasse] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const salvarRepasse = async () => {
    setSavingRepasse(true);
    try {
      let comprovante_url = null;
      if (repasseFile) {
        const path = `${repasseForm.ano}/${repasseForm.mes}/${Date.now()}_${repasseFile.name}`;
        await supabase.storage.from('repasse-comprovantes').upload(path, repasseFile, { upsert: true });
        const { data: urlData } = supabase.storage.from('repasse-comprovantes').getPublicUrl(path);
        comprovante_url = urlData.publicUrl;
      }
      const valor_total = ativos.reduce((s, c) => s + Number(c.valor_seguro || 0), 0);
      await supabase.from('imobiliaria_repasses').upsert({
        partner_id: ativos[0]?.partner_id || null,
        mes: repasseForm.mes,
        ano: repasseForm.ano,
        valor_total,
        data_pagamento: repasseForm.data_pagamento || null,
        comprovante_url,
        status: repasseForm.data_pagamento ? 'pago' : 'pendente',
        observacoes: repasseForm.observacoes || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,mes,ano' });
      setRepasseModal(false);
      setRepasseFile(null);
    } catch (e) { console.error(e); }
    finally { setSavingRepasse(false); }
  };
  // Modal de configuração de repasse ao aprovar cliente do portal
  const [repasseSetupModal, setRepasseSetupModal] = useState<{ clienteId: string; nome: string; newStatus: string } | null>(null);
  const [repasseSetupForm, setRepasseSetupForm] = useState({ total_parcelas: 12, valor_seguro: '', dia_vencimento_aluguel: '' });

  const moveCard = async (clienteId: string, newStatus: string) => {
    setDraggingId(null); setDragOver(null);
    // Se movendo para Aprovado, verifica se é cliente novo do portal (is_repasse = false)
    if (newStatus === 'aprovado') {
      const cliente = clientes.find(c => c.id === clienteId);
      if (cliente && !(cliente as any).is_repasse) {
        setRepasseSetupForm({ total_parcelas: 12, valor_seguro: '' });
        setRepasseSetupModal({ clienteId, nome: cliente.inquilino_nome, newStatus });
        return; // aguarda confirmação no modal
      }
    }
    await supabase.from('imobiliaria_clientes')
      .update({ kanban_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', clienteId);
    setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, kanban_status: newStatus } as any : c));
  };

  const confirmarRepasseSetup = async () => {
    if (!repasseSetupModal) return;
    const valor = parseFloat(repasseSetupForm.valor_seguro.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
    const diaVenc = parseInt(repasseSetupForm.dia_vencimento_aluguel) || null;
    await supabase.from('imobiliaria_clientes').update({
      kanban_status: repasseSetupModal.newStatus,
      is_repasse: true,
      total_parcelas: repasseSetupForm.total_parcelas,
      parcela_atual: 1,
      valor_seguro: valor,
      dia_vencimento_aluguel: diaVenc,
      updated_at: new Date().toISOString(),
    }).eq('id', repasseSetupModal.clienteId);
    setClientes(prev => prev.map(c => c.id === repasseSetupModal.clienteId
      ? { ...c, kanban_status: repasseSetupModal.newStatus, is_repasse: true, total_parcelas: repasseSetupForm.total_parcelas, valor_seguro: valor } as any
      : c));
    setRepasseSetupModal(null);
  };

  const [editingStatus, setEditingStatus] = useState<Cliente | null>(null);
  const [editStatusForm, setEditStatusForm] = useState({ status_residencial: '', status_garantia: '', apolice_residencial_url: '', apolice_garantia_url: '', vigencia_fim: '', status_apolice: 'ativo', kanban_status: 'solicitado', seguradora: '', numero_apolice: '', dia_vencimento_aluguel: '', valor_seguro: '' });

  const STATUS_LABELS: Record<string, string> = { aguardando_cotacao: '⏳ Aguardando', em_analise: '🔍 Em análise', aprovado: '✅ Aprovado', emitido: '📄 Emitido', recusado: '❌ Recusado' };
  const STATUS_COLORS: Record<string, string> = { aguardando_cotacao: 'bg-yellow-50 text-yellow-800', em_analise: 'bg-blue-50 text-blue-700', aprovado: 'bg-emerald-50 text-emerald-700', emitido: 'bg-green-100 text-green-800', recusado: 'bg-red-50 text-red-700' };

  const openEditStatus = (c: Cliente) => {
    setEditingStatus(c);
    setEditStatusForm({ status_residencial: c.status_residencial || 'aguardando_cotacao', status_garantia: c.status_garantia || 'aguardando_cotacao', apolice_residencial_url: c.apolice_residencial_url || '', apolice_garantia_url: c.apolice_garantia_url || '', vigencia_fim: (c as any).vigencia_fim || '', status_apolice: (c as any).status_apolice || 'ativo', kanban_status: (c as any).kanban_status || 'solicitado', seguradora: c.seguradora || '', numero_apolice: c.numero_apolice || '', dia_vencimento_aluguel: c.dia_vencimento_aluguel?.toString() || '', valor_seguro: Number(c.valor_seguro) > 0 ? String(c.valor_seguro) : '' });
  };
  const saveStatus = async () => {
    if (!editingStatus) return;
    // Auto-advance kanban when policy is emitted or approved
    let kanban = editStatusForm.kanban_status || 'solicitado';
    if (['emitido','aprovado'].includes(editStatusForm.status_residencial) &&
        ['solicitado','atendimento_iniciado','aguardando_seguradora'].includes(kanban)) {
      kanban = 'aprovado';
    }
    if (editStatusForm.status_residencial === 'recusado') kanban = 'recusado';

    const diaVencEdit = parseInt(editStatusForm.dia_vencimento_aluguel) || null;
    const valorSegRaw = parseFloat((editStatusForm.valor_seguro || '').replace(',', '.'));
    const valorSegEdit = isNaN(valorSegRaw) || valorSegRaw === 0 ? undefined : valorSegRaw;

    const updatePayload: Record<string, unknown> = {
      status_residencial: editStatusForm.status_residencial,
      status_garantia: editingStatus.tipo_seguro === 'residencial_garantia' ? editStatusForm.status_garantia : null,
      apolice_residencial_url: editStatusForm.apolice_residencial_url || null,
      apolice_garantia_url: editingStatus.tipo_seguro === 'residencial_garantia' ? editStatusForm.apolice_garantia_url || null : null,
      vigencia_fim: editStatusForm.vigencia_fim || null,
      status_apolice: editStatusForm.status_apolice || 'ativo',
      kanban_status: kanban,
      seguradora: editStatusForm.seguradora || null,
      numero_apolice: editStatusForm.numero_apolice || null,
      dia_vencimento_aluguel: diaVencEdit,
      updated_at: new Date().toISOString(),
    };
    if (valorSegEdit !== undefined) updatePayload.valor_seguro = valorSegEdit;

    const { error: updateError } = await supabase
      .from('imobiliaria_clientes')
      .update(updatePayload)
      .eq('id', editingStatus.id);

    if (updateError) {
      console.error('[saveStatus] Erro ao salvar:', updateError);
      alert(`Erro ao salvar: ${updateError.message}`);
      return;
    }

    // Atualiza estado local imediatamente (otimista) para evitar flash do valor antigo
    setClientes(prev => prev.map(c => c.id === editingStatus.id
      ? { ...c, ...updatePayload, kanban_status: kanban } as any
      : c
    ));
    setEditingStatus(null);

    // ── Sync para residential_clients quando emitido ──────────────
    if (editStatusForm.status_residencial === 'emitido' && editingStatus.inquilino_nome) {
      const parceiroNome = (editingStatus as any).parceiro_nome ||
        parceiros.find(p => p.id === (editingStatus as any).partner_id)?.name || null;

      // Busca o registro correspondente em residential_clients
      const { data: rcList } = await supabase
        .from('residential_clients')
        .select('id, situacao')
        .ilike('nome', editingStatus.inquilino_nome.trim())
        .limit(1);

      const rcUpdate: Record<string, unknown> = {
        situacao: 'Ativo',
        parceiro_nome: parceiroNome,
      };
      if (editStatusForm.seguradora) rcUpdate.seguradora_residencial = editStatusForm.seguradora; // campo extra se existir
      if (editStatusForm.numero_apolice) rcUpdate.apolice = editStatusForm.numero_apolice;
      if (editStatusForm.vigencia_fim) rcUpdate.fim_vigencia = editStatusForm.vigencia_fim;
      if (editStatusForm.apolice_residencial_url) rcUpdate.apolice_url = editStatusForm.apolice_residencial_url;

      if (rcList && rcList.length > 0) {
        // Atualiza registro existente
        await supabase.from('residential_clients').update(rcUpdate).eq('id', rcList[0].id);
      } else {
        // Cria novo registro no Residencial
        await supabase.from('residential_clients').insert({
          nome: editingStatus.inquilino_nome,
          cpf: (editingStatus as any).cpf || null,
          telefone: (editingStatus as any).telefone || null,
          email: (editingStatus as any).email_inquilino || null,
          produto: 'Residencial',
          apolice: editStatusForm.numero_apolice || null,
          fim_vigencia: editStatusForm.vigencia_fim || null,
          apolice_url: editStatusForm.apolice_residencial_url || null,
          situacao: 'Ativo',
          parceiro_nome: parceiroNome,
          obs: 'Criado automaticamente via Repasse Imobiliárias',
        });
      }
    }

    // Email para imobiliária quando apólice é adicionada
    const apoliceNova = editStatusForm.apolice_residencial_url && editStatusForm.apolice_residencial_url !== (editingStatus.apolice_residencial_url || '');
    if (apoliceNova && (editingStatus as any).partner_id) {
      supabase.functions.invoke('imobiliaria-envia-apolice', {
        body: { client_id: editingStatus.id },
      }).catch(e => console.warn('Email apólice:', e));
    }
    load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    // Load all imobiliária partners
    const { data: partnerData } = await supabase
      .from('partners')
      .select('id, name, email')
      .eq('partner_type', 'imobiliaria')
      .order('name');
    setParceiros(partnerData ?? []);

    // Load clients filtered by partner if selected
    let query = supabase.from('imobiliaria_clientes').select('*').order('inquilino_nome');
    if (filterParceiro) query = query.eq('partner_id', filterParceiro);
    const { data } = await query;
    setClientes(data ?? []);
    setLoading(false);
  }, [filterParceiro]);

  useEffect(() => { load(); }, [load]);

  // Pendentes = solicitações da imobiliária sem apólice ainda emitida
  const pendentes = clientes.filter(c => ['solicitado','atendimento_iniciado','aguardando_seguradora'].includes((c as any).kanban_status || 'solicitado') && !c.numero_apolice);
  const ativos = clientes.filter(c => c.status === 'ativo' && (c as any).is_repasse === true);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl lg:text-3xl font-black text-slate-800 tracking-tight">
            Repasse Imobiliárias
            {filterParceiro && parceiros.find(p => p.id === filterParceiro) && (
              <span className="text-lg text-[#C69C6D] ml-2">— {parceiros.find(p => p.id === filterParceiro)?.name}</span>
            )}
          </h2>
          <p className="text-slate-500 font-semibold mt-1">
            Gestão de clientes residenciais por imobiliária parceira
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter by partner — always visible */}
          {parceiros.length > 0 && (
            <select
              value={filterParceiro ?? ''}
              onChange={e => setFilterParceiro(e.target.value ? parseInt(e.target.value) : null)}
              className="text-sm font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-700 bg-white focus:outline-none focus:border-[#C69C6D] cursor-pointer"
            >
              <option value="">Todas as imobiliárias</option>
              {parceiros.map(p => <option key={p.id} value={p.id}>{p.name.replace('Imobiliária ', '')}</option>)}
            </select>
          )}
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 transition-colors" title="Atualizar">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={async () => {
              setSending(true); setSendError(''); setSendSuccess(false);
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const supabaseUrl = (supabase as any).supabaseUrl as string;
                const supabaseKey = (supabase as any).supabaseKey as string;
                const res = await fetch(`${supabaseUrl}/functions/v1/imobiliaria-report`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
                  body: JSON.stringify({ test_mode: true, to: 'fabio@fegsegurogarantia.com.br' }),
                });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Erro');
                setSendSuccess(true); setTimeout(() => setSendSuccess(false), 5000);
              } catch (e) { setSendError(e instanceof Error ? e.message : 'Erro'); }
              finally { setSending(false); }
            }}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Enviar Teste Para Mim
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
          <button
            onClick={() => setRepasseModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-all"
          >
            <CheckCircle2 size={15} /> Registrar Repasse
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-4 lg:p-7">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-black text-slate-800">Novo Cliente</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
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

      {/* Kanban Board — All clients */}
      {(() => {
        const KANBAN_COLS = [
          { key: 'solicitado',           label: 'Solicitado',           accent: '#94a3b8', labelColor: '#64748b' },
          { key: 'atendimento_iniciado', label: 'F&G em Atendimento',   accent: '#C69C6D', labelColor: '#b8895a' },
          { key: 'aguardando_seguradora',label: 'Aguardando Seguradora',accent: '#1B263B', labelColor: '#1B263B' },
          { key: 'aprovado',             label: 'Aprovado',             accent: '#2d6a4f', labelColor: '#2d6a4f' },
          { key: 'recusado',             label: 'Recusado',             accent: '#9b1c1c', labelColor: '#9b1c1c' },
        ];
        return (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-black text-slate-700 text-sm uppercase tracking-widest">Pipeline de Solicitações</h3>
              <span className="text-xs text-slate-400 font-bold">Arraste para mover entre etapas</span>
            </div>
            <div className="overflow-x-auto pb-1">
            <div className="flex gap-2 pb-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))', gap: '10px' }}>
              {KANBAN_COLS.map(col => {
                // Pending always show; approved/rejected only last 3 days
                const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
                const colCards = clientes.filter(c => {
                  const status = (c as any).kanban_status || 'solicitado';
                  if (status !== col.key) return false;
                  if (['solicitado','atendimento_iniciado','aguardando_seguradora'].includes(status)) return true;
                  return new Date(c.created_at) >= tresDiasAtras;
                });
                const isOver = dragOver === col.key;
                return (
                  <div
                    key={col.key}
                    className="rounded-2xl transition-all"
                    style={{ minWidth: 0, padding: '12px', background: '#fff', border: `1px solid ${isOver ? '#C69C6D' : '#e8e4dc'}`, borderTop: `3px solid ${isOver ? '#C69C6D' : col.accent}`, boxShadow: isOver ? '0 4px 20px rgba(198,156,109,.15)' : 'none' }}
                    onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                    onDrop={e => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('clienteId');
                      if (id) moveCard(id, col.key);
                    }}
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-3">
                      <span style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1.5px', color: col.labelColor }}>{col.label}</span>
                      <span style={{ fontSize: '11px', fontWeight: 900, background: `${col.accent}18`, color: col.labelColor, padding: '2px 8px', borderRadius: '20px', minWidth: '24px', textAlign: 'center' }}>{colCards.length}</span>
                    </div>
                    {/* Cards */}
                    {colCards.length === 0 ? (
                      <div className="text-center py-5" style={{ fontSize: '11px', fontWeight: 700, color: '#c9c2b8', letterSpacing: '.5px' }}>Nenhum</div>
                    ) : (
                      colCards.map(c => {
                        const isDragging = draggingId === c.id;
                        const valorStr = Number((c as any).valor_seguro) > 0 ? fmtBRL(Number((c as any).valor_seguro)) : null;
                        const dataCriacao = new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                        const parceiro = !filterParceiro ? parceiros.find(p => p.id === (c as any).partner_id) : null;
                        return (
                          <div
                            key={c.id}
                            draggable={true}
                            onDragStart={e => { e.dataTransfer.setData('clienteId', c.id); setDraggingId(c.id); }}
                            onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                            onClick={() => openEditStatus(c)}
                            className={`select-none transition-all ${isDragging ? 'opacity-40' : ''}`}
                            style={{ background: '#fafaf8', border: '1px solid #ede9e1', borderRadius: '12px', padding: '12px', marginBottom: '8px', cursor: isDragging ? 'grabbing' : 'grab', boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,.12)' : 'none' }}
                            onMouseEnter={e => { if (!isDragging) { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#C69C6D40'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(27,38,59,.07)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; } }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fafaf8'; (e.currentTarget as HTMLElement).style.borderColor = '#ede9e1'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '5px' }}>
                              <div style={{ fontWeight: 900, fontSize: '12px', color: '#1B263B', lineHeight: 1.3 }}>{c.inquilino_nome}</div>
                              <button
                                onClick={async e => {
                                  e.stopPropagation();
                                  if (!confirm(`Excluir ${c.inquilino_nome} do kanban?`)) return;
                                  await supabase.from('imobiliaria_clientes').delete().eq('id', c.id);
                                  load();
                                }}
                                style={{ marginLeft: '6px', padding: '2px 5px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
                                title="Excluir"
                              >✕</button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8' }}>
                                {(c as any).tipo_seguro === 'residencial_garantia' ? '🏠🔒 + Garantia' : '🏠 Residencial'}
                              </span>
                              {(c as any).intencao === 'contratar' ? (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#f0fdf4', color: '#16a34a', border: '1px solid #c3dfd4', padding: '1px 6px', borderRadius: '20px' }}>✅ Contratar</span>
                              ) : (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#fef9c3', color: '#a16207', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '20px' }}>📋 Cotação</span>
                              )}
                            </div>
                            {parceiro && (
                              <div style={{ fontSize: '10px', fontWeight: 900, color: '#78716c', background: '#f4f1ec', padding: '2px 7px', borderRadius: '8px', display: 'inline-block', marginBottom: '4px' }}>
                                {parceiro.name.replace('Imobiliária ', '')}
                              </div>
                            )}
                            {valorStr && (
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#1B263B' }}>{valorStr}</div>
                            )}
                            <div style={{ fontSize: '9px', color: '#c9c2b8', fontWeight: 600, marginTop: '8px' }}>{dataCriacao}</div>
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {(c as any).doc_contrato_url && (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#f5f7fa', color: '#1B263B', border: '1px solid #dde3ec', padding: '2px 7px', borderRadius: '20px' }}>📎 Docs</span>
                              )}
                              {(c as any).apolice_residencial_url && (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#fdf6ee', color: '#b8895a', border: '1px solid #e8d5bc', padding: '2px 7px', borderRadius: '20px' }}>📄 Apólice</span>
                              )}
                            </div>
                            {col.key === 'aprovado' && onGoToSale && (
                              <button
                                onClick={e => { e.stopPropagation(); onGoToSale({ nome: c.inquilino_nome, telefone: (c as any).telefone || '' }); }}
                                className="mt-2 w-full text-[10px] font-black bg-[#C69C6D] hover:bg-[#b8895a] text-white py-1.5 rounded-lg transition-colors"
                              >
                                → Registro de Venda
                              </button>
                            )}
                            {col.key === 'aprovado' && (c as any).tipo_seguro === 'residencial_garantia' && (
                              <button
                                onClick={async e => {
                                  e.stopPropagation();
                                  const partner = parceiros.find(p => p.id === (c as any).partner_id);
                                  if (!partner) { alert('Parceiro sem email cadastrado.'); return; }
                                  const docsEmFalta = [
                                    !(c as any).doc_contrato_url && 'Contrato de Locação',
                                    !(c as any).doc_termo_vistoria_url && 'Termo de Vistoria',
                                    !(c as any).doc_fotos_vistoria_url && 'Fotos da Vistoria',
                                  ].filter(Boolean);
                                  if (docsEmFalta.length === 0) { alert('Todos os documentos já foram enviados!'); return; }
                                  await supabase.functions.invoke('imobiliaria-solicitar-docs', {
                                    body: {
                                      parceiro_email: (partner as any).email || '',
                                      parceiro_nome: partner.name,
                                      inquilino_nome: c.inquilino_nome,
                                      docs_faltando: docsEmFalta,
                                    },
                                  });
                                  alert(`✅ Email enviado solicitando ${docsEmFalta.length} documento(s).`);
                                }}
                                className="mt-1 w-full text-[10px] font-black bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-lg transition-colors border border-slate-200"
                              >
                                📎 Solicitar Documentos
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        );
      })()}

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
            <p className="text-xs font-bold text-slate-400">Clique em "Avançar Parcela" nos clientes com repasse quando o pagamento for confirmado</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Inquilino</th>
                  {!filterParceiro && <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Parceiro</th>}
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Seguradora</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Nº Apólice</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Seg. Residencial</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Garantia / Docs</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Valor</th>
                  <th className="text-center px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Venc.</th>
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
                    {!filterParceiro && (
                      <td className="px-5 py-4">
                        <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-slate-100 text-slate-600">
                          {parceiros.find(p => p.id === (c as any).partner_id)?.name?.replace('Imobiliária ', '') || '—'}
                        </span>
                      </td>
                    )}
                    <td className="px-5 py-4 text-sm font-bold text-slate-700">{c.seguradora && c.seguradora !== 'Importado' ? c.seguradora : <span className="text-slate-300">—</span>}</td>
                    <td className="px-5 py-4 text-sm font-mono text-slate-500">{c.numero_apolice || <span className="text-slate-300">—</span>}</td>
                    <td className="px-5 py-4">
                      <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${STATUS_COLORS[c.status_residencial || 'aguardando_cotacao'] || 'bg-slate-50 text-slate-500'}`}>
                        {STATUS_LABELS[c.status_residencial || 'aguardando_cotacao']}
                      </span>
                      {c.apolice_residencial_url && <a href={c.apolice_residencial_url} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] font-black text-emerald-600 hover:underline">⬇ Apólice</a>}
                    </td>
                    <td className="px-5 py-4">
                      {c.tipo_seguro === 'residencial_garantia' ? (
                        <div className="space-y-1">
                          <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${STATUS_COLORS[c.status_garantia || 'aguardando_cotacao'] || 'bg-slate-50 text-slate-500'}`}>
                            {STATUS_LABELS[c.status_garantia || 'aguardando_cotacao']}
                          </span>
                          {c.apolice_garantia_url && <a href={c.apolice_garantia_url} target="_blank" rel="noreferrer" className="block text-[10px] font-black text-emerald-600 hover:underline">⬇ Apólice</a>}
                          {/* Documentos */}
                          <div className="flex flex-col gap-0.5 mt-1">
                            {[['doc_contrato_url','Contrato'],['doc_termo_vistoria_url','Vistoria'],['doc_fotos_vistoria_url','Fotos']].map(([key, label]) => (
                              (c as any)[key]
                                ? <a key={key} href={(c as any)[key]} target="_blank" rel="noreferrer" className="text-[10px] font-black text-blue-600 hover:underline">📎 {label}</a>
                                : <span key={key} className="text-[10px] text-slate-300">📎 {label} pendente</span>
                            ))}
                          </div>
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm font-black text-slate-800">{fmtBRL(Number(c.valor_seguro))}</td>
                    <td className="px-5 py-4 text-center">
                      {c.dia_vencimento_aluguel ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">
                          dia {c.dia_vencimento_aluguel}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
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
                        <button onClick={() => openEditStatus(c)}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-black rounded-lg transition-colors"
                          title="Atualizar status e apólice">
                          <Pencil size={12} className="inline mr-1" /> Status
                        </button>
                        {(c as any).is_repasse && (
                          <button
                            onClick={() => avancarParcela(c)}
                            className="px-3 py-1.5 bg-[#C69C6D]/15 hover:bg-[#C69C6D]/30 text-[#C69C6D] text-xs font-black rounded-lg transition-colors"
                            title={c.parcela_atual === c.total_parcelas ? 'Encerrar contrato' : 'Avançar para próxima parcela'}
                          >
                            {c.parcela_atual === c.total_parcelas ? 'Encerrar' : 'Avançar Parcela'}
                          </button>
                        )}
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
    {/* Registrar Repasse Modal */}
    {/* Modal de configuração de repasse para novos clientes do portal */}
    {repasseSetupModal && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-7 space-y-5">
          <div>
            <h3 className="font-black text-slate-800 text-lg">Configurar Repasse</h3>
            <p className="text-slate-500 text-sm mt-1">Cliente novo do portal — configure o repasse antes de aprovar.</p>
          </div>
          <div className="bg-[#1B263B]/5 rounded-xl px-4 py-3 border border-[#C69C6D]/20">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-0.5">Inquilino</p>
            <p className="font-black text-slate-800">{repasseSetupModal.nome}</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor Mensal do Seguro (R$)</label>
              <input
                type="text" placeholder="Ex: 182,49"
                value={repasseSetupForm.valor_seguro}
                onChange={e => setRepasseSetupForm(f => ({ ...f, valor_seguro: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-[#C69C6D]"
              />
              <p className="text-xs text-slate-400">Este valor será cobrado mensalmente no repasse da imobiliária.</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dia de Vencimento do Aluguel</label>
              <div className="flex items-center gap-3">
                <input
                  type="number" min="1" max="28" placeholder="Ex: 20"
                  value={repasseSetupForm.dia_vencimento_aluguel}
                  onChange={e => setRepasseSetupForm(f => ({ ...f, dia_vencimento_aluguel: e.target.value }))}
                  className="w-28 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-[#C69C6D]"
                />
                <p className="text-xs text-slate-400 flex-1">O aviso de repasse será enviado automaticamente 10 dias antes deste dia.</p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Número de Parcelas</label>
              <div className="grid grid-cols-3 gap-2">
                {[6, 12, 24].map(n => (
                  <button key={n} type="button"
                    onClick={() => setRepasseSetupForm(f => ({ ...f, total_parcelas: n }))}
                    className={`py-3 rounded-xl font-black text-sm transition-all ${repasseSetupForm.total_parcelas === n ? 'bg-[#1B263B] text-[#C69C6D]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {n}x
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">A 1ª parcela é paga diretamente pela inquilina. As demais entram no repasse mensal.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={confirmarRepasseSetup}
              disabled={!repasseSetupForm.valor_seguro}
              className="flex-1 py-3 bg-[#C69C6D] hover:bg-[#b8895a] disabled:opacity-50 text-white font-black text-sm rounded-xl transition-all">
              ✅ Aprovar e configurar repasse
            </button>
            <button onClick={() => setRepasseSetupModal(null)}
              className="py-3 px-5 bg-slate-100 text-slate-600 font-black text-sm rounded-xl">
              Cancelar
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {repasseModal && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-slate-800 text-lg">Registrar Repasse</h3>
            <button onClick={() => setRepasseModal(false)}><X size={18} className="text-slate-400" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Mês</label>
              <select value={repasseForm.mes} onChange={e => setRepasseForm(f => ({...f, mes: parseInt(e.target.value)}))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]">
                {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i) =>
                  <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Ano</label>
              <input type="number" value={repasseForm.ano} onChange={e => setRepasseForm(f => ({...f, ano: parseInt(e.target.value)}))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Data do Pagamento</label>
            <input type="date" value={repasseForm.data_pagamento} onChange={e => setRepasseForm(f => ({...f, data_pagamento: e.target.value}))}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Comprovante (PDF ou imagem)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setRepasseFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 file:font-bold file:text-slate-700" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Observações</label>
            <input value={repasseForm.observacoes} onChange={e => setRepasseForm(f => ({...f, observacoes: e.target.value}))}
              placeholder="Opcional" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setRepasseModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm">Cancelar</button>
            <button onClick={salvarRepasse} disabled={savingRepasse}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {savingRepasse ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {savingRepasse ? 'Salvando...' : 'Salvar Repasse'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Edit Status Modal — rendered via portal to escape stacking context */}
    {editingStatus && createPortal(
      <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md my-4">
          {/* Header */}
          <div className="flex items-center justify-between px-7 pt-7 pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-black text-slate-800 text-lg">Atualizar Status</h3>
              <p className="text-sm text-slate-500 mt-0.5">{editingStatus.inquilino_nome}</p>
            </div>
            <button onClick={() => setEditingStatus(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} className="text-slate-400" /></button>
          </div>

          <div className="px-7 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Etapa no Kanban</label>
                <select value={editStatusForm.kanban_status} onChange={e => setEditStatusForm(f => ({...f, kanban_status: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]">
                  <option value="solicitado">📬 Solicitado</option>
                  <option value="atendimento_iniciado">🔄 F&G em atendimento</option>
                  <option value="aguardando_seguradora">⏳ Aguardando Seguradora</option>
                  <option value="aprovado">✅ Aprovado</option>
                  <option value="recusado">❌ Recusado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Situação</label>
                <select value={editStatusForm.status_apolice} onChange={e => setEditStatusForm(f => ({...f, status_apolice: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]">
                  <option value="ativo">🟢 Ativo</option>
                  <option value="pagamento_atrasado">🟡 Pgto. atrasado</option>
                  <option value="em_renovacao">🔵 Em renovação</option>
                  <option value="cancelado">🔴 Cancelado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Vencimento</label>
                <input type="date" value={editStatusForm.vigencia_fim} onChange={e => setEditStatusForm(f => ({...f, vigencia_fim: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
              </div>
            </div>

            {/* Auto-advance hint */}
            {['emitido','aprovado'].includes(editStatusForm.status_residencial) && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 size={13} /> Ao salvar, o card moverá automaticamente para <strong>Aprovado</strong> no kanban
              </div>
            )}

            {/* Seguradora e Apólice */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Seguradora</label>
                <input value={editStatusForm.seguradora} onChange={e => setEditStatusForm(f => ({...f, seguradora: e.target.value}))}
                  placeholder="Ex: Porto Seguro" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D]" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Nº Apólice</label>
                <input value={editStatusForm.numero_apolice} onChange={e => setEditStatusForm(f => ({...f, numero_apolice: e.target.value}))}
                  placeholder="Ex: APL-2026-001" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-[#C69C6D]" />
              </div>
            </div>

            {/* Repasse */}
            <div className="bg-amber-50 rounded-2xl p-4 space-y-3 border border-amber-100">
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Repasse Mensal</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Valor Mensal (R$)</label>
                  <input
                    type="text" placeholder="Ex: 182,49"
                    value={editStatusForm.valor_seguro}
                    onChange={e => setEditStatusForm(f => ({...f, valor_seguro: e.target.value}))}
                    className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-bold focus:outline-none focus:border-[#C69C6D]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Dia Venc. Aluguel</label>
                  <input
                    type="number" min="1" max="28" placeholder="Ex: 20"
                    value={editStatusForm.dia_vencimento_aluguel}
                    onChange={e => setEditStatusForm(f => ({...f, dia_vencimento_aluguel: e.target.value}))}
                    className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-bold focus:outline-none focus:border-[#C69C6D]"
                  />
                </div>
              </div>
              <p className="text-[10px] text-amber-600">Aviso enviado 10 dias antes do vencimento</p>
            </div>

            {/* Apólice Residencial */}
            <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Seguro Residencial</p>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Status</label>
                <select value={editStatusForm.status_residencial} onChange={e => setEditStatusForm(f => ({...f, status_residencial: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-[#C69C6D]">
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">PDF da Apólice</label>
                {editStatusForm.apolice_residencial_url
                  ? <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      <a href={editStatusForm.apolice_residencial_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 hover:underline flex-1 truncate">PDF enviado — clique para ver</a>
                      <button onClick={() => setEditStatusForm(f => ({...f, apolice_residencial_url: ''}))} className="text-slate-400 hover:text-red-400"><X size={13} /></button>
                    </div>
                  : <ApoliceUpload
                      clienteId={editingStatus.id}
                      field="apolice_residencial_url"
                      onUploaded={(url) => setEditStatusForm(f => ({...f, apolice_residencial_url: url}))}
                    />
                }
              </div>
            </div>

            {/* Garantia */}
            {(editingStatus as any).tipo_seguro === 'residencial_garantia' && (
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Garantia de Aluguel</p>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Status</label>
                  <select value={editStatusForm.status_garantia} onChange={e => setEditStatusForm(f => ({...f, status_garantia: e.target.value}))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-[#C69C6D]">
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">PDF da Apólice</label>
                  {editStatusForm.apolice_garantia_url
                    ? <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        <a href={editStatusForm.apolice_garantia_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 hover:underline flex-1 truncate">PDF enviado — clique para ver</a>
                        <button onClick={() => setEditStatusForm(f => ({...f, apolice_garantia_url: ''}))} className="text-slate-400 hover:text-red-400"><X size={13} /></button>
                      </div>
                    : <ApoliceUpload
                        clienteId={editingStatus.id}
                        field="apolice_garantia_url"
                        onUploaded={(url) => setEditStatusForm(f => ({...f, apolice_garantia_url: url}))}
                      />
                  }
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 px-7 pb-7 pt-2">
            <button onClick={() => setEditingStatus(null)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm transition-colors">Cancelar</button>
            <button onClick={saveStatus} className="flex-1 py-2.5 bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl font-bold text-sm transition-colors">Salvar</button>
          </div>
        </div>
        </div>
      </div>,
      document.body
    )}
    </div>
  );
}
