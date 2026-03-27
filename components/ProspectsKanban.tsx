import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Prospect, CRMTask } from '../types';
import { formatCurrency } from '../utils/formatters';
import { Plus, Upload, Search, MoreVertical, X, Loader2, GripVertical, Building, Phone, Mail, Tag, Save, ArrowRight, Edit2, MoveRight, TrendingUp, Trash2, LayoutGrid, Palette, Calendar, Bell, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import TaskManager from './TaskManager';

interface KanbanColumn {
    id: string;
    title: string;
    color: string; // tailwind bg color key
    protected?: boolean;
}

const COLOR_OPTIONS = [
    { key: 'fg_blue_1', label: 'Azul F&G 1', header: 'bg-[#1B263B] text-white' },
    { key: 'fg_blue_2', label: 'Azul F&G 2', header: 'bg-[#243347] text-white' },
    { key: 'fg_blue_3', label: 'Azul F&G 3', header: 'bg-[#2E3F56] text-white' },
    { key: 'fg_gold_1', label: 'Dourado F&G 1', header: 'bg-[#C69C6D] text-[#1B263B]' },
    { key: 'fg_gold_2', label: 'Dourado F&G 2', header: 'bg-[#B8895A] text-white' },
    { key: 'fg_gold_3', label: 'Dourado F&G 3', header: 'bg-[#A07848] text-white' },
];

const LEGACY_COLOR_MAP: Record<string, string> = {
    slate: 'fg_blue_1',
    indigo: 'fg_blue_2',
    blue: 'fg_blue_3',
    rose: 'fg_gold_1',
    amber: 'fg_gold_2',
    emerald: 'fg_gold_2',
    purple: 'fg_gold_3',
    pink: 'fg_gold_3',
    cyan: 'fg_blue_3',
    teal: 'fg_blue_2',
};

const colorToHeader = (colorKey: string) => {
    const normalizedKey = LEGACY_COLOR_MAP[colorKey] || colorKey;
    const found = COLOR_OPTIONS.find(c => c.key === normalizedKey);
    return found ? found.header : 'bg-[#1B263B] text-white';
};

const DEFAULT_COLUMNS: KanbanColumn[] = [
    { id: 'Novos Leads', title: 'Novos Leads', color: 'fg_blue_1', protected: true },
    { id: 'Leads Sem demanda', title: 'Sem Demanda', color: 'fg_blue_2' },
    { id: 'Leads Rafael', title: 'Leads Rafael', color: 'fg_gold_1' },
    { id: 'Leads Andréia', title: 'Leads Andréia', color: 'fg_gold_2' },
];

const STORAGE_KEY_PREFIX = 'kanban_columns_v1';

const loadColumns = (productType: string): KanbanColumn[] => {
    try {
        const key = `${STORAGE_KEY_PREFIX}_${productType.replace(/\s+/g, '_')}`;
        const saved = localStorage.getItem(key);
        if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
};

const saveColumns = (productType: string, cols: KanbanColumn[]) => {
    const key = `${STORAGE_KEY_PREFIX}_${productType.replace(/\s+/g, '_')}`;
    localStorage.setItem(key, JSON.stringify(cols));
};

type ProspectProductTab = 'Seguro Garantia' | 'Judicial Depósito Recursal' | 'Energia' | 'Seguro de crédito';

interface ProspectsKanbanProps {
    onConvertToSale?: (data: {
        nome: string;
        cnpj: string;
        telefone: string;
        email: string;
        decisor: string;
        limites_seguradoras?: string;
        product_type?: string;
        judicial_process_number?: string;
        judicial_court?: string;
    }) => void;
}

interface ObservationEntry {
    timestamp: string; // dd/MM/yyyy HH:mm
    text: string;
}

const LeadFormFields = ({ 
    form, 
    setForm, 
    columns, 
    selectedProduct,
    observationHistory,
    hideObservation
}: { 
    form: Partial<Prospect>; 
    setForm: (v: Partial<Prospect>) => void;
    columns: KanbanColumn[];
    selectedProduct: string;
    observationHistory?: string;
    hideObservation?: boolean;
}) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4 col-span-2">
            <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Informações Principais</h4>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Empresa *</label>
            <input required type="text" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Nome da Empresa" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">CNPJ</label>
            <input type="text" value={form.cnpj || ''} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="00.000.000/0001-00" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Nome do Contato</label>
            <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Ciclano da Silva" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Cargo do Contato</label>
            <input type="text" value={form.position || ''} onChange={(e) => setForm({ ...form, position: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Diretor Financeiro" />
        </div>
        <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">Decisor / Responsável</label>
            <input type="text" value={form.decisor || ''} onChange={(e) => setForm({ ...form, decisor: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Nome do decisor" />
        </div>
        <div className="space-y-4 col-span-2 mt-2">
            <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Contato & Detalhes</h4>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Telefone / Celular</label>
            <input type="text" value={form.phonenumber || ''} onChange={(e) => setForm({ ...form, phonenumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="(00) 00000-0000" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">E-mail</label>
            <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="contato@empresa.com.br" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Ramo</label>
            <input type="text" value={form.ramo || ''} onChange={(e) => setForm({ ...form, ramo: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Engenharia / Construtora" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Segmento</label>
            <select
                value={form.segmento || ''}
                onChange={(e) => setForm({ ...form, segmento: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all cursor-pointer"
            >
                <option value="">Selecione</option>
                <option value="Advogado">Advogado</option>
                <option value="Indústria">Indústria</option>
                <option value="Consultoria">Consultoria</option>
                <option value="Energia">Energia</option>
                <option value="Distribuidora">Distribuidora</option>
            </select>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">CEP</label>
            <input type="text" value={form.zip || ''} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="00000-000" />
        </div>
        <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">Endereço</label>
            <input type="text" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Rua, Número, Bairro" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Valor Estimado</label>
            <input type="number" step="0.01" value={form.lead_value || ''} onChange={(e) => setForm({ ...form, lead_value: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="150000.00" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Fase (Coluna)</label>
            <select value={form.status || 'Novos Leads'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all cursor-pointer">
                {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
            </select>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Origem do Contato</label>
            <input type="text" value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="Ex: Conlicitação, PNCP, Indicação" />
        </div>
        {/* ── ADDITIONAL JUDICIAL FIELDS ── */}
        {selectedProduct === 'Judicial Depósito Recursal' && (
            <>
                <div className="space-y-4 col-span-2 mt-4">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Dados do Processo</h4>
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                    <label className="text-sm font-bold text-slate-700">Nº do Processo</label>
                    <input type="text" value={form.judicial_process_number || ''} onChange={(e) => setForm({ ...form, judicial_process_number: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="0000000-00.0000.0.00.0000" />
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                    <label className="text-sm font-bold text-slate-700">Tribunal / Vara</label>
                    <input type="text" value={form.judicial_court || ''} onChange={(e) => setForm({ ...form, judicial_court: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all" placeholder="TRT / Vara do Trabalho" />
                </div>
            </>
        )}

        {!hideObservation && <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">{observationHistory ? 'Nova Observação' : 'Observações'}</label>
            <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] focus:bg-white transition-all resize-none" placeholder={observationHistory ? "Digite a nova atualização. Será adicionada ao histórico com data/hora." : "Anotações sobre este lead..."} />
            {observationHistory && (
                <div className="mt-2 bg-white border border-slate-200 rounded-xl p-3">
                    <p className="text-[11px] uppercase tracking-wider font-black text-slate-400 mb-2">Histórico de observações</p>
                    <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-sans">{observationHistory}</pre>
                </div>
            )}
        </div>}
    </div>
);

const ProspectsKanban: React.FC<ProspectsKanbanProps> = ({ onConvertToSale }) => {

    const [selectedProduct, setSelectedProduct] = useState<ProspectProductTab>('Seguro Garantia');
    const [columns, setColumns] = useState<KanbanColumn[]>(() => loadColumns('Seguro Garantia'));
    const [prospects, setProspects] = useState<Prospect[]>([]);
    const [tasks, setTasks] = useState<CRMTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    // Ordenação por "tempo na coluna" (aproximação via `created_at`).
    const [leadAgeSort, setLeadAgeSort] = useState<'recent' | 'oldest'>('recent');
    // Guarda quando o lead "entrou" na coluna (atualizado quando você move o card).
    // Se recarregar a página, cai para `created_at` (fallback) até você mover novamente.
    const [leadEnteredAtMs, setLeadEnteredAtMs] = useState<Record<string, number>>({});
    const [isDragging, setIsDragging] = useState(false);
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editingColTitle, setEditingColTitle] = useState('');

    // Sincroniza colunas quando o produto muda
    useEffect(() => {
        setColumns(loadColumns(selectedProduct));
        setEditingColId(null);
        setEditingColTitle('');
    }, [selectedProduct]);

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
    const [newLimitesArray, setNewLimitesArray] = useState<{seguradora: string; valor: string}[]>([]);
    const [newCurrentLimit, setNewCurrentLimit] = useState<{seguradora: string; valor: string}>({ seguradora: '', valor: '' });

    // Edit Lead Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<Prospect | null>(null);
    const [editLeadForm, setEditLeadForm] = useState<Partial<Prospect>>({});
    const [editLimitesArray, setEditLimitesArray] = useState<{seguradora: string; valor: string}[]>([]);
    const [editCurrentLimit, setEditCurrentLimit] = useState<{seguradora: string; valor: string}>({ seguradora: '', valor: '' });
    const [editObservationEntries, setEditObservationEntries] = useState<ObservationEntry[]>([]);
    const [editObservationText, setEditObservationText] = useState('');
    const [editObservationDateTime, setEditObservationDateTime] = useState('');
    const [editingObservationIndex, setEditingObservationIndex] = useState<number | null>(null);

    // Context Menu State
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Add Column Modal
    const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
    const [newColTitle, setNewColTitle] = useState('');
    const [newColColor, setNewColColor] = useState('fg_blue_2');

    const nowDateTimeLocal = () => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    /** Formato canônico salvo no banco (sem vírgula — evita quebra do parser). */
    const formatBrTimestamp = (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const localToBrDateTime = (value: string) => {
        if (!value) return '';
        const [date, time] = value.split('T');
        if (!date || !time) return '';
        const [y, m, d] = date.split('-');
        const hhmm = time.slice(0, 5);
        return `${d}/${m}/${y} ${hhmm}`;
    };

    const brToLocalDateTime = (value: string) => {
        const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,\s*|\s+)(\d{2}:\d{2})$/);
        if (!m) return nowDateTimeLocal();
        return `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
    };

    /** Remove carimbo legado do início do texto (ex.: colado no corpo). */
    const stripLeadingObservationStamp = (body: string) =>
        (body || '').replace(/^\[\d{2}\/\d{2}\/\d{4}(?:,\s*|\s+)\d{2}:\d{2}\]\s*/u, '').trim();

    const parseObservationHistory = (historyText: string | null | undefined): ObservationEntry[] => {
        const raw = (historyText || '').trim();
        if (!raw) return [];
        const stampAtLineStart = /\n(?=\[\d{2}\/\d{2}\/\d{4}(?:,\s*|\s+)\d{2}:\d{2}\]\s*)/g;
        const chunks = raw.split(stampAtLineStart);
        const lineStamp = /^\[(\d{2})\/(\d{2})\/(\d{4})(?:,\s*|\s+)(\d{2}:\d{2})\]\s*([\s\S]*)$/;
        const entries: ObservationEntry[] = [];
        chunks.forEach((chunk) => {
            const line = chunk.trim();
            if (!line) return;
            const m = line.match(lineStamp);
            if (m) {
                const timestamp = `${m[1]}/${m[2]}/${m[3]} ${m[4]}`;
                const text = stripLeadingObservationStamp(m[5].trim());
                entries.push({ timestamp, text });
                return;
            }
            const loose = line.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
            if (loose) {
                const innerNorm = loose[1].replace(/\s*,\s*/, ' ').trim();
                const sm = innerNorm.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/);
                const timestamp = sm ? `${sm[1]}/${sm[2]}/${sm[3]} ${sm[4]}` : innerNorm;
                entries.push({ timestamp, text: stripLeadingObservationStamp(loose[2].trim()) });
                return;
            }
            entries.push({ timestamp: formatBrTimestamp(new Date()), text: stripLeadingObservationStamp(line) });
        });
        return entries;
    };

    const serializeObservationHistory = (entries: ObservationEntry[]) => {
        const valid = entries.filter(e => e.text.trim() && e.timestamp.trim());
        if (valid.length === 0) return null;
        return valid.map(e => `[${e.timestamp}] ${stripLeadingObservationStamp(e.text.trim())}`).join('\n');
    };

    const buildObservationHistory = (newText: string | null | undefined, oldText: string | null | undefined) => {
        const next = stripLeadingObservationStamp((newText || '').trim());
        const previousHistory = (oldText || '').trim();
        if (!next) return previousHistory || null;
        const timestamp = formatBrTimestamp(new Date());
        const entry = `[${timestamp}] ${next}`;
        if (!previousHistory) return entry;
        return `${previousHistory}\n${entry}`;
    };

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
        { key: 'segmento', label: 'Segmento' },
        { key: 'city', label: 'Cidade' },
        { key: 'state', label: 'Estado (UF)' },
        { key: 'judicial_process_number', label: 'Nº do Processo (Judicial)' },
        { key: 'judicial_court', label: 'Tribunal/Vara (Judicial)' },
        { key: 'description', label: 'Observações' },
    ];

    useEffect(() => { 
        fetchProspects();
        fetchTasks();
    }, []);

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
            // Fallback: quando não há "tempo na coluna" salvo em memória,
            // usamos `status_entered_at` (quando existir) senão `created_at` apenas para não ficar vazio.
            setLeadEnteredAtMs(prev => {
                const next = { ...prev };
                (data || []).forEach(p => {
                    if (!next[p.id]) {
                        const raw = p.status_entered_at || p.created_at;
                        if (!raw) return;
                        const parsed = Date.parse(raw);
                        if (!Number.isNaN(parsed)) next[p.id] = parsed;
                    }
                });
                return next;
            });
        } catch (error) {
            console.error('Error fetching prospects:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchTasks = async () => {
        try {
            const { data, error } = await supabase
                .from('crm_tasks')
                .select('*')
                .eq('status', 'pending')
                .order('due_date', { ascending: true });
            if (error) throw error;
            setTasks(data || []);
        } catch (error) {
            console.error('Error fetching tasks:', error);
        }
    };

    const getLeadEnteredAtMs = (prospect: Prospect) => {
        const mem = leadEnteredAtMs[prospect.id];
        if (typeof mem === 'number') return mem;
        const raw = prospect.status_entered_at || prospect.created_at;
        if (raw) {
            const parsed = Date.parse(raw);
            if (!Number.isNaN(parsed)) return parsed;
        }
        return null;
    };

    const formatLeadAge = (enteredAtMs?: number | null) => {
        if (!enteredAtMs) return null;
        const days = Math.floor((Date.now() - enteredAtMs) / (1000 * 60 * 60 * 24));
        if (days <= 0) return 'incluído hoje';
        if (days === 1) return 'há 1 dia';
        if (days === 2) return 'há 2 dias';
        if (days === 3) return 'há 3 dias';
        if (days === 4) return 'há 4 dias';
        if (days <= 6) return `há ${days} dias`;
        if (days <= 13) return 'há 1 semana';
        return 'há mais de 1 semana';
    };

    // ---- Column management ----
    const handleAddColumn = () => {
        if (!newColTitle.trim()) return;
        const id = `col_${Date.now()}`;
        const updated = [...columns, { id, title: newColTitle.trim(), color: newColColor }];
        setColumns(updated);
        saveColumns(selectedProduct, updated);
        setNewColTitle('');
        setNewColColor('fg_blue_2');
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
            // Atualiza "tempo na coluna" para a nova coluna (em memória).
            const affectedIds = prospects.filter(p => p.status === colId).map(p => p.id);
            setLeadEnteredAtMs(prev => {
                const next = { ...prev };
                const now = Date.now();
                affectedIds.forEach(id => { next[id] = now; });
                return next;
            });
            setProspects(prev => prev.map(p => p.status === colId ? { ...p, status: 'Novos Leads' } : p));
        }

        const updated = columns.filter(c => c.id !== colId);
        setColumns(updated);
        saveColumns(selectedProduct, updated);
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
            saveColumns(selectedProduct, updatedColumns);
        }
        setDraggingCol(null);
    };

    const handleDragOver = (e: React.DragEvent) => e.preventDefault();

    const beginRenameColumn = (col: KanbanColumn) => {
        setEditingColId(col.id);
        setEditingColTitle(col.title);
    };

    const cancelRenameColumn = () => {
        setEditingColId(null);
        setEditingColTitle('');
    };

    const commitRenameColumn = () => {
        const colId = editingColId;
        if (!colId) return;
        const nextTitle = editingColTitle.trim();
        if (!nextTitle) {
            cancelRenameColumn();
            return;
        }
        setColumns(prev => {
            const updated = prev.map(c => (c.id === colId ? { ...c, title: nextTitle } : c));
            saveColumns(selectedProduct, updated);
            return updated;
        });
        cancelRenameColumn();
    };

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
        const movedLead = prospects.find(p => p.id === prospectId);
        if (movedLead && movedLead.status !== statusId) {
            setLeadEnteredAtMs(prev => ({ ...prev, [prospectId]: Date.now() }));
        }
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
        const movedLead = prospects.find(p => p.id === prospectId);
        if (movedLead && movedLead.status !== newStatus) {
            setLeadEnteredAtMs(prev => ({ ...prev, [prospectId]: Date.now() }));
        }
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
        // Observações são gerenciadas em histórico separado neste modal.
        cleanedForm.description = '';

        setEditLeadForm(cleanedForm);
        const parsedObs = parseObservationHistory(prospect.description);
        setEditObservationEntries(parsedObs);
        setEditObservationText('');
        setEditObservationDateTime(nowDateTimeLocal());
        setEditingObservationIndex(null);
        // Parse limits
        try {
            const parsed = cleanedForm.limites_seguradoras ? JSON.parse(cleanedForm.limites_seguradoras) : [];
            setEditLimitesArray(Array.isArray(parsed) ? parsed : []);
        } catch { setEditLimitesArray([]); }
        setEditCurrentLimit({ seguradora: '', valor: '' });
        setIsEditModalOpen(true);
    };

    const handleAddOrUpdateObservation = () => {
        const text = editObservationText.trim();
        const timestamp = localToBrDateTime(editObservationDateTime);
        if (!text || !timestamp) return;
        const entry: ObservationEntry = { text, timestamp };
        setEditObservationEntries(prev => {
            if (editingObservationIndex === null) return [...prev, entry];
            return prev.map((item, idx) => (idx === editingObservationIndex ? entry : item));
        });
        setEditObservationText('');
        setEditObservationDateTime(nowDateTimeLocal());
        setEditingObservationIndex(null);
    };

    const handleEditObservation = (index: number) => {
        const entry = editObservationEntries[index];
        if (!entry) return;
        setEditObservationText(entry.text);
        setEditObservationDateTime(brToLocalDateTime(entry.timestamp));
        setEditingObservationIndex(index);
    };

    const handleDeleteObservation = (index: number) => {
        setEditObservationEntries(prev => prev.filter((_, idx) => idx !== index));
        if (editingObservationIndex === index) {
            setEditingObservationIndex(null);
            setEditObservationText('');
            setEditObservationDateTime(nowDateTimeLocal());
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingLead) return;
        setSavingLead(true);
        try {
            // Filter out system and virtual fields that can't be updated directly in the 'prospects' table
            const { id, created_at, tasks, ...rawUpdateData } = editLeadForm;
            const nextStatus = (rawUpdateData as any).status;
            const statusChanged = typeof nextStatus === 'string' && nextStatus !== editingLead.status;
            if (statusChanged) {
                // Mudança de fase via modal: reinicia "tempo na coluna" a partir de agora.
                setLeadEnteredAtMs(prev => ({ ...prev, [editingLead.id]: Date.now() }));
            }

            // Auto-add pending insurer limit if user filled it but didn't click "Add"
            const pendingSeguradora = (editCurrentLimit.seguradora || '').trim();
            const pendingValor = (editCurrentLimit.valor || '').trim();
            const finalEditLimitsArray = pendingSeguradora && pendingValor
                ? [...editLimitesArray, { seguradora: pendingSeguradora, valor: pendingValor }]
                : editLimitesArray;

            // Merge limits into the form data
            rawUpdateData.limites_seguradoras = finalEditLimitsArray.length > 0 ? JSON.stringify(finalEditLimitsArray) : null as any;
            const pendingText = editObservationText.trim();
            const pendingTs = localToBrDateTime(editObservationDateTime);
            const finalObsEntries = pendingText && pendingTs
                ? [...editObservationEntries, { text: pendingText, timestamp: pendingTs }]
                : editObservationEntries;
            rawUpdateData.description = serializeObservationHistory(finalObsEntries) as any;

            // Strict data sanitization to prevent database rejection
            const dataToUpdate: any = {};
            Object.entries(rawUpdateData).forEach(([key, value]) => {
                // 1. Handle numeric fields
                if (key === 'lead_value') {
                    dataToUpdate[key] = typeof value === 'string' ? (parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0) : (value || 0);
                } 
                // 2. Convert empty strings/excel 'nan' to null for all fields to avoid type issues (especially on dates/virtual fields)
                else if (value === '' || value === 'nan' || value === 'undefined' || value === null) {
                    dataToUpdate[key] = null;
                }
                // 3. Keep all other fields as is
                else {
                    dataToUpdate[key] = value;
                }
            });

            const { error } = await supabase.from('prospects').update(dataToUpdate).eq('id', editingLead.id);
            if (error) throw error;
            const updatedLead = {
                ...editLeadForm,
                limites_seguradoras: rawUpdateData.limites_seguradoras,
                description: rawUpdateData.description,
            } as Prospect;
            setProspects(prev => prev.map(p => p.id === editingLead.id ? { ...p, ...updatedLead } : p));
            setIsEditModalOpen(false);
            setEditingLead(null);
        } catch (error: any) {
            console.error('Error updating lead:', error);
            const msg = error.message || (typeof error === 'string' ? error : 'Erro desconhecido');
            alert(`Erro ao salvar alterações: ${msg}`);
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
                limites_seguradoras: prospect.limites_seguradoras || '',
                product_type: prospect.product_type || undefined,
                judicial_process_number: prospect.judicial_process_number || undefined,
                judicial_court: prospect.judicial_court || undefined,
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
                name: ['name', 'nome', 'contato'],
                company: ['company', 'empresa', 'cliente', 'razao social'],
                position: ['position', 'cargo'],
                decisor: ['decisor', 'responsável', 'responsavel'],
                phonenumber: [
                    'phone',
                    'telefone',
                    'celular',
                    'whatsapp',
                    'phonenumber',
                    'fone',
                    'tel',
                    'telefone/celular',
                    'telefone / celular',
                    'telefone principal',
                    'celular/whatsapp',
                    'celular / whatsapp',
                    'whatsapp comercial',
                    'contato',
                    'numero',
                    'número',
                    'mobile',
                    'cel',
                    'telefone comercial',
                    'telefone fixo',
                    'telefone contato',
                    'telefone de contato',
                    'contato telefônico',
                    'contato telefonico',
                    'telefone whatsapp',
                    'telefone (whatsapp)',
                    'telefone/cel',
                    'celular principal',
                    'nº telefone',
                    'nº celular',
                    'num telefone',
                    'num celular',
                    'numero telefone',
                    'numero celular',
                    'número telefone',
                    'número celular'
                ],
                email: ['email', 'e-mail'],
                lead_value: ['value', 'valor', 'valor do lead', 'premio', 'prêmio', 'lead value'],
                status: ['status', 'fase', 'etapa'],
                source: ['source', 'origem', 'fonte'],
                cnpj: ['cnpj', 'documento'],
                ramo: ['ramo', 'segmento', 'setor'],
                segmento: ['segmento', 'setor'],
                city: ['city', 'cidade', 'municipio'],
                state: ['state', 'estado', 'uf'],
                zip: ['zip', 'cep'],
                address: ['address', 'endereço', 'endereco']
            };
            DB_FIELDS.forEach(field => {
                const guessArr = guessMap[field.key] || [];
                // Check for exact key match or label match
                const matchedIndex = headers.findIndex(h => {
                    const normalizedHeader = h.toLowerCase().trim();
                    return normalizedHeader === field.key.toLowerCase() || 
                           normalizedHeader === field.label.toLowerCase() ||
                           guessArr.includes(normalizedHeader);
                });
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
                    segmento: getVal('segmento'),
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
            const finalLimites = newLimitesArray.length > 0 ? JSON.stringify(newLimitesArray) : null;
            const stampedDescription = buildObservationHistory(newLeadForm.description as string, null);
            const { error } = await supabase.from('prospects').insert([{ 
                ...newLeadForm, 
                company: newLeadForm.company || newLeadForm.name,
                product_type: selectedProduct, // Herda o produto selecionado
                limites_seguradoras: finalLimites,
                description: stampedDescription
            }]);
            if (error) throw error;
            await fetchProspects();
            setIsNewLeadModalOpen(false);
            setNewLeadForm({ status: 'Novos Leads' });
            setNewLimitesArray([]);
            setNewCurrentLimit({ seguradora: '', valor: '' });
        } catch (error) { console.error('Error saving lead:', error); alert('Erro ao salvar o lead.'); }
        finally { setSavingLead(false); }
    };

    const filteredProspects = prospects.filter(p => {
        const matchesProduct =
            p.product_type === selectedProduct ||
            (!p.product_type && selectedProduct === 'Seguro Garantia');
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
            <div className="flex justify-end pr-4 -mb-4">
                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Build v3.0 (Patch Aplicado)</span>
            </div>
            {/* Product Switcher */}
            <div className="flex justify-center mb-6 px-2">
                <div className="bg-slate-100 p-1 rounded-2xl flex flex-wrap justify-center gap-1 shadow-sm border border-slate-200 max-w-full">
                    <button
                        type="button"
                        onClick={() => setSelectedProduct('Seguro Garantia')}
                        className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all whitespace-nowrap ${selectedProduct === 'Seguro Garantia' ? 'bg-[#1B263B] text-[#C69C6D] shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}
                    >
                        Seguro Garantia
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedProduct('Judicial Depósito Recursal')}
                        className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all whitespace-nowrap ${selectedProduct === 'Judicial Depósito Recursal' ? 'bg-[#1B263B] text-[#C69C6D] shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}
                    >
                        Judicial Depósito Recursal
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedProduct('Energia')}
                        className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all whitespace-nowrap ${selectedProduct === 'Energia' ? 'bg-[#1B263B] text-[#C69C6D] shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}
                    >
                        Energia
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedProduct('Seguro de crédito')}
                        className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all whitespace-nowrap ${selectedProduct === 'Seguro de crédito' ? 'bg-[#1B263B] text-[#C69C6D] shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}
                    >
                        Seguro de crédito
                    </button>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => { setIsNewLeadModalOpen(true); setNewLimitesArray([]); setNewCurrentLimit({ seguradora: '', valor: '' }); setNewLeadForm({ status: 'Novos Leads' }); }} className="bg-[#1B263B] hover:bg-[#243347] text-[#F5F1EA] border border-[#C69C6D]/35 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2">
                        <Plus size={18} /> Novo Lead
                    </button>
                    <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-[#243347] hover:bg-[#1B263B] text-[#F5F1EA] border border-[#C69C6D]/35 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-70">
                        {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                        {importing ? 'Importando...' : 'Importar Leads (CSV)'}
                    </button>
                    <div className="h-8 w-[1px] bg-slate-200 mx-1 hidden md:block" />
                    <button onClick={() => setIsAddColumnOpen(true)} className="bg-white border border-slate-200 hover:border-[#C69C6D]/40 hover:bg-[#C69C6D]/10 text-slate-600 hover:text-[#1B263B] px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm flex items-center gap-2">
                        <LayoutGrid size={16} /> Nova Coluna
                    </button>
                </div>
                <div className="w-full md:w-64 flex flex-col gap-2">
                    <div className="relative w-full">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="Procurar leads..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] shadow-sm transition-all" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Tempo</label>
                        <select
                            value={leadAgeSort}
                            onChange={(e) => setLeadAgeSort(e.target.value === 'oldest' ? 'oldest' : 'recent')}
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] shadow-sm transition-all cursor-pointer"
                        >
                            <option value="recent">Menor tempo primeiro</option>
                            <option value="oldest">Maior tempo primeiro</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex gap-6 overflow-x-auto pb-8 custom-scroll items-stretch min-h-[600px]">
                {columns.map(column => {
                    const columnProspects = filteredProspects.filter(p => {
                        if (column.id === 'Novos Leads') {
                            const validIds = columns.map(c => c.id);
                            return p.status === column.id || !validIds.includes(p.status);
                        }
                        return p.status === column.id;
                    }).sort((a, b) => {
                        // 'recent' => maior data primeiro (menor tempo na coluna primeiro)
                        // 'oldest' => menor data primeiro (maior tempo na coluna primeiro)
                        const ta = getLeadEnteredAtMs(a);
                        const tb = getLeadEnteredAtMs(b);
                        if (!ta && !tb) return 0;
                        if (!ta) return 1;
                        if (!tb) return -1;
                        return leadAgeSort === 'recent' ? (tb - ta) : (ta - tb);
                    });
                    const totalValue = columnProspects.reduce((sum, p) => sum + (p.lead_value || 0), 0);
                    const headerClass = colorToHeader(column.color);

                    return (
                        <div 
                            key={column.id} 
                            draggable={editingColId !== column.id}
                            onDragStart={(e) => {
                                if (editingColId === column.id) return;
                                handleColDragStart(e, column.id);
                            }}
                            onDragEnd={handleColDragEnd}
                            className={`flex-shrink-0 w-80 flex flex-col gap-4 h-[calc(100vh-180px)] min-h-[400px] max-h-[calc(100vh-180px)] overflow-hidden transition-all ${draggingCol === column.id ? 'opacity-40 scale-95' : 'opacity-100'}`} 
                            onDragOver={handleDragOver} 
                            onDrop={(e) => handleDrop(e, column.id)}
                        >
                            {/* Column Header */}
                            <div className={`shrink-0 p-4 rounded-xl shadow-sm flex flex-col gap-1 cursor-grab active:cursor-grabbing ${headerClass}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="font-black text-sm uppercase tracking-wider flex items-center gap-2 min-w-0">
                                        <GripVertical size={14} className="opacity-50" />
                                        {editingColId === column.id ? (
                                            <input
                                                autoFocus
                                                value={editingColTitle}
                                                onChange={(e) => setEditingColTitle(e.target.value)}
                                                onBlur={commitRenameColumn}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        commitRenameColumn();
                                                    } else if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        cancelRenameColumn();
                                                    }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-full max-w-[190px] px-2 py-1 rounded-lg bg-white/20 border border-white/30 text-white placeholder-white/70 outline-none focus:ring-2 focus:ring-white/30 font-black tracking-wider uppercase text-sm"
                                            />
                                        ) : (
                                            <span
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    beginRenameColumn(column);
                                                }}
                                                title="Duplo clique para renomear"
                                                className="truncate select-none cursor-text"
                                            >
                                                {column.title}
                                            </span>
                                        )}
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

                            {/* Cards — min-h-0 obrigatório no flex para overflow-y funcionar */}
                            <div className={`flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto overflow-x-hidden custom-scroll rounded-2xl p-1.5 transition-colors ${isDragging ? 'bg-slate-100/50 border border-dashed border-slate-300' : 'bg-transparent'}`}>
                                {columnProspects.map(prospect => (
                                    <div key={prospect.id} draggable onDragStart={(e) => handleDragStart(e, prospect.id)} onDragEnd={handleDragEnd} className="bg-white rounded-xl p-2.5 shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-[#C69C6D]/30 transition-all flex flex-col gap-1">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2 min-w-0 group/header">
                                                <div 
                                                    onClick={() => handleOpenEdit(prospect)}
                                                    className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200 cursor-pointer hover:bg-white hover:border-[#C69C6D]/40 hover:shadow-sm transition-all"
                                                >
                                                    <Building size={14} className="text-slate-500 group-hover/header:text-[#C69C6D] transition-colors" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 
                                                        onClick={() => handleOpenEdit(prospect)}
                                                        className="font-black text-slate-800 text-sm truncate cursor-pointer hover:text-[#1B263B] transition-colors" 
                                                        title={prospect.company || prospect.name}
                                                    >
                                                        {prospect.company || prospect.name || 'Nova Empresa'}
                                                    </h4>
                                                    <p className="text-[10px] font-bold text-slate-400 truncate">
                                                        {(prospect.ramo && prospect.ramo !== 'nan') ? prospect.ramo : (prospect.position && prospect.position !== 'nan' ? prospect.position : 'Sem Categoria')}
                                                    </p>
                                                {prospect.segmento && prospect.segmento !== 'nan' ? (
                                                    <span className="mt-1 inline-flex text-[9px] font-black bg-[#C69C6D]/12 text-[#1B263B] px-2 py-0.5 rounded-md border border-[#C69C6D]/25 truncate max-w-[140px]">
                                                        {prospect.segmento}
                                                    </span>
                                                ) : null}
                                                    {(() => {
                                                        const enteredAtMs = getLeadEnteredAtMs(prospect);
                                                        const ageLabel = formatLeadAge(enteredAtMs);
                                                        if (!ageLabel) return null;
                                                        return (
                                                            <p className="text-[10px] font-black text-[#C69C6D] truncate mt-1">
                                                                {ageLabel}
                                                            </p>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            {/* Context Menu */}
                                            <div className="relative" ref={openMenuId === prospect.id ? menuRef : null}>
                                                <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === prospect.id ? null : prospect.id); }} className="text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1 transition-colors">
                                                    <MoreVertical size={16} />
                                                </button>
                                                {openMenuId === prospect.id && (
                                                    <div className="absolute right-0 top-8 z-50 w-52 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                                        <button onClick={() => handleOpenEdit(prospect)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-[#C69C6D]/10 hover:text-[#1B263B] transition-colors">
                                                            <Edit2 size={15} className="text-[#C69C6D]" /> Editar Lead
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
                                                                <button onClick={() => handleConvertToSale(prospect)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-[#1B263B] hover:bg-[#C69C6D]/12 transition-colors">
                                                                    <TrendingUp size={15} className="text-[#C69C6D]" /> Converter em Venda
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

                                        {/* Limits display on card */}
                                        {prospect.limites_seguradoras && (() => {
                                            try {
                                                const lims = JSON.parse(prospect.limites_seguradoras);
                                                if (!Array.isArray(lims) || lims.length === 0) return null;
                                                return (
                                                    <div className="mt-2 pt-2 border-t border-slate-100">
                                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Limites</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {lims.map((l: any, i: number) => (
                                                                <span key={i} className="text-[9px] font-black bg-[#C69C6D]/12 text-[#1B263B] px-2 py-0.5 rounded-md border border-[#C69C6D]/25 truncate max-w-[120px]">
                                                                    {l.seguradora}: {l.valor}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            } catch { return null; }
                                        })()}

                                        <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Valor Estimado</span>
                                                <span className="text-xs font-black text-[#1B263B]">{formatCurrency(prospect.lead_value || 0)}</span>
                                            </div>
                                            {prospect.source && <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-md max-w-[80px] truncate">{prospect.source}</span>}
                                            
                                            {/* Task Indicator */}
                                            {(() => {
                                                const leadTasks = tasks.filter(t => t.prospect_id === prospect.id);
                                                if (leadTasks.length === 0) return null;
                                                
                                                const hasOverdue = leadTasks.some(t => new Date(t.due_date) < new Date());
                                                return (
                                                    <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${hasOverdue ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`} title={`${leadTasks.length} tarefa(s) pendente(s)`}>
                                                        <Clock size={10} className={hasOverdue ? 'animate-pulse' : ''} />
                                                        <span className="text-[9px] font-black">{leadTasks.length}</span>
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                        <div className="flex gap-2 pt-1">
                                            <button onClick={() => handleOpenEdit(prospect)} className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black text-[#1B263B] bg-[#C69C6D]/12 hover:bg-[#C69C6D]/22 rounded-lg py-1.5 transition-colors">
                                                <Edit2 size={11} /> Editar
                                            </button>
                                            {onConvertToSale && (
                                                <button onClick={() => handleConvertToSale(prospect)} className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black text-[#1B263B] bg-[#C69C6D]/15 hover:bg-[#C69C6D]/25 rounded-lg py-1.5 transition-colors">
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
                    <button onClick={() => setIsAddColumnOpen(true)} className="w-full flex items-center justify-center gap-2 p-5 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-[#C69C6D]/45 hover:text-[#1B263B] hover:bg-[#C69C6D]/8 transition-all font-bold text-sm">
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
                                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><LayoutGrid size={20} className="text-[#C69C6D]" /> Nova Coluna</h3>
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
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all font-medium"
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
                                            className={`h-10 rounded-xl ${opt.header} transition-all font-black text-[10px] flex items-center justify-center ${newColColor === opt.key ? 'ring-4 ring-offset-2 ring-[#C69C6D] scale-105' : 'opacity-70 hover:opacity-100'}`}
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
                            <button onClick={handleAddColumn} disabled={!newColTitle.trim()} className="bg-[#1B263B] hover:bg-[#243347] text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-[#1B263B]/25 disabled:opacity-40">
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
                            
                            {/* Insurer Limits Section for New Lead */}
                            <div className="mt-8 pt-6 border-t border-slate-100 space-y-4">
                                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">Limites de Seguradoras</h4>
                                {newLimitesArray.length > 0 && (
                                    <div className="space-y-2">
                                        {newLimitesArray.map((lim, i) => (
                                            <div key={i} className="flex items-center gap-2 bg-[#C69C6D]/10 px-3 py-2 rounded-xl border border-[#C69C6D]/25">
                                                <span className="flex-1 text-sm font-bold text-[#1B263B]">{lim.seguradora}</span>
                                                <span className="text-sm font-black text-[#B8895A]">{lim.valor}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setNewLimitesArray(prev => prev.filter((_, idx) => idx !== i))}
                                                    className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Seguradora"
                                        value={newCurrentLimit.seguradora}
                                        onChange={e => setNewCurrentLimit(prev => ({ ...prev, seguradora: e.target.value }))}
                                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Valor (R$)"
                                        value={newCurrentLimit.valor}
                                        onChange={e => {
                                            let val = e.target.value.replace(/\D/g, '');
                                            if (val) val = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseInt(val) / 100);
                                            setNewCurrentLimit(prev => ({ ...prev, valor: val }));
                                        }}
                                        className="w-32 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!newCurrentLimit.seguradora) return;
                                            setNewLimitesArray(prev => [...prev, newCurrentLimit]);
                                            setNewCurrentLimit({ seguradora: '', valor: '' });
                                        }}
                                        className="px-4 py-2 bg-[#1B263B] hover:bg-[#243347] text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center whitespace-nowrap shadow-md shrink-0"
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button type="button" onClick={() => setIsNewLeadModalOpen(false)} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                            <button type="submit" form="new-lead-form" disabled={savingLead} className="bg-[#1B263B] hover:bg-[#243347] text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-[#1B263B]/25 disabled:opacity-50">
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
                        <div className="flex justify-between items-center p-6 border-b border-[#C69C6D]/20 bg-[#C69C6D]/10">
                            <div>
                                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><Edit2 size={20} className="text-[#C69C6D]" />Editar Lead</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1 px-1">{editLeadForm.company || editLeadForm.name || 'Sem Identificação'}</p>
                                {editObservationEntries.length > 0 && (
                                    <p className="text-xs text-slate-500 font-bold mt-1 px-1">
                                        Ultima atualizacao da observacao: {editObservationEntries[editObservationEntries.length - 1].timestamp}
                                    </p>
                                )}
                            </div>
                            <button onClick={() => { setIsEditModalOpen(false); setEditingLead(null); }} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                                <div className="lg:col-span-3">
                                    <form id="edit-lead-form" onSubmit={handleSaveEdit}>
                                        <LeadFormFields form={editLeadForm} setForm={setEditLeadForm} columns={columns} selectedProduct={selectedProduct} hideObservation />
                                    </form>

                                    <div className="mt-8 pt-6 border-t border-slate-100 space-y-4">
                                        <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">Observacoes do Lead</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="md:col-span-1 space-y-1.5">
                                                <label className="text-xs font-bold text-slate-600">Data da observacao</label>
                                                <input
                                                    type="datetime-local"
                                                    value={editObservationDateTime}
                                                    onChange={(e) => setEditObservationDateTime(e.target.value)}
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]"
                                                />
                                            </div>
                                            <div className="md:col-span-2 space-y-1.5">
                                                <label className="text-xs font-bold text-slate-600">{editingObservationIndex === null ? 'Nova observacao' : 'Editar observacao'}</label>
                                                <textarea
                                                    value={editObservationText}
                                                    onChange={(e) => setEditObservationText(e.target.value)}
                                                    rows={3}
                                                    placeholder="Digite a observacao..."
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] resize-none"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            {editingObservationIndex !== null && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingObservationIndex(null);
                                                        setEditObservationText('');
                                                        setEditObservationDateTime(nowDateTimeLocal());
                                                    }}
                                                    className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50"
                                                >
                                                    Cancelar Edicao
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={handleAddOrUpdateObservation}
                                                className="px-4 py-2 rounded-xl bg-[#1B263B] text-white font-bold text-sm hover:bg-[#243347]"
                                            >
                                                {editingObservationIndex === null ? 'Adicionar Nota' : 'Salvar Nota'}
                                            </button>
                                        </div>

                                        <div className="mt-5">
                                            <h5 className="text-xs font-black text-[#1B263B] uppercase tracking-widest mb-2">Histórico de observações</h5>
                                            <div className="space-y-2 max-h-56 overflow-y-auto custom-scroll pr-1">
                                                {editObservationEntries.length === 0 ? (
                                                    <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-3">
                                                        Nenhuma observacao registrada ainda.
                                                    </div>
                                                ) : editObservationEntries.map((entry, idx) => (
                                                    <div
                                                        key={`${entry.timestamp}-${idx}`}
                                                        className="rounded-xl border border-[#C69C6D]/30 bg-white shadow-sm overflow-hidden"
                                                    >
                                                        <div className="flex items-start justify-between gap-2 px-3 py-2 bg-[#1B263B]">
                                                            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#243347] px-2 py-1 text-[11px] font-bold tabular-nums text-[#C69C6D] ring-1 ring-[#C69C6D]/40">
                                                                <Clock size={12} className="shrink-0 text-[#C69C6D]/90" aria-hidden />
                                                                {entry.timestamp}
                                                            </span>
                                                            <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleEditObservation(idx)}
                                                                    className="text-[11px] font-bold text-[#C69C6D] hover:text-white transition-colors"
                                                                >
                                                                    Editar
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteObservation(idx)}
                                                                    className="text-[11px] font-bold text-rose-300 hover:text-rose-100 transition-colors"
                                                                >
                                                                    Excluir
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm text-slate-700 whitespace-pre-wrap break-words px-3 py-2.5 leading-relaxed">
                                                            {entry.text}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Insurer Limits Section */}
                                    <div className="mt-8 pt-6 border-t border-slate-100 space-y-4">
                                        <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">Limites de Seguradoras</h4>
                                        {editLimitesArray.length > 0 && (
                                            <div className="space-y-2">
                                                {editLimitesArray.map((lim, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-[#C69C6D]/10 px-3 py-2 rounded-xl border border-[#C69C6D]/25">
                                                        <span className="flex-1 text-sm font-bold text-[#1B263B]">{lim.seguradora}</span>
                                                        <span className="text-sm font-black text-[#B8895A]">{lim.valor}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditLimitesArray(prev => prev.filter((_, idx) => idx !== i))}
                                                            className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="Seguradora"
                                                value={editCurrentLimit.seguradora}
                                                onChange={e => setEditCurrentLimit(prev => ({ ...prev, seguradora: e.target.value }))}
                                                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Valor (R$)"
                                                value={editCurrentLimit.valor}
                                                onChange={e => {
                                                    let val = e.target.value.replace(/\D/g, '');
                                                    if (val) val = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseInt(val) / 100);
                                                    setEditCurrentLimit(prev => ({ ...prev, valor: val }));
                                                }}
                                                className="w-32 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!editCurrentLimit.seguradora) return;
                                                    setEditLimitesArray(prev => [...prev, editCurrentLimit]);
                                                    setEditCurrentLimit({ seguradora: '', valor: '' });
                                                }}
                                                className="px-4 py-2 bg-[#1B263B] hover:bg-[#243347] text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center whitespace-nowrap shadow-md shrink-0"
                                            >
                                                Adicionar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="lg:col-span-2 border-l border-slate-100 pl-8">
                                    <TaskManager prospectId={editingLead.id} onTaskChange={fetchTasks} />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button type="button" onClick={() => { setIsEditModalOpen(false); setEditingLead(null); }} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                            <button type="submit" form="edit-lead-form" disabled={savingLead} className="bg-[#1B263B] hover:bg-[#243347] text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-[#1B263B]/25 disabled:opacity-50">
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
                                <p className="text-sm text-slate-500 font-medium mt-1">Nós encontramos <strong className="text-[#1B263B]">{csvRows.length}</strong> leads no arquivo.</p>
                            </div>
                            <button onClick={() => setIsImportModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scroll flex-1">
                            <div className="bg-[#F5F1EA] border border-[#C69C6D]/25 rounded-2xl p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-[#1B263B] rounded-xl flex items-center justify-center text-[#C69C6D] shadow-lg"><ArrowRight size={20} /></div>
                                    <div>
                                        <h4 className="font-black text-[#1B263B]">Coluna de Destino</h4>
                                        <p className="text-xs text-[#1B263B]/70 font-medium">Os leads serão importados para qual coluna?</p>
                                    </div>
                                </div>
                                <select value={importStatus} onChange={(e) => setImportStatus(e.target.value)} className="px-4 py-2.5 bg-white border border-[#C69C6D]/30 rounded-xl text-sm font-bold text-[#1B263B] outline-none focus:ring-4 focus:ring-[#C69C6D]/15 transition-all cursor-pointer shadow-sm min-w-[200px]">
                                    {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                                {DB_FIELDS.map(field => (
                                    <div key={field.key} className="flex flex-col gap-1.5 p-3 rounded-xl hover:bg-slate-50 border-2 border-transparent hover:border-slate-100 transition-colors">
                                        <label className="text-sm font-bold text-slate-700">{field.label}</label>
                                        <div className="relative">
                                            <select value={csvMapping[field.key] || ''} onChange={(e) => setCsvMapping({ ...csvMapping, [field.key]: e.target.value })} className="w-full px-4 py-2.5 pr-10 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all cursor-pointer appearance-none shadow-sm font-medium">
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
                            <button onClick={handleConfirmImport} disabled={importing} className="bg-[#1B263B] hover:bg-[#243347] text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-[#1B263B]/25 disabled:opacity-50">
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
