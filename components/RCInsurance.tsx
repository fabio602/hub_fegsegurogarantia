import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Edit2, Trash2, Search, Loader2, Save, X,
  AlertCircle, CheckCircle2, ShieldAlert, FileText, Download, Mail,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';
import { useAutoSave } from '../hooks/useAutoSave.ts';
import SaveIndicator from './SaveIndicator.tsx';

interface RCClient {
  id: number;
  nome: string;
  cpf_cnpj: string;
  nome_contato?: string | null;
  telefone: string;
  telefone_2?: string | null;
  email: string;
  atividade: string;
  tipo_rc: string;
  seguradora: string;
  apolice: string;
  produto: string;
  limite_garantia: string;
  premio_total: string;
  comissao: string;
  data_emissao: string;
  fim_vigencia: string;
  forma_pagamento: string;
  situacao: string;
  obs: string;
  created_at?: string;
}

const EMPTY_FORM: Partial<RCClient> = {
  nome: '', cpf_cnpj: '', nome_contato: '', telefone: '', telefone_2: '', email: '',
  atividade: '', tipo_rc: '',
  seguradora: '', apolice: '', produto: '', limite_garantia: '',
  premio_total: '', comissao: '', data_emissao: '', fim_vigencia: '',
  forma_pagamento: '', situacao: 'Ativo', obs: '',
};

const TIPOS_RC = [
  'RC Profissional', 'RC Empresarial', 'RC Geral', 'D&O',
  'RC Ambiental', 'RC Produtos', 'RC Obras e Serviços', 'E&O',
];
const FORMAS_PAGAMENTO = ['Boleto Mensal', 'Boleto Anual', 'Cartão de Crédito', 'Débito Automático', 'PIX'];
const SITUACOES = ['Lead', 'Ativo', 'Vencido', 'Cancelado', 'Pendente Renovação', 'Em Renovação'];

const SITUACAO_COLORS: Record<string, string> = {
  'Lead': 'bg-blue-100 text-blue-700',
  'Ativo': 'bg-emerald-100 text-emerald-700',
  'Vencido': 'bg-red-100 text-red-700',
  'Cancelado': 'bg-slate-100 text-slate-600',
  'Pendente Renovação': 'bg-amber-100 text-amber-700',
  'Em Renovação': 'bg-purple-100 text-purple-700',
};

const formatPhone = (v: string) =>
  v.replace(/\D/g, '').replace(/(\d{2})(\d)/, '($1) $2')
   .replace(/(\d{5})(\d)/, '$1-$2').replace(/(-\d{4})\d+?$/, '$1');

const formatCurrency = (v: string) => {
  const n = v.replace(/\D/g, '');
  if (!n) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) / 100);
};

const isExpiring = (date: string) => {
  if (!date) return false;
  const diff = (new Date(date).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff <= 30;
};

const isExpired = (date: string) => {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
};

const RC_INPUT_CLS = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all";
const RC_LABEL_CLS = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";
type RCFieldOnChange = React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

const RCInputField: React.FC<{
  formData: Record<string, any>; onChange: RCFieldOnChange;
  id: string; label: string; type?: string; value?: string;
  required?: boolean; placeholder?: string; colSpan?: string;
}> = ({ formData, onChange, id, label, type = 'text', value, required, placeholder, colSpan = '' }) => (
  <div className={colSpan}>
    <label htmlFor={id} className={RC_LABEL_CLS}>{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
    <input id={id} type={type} value={value ?? formData[id] ?? ''} onChange={onChange} placeholder={placeholder} className={RC_INPUT_CLS} />
  </div>
);

const RCSelectField: React.FC<{
  formData: Record<string, any>; onChange: RCFieldOnChange;
  id: string; label: string; options: string[]; required?: boolean; colSpan?: string;
}> = ({ formData, onChange, id, label, options, required, colSpan = '' }) => (
  <div className={colSpan}>
    <label htmlFor={id} className={RC_LABEL_CLS}>{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
    <select id={id} value={formData[id] ?? ''} onChange={onChange} className={RC_INPUT_CLS}>
      <option value="">Selecionar...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const RCInsurance: React.FC = () => {
  const [clients, setClients] = useState<RCClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<RCClient>>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [filterSituacao, setFilterSituacao] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  // Importar Apólice RC com IA
  const [rcExtracting, setRcExtracting] = useState(false);
  const [rcExtractMsg, setRcExtractMsg] = useState('');
  const rcFileRef = useRef<HTMLInputElement>(null);


  const [rcBoletos, setRcBoletos] = useState<{id: number; parcela: number; vencimento: string|null; valor: number|null; url: string; pago: boolean}[]>([]);
  const [rcBoletoForm, setRcBoletoForm] = useState<{parcela: string; vencimento: string; valor: string; file: File|null}>({parcela: '', vencimento: '', valor: '', file: null});
  const [rcBoletoAdding, setRcBoletoAdding] = useState(false);
  const [sendingRcBoletoEmail, setSendingRcBoletoEmail] = useState<number|null>(null);
  const [rcBoletoEmailSent, setRcBoletoEmailSent] = useState<Set<number>>(new Set());

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const topScrollInnerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const table = tableScrollRef.current;
    const top = topScrollRef.current;
    const inner = topScrollInnerRef.current;
    if (!table || !top || !inner) return;
    const syncWidth = () => { inner.style.width = table.scrollWidth + 'px'; };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(table);
    const onTable = () => { top.scrollLeft = table.scrollLeft; };
    const onTop = () => { table.scrollLeft = top.scrollLeft; };
    table.addEventListener('scroll', onTable);
    top.addEventListener('scroll', onTop);
    return () => { table.removeEventListener('scroll', onTable); top.removeEventListener('scroll', onTop); ro.disconnect(); };
  }, []);

  // Só a primeira carga mostra "Carregando...". Esta função também roda ao fim
  // de cada salvamento automático, e piscar a lista a cada 1,2 s de digitação
  // atrapalha quem está preenchendo o formulário logo acima dela.
  const jaCarregouRef = useRef(false);

  const fetchClients = useCallback(async () => {
    if (!jaCarregouRef.current) setLoading(true);
    const { data, error } = await supabase
      .from('rc_clients')
      .select('*')
      .order('id', { ascending: false });
    if (error) console.error('Erro ao buscar clientes RC:', error);
    setClients(data || []);
    jaCarregouRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const fetchRCBoletos = useCallback(async (clientId: number) => {
    const { data } = await supabase.from('rc_boletos').select('*').eq('rc_client_id', clientId).order('parcela');
    setRcBoletos(data || []);
  }, []);

  useEffect(() => { if (editingId) fetchRCBoletos(editingId); else setRcBoletos([]); }, [editingId, fetchRCBoletos]);

  const gravarClienteEmEdicao = useCallback(async (dados: typeof formData) => {
    if (!editingId) return;
    const formData = dados;
    const payload = {
      nome: formData.nome || null,
      cpf_cnpj: formData.cpf_cnpj || null,
      nome_contato: formData.nome_contato?.trim() || null,
      telefone: formData.telefone || null,
      telefone_2: formData.telefone_2?.trim() || null,
      email: formData.email || null,
      atividade: formData.atividade || null,
      tipo_rc: formData.tipo_rc || null,
      seguradora: formData.seguradora || null,
      apolice: formData.apolice || null,
      produto: formData.produto || null,
      limite_garantia: formData.limite_garantia || null,
      premio_total: formData.premio_total || null,
      comissao: formData.comissao || null,
      data_emissao: formData.data_emissao || null,
      fim_vigencia: formData.fim_vigencia || null,
      forma_pagamento: formData.forma_pagamento || null,
      situacao: formData.situacao || 'Ativo',
      obs: formData.obs || null,
    };
    const { error } = await supabase.from('rc_clients').update(payload).eq('id', editingId);
    if (error) throw error;
    fetchClients();
  }, [editingId, fetchClients]);

  const {
    estado: autoSaveState,
    salvarAgora: salvarClienteAgora,
    descartarRascunho,
  } = useAutoSave({
    dados: formData,
    ativo: !!editingId,
    identidade: editingId,
    salvar: gravarClienteEmEdicao,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let { id, value } = e.target;
    if (id === 'telefone' || id === 'telefone_2') value = formatPhone(value);
    if (id === 'premio_total' || id === 'comissao' || id === 'limite_garantia') value = formatCurrency(value);
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleRCExtract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setRcExtracting(true); setRcExtractMsg('');
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((res, rej) => { reader.onload = () => res((reader.result as string).split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file); });
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/extract-policy-data`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey }, body: JSON.stringify({ pdfBase64: b64 }) });
      const json = await res.json();
      if (!json.success || json.data?.parse_error) throw new Error('Não foi possível extrair os dados.');
      const d = json.data;
      setFormData(prev => ({
        ...prev,
        ...(d.tomador_razao_social ? { nome: d.tomador_razao_social } : d.nome_segurado ? { nome: d.nome_segurado } : {}),
        ...(d.tomador_cpf_cnpj ? { cpf_cnpj: d.tomador_cpf_cnpj } : d.cpf_cnpj ? { cpf_cnpj: d.cpf_cnpj } : {}),
        ...(d.email ? { email: d.email } : {}),
        ...(d.telefone ? { telefone: d.telefone } : {}),
        ...(d.numero_apolice ? { apolice: d.numero_apolice } : {}),
        ...(d.seguradora ? { seguradora: d.seguradora } : {}),
        ...(d.modalidade_rc ? { produto: d.modalidade_rc } : d.produto ? { produto: d.produto } : {}),
        ...(d.tipo_rc ? { tipo_rc: d.tipo_rc } : {}),
        ...(d.limite_indenizacao ? { limite_garantia: d.limite_indenizacao } : {}),
        ...(d.premio_total ? { premio_total: d.premio_total } : {}),
        ...(d.comissao ? { comissao: d.comissao } : {}),
        ...(d.vigencia_inicio ? { data_emissao: d.vigencia_inicio } : {}),
        ...(d.vigencia_fim ? { fim_vigencia: d.vigencia_fim } : {}),
        ...(d.forma_pagamento ? { forma_pagamento: d.forma_pagamento } : {}),
      }));
      setRcExtractMsg('✅ Dados extraídos! Confira os campos.');
      setEditingId(null); setShowForm(true);
    } catch (err: any) { setRcExtractMsg('❌ ' + (err.message || 'Erro.')); }
    finally { setRcExtracting(false); if (rcFileRef.current) rcFileRef.current.value = ''; }
  };

  const handleAddRCBoleto = async () => {
    if (!editingId || !rcBoletoForm.parcela || !rcBoletoForm.file) return;
    setRcBoletoAdding(true);
    try {
      const file = rcBoletoForm.file;
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `rc-clients/${editingId}/boletos/parcela-${rcBoletoForm.parcela}.${ext}`;
      await supabase.storage.from('sales-documents').upload(path, file, { contentType: 'application/pdf', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from('sales-documents').getPublicUrl(path);

      const existing = rcBoletos.find(b => b.parcela === parseInt(rcBoletoForm.parcela));
      if (existing) {
        await supabase.from('rc_boletos').update({ url: publicUrl, vencimento: rcBoletoForm.vencimento || null, valor: rcBoletoForm.valor ? parseFloat(rcBoletoForm.valor.replace(/\D/g, '')) / 100 : null }).eq('id', existing.id);
      } else {
        await supabase.from('rc_boletos').insert({ rc_client_id: editingId, parcela: parseInt(rcBoletoForm.parcela), vencimento: rcBoletoForm.vencimento || null, valor: rcBoletoForm.valor ? parseFloat(rcBoletoForm.valor.replace(/\D/g, '')) / 100 : null, url: publicUrl });
      }
      await fetchRCBoletos(editingId);
      setRcBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
    } catch (err) {
      alert('Erro ao adicionar boleto. Tente novamente.');
    } finally {
      setRcBoletoAdding(false);
    }
  };

  const handleToggleRCPago = async (id: number, pago: boolean) => {
    await supabase.from('rc_boletos').update({ pago: !pago }).eq('id', id);
    if (editingId) fetchRCBoletos(editingId);
  };

  const handleDeleteRCBoleto = async (id: number) => {
    if (!window.confirm('Excluir este boleto?')) return;
    await supabase.from('rc_boletos').delete().eq('id', id);
    if (editingId) fetchRCBoletos(editingId);
  };

  const handleSendRCBoletoEmail = async (b: {id: number; parcela: number; vencimento: string|null; url: string}) => {
    if (!formData.email) {
      alert('Este cliente não tem e-mail cadastrado.');
      return;
    }
    setSendingRcBoletoEmail(b.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      await fetch(`${supabaseUrl}/functions/v1/send-boleto-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
        body: JSON.stringify({ toEmail: formData.email, toName: formData.nome, toContato: (formData as any).nome_contato, parcela: b.parcela, vencimento: b.vencimento, boletoUrl: b.url }),
      });
      setRcBoletoEmailSent(prev => new Set([...prev, b.id]));
    } catch {
      alert('Erro ao enviar e-mail.');
    } finally {
      setSendingRcBoletoEmail(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const payload = {
      nome: formData.nome || null,
      cpf_cnpj: formData.cpf_cnpj || null,
      nome_contato: formData.nome_contato?.trim() || null,
      telefone: formData.telefone || null,
      telefone_2: formData.telefone_2?.trim() || null,
      email: formData.email || null,
      atividade: formData.atividade || null,
      tipo_rc: formData.tipo_rc || null,
      seguradora: formData.seguradora || null,
      apolice: formData.apolice || null,
      produto: formData.produto || null,
      limite_garantia: formData.limite_garantia || null,
      premio_total: formData.premio_total || null,
      comissao: formData.comissao || null,
      data_emissao: formData.data_emissao || null,
      fim_vigencia: formData.fim_vigencia || null,
      forma_pagamento: formData.forma_pagamento || null,
      situacao: formData.situacao || 'Ativo',
      obs: formData.obs || null,
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from('rc_clients').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('rc_clients').insert([payload]));
    }

    if (error) {
      setSaveError(error.message);
    } else {
      setSaveSuccess(true);
      setFormData(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      fetchClients();
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  };

  const handleEdit = (c: RCClient) => {
    setFormData({ ...c });
    setEditingId(c.id);
    setShowForm(true);
    setRcBoletos([]);
    setRcBoletoEmailSent(new Set());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from('rc_clients').delete().eq('id', id);
    if (!error) { setDeleteConfirm(null); fetchClients(); }
  };

  const handleCancel = () => {
    descartarRascunho();
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setSaveError(null);
  };

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || [c.nome, c.cpf_cnpj, c.apolice, c.atividade, c.email]
      .some(f => f?.toLowerCase().includes(q));
    const matchSit = !filterSituacao || c.situacao === filterSituacao;
    const matchTipo = !filterTipo || c.tipo_rc === filterTipo;
    return matchSearch && matchSit && matchTipo;
  });

  const stats = {
    total: clients.length,
    ativos: clients.filter(c => c.situacao === 'Ativo').length,
    vencendo: clients.filter(c => isExpiring(c.fim_vigencia)).length,
    vencidos: clients.filter(c => c.situacao === 'Vencido' || isExpired(c.fim_vigencia)).length,
  };

  const rcFd = formData as Record<string, any>;
  const rcOc = handleInputChange;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#1B263B] tracking-tight flex items-center gap-2">
            <ShieldAlert size={22} className="text-[#C69C6D]" /> Responsabilidade Civil
          </h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gestão de apólices e clientes RC</p>
        </div>
        <div className="flex items-center gap-2">
          {rcExtractMsg && <p className="text-xs font-bold mr-2" style={{ color: rcExtractMsg.startsWith('✅') ? '#2d6a4f' : '#dc2626' }}>{rcExtractMsg}</p>}
          <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm cursor-pointer border transition-all ${rcExtracting ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-[#C69C6D]/10 text-[#b8895a] border-[#C69C6D]/30 hover:bg-[#C69C6D]/20'}`}>
            <input ref={rcFileRef} type="file" accept="application/pdf" className="hidden" onChange={handleRCExtract} disabled={rcExtracting} />
            <FileText size={15} />{rcExtracting ? 'Lendo...' : 'Importar Apólice'}
          </label>
          <button onClick={() => { setShowForm(true); setEditingId(null); setFormData(EMPTY_FORM); }} className="flex items-center gap-2 bg-[#1B263B] text-white px-5 py-2.5 rounded-xl font-black text-sm hover:bg-[#243447] transition-all shadow-lg">
            <Plus size={15} /> Novo Cliente
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-700' },
          { label: 'Ativos', value: stats.ativos, color: 'text-emerald-600' },
          { label: 'Vencendo em 30d', value: stats.vencendo, color: 'text-amber-600' },
          { label: 'Vencidos', value: stats.vencidos, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.label}</p>
            <p className={`text-3xl font-black mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Feedback */}
      {saveSuccess && (
        <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-3 rounded-xl text-sm font-bold">
          <CheckCircle2 size={15} /> Salvo com sucesso!
        </div>
      )}
      {saveError && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-xl text-sm font-bold">
          <AlertCircle size={15} /> Erro: {saveError}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-3xl border border-[#C69C6D]/30 shadow-xl overflow-hidden">
          <div className="bg-[#1B263B] px-6 py-4 flex items-center justify-between">
            <h3 className="text-white font-black text-sm flex items-center gap-2">
              <ShieldAlert size={15} /> {editingId ? 'Editar Cliente' : 'Novo Cliente — Responsabilidade Civil'}
            </h3>
            <div className="flex items-center gap-3">
              {editingId && (
                <SaveIndicator estado={autoSaveState} tom="escuro" aoTentarNovamente={salvarClienteAgora} />
              )}
              <button onClick={handleCancel} className="text-slate-400 hover:text-white transition-colors"><X size={16} /></button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">

            {/* Importar Apólice com IA — estado gerenciado no nível do componente */}
            <div className="bg-amber-50 border border-[#C69C6D]/30 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-700">📄 Importar Apólice RC com IA</p>
                <p className="text-xs text-slate-500 mt-0.5">Anexe o PDF e os campos são preenchidos automaticamente</p>
                {rcExtractMsg && <p className="text-xs font-bold mt-1" style={{ color: rcExtractMsg.startsWith('✅') ? '#2d6a4f' : '#dc2626' }}>{rcExtractMsg}</p>}
              </div>
              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm cursor-pointer transition-all shrink-0 ${rcExtracting ? 'bg-slate-100 text-slate-400' : 'bg-[#1B263B] text-[#C69C6D] hover:bg-[#243447]'}`}>
                <input ref={rcFileRef} type="file" accept="application/pdf" className="hidden" onChange={handleRCExtract} disabled={rcExtracting} />
                {rcExtracting ? '⏳ Processando...' : '📤 Anexar PDF'}
              </label>
            </div>

            {/* Dados do Cliente */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados do Cliente / Segurado</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <RCInputField formData={rcFd} onChange={rcOc} id="nome" label="Nome / Razão Social" required colSpan="sm:col-span-2 lg:col-span-2" />
                <RCInputField formData={rcFd} onChange={rcOc} id="nome_contato" label="Nome do Contato / Responsável" placeholder="Ex: João Silva" colSpan="sm:col-span-2 lg:col-span-1" />
                <RCInputField formData={rcFd} onChange={rcOc}id="cpf_cnpj" label="CPF / CNPJ" placeholder="000.000.000-00" />
                <RCInputField formData={rcFd} onChange={rcOc}id="telefone" label="Telefone" placeholder="(00) 00000-0000" />
                <RCInputField formData={rcFd} onChange={rcOc}id="telefone_2" label="Telefone 2" placeholder="(00) 00000-0000" />
                <RCInputField formData={rcFd} onChange={rcOc}id="email" label="E-mail" type="email" />
                <RCInputField formData={rcFd} onChange={rcOc}id="atividade" label="Atividade / Profissão" placeholder="Ex: Médico, Construtora, Advogado..." colSpan="lg:col-span-2" />
                <RCSelectField formData={rcFd} onChange={rcOc}id="tipo_rc" label="Tipo de RC" options={TIPOS_RC} required />
              </div>
            </div>

            {/* Dados da Apólice */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados da Apólice</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <RCInputField formData={rcFd} onChange={rcOc}id="seguradora" label="Seguradora" />
                <RCInputField formData={rcFd} onChange={rcOc}id="apolice" label="Nº Apólice" />
                <RCInputField formData={rcFd} onChange={rcOc}id="produto" label="Produto" />
                <RCInputField formData={rcFd} onChange={rcOc}id="limite_garantia" label="Limite de Garantia" placeholder="R$ 0,00" />
                <RCInputField formData={rcFd} onChange={rcOc}id="premio_total" label="Prêmio Total" placeholder="R$ 0,00" />
                <RCInputField formData={rcFd} onChange={rcOc}id="comissao" label="Comissão" placeholder="R$ 0,00" />
                <RCInputField formData={rcFd} onChange={rcOc}id="data_emissao" label="Data Emissão" type="date" />
                <RCInputField formData={rcFd} onChange={rcOc}id="fim_vigencia" label="Fim Vigência" type="date" />
                <RCSelectField formData={rcFd} onChange={rcOc}id="forma_pagamento" label="Forma de Pagamento" options={FORMAS_PAGAMENTO} />
                <RCSelectField formData={rcFd} onChange={rcOc}id="situacao" label="Situação" options={SITUACOES} required />
              </div>
            </div>

            {/* Observações */}
            <div>
              <label htmlFor="obs" className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Observações</label>
              <textarea
                id="obs"
                rows={3}
                value={formData.obs ?? ''}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all resize-none"
              />
            </div>

            {/* Parcelas / Boletos */}
            {editingId && (
              <div className="border-t border-slate-100 pt-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-4 flex items-center gap-2">
                  <FileText size={12} /> Parcelas / Boletos
                  {!formData.email && <span className="text-amber-500 font-bold normal-case text-[10px]">⚠ Sem e-mail — configure para enviar boletos</span>}
                </p>

                {/* List of boletos */}
                {rcBoletos.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {rcBoletos.map(b => (
                      <div key={b.id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${b.pago ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${b.pago ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>Parcela {b.parcela}</span>
                          {b.vencimento && <span className="text-xs text-slate-500">Venc. {b.vencimento.split('-').reverse().join('/')}</span>}
                          {b.valor && <span className="text-xs font-bold text-slate-700">{new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(b.valor)}</span>}
                          <span className={`text-xs font-black ${b.pago ? 'text-emerald-600' : 'text-red-600'}`}>{b.pago ? '✓ Pago' : '⚠ Em Aberto'}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => handleToggleRCPago(b.id, b.pago)} className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-all ${b.pago ? 'bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                            {b.pago ? 'Marcar Em Aberto' : 'Marcar Pago'}
                          </button>
                          <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-blue-600 hover:text-blue-800">
                            <Download size={12} /> PDF
                          </a>
                          {!b.pago && (
                            <button onClick={() => handleSendRCBoletoEmail(b)} disabled={sendingRcBoletoEmail === b.id} className={`inline-flex items-center gap-1 text-xs font-black px-2 py-1 rounded-lg transition-all ${rcBoletoEmailSent.has(b.id) ? 'bg-emerald-50 text-emerald-600' : 'bg-[#C69C6D]/10 text-[#b8895a] hover:bg-[#C69C6D]/20'}`}>
                              {sendingRcBoletoEmail === b.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                              {rcBoletoEmailSent.has(b.id) ? 'Enviado' : 'E-mail'}
                            </button>
                          )}
                          <button onClick={() => handleDeleteRCBoleto(b.id)} className="p-1 text-slate-300 hover:text-red-500 rounded-lg transition-all"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add boleto form */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Adicionar parcela</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Nº Parcela</label>
                      <input type="number" min="1" value={rcBoletoForm.parcela} onChange={e => setRcBoletoForm(f => ({...f, parcela: e.target.value}))} placeholder="1" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Vencimento</label>
                      <input type="date" value={rcBoletoForm.vencimento} onChange={e => setRcBoletoForm(f => ({...f, vencimento: e.target.value}))} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Valor</label>
                      <input type="text" value={rcBoletoForm.valor} onChange={e => setRcBoletoForm(f => ({...f, valor: e.target.value}))} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">PDF do Boleto</label>
                    <input type="file" accept="application/pdf" onChange={e => setRcBoletoForm(f => ({...f, file: e.target.files?.[0] || null}))} className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-[#1B263B] file:text-[#C69C6D] hover:file:bg-[#243447] cursor-pointer" />
                  </div>
                  <button onClick={handleAddRCBoleto} disabled={rcBoletoAdding || !rcBoletoForm.parcela || !rcBoletoForm.file} className="flex items-center gap-2 bg-[#1B263B] text-[#C69C6D] px-5 py-2.5 rounded-xl font-black text-sm hover:bg-[#243447] disabled:opacity-50 transition-all">
                    {rcBoletoAdding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {rcBoletoAdding ? 'Salvando...' : 'Adicionar Boleto'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {editingId ? (
                <button type="button" onClick={() => handleDelete(editingId)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm text-red-500 hover:bg-red-50 border border-red-200 transition-all">
                  <Trash2 size={14} /> Excluir
                </button>
              ) : <div />}
              <div className="flex gap-3">
                {editingId ? (
                  <button type="button" onClick={handleCancel}
                    className="px-6 py-2.5 rounded-xl font-black text-sm text-slate-500 hover:bg-slate-100 transition-all border border-slate-200">
                    Fechar
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 bg-[#C69C6D] text-white px-6 py-2.5 rounded-xl font-black text-sm hover:bg-[#b58a5b] disabled:opacity-50 transition-all shadow-lg"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome, CPF/CNPJ, apólice, atividade..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all"
          />
        </div>
        <select
          value={filterSituacao}
          onChange={e => setFilterSituacao(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all"
        >
          <option value="">Todas situações</option>
          {SITUACOES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterTipo}
          onChange={e => setFilterTipo(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all"
        >
          <option value="">Todos tipos RC</option>
          {TIPOS_RC.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div ref={topScrollRef} className="overflow-x-auto overflow-y-hidden h-3">
          <div ref={topScrollInnerRef} className="h-1" />
        </div>

        {/* Mobile cards */}
        <div className="lg:hidden divide-y divide-slate-50">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 size={24} className="animate-spin mr-2" /> Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">Nenhum cliente encontrado</div>
          ) : filtered.map(c => {
            const expiring = isExpiring(c.fim_vigencia);
            const expired = isExpired(c.fim_vigencia);
            return (
              <div key={c.id} onClick={() => handleEdit(c)}
                className={`p-4 cursor-pointer transition-colors active:bg-[#C69C6D]/10 ${editingId === c.id ? 'bg-[#C69C6D]/10 border-l-4 border-[#C69C6D]' : 'hover:bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-black text-slate-800 text-sm">{c.nome}</p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black ${SITUACAO_COLORS[c.situacao] ?? 'bg-slate-100 text-slate-600'}`}>{c.situacao}</span>
                </div>
                <p className="text-xs text-slate-500 mb-1">{c.cpf_cnpj} {c.tipo_rc && <span className="ml-2 px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-bold">{c.tipo_rc}</span>}</p>
                <div className="flex gap-3 text-xs text-slate-400 flex-wrap">
                  {c.apolice && <span>Apólice {c.apolice}</span>}
                  {c.fim_vigencia && <span className={expired ? 'text-red-500 font-bold' : expiring ? 'text-amber-500 font-bold' : ''}>{new Date(c.fim_vigencia + 'T12:00:00').toLocaleDateString('pt-BR')}</span>}
                  {c.premio_total && <span className="font-bold text-slate-600">{c.premio_total}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div ref={tableScrollRef} className="hidden lg:block overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-slate-400">
              <Loader2 size={28} className="animate-spin mr-3" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <ShieldAlert size={40} className="mb-4 opacity-30" />
              <p className="font-bold text-sm">Nenhum cliente encontrado</p>
              <p className="text-xs mt-1">Adicione o primeiro cliente de responsabilidade civil</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  {['Cliente', 'CPF/CNPJ', 'Contato', 'Tipo RC', 'Atividade', 'Apólice', 'Limite', 'Prêmio', 'Comissão', 'Fim Vigência', 'Situação', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const expiring = isExpiring(c.fim_vigencia);
                  const expired = isExpired(c.fim_vigencia);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => handleEdit(c)}
                      className={`border-b border-slate-50 transition-all cursor-pointer ${editingId === c.id ? 'bg-[#C69C6D]/10 border-l-2 border-l-[#C69C6D]' : i % 2 === 0 ? 'bg-white hover:bg-[#C69C6D]/5' : 'bg-slate-50/30 hover:bg-[#C69C6D]/5'}`}
                    >
                      <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap hover:text-[#C69C6D] transition-colors">{c.nome || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.cpf_cnpj || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.telefone ? <WhatsAppPhoneLink phone={c.telefone} name={c.nome} /> : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-violet-100 text-violet-700">
                          {c.tipo_rc || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap max-w-[180px] truncate">{c.atividade || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.apolice || '—'}</td>
                      <td className="px-4 py-3 text-slate-700 font-bold whitespace-nowrap">{c.limite_garantia || '—'}</td>
                      <td className="px-4 py-3 text-slate-700 font-bold whitespace-nowrap">{c.premio_total || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.comissao || '—'}</td>
                      <td className={`px-4 py-3 font-bold whitespace-nowrap ${expired ? 'text-red-600' : expiring ? 'text-amber-600' : 'text-slate-600'}`}>
                        {c.fim_vigencia ? new Date(c.fim_vigencia + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                        {expiring && !expired && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-black">VENCE</span>}
                        {expired && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-black">VENCIDO</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${SITUACAO_COLORS[c.situacao] ?? 'bg-slate-100 text-slate-600'}`}>
                          {c.situacao}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {deleteConfirm === c.id ? (
                          <div className="flex items-center gap-1 bg-red-50 rounded-lg px-2 py-1">
                            <span className="text-[10px] text-red-600 font-black">Excluir?</span>
                            <button onClick={() => handleDelete(c.id)} className="text-red-600 hover:text-red-800 text-[10px] font-black">Sim</button>
                            <button onClick={() => setDeleteConfirm(null)} className="text-slate-400 text-[10px] font-black">Não</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(c.id)} className="p-1.5 text-slate-200 hover:text-red-400 hover:bg-red-50 rounded-lg transition-all" title="Excluir">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-100 text-[11px] text-slate-400 font-bold">
            {filtered.length} de {clients.length} registros
          </div>
        )}
      </div>
    </div>
  );
};

export default RCInsurance;
