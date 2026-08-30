import React, { useState, useEffect, useCallback } from 'react';
import { Search, ExternalLink, User, Key, Info, Edit3, Save, X, Plus, ShieldPlus, Copy, Check, Loader2, Star, UserRound, Phone, Mail } from 'lucide-react';
import WhatsAppPhoneLink from './WhatsAppPhoneLink.tsx';
import { Insurer } from '../types';
import { supabase } from '../lib/supabase';
import { useAutoSave } from '../hooks/useAutoSave.ts';
import { SaveIndicator } from './SaveIndicator.tsx';

const PRESET_COLORS: { id: string; label: string; bg: string; text: string; badge: string; style: string }[] = [
  { id: 'navy',        label: 'Azul Marinho',   bg: 'from-navy to-navy-dark',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#1B3A5C,#0F2440)' },
  { id: 'charcoal',   label: 'Grafite',         bg: 'from-[#2D3748] to-[#1A202C]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#2D3748,#1A202C)' },
  { id: 'forest',     label: 'Verde Floresta',  bg: 'from-[#1B4332] to-[#081C15]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#1B4332,#081C15)' },
  { id: 'burgundy',   label: 'Vinho',           bg: 'from-[#6B1E2A] to-[#3D0D15]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#6B1E2A,#3D0D15)' },
  { id: 'steel',      label: 'Azul Aço',        bg: 'from-[#1E3A5F] to-[#152B4A]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#1E3A5F,#152B4A)' },
  { id: 'indigo',     label: 'Índigo',          bg: 'from-[#3730A3] to-[#1E1B4B]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#3730A3,#1E1B4B)' },
  { id: 'teal-dark',  label: 'Teal Escuro',     bg: 'from-[#0F766E] to-[#134E4A]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#0F766E,#134E4A)' },
  { id: 'slate',      label: 'Ardósia',         bg: 'from-[#475569] to-[#334155]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#475569,#334155)' },
  { id: 'champagne',  label: 'Champagne',       bg: 'from-[#C4A35A] to-[#8B6914]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#C4A35A,#8B6914)' },
  { id: 'rosegold',   label: 'Ouro Rosê',       bg: 'from-gold-hover to-[#7C5230]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#B58A5B,#7C5230)' },
  { id: 'obsidian',   label: 'Obsidiana',       bg: 'from-[#1A1A2E] to-[#0D0D1A]',   text: 'text-white',           badge: 'bg-white/15 text-white border-white/25',         style: 'linear-gradient(135deg,#1A1A2E,#0D0D1A)' },
  { id: 'sage',       label: 'Sálvia',          bg: 'from-[#4A5E52] to-[#2C3C34]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#4A5E52,#2C3C34)' },
  { id: 'copper',     label: 'Cobre',           bg: 'from-[#7C3516] to-[#4A1F0D]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#7C3516,#4A1F0D)' },
  { id: 'stone',      label: 'Pedra',           bg: 'from-[#78716C] to-[#44403C]',   text: 'text-white',           badge: 'bg-white/20 text-white border-white/30',         style: 'linear-gradient(135deg,#78716C,#44403C)' },
  { id: 'midnight',   label: 'Meia-Noite',      bg: 'from-[#0C1445] to-[#050A24]',   text: 'text-white',           badge: 'bg-white/15 text-white border-white/25',         style: 'linear-gradient(135deg,#0C1445,#050A24)' },
];

const DEFAULT_COLORS = [
  'navy', 'charcoal', 'forest', 'steel', 'indigo', 'teal-dark', 'slate', 'burgundy', 'sage', 'midnight',
];

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch (err) { console.error('Falha ao copiar:', err); }
  };
  if (!text) return null;
  return (
    <button
      onClick={handleCopy}
      className={`p-2 rounded-xl transition-all ${copied ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-400 hover:text-gold hover:bg-slate-100 shadow-sm border border-slate-100'}`}
      title="Copiar"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
};

interface DirectoryProps {
  tableName: string;
  title: string;
  subtitle: string;
  itemName: string;
  emptyStateText: string;
}

const InsuranceDirectory: React.FC<DirectoryProps> = ({ tableName, title, subtitle, itemName, emptyStateText }) => {
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Insurer>>({});

  useEffect(() => {
    setSearchTerm('');
    setEditingId(null);
    setEditForm({});
    setInsurers([]);
    fetchInsurers();
  }, [tableName]);

  const fetchInsurers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('nome', { ascending: true });
    if (error) console.error(`Erro ao buscar ${tableName}:`, error);
    else setInsurers(data || []);
    setLoading(false);
  };

  // Seguradoras destacadas no ranking, ordenadas pela posição definida pelo usuário
  const rankedInsurers = insurers
    .filter(ins => ins.rank_position != null && ins.rank_position > 0)
    .sort((a, b) => (a.rank_position ?? 99) - (b.rank_position ?? 99));

  const filteredInsurers = insurers.filter(ins =>
    ins.nome.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleEdit = (ins: Insurer) => { setEditingId(ins.id); setEditForm(ins); };

  // Ids temporários (Date.now()) são registros que ainda não existem no banco.
  // O autosave fica desligado neles, senão cada pausa criaria uma linha nova.
  const ehRegistroNovo = editingId !== null && editingId > 1000000000000;

  const gravarEmEdicao = useCallback(
    async (dados: Partial<Insurer>) => {
      if (editingId === null || ehRegistroNovo) return;
      if (!dados.nome) return; // nome é obrigatório
      const { error } = await supabase
        .from(tableName)
        .update({
          nome: dados.nome,
          premio_minimo: dados.premioMinimo || dados.premio_minimo,
          portal: dados.portal,
          login: dados.login,
          senha: dados.senha,
          gerente: dados.gerente,
          contato: dados.contato,
          email: dados.email,
          obs: dados.obs,
          ccg: dados.ccg,
          ...(dados.rank_position != null && { rank_position: dados.rank_position }),
          ...(dados.card_color != null && { card_color: dados.card_color }),
        })
        .eq('id', editingId);
      if (error) throw error;
      setInsurers(prev => prev.map(i => (i.id === editingId ? ({ ...i, ...dados } as Insurer) : i)));
    },
    [editingId, ehRegistroNovo, tableName],
  );

  const {
    estado: autoSaveState,
    salvarAgora: salvarAgoraDiretorio,
    sincronizar: sincronizarAutoSave,
  } = useAutoSave({
    dados: editForm,
    ativo: editingId !== null && !ehRegistroNovo,
    identidade: editingId,
    salvar: gravarEmEdicao,
  });

  const handleSave = async () => {
    if (!editForm.nome) return alert('O nome é obrigatório');
    const payload: Record<string, unknown> = {
      id: editingId && editingId > 1000000000000 ? undefined : editingId,
      nome: editForm.nome,
      premio_minimo: editForm.premioMinimo || editForm.premio_minimo,
      portal: editForm.portal,
      login: editForm.login,
      senha: editForm.senha,
      gerente: editForm.gerente,
      contato: editForm.contato,
      email: editForm.email,
      obs: editForm.obs,
      ccg: editForm.ccg,
      // rank_position e card_color só são enviados se tiverem valor (evita erro em tabelas sem essas colunas)
      ...(editForm.rank_position != null && { rank_position: editForm.rank_position }),
      ...(editForm.card_color != null && { card_color: editForm.card_color }),
    };
    const { error } = await supabase.from(tableName).upsert(payload);
    if (error) { console.error('Erro ao salvar:', error); alert('Erro ao salvar dados.'); }
    else { sincronizarAutoSave(); setEditingId(null); fetchInsurers(); }
  };

  const handleAdd = () => {
    const tempId = Date.now();
    const newIns: Partial<Insurer> = { id: tempId, nome: `Novo(a) ${itemName}`, login: '', senha: '', portal: '', gerente: '', contato: '', email: '', obs: '', ccg: '' };
    setInsurers([newIns as Insurer, ...insurers]);
    setEditingId(tempId);
    setEditForm(newIns);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm(`Deseja excluir este(a) ${itemName}?`)) {
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) console.error('Erro ao deletar:', error);
      else fetchInsurers();
    }
  };

  if (loading && insurers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 size={40} className="animate-spin mb-4 text-gold" />
        <p className="font-bold uppercase tracking-widest text-xs">Carregando Base...</p>
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">{title}</h2>
          <p className="text-slate-500 font-semibold mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={`Buscar ${itemName}...`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-[1.5rem] focus:ring-4 focus:ring-gold/10 outline-none min-w-[320px] shadow-sm transition-all font-medium text-slate-700"
            />
          </div>
          <button
            onClick={handleAdd}
            className="bg-gold text-white px-8 py-4 rounded-[1.5rem] hover:bg-gold-hover transition-all shadow-xl shadow-gold/20 flex items-center gap-2 font-bold"
          >
            <Plus size={24} strokeWidth={3} />
            <span className="hidden sm:inline">Novo</span>
          </button>
        </div>
      </header>

      {/* ── Ranking Manual ────────────────────────────────────────── */}
      {rankedInsurers.length > 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-8 py-5 border-b border-slate-50">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-navy to-navy-dark flex items-center justify-center shadow-lg">
              <Star size={18} className="text-gold fill-gold" />
            </div>
            <div>
              <h3 className="font-black text-slate-800 text-lg tracking-tight">Seguradoras Prioritárias para o Seguro de Proposta</h3>
              <p className="text-xs text-slate-400 font-medium">Ordem definida por você — edite uma seguradora para ajustar posição e cor</p>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {rankedInsurers.map((ins, i) => {
                const colorId = ins.card_color || DEFAULT_COLORS[i] || 'light-blue';
                const m = PRESET_COLORS.find(c => c.id === colorId) ?? PRESET_COLORS[0];
                const TOP3_EMOJIS = ['🥇', '🥈', '🥉'];
                const premioMin = ins.premioMinimo || ins.premio_minimo;
                return (
                  <div key={ins.id} className={`relative rounded-[1.5rem] p-5 bg-gradient-to-br ${m.bg} shadow-md flex flex-col gap-3`}>
                    <div className="flex items-start justify-between">
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${m.text} opacity-60`}>#{ins.rank_position}</span>
                      {i < 3 && <span className="text-2xl leading-none">{TOP3_EMOJIS[i]}</span>}
                    </div>
                    <h4 className={`font-black text-xl leading-tight ${m.text}`}>{ins.nome}</h4>
                    <div className="flex flex-wrap gap-2">
                      {premioMin && (
                        <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border ${m.badge}`}>
                          MÍNIMO {premioMin}
                        </span>
                      )}
                      {ins.ccg && (
                        <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border ${m.badge}`}>
                          CCG {ins.ccg}
                        </span>
                      )}
                      {!premioMin && !ins.ccg && (
                        <span className={`text-[10px] font-semibold ${m.text} opacity-50`}>Sem condições cadastradas</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Cards Grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-10">
        {filteredInsurers.map(ins => {
          const isEditing = editingId === ins.id;
          const premioMin = ins.premioMinimo || ins.premio_minimo;

          return (
            <div key={ins.id} className={`bg-white rounded-[2.5rem] border transition-all flex flex-col group relative overflow-hidden ${isEditing ? 'ring-4 ring-gold/30 shadow-2xl z-10' : 'border-slate-100 shadow-sm hover:shadow-2xl hover:-translate-y-2'}`}>
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-navy to-gold opacity-40 group-hover:opacity-100 transition-opacity" />

              {/* Card Header */}
              <div className="p-8 pb-4 flex items-center justify-between">
                <div className="flex-1">
                  {isEditing ? (
                    <input
                      className="font-black text-slate-800 border-b-4 border-gold outline-none bg-slate-50 px-4 py-2 text-2xl w-full rounded-t-xl"
                      value={editForm.nome}
                      onChange={e => setEditForm({ ...editForm, nome: e.target.value })}
                      placeholder="Nome da Cia"
                    />
                  ) : (
                    <h3 className="font-black text-slate-800 text-3xl tracking-tighter leading-none group-hover:text-gold transition-colors">{ins.nome}</h3>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <SaveIndicator estado={autoSaveState} aoTentarNovamente={salvarAgoraDiretorio} />
                      <button onClick={handleSave} className="bg-emerald-500 text-white p-3 hover:bg-emerald-600 rounded-2xl transition-all shadow-lg active:scale-95"><Save size={20} /></button>
                      <button
                        onClick={() => { setEditingId(null); fetchInsurers(); }}
                        title={ehRegistroNovo ? 'Descartar' : 'Fechar edição'}
                        className="bg-slate-100 text-slate-500 p-3 hover:bg-slate-200 rounded-2xl transition-all"
                      ><X size={20} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0">
                      <button onClick={() => handleEdit(ins)} className="text-slate-400 hover:text-gold transition-colors p-3 hover:bg-slate-50 rounded-2xl"><Edit3 size={20} /></button>
                      <button onClick={() => handleDelete(ins.id)} className="text-slate-300 hover:text-red-500 transition-colors p-3 hover:bg-red-50 rounded-2xl"><X size={20} /></button>
                    </div>
                  )}
                </div>
              </div>

              {/* Badges / Edit Fields */}
              <div className="px-8 py-2">
                {!isEditing && (
                  <div className="flex flex-wrap gap-2">
                    {premioMin && (
                      <div className="bg-navy/5 text-navy px-5 py-2 rounded-full text-[10px] font-bold tracking-widest inline-flex items-center gap-2 uppercase">
                        <div className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse"></div>
                        MÍNIMO {premioMin}
                      </div>
                    )}
                    {ins.ccg && (
                      <div className="bg-red-50 text-red-600 px-5 py-2 rounded-full text-[10px] font-bold tracking-widest inline-flex items-center gap-2 uppercase border border-red-100">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                        CCG ACIMA DE {ins.ccg}
                      </div>
                    )}
                    {ins.rank_position && (
                      <div className="bg-amber-50 text-amber-700 px-5 py-2 rounded-full text-[10px] font-bold tracking-widest inline-flex items-center gap-2 uppercase border border-amber-100">
                        ⭐ DESTAQUE #{ins.rank_position}
                      </div>
                    )}
                  </div>
                )}

                {isEditing && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-bold text-gold uppercase tracking-widest">Prêmio Mínimo</span>
                      <input
                        className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl focus:border-gold"
                        placeholder="Ex: R$ 150,00"
                        value={editForm.premioMinimo || editForm.premio_minimo || ''}
                        onChange={e => setEditForm({ ...editForm, premioMinimo: e.target.value, premio_minimo: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-bold text-gold uppercase tracking-widest">CCG (R$)</span>
                      <input
                        className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl focus:border-gold"
                        placeholder="Ex: R$ 1.500,00"
                        value={editForm.ccg || ''}
                        onChange={e => {
                          let val = e.target.value.replace(/\D/g, '');
                          if (val) val = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseInt(val) / 100);
                          setEditForm({ ...editForm, ccg: val });
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:col-span-2">
                      <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">⭐ Posição no Destaque (deixe vazio para não destacar)</span>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl focus:border-amber-400"
                        placeholder="Ex: 1 = primeiro lugar, 2 = segundo..."
                        value={editForm.rank_position ?? ''}
                        onChange={e => setEditForm({ ...editForm, rank_position: e.target.value ? parseInt(e.target.value) : null })}
                      />
                    </div>
                    <div className="flex flex-col gap-3 sm:col-span-2">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">🎨 Cor do Card no Destaque</span>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_COLORS.map(color => (
                          <button
                            key={color.id}
                            type="button"
                            title={color.label}
                            onClick={() => setEditForm({ ...editForm, card_color: color.id })}
                            style={{ background: color.style }}
                            className={`w-9 h-9 rounded-full transition-all shadow-sm border-2 ${editForm.card_color === color.id ? 'border-slate-800 scale-125 shadow-lg' : 'border-transparent hover:scale-110'}`}
                          />
                        ))}
                      </div>
                      {editForm.card_color && (
                        <p className="text-xs text-slate-400 font-semibold">
                          Selecionado: <span className="text-slate-700 font-bold">{PRESET_COLORS.find(c => c.id === editForm.card_color)?.label}</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Portal / Login / Senha */}
              <div className="p-5 sm:p-8 pt-6 space-y-8 flex-1">
                <div className="space-y-6">
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <ExternalLink size={14} className="text-gold" /> Portal do Corretor
                    </p>
                    {isEditing ? (
                      <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.portal || ''} onChange={e => setEditForm({ ...editForm, portal: e.target.value })} placeholder="https://..." />
                    ) : (
                      <div className="flex items-center gap-3">
                        <a href={ins.portal?.startsWith('http') ? ins.portal : '#'} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 hover:text-white hover:bg-blue-600 truncate flex-1 bg-blue-50/50 px-4 py-3 rounded-2xl border border-blue-100/50 transition-all">
                          {ins.portal || 'Não informado'}
                        </a>
                        {ins.portal && <CopyButton text={ins.portal} />}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <User size={14} className="text-slate-400" /> Usuário
                    </p>
                    {isEditing ? (
                      <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.login || ''} onChange={e => setEditForm({ ...editForm, login: e.target.value })} placeholder="E-mail ou CPF" />
                    ) : (
                      <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50">
                        <p className="text-base font-bold text-slate-800 truncate mr-2">{ins.login || '-'}</p>
                        <CopyButton text={ins.login || ''} />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Key size={14} className="text-slate-400" /> Senha
                    </p>
                    {isEditing ? (
                      <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.senha || ''} onChange={e => setEditForm({ ...editForm, senha: e.target.value })} placeholder="Senha" />
                    ) : (
                      <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50">
                        <p className="text-base font-bold text-slate-800 truncate mr-2">{ins.senha || '-'}</p>
                        <CopyButton text={ins.senha || ''} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Contato comercial — gerente, WhatsApp e e-mail */}
                {(ins.gerente || ins.contato || ins.email || isEditing) && (
                  <div className="space-y-4 pt-2 border-t border-slate-100">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <UserRound size={14} className="text-gold" /> Contato Comercial
                    </p>

                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gerente</p>
                      {isEditing ? (
                        <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.gerente || ''} onChange={e => setEditForm({ ...editForm, gerente: e.target.value })} placeholder="Nome do gerente comercial" />
                      ) : (
                        <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50">
                          <p className="text-base font-bold text-slate-800 truncate mr-2">{ins.gerente || '-'}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Phone size={12} className="text-slate-400" /> WhatsApp
                      </p>
                      {isEditing ? (
                        <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.contato || ''} onChange={e => setEditForm({ ...editForm, contato: e.target.value })} placeholder="(15) 99999-9999" />
                      ) : (
                        <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50">
                          {ins.contato
                            ? <WhatsAppPhoneLink phone={ins.contato} className="text-base font-bold truncate min-w-0 mr-2" />
                            : <p className="text-base font-bold text-slate-800 mr-2">-</p>}
                          {ins.contato && <div className="shrink-0"><CopyButton text={ins.contato} /></div>}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Mail size={12} className="text-slate-400" /> E-mail
                      </p>
                      {isEditing ? (
                        <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder="gerente@seguradora.com.br" />
                      ) : (
                        <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50">
                          {ins.email
                            ? <a href={`mailto:${ins.email}`} className="text-sm font-bold text-navy hover:text-gold truncate min-w-0 mr-2 underline decoration-gold/40 underline-offset-2">{ins.email}</a>
                            : <p className="text-base font-bold text-slate-800 mr-2">-</p>}
                          {ins.email && <div className="shrink-0"><CopyButton text={ins.email} /></div>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(ins.obs || isEditing) && (
                  <div className={`p-6 rounded-[2rem] flex items-start gap-4 ${isEditing ? 'bg-orange-50 border-2 border-orange-100' : 'bg-navy/5 border border-navy/5'}`}>
                    <Info size={20} className="text-gold mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Notas Técnicas</p>
                      {isEditing ? (
                        <textarea className="w-full text-sm bg-transparent outline-none min-h-[100px] font-medium" placeholder="Regras de aceitação, ramos, particularidades..." value={editForm.obs || ''} onChange={e => setEditForm({ ...editForm, obs: e.target.value })} />
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed font-semibold italic">{ins.obs}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!searchTerm && (
          <button
            onClick={handleAdd}
            className="bg-slate-50 border-4 border-dashed border-slate-100 rounded-[3rem] flex flex-col items-center justify-center p-12 group hover:border-gold/40 hover:bg-white transition-all min-h-[400px]"
          >
            <div className="w-24 h-24 rounded-[2rem] bg-white shadow-2xl flex items-center justify-center text-slate-200 group-hover:text-gold group-hover:scale-110 transition-all mb-8 border border-slate-50">
              <ShieldPlus size={48} />
            </div>
            <span className="text-slate-400 font-bold uppercase tracking-[4px] group-hover:text-navy">{emptyStateText}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default InsuranceDirectory;
