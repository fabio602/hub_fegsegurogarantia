import React, { useState, useEffect, useRef } from 'react';
import { Plus, Upload, Search, Filter, MoreVertical, X, Loader2, GripVertical, Building, MapPin, Phone, Mail, Globe, Tag, Save, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Prospect } from '../types';
import { formatCurrency } from '../utils/formatters';

const KANBAN_COLUMNS = [
    { id: 'Novos Leads', title: 'Novos Leads', headerColor: 'bg-slate-800 text-white', badgeColor: 'bg-white/20 text-white' },
    { id: 'Leads Sem demanda', title: 'Sem Demanda', headerColor: 'bg-rose-500 text-white', badgeColor: 'bg-white/20 text-white' },
    { id: 'Leads Rafael', title: 'Leads Rafael', headerColor: 'bg-emerald-500 text-white', badgeColor: 'bg-white/20 text-white' },
    { id: 'Leads Andréia', title: 'Leads Andréia', headerColor: 'bg-purple-500 text-white', badgeColor: 'bg-white/20 text-white' },
];

const ProspectsKanban: React.FC = () => {
    const [prospects, setProspects] = useState<Prospect[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    // CSV Import State
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [csvRows, setCsvRows] = useState<string[][]>([]);
    const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});

    // New Lead Modal State
    const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
    const [newLeadForm, setNewLeadForm] = useState<Partial<Prospect>>({ status: 'Novos Leads' });
    const [savingLead, setSavingLead] = useState(false);

    const DB_FIELDS = [
        { key: 'name', label: 'Nome do Contato' },
        { key: 'company', label: 'Empresa (Obrigatório)' },
        { key: 'position', label: 'Cargo' },
        { key: 'decisor', label: 'Decisor/Responsável' },
        { key: 'phonenumber', label: 'Telefone' },
        { key: 'email', label: 'E-mail' },
        { key: 'lead_value', label: 'Valor Estimado (R$)' },
        { key: 'status', label: 'Fase/Coluna' },
        { key: 'source', label: 'Origem' },
        { key: 'cnpj', label: 'CNPJ' },
        { key: 'ramo', label: 'Ramo de Atividade' },
        { key: 'city', label: 'Cidade' },
        { key: 'state', label: 'Estado (UF)' },
        { key: 'description', label: 'Observações' },
    ];

    useEffect(() => {
        fetchProspects();
    }, []);

    const fetchProspects = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('prospects')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setProspects(data || []);
        } catch (error) {
            console.error('Error fetching prospects:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDragStart = (e: React.DragEvent, prospectId: string) => {
        e.dataTransfer.setData('prospectId', prospectId);
        setIsDragging(true);
    };

    const handleDragEnd = () => {
        setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
    };

    const handleDrop = async (e: React.DragEvent, statusId: string) => {
        e.preventDefault();
        setIsDragging(false);
        const prospectId = e.dataTransfer.getData('prospectId');

        if (!prospectId) return;

        // Optimistically update UI
        setProspects(prev => prev.map(p =>
            p.id === prospectId ? { ...p, status: statusId } : p
        ));

        try {
            const { error } = await supabase
                .from('prospects')
                .update({ status: statusId })
                .eq('id', prospectId);

            if (error) throw error;
        } catch (error) {
            console.error('Error updating status:', error);
            fetchProspects(); // Revert on error
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImporting(true);
        try {
            const text = await file.text();
            const lines = text.split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) {
                alert('O arquivo precisa ter uma linha de cabeçalho e pelo menos um lead.');
                return;
            }

            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            const dataRows = [];

            for (let i = 1; i < lines.length; i++) {
                const rowMatch = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
                const cols = rowMatch.map(c => c.trim().replace(/^"|"$/g, ''));
                if (cols.length > 0) dataRows.push(cols);
            }

            setCsvHeaders(headers);
            setCsvRows(dataRows);

            // Auto-guess mapping based on common names
            const initialMapping: Record<string, string> = {};
            const guessMap: Record<string, string[]> = {
                name: ['name', 'nome', 'contato'],
                company: ['company', 'empresa', 'cliente', 'razao social'],
                position: ['position', 'cargo'],
                decisor: ['decisor', 'responsável', 'responsavel'],
                phonenumber: ['phone', 'telefone', 'celular', 'whatsapp'],
                email: ['email', 'e-mail'],
                lead_value: ['value', 'valor', 'valor do lead', 'premio', 'prêmio'],
                status: ['status', 'fase', 'etapa'],
                source: ['source', 'origem', 'fonte'],
                cnpj: ['cnpj', 'documento'],
                ramo: ['ramo', 'segmento', 'setor'],
                city: ['city', 'cidade'],
                state: ['state', 'estado', 'uf']
            };

            DB_FIELDS.forEach(field => {
                const guessArr = guessMap[field.key] || [];
                const matchedIndex = headers.findIndex(h => guessArr.includes(h.toLowerCase()));
                if (matchedIndex >= 0) {
                    initialMapping[field.key] = matchedIndex.toString();
                }
            });

            setCsvMapping(initialMapping);
            setIsImportModalOpen(true);
        } catch (error) {
            console.error('Error reading CSV:', error);
            alert('Erro ao ler o arquivo CSV.');
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleConfirmImport = async () => {
        setImporting(true);
        try {
            const newProspects = [];

            for (const row of csvRows) {
                const getVal = (fieldKey: string) => {
                    const colIndex = csvMapping[fieldKey];
                    return (colIndex !== undefined && row[Number(colIndex)]) ? row[Number(colIndex)] : null;
                };

                const companyVal = getVal('company');
                const nameVal = getVal('name');

                if (!companyVal && !nameVal) continue; // Skip empty/invalid rows

                let leadVal = 0;
                const rawVal = getVal('lead_value');
                if (rawVal) leadVal = parseFloat(rawVal.replace(/[^0-9.-]+/g, "")) || 0;

                newProspects.push({
                    name: nameVal,
                    company: companyVal || nameVal || 'Sem Empresa',
                    position: getVal('position'),
                    decisor: getVal('decisor'),
                    phonenumber: getVal('phonenumber'),
                    email: getVal('email'),
                    lead_value: leadVal,
                    status: getVal('status') || 'Novos Leads',
                    source: getVal('source'),
                    cnpj: getVal('cnpj'),
                    ramo: getVal('ramo'),
                    city: getVal('city'),
                    state: getVal('state'),
                    description: getVal('description')
                });
            }

            if (newProspects.length > 0) {
                for (let i = 0; i < newProspects.length; i += 100) {
                    const batch = newProspects.slice(i, i + 100);
                    const { error } = await supabase.from('prospects').insert(batch);
                    if (error) throw error;
                }
                await fetchProspects();
                alert(`${newProspects.length} leads importados com sucesso!`);
                setIsImportModalOpen(false);
            } else {
                alert('Nenhum dado válido para importar. Verifique se escolheu a coluna de Empresa.');
            }
        } catch (error) {
            console.error('Import error:', error);
            alert('Erro ao salvar no banco de dados. Tente novamente.');
        } finally {
            setImporting(false);
        }
    };

    const handleCreateNewLead = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newLeadForm.company && !newLeadForm.name) {
            alert("É necessário preencher a Empresa ou o Nome do Contato.");
            return;
        }

        setSavingLead(true);
        try {
            const { error } = await supabase.from('prospects').insert([{
                ...newLeadForm,
                company: newLeadForm.company || newLeadForm.name
            }]);

            if (error) throw error;

            await fetchProspects();
            setIsNewLeadModalOpen(false);
            setNewLeadForm({ status: 'Novos Leads' }); // Reset form
        } catch (error) {
            console.error('Error saving lead:', error);
            alert('Erro ao salvar o lead.');
        } finally {
            setSavingLead(false);
        }
    };

    const filteredProspects = prospects.filter(p =>
        (p.company?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        (p.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        (p.email?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        (p.cnpj || '').includes(searchQuery)
    );

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 size={40} className="animate-spin mb-4 text-[#C69C6D]" />
                <p className="font-bold uppercase tracking-widest text-xs">Carregando prospectos...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsNewLeadModalOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2"
                    >
                        <Plus size={18} /> Novo Lead
                    </button>

                    <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                        className="bg-[#1B263B] hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-70"
                    >
                        {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                        {importing ? 'Importando...' : 'Importar Leads (CSV)'}
                    </button>

                    <div className="h-8 w-[1px] bg-slate-200 mx-2 hidden md:block"></div>
                </div>

                <div className="relative w-full md:w-64">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Procurar leads..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                    />
                </div>
            </div>

            {/* Kanban Board Container */}
            <div className="flex gap-6 overflow-x-auto pb-8 custom-scroll items-start min-h-[600px]">
                {KANBAN_COLUMNS.map(column => {
                    const columnProspects = filteredProspects.filter(p => p.status === column.id);
                    const totalValue = columnProspects.reduce((sum, p) => sum + (p.lead_value || 0), 0);

                    return (
                        <div
                            key={column.id}
                            className="flex-shrink-0 w-80 flex flex-col gap-4"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, column.id)}
                        >
                            {/* Column Header */}
                            <div className={`p-4 rounded-xl shadow-sm flex flex-col gap-1 ${column.headerColor}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="font-black text-sm uppercase tracking-wider flex items-center gap-2">
                                        <GripVertical size={14} className="opacity-50" />
                                        {column.title}
                                    </h3>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${column.badgeColor}`}>
                                        {columnProspects.length}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <p className="text-xs font-bold opacity-80">{formatCurrency(totalValue)}</p>
                                </div>
                            </div>

                            {/* Cards Container */}
                            <div className={`flex-1 flex flex-col gap-3 min-h-[100px] rounded-2xl p-2 transition-colors ${isDragging ? 'bg-slate-100/50 border border-dashed border-slate-300' : 'bg-transparent'}`}>
                                {columnProspects.map(prospect => (
                                    <div
                                        key={prospect.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, prospect.id)}
                                        onDragEnd={handleDragEnd}
                                        className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-indigo-200 transition-all flex flex-col gap-3"
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
                                                    <Building size={14} className="text-slate-500" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="font-black text-slate-800 text-sm truncate" title={prospect.company || prospect.name}>
                                                        {prospect.company || prospect.name || 'Nova Empresa'}
                                                    </h4>
                                                    <p className="text-[10px] font-bold text-slate-400 truncate">
                                                        {prospect.ramo || prospect.position || 'Sem Categoria'}
                                                    </p>
                                                </div>
                                            </div>
                                            <button className="text-slate-300 hover:text-slate-500 transition-colors">
                                                <MoreVertical size={16} />
                                            </button>
                                        </div>

                                        <div className="flex flex-col gap-1.5 mt-1">
                                            {prospect.decisor && (
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <span className="font-bold text-slate-400 text-[10px] uppercase w-12 shrink-0">Decisor:</span>
                                                    <span className="truncate">{prospect.decisor}</span>
                                                </div>
                                            )}
                                            {prospect.phonenumber && (
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <Phone size={12} className="text-slate-400 shrink-0" />
                                                    <span className="truncate">{prospect.phonenumber}</span>
                                                </div>
                                            )}
                                            {prospect.email && (
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <Mail size={12} className="text-slate-400 shrink-0" />
                                                    <span className="truncate">{prospect.email}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Valor Estimado</span>
                                                <span className="text-xs font-black text-emerald-600">{formatCurrency(prospect.lead_value || 0)}</span>
                                            </div>

                                            {prospect.source && (
                                                <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-md max-w-[80px] truncate">
                                                    {prospect.source}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {columnProspects.length === 0 && !isDragging && (
                                    <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                                            <Loader2 size={16} className="opacity-50" />
                                        </div>
                                        <p className="text-xs font-bold">Nenhum lead</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* New Lead Modal */}
            {isNewLeadModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-black text-slate-800">Criar Novo Lead</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">Cadastre manualmente os dados da prospecção.</p>
                            </div>
                            <button onClick={() => setIsNewLeadModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            <form id="new-lead-form" onSubmit={handleCreateNewLead} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4 col-span-2">
                                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Informações Principais</h4>
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Empresa *</label>
                                    <input required type="text" value={newLeadForm.company || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, company: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Nome da Empresa" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">CNPJ</label>
                                    <input type="text" value={newLeadForm.cnpj || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, cnpj: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="00.000.000/0001-00" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Nome do Contato</label>
                                    <input type="text" value={newLeadForm.name || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Ciclano da Silva" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Cargo do Contato</label>
                                    <input type="text" value={newLeadForm.position || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, position: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Diretor Financeiro" />
                                </div>

                                <div className="space-y-4 col-span-2 mt-4">
                                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Contato & Detalhes</h4>
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Telefone / Celular</label>
                                    <input type="text" value={newLeadForm.phonenumber || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, phonenumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="(00) 00000-0000" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">E-mail</label>
                                    <input type="email" value={newLeadForm.email || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, email: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="contato@empresa.com.br" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Ramo</label>
                                    <input type="text" value={newLeadForm.ramo || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, ramo: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Engenharia / Construtora" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Valor Estimado (Lead Value)</label>
                                    <input type="number" step="0.01" value={newLeadForm.lead_value || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, lead_value: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="150000.00" />
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Fase (Coluna)</label>
                                    <select value={newLeadForm.status || 'Novos Leads'} onChange={(e) => setNewLeadForm({ ...newLeadForm, status: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all cursor-pointer">
                                        {KANBAN_COLUMNS.map(col => (
                                            <option key={col.id} value={col.id}>{col.title}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1.5 col-span-2 md:col-span-1">
                                    <label className="text-sm font-bold text-slate-700">Origem do Contato</label>
                                    <input type="text" value={newLeadForm.source || ''} onChange={(e) => setNewLeadForm({ ...newLeadForm, source: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Ex: Conlicitação, PNCP, Indicação" />
                                </div>
                            </form>
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 mt-auto">
                            <button
                                type="button"
                                onClick={() => setIsNewLeadModalOpen(false)}
                                className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                form="new-lead-form"
                                disabled={savingLead}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                            >
                                {savingLead ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {savingLead ? 'Salvando...' : 'Salvar Lead'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CSV Mapping Modal */}
            {isImportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-black text-slate-800">Mapear Colunas do CSV</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">Nós encontramos <strong className="text-indigo-600">{csvRows.length}</strong> leads no arquivo. Indique a qual coluna as informações pertencem.</p>
                            </div>
                            <button onClick={() => setIsImportModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            {/* Warning Card */}
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex items-start gap-4 text-amber-800">
                                <div className="mt-0.5"><Loader2 size={20} className="text-amber-500" /></div>
                                <div>
                                    <h4 className="font-bold">Atenção ao mapeamento</h4>
                                    <p className="text-sm mt-1 opacity-90">Verifique os mapeamentos sugeridos automaticamente. Pelo menos a "Empresa" ou o "Nome do Contato" devem estar mapeados, senão a linha inteira será ignorada.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                                {DB_FIELDS.map(field => (
                                    <div key={field.key} className="flex flex-col gap-1.5 p-3 rounded-xl hover:bg-slate-50 border-2 border-transparent hover:border-slate-100 transition-colors">
                                        <label className="text-sm font-bold text-slate-700">{field.label}</label>
                                        <div className="relative">
                                            <select
                                                value={csvMapping[field.key] || ''}
                                                onChange={(e) => setCsvMapping({ ...csvMapping, [field.key]: e.target.value })}
                                                className="w-full px-4 py-2.5 pr-10 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer appearance-none shadow-sm font-medium"
                                            >
                                                <option value="" className="text-slate-400 font-normal">-- Ignorar (Não Importar) --</option>
                                                {csvHeaders.map((h, i) => (
                                                    <option key={i} value={i.toString()}>Coluna: {h}</option>
                                                ))}
                                            </select>
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                <Tag size={14} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 mt-auto">
                            <button
                                type="button"
                                onClick={() => setIsImportModalOpen(false)}
                                className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmImport}
                                disabled={importing}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                            >
                                {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                                {importing ? 'Importando...' : 'Confirmar Importação'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProspectsKanban;
