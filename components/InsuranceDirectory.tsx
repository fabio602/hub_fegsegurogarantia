import React, { useState, useEffect } from 'react';
import { Search, ExternalLink, User, Key, Info, Edit3, Save, X, Plus, ShieldPlus, Copy, Check, Loader2, Trophy, TrendingUp, BarChart2 } from 'lucide-react';
import { Insurer } from '../types';
import { supabase } from '../lib/supabase';

interface RankEntry { nome: string; count: number; totalPremio: number; }

const MEDAL_COLORS = [
  { bg: 'from-yellow-400 to-amber-500', text: 'text-yellow-900', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: '🥇' },
  { bg: 'from-slate-300 to-slate-400', text: 'text-slate-800', badge: 'bg-slate-100 text-slate-600 border-slate-200', label: '🥈' },
  { bg: 'from-orange-400 to-amber-600', text: 'text-orange-900', badge: 'bg-orange-100 text-orange-700 border-orange-200', label: '🥉' },
];

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar:', err);
    }
  };

  if (!text) return null;

  return (
    <button
      onClick={handleCopy}
      className={`p-2 rounded-xl transition-all ${copied ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-400 hover:text-[#C69C6D] hover:bg-slate-100 shadow-sm border border-slate-100'}`}
      title="Copiar para área de transferência"
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
  const [ranking, setRanking] = useState<RankEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [showFullRanking, setShowFullRanking] = useState(false);

  useEffect(() => {
    setSearchTerm('');
    setEditingId(null);
    setEditForm({});
    setInsurers([]);
    fetchInsurers();
    if (tableName === 'insurers') fetchRanking();
  }, [tableName]);

  const fetchRanking = async () => {
    setRankingLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select('seguradora, premio')
      .not('seguradora', 'is', null);

    if (!error && data) {
      const agg: Record<string, { count: number; totalPremio: number }> = {};
      data.forEach(row => {
        const name = (row.seguradora as string)?.trim();
        if (!name) return;
        if (!agg[name]) agg[name] = { count: 0, totalPremio: 0 };
        agg[name].count++;
        const raw = String(row.premio || '0').replace(/[^\d,]/g, '').replace(',', '.');
        const val = parseFloat(raw);
        agg[name].totalPremio += isNaN(val) ? 0 : val;
      });
      const sorted = Object.entries(agg)
        .map(([nome, v]) => ({ nome, ...v }))
        .sort((a, b) => b.count - a.count);
      setRanking(sorted);
    }
    setRankingLoading(false);
  };

  const fetchInsurers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('nome', { ascending: true });

    if (error) {
      console.error(`Erro ao buscar ${tableName}:`, error);
    } else {
      setInsurers(data || []);
    }
    setLoading(false);
  };

  const filteredInsurers = insurers.filter(ins =>
    ins.nome.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleEdit = (ins: Insurer) => {
    setEditingId(ins.id);
    setEditForm(ins);
  };

  const handleSave = async () => {
    if (!editForm.nome) return alert('O nome é obrigatório');

    const { error } = await supabase
      .from(tableName)
      .upsert({
        id: editingId && editingId > 1000000000000 ? undefined : editingId,
        nome: editForm.nome,
        premio_minimo: editForm.premioMinimo,
        portal: editForm.portal,
        login: editForm.login,
        senha: editForm.senha,
        obs: editForm.obs,
        ccg: editForm.ccg
      });

    if (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar dados.');
    } else {
      setEditingId(null);
      fetchInsurers();
    }
  };

  const handleAdd = () => {
    const tempId = Date.now();
    const newIns: Partial<Insurer> = {
      id: tempId,
      nome: `Novo(a) ${itemName}`,
      login: '',
      senha: '',
      portal: '',
      obs: '',
      ccg: ''
    };
    setInsurers([newIns as Insurer, ...insurers]);
    setEditingId(tempId);
    setEditForm(newIns);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm(`Deseja excluir este(a) ${itemName}?`)) {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erro ao deletar:', error);
      } else {
        fetchInsurers();
      }
    }
  };

  if (loading && insurers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 size={40} className="animate-spin mb-4 text-[#C69C6D]" />
        <p className="font-bold uppercase tracking-widest text-xs">Carregando Base...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in duration-500 pb-20">
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
              className="pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-[1.5rem] focus:ring-4 focus:ring-[#C69C6D]/10 outline-none min-w-[320px] shadow-sm transition-all font-medium text-slate-700"
            />
          </div>
          <button
            onClick={handleAdd}
            className="bg-[#C69C6D] text-white px-8 py-4 rounded-[1.5rem] hover:bg-[#b58a5b] transition-all shadow-xl shadow-[#C69C6D]/20 flex items-center gap-2 font-black"
          >
            <Plus size={24} strokeWidth={3} />
            <span className="hidden sm:inline">Novo</span>
          </button>
        </div>
      </header>

      {/* ── Ranking section (seguradoras only) ─────────────────────── */}
      {tableName === 'insurers' && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-8 py-5 border-b border-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
                <Trophy size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-black text-slate-800 text-lg tracking-tight">Ranking de Utilização</h3>
                <p className="text-xs text-slate-400 font-semibold">Seguradoras mais usadas nas suas vendas</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {rankingLoading && <Loader2 size={16} className="animate-spin text-slate-300" />}
              {ranking.length > 3 && (
                <button
                  onClick={() => setShowFullRanking(v => !v)}
                  className="text-xs font-black text-[#C69C6D] hover:text-[#b58a5b] uppercase tracking-[2px] flex items-center gap-1 transition-colors"
                >
                  <BarChart2 size={14} />
                  {showFullRanking ? 'VER MENOS' : `VER TODAS (${ranking.length})`}
                </button>
              )}
            </div>
          </div>

          {ranking.length === 0 && !rankingLoading ? (
            <div className="flex items-center gap-3 px-8 py-6 text-slate-400">
              <TrendingUp size={18} />
              <span className="text-sm font-semibold">Nenhuma venda registrada ainda.</span>
            </div>
          ) : (
            <div className="p-6 space-y-3">
              {/* Top 3 podium */}
              {ranking.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  {ranking.slice(0, 3).map((entry, i) => {
                    const m = MEDAL_COLORS[i];
                    return (
                      <div key={entry.nome} className={`relative rounded-[1.5rem] p-5 bg-gradient-to-br ${m.bg} shadow-lg flex flex-col gap-2`}>
                        <span className="text-3xl absolute top-4 right-4">{m.label}</span>
                        <span className={`text-xs font-black uppercase tracking-[2px] ${m.text} opacity-60`}>#{i + 1}</span>
                        <h4 className={`font-black text-lg leading-tight ${m.text} pr-8`}>{entry.nome}</h4>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className={`text-xs font-black px-3 py-1 rounded-full border ${m.badge}`}>
                            {entry.count} {entry.count === 1 ? 'apólice' : 'apólices'}
                          </span>
                          {entry.totalPremio > 0 && (
                            <span className={`text-xs font-bold ${m.text} opacity-70`}>
                              R$ {entry.totalPremio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Rest of ranking (expandable) */}
              {(showFullRanking ? ranking.slice(3) : []).map((entry, i) => (
                <div key={entry.nome} className="flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-slate-50 transition-colors">
                  <span className="text-sm font-black text-slate-300 w-6 text-right">{i + 4}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-slate-700 truncate block">{entry.nome}</span>
                  </div>
                  <span className="text-xs font-black text-slate-400 shrink-0">{entry.count} {entry.count === 1 ? 'apólice' : 'apólices'}</span>
                  {entry.totalPremio > 0 && (
                    <span className="text-xs font-semibold text-slate-400 shrink-0 hidden sm:block">
                      R$ {entry.totalPremio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
        {filteredInsurers.map(ins => {
          const isEditing = editingId === ins.id;

          return (
            <div key={ins.id} className={`bg-white rounded-[2.5rem] border transition-all flex flex-col group relative overflow-hidden ${isEditing ? 'ring-4 ring-[#C69C6D]/30 shadow-2xl z-10' : 'border-slate-100 shadow-sm hover:shadow-2xl hover:-translate-y-2'}`}>
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#1B263B] to-[#C69C6D] opacity-40 group-hover:opacity-100 transition-opacity" />

              <div className="p-8 pb-4 flex items-center justify-between">
                <div className="flex-1">
                  {isEditing ? (
                    <input
                      className="font-black text-slate-800 border-b-4 border-[#C69C6D] outline-none bg-slate-50 px-4 py-2 text-2xl w-full rounded-t-xl"
                      value={editForm.nome}
                      onChange={e => setEditForm({ ...editForm, nome: e.target.value })}
                      placeholder="Nome da Cia"
                    />
                  ) : (
                    <h3 className="font-black text-slate-800 text-3xl tracking-tighter leading-none group-hover:text-[#C69C6D] transition-colors">{ins.nome}</h3>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button onClick={handleSave} className="bg-emerald-500 text-white p-3 hover:bg-emerald-600 rounded-2xl transition-all shadow-lg active:scale-95"><Save size={20} /></button>
                      <button onClick={() => { setEditingId(null); fetchInsurers(); }} className="bg-slate-100 text-slate-500 p-3 hover:bg-slate-200 rounded-2xl transition-all"><X size={20} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0">
                      <button onClick={() => handleEdit(ins)} className="text-slate-400 hover:text-[#C69C6D] transition-colors p-3 hover:bg-slate-50 rounded-2xl"><Edit3 size={20} /></button>
                      <button onClick={() => handleDelete(ins.id)} className="text-slate-300 hover:text-red-500 transition-colors p-3 hover:bg-red-50 rounded-2xl"><X size={20} /></button>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-8 py-2">
                <div className="flex flex-wrap gap-2">
                  {(ins.premioMinimo || ins.premio_minimo) && !isEditing && (
                    <div className="bg-[#1B263B]/5 text-[#1B263B] px-5 py-2 rounded-full text-[10px] font-black tracking-[2px] inline-flex items-center gap-2 uppercase">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#C69C6D] animate-pulse"></div>
                      MÍNIMO {ins.premioMinimo || ins.premio_minimo}
                    </div>
                  )}
                  {ins.ccg && !isEditing && (
                    <div className="bg-red-50 text-red-600 px-5 py-2 rounded-full text-[10px] font-black tracking-[2px] inline-flex items-center gap-2 uppercase border border-red-100">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                      ACIMA DE {ins.ccg} EXIGE CCG
                    </div>
                  )}
                </div>
                
                {isEditing && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-black text-[#C69C6D] uppercase tracking-[2px]">Prêmio Mínimo</span>
                      <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl focus:border-[#C69C6D]" placeholder="Ex: R$ 150,00" value={editForm.premioMinimo || editForm.premio_minimo || ''} onChange={e => setEditForm({ ...editForm, premioMinimo: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-black text-[#C69C6D] uppercase tracking-[2px]">Valor do CCG</span>
                      <input 
                        className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl focus:border-[#C69C6D]" 
                        placeholder="Ex: R$ 1.500,00" 
                        value={editForm.ccg || ''} 
                        onChange={e => {
                          let val = e.target.value.replace(/\D/g, '');
                          if (val) {
                            val = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseInt(val) / 100);
                          }
                          setEditForm({ ...editForm, ccg: val });
                        }} 
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-8 pt-6 space-y-8 flex-1">
                <div className="space-y-6">
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-[2px] flex items-center gap-2">
                      <ExternalLink size={14} className="text-[#C69C6D]" /> Portal do Corretor
                    </p>
                    {isEditing ? (
                      <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.portal || ''} onChange={e => setEditForm({ ...editForm, portal: e.target.value })} placeholder="https://..." />
                    ) : (
                      <div className="flex items-center gap-3 group/link">
                        <a href={ins.portal?.startsWith('http') ? ins.portal : '#'} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 hover:text-white hover:bg-blue-600 truncate flex-1 bg-blue-50/50 px-4 py-3 rounded-2xl border border-blue-100/50 transition-all">
                          {ins.portal || 'Não informado'}
                        </a>
                        {ins.portal && <CopyButton text={ins.portal} />}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-[2px] flex items-center gap-2">
                        <User size={14} className="text-slate-400" /> Usuário
                      </p>
                      {isEditing ? (
                        <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.login || ''} onChange={e => setEditForm({ ...editForm, login: e.target.value })} placeholder="E-mail ou CPF" />
                      ) : (
                        <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50 hover:bg-slate-50 transition-colors">
                          <p className="text-base font-black text-slate-800 truncate mr-2">{ins.login || '-'}</p>
                          <CopyButton text={ins.login || ''} />
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-[2px] flex items-center gap-2">
                        <Key size={14} className="text-slate-400" /> Senha
                      </p>
                      {isEditing ? (
                        <input className="w-full text-sm border-2 border-slate-100 outline-none bg-slate-50 px-4 py-3 rounded-2xl" value={editForm.senha || ''} onChange={e => setEditForm({ ...editForm, senha: e.target.value })} placeholder="Senha" />
                      ) : (
                        <div className="flex items-center justify-between bg-slate-50/80 p-4 rounded-[1.5rem] border border-slate-100/50 hover:bg-slate-50 transition-colors">
                          <p className="text-base font-black text-slate-800 truncate mr-2">{ins.senha || '-'}</p>
                          <CopyButton text={ins.senha || ''} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {(ins.obs || isEditing) && (
                  <div className={`p-6 rounded-[2rem] flex items-start gap-4 ${isEditing ? 'bg-orange-50 border-2 border-orange-100' : 'bg-[#1B263B]/5 border border-[#1B263B]/5'}`}>
                    <Info size={20} className="text-[#C69C6D] mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[11px] font-black text-slate-500 uppercase tracking-[2px] mb-2">Notas Técnicas</p>
                      {isEditing ? (
                        <textarea className="w-full text-sm bg-transparent outline-none min-h-[100px] font-medium" placeholder="Regras de aceitação, ramos, contatos do gerente..." value={editForm.obs || ''} onChange={e => setEditForm({ ...editForm, obs: e.target.value })} />
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed font-semibold italic">{ins.obs || `Nenhuma nota técnica cadastrada para este(a) ${itemName}.`}</p>
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
            className="bg-slate-50 border-4 border-dashed border-slate-100 rounded-[3rem] flex flex-col items-center justify-center p-12 group hover:border-[#C69C6D]/40 hover:bg-white transition-all min-h-[400px]"
          >
            <div className="w-24 h-24 rounded-[2rem] bg-white shadow-2xl flex items-center justify-center text-slate-200 group-hover:text-[#C69C6D] group-hover:scale-110 transition-all mb-8 border border-slate-50">
              <ShieldPlus size={48} />
            </div>
            <span className="text-slate-400 font-black uppercase tracking-[4px] group-hover:text-[#1B263B]">{emptyStateText}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default InsuranceDirectory;
