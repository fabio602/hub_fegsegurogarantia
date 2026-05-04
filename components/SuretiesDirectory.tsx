import React, { useState, useEffect } from 'react';
import { Search, Info, Edit3, Save, X, Plus, ShieldPlus, Landmark, FileText, UserCircle, DollarSign, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';

interface SuretyData {
    gerente: {
        nome: string;
        telefone: string;
        email: string;
    };
    documentos: string;
    comoPrecificar: string;
    pagamento: {
        pix: string;
        nome: string;
    };
}

const defaultSuretyData: SuretyData = {
    gerente: {
        nome: '',
        telefone: '',
        email: ''
    },
    documentos: '',
    comoPrecificar: '',
    pagamento: {
        pix: '',
        nome: ''
    }
};

interface Surety {
    id: number;
    nome: string;
    obs?: string; // We'll store JSON here
}

const SuretiesDirectory: React.FC = () => {
    const [sureties, setSureties] = useState<Surety[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);

    const [editNome, setEditNome] = useState('');
    const [editData, setEditData] = useState<SuretyData>(defaultSuretyData);

    useEffect(() => {
        fetchSureties();
    }, []);

    const fetchSureties = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('sureties')
            .select('id, nome, obs')
            .order('nome', { ascending: true });

        if (error) {
            console.error('Erro ao buscar afiançadoras:', error);
        } else {
            setSureties(data || []);
        }
        setLoading(false);
    };

    const parseSuretyData = (obs?: string): SuretyData => {
        if (!obs) return defaultSuretyData;
        try {
            const parsed = JSON.parse(obs);
            if (parsed.gerente) {
                return {
                    ...defaultSuretyData,
                    ...parsed
                };
            }
        } catch (e) {
            return { ...defaultSuretyData, documentos: obs };
        }
        return defaultSuretyData;
    };

    const filteredSureties = sureties.filter(s => s.nome.toLowerCase().includes(searchTerm.toLowerCase()));

    const handleEdit = (surety: Surety) => {
        setEditingId(surety.id);
        setEditNome(surety.nome);
        setEditData(parseSuretyData(surety.obs));
    };

    const handleSave = async () => {
        if (!editNome) return alert('O nome é obrigatório');

        const serializedData = JSON.stringify(editData);

        const { error } = await supabase
            .from('sureties')
            .upsert({
                id: editingId && editingId > 1000000000000 ? undefined : editingId,
                nome: editNome,
                obs: serializedData
            });

        if (error) {
            console.error('Erro ao salvar:', error);
            alert('Erro ao salvar dados.');
        } else {
            setEditingId(null);
            fetchSureties();
        }
    };

    const handleAdd = () => {
        const tempId = Date.now();
        const newSurety: Surety = {
            id: tempId,
            nome: `Nova Afiançadora`
        };
        setSureties([newSurety, ...sureties]);
        setEditingId(tempId);
        setEditNome(newSurety.nome);
        setEditData(defaultSuretyData);
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('Deseja excluir esta afiançadora?')) {
            const { error } = await supabase.from('sureties').delete().eq('id', id);
            if (!error) fetchSureties();
        }
    };

    if (loading && sureties.length === 0) {
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
                    <h2 className="text-4xl font-black text-slate-800 tracking-tight">Afiançadoras</h2>
                    <p className="text-slate-500 font-semibold mt-1">Gerenciamento customizado de contatos e condições comerciais.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar Afiançadora..."
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {filteredSureties.map(surety => {
                    const isEditing = editingId === surety.id;
                    const data = isEditing ? editData : parseSuretyData(surety.obs);

                    return (
                        <div key={surety.id} className={`bg-white rounded-[2.5rem] border transition-all flex flex-col group relative overflow-hidden ${isEditing ? 'ring-4 ring-[#C69C6D]/30 shadow-2xl z-10' : 'border-slate-100 shadow-sm hover:shadow-2xl hover:-translate-y-1'}`}>
                            <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-[#1B263B] to-[#C69C6D]" />

                            {/* Header: Name and Actions */}
                            <div className="p-8 pb-6 flex items-center justify-between border-b border-slate-50">
                                <div className="flex-1 flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                                        <Landmark size={24} className="text-[#C69C6D]" />
                                    </div>
                                    {isEditing ? (
                                        <input
                                            className="font-black text-slate-800 border-b-2 border-[#C69C6D] outline-none bg-slate-50 px-3 py-1 text-2xl w-full rounded-t-lg"
                                            value={editNome}
                                            onChange={e => setEditNome(e.target.value)}
                                            placeholder="Nome da Afiançadora"
                                        />
                                    ) : (
                                        <h3 className="font-black text-slate-800 text-3xl tracking-tighter leading-none">{surety.nome}</h3>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                    {isEditing ? (
                                        <div className="flex gap-2">
                                            <button onClick={handleSave} className="bg-emerald-500 text-white p-3 hover:bg-emerald-600 rounded-2xl transition-all shadow-lg active:scale-95"><Save size={20} /></button>
                                            <button onClick={() => { setEditingId(null); fetchSureties(); }} className="bg-slate-100 text-slate-500 p-3 hover:bg-slate-200 rounded-2xl transition-all"><X size={20} /></button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEdit(surety)} className="text-slate-400 hover:text-[#C69C6D] transition-colors p-3 hover:bg-slate-50 rounded-2xl"><Edit3 size={20} /></button>
                                            <button onClick={() => handleDelete(surety.id)} className="text-slate-300 hover:text-red-500 transition-colors p-3 hover:bg-red-50 rounded-2xl"><X size={20} /></button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="p-8 space-y-8 flex-1 bg-slate-50/30">
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-[2px] mb-4">
                                        <UserCircle size={16} className="text-[#C69C6D]" /> Gerente Comercial
                                    </h4>
                                    <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4">
                                        {isEditing ? (
                                            <div className="space-y-3">
                                                <input className="w-full text-sm font-bold bg-slate-50 px-4 py-3 rounded-xl outline-none" placeholder="Nome do Gerente" value={editData.gerente.nome} onChange={e => setEditData({ ...editData, gerente: { ...editData.gerente, nome: e.target.value } })} />
                                                <input className="w-full text-sm font-bold bg-slate-50 px-4 py-3 rounded-xl outline-none" placeholder="Telefone" value={editData.gerente.telefone} onChange={e => setEditData({ ...editData, gerente: { ...editData.gerente, telefone: e.target.value } })} />
                                                <input className="w-full text-sm font-bold bg-slate-50 px-4 py-3 rounded-xl outline-none" placeholder="E-mail" value={editData.gerente.email} onChange={e => setEditData({ ...editData, gerente: { ...editData.gerente, email: e.target.value } })} />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Nome</span>
                                                    <span className="font-black text-slate-800">{data.gerente.nome || 'Não informado'}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Telefone</span>
                                                    {data.gerente.telefone ? (
                                                        <WhatsAppPhoneLink phone={data.gerente.telefone} className="font-bold text-slate-600" />
                                                    ) : (
                                                        <span className="font-bold text-slate-600">Não informado</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">E-mail</span>
                                                    <span className="font-bold text-blue-600">{data.gerente.email || 'Não informado'}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Documentos Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-[2px] mb-4">
                                        <FileText size={16} className="text-[#C69C6D]" /> Documentos Necessários
                                    </h4>
                                    {isEditing ? (
                                        <textarea
                                            className="w-full text-sm bg-white border border-slate-200 outline-none p-4 rounded-2xl min-h-[120px] font-medium leading-relaxed"
                                            value={editData.documentos}
                                            onChange={e => setEditData({ ...editData, documentos: e.target.value })}
                                            placeholder="Liste os documentos aqui..."
                                        />
                                    ) : (
                                        <div className="bg-[#1B263B]/5 p-5 rounded-3xl border border-[#1B263B]/5">
                                            {data.documentos ? (
                                                <ul className="space-y-2">
                                                    {data.documentos.split('\n').filter(l => l.trim()).map((line, i) => (
                                                        <li key={i} className="flex items-start gap-3">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-[#C69C6D] mt-1.5 shrink-0" />
                                                            <span className="text-sm font-medium text-slate-700 leading-relaxed">
                                                                {line.replace(/^[-*]\s*/, '')}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm font-medium text-slate-500 italic mb-0">Nenhum documento informado.</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Como Precificar Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-[2px] mb-4">
                                        <Info size={16} className="text-[#C69C6D]" /> Como Precificar?
                                    </h4>
                                    {isEditing ? (
                                        <textarea
                                            className="w-full text-sm bg-white border border-slate-200 outline-none p-4 rounded-2xl min-h-[120px] font-medium leading-relaxed"
                                            value={editData.comoPrecificar || ''}
                                            onChange={e => setEditData({ ...editData, comoPrecificar: e.target.value })}
                                            placeholder="Explique como precificar..."
                                        />
                                    ) : (
                                        <div className="bg-[#1B263B]/5 p-5 rounded-3xl border border-[#1B263B]/5">
                                            {data.comoPrecificar ? (
                                                <p className="text-sm font-medium text-slate-700 whitespace-pre-line leading-relaxed">
                                                    {data.comoPrecificar}
                                                </p>
                                            ) : (
                                                <p className="text-sm font-medium text-slate-500 italic mb-0">Nenhuma informação sobre precificação.</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Pagamento Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-[2px] mb-4">
                                        <DollarSign size={16} className="text-[#C69C6D]" /> Pagamento
                                    </h4>
                                    <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4">
                                        {isEditing ? (
                                            <div className="space-y-3">
                                                <input className="w-full text-sm font-bold bg-slate-50 px-4 py-3 rounded-xl outline-none" placeholder="Chave PIX (ex: CNPJ)" value={editData.pagamento.pix} onChange={e => setEditData({ ...editData, pagamento: { ...editData.pagamento, pix: e.target.value } })} />
                                                <input className="w-full text-sm font-bold bg-slate-50 px-4 py-3 rounded-xl outline-none" placeholder="Nome do Favorecido" value={editData.pagamento.nome} onChange={e => setEditData({ ...editData, pagamento: { ...editData.pagamento, nome: e.target.value } })} />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">PIX</span>
                                                    <span className="font-black text-slate-800">{data.pagamento.pix || 'Não informado'}</span>
                                                </div>
                                                <div className="flex flex-col gap-1 mt-2">
                                                    <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Favorecido</span>
                                                    <span className="font-bold text-slate-600">{data.pagamento.nome || 'Não informado'}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                            </div>
                        </div>
                    );
                })}

                {!searchTerm && sureties.length === 0 && !loading && (
                    <button
                        onClick={handleAdd}
                        className="bg-slate-50 border-4 border-dashed border-slate-100 rounded-[3rem] flex flex-col items-center justify-center p-12 group hover:border-[#C69C6D]/40 hover:bg-white transition-all min-h-[400px]"
                    >
                        <div className="w-24 h-24 rounded-[2rem] bg-white shadow-2xl flex items-center justify-center text-slate-200 group-hover:text-[#C69C6D] group-hover:scale-110 transition-all mb-8 border border-slate-50">
                            <ShieldPlus size={48} />
                        </div>
                        <span className="text-slate-400 font-black uppercase tracking-[4px] group-hover:text-[#1B263B]">Adicionar Afiançadora</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default SuretiesDirectory;
