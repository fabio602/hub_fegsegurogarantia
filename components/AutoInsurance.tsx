import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Edit2, Trash2, Search, Loader2, Save, X,
  AlertCircle, CheckCircle2, Car, ChevronDown, ChevronUp, FileText, Download, Mail,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';
import { useAutoSave } from '../hooks/useAutoSave.ts';
import SaveIndicator from './SaveIndicator.tsx';

interface AutoClient {
  id: number;
  nome: string;
  cpf: string;
  telefone: string;
  telefone_2?: string | null;
  email: string;
  marca_modelo: string;
  ano_fabricacao: string;
  ano_modelo: string;
  placa: string;
  chassis: string;
  cor: string;
  uso_veiculo: string;
  seguradora: string;
  apolice: string;
  produto: string;
  cobertura: string;
  franquia: string;
  premio_total: string;
  comissao: string;
  data_emissao: string;
  fim_vigencia: string;
  forma_pagamento: string;
  situacao: string;
  obs: string;
  created_at?: string;
}

const EMPTY_FORM: Partial<AutoClient> = {
  nome: '', cpf: '', telefone: '', telefone_2: '', email: '',
  marca_modelo: '', ano_fabricacao: '', ano_modelo: '', placa: '', chassis: '', cor: '', uso_veiculo: '',
  seguradora: '', apolice: '', produto: '', cobertura: '', franquia: '',
  premio_total: '', comissao: '', data_emissao: '', fim_vigencia: '',
  forma_pagamento: '', situacao: 'Ativo', obs: '',
};

const COBERTURAS = ['Básica', 'Intermediária', 'Completa', 'Terceiros'];
const USOS = ['Particular', 'Comercial Leve', 'Táxi/Aplicativo', 'Moto'];
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

const formatCPF = (v: string) =>
  v.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2')
   .replace(/(\d{3})(\d{1,2})/, '$1-$2').replace(/(-\d{2})\d+?$/, '$1');

const formatPhone = (v: string) =>
  v.replace(/\D/g, '').replace(/(\d{2})(\d)/, '($1) $2')
   .replace(/(\d{5})(\d)/, '$1-$2').replace(/(-\d{4})\d+?$/, '$1');

const formatPlate = (v: string) =>
  v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);

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

const INPUT_CLS = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all";
const LABEL_CLS = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";

type FieldonChange = React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

const InputField: React.FC<{
  formData: Record<string, any>; onChange: FieldonChange;
  id: string; label: string; type?: string; value?: string;
  required?: boolean; placeholder?: string; colSpan?: string;
}> = ({ formData, onChange, id, label, type = 'text', value, required, placeholder, colSpan = '' }) => (
  <div className={colSpan}>
    <label htmlFor={id} className={LABEL_CLS}>{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
    <input id={id} type={type} value={value ?? formData[id] ?? ''} onChange={onChange} placeholder={placeholder} className={INPUT_CLS} />
  </div>
);

const SelectField: React.FC<{
  formData: Record<string, any>; onChange: FieldonChange;
  id: string; label: string; options: string[]; required?: boolean; colSpan?: string;
}> = ({ formData, onChange, id, label, options, required, colSpan = '' }) => (
  <div className={colSpan}>
    <label htmlFor={id} className={LABEL_CLS}>{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
    <select id={id} value={formData[id] ?? ''} onChange={onChange} className={INPUT_CLS}>
      <option value="">Selecionar...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const AutoInsurance: React.FC = () => {
  const [clients, setClients] = useState<AutoClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<AutoClient>>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [filterSituacao, setFilterSituacao] = useState('');
  const [filterCobertura, setFilterCobertura] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [autoExtracting, setAutoExtracting] = useState(false);
  const [autoExtractMsg, setAutoExtractMsg] = useState('');
  const autoFileRef = useRef<HTMLInputElement>(null);


  const [autoBoletos, setAutoBoletos] = useState<{id: number; parcela: number; vencimento: string|null; valor: number|null; url: string; pago: boolean}[]>([]);
  const [autoBoletoForm, setAutoBoletoForm] = useState<{parcela: string; vencimento: string; valor: string; file: File|null}>({parcela: '', vencimento: '', valor: '', file: null});
  const [autoBoletoAdding, setAutoBoletoAdding] = useState(false);
  const [sendingAutoBoletoEmail, setSendingAutoBoletoEmail] = useState<number|null>(null);
  const [autoBoletoEmailSent, setAutoBoletoEmailSent] = useState<Set<number>>(new Set());

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
      .from('auto_clients')
      .select('*')
      .order('id', { ascending: false });
    if (error) console.error('Erro ao buscar clientes:', error);
    setClients(data || []);
    jaCarregouRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const fetchAutoBoletos = useCallback(async (clientId: number) => {
    const { data } = await supabase.from('auto_boletos').select('*').eq('auto_client_id', clientId).order('parcela');
    setAutoBoletos(data || []);
  }, []);

  useEffect(() => { if (editingId) fetchAutoBoletos(editingId); else setAutoBoletos([]); }, [editingId, fetchAutoBoletos]);

  const gravarClienteEmEdicao = useCallback(async (dados: typeof formData) => {
    if (!editingId) return;
    const formData = dados;
    const payload = {
      nome: formData.nome || null,
      cpf: formData.cpf || null,
      telefone: formData.telefone || null,
      telefone_2: formData.telefone_2?.trim() || null,
      email: formData.email || null,
      marca_modelo: formData.marca_modelo || null,
      ano_fabricacao: formData.ano_fabricacao || null,
      ano_modelo: formData.ano_modelo || null,
      placa: formData.placa || null,
      chassis: formData.chassis || null,
      cor: formData.cor || null,
      uso_veiculo: formData.uso_veiculo || null,
      seguradora: formData.seguradora || null,
      apolice: formData.apolice || null,
      produto: formData.produto || null,
      cobertura: formData.cobertura || null,
      franquia: formData.franquia || null,
      premio_total: formData.premio_total || null,
      comissao: formData.comissao || null,
      data_emissao: formData.data_emissao || null,
      fim_vigencia: formData.fim_vigencia || null,
      forma_pagamento: formData.forma_pagamento || null,
      situacao: formData.situacao || 'Ativo',
      obs: formData.obs || null,
    };
    const { error } = await supabase.from('auto_clients').update(payload).eq('id', editingId);
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
    if (id === 'cpf') value = formatCPF(value);
    if (id === 'telefone' || id === 'telefone_2') value = formatPhone(value);
    if (id === 'placa') value = formatPlate(value);
    if (id === 'premio_total' || id === 'comissao') value = formatCurrency(value);
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleAutoExtract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAutoExtracting(true);
    setAutoExtractMsg('');
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((res, rej) => {
        reader.onload = () => res((reader.result as string).split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/extract-policy-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
        body: JSON.stringify({ pdfBase64: b64 }),
      });
      const json = await res.json();
      if (!json.success || json.data?.parse_error) throw new Error('Não foi possível extrair os dados. Verifique se é uma apólice Auto.');
      const d = json.data;
      setFormData(prev => ({
        ...prev,
        ...(d.tomador_razao_social ? { nome: d.tomador_razao_social } : d.nome_segurado ? { nome: d.nome_segurado } : {}),
        ...(d.tomador_cpf_cnpj ? { cpf: d.tomador_cpf_cnpj } : d.cpf_cnpj ? { cpf: d.cpf_cnpj } : {}),
        ...(d.email ? { email: d.email } : {}),
        ...(d.telefone ? { telefone: d.telefone } : {}),
        ...(d.numero_apolice ? { apolice: d.numero_apolice } : {}),
        ...(d.seguradora ? { seguradora: d.seguradora } : {}),
        ...(d.produto ? { produto: d.produto } : {}),
        ...(d.premio_total ? { premio_total: d.premio_total } : {}),
        ...(d.comissao ? { comissao: d.comissao } : {}),
        ...(d.vigencia_inicio ? { data_emissao: d.vigencia_inicio } : {}),
        ...(d.vigencia_fim ? { fim_vigencia: d.vigencia_fim } : {}),
        ...(d.forma_pagamento ? { forma_pagamento: d.forma_pagamento } : {}),
        ...(d.placa ? { placa: d.placa } : {}),
        ...(d.modelo ? { marca_modelo: d.modelo } : {}),
        ...(d.ano ? { ano_fabricacao: d.ano, ano_modelo: d.ano } : {}),
      }));
      setEditingId(null);
      setShowForm(true);
      setAutoExtractMsg('✅ Dados extraídos com sucesso! Confira os campos destacados.');
    } catch (err: any) {
      setAutoExtractMsg('❌ ' + (err.message || 'Erro ao processar PDF.'));
      alert('Erro ao extrair apólice: ' + (err.message || 'Tente novamente.'));
    } finally {
      setAutoExtracting(false);
      if (autoFileRef.current) autoFileRef.current.value = '';
    }
  };

  const handleAddAutoBoleto = async () => {
    if (!editingId || !autoBoletoForm.parcela || !autoBoletoForm.file) return;
    setAutoBoletoAdding(true);
    try {
      const file = autoBoletoForm.file;
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `auto-clients/${editingId}/boletos/parcela-${autoBoletoForm.parcela}.${ext}`;
      await supabase.storage.from('sales-documents').upload(path, file, { contentType: 'application/pdf', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from('sales-documents').getPublicUrl(path);

      const existing = autoBoletos.find(b => b.parcela === parseInt(autoBoletoForm.parcela));
      if (existing) {
        await supabase.from('auto_boletos').update({ url: publicUrl, vencimento: autoBoletoForm.vencimento || null, valor: autoBoletoForm.valor ? parseFloat(autoBoletoForm.valor.replace(/\D/g, '')) / 100 : null }).eq('id', existing.id);
      } else {
        await supabase.from('auto_boletos').insert({ auto_client_id: editingId, parcela: parseInt(autoBoletoForm.parcela), vencimento: autoBoletoForm.vencimento || null, valor: autoBoletoForm.valor ? parseFloat(autoBoletoForm.valor.replace(/\D/g, '')) / 100 : null, url: publicUrl });
      }
      await fetchAutoBoletos(editingId);
      setAutoBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
    } catch (err) {
      alert('Erro ao adicionar boleto. Tente novamente.');
    } finally {
      setAutoBoletoAdding(false);
    }
  };

  const handleToggleAutoPago = async (id: number, pago: boolean) => {
    await supabase.from('auto_boletos').update({ pago: !pago }).eq('id', id);
    if (editingId) fetchAutoBoletos(editingId);
  };

  const handleDeleteAutoBoleto = async (id: number) => {
    if (!window.confirm('Excluir este boleto?')) return;
    await supabase.from('auto_boletos').delete().eq('id', id);
    if (editingId) fetchAutoBoletos(editingId);
  };

  const handleSendAutoBoletoEmail = async (b: {id: number; parcela: number; vencimento: string|null; url: string}) => {
    if (!formData.email) {
      alert('Este cliente não tem e-mail cadastrado.');
      return;
    }
    setSendingAutoBoletoEmail(b.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      await fetch(`${supabaseUrl}/functions/v1/send-boleto-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
        body: JSON.stringify({ toEmail: formData.email, toName: formData.nome, parcela: b.parcela, vencimento: b.vencimento, boletoUrl: b.url, tipoProduto: 'Seguro AUTO' }),
      });
      setAutoBoletoEmailSent(prev => new Set([...prev, b.id]));
    } catch {
      alert('Erro ao enviar e-mail.');
    } finally {
      setSendingAutoBoletoEmail(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const payload = {
      nome: formData.nome || null,
      cpf: formData.cpf || null,
      telefone: formData.telefone || null,
      telefone_2: formData.telefone_2?.trim() || null,
      email: formData.email || null,
      marca_modelo: formData.marca_modelo || null,
      ano_fabricacao: formData.ano_fabricacao || null,
      ano_modelo: formData.ano_modelo || null,
      placa: formData.placa || null,
      chassis: formData.chassis || null,
      cor: formData.cor || null,
      uso_veiculo: formData.uso_veiculo || null,
      seguradora: formData.seguradora || null,
      apolice: formData.apolice || null,
      produto: formData.produto || null,
      cobertura: formData.cobertura || null,
      franquia: formData.franquia || null,
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
      ({ error } = await supabase.from('auto_clients').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('auto_clients').insert([payload]));
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

  const handleEdit = (c: AutoClient) => {
    setFormData({ ...c });
    setEditingId(c.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from('auto_clients').delete().eq('id', id);
    if (!error) { setDeleteConfirm(null); fetchClients(); }
  };

  const handleCancel = () => {
    descartarRascunho();
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setSaveError(null);
    setAutoBoletos([]);
    setAutoBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
    setAutoBoletoEmailSent(new Set());
  };

  const filtered = clients.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || [c.nome, c.placa, c.marca_modelo, c.apolice, c.cpf, c.email]
      .some(f => f?.toLowerCase().includes(q));
    const matchSit = !filterSituacao || c.situacao === filterSituacao;
    const matchCob = !filterCobertura || c.cobertura === filterCobertura;
    return matchSearch && matchSit && matchCob;
  });

  const stats = {
    total: clients.length,
    ativos: clients.filter(c => c.situacao === 'Ativo').length,
    vencendo: clients.filter(c => isExpiring(c.fim_vigencia)).length,
    vencidos: clients.filter(c => c.situacao === 'Vencido' || isExpired(c.fim_vigencia)).length,
  };

  const fd = formData as Record<string, any>;
  const oc = handleInputChange;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#1B263B] tracking-tight flex items-center gap-2">
            <Car size={22} className="text-[#C69C6D]" /> Seguro AUTO
          </h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gestão de apólices e clientes</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Importar Apólice com IA — no cabeçalho */}
          <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm cursor-pointer border transition-all ${autoExtracting ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-[#C69C6D]/10 text-[#b8895a] border-[#C69C6D]/30 hover:bg-[#C69C6D]/20'}`} title="Importar apólice com IA">
            <input ref={autoFileRef} type="file" accept="application/pdf" className="hidden" onChange={handleAutoExtract} disabled={autoExtracting} />
            <FileText size={15} />
            {autoExtracting ? 'Lendo...' : 'Importar Apólice'}
          </label>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setFormData(EMPTY_FORM); }}
            className="flex items-center gap-2 bg-[#1B263B] text-white px-5 py-2.5 rounded-xl font-black text-sm hover:bg-[#243447] transition-all shadow-lg"
          >
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
              <Car size={15} /> {editingId ? 'Editar Cliente' : 'Novo Cliente — Seguro AUTO'}
            </h3>
            <div className="flex items-center gap-3">
              {editingId && (
                <SaveIndicator estado={autoSaveState} tom="escuro" aoTentarNovamente={salvarClienteAgora} />
              )}
              <button onClick={handleCancel} className="text-slate-400 hover:text-white transition-colors"><X size={16} /></button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">

            {/* Importar Apólice com IA */}
            <div className="bg-amber-50 border border-[#C69C6D]/30 rounded-2xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-700">📄 Importar Apólice com IA</p>
                <p className="text-xs text-slate-500 mt-0.5">Anexe o PDF e os campos são preenchidos automaticamente</p>
                {autoExtractMsg && <p className="text-xs font-bold mt-1" style={{ color: autoExtractMsg.startsWith('✅') ? '#2d6a4f' : '#dc2626' }}>{autoExtractMsg}</p>}
              </div>
              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm cursor-pointer transition-all shrink-0 ${autoExtracting ? 'bg-slate-100 text-slate-400' : 'bg-[#1B263B] text-[#C69C6D] hover:bg-[#243447]'}`}>
                <input ref={autoFileRef} type="file" accept="application/pdf" className="hidden" onChange={handleAutoExtract} disabled={autoExtracting} />
                {autoExtracting ? '⏳ Processando...' : '📤 Anexar PDF'}
              </label>
            </div>

            {/* Dados do Cliente */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados do Cliente</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <InputField formData={fd} onChange={oc}id="nome" label="Nome Completo" required colSpan="sm:col-span-2 lg:col-span-2" />
                <InputField formData={fd} onChange={oc}id="cpf" label="CPF" placeholder="000.000.000-00" />
                <InputField formData={fd} onChange={oc}id="telefone" label="Telefone" placeholder="(00) 00000-0000" />
                <InputField formData={fd} onChange={oc}id="telefone_2" label="Telefone 2" placeholder="(00) 00000-0000" />
                <InputField formData={fd} onChange={oc}id="email" label="E-mail" type="email" />
              </div>
            </div>

            {/* Dados do Veículo */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados do Veículo</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <InputField formData={fd} onChange={oc}id="marca_modelo" label="Marca / Modelo" placeholder="Ex: Fiat Pulse" colSpan="lg:col-span-2" />
                <InputField formData={fd} onChange={oc}id="ano_fabricacao" label="Ano Fabricação" placeholder="2023" />
                <InputField formData={fd} onChange={oc}id="ano_modelo" label="Ano Modelo" placeholder="2024" />
                <InputField formData={fd} onChange={oc}id="placa" label="Placa" placeholder="ABC1234" />
                <InputField formData={fd} onChange={oc}id="chassis" label="Chassi" />
                <InputField formData={fd} onChange={oc}id="cor" label="Cor" />
                <SelectField formData={fd} onChange={oc}id="uso_veiculo" label="Uso do Veículo" options={USOS} />
              </div>
            </div>

            {/* Dados da Apólice */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados da Apólice</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <InputField formData={fd} onChange={oc}id="seguradora" label="Seguradora" />
                <InputField formData={fd} onChange={oc}id="apolice" label="Nº Apólice" />
                <InputField formData={fd} onChange={oc}id="produto" label="Produto" />
                <SelectField formData={fd} onChange={oc}id="cobertura" label="Cobertura" options={COBERTURAS} />
                <InputField formData={fd} onChange={oc}id="franquia" label="Franquia" placeholder="Ex: Básica / R$ 2.500" />
                <InputField formData={fd} onChange={oc}id="premio_total" label="Prêmio Total" placeholder="R$ 0,00" />
                <InputField formData={fd} onChange={oc}id="comissao" label="Comissão" placeholder="R$ 0,00" />
                <InputField formData={fd} onChange={oc}id="data_emissao" label="Data Emissão" type="date" />
                <InputField formData={fd} onChange={oc}id="fim_vigencia" label="Fim Vigência" type="date" />
                <SelectField formData={fd} onChange={oc}id="forma_pagamento" label="Forma de Pagamento" options={FORMAS_PAGAMENTO} />
                <SelectField formData={fd} onChange={oc}id="situacao" label="Situação" options={SITUACOES} required />
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
                {autoBoletos.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {autoBoletos.map(b => (
                      <div key={b.id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${b.pago ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${b.pago ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>Parcela {b.parcela}</span>
                          {b.vencimento && <span className="text-xs text-slate-500">Venc. {b.vencimento.split('-').reverse().join('/')}</span>}
                          {b.valor && <span className="text-xs font-bold text-slate-700">{new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(b.valor)}</span>}
                          <span className={`text-xs font-black ${b.pago ? 'text-emerald-600' : 'text-red-600'}`}>{b.pago ? '✓ Pago' : '⚠ Em Aberto'}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => handleToggleAutoPago(b.id, b.pago)} className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-all ${b.pago ? 'bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                            {b.pago ? 'Marcar Em Aberto' : 'Marcar Pago'}
                          </button>
                          <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-blue-600 hover:text-blue-800">
                            <Download size={12} /> PDF
                          </a>
                          {!b.pago && (
                            <button onClick={() => handleSendAutoBoletoEmail(b)} disabled={sendingAutoBoletoEmail === b.id} className={`inline-flex items-center gap-1 text-xs font-black px-2 py-1 rounded-lg transition-all ${autoBoletoEmailSent.has(b.id) ? 'bg-emerald-50 text-emerald-600' : 'bg-[#C69C6D]/10 text-[#b8895a] hover:bg-[#C69C6D]/20'}`}>
                              {sendingAutoBoletoEmail === b.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                              {autoBoletoEmailSent.has(b.id) ? 'Enviado' : 'E-mail'}
                            </button>
                          )}
                          <button onClick={() => handleDeleteAutoBoleto(b.id)} className="p-1 text-slate-300 hover:text-red-500 rounded-lg transition-all"><Trash2 size={13} /></button>
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
                      <input type="number" min="1" value={autoBoletoForm.parcela} onChange={e => setAutoBoletoForm(f => ({...f, parcela: e.target.value}))} placeholder="1" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Vencimento</label>
                      <input type="date" value={autoBoletoForm.vencimento} onChange={e => setAutoBoletoForm(f => ({...f, vencimento: e.target.value}))} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Valor</label>
                      <input type="text" value={autoBoletoForm.valor} onChange={e => setAutoBoletoForm(f => ({...f, valor: e.target.value}))} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#C69C6D] transition-all" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">PDF do Boleto</label>
                    <input type="file" accept="application/pdf" onChange={e => setAutoBoletoForm(f => ({...f, file: e.target.files?.[0] || null}))} className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-[#1B263B] file:text-[#C69C6D] hover:file:bg-[#243447] cursor-pointer" />
                  </div>
                  <button onClick={handleAddAutoBoleto} disabled={autoBoletoAdding || !autoBoletoForm.parcela || !autoBoletoForm.file} className="flex items-center gap-2 bg-[#1B263B] text-[#C69C6D] px-5 py-2.5 rounded-xl font-black text-sm hover:bg-[#243447] disabled:opacity-50 transition-all">
                    {autoBoletoAdding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {autoBoletoAdding ? 'Salvando...' : 'Adicionar Boleto'}
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
            placeholder="Buscar por nome, placa, apólice, CPF..."
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
          value={filterCobertura}
          onChange={e => setFilterCobertura(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all"
        >
          <option value="">Todas coberturas</option>
          {COBERTURAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Dual scroll bar */}
        <div ref={topScrollRef} className="overflow-x-auto overflow-y-hidden h-3">
          <div ref={topScrollInnerRef} className="h-1" />
        </div>

        <div ref={tableScrollRef} className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-slate-400">
              <Loader2 size={28} className="animate-spin mr-3" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <Car size={40} className="mb-4 opacity-30" />
              <p className="font-bold text-sm">Nenhum cliente encontrado</p>
              <p className="text-xs mt-1">Adicione o primeiro cliente de seguro auto</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  {['Cliente', 'CPF', 'Contato', 'Veículo', 'Placa', 'Cobertura', 'Apólice', 'Prêmio', 'Comissão', 'Fim Vigência', 'Situação', 'Ações'].map(h => (
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
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{c.cpf || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.telefone ? <WhatsAppPhoneLink phone={c.telefone} name={c.nome} /> : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{[c.marca_modelo, c.ano_modelo].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">{c.placa || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.cobertura || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.apolice || '—'}</td>
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
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEdit(c)}
                            className="p-1.5 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"
                            title="Editar"
                          >
                            <Edit2 size={13} />
                          </button>
                          {deleteConfirm === c.id ? (
                            <div className="flex items-center gap-1 bg-red-50 rounded-lg px-2 py-1">
                              <span className="text-[10px] text-red-600 font-black">Confirmar?</span>
                              <button onClick={() => handleDelete(c.id)} className="text-red-600 hover:text-red-800 text-[10px] font-black">Sim</button>
                              <button onClick={() => setDeleteConfirm(null)} className="text-slate-400 hover:text-slate-600 text-[10px] font-black">Não</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(c.id)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title="Excluir"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
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

export default AutoInsurance;
