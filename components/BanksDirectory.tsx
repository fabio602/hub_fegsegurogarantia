import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Info, Edit3, Save, X, Plus, ShieldPlus, Landmark, FileText, UserCircle, DollarSign, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAutoSave } from '../hooks/useAutoSave.ts';
import { SaveIndicator } from './SaveIndicator.tsx';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';

interface BankData {
    premios: {
        licitacao: string;
        performanceSimples: string;
        performanceCoberturas: string;
        judicial: string;
        financeiras: string;
    };
    gerente: {
        nome: string;
        telefone: string;
        email: string;
    };
    documentos: string;
    requisitos?: string;
    documentosConta?: string;
}

const defaultBankData: BankData = {
    premios: {
        licitacao: '',
        performanceSimples: '',
        performanceCoberturas: '',
        judicial: '',
        financeiras: ''
    },
    gerente: {
        nome: '',
        telefone: '',
        email: ''
    },
    documentos: '- Último Contrato Social;\n- Procuração, caso haja;\n- Balanço Patrimonial dos três últimos exercício;\n- O contrato/edital da demanda necessária',
    requisitos: '',
    documentosConta: ''
};

interface Bank {
    id: number;
    nome: string;
    obs?: string; // We'll store JSON here
}

const BanksDirectory: React.FC = () => {
    const [banks, setBanks] = useState<Bank[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);

    const [editNome, setEditNome] = useState('');
    const [editData, setEditData] = useState<BankData>(defaultBankData);

    useEffect(() => {
        fetchBanks();
    }, []);

    const fetchBanks = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('banks')
            .select('id, nome, obs')
            .order('nome', { ascending: true });

        if (error) {
            console.error('Erro ao buscar bancos:', error);
        } else {
            setBanks(data || []);
        }
        setLoading(false);
    };

    const parseBankData = (obs?: string): BankData => {
        if (!obs) return defaultBankData;
        try {
            const parsed = JSON.parse(obs);
            if (parsed.premios && parsed.gerente) {
                return parsed;
            }
        } catch (e) {
            // Not JSON, might be the old text format. Let's return default but with the text in docs
            return { ...defaultBankData, documentos: obs };
        }
        return defaultBankData;
    };

    const filteredBanks = banks.filter(b => b.nome.toLowerCase().includes(searchTerm.toLowerCase()));

    const handleEdit = (bank: Bank) => {
        setEditingId(bank.id);
        setEditNome(bank.nome);
        setEditData(parseBankData(bank.obs));
    };

    // Ids temporários (Date.now()) marcam bancos que ainda não existem no banco
    // de dados. Nesses casos o autosave fica desligado, senão cada pausa na
    // digitação criaria um registro novo.
    const ehBancoNovo = editingId !== null && editingId > 1000000000000;

    const dadosAutoSave = useMemo(
        () => ({ nome: editNome, dados: editData }),
        [editNome, editData],
    );

    const gravarBancoEmEdicao = useCallback(
        async (dados: typeof dadosAutoSave) => {
            if (editingId === null || ehBancoNovo) return;
            if (!dados.nome.trim()) return; // nome é obrigatório
            const { error } = await supabase
                .from('banks')
                .update({ nome: dados.nome, obs: JSON.stringify(dados.dados) })
                .eq('id', editingId);
            if (error) throw error;
            setBanks(prev =>
                prev.map(b =>
                    b.id === editingId
                        ? { ...b, nome: dados.nome, obs: JSON.stringify(dados.dados) }
                        : b,
                ),
            );
        },
        [editingId, ehBancoNovo],
    );

    const {
        estado: autoSaveState,
        salvarAgora: salvarBancoAgora,
        sincronizar: sincronizarAutoSave,
    } = useAutoSave({
        dados: dadosAutoSave,
        ativo: editingId !== null && !ehBancoNovo,
        identidade: editingId,
        salvar: gravarBancoEmEdicao,
    });

    const handleSave = async () => {
        if (!editNome) return alert('O nome é obrigatório');

        const serializedData = JSON.stringify(editData);

        const { error } = await supabase
            .from('banks')
            .upsert({
                id: editingId && editingId > 1000000000000 ? undefined : editingId,
                nome: editNome,
                obs: serializedData
            });

        if (error) {
            console.error('Erro ao salvar:', error);
            alert('Erro ao salvar dados.');
        } else {
            sincronizarAutoSave();
            setEditingId(null);
            fetchBanks();
        }
    };

    const handleAdd = () => {
        const tempId = Date.now();
        const newBank: Bank = {
            id: tempId,
            nome: `Novo Banco`
        };
        setBanks([newBank, ...banks]);
        setEditingId(tempId);
        setEditNome(newBank.nome);
        setEditData({
            premios: { licitacao: '170,00', performanceSimples: '200,00', performanceCoberturas: '300,00', judicial: '500,00', financeiras: '500,00' },
            gerente: { nome: '', telefone: '', email: '' },
            documentos: '- Último Contrato Social;\n- Procuração, caso haja;\n- Balanço Patrimonial dos três últimos exercício;\n- O contrato/edital da demanda necessária',
            requisitos: '',
            documentosConta: ''
        });
    };

    const handleDelete = async (id: number) => {
        if (window.confirm('Deseja excluir este banco?')) {
            const { error } = await supabase.from('banks').delete().eq('id', id);
            if (!error) fetchBanks();
        }
    };

    if (loading && banks.length === 0) {
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
                    <h2 className="text-4xl font-black text-slate-800 tracking-tight">Bancos Garantidores</h2>
                    <p className="text-slate-500 font-semibold mt-1">Gerenciamento customizado de prêmios, gerentes e documentos.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar Banco..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-12 pr-6 py-4 bg-white border border-slate-200 rounded-2xl focus:ring-4 focus:ring-gold/10 outline-none min-w-[320px] shadow-sm transition-all font-medium text-slate-700"
                        />
                    </div>
                    <button
                        onClick={handleAdd}
                        className="bg-gold text-white px-8 py-4 rounded-2xl hover:bg-gold-hover transition-all shadow-xl shadow-gold/20 flex items-center gap-2 font-bold"
                    >
                        <Plus size={24} strokeWidth={3} />
                        <span className="hidden sm:inline">Novo</span>
                    </button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {filteredBanks.map(bank => {
                    const isEditing = editingId === bank.id;
                    const data = isEditing ? editData : parseBankData(bank.obs);

                    return (
                        <div key={bank.id} className={`bg-white rounded-2xl border transition-all flex flex-col group relative overflow-hidden ${isEditing ? 'ring-4 ring-gold/30 shadow-2xl z-10' : 'border-slate-100 shadow-sm hover:shadow-2xl hover:-translate-y-1'}`}>
                            <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-navy to-gold" />

                            {/* Header: Name and Actions */}
                            <div className="p-8 pb-6 flex items-center justify-between border-b border-slate-50">
                                <div className="flex-1 flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                                        <Landmark size={24} className="text-gold" />
                                    </div>
                                    {isEditing ? (
                                        <input
                                            className="font-black text-slate-800 border-b-2 border-gold outline-none bg-slate-50 px-3 py-1 text-2xl w-full rounded-t-lg"
                                            value={editNome}
                                            onChange={e => setEditNome(e.target.value)}
                                            placeholder="Nome do Banco"
                                        />
                                    ) : (
                                        <h3 className="font-black text-slate-800 text-3xl tracking-tighter leading-none">{bank.nome}</h3>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                    {isEditing ? (
                                        <div className="flex items-center gap-2">
                                            <SaveIndicator estado={autoSaveState} aoTentarNovamente={salvarBancoAgora} />
                                            <button onClick={handleSave} className="bg-emerald-500 text-white p-3 hover:bg-emerald-600 rounded-2xl transition-all shadow-lg active:scale-95"><Save size={20} /></button>
                                            <button
                                                onClick={() => { setEditingId(null); fetchBanks(); }}
                                                title={ehBancoNovo ? 'Descartar' : 'Fechar edição'}
                                                className="bg-slate-100 text-slate-500 p-3 hover:bg-slate-200 rounded-2xl transition-all"
                                            ><X size={20} /></button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEdit(bank)} className="text-slate-400 hover:text-gold transition-colors p-3 hover:bg-slate-50 rounded-2xl"><Edit3 size={20} /></button>
                                            <button onClick={() => handleDelete(bank.id)} className="text-slate-300 hover:text-rose-500 transition-colors p-3 hover:bg-rose-50 rounded-2xl"><X size={20} /></button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="p-8 space-y-8 flex-1 bg-slate-50/30">
                                {/* Prêmios Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                                        <DollarSign size={16} className="text-gold" /> Prêmios Mínimos
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {[
                                            { key: 'licitacao', label: 'Licitação' },
                                            { key: 'performanceSimples', label: 'Performance Simples' },
                                            { key: 'performanceCoberturas', label: 'Perf. com Coberturas' },
                                            { key: 'judicial', label: 'Judicial' },
                                            { key: 'financeiras', label: 'Financeiras' },
                                        ].map(prem => (
                                            <div key={prem.key} className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                                                <span className="text-xs font-bold text-slate-600">{prem.label}</span>
                                                {isEditing ? (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-slate-400 text-sm">R$</span>
                                                        <input
                                                            className="w-20 text-right font-bold text-navy outline-none border-b border-slate-200"
                                                            value={(editData.premios as any)[prem.key]}
                                                            onChange={e => setEditData({ ...editData, premios: { ...editData.premios, [prem.key]: e.target.value } })}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="font-bold text-navy text-sm bg-slate-50 px-3 py-1 rounded-xl">
                                                        R$ {(data.premios as any)[prem.key] || '---'}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Gerente Comercial Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                                        <UserCircle size={16} className="text-gold" /> Gerente Comercial
                                    </h4>
                                    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
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
                                                    <span className="font-bold text-slate-800">{data.gerente.nome || 'Não informado'}</span>
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
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                                        <FileText size={16} className="text-gold" /> Documentos Necessários
                                    </h4>
                                    {isEditing ? (
                                        <textarea
                                            className="w-full text-sm bg-white border border-slate-200 outline-none p-4 rounded-2xl min-h-[120px] font-medium leading-relaxed"
                                            value={editData.documentos}
                                            onChange={e => setEditData({ ...editData, documentos: e.target.value })}
                                            placeholder="Liste os documentos aqui..."
                                        />
                                    ) : (
                                        <div className="bg-navy/5 p-5 rounded-2xl border border-navy/5">
                                            <ul className="space-y-2">
                                                {data.documentos.split('\n').filter(l => l.trim()).map((line, i) => (
                                                    <li key={i} className="flex items-start gap-3">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-gold mt-1.5 shrink-0" />
                                                        <span className="text-sm font-medium text-slate-700 leading-relaxed">
                                                            {line.replace(/^[-*]\s*/, '')}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>

                                {/* Requisitos Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                                        <Info size={16} className="text-gold" /> Requisitos para Contratação
                                    </h4>
                                    {isEditing ? (
                                        <textarea
                                            className="w-full text-sm bg-white border border-slate-200 outline-none p-4 rounded-2xl min-h-[120px] font-medium leading-relaxed"
                                            value={editData.requisitos || ''}
                                            onChange={e => setEditData({ ...editData, requisitos: e.target.value })}
                                            placeholder="Liste os requisitos de contratação aqui..."
                                        />
                                    ) : (
                                        <div className="bg-navy/5 p-5 rounded-2xl border border-navy/5">
                                            {data.requisitos ? (
                                                <ul className="space-y-2">
                                                    {data.requisitos.split('\n').filter(l => l.trim()).map((line, i) => (
                                                        <li key={i} className="flex items-start gap-3">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-gold mt-1.5 shrink-0" />
                                                            <span className="text-sm font-medium text-slate-700 leading-relaxed">
                                                                {line.replace(/^[-*]\s*/, '')}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm font-medium text-slate-500 italic mb-0">Nenhum requisito informado.</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Documentos Conta Section */}
                                <div>
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                                        <FileText size={16} className="text-gold" /> Documentos - Abertura de Conta
                                    </h4>
                                    {isEditing ? (
                                        <textarea
                                            className="w-full text-sm bg-white border border-slate-200 outline-none p-4 rounded-2xl min-h-[120px] font-medium leading-relaxed"
                                            value={editData.documentosConta || ''}
                                            onChange={e => setEditData({ ...editData, documentosConta: e.target.value })}
                                            placeholder="Liste os documentos para abertura de conta..."
                                        />
                                    ) : (
                                        <div className="bg-navy/5 p-5 rounded-2xl border border-navy/5">
                                            {data.documentosConta ? (
                                                <ul className="space-y-2">
                                                    {data.documentosConta.split('\n').filter(l => l.trim()).map((line, i) => (
                                                        <li key={i} className="flex items-start gap-3">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-gold mt-1.5 shrink-0" />
                                                            <span className="text-sm font-medium text-slate-700 leading-relaxed">
                                                                {line.replace(/^[-*]\s*/, '')}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm font-medium text-slate-500 italic mb-0">Nenhuma informação de abertura de conta.</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                            </div>
                        </div>
                    );
                })}

                {!searchTerm && banks.length === 0 && !loading && (
                    <button
                        onClick={handleAdd}
                        className="bg-slate-50 border-4 border-dashed border-slate-100 rounded-2xl flex flex-col items-center justify-center p-12 group hover:border-gold/40 hover:bg-white transition-all min-h-[400px]"
                    >
                        <div className="w-24 h-24 rounded-2xl bg-white shadow-2xl flex items-center justify-center text-slate-200 group-hover:text-gold group-hover:scale-110 transition-all mb-8 border border-slate-50">
                            <ShieldPlus size={48} />
                        </div>
                        <span className="text-slate-400 font-bold uppercase tracking-[4px] group-hover:text-navy">Adicionar Banco</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default BanksDirectory;
