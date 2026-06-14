import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Edit2, Trash2, Search, Loader2, Save, X,
  AlertCircle, CheckCircle2, Car, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';

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

  const fetchClients = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('auto_clients')
      .select('*')
      .order('id', { ascending: false });
    if (error) console.error('Erro ao buscar clientes:', error);
    setClients(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let { id, value } = e.target;
    if (id === 'cpf') value = formatCPF(value);
    if (id === 'telefone' || id === 'telefone_2') value = formatPhone(value);
    if (id === 'placa') value = formatPlate(value);
    if (id === 'premio_total' || id === 'comissao') value = formatCurrency(value);
    setFormData(prev => ({ ...prev, [id]: value }));
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
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setSaveError(null);
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

  const InputField: React.FC<{
    id: string; label: string; type?: string; value?: string;
    required?: boolean; placeholder?: string; colSpan?: string;
  }> = ({ id, label, type = 'text', value, required, placeholder, colSpan = '' }) => (
    <div className={colSpan}>
      <label htmlFor={id} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      <input
        id={id} type={type} value={value ?? (formData as any)[id] ?? ''}
        onChange={handleInputChange}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all"
      />
    </div>
  );

  const SelectField: React.FC<{ id: string; label: string; options: string[]; required?: boolean; colSpan?: string }> = ({ id, label, options, required, colSpan = '' }) => (
    <div className={colSpan}>
      <label htmlFor={id} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      <select
        id={id} value={(formData as any)[id] ?? ''}
        onChange={handleInputChange}
        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#C69C6D]/40 focus:border-[#C69C6D] transition-all"
      >
        <option value="">Selecionar...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

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
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setFormData(EMPTY_FORM); }}
          className="flex items-center gap-2 bg-[#1B263B] text-white px-5 py-2.5 rounded-xl font-black text-sm hover:bg-[#243347] transition-all shadow-lg"
        >
          <Plus size={15} /> Novo Cliente
        </button>
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
            <button onClick={handleCancel} className="text-slate-400 hover:text-white transition-colors"><X size={16} /></button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Dados do Cliente */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados do Cliente</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <InputField id="nome" label="Nome Completo" required colSpan="sm:col-span-2 lg:col-span-2" />
                <InputField id="cpf" label="CPF" placeholder="000.000.000-00" />
                <InputField id="telefone" label="Telefone" placeholder="(00) 00000-0000" />
                <InputField id="telefone_2" label="Telefone 2" placeholder="(00) 00000-0000" />
                <InputField id="email" label="E-mail" type="email" />
              </div>
            </div>

            {/* Dados do Veículo */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados do Veículo</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <InputField id="marca_modelo" label="Marca / Modelo" placeholder="Ex: Fiat Pulse" colSpan="lg:col-span-2" />
                <InputField id="ano_fabricacao" label="Ano Fabricação" placeholder="2023" />
                <InputField id="ano_modelo" label="Ano Modelo" placeholder="2024" />
                <InputField id="placa" label="Placa" placeholder="ABC1234" />
                <InputField id="chassis" label="Chassi" />
                <InputField id="cor" label="Cor" />
                <SelectField id="uso_veiculo" label="Uso do Veículo" options={USOS} />
              </div>
            </div>

            {/* Dados da Apólice */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mb-3">Dados da Apólice</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <InputField id="seguradora" label="Seguradora" />
                <InputField id="apolice" label="Nº Apólice" />
                <InputField id="produto" label="Produto" />
                <SelectField id="cobertura" label="Cobertura" options={COBERTURAS} />
                <InputField id="franquia" label="Franquia" placeholder="Ex: Básica / R$ 2.500" />
                <InputField id="premio_total" label="Prêmio Total" placeholder="R$ 0,00" />
                <InputField id="comissao" label="Comissão" placeholder="R$ 0,00" />
                <InputField id="data_emissao" label="Data Emissão" type="date" />
                <InputField id="fim_vigencia" label="Fim Vigência" type="date" />
                <SelectField id="forma_pagamento" label="Forma de Pagamento" options={FORMAS_PAGAMENTO} />
                <SelectField id="situacao" label="Situação" options={SITUACOES} required />
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

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-[#C69C6D] text-white px-6 py-2.5 rounded-xl font-black text-sm hover:bg-[#b58a5b] disabled:opacity-50 transition-all shadow-lg"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button type="button" onClick={handleCancel} className="px-6 py-2.5 rounded-xl font-black text-sm text-slate-500 hover:bg-slate-100 transition-all border border-slate-200">
                Cancelar
              </button>
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
                      className={`border-b border-slate-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-[#C69C6D]/5`}
                    >
                      <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{c.nome || '—'}</td>
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
                      <td className="px-4 py-3 whitespace-nowrap">
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
