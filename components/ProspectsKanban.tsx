import React, { useState, useEffect, useRef } from 'react';
import { Plus, Upload, Search, MoreVertical, X, Loader2, GripVertical, Building, Phone, Mail, Tag, Save, ArrowRight, Edit2, MoveRight, TrendingUp, Trash2, LayoutGrid, Palette } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Prospect } from '../types';
import { formatCurrency } from '../utils/formatters';

interface KanbanColumn {
    id: string;
    title: string;
    color: string; // tailwind bg color key
    protected?: boolean;
}

const COLOR_OPTIONS = [
    { key: 'slate', label: 'Cinza', header: 'bg-slate-800 text-white' },
    { key: 'rose', label: 'Vermelho', header: 'bg-rose-500 text-white' },
    { key: 'emerald', label: 'Verde', header: 'bg-emerald-500 text-white' },
    { key: 'purple', label: 'Roxo', header: 'bg-purple-500 text-white' },
    { key: 'blue', label: 'Azul', header: 'bg-blue-500 text-white' },
    { key: 'amber', label: 'Laranja', header: 'bg-amber-500 text-white' },
    { key: 'indigo', label: 'Índigo', header: 'bg-indigo-600 text-white' },
    { key: 'pink', label: 'Rosa', header: 'bg-pink-500 text-white' },
    { key: 'cyan', label: 'Ciano', header: 'bg-cyan-500 text-white' },
    { key: 'teal', label: 'Teal', header: 'bg-teal-500 text-white' },
];

const colorToHeader = (colorKey: string) => {
    const found = COLOR_OPTIONS.find(c => c.key === colorKey);
    return found ? found.header : 'bg-slate-700 text-white';
};

const DEFAULT_COLUMNS: KanbanColumn[] = [
    { id: 'Novos Leads', title: 'Novos Leads', color: 'slate', protected: true },
    { id: 'Leads Sem demanda', title: 'Sem Demanda', color: 'rose' },
    { id: 'Leads Rafael', title: 'Leads Rafael', color: 'emerald' },
    { id: 'Leads Andréia', title: 'Leads Andréia', color: 'purple' },
];

const STORAGE_KEY = 'kanban_columns_v1';

const loadColumns = (): KanbanColumn[] => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
};

const saveColumns = (cols: KanbanColumn[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
};

interface ProspectsKanbanProps {
    onConvertToSale?: (data: { nome: string; cnpj: string; telefone: string; email: string; decisor: string }) => void;
}

const LeadFormFields = ({ 
    form, 
    setForm, 
    columns, 
    selectedProduct 
}: { 
    form: Partial<Prospect>; 
    setForm: (v: Partial<Prospect>) => void;
    columns: KanbanColumn[];
    selectedProduct: string;
}) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4 col-span-2">
            <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Informações Principais</h4>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Empresa *</label>
            <input required type="text" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Nome da Empresa" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">CNPJ</label>
            <input type="text" value={form.cnpj || ''} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="00.000.000/0001-00" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Nome do Contato</label>
            <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Ciclano da Silva" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Cargo do Contato</label>
            <input type="text" value={form.position || ''} onChange={(e) => setForm({ ...form, position: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Diretor Financeiro" />
        </div>
        <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">Decisor / Responsável</label>
            <input type="text" value={form.decisor || ''} onChange={(e) => setForm({ ...form, decisor: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Nome do decisor" />
        </div>
        <div className="space-y-4 col-span-2 mt-2">
            <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Contato & Detalhes</h4>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Telefone / Celular</label>
            <input type="text" value={form.phonenumber || ''} onChange={(e) => setForm({ ...form, phonenumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="(00) 00000-0000" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">E-mail</label>
            <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="contato@empresa.com.br" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Ramo</label>
            <input type="text" value={form.ramo || ''} onChange={(e) => setForm({ ...form, ramo: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Engenharia / Construtora" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Valor Estimado</label>
            <input type="number" step="0.01" value={form.lead_value || ''} onChange={(e) => setForm({ ...form, lead_value: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="150000.00" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Fase (Coluna)</label>
            <select value={form.status || 'Novos Leads'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all cursor-pointer">
                {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
            </select>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Origem do Contato</label>
            <input type="text" value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="Ex: Conlicitação, PNCP, Indicação" />
        </div>
        {/* ── ADDITIONAL JUDICIAL FIELDS ── */}
        {selectedProduct === 'Judicial Depósito Recursal' && (
            <>
                <div className="space-y-4 col-span-2 mt-4">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Dados do Processo</h4>
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                    <label className="text-sm font-bold text-slate-700">Nº do Processo</label>
                    <input type="text" value={form.judicial_process_number || ''} onChange={(e) => setForm({ ...form, judicial_process_number: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="0000000-00.0000.0.00.0000" />
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                    <label className="text-sm font-bold text-slate-700">Tribunal / Vara</label>
                    <input type="text" value={form.judicial_court || ''} onChange={(e) => setForm({ ...form, judicial_court: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all" placeholder="TRT / Vara do Trabalho" />
                </div>
            </>
        )}

        <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">Observações</label>
            <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all resize-none" placeholder="Anotações sobre este lead..." />
        </div>
    </div>
);

const ProspectsKanban: React.FC<ProspectsKanbanProps> = ({ onConvertToSale }) => {
    const [columns, setColumns] = useState<KanbanColumn[]>(loadColumns);
    const [prospects, setProspects] = useState<Prospect[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<'Seguro Garantia' | 'Judicial Depósito Recursal'>('Seguro Garantia');
    const [isDragging, setIsDragging] = useState(false);

    // CSV Import State
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [csvRows, setCsvRows] = useState<string[][]>([]);
    const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
    const [importStatus, setImportStatus] = useState('Novos Leads');

    // New Lead Modal State
    const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
    const [newLeadForm, setNewLeadForm] = useState<Partial<Prospect>>({ status: 'Novos Leads' });
    const [savingLead, setSavingLead] = useState(false);

    // Edit Lead Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<Prospect | null>(null);
    const [editLeadForm, setEditLeadForm] = useState<Partial<Prospect>>({});

    // Context Menu State
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Add Column Modal
    const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
    const [newColTitle, setNewColTitle] = useState('');
    const [newColColor, setNewColColor] = useState('blue');

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
        { key: 'judicial_process_number', label: 'Nº do Processo (Judicial)' },
        { key: 'judicial_court', label: 'Tribunal/Vara (Judicial)' },
        { key: 'description', label: 'Observações' },
    ];

    useEffect(() => { fetchProspects(); }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchProspects = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('prospects').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            setProspects(data || []);
        } catch (error) {
            console.error('Error fetching prospects:', error);
        } finally {
            setLoading(false);
        }
    };

    // ---- Column management ----
    const handleAddColumn = () => {
        if (!newColTitle.trim()) return;
        const id = `col_${Date.now()}`;
        const updated = [...columns, { id, title: newColTitle.trim(), color: newColColor }];
        setColumns(updated);
        saveColumns(updated);
        setNewColTitle('');
        setNewColColor('blue');
        setIsAddColumnOpen(false);
    };

    const handleDeleteColumn = async (colId: string) => {
        const col = columns.find(c => c.id === colId);
        if (!col || col.protected) return;

        const leadsInCol = prospects.filter(p => p.status === colId).length;
        const msg = leadsInCol > 0
            ? `A coluna "${col.title}" tem ${leadsInCol} lead(s). Eles serão movidos para "Novos Leads". Deseja continuar?`
            : `Deseja excluir a coluna "${col.title}"?`;

        if (!confirm(msg)) return;

        // Move leads to Novos Leads
        if (leadsInCol > 0) {
            await supabase.from('prospects').update({ status: 'Novos Leads' }).eq('status', colId);
            setProspects(prev => prev.map(p => p.status === colId ? { ...p, status: 'Novos Leads' } : p));
        }

        const updated = columns.filter(c => c.id !== colId);
        setColumns(updated);
        saveColumns(updated);
    };

    // ---- Drag & Drop for CARDS ----
    const handleDragStart = (e: React.DragEvent, prospectId: string) => {
        e.stopPropagation();
        e.dataTransfer.setData('type', 'card');
        e.dataTransfer.setData('prospectId', prospectId);
        setIsDragging(true);
    };
    const handleDragEnd = () => setIsDragging(false);
    
    // ---- Drag & Drop for COLUMNS ----
    const [draggingCol, setDraggingCol] = useState<string | null>(null);

    const handleColDragStart = (e: React.DragEvent, colId: string) => {
        e.dataTransfer.setData('type', 'column');
        e.dataTransfer.setData('colId', colId);
        setDraggingCol(colId);
    };

    const handleColDragEnd = () => setDraggingCol(null);

    const handleColDrop = (e: React.DragEvent, targetColId: string) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('type');
        if (type !== 'column') return; // let the card drop handler deal with it if it's a card

        const draggedColId = e.dataTransfer.getData('colId');
        if (!draggedColId || draggedColId === targetColId) return;

        const updatedColumns = [...columns];
        const draggedIdx = updatedColumns.findIndex(c => c.id === draggedColId);
        const targetIdx = updatedColumns.findIndex(c => c.id === targetColId);

        if (draggedIdx !== -1 && targetIdx !== -1) {
            const [draggedCol] = updatedColumns.splice(draggedIdx, 1);
            updatedColumns.splice(targetIdx, 0, draggedCol);
            setColumns(updatedColumns);
            saveColumns(updatedColumns);
        }
        setDraggingCol(null);
    };

    const handleDragOver = (e: React.DragEvent) => e.preventDefault();

    const handleDrop = async (e: React.DragEvent, statusId: string) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('type');
        
        // If it's a column drop, forward to column handler
        if (type === 'column') {
            handleColDrop(e, statusId);
            return;
        }

        // Otherwise handle card drop
        setIsDragging(false);
        const prospectId = e.dataTransfer.getData('prospectId');
        if (!prospectId) return;
        setProspects(prev => prev.map(p => p.id === prospectId ? { ...p, status: statusId } : p));
        try {
            const { error } = await supabase.from('prospects').update({ status: statusId }).eq('id', prospectId);
            if (error) throw error;
        } catch (error) {
            console.error('Error updating status:', error);
            fetchProspects();
        }
    };

    const handleMoveToColumn = async (prospectId: string, newStatus: string) => {
        setOpenMenuId(null);
        setProspects(prev => prev.map(p => p.id === prospectId ? { ...p, status: newStatus } : p));
        try {
            await supabase.from('prospects').update({ status: newStatus }).eq('id', prospectId);
        } catch (error) {
            console.error('Error moving lead:', error);
            fetchProspects();
        }
    };

    const handleDeleteLead = async (prospectId: string) => {
        setOpenMenuId(null);
        if (!confirm('Deseja excluir este lead permanentemente?')) return;
        setProspects(prev => prev.filter(p => p.id !== prospectId));
        try {
            await supabase.from('prospects').delete().eq('id', prospectId);
        } catch (error) {
            console.error('Error deleting lead:', error);
            fetchProspects();
        }
    };

    const handleOpenEdit = (prospect: Prospect) => {
        setOpenMenuId(null);
        setEditingLead(prospect);
        
        // Limpa valores 'nan' que vêm da importação do Excel para não atrapalhar a edição
        const cleanedForm = { ...prospect };
        Object.keys(cleanedForm).forEach(key => {
            const val = (cleanedForm as any)[key];
            if (val === 'nan' || val === 'undefined' || val === null) {
                (cleanedForm as any)[key] = '';
            }
        });

        // Garante que o campo Empresa tenha algum valor se estiver vazio
        if (!cleanedForm.company) cleanedForm.company = prospect.name || '';

        setEditLeadForm(cleanedForm);
        setIsEditModalOpen(true);
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingLead) return;
        setSavingLead(true);
        try {
            const { error } = await supabase.from('prospects').update(editLeadForm).eq('id', editingLead.id);
            if (error) throw error;
            setProspects(prev => prev.map(p => p.id === editingLead.id ? { ...p, ...editLeadForm } as Prospect : p));
            setIsEditModalOpen(false);
            setEditingLead(null);
        } catch (error) {
            console.error('Error updating lead:', error);
            alert('Erro ao salvar alterações.');
        } finally {
            setSavingLead(false);
        }
    };

    const handleConvertToSale = (prospect: Prospect) => {
        setOpenMenuId(null);
        if (onConvertToSale) {
            onConvertToSale({
                nome: prospect.company || prospect.name || '',
                cnpj: prospect.cnpj || '',
                telefone: prospect.phonenumber || '',
                email: prospect.email || '',
                decisor: prospect.decisor || '',
            });
        }
    };

    // ---- CSV ----
    const parseCsvRow = (line: string, delimiter: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (char === delimiter && !inQuotes) {
                result.push(current.trim()); current = '';
            } else { current += char; }
        }
        result.push(current.trim());
        return result;
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        try {
            const text = await file.text();
            const lines = text.split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) { alert('O arquivo precisa ter uma linha de cabeçalho e pelo menos um lead.'); return; }
            const delimiter = lines[0].includes(';') ? ';' : ',';
            const headers = parseCsvRow(lines[0], delimiter);
            const dataRows: string[][] = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = parseCsvRow(lines[i], delimiter);
                if (cols.some(c => c !== '')) dataRows.push(cols);
            }
            setCsvHeaders(headers);
            setCsvRows(dataRows);
            const initialMapping: Record<string, string> = {};
            const guessMap: Record<string, string[]> = {
                name: ['name','nome','contato'], company: ['company','empresa','cliente','razao social'],
                position: ['position','cargo'], decisor: ['decisor','responsável','responsavel'],
                phonenumber: ['phone','telefone','celular','whatsapp'], email: ['email','e-mail'],
                lead_value: ['value','valor','valor do lead','premio','prêmio'], status: ['status','fase','etapa'],
                source: ['source','origem','fonte'], cnpj: ['cnpj','documento'],
                ramo: ['ramo','segmento','setor'], city: ['city','cidade'], state: ['state','estado','uf']
            };
            DB_FIELDS.forEach(field => {
                const guessArr = guessMap[field.key] || [];
                const matchedIndex = headers.findIndex(h => guessArr.includes(h.toLowerCase()));
                if (matchedIndex >= 0) initialMapping[field.key] = matchedIndex.toString();
            });
            setCsvMapping(initialMapping);
            setIsImportModalOpen(true);
        } catch (error) { console.error('Error reading CSV:', error); alert('Erro ao ler o arquivo CSV.'); }
        finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
    };

    const handleConfirmImport = async () => {
        setImporting(true);
        try {
            // Fetch existing leads to check for duplicates
            const { data: existingLeads } = await supabase.from('prospects').select('cnpj, email');
            const existingCnpjs = new Set((existingLeads || []).map(l => l.cnpj?.replace(/\D/g, '')).filter(Boolean));
            const existingEmails = new Set((existingLeads || []).map(l => l.email?.toLowerCase()).filter(Boolean));

            const newProspects: any[] = [];
            let duplicatesCount = 0;
            const validStatuses = columns.map(col => col.id);

            for (const row of csvRows) {
                const getVal = (fieldKey: string) => {
                    const colIndex = csvMapping[fieldKey];
                    if (colIndex === undefined || colIndex === null || colIndex === "") return null;
                    const val = row[Number(colIndex)];
                    return val ? val.trim() : null;
                };

                const companyVal = getVal('company');
                const nameVal = getVal('name');
                if (!companyVal && !nameVal) continue;

                const emailVal = getVal('email');
                const cnpjVal = getVal('cnpj');
                const cleanCnpj = cnpjVal ? cnpjVal.replace(/\D/g, '') : null;

                // Check for duplicates
                const isDuplicateCNPJ = cleanCnpj && existingCnpjs.has(cleanCnpj);
                const isDuplicateEmail = emailVal && existingEmails.has(emailVal.toLowerCase());

                if (isDuplicateCNPJ || isDuplicateEmail) {
                    duplicatesCount++;
                    continue;
                }

                // If not duplicate, add to list and also to our local sets to prevent duplicates WITHIN the same CSV
                if (cleanCnpj) existingCnpjs.add(cleanCnpj);
                if (emailVal) existingEmails.add(emailVal.toLowerCase());

                let leadVal = 0;
                const rawVal = getVal('lead_value');
                if (rawVal) leadVal = parseFloat(rawVal.replace(/[^0-9.-]+/g, "")) || 0;

                const rawStatus = getVal('status');
                const status = (rawStatus && validStatuses.includes(rawStatus)) ? rawStatus : importStatus;

                let rawPhone = getVal('phonenumber');
                let formattedPhone = rawPhone;
                if (rawPhone) {
                    let digitsOnly = rawPhone.replace(/\D/g, '');
                    if ((digitsOnly.length === 12 || digitsOnly.length === 13) && digitsOnly.startsWith('55')) {
                        digitsOnly = digitsOnly.slice(2);
                    }
                    if (digitsOnly.length === 10) {
                        formattedPhone = `(${digitsOnly.slice(0, 2)}) ${digitsOnly.slice(2, 6)}-${digitsOnly.slice(6)}`;
                    } else if (digitsOnly.length === 11) {
                        formattedPhone = `(${digitsOnly.slice(0, 2)}) ${digitsOnly.slice(2, 7)}-${digitsOnly.slice(7)}`;
                    }
                }

                newProspects.push({
                    name: nameVal,
                    company: companyVal || nameVal || 'Sem Empresa',
                    position: getVal('position'),
                    decisor: getVal('decisor'),
                    phonenumber: formattedPhone,
                    email: emailVal,
                    lead_value: leadVal,
                    status,
                    source: getVal('source'),
                    cnpj: cnpjVal,
                    ramo: getVal('ramo'),
                    city: getVal('city'),
                    state: getVal('state'),
                    description: getVal('description'),
                    product_type: selectedProduct,
                    judicial_process_number: getVal('judicial_process_number'),
                    judicial_court: getVal('judicial_court')
                });
            }

            if (newProspects.length > 0) {
                for (let i = 0; i < newProspects.length; i += 100) {
                    const batch = newProspects.slice(i, i + 100);
                    const { error } = await supabase.from('prospects').insert(batch);
                    if (error) throw error;
                }
                await fetchProspects();
                
                let msg = `${newProspects.length} leads foram incluídos`;
                if (duplicatesCount > 0) {
                    msg += ` e ${duplicatesCount} são repetidos e não foram incluídos.`;
                } else {
                    msg += ` com sucesso!`;
                }
                alert(msg);
                setIsImportModalOpen(false);
            } else if (duplicatesCount > 0) {
                alert(`Nenhum lead novo incluído. Todos os ${duplicatesCount} leads do arquivo já existem no sistema.`);
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
        if (!newLeadForm.company && !newLeadForm.name) { alert("É necessário preencher a Empresa ou o Nome do Contato."); return; }
        setSavingLead(true);
        try {
            const { error } = await supabase.from('prospects').insert([{ 
                ...newLeadForm, 
                company: newLeadForm.company || newLeadForm.name,
                product_type: selectedProduct // Herda o produto selecionado
            }]);
            if (error) throw error;
            await fetchProspects();
            setIsNewLeadModalOpen(false);
            setNewLeadForm({ status: 'Novos Leads' });
        } catch (error) { console.error('Error saving lead:', error); alert('Erro ao salvar o lead.'); }
        finally { setSavingLead(false); }
    };

    const filteredProspects = prospects.filter(p => {
        const matchesProduct = p.product_type === selectedProduct || (!p.product_type && selectedProduct === 'Seguro Garantia');
        const matchesSearch = (p.company?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.email?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.cnpj || '').includes(searchQuery);
        return matchesProduct && matchesSearch;
    });

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
            {/* Product Switcher */}
            <div className="flex justify-center mb-6">
                <div className="bg-slate-100 p-1 rounded-2xl flex gap-1 shadow-sm border border-slate-200">
                    <button 
                        onClick={() => setSelectedProduct('Seguro Garantia')}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${selectedProduct === 'Seguro Garantia' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}
                    >
                        Seguro Garantia
                    </button>
                    <button 
                        onClick={() => setSelectedProduct('Judicial Depósito Recursal')}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${selectedProduct === 'Judicial Depósito Recursal' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}
                    >
                        Judicial Depósito Recursal
                    </button>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => setIsNewLeadModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2">
                        <Plus size={18} /> Novo Lead
                    </button>
                    <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-[#1B263B] hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-70">
                        {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                        {importing ? 'Importando...' : 'Importar Leads (CSV)'}
                    </button>
                    <div className="h-8 w-[1px] bg-slate-200 mx-1 hidden md:block" />
                    <button onClick={() => setIsAddColumnOpen(true)} className="bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm flex items-center gap-2">
                        <LayoutGrid size={16} /> Nova Coluna
                    </button>
                </div>
                <div className="relative w-full md:w-64">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Procurar leads..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all" />
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex gap-6 overflow-x-auto pb-8 custom-scroll items-start min-h-[600px]">
                {columns.map(column => {
                    const columnProspects = filteredProspects.filter(p => {
                        if (column.id === 'Novos Leads') {
                            const validIds = columns.map(c => c.id);
                            return p.status === column.id || !validIds.includes(p.status);
                        }
                        return p.status === column.id;
                    });
                    const totalValue = columnProspects.reduce((sum, p) => sum + (p.lead_value || 0), 0);
                    const headerClass = colorToHeader(column.color);

                    return (
                        <div 
                            key={column.id} 
                            draggable 
                            onDragStart={(e) => handleColDragStart(e, column.id)}
                            onDragEnd={handleColDragEnd}
                            className={`flex-shrink-0 w-80 flex flex-col gap-4 h-[calc(100vh-320px)] min-h-[400px] transition-all ${draggingCol === column.id ? 'opacity-40 scale-95' : 'opacity-100'}`} 
                            onDragOver={handleDragOver} 
                            onDrop={(e) => handleDrop(e, column.id)}
                        >
                            {/* Column Header */}
                            <div className={`p-4 rounded-xl shadow-sm flex flex-col gap-1 cursor-grab active:cursor-grabbing ${headerClass}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="font-black text-sm uppercase tracking-wider flex items-center gap-2 select-none">
                                        <GripVertical size={14} className="opacity-50" />
                                        {column.title}
                                    </h3>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-white/20 text-white">
                                            {columnProspects.length}
                                        </span>
                                        {!column.protected && (
                                            <button
                                                onClick={() => handleDeleteColumn(column.id)}
                                                title="Excluir coluna"
                                                className="w-5 h-5 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/30 transition-colors opacity-60 hover:opacity-100"
                                            >
                                                <X size={11} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs font-bold opacity-80">{formatCurrency(totalValue)}</p>
                            </div>

                            {/* Cards */}
                            <div className={`flex-1 flex flex-col gap-3 overflow-y-auto custom-scroll rounded-2xl p-2 transition-colors ${isDragging ? 'bg-slate-100/50 border border-dashed border-slate-300' : 'bg-transparent'}`}>
                                {columnProspects.map(prospect => (
                                    <div key={prospect.id} draggable onDragStart={(e) => handleDragStart(e, prospect.id)} onDragEnd={handleDragEnd} className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-indigo-200 transition-all flex flex-col gap-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2 min-w-0 group/header">
                                                <div 
                                                    onClick={() => handleOpenEdit(prospect)}
                                                    className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 cursor-pointer hover:bg-white hover:border-indigo-300 hover:shadow-sm transition-all"
                                                >
                                                    <Building size={14} className="text-slate-500 group-hover/header:text-indigo-600 transition-colors" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 
                                                        onClick={() => handleOpenEdit(prospect)}
                                                        className="font-black text-slate-800 text-sm truncate cursor-pointer hover:text-indigo-600 transition-colors" 
                                                        title={prospect.company || prospect.name}
                                                    >
                                                        {prospect.company || prospect.name || 'Nova Empresa'}
                                                    </h4>
                                                    <p className="text-[10px] font-bold text-slate-400 truncate">
                                                        {(prospect.ramo && prospect.ramo !== 'nan') ? prospect.ramo : (prospect.position && prospect.position !== 'nan' ? prospect.position : 'Sem Categoria')}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Context Menu */}
                                            <div className="relative" ref={openMenuId === prospect.id ? menuRef : null}>
                                                <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === prospect.id ? null : prospect.id); }} className="text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1 transition-colors">
                                                    <MoreVertical size={16} />
                                                </button>
                                                {openMenuId === prospect.id && (
                                                    <div className="absolute right-0 top-8 z-50 w-52 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                                        <button onClick={() => handleOpenEdit(prospect)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors">
                                                            <Edit2 size={15} className="text-indigo-500" /> Editar Lead
                                                        </button>
                                                        <div className="border-t border-slate-100">
                                                            <p className="px-4 pt-2 pb-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">Mover para</p>
                                                            {columns.filter(col => col.id !== prospect.status).map(col => (
                                                                <button key={col.id} onClick={() => handleMoveToColumn(prospect.id, col.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                                                    <MoveRight size={14} className="text-slate-400" /> {col.title}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        {onConvertToSale && (
                                                            <div className="border-t border-slate-100">
                                                                <button onClick={() => handleConvertToSale(prospect)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50 transition-colors">
                                                                    <TrendingUp size={15} className="text-emerald-500" /> Converter em Venda
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div className="border-t border-slate-100">
                                                            <button onClick={() => handleDeleteLead(prospect.id)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50 transition-colors">
                                                                <Trash2 size={15} className="text-rose-400" /> Excluir Lead
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-1.5 mt-1">
                                            {prospect.decisor && prospect.decisor !== 'nan' && (
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <span className="font-bold text-slate-400 text-[10px] uppercase w-12 shrink-0">Decisor:</span>
                                                    <span className="truncate">{prospect.decisor}</span>
                                                </div>
                                            )}
                                            {prospect.phonenumber && prospect.phonenumber !== 'nan' && (
                                                <div className="flex items-center gap-2 text-xs text-slate-600">
                                                    <Phone size={12} className="text-slate-400 shrink-0" />
                                                    <span className="truncate">{prospect.phonenumber}</span>
                                                </div>
                                            )}
                                            {prospect.email && prospect.email !== 'nan' && (
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
                                            {prospect.source && <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-md max-w-[80px] truncate">{prospect.source}</span>}
                                        </div>

                                        <div className="flex gap-2 pt-1">
                                            <button onClick={() => handleOpenEdit(prospect)} className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg py-1.5 transition-colors">
                                                <Edit2 size={11} /> Editar
                                            </button>
                                            {onConvertToSale && (
                                                <button onClick={() => handleConvertToSale(prospect)} className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg py-1.5 transition-colors">
                                                    <TrendingUp size={11} /> Venda
                                                </button>
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
                    );
                })}

                {/* Add Column inline button */}
                <div className="flex-shrink-0 w-64 flex items-start pt-1">
                    <button onClick={() => setIsAddColumnOpen(true)} className="w-full flex items-center justify-center gap-2 p-5 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all font-bold text-sm">
                        <Plus size={18} /> Nova Coluna
                    </button>
                </div>
            </div>

            {/* ── ADD COLUMN MODAL ── */}
            {isAddColumnOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 overflow-hidden">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><LayoutGrid size={20} className="text-indigo-500" /> Nova Coluna</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">Crie uma nova fase no seu funil de prospecção.</p>
                            </div>
                            <button onClick={() => setIsAddColumnOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700">Nome da Coluna</label>
                                <input
                                    autoFocus
                                    type="text"
                                    value={newColTitle}
                                    onChange={(e) => setNewColTitle(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddColumn(); }}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    placeholder="Ex: Em negociação, Aguardando proposta..."
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><Palette size={15} className="text-slate-400" /> Cor da Coluna</label>
                                <div className="grid grid-cols-5 gap-2">
                                    {COLOR_OPTIONS.map(opt => (
                                        <button
                                            key={opt.key}
                                            onClick={() => setNewColColor(opt.key)}
                                            title={opt.label}
                                            className={`h-10 rounded-xl ${opt.header} transition-all font-black text-[10px] flex items-center justify-center ${newColColor === opt.key ? 'ring-4 ring-offset-2 ring-indigo-400 scale-105' : 'opacity-70 hover:opacity-100'}`}
                                        >
                                            {newColColor === opt.key ? '✓' : ''}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-400 font-medium">Selecionado: <strong>{COLOR_OPTIONS.find(c => c.key === newColColor)?.label}</strong></p>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button onClick={() => setIsAddColumnOpen(false)} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                            <button onClick={handleAddColumn} disabled={!newColTitle.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-40">
                                <Plus size={18} /> Criar Coluna
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── NEW LEAD MODAL ── */}
            {isNewLeadModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-black text-slate-800">Criar Novo Lead</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">Cadastre manualmente os dados da prospecção.</p>
                            </div>
                            <button onClick={() => setIsNewLeadModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            <form id="new-lead-form" onSubmit={handleCreateNewLead}>
                                <LeadFormFields form={newLeadForm} setForm={setNewLeadForm} columns={columns} selectedProduct={selectedProduct} />
                            </form>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button type="button" onClick={() => setIsNewLeadModalOpen(false)} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                            <button type="submit" form="new-lead-form" disabled={savingLead} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                                {savingLead ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {savingLead ? 'Salvando...' : 'Salvar Lead'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── EDIT LEAD MODAL ── */}
            {isEditModalOpen && editingLead && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-indigo-50/60">
                            <div>
                                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><Edit2 size={20} className="text-indigo-500" />Editar Lead</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1 px-1">{editLeadForm.company || editLeadForm.name || 'Sem Identificação'}</p>
                            </div>
                            <button onClick={() => { setIsEditModalOpen(false); setEditingLead(null); }} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            <form id="edit-lead-form" onSubmit={handleSaveEdit}>
                                <LeadFormFields form={editLeadForm} setForm={setEditLeadForm} columns={columns} selectedProduct={selectedProduct} />
                            </form>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button type="button" onClick={() => { setIsEditModalOpen(false); setEditingLead(null); }} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                            <button type="submit" form="edit-lead-form" disabled={savingLead} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50">
                                {savingLead ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {savingLead ? 'Salvando...' : 'Salvar Alterações'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CSV MAPPING MODAL ── */}
            {isImportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-black text-slate-800">Mapear Colunas do CSV</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">Nós encontramos <strong className="text-indigo-600">{csvRows.length}</strong> leads no arquivo.</p>
                            </div>
                            <button onClick={() => setIsImportModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg"><ArrowRight size={20} /></div>
                                    <div>
                                        <h4 className="font-black text-indigo-900">Coluna de Destino</h4>
                                        <p className="text-xs text-indigo-700/70 font-medium">Os leads serão importados para qual coluna?</p>
                                    </div>
                                </div>
                                <select value={importStatus} onChange={(e) => setImportStatus(e.target.value)} className="px-4 py-2.5 bg-white border border-indigo-200 rounded-xl text-sm font-bold text-indigo-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer shadow-sm min-w-[200px]">
                                    {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                                {DB_FIELDS.map(field => (
                                    <div key={field.key} className="flex flex-col gap-1.5 p-3 rounded-xl hover:bg-slate-50 border-2 border-transparent hover:border-slate-100 transition-colors">
                                        <label className="text-sm font-bold text-slate-700">{field.label}</label>
                                        <div className="relative">
                                            <select value={csvMapping[field.key] || ''} onChange={(e) => setCsvMapping({ ...csvMapping, [field.key]: e.target.value })} className="w-full px-4 py-2.5 pr-10 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer appearance-none shadow-sm font-medium">
                                                <option value="">-- Ignorar --</option>
                                                {csvHeaders.map((h, i) => <option key={i} value={i.toString()}>Coluna: {h}</option>)}
                                            </select>
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><Tag size={14} /></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button type="button" onClick={() => setIsImportModalOpen(false)} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                            <button onClick={handleConfirmImport} disabled={importing} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50">
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
