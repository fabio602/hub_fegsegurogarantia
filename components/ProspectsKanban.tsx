import React, { useState, useEffect, useRef } from 'react';
import { Plus, Upload, Search, Filter, MoreVertical, X, Loader2, GripVertical, Building, MapPin, Phone, Mail, Globe, Tag } from 'lucide-react';
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

            // Basic CSV parsing (handles quotes manually roughly, a library like papa parse is better but we'll do simple split for now)
            // Splitting by newline
            const lines = text.split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) return; // Needs header + at least 1 row

            // Get headers and normalize them
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

            const findIndex = (possibleNames: string[]) => {
                return headers.findIndex(h => possibleNames.includes(h));
            };

            const idx = {
                name: findIndex(['name', 'nome', 'contato']),
                position: findIndex(['position', 'cargo']),
                company: findIndex(['company', 'empresa']),
                description: findIndex(['description', 'descrição', 'desc']),
                country: findIndex(['country', 'país']),
                zip: findIndex(['zip', 'cep']),
                city: findIndex(['city', 'cidade']),
                state: findIndex(['state', 'estado', 'uf']),
                address: findIndex(['address', 'endereço']),
                status: findIndex(['status', 'fase']),
                source: findIndex(['source', 'origem', 'fonte']),
                email: findIndex(['email', 'e-mail']),
                website: findIndex(['website', 'site']),
                phonenumber: findIndex(['phonenumber', 'telefone', 'celular']),
                lead_value: findIndex(['lead value', 'valor', 'valor do lead']),
                tags: findIndex(['tags', 'etiquetas']),
                cnpj: findIndex(['cnpj']),
                ramo: findIndex(['ramo', 'segmento']),
                decisor: findIndex(['decisor', 'responsável'])
            };

            // Parse rows
            const newProspects = [];
            for (let i = 1; i < lines.length; i++) {
                // Regex to split by comma but ignore commas inside quotes
                const rowMatch = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
                const cols = rowMatch.map(c => c.trim().replace(/^"|"$/g, ''));

                if (cols.length === 0 || (!cols[idx.company] && !cols[idx.name])) continue;

                newProspects.push({
                    name: idx.name >= 0 ? cols[idx.name] : null,
                    position: idx.position >= 0 ? cols[idx.position] : null,
                    company: idx.company >= 0 ? cols[idx.company] : (cols[idx.name] || 'Sem Empresa'),
                    description: idx.description >= 0 ? cols[idx.description] : null,
                    country: idx.country >= 0 ? cols[idx.country] : null,
                    zip: idx.zip >= 0 ? cols[idx.zip] : null,
                    city: idx.city >= 0 ? cols[idx.city] : null,
                    state: idx.state >= 0 ? cols[idx.state] : null,
                    address: idx.address >= 0 ? cols[idx.address] : null,
                    status: (idx.status >= 0 && cols[idx.status]) ? cols[idx.status] : 'Novos Leads',
                    source: idx.source >= 0 ? cols[idx.source] : null,
                    email: idx.email >= 0 ? cols[idx.email] : null,
                    website: idx.website >= 0 ? cols[idx.website] : null,
                    phonenumber: idx.phonenumber >= 0 ? cols[idx.phonenumber] : null,
                    lead_value: (idx.lead_value >= 0 && cols[idx.lead_value]) ? parseFloat(cols[idx.lead_value].replace(/[^0-9.-]+/g, "")) || 0 : 0,
                    tags: (idx.tags >= 0 && cols[idx.tags]) ? cols[idx.tags].split(';').map(t => t.trim()) : [],
                    cnpj: idx.cnpj >= 0 ? cols[idx.cnpj] : null,
                    ramo: idx.ramo >= 0 ? cols[idx.ramo] : null,
                    decisor: idx.decisor >= 0 ? cols[idx.decisor] : null,
                });
            }

            if (newProspects.length > 0) {
                // Insert in batches of 100 to avoid limits
                for (let i = 0; i < newProspects.length; i += 100) {
                    const batch = newProspects.slice(i, i + 100);
                    const { error } = await supabase.from('prospects').insert(batch);
                    if (error) console.error("Batch insert error:", error);
                }
                await fetchProspects();
                alert(`${newProspects.length} leads importados com sucesso!`);
            }
        } catch (error) {
            console.error('Error importing CSV:', error);
            alert('Erro ao importar arquivo. Verifique se o formato está correto.');
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
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
                    <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2">
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
        </div>
    );
};

export default ProspectsKanban;
