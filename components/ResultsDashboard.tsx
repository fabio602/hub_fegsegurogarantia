import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    Plus,
    Target,
    TrendingUp,
    Users,
    FileText,
    Download,
    Edit2,
    Trash2,
    ChevronRight,
    Calendar,
    DollarSign,
    Briefcase,
    AlertCircle,
    CheckCircle2,
    Clock,
    Loader2,
    Save,
    X,
    Search,
    Shield,
    Copy,
    Check,
    Mail,
    Send
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency, parseNumber } from '../utils/formatters';
import { Sale, LeadCost, CRMTask, Seller, MonthlyTarget } from '../types';
import ProspectsKanban from './ProspectsKanban';
import PendenciasHub from './PendenciasHub';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';
import TaskManager from './TaskManager';
import { generateThankYouEmail } from '../utils/emailTemplates';

// --- Configuration ---
interface InsurerLimit {
    seguradora: string;
    valor: string;
}

/** Unifica nomes de coluna da tabela `sales` (Postgres pode usar vigencia_* ou fim_vigencia / inicio_vigencia). */
function normalizeSaleFromDb(row: Record<string, unknown>): Sale {
    const r = row as any;
    return {
        ...(row as Sale),
        vigencia_inicio: r.vigencia_inicio ?? r.inicio_vigencia ?? '',
        vigencia_fim: r.vigencia_fim ?? r.fim_vigencia ?? '',
    };
}

/** Valor do `<select>` quando o usuário informa corretor/seguradora manualmente. */
const SEGURADORA_OUTRO_CORRETOR = '__outro_corretor__';

/** Formulário de limites quando a carteira ainda não tem nenhum — estado local por card (evita conflito entre clientes). */
function CarteiraEmptyLimitsForm({
    salesIds,
    insurers,
    saving,
    onSave,
}: {
    salesIds: number[];
    insurers: { id: string | number; nome: string }[];
    saving: boolean;
    onSave: (limits: InsurerLimit[]) => Promise<void>;
}) {
    const [tempLimits, setTempLimits] = useState<InsurerLimit[]>([]);
    const [newTemp, setNewTemp] = useState<InsurerLimit>({ seguradora: '', valor: '' });
    const [outroNome, setOutroNome] = useState('');

    const resolvedSeguradora = (lim: InsurerLimit, outro: string) =>
        lim.seguradora === SEGURADORA_OUTRO_CORRETOR ? outro.trim() : lim.seguradora;

    const appendPendingRow = (list: InsurerLimit[]) => {
        const r = resolvedSeguradora(newTemp, outroNome);
        if (r && newTemp.valor) {
            return [...list, { seguradora: r, valor: newTemp.valor }];
        }
        return list;
    };

    const handleSalvar = async () => {
        const finalLimits = appendPendingRow([...tempLimits]);
        if (finalLimits.length === 0) {
            return;
        }
        await onSave(finalLimits);
    };

    return (
        <div className="space-y-3 p-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <p className="text-[10px] font-bold text-slate-500 leading-snug">
                Nenhum limite cadastrado. Escolha a seguradora na lista ou <span className="text-[#C69C6D]">Outro corretor</span> para informar o nome manualmente, preencha o valor e salve.
            </p>
            <div className="space-y-2">
                {tempLimits.map((l, i) => (
                    <div key={i} className="flex justify-between items-center bg-white px-2 py-1.5 rounded-lg border border-slate-100 text-[11px]">
                        <span className="font-bold text-slate-700">{l.seguradora}</span>
                        <div className="flex items-center gap-2">
                            <span className="font-black text-slate-400">{formatCurrency(l.valor)}</span>
                            <button
                                type="button"
                                onClick={() => setTempLimits(prev => prev.filter((_, idx) => idx !== i))}
                                className="text-red-400 hover:text-red-600"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-1 items-stretch">
                <select
                    value={newTemp.seguradora}
                    onChange={e => {
                        const v = e.target.value;
                        setNewTemp(prev => ({ ...prev, seguradora: v }));
                        if (v !== SEGURADORA_OUTRO_CORRETOR) setOutroNome('');
                    }}
                    className="flex-1 min-w-[120px] text-[10px] p-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-[#C69C6D] bg-white"
                >
                    <option value="">Seguradora...</option>
                    {insurers.map(ins => (
                        <option key={ins.id} value={ins.nome}>{ins.nome}</option>
                    ))}
                    <option value={SEGURADORA_OUTRO_CORRETOR}>Outro corretor</option>
                </select>
                {newTemp.seguradora === SEGURADORA_OUTRO_CORRETOR && (
                    <input
                        type="text"
                        placeholder="Nome do corretor ou seguradora"
                        value={outroNome}
                        onChange={e => setOutroNome(e.target.value)}
                        className="flex-1 min-w-[140px] text-[10px] p-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-[#C69C6D] bg-slate-50"
                    />
                )}
                <input
                    type="text"
                    placeholder="R$ 0,00"
                    value={newTemp.valor}
                    onChange={e => {
                        const digits = e.target.value.replace(/\D/g, '');
                        const val = digits ? formatCurrency(parseFloat(digits) / 100) : '';
                        setNewTemp(prev => ({ ...prev, valor: val }));
                    }}
                    className="w-20 text-[10px] p-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-[#C69C6D] bg-white"
                />
                <button
                    type="button"
                    onClick={() => {
                        const r = resolvedSeguradora(newTemp, outroNome);
                        if (r && newTemp.valor) {
                            setTempLimits(prev => [...prev, { seguradora: r, valor: newTemp.valor }]);
                            setNewTemp({ seguradora: '', valor: '' });
                            setOutroNome('');
                        }
                    }}
                    className="bg-[#C69C6D] text-white p-2 rounded-lg shrink-0"
                >
                    <Plus size={12} />
                </button>
            </div>
            <button
                type="button"
                onClick={() => void handleSalvar()}
                disabled={saving || appendPendingRow([...tempLimits]).length === 0}
                className="w-full flex items-center justify-center gap-1 text-[10px] font-black text-emerald-600 hover:text-emerald-800 py-2.5 rounded-xl border border-emerald-200 bg-white hover:bg-emerald-50/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                SALVAR LIMITES
            </button>
        </div>
    );
}

const LIST_DATA = {
    origem: ["Google", "Instagram", "Prospecção Ativa", "Indicação", "Cliente da base"],
    tipoSeguro: ["Licitante", "Performance", "Cyber", "Risco de Engenharia", "Depósito Recursal"],
    motivoPerda: ["Preço fora do mercado", "Faltou agilidade", "Cliente não retornou", "Serasa", "Tomador sem seguradora disponível para cotação"]
};

/** Nomes dos meses (select de período). */
const MONTH_LABELS: Record<string, string> = {
    "01": "Janeiro",
    "02": "Fevereiro",
    "03": "Março",
    "04": "Abril",
    "05": "Maio",
    "06": "Junho",
    "07": "Julho",
    "08": "Agosto",
    "09": "Setembro",
    "10": "Outubro",
    "11": "Novembro",
    "12": "Dezembro"
};

/** Meta mensal total da empresa (fallback) quando não há registro em `monthly_targets` para o vendedor. */
const FALLBACK_COMPANY_MONTHLY_TOTAL: Record<string, number> = {
    "01": 20000,
    "02": 25000,
    "03": 20000,
    "04": 22000,
    "05": 25000,
    "06": 25000,
    "07": 25000,
    "08": 25000,
    "09": 27000,
    "10": 28000,
    "11": 28000,
    "12": 28000
};

function normalizeSellerRow(row: Record<string, unknown>): Seller {
    const r = row as Record<string, unknown>;
    return {
        id: String(r.id),
        name: String(r.name ?? ''),
        email: r.email != null ? String(r.email) : null,
        share: Number(r.share ?? 0),
        days_per_week: Number(r.days_per_week ?? 5),
        active: r.active !== false,
        created_at: r.created_at != null ? String(r.created_at) : undefined
    };
}

function normalizeMonthlyTargetRow(row: Record<string, unknown>): MonthlyTarget {
    const r = row as Record<string, unknown>;
    return {
        id: String(r.id),
        seller_id: String(r.seller_id),
        year: Number(r.year),
        month: Number(r.month),
        target: Number(r.target ?? 0)
    };
}

// --- Helper Components ---
const CopyButton = ({ text, label }: { text: string; label?: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="group/copy flex items-center gap-1.5 hover:text-[#C69C6D] transition-colors focus:outline-none"
            title={`Copiar ${label || ''}`}
        >
            {copied ? (
                <Check size={10} className="text-green-500 animate-in zoom-in duration-200" />
            ) : (
                <Copy size={10} className="text-slate-300 group-hover/copy:text-[#C69C6D] transition-all" />
            )}
            {copied && <span className="text-[8px] font-black text-green-500 uppercase tracking-tighter animate-in fade-in slide-in-from-left-1 duration-200">Copiado</span>}
        </button>
    );
};

const EXPIRY_REMINDER_DONE_STORAGE_KEY = 'feg_hub_sales_expiry_reminders_done';

function expiryReminderDismissKey(s: Pick<Sale, 'id' | 'vigencia_fim'>): string {
    return `${s.id}|${(s.vigencia_fim ?? '').trim()}`;
}

function loadExpiryReminderDismissed(): Set<string> {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(EXPIRY_REMINDER_DONE_STORAGE_KEY) : null;
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
    } catch {
        return new Set();
    }
}

type Section = 'sales' | 'prospects' | 'pendencias' | 'goals' | 'annualGoals' | 'carteira';

const ResultsDashboard: React.FC = () => {
    const [activeSection, setActiveSection] = useState<Section>('sales');
    const [sales, setSales] = useState<Sale[]>([]);
    const [leadCosts, setLeadCosts] = useState<LeadCost[]>([]);
    const [insurers, setInsurers] = useState<any[]>([]);
    const [sellers, setSellers] = useState<Seller[]>([]);
    const [monthlyTargets, setMonthlyTargets] = useState<MonthlyTarget[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [tasks, setTasks] = useState<CRMTask[]>([]);
    
    // -- Task Fetching --
    const fetchTasks = async () => {
        try {
            const { data, error } = await supabase
                .from('crm_tasks')
                .select('*')
                .eq('status', 'pending');
            if (error) throw error;
            setTasks(data || []);
        } catch (error) {
            console.error('Error fetching tasks:', error);
        }
    };
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    /** Toast global (portal em document.body) — evita recorte por overflow no layout do App */
    const [emailToast, setEmailToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);

    useEffect(() => {
        if (!emailToast) return;
        const id = window.setTimeout(() => setEmailToast(null), 5000);
        return () => clearTimeout(id);
    }, [emailToast]);
    const [showEmailPrompt, setShowEmailPrompt] = useState<{ email: string; name: string; decisor?: string } | null>(null);
    const [cnpjLookupStatus, setCnpjLookupStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
    const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());

    const [limitesArray, setLimitesArray] = useState<InsurerLimit[]>([]);
    const [currentLimit, setCurrentLimit] = useState<InsurerLimit>({ seguradora: '', valor: '' });

    // Client Portfolio Specific States
    const [editingClientLimits, setEditingClientLimits] = useState<string | null>(null);
    const [tempClientLimits, setTempClientLimits] = useState<InsurerLimit[]>([]);
    const [newTempLimit, setNewTempLimit] = useState<InsurerLimit>({ seguradora: '', valor: '' });
    const [newLimitSeguradoraOutro, setNewLimitSeguradoraOutro] = useState('');
    const [editingClientObs, setEditingClientObs] = useState<string | null>(null);
    const [tempClientObs, setTempClientObs] = useState('');
    const [editingClientName, setEditingClientName] = useState<string | null>(null);
    const [clientEditForm, setClientEditForm] = useState({ nome: '', cnpj: '', telefone: '', email: '', decisor: '' });
    const [sendingLimitsTo, setSendingLimitsTo] = useState<string | null>(null);
    const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
    const [newManualClientForm, setNewManualClientForm] = useState({ nome: '', cnpj: '', telefone: '', email: '', decisor: '' });
    const [addingManualClient, setAddingManualClient] = useState(false);

    // Filters
    const [salesMonthFilter, setSalesMonthFilter] = useState('');
    const [salesSearch, setSalesSearch] = useState('');
    const [salesStatusFilter, setSalesStatusFilter] = useState('');
    const [salesTipoFilter, setSalesTipoFilter] = useState('');
    const [salesVendedorFilter, setSalesVendedorFilter] = useState('');
    const [salesOrigemFilter, setSalesOrigemFilter] = useState('');
    const [salesLeadNomeFilter, setSalesLeadNomeFilter] = useState('');
    const [dismissedExpiryReminderKeys, setDismissedExpiryReminderKeys] = useState<Set<string>>(() =>
        loadExpiryReminderDismissed()
    );
    const [goalsMonthSelector, setGoalsMonthSelector] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [leadsMonthSelector, setLeadsMonthSelector] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedApolice, setSelectedApolice] = useState<File | null>(null);
    const [selectedBoleto, setSelectedBoleto] = useState<File | null>(null);
    const [sendingEmail, setSendingEmail] = useState(false);

    const [showNewSellerForm, setShowNewSellerForm] = useState(false);
    const [newSellerDraft, setNewSellerDraft] = useState({ name: '', email: '', sharePercent: '', daysPerWeek: '5' });
    const [editingSellerId, setEditingSellerId] = useState<string | null>(null);
    const [sellerEditDraft, setSellerEditDraft] = useState({ name: '', email: '', sharePercent: '', daysPerWeek: '' });
    const [sellerCrudBusy, setSellerCrudBusy] = useState(false);
    const [sellerMgmtError, setSellerMgmtError] = useState<string | null>(null);
    const [editingGoalTargetSellerId, setEditingGoalTargetSellerId] = useState<string | null>(null);
    const [goalTargetDraft, setGoalTargetDraft] = useState('');
    const [goalTargetSaving, setGoalTargetSaving] = useState(false);

    // Form State
    const [formData, setFormData] = useState<Partial<Sale>>({
        data: new Date().toISOString().split('T')[0],
        nome: '',
        origem: '',
        tipo: '',
        is: '',
        seguradora: '',
        premio: '',
        dataProposta: '',
        vendeu: 'Em andamento',
        motivoPerda: '',
        comissao: '',
        vendedor: '',
        indicacao: 'Não',
        limites: 'Não',
        catalogo: 'Não',
        vigencia_inicio: '',
        vigencia_fim: '',
        telefone: '',
        email: '',
        cnpj: '',
        decisor: '',
        product_type: 'Seguro Garantia',
        process_number: '',
        court: '',
        valorLote: '',
        orgaoLicitante: '',
        dataPregao: '',
        numeroContrato: '',
        objetoContrato: '',
        segurado: '',
        valorContrato: '',
    });

    const persistExpiryReminderDismissed = (keys: Set<string>) => {
        try {
            localStorage.setItem(EXPIRY_REMINDER_DONE_STORAGE_KEY, JSON.stringify([...keys]));
        } catch {
            /* ignore quota */
        }
    };

    const markExpiryReminderDone = (s: Sale) => {
        const key = expiryReminderDismissKey(s);
        setDismissedExpiryReminderKeys((prev) => {
            const next = new Set(prev).add(key);
            persistExpiryReminderDismissed(next);
            return next;
        });
    };

    // Compute sales expiring within 30 days (exclui itens marcados como “Concluído” neste navegador)
    const getExpiringAlerts = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const in30 = new Date(today);
        in30.setDate(in30.getDate() + 30);
        return sales
            .filter((s) => {
                if (!s.vigencia_fim || s.vendeu !== 'Sim') return false;
                if ((s.tipo || '').trim() !== 'Performance') return false;
                const fim = new Date(s.vigencia_fim);
                return fim >= today && fim <= in30;
            })
            .filter((s) => !dismissedExpiryReminderKeys.has(expiryReminderDismissKey(s)))
            .sort((a, b) => new Date(a.vigencia_fim!).getTime() - new Date(b.vigencia_fim!).getTime());
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [
                { data: salesData },
                { data: costsData },
                { data: insurersData },
                { data: sellersData },
                { data: mtData }
            ] = await Promise.all([
                supabase.from('sales').select('*').order('data', { ascending: false }),
                supabase.from('lead_costs').select('*'),
                supabase.from('insurers').select('*').order('nome'),
                supabase.from('sellers').select('*').order('name'),
                supabase.from('monthly_targets').select('*')
            ]);
            setSales((salesData || []).map((row) => normalizeSaleFromDb(row as Record<string, unknown>)));
            setLeadCosts(costsData || []);
            setInsurers(insurersData || []);
            setSellers((sellersData || []).map((row) => normalizeSellerRow(row as Record<string, unknown>)));
            setMonthlyTargets((mtData || []).map((row) => normalizeMonthlyTargetRow(row as Record<string, unknown>)));
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const refetchSellersAndTargets = useCallback(async () => {
        try {
            const [{ data: sellersData }, { data: mtData }] = await Promise.all([
                supabase.from('sellers').select('*').order('name'),
                supabase.from('monthly_targets').select('*')
            ]);
            setSellers((sellersData || []).map((row) => normalizeSellerRow(row as Record<string, unknown>)));
            setMonthlyTargets((mtData || []).map((row) => normalizeMonthlyTargetRow(row as Record<string, unknown>)));
        } catch (e) {
            console.error('Error fetching sellers/targets:', e);
        }
    }, []);

    useEffect(() => {
        fetchData();
        fetchTasks();
    }, [fetchData]);

    const vendedorSelectOptions = useMemo(
        () => sellers.filter((s) => s.active).map((s) => ({ name: s.name, email: s.email || '' })),
        [sellers]
    );

    const getSellerMonthlyTarget = (seller: Seller, year: number, monthNum: number): number => {
        const monthKey = String(monthNum).padStart(2, '0');
        const fallbackTotal = FALLBACK_COMPANY_MONTHLY_TOTAL[monthKey] ?? 0;
        const row = monthlyTargets.find(
            (t) => t.seller_id === seller.id && t.year === year && t.month === monthNum
        );
        if (row != null) return Number(row.target);
        return fallbackTotal * Number(seller.share);
    };

    const getCompanyMonthlyTargetTotal = (year: number, monthNum: number): number => {
        const active = sellers.filter((s) => s.active);
        const monthKey = String(monthNum).padStart(2, '0');
        const fallbackOnly = FALLBACK_COMPANY_MONTHLY_TOTAL[monthKey] ?? 0;
        if (active.length === 0) return fallbackOnly;
        return active.reduce((sum, seller) => sum + getSellerMonthlyTarget(seller, year, monthNum), 0);
    };

    const commitMonthlyTargetForSeller = async (sellerId: string, rawValue: string) => {
        const parts = goalsMonthSelector.split('-');
        const year = parseInt(parts[0], 10);
        const monthNum = parseInt(parts[1], 10);
        const targetVal = parseNumber(rawValue.trim());
        setGoalTargetSaving(true);
        try {
            const { error } = await supabase.from('monthly_targets').upsert(
                {
                    seller_id: sellerId,
                    year,
                    month: monthNum,
                    target: targetVal
                },
                { onConflict: 'seller_id,year,month' }
            );
            if (error) throw error;
            await refetchSellersAndTargets();
            setEditingGoalTargetSellerId(null);
            setGoalTargetDraft('');
            setSellerMgmtError(null);
        } catch (err) {
            console.error(err);
            setSellerMgmtError('Não foi possível salvar a meta mensal.');
        } finally {
            setGoalTargetSaving(false);
        }
    };

    const handleInsertSeller = async () => {
        const sharePct = parseFloat(newSellerDraft.sharePercent.replace(',', '.'));
        const days = parseInt(newSellerDraft.daysPerWeek, 10);
        if (!newSellerDraft.name.trim()) {
            setSellerMgmtError('Informe o nome do vendedor.');
            return;
        }
        if (Number.isNaN(sharePct) || sharePct < 0 || sharePct > 100) {
            setSellerMgmtError('Share inválido (use % entre 0 e 100).');
            return;
        }
        if (Number.isNaN(days) || days < 1 || days > 7) {
            setSellerMgmtError('Dias por semana deve ser entre 1 e 7.');
            return;
        }
        setSellerCrudBusy(true);
        setSellerMgmtError(null);
        try {
            const { error } = await supabase.from('sellers').insert({
                name: newSellerDraft.name.trim(),
                email: newSellerDraft.email.trim() || null,
                share: sharePct / 100,
                days_per_week: days,
                active: true
            });
            if (error) throw error;
            setNewSellerDraft({ name: '', email: '', sharePercent: '', daysPerWeek: '5' });
            setShowNewSellerForm(false);
            await refetchSellersAndTargets();
        } catch (err) {
            console.error(err);
            setSellerMgmtError('Não foi possível criar o vendedor.');
        } finally {
            setSellerCrudBusy(false);
        }
    };

    const handleUpdateSeller = async (id: string) => {
        const sharePct = parseFloat(sellerEditDraft.sharePercent.replace(',', '.'));
        const days = parseInt(sellerEditDraft.daysPerWeek, 10);
        if (!sellerEditDraft.name.trim()) {
            setSellerMgmtError('Informe o nome do vendedor.');
            return;
        }
        if (Number.isNaN(sharePct) || sharePct < 0 || sharePct > 100) {
            setSellerMgmtError('Share inválido (use % entre 0 e 100).');
            return;
        }
        if (Number.isNaN(days) || days < 1 || days > 7) {
            setSellerMgmtError('Dias por semana deve ser entre 1 e 7.');
            return;
        }
        setSellerCrudBusy(true);
        setSellerMgmtError(null);
        try {
            const { error } = await supabase
                .from('sellers')
                .update({
                    name: sellerEditDraft.name.trim(),
                    email: sellerEditDraft.email.trim() || null,
                    share: sharePct / 100,
                    days_per_week: days
                })
                .eq('id', id);
            if (error) throw error;
            setEditingSellerId(null);
            await refetchSellersAndTargets();
        } catch (err) {
            console.error(err);
            setSellerMgmtError('Não foi possível atualizar o vendedor.');
        } finally {
            setSellerCrudBusy(false);
        }
    };

    const handleDeleteSeller = async (id: string, name: string) => {
        if (!confirm(`Excluir o vendedor "${name}"? As metas mensais associadas serão removidas.`)) return;
        setSellerCrudBusy(true);
        setSellerMgmtError(null);
        try {
            const { error } = await supabase.from('sellers').delete().eq('id', id);
            if (error) throw error;
            if (editingSellerId === id) setEditingSellerId(null);
            await refetchSellersAndTargets();
        } catch (err) {
            console.error(err);
            setSellerMgmtError('Não foi possível excluir o vendedor.');
        } finally {
            setSellerCrudBusy(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { id, type } = e.target as HTMLInputElement;
        let value = e.target.value;

        if (type === 'checkbox') {
            const checked = (e.target as HTMLInputElement).checked;
            setFormData(prev => ({ ...prev, [id]: checked ? 'Sim' : 'Não' }));
        } else {
            if (id === 'is' || id === 'premio' || id === 'comissao' || id === 'valorLote' || id === 'valorContrato') {
                // Remove everything except digits
                const digits = value.replace(/\D/g, '');
                if (digits === '') {
                    value = '';
                } else {
                    // Convert to number (cents / 100) and format using formatNumber (no R$)
                    // or keep it as string if you want to keep the "R$" prefix.
                    // But Calculator.tsx uses formatNumber (no prefix in state) or prepends R$ in UI.
                    // Let's use currency formatting but ensure we pass a number.
                    value = formatCurrency(parseFloat(digits) / 100);
                }
            }
            setFormData(prev => ({ ...prev, [id]: value }));
        }
    };

    const handleCnpjChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setFormData(prev => ({ ...prev, cnpj: raw }));
        setAutoFilledFields(new Set());

        // Strip non-digits to check length
        const digits = raw.replace(/\D/g, '');
        if (digits.length !== 14) {
            setCnpjLookupStatus('idle');
            return;
        }

        setCnpjLookupStatus('searching');
        try {
            const { data } = await supabase
                .from('sales')
                .select('nome, telefone, email, decisor')
                .eq('cnpj', raw)
                .not('nome', 'is', null)
                .limit(1);

            if (data && data.length > 0) {
                const client = data[0];
                const filled = new Set<string>();
                setFormData(prev => {
                    const updated = { ...prev };
                    if (client.nome) { updated.nome = client.nome; filled.add('nome'); }
                    if (client.telefone) { updated.telefone = client.telefone; filled.add('telefone'); }
                    if (client.email) { updated.email = client.email; filled.add('email'); }
                    if (client.decisor) { updated.decisor = client.decisor; filled.add('decisor'); }
                    return updated;
                });
                setAutoFilledFields(filled);
                setCnpjLookupStatus('found');
            } else {
                setCnpjLookupStatus('not_found');
            }
        } catch {
            setCnpjLookupStatus('idle');
        }
    };

    const handleSaleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        // Sanitize: only send columns that exist in the Supabase table
        const payload = {
            data: formData.data || null,
            nome: formData.nome || null,
            origem: formData.origem || null,
            tipo: formData.tipo || null,
            is: formData.is || null,
            seguradora: formData.seguradora || null,
            premio: formData.premio || null,
            vendeu: formData.vendeu || null,
            comissao: formData.comissao || null,
            vendedor: formData.vendedor || null,
            indicacao: formData.indicacao || null,
            limites: formData.limites || null,
            catalogo: formData.catalogo || null,
            vigencia_inicio: formData.vigencia_inicio || null,
            // Coluna na tabela `sales`: `vigencia_fim` (UI: Fim Vigência)
            vigencia_fim: formData.vigencia_fim || null,
            telefone: formData.telefone || null,
            email: formData.email || null,
            cnpj: formData.cnpj || null,
            decisor: formData.decisor || null,
            product_type: formData.product_type || 'Seguro Garantia',
            process_number: formData.process_number || null,
            court: formData.court || null,
            valorLote: formData.valorLote || null,
            orgaoLicitante: formData.orgaoLicitante || null,
            dataPregao: formData.dataPregao || null,
            numeroContrato: formData.numeroContrato || null,
            objetoContrato: formData.objetoContrato || null,
            segurado: formData.segurado || null,
            valorContrato: formData.valorContrato || null,
            limites_seguradoras: limitesArray.length > 0 ? JSON.stringify(limitesArray) : null,
        };

        try {
            if (editingId) {
                const { error } = await supabase.from('sales').update(payload).eq('id', editingId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('sales').insert([payload]);
                if (error) throw error;
            }
            await fetchData();
            setSaveSuccess(true);
            
            // If the sale was won, trigger the thank you email manually with attachments
            if (payload.vendeu === 'Sim' && payload.email) {
                setSendingEmail(true);
                try {
                    console.log('[Manual Email] Starting attachment processing...', { selectedApolice: !!selectedApolice, selectedBoleto: !!selectedBoleto });
                    const attachments: any[] = [];
                    
                    const readFile = (file: File) => new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve({
                            content: (reader.result as string).split(',')[1],
                            filename: file.name
                        });
                        reader.onerror = () => reject(new Error(`Erro ao ler arquivo ${file.name}`));
                        reader.readAsDataURL(file);
                    });

                    if (selectedApolice) attachments.push(await readFile(selectedApolice));
                    if (selectedBoleto) attachments.push(await readFile(selectedBoleto));

                    console.log(`[Manual Email] Invoking send-thank-you for ${payload.nome} with ${attachments.length} attachments`);
                    
                    // Manual call to send-thank-you
                    const { data, error: invokeError } = await supabase.functions.invoke('send-thank-you', {
                        body: {
                            type: 'MANUAL',
                            record: {
                                ...payload,
                                id: editingId || 0 
                            },
                            attachments
                        }
                    });

                    if (invokeError) throw invokeError;
                    console.log('[Manual Email] Success:', data);
                    setEmailSuccess(true);
                    setTimeout(() => setEmailSuccess(false), 3000);
                } catch (emailError: any) {
                    console.error('[Manual Email] Failed:', emailError);
                    // We don't block the main save success, but we notify in console
                } finally {
                    setSendingEmail(false);
                }
            }

            setTimeout(() => setSaveSuccess(false), 3000);
            resetForm();
        } catch (error: any) {
            console.error('Error saving sale:', error);
            setSaveError(error?.message || 'Erro ao salvar. Tente novamente.');
        } finally {
            setSaving(false);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setLimitesArray([]);
        setCurrentLimit({ seguradora: '', valor: '' });
        setCnpjLookupStatus('idle');
        setAutoFilledFields(new Set());
        setFormData({
            data: new Date().toISOString().split('T')[0],
            nome: '',
            origem: '',
            tipo: '',
            is: '',
            seguradora: '',
            premio: '',
            dataProposta: '',
            vendeu: 'Em andamento',
            motivoPerda: '',
            comissao: '',
            vendedor: '',
            indicacao: 'Não',
            limites: 'Não',
            catalogo: 'Não',
            vigencia_inicio: '',
            vigencia_fim: '',
            telefone: '',
            email: '',
            cnpj: '',
            decisor: '',
            product_type: 'Seguro Garantia',
            process_number: '',
            court: '',
            valorLote: '',
            orgaoLicitante: '',
            dataPregao: '',
            numeroContrato: '',
            objetoContrato: '',
            segurado: '',
            valorContrato: '',
        });
        setSelectedFile(null);
        setSelectedApolice(null);
        setSelectedBoleto(null);
    };

    const handleEdit = (sale: Sale) => {
        setEditingId(sale.id);
        setFormData(sale);
        if (sale.limites_seguradoras) {
            try {
                setLimitesArray(JSON.parse(sale.limites_seguradoras));
            } catch (e) {
                setLimitesArray([]);
            }
        } else {
            setLimitesArray([]);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Deseja realmente excluir este registro?')) return;
        try {
            await supabase.from('sales').delete().eq('id', id);
            await fetchData();
        } catch (error) {
            console.error('Error deleting sale:', error);
        }
    };

    const handleSaveClientObs = async (salesIds: number[]) => {
        setSaving(true);
        setSaveError(null);
        try {
            const obsVal = tempClientObs.trim() || null;
            const { error } = await supabase.from('sales').update({ obs: obsVal }).in('id', salesIds);
            if (error) throw error;
            await fetchData();
            setEditingClientObs(null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error: any) {
            setSaveError(error?.message || 'Erro ao salvar observações.');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveClientInfo = async (salesIds: number[]) => {
        setSaving(true);
        setSaveError(null);
        try {
            const { error } = await supabase
                .from('sales')
                .update({
                    nome: clientEditForm.nome || null,
                    cnpj: clientEditForm.cnpj || null,
                    telefone: clientEditForm.telefone || null,
                    email: clientEditForm.email || null,
                    decisor: clientEditForm.decisor || null,
                })
                .in('id', salesIds);
            if (error) throw error;
            await fetchData();
            setEditingClientName(null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error: any) {
            setSaveError(error?.message || 'Erro ao atualizar cliente.');
        } finally {
            setSaving(false);
        }
    };

    const closeAddClientModal = () => {
        setIsAddClientModalOpen(false);
        setSaveError(null);
        setNewManualClientForm({ nome: '', cnpj: '', telefone: '', email: '', decisor: '' });
        setAddingManualClient(false);
    };

    /** Cadastro na carteira sem venda: mesma linha de raciocínio do import CRM legado (007). */
    const handleSaveManualClient = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const nome = newManualClientForm.nome.trim();
        if (!nome) {
            setSaveError('Informe o nome ou razão social do cliente.');
            return;
        }
        setAddingManualClient(true);
        setSaveError(null);
        try {
            const today = new Date().toISOString().split('T')[0];
            const payload = {
                data: today,
                nome,
                origem: 'Cadastro manual — Carteira',
                tipo: null,
                is: null,
                seguradora: null,
                premio: null,
                vendeu: 'Em andamento',
                comissao: null,
                vendedor: null,
                indicacao: 'Não',
                limites: 'Não',
                catalogo: 'Não',
                vigencia_inicio: null,
                vigencia_fim: null,
                telefone: newManualClientForm.telefone.trim() || null,
                email: newManualClientForm.email.trim() || null,
                cnpj: newManualClientForm.cnpj.trim() || null,
                decisor: newManualClientForm.decisor.trim() || null,
                product_type: 'Seguro Garantia',
                limites_seguradoras: null,
            };
            const { error } = await supabase.from('sales').insert([payload]);
            if (error) throw error;
            await fetchData();
            closeAddClientModal();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error: any) {
            setSaveError(error?.message || 'Erro ao cadastrar cliente.');
        } finally {
            setAddingManualClient(false);
        }
    };

    const handleSendDraft = async () => {
        if (!formData.email || !formData.nome) {
            setSaveError('E-mail e Nome do Cliente são obrigatórios para enviar a minuta.');
            return;
        }
        
        setSaving(true);
        setSaveError(null);
        try {
            let attachmentBase64 = null;
            let attachmentName = null;

            if (selectedFile) {
                const reader = new FileReader();
                attachmentBase64 = await new Promise((resolve, reject) => {
                    reader.onload = () => {
                        const base64String = (reader.result as string).split(',')[1];
                        resolve(base64String);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(selectedFile);
                });
                attachmentName = selectedFile.name;
            }

            const { error } = await supabase.functions.invoke('send-draft-approval', {
                body: {
                    clientName: formData.nome,
                    clientEmail: formData.email.trim(),
                    decisor: formData.decisor || undefined,
                    tipoSeguro: formData.tipo,
                    isGarantida: formData.is,
                    valorLote: formData.valorLote,
                    orgaoLicitante: formData.orgaoLicitante,
                    dataPregao: formData.dataPregao,
                    numeroContrato: formData.numeroContrato,
                    objetoContrato: formData.objetoContrato,
                    segurado: formData.segurado,
                    valorContrato: formData.valorContrato,
                    vigenciaInicio: formData.vigencia_inicio,
                    vigenciaFim: formData.vigencia_fim,
                    seguradora: formData.seguradora,
                    premio: formData.premio,
                    attachment: attachmentBase64,
                    attachmentName: attachmentName
                }
            });

            if (error) throw error;

            setEmailToast({ variant: 'success', message: 'E-mail enviado com sucesso!' });
            setSelectedFile(null); // Clear file after send
        } catch (error: any) {
            console.error('Error sending draft:', error);
            const msg = error?.message || 'Erro ao enviar minuta.';
            setSaveError(msg);
            setEmailToast({ variant: 'error', message: msg });
        } finally {
            setSaving(false);
        }
    };

    const handleSendLimits = async (client: any) => {
        if (!client.email) {
            setSaveError('E-mail do cliente não cadastrado.');
            return;
        }
        
        setSendingLimitsTo(client.nome);
        setSaveError(null);
        try {
            const { error } = await supabase.functions.invoke('send-limits', {
                body: {
                    clientName: client.nome,
                    clientEmail: client.email.trim(),
                    decisor: client.decisor,
                    limits: client.limites
                }
            });

            if (error) throw error;

            setEmailToast({ variant: 'success', message: 'Limites enviados por e-mail com sucesso!' });
        } catch (error: any) {
            console.error('Error sending limits:', error);
            const msg = error?.message || 'Erro ao enviar limites.';
            setSaveError(msg);
            setEmailToast({ variant: 'error', message: msg });
        } finally {
            setSendingLimitsTo(null);
        }
    };

    const persistClientLimitsToSales = async (salesIds: number[], finalLimits: InsurerLimit[]) => {
        setSaving(true);
        setSaveError(null);
        try {
            const limitesJson = JSON.stringify(finalLimits);
            const { error } = await supabase
                .from('sales')
                .update({ limites_seguradoras: limitesJson })
                .in('id', salesIds);
            if (error) throw error;
            await fetchData();
            setEditingClientLimits(null);
            setNewTempLimit({ seguradora: '', valor: '' });
            setNewLimitSeguradoraOutro('');
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error: any) {
            console.error('Error updating client limits:', error);
            setSaveError(error?.message || 'Erro ao atualizar limites.');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateClientLimits = async (_clientName: string, salesIds: number[]) => {
        let finalLimits = [...tempClientLimits];
        const resolvedSeguradora =
            newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR
                ? newLimitSeguradoraOutro.trim()
                : newTempLimit.seguradora;
        if (resolvedSeguradora && newTempLimit.valor) {
            finalLimits.push({ ...newTempLimit, seguradora: resolvedSeguradora });
        }
        await persistClientLimitsToSales(salesIds, finalLimits);
    };

    const updateManualCost = async (key: string, value: number) => {
        try {
            await supabase.from('lead_costs').upsert({ key, value }, { onConflict: 'key' });
            const { data } = await supabase.from('lead_costs').select('*');
            setLeadCosts(data || []);
        } catch (error) {
            console.error('Error updating cost:', error);
        }
    };

    const handleConvertToSale = (leadData: { nome: string; cnpj: string; telefone: string; email: string; decisor: string; limites_seguradoras?: string }) => {
        setFormData(prev => ({
            ...prev,
            nome: leadData.nome || '',
            cnpj: leadData.cnpj || '',
            telefone: leadData.telefone || '',
            email: leadData.email || '',
            decisor: leadData.decisor || '',
            origem: 'Prospecção Ativa',
            product_type: (leadData as any).product_type || 'Seguro Garantia',
            process_number: (leadData as any).judicial_process_number || '',
            court: (leadData as any).judicial_court || '',
        }));
        // Port limits from the lead into the new sale form
        if (leadData.limites_seguradoras) {
            try {
                const parsed = JSON.parse(leadData.limites_seguradoras);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setLimitesArray(parsed);
                }
            } catch { /* ignore */ }
        }
        setActiveSection('sales');
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    };

    const exportToCSV = () => {
        const filteredSales = salesMonthFilter
            ? sales.filter(s => s.data.startsWith(salesMonthFilter))
            : sales;

        if (filteredSales.length === 0) return;

        const headers = ["Data", "Cliente", "Origem", "Qualificado", "Tipo", "IS", "Seguradora", "Premio", "Proposta", "Vendeu", "Comissao", "Vendedor"];
        const csvContent = [
            headers.join(","),
            ...filteredSales.map(s => [
                s.data,
                `"${s.nome}"`,
                s.origem,
                s.qualificado,
                s.tipo,
                s.is || "",
                s.seguradora || "",
                s.premio || "",
                s.dataProposta || "",
                s.vendeu,
                s.comissao || "",
                s.vendedor
            ].join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `Vendas_${salesMonthFilter || 'Todas'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- Calculations ---
    const getWeekdayCount = (year: number, month: number) => {
        let count = 0;
        const date = new Date(year, month - 1, 1);
        while (date.getMonth() === month - 1) {
            const day = date.getDay();
            if (day !== 0 && day !== 6) count++;
            date.setDate(date.getDate() + 1);
        }
        return count;
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 size={40} className="animate-spin mb-4 text-[#C69C6D]" />
                <p className="font-bold uppercase tracking-widest text-xs">Carregando Dashboard...</p>
            </div>
        );
    }

    return (
        <>
            {emailToast &&
                createPortal(
                    <div
                        role="status"
                        className={`fixed top-6 left-1/2 z-[99999] flex max-w-[min(100vw-2rem,28rem)] -translate-x-1/2 items-center gap-3 rounded-2xl px-5 py-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-bold text-sm text-white ${
                            emailToast.variant === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
                        }`}
                    >
                        {emailToast.variant === 'success' ? (
                            <CheckCircle2 size={22} className="shrink-0 text-white" />
                        ) : (
                            <AlertCircle size={22} className="shrink-0 text-white" />
                        )}
                        <span className="text-left leading-snug">{emailToast.message}</span>
                    </div>,
                    document.body
                )}
        <div className="space-y-8 animate-in fade-in duration-500 max-w-[1600px] mx-auto relative">
            {/* Sub-Navigation */}
            <div className="bg-[#1B263B] p-2 rounded-2xl inline-flex gap-1 shadow-xl no-print">
                {(['sales', 'prospects', 'pendencias', 'carteira', 'goals', 'annualGoals'] as Section[]).map((section) => (
                    <button
                        key={section}
                        onClick={() => setActiveSection(section)}
                        className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${activeSection === section
                            ? 'bg-[#C69C6D] text-white shadow-lg'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        {section === 'sales' && 'Vendas'}
                        {section === 'prospects' && 'Prospecção'}
                        {section === 'pendencias' && 'Pendências'}
                        {section === 'carteira' && 'Carteira de Clientes'}
                        {section === 'goals' && 'Metas Mensais'}
                        {section === 'annualGoals' && 'Metas Anuais'}
                    </button>
                ))}
            </div>

            {activeSection === 'sales' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    {/* Expiry Alert Banner */}
                    {(() => {
                        const alerts = getExpiringAlerts();
                        if (alerts.length === 0) return null;
                        return (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                                        <AlertCircle size={18} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="font-black text-amber-800 text-sm">
                                            ⚠️ {alerts.length} apólice{alerts.length > 1 ? 's' : ''} <span className="text-amber-900">Performance</span>{' '}
                                            {alerts.length > 1 ? 'vencem' : 'vence'} nos próximos 30 dias
                                        </p>
                                        <p className="text-amber-600 text-xs font-medium">Acione o cliente para renovação (apenas tipo Performance).</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {alerts.map(s => {
                                        const fim = new Date(s.vigencia_fim!);
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        const daysLeft = Math.ceil((fim.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                                        return (
                                            <div key={s.id} className="flex justify-between items-center bg-white rounded-xl px-4 py-3 border border-amber-100 gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-black text-slate-800 text-sm truncate">{s.nome}</p>
                                                    <p className="text-xs text-slate-500">{s.tipo} • {s.vendedor}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-black text-amber-600 text-sm">{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</p>
                                                    <p className="text-xs text-slate-400">Vence {fim.toLocaleDateString('pt-BR')}</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => markExpiryReminderDone(s)}
                                                        className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 font-black text-xs px-3 py-2 rounded-lg transition-all"
                                                        title="Remover da lista — pendência já tratada"
                                                    >
                                                        <Check size={13} strokeWidth={2.5} /> Concluído
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEdit(s)}
                                                        className="flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 font-black text-xs px-3 py-2 rounded-lg transition-all"
                                                        title="Editar este lead"
                                                    >
                                                        <Edit2 size={13} /> Editar
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">Acompanhamento de Vendas</h2>
                            <p className="text-slate-500 font-medium">Gestão operacional do funil de vendas corporativo.</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                            <div className="flex flex-wrap items-center gap-2 flex-1 md:flex-none">
                                <div className="relative flex-1 md:flex-none min-w-0">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text" placeholder="Buscar lead, origem, seguro..."
                                        value={salesSearch} onChange={e => setSalesSearch(e.target.value)}
                                        className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full md:w-64 focus:ring-2 focus:ring-[#C69C6D]/20 shadow-sm"
                                    />
                                </div>
                                {(salesMonthFilter ||
                                    salesStatusFilter ||
                                    salesTipoFilter ||
                                    salesVendedorFilter ||
                                    salesOrigemFilter ||
                                    salesLeadNomeFilter) && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSalesMonthFilter('');
                                            setSalesStatusFilter('');
                                            setSalesTipoFilter('');
                                            setSalesVendedorFilter('');
                                            setSalesOrigemFilter('');
                                            setSalesLeadNomeFilter('');
                                        }}
                                        className="shrink-0 bg-white text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all whitespace-nowrap"
                                    >
                                        Limpar filtros
                                    </button>
                                )}
                            </div>
                            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                                <Calendar size={18} className="text-[#C69C6D]" />
                                <select
                                    value={salesMonthFilter}
                                    onChange={(e) => setSalesMonthFilter(e.target.value)}
                                    className="bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 outline-none"
                                >
                                    <option value="">Todos os Meses</option>
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(m => {
                                        const month = String(m + 1).padStart(2, '0');
                                        return <option key={m} value={`${new Date().getFullYear()}-${month}`}>
                                            {MONTH_LABELS[month]}
                                        </option>
                                    })}
                                </select>
                            </div>
                            <button
                                onClick={exportToCSV}
                                className="bg-white text-slate-700 px-5 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2"
                            >
                                <Download size={18} />
                                Exportar
                            </button>
                        </div>
                    </div>

                    {/* Form Card */}
                    <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                        <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
                            <div className="w-1.5 h-6 bg-[#C69C6D] rounded-full"></div>
                            {editingId ? 'Editar Registro' : 'Nova Entrada de Venda'}
                        </h3>

                        {saveError && (
                            <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-600 px-5 py-4 rounded-xl text-sm font-bold">
                                <AlertCircle size={18} />
                                {saveError}
                            </div>
                        )}
                        {saveSuccess && (
                            <div className="mb-6 flex flex-col gap-4 bg-emerald-50 border border-emerald-200 text-emerald-600 px-5 py-4 rounded-xl text-sm font-bold animate-in zoom-in duration-300">
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 size={18} />
                                    Venda salva com sucesso!
                                </div>
                                
                                {showEmailPrompt && (
                                    <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-2 duration-500">
                                        <div>
                                            <p className="text-slate-800 text-xs"><strong>Automação Ativa:</strong> O e-mail de agradecimento para {showEmailPrompt.name} será enviado automaticamente pelo servidor.</p>
                                            <p className="text-slate-500 text-[10px] font-medium mt-1">Deseja abrir uma cópia manual agora no seu e-mail para revisão rápida?</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    const mailto = generateThankYouEmail(showEmailPrompt.email, showEmailPrompt.name, showEmailPrompt.decisor);
                                                    window.location.href = mailto;
                                                    setShowEmailPrompt(null);
                                                }}
                                                className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-[10px] hover:bg-slate-200 transition-colors flex items-center gap-2"
                                            >
                                                <Mail size={14} />
                                                Abrir Cópia Manual
                                            </button>
                                            <button
                                                onClick={() => setShowEmailPrompt(null)}
                                                className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-[10px] hover:bg-emerald-700 transition-colors"
                                            >
                                                Entendido
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <form onSubmit={handleSaleSubmit} className="space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">Data</label>
                                    <div className="relative">
                                        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input type="date" id="data" value={formData.data} onChange={handleInputChange} className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all" />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">Nome do Cliente / Tomador</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="nome" value={formData.nome || ''}
                                            onChange={(e) => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('nome'); return s; }); handleInputChange(e); }}
                                            required placeholder="Ex: Empresa XYZ"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('nome')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">CNPJ / CPF</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="cnpj" value={formData.cnpj || ''}
                                            onChange={handleCnpjChange}
                                            placeholder="00.000.000/0000-00"
                                            className="w-full px-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all"
                                        />
                                        {/* CNPJ lookup status icon */}
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                            {cnpjLookupStatus === 'searching' && (
                                                <Loader2 size={16} className="animate-spin text-[#C69C6D]" />
                                            )}
                                            {cnpjLookupStatus === 'found' && (
                                                <span title="Cliente encontrado na base!">
                                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                                </span>
                                            )}
                                            {cnpjLookupStatus === 'not_found' && (
                                                <span title="CNPJ não encontrado. Preencha manualmente.">
                                                    <AlertCircle size={16} className="text-amber-500" />
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {cnpjLookupStatus === 'found' && (
                                        <p className="text-[10px] font-bold text-emerald-600 mt-1">✓ Cliente encontrado — dados preenchidos automaticamente</p>
                                    )}
                                    {cnpjLookupStatus === 'not_found' && (
                                        <p className="text-[10px] font-bold text-amber-600 mt-1">⚠ CNPJ não encontrado na base. Preencha manualmente.</p>
                                    )}
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">Telefone</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="telefone" value={formData.telefone || ''}
                                            onChange={(e) => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('telefone'); return s; }); handleInputChange(e); }}
                                            placeholder="(00) 00000-0000"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('telefone')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">Decisor / Responsável</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="decisor" value={formData.decisor || ''}
                                            onChange={(e) => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('decisor'); return s; }); handleInputChange(e); }}
                                            placeholder="Nome do responsável"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('decisor')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">E-mail</label>
                                    <div className="relative">
                                        <input
                                            type="email" id="email" value={formData.email || ''}
                                            onChange={(e) => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('email'); return s; }); handleInputChange(e); }}
                                            placeholder="email@empresa.com"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('email')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D]'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-[#C69C6D]">Origem</label>
                                    <select id="origem" value={formData.origem} onChange={handleInputChange} required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all">
                                        <option value="">Selecione...</option>
                                        {LIST_DATA.origem.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tipo Seguro</label>
                                    <select id="tipo" value={formData.tipo} onChange={handleInputChange} required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="">Selecione...</option>
                                        {LIST_DATA.tipoSeguro.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">IS Garantida</label>
                                    <input type="text" id="is" value={formData.is} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Seguradora</label>
                                    <input type="text" id="seguradora" value={formData.seguradora} onChange={handleInputChange} placeholder="Nome" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor Prêmio</label>
                                    <input type="text" id="premio" value={formData.premio} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Vendeu?</label>
                                    <select id="vendeu" value={formData.vendeu} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="Sim">Sim</option>
                                        <option value="Não">Não</option>
                                        <option value="Em andamento">Em andamento</option>
                                    </select>
                                </div>
                                {formData.vendeu === 'Não' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Motivo da Perda</label>
                                        <select id="motivoPerda" value={formData.motivoPerda} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                            <option value="">Selecione...</option>
                                            {LIST_DATA.motivoPerda.map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                    </div>
                                )}
                                {(formData.vendeu === 'Sim' || (formData.vendeu === 'Em andamento' && formData.tipo === 'Licitante')) && (
                                    <>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Início Vigência</label>
                                            <input
                                                type="date"
                                                id="vigencia_inicio"
                                                value={formData.vigencia_inicio || ''}
                                                onChange={(e) => {
                                                    const inicio = e.target.value;
                                                    setFormData(prev => {
                                                        const dias = parseInt((prev as any)._vigencia_dias || '0');
                                                        let fim = prev.vigencia_fim || '';
                                                        if (inicio && dias > 0) {
                                                            const d = new Date(inicio);
                                                            d.setDate(d.getDate() + dias);
                                                            fim = d.toISOString().split('T')[0];
                                                        }
                                                        return { ...prev, vigencia_inicio: inicio, vigencia_fim: fim };
                                                    });
                                                }}
                                                className="w-full bg-[#C69C6D]/5 border border-[#C69C6D]/30 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">⏱ Dias de Vigência</label>
                                            <input
                                                type="number"
                                                min="1"
                                                placeholder="Ex: 365"
                                                value={(formData as any)._vigencia_dias || ''}
                                                onChange={(e) => {
                                                    const dias = parseInt(e.target.value) || 0;
                                                    setFormData(prev => {
                                                        let fim = prev.vigencia_fim || '';
                                                        if (prev.vigencia_inicio && dias > 0) {
                                                            const d = new Date(prev.vigencia_inicio);
                                                            d.setDate(d.getDate() + dias);
                                                            fim = d.toISOString().split('T')[0];
                                                        }
                                                        return { ...prev, _vigencia_dias: e.target.value, vigencia_fim: fim } as any;
                                                    });
                                                }}
                                                className="w-full bg-[#1B263B]/5 border border-[#1B263B]/20 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all outline-none font-bold text-[#1B263B]"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Fim Vigência</label>
                                            <input
                                                type="date"
                                                id="vigencia_fim"
                                                value={formData.vigencia_fim || ''}
                                                onChange={handleInputChange}
                                                className="w-full bg-[#C69C6D]/5 border border-[#C69C6D]/30 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] transition-all outline-none"
                                            />
                                        </div>
                                    </>
                                )}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor Comissão</label>
                                    <input type="text" id="comissao" value={formData.comissao} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Vendedor</label>
                                    <select id="vendedor" value={formData.vendedor} onChange={handleInputChange} required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="">Selecione...</option>
                                        {vendedorSelectOptions.map((v) => (
                                            <option key={v.email || v.name} value={v.name}>{v.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>




                            {formData.tipo === 'Licitante' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-amber-50/50 rounded-2xl border border-amber-100">
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1.5">Órgão Licitante</label>
                                        <input type="text" id="orgaoLicitante" value={formData.orgaoLicitante || ''} onChange={handleInputChange} placeholder="Ex: Município de..." className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1.5">Valor do Edital</label>
                                        <input type="text" id="valorLote" value={formData.valorLote || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1.5">📅 Data do Pregão</label>
                                        <input type="date" id="dataPregao" value={formData.dataPregao || ''} onChange={handleInputChange} className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20" />
                                    </div>
                                </div>
                            )}

                            {formData.tipo === 'Performance' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Número do Contrato</label>
                                        <input type="text" id="numeroContrato" value={formData.numeroContrato || ''} onChange={handleInputChange} placeholder="Ex: 001/2024" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Segurado (Beneficiário)</label>
                                        <input type="text" id="segurado" value={formData.segurado || ''} onChange={handleInputChange} placeholder="Nome do Segurado" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                    <div className="group/field relative md:col-span-2">
                                        <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Objeto do Contrato</label>
                                        <input type="text" id="objetoContrato" value={formData.objetoContrato || ''} onChange={handleInputChange} placeholder="Descrição curta do objeto" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Valor do Contrato</label>
                                        <input type="text" id="valorContrato" value={formData.valorContrato || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                </div>
                            )}

                            {formData.vendeu === 'Sim' && (
                                <div className="p-6 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-4">
                                    <label className="block text-[10px] font-black text-emerald-600 uppercase tracking-widest px-1">📎 Documentos de Fechamento</label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="flex items-center gap-3">
                                            <input type="file" id="apolice-file" accept=".pdf" onChange={(e) => setSelectedApolice(e.target.files?.[0] || null)} className="hidden" />
                                            <label htmlFor="apolice-file" className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${selectedApolice ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                                                <Shield size={16} /> {selectedApolice ? selectedApolice.name.substring(0, 15) : 'Anexar Apólice (PDF)'}
                                            </label>
                                            {selectedApolice && <button type="button" onClick={() => setSelectedApolice(null)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"><X size={16} /></button>}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <input type="file" id="boleto-file" accept=".pdf" onChange={(e) => setSelectedBoleto(e.target.files?.[0] || null)} className="hidden" />
                                            <label htmlFor="boleto-file" className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${selectedBoleto ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                                                <DollarSign size={16} /> {selectedBoleto ? selectedBoleto.name.substring(0, 15) : 'Anexar Boleto (PDF)'}
                                            </label>
                                            {selectedBoleto && <button type="button" onClick={() => setSelectedBoleto(null)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"><X size={16} /></button>}
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-emerald-600/70 font-medium italic text-center">
                                        {sendingEmail 
                                            ? "📤 Enviando e-mail com anexos... por favor aguarde." 
                                            : "Ao salvar com status 'Sim', os arquivos serão enviados automaticamente ao cliente."}
                                    </p>
                                </div>
                            )}

                            <div className="flex justify-end items-center gap-3">
                                {editingId && (
                                    <button type="button" onClick={resetForm} className="px-8 py-3.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-all flex items-center gap-2">
                                        <X size={18} /> Cancelar
                                    </button>
                                )}
                                
                                {formData.vendeu !== 'Sim' && (formData.tipo === 'Licitante' || formData.tipo === 'Performance') && (
                                    <div className="relative">
                                        <input 
                                            type="file" 
                                            id="draft-file" 
                                            accept=".pdf"
                                            className="hidden" 
                                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        />
                                        <label 
                                            htmlFor="draft-file"
                                            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl font-bold text-sm border cursor-pointer transition-all ${
                                                selectedFile 
                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' 
                                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            <FileText size={18} />
                                            {selectedFile ? selectedFile.name.substring(0, 15) + '...' : 'Anexar Minuta (PDF)'}
                                            {selectedFile && (
                                                <button 
                                                    type="button" 
                                                    onClick={(e) => { e.preventDefault(); setSelectedFile(null); }}
                                                    className="ml-1 p-0.5 hover:bg-emerald-200 rounded-full"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </label>
                                    </div>
                                )}

                                {(formData.tipo === 'Licitante' || formData.tipo === 'Performance') && (
                                    <button 
                                        type={formData.vendeu === 'Sim' ? 'submit' : 'button'}
                                        onClick={formData.vendeu === 'Sim' ? undefined : handleSendDraft}
                                        disabled={saving || !formData.email}
                                        className={`${formData.vendeu === 'Sim' ? 'bg-[#1B263B] hover:bg-[#2c3e5a]' : 'bg-slate-800 hover:bg-slate-900'} text-white px-8 py-3.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 disabled:opacity-50`}
                                    >
                                        <Mail size={18} /> 
                                        {formData.vendeu === 'Sim' ? 'Enviar Apólice' : 'Enviar Minuta'}
                                    </button>
                                )}

                                <button type="submit" disabled={saving} className="bg-[#C69C6D] text-white px-10 py-3.5 rounded-xl font-black text-sm hover:bg-[#b58a5b] transition-all shadow-lg active:scale-95 flex items-center gap-2 disabled:opacity-50">
                                    {saving ? <Loader2 className="animate-spin" size={18} /> : (editingId ? <Save size={18} /> : <Plus size={18} />)}
                                    {editingId ? 'Salvar Alterações' : 'Adicionar Venda'}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Table Card */}
                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[2px] border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-5 align-top">Data</th>
                                        <th className="px-6 py-5 align-top">
                                            <span className="block">Lead</span>
                                            <select
                                                value={salesLeadNomeFilter}
                                                onChange={(e) => setSalesLeadNomeFilter(e.target.value)}
                                                aria-label="Filtrar por cliente"
                                                className="mt-1 block w-fit max-w-[min(100%,200px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                {([...new Set(sales.map((s) => (s.nome ?? '').trim()).filter((x): x is string => Boolean(x)))] as string[]).sort((a, b) =>
                                                    a.localeCompare(b, 'pt-BR')
                                                ).map((nome) => (
                                                    <option key={nome} value={nome}>{nome}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-6 py-5 align-top">
                                            <span className="block">Origem</span>
                                            <select
                                                value={salesOrigemFilter}
                                                onChange={(e) => setSalesOrigemFilter(e.target.value)}
                                                aria-label="Filtrar por origem"
                                                className="mt-1 block w-fit max-w-[80px] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                            >
                                                <option value="">Todas</option>
                                                {LIST_DATA.origem.map((o) => (
                                                    <option key={o} value={o}>{o}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-6 py-5 align-top">
                                            <span className="block">Status</span>
                                            <select
                                                value={salesStatusFilter}
                                                onChange={(e) => setSalesStatusFilter(e.target.value)}
                                                aria-label="Filtrar por status"
                                                className="mt-1 block w-fit max-w-[80px] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                <option value="Sim">Sim</option>
                                                <option value="Não">Não</option>
                                                <option value="Em andamento">Em andamento</option>
                                            </select>
                                        </th>
                                        <th className="px-6 py-5 align-top">
                                            <span className="block">Seguro</span>
                                            <select
                                                value={salesTipoFilter}
                                                onChange={(e) => setSalesTipoFilter(e.target.value)}
                                                aria-label="Filtrar por tipo de seguro"
                                                className="mt-1 block w-fit max-w-[80px] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                {LIST_DATA.tipoSeguro.map((t) => (
                                                    <option key={t} value={t}>{t}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-6 py-5 align-top">Prêmio</th>
                                        <th className="px-6 py-5 align-top">Comissão</th>
                                        <th className="px-6 py-5 align-top">
                                            <span className="block">Vendedor</span>
                                            <select
                                                value={salesVendedorFilter}
                                                onChange={(e) => setSalesVendedorFilter(e.target.value)}
                                                aria-label="Filtrar por vendedor"
                                                className="mt-1 block w-fit max-w-[80px] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                {vendedorSelectOptions.map((v) => (
                                                    <option key={v.email || v.name} value={v.name}>{v.name}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-6 py-5 text-center align-top">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {sales
                                        .filter((s) => (salesMonthFilter ? s.data.startsWith(salesMonthFilter) : true))
                                        .filter((s) =>
                                            s.nome?.toLowerCase().includes(salesSearch.toLowerCase()) ||
                                            s.origem?.toLowerCase().includes(salesSearch.toLowerCase()) ||
                                            s.tipo?.toLowerCase().includes(salesSearch.toLowerCase()) ||
                                            s.seguradora?.toLowerCase().includes(salesSearch.toLowerCase()) ||
                                            s.vendedor?.toLowerCase().includes(salesSearch.toLowerCase())
                                        )
                                        .filter((s) => (salesStatusFilter ? s.vendeu === salesStatusFilter : true))
                                        .filter((s) => (salesTipoFilter ? s.tipo === salesTipoFilter : true))
                                        .filter((s) => (salesVendedorFilter ? s.vendedor === salesVendedorFilter : true))
                                        .filter((s) => (salesOrigemFilter ? s.origem === salesOrigemFilter : true))
                                        .filter((s) =>
                                            salesLeadNomeFilter ? (s.nome ?? '').trim() === salesLeadNomeFilter : true
                                        )
                                        .map((sale) => (
                                            <tr key={sale.id} className="group hover:bg-slate-50/80 transition-all">
                                                <td className="px-6 py-5 text-sm font-medium text-slate-500">{sale.data.split('-').reverse().join('/')}</td>
                                                <td className="px-6 py-5">
                                                    <div className="font-black text-slate-800 tracking-tight">{sale.nome}</div>
                                                    <div className="text-[10px] text-slate-400 font-bold uppercase">{sale.seguradora || 'S/ Seguradora'}</div>
                                                </td>
                                                <td className="px-6 py-5 text-sm text-slate-600 font-medium">{sale.origem}</td>
                                                <td className="px-6 py-5">
                                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${sale.vendeu === 'Sim' ? 'bg-emerald-50 text-emerald-600' :
                                                        sale.vendeu === 'Não' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                                                        }`}>
                                                        {sale.vendeu === 'Sim' ? <CheckCircle2 size={12} /> :
                                                            sale.vendeu === 'Não' ? <AlertCircle size={12} /> : <Clock size={12} />}
                                                        {sale.vendeu}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5 text-sm text-slate-700 font-bold">{sale.tipo}</td>
                                                <td className="px-6 py-5 text-sm text-slate-800 font-black">{sale.premio || '-'}</td>
                                                <td className="px-6 py-5 text-sm text-[#C69C6D] font-black">{sale.comissao || '-'}</td>
                                                <td className="px-6 py-5 text-sm text-slate-600 font-medium">{sale.vendedor}</td>
                                                <td className="px-6 py-5">
                                                    <div className="flex justify-center gap-2">
                                                        <button onClick={() => handleEdit(sale)} className="p-2 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"><Edit2 size={16} /></button>
                                                        <button onClick={() => handleDelete(sale.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}

            {activeSection === 'prospects' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">Prospecção Ativa</h2>
                            <p className="text-slate-500 font-medium">Gestão de contatos e captação de novos clientes no formato Kanban.</p>
                        </div>
                    </div>

                    <div className="mt-8">
                        <ProspectsKanban onConvertToSale={handleConvertToSale} />
                    </div>
                </section>
            )}

            {activeSection === 'carteira' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">Carteira de Clientes</h2>
                            <p className="text-slate-500 font-medium">Gestão unificada dos seus clientes e apólices emitidas.</p>
                        </div>
                        <div className="flex flex-col w-full lg:w-auto gap-3 sm:flex-row sm:items-center sm:justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setSaveError(null);
                                    setIsAddClientModalOpen(true);
                                }}
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black text-sm shadow-md shadow-[#C69C6D]/25 border border-[#b8895a]/60 hover:bg-[#b8895a] hover:border-[#a87d50] transition-all order-2 sm:order-1 whitespace-nowrap"
                            >
                                <Plus size={18} strokeWidth={2.5} className="shrink-0" aria-hidden />
                                Novo cliente
                            </button>
                            <div className="relative w-full sm:w-72 order-1 sm:order-2">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Buscar cliente..."
                                    value={salesSearch}
                                    onChange={e => setSalesSearch(e.target.value)}
                                    className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full focus:ring-2 focus:ring-[#C69C6D]/20 shadow-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {(() => {
                            // Define the ClientPortfolioItem type
                            interface ClientPortfolioItem {
                                nome: string;
                                cnpj: string;
                                telefone: string;
                                email: string;
                                decisor: string;
                                obs: string;
                                salesVendidas: Array<{ id: number; data: string; tipo: string; seguradora: string; is: string; premio: string; comissao: string }>;
                                limites: Array<{ seguradora: string, valor: string }>;
                                totalPremio: number;
                                totalIS: number;
                                totalComissao: number;
                                salesIds: number[];
                            }

                            // Group sales by client name
                            const portfolio = sales.reduce((acc, sale) => {
                                if (!sale.nome) return acc;
                                const clientName = sale.nome.trim().toUpperCase();

                                if (!acc[clientName]) {
                                    acc[clientName] = {
                                        nome: sale.nome,
                                        cnpj: sale.cnpj || '',
                                        telefone: sale.telefone || '',
                                        email: sale.email || '',
                                        decisor: sale.decisor || '',
                                        obs: '',
                                        salesVendidas: [],
                                        limites: [],
                                        totalPremio: 0,
                                        totalIS: 0,
                                        totalComissao: 0,
                                        salesIds: []
                                    };
                                }

                                acc[clientName].salesIds.push(sale.id);

                                const saleObs = (sale.obs ?? '').trim();
                                if (saleObs && !acc[clientName].obs) {
                                    acc[clientName].obs = saleObs;
                                }

                                // Update contact info if missing
                                if (!acc[clientName].cnpj && sale.cnpj) acc[clientName].cnpj = sale.cnpj;
                                if (!acc[clientName].telefone && sale.telefone) acc[clientName].telefone = sale.telefone;
                                if (!acc[clientName].email && sale.email) acc[clientName].email = sale.email;
                                if (!acc[clientName].decisor && sale.decisor) acc[clientName].decisor = sale.decisor;

                                // Parse limits
                                if (sale.limites_seguradoras) {
                                    try {
                                        const parsed = JSON.parse(sale.limites_seguradoras);
                                        if (Array.isArray(parsed)) {
                                            parsed.forEach(p => {
                                                // Avoid adding duplicates
                                                if (!acc[clientName].limites.some((l: any) => l.seguradora === p.seguradora)) {
                                                    acc[clientName].limites.push(p);
                                                }
                                            });
                                        }
                                    } catch (e) { }
                                }

                                if (sale.vendeu === 'Sim') {
                                    acc[clientName].salesVendidas.push({
                                        id: sale.id,
                                        data: sale.data,
                                        tipo: sale.tipo || '',
                                        seguradora: sale.seguradora || '',
                                        is: sale.is || '',
                                        premio: sale.premio || '',
                                        comissao: sale.comissao || '',
                                    });
                                    acc[clientName].totalPremio += parseNumber(sale.premio || '0');
                                    acc[clientName].totalIS += parseNumber(sale.is || '0');
                                    acc[clientName].totalComissao += parseNumber(sale.comissao || '0');
                                }

                                return acc;
                            }, {} as Record<string, ClientPortfolioItem>);

                            const clients = (Object.values(portfolio) as ClientPortfolioItem[])
                                .filter(c => {
                                    const term = salesSearch.toLowerCase();
                                    if (!term) return true;
                                    
                                    const termDigits = salesSearch.replace(/\D/g, '');
                                    const matchNome = c.nome.toLowerCase().includes(term);
                                    const matchDecisor = c.decisor ? c.decisor.toLowerCase().includes(term) : false;
                                    const matchCnpj = termDigits.length > 0 && c.cnpj ? c.cnpj.replace(/\D/g, '').includes(termDigits) : false;
                                    
                                    return matchNome || matchDecisor || matchCnpj;
                                })
                                .sort((a, b) => a.nome.localeCompare(b.nome));

                            if (clients.length === 0) {
                                const filteredOut = salesSearch.trim().length > 0;
                                return (
                                    <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-slate-100 shadow-sm">
                                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-300">
                                            <Users size={32} />
                                        </div>
                                        <h3 className="text-lg font-black text-slate-700">
                                            {filteredOut ? 'Nenhum cliente encontrado' : 'Sua carteira ainda está vazia'}
                                        </h3>
                                        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                                            {filteredOut
                                                ? 'Tente outro termo na busca ou limpe o campo de pesquisa.'
                                                : 'Inclua um card com o botão Novo cliente ou registre vendas concluídas na aba Vendas.'}
                                        </p>
                                    </div>
                                );
                            }

                            return clients.map((client: ClientPortfolioItem, idx: number) => (
                                <div key={idx} className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group flex flex-col h-full relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#C69C6D]/5 rounded-bl-full -z-0"></div>

                                    <div className="relative z-10 flex-1">
                                        <div className="flex items-start gap-4 mb-6">
                                            <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                                                <Briefcase size={20} className="text-[#C69C6D]" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <h3 className="font-black text-lg text-slate-800 leading-tight">{client.nome}</h3>
                                                    {/* Task Indicator */}
                                                    {(() => {
                                                        const clientTasks = tasks.filter(t => t.sale_id && client.salesIds.includes(t.sale_id));
                                                        if (clientTasks.length === 0) return null;
                                                        const hasOverdue = clientTasks.some(t => t.status === 'pending' && new Date(t.due_date) < new Date());
                                                        return (
                                                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${hasOverdue ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`} title={`${clientTasks.length} tarefa(s) pendente(s)`}>
                                                                <Clock size={10} className={hasOverdue ? 'animate-pulse' : ''} />
                                                                <span className="text-[10px] font-black">{clientTasks.length}</span>
                                                            </div>
                                                        );
                                                    })()}
                                                    <div className="flex-1"></div>
                                                    <button
                                                        onClick={() => {
                                                            setEditingClientName(client.nome);
                                                            setClientEditForm({
                                                                nome: client.nome,
                                                                cnpj: client.cnpj,
                                                                telefone: client.telefone,
                                                                email: client.email,
                                                                decisor: client.decisor,
                                                            });
                                                        }}
                                                        className="shrink-0 p-1.5 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"
                                                        title="Editar dados do cliente"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                </div>

                                                {editingClientName === client.nome ? (
                                                    <div className="mt-3 space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                                        {([
                                                            { label: 'Nome / Razão Social', key: 'nome', type: 'text' },
                                                            { label: 'CNPJ / CPF', key: 'cnpj', type: 'text' },
                                                            { label: 'Telefone', key: 'telefone', type: 'text' },
                                                            { label: 'E-mail', key: 'email', type: 'email' },
                                                            { label: 'Decisor / Responsável', key: 'decisor', type: 'text' },
                                                        ] as { label: string; key: string; type: string }[]).map(({ label, key, type }) => (
                                                            <div key={key}>
                                                                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{label}</label>
                                                                <input
                                                                    type={type}
                                                                    value={(clientEditForm as any)[key]}
                                                                    onChange={e => setClientEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                                                                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] transition-all"
                                                                />
                                                            </div>
                                                        ))}
                                                        <div className="flex gap-2 pt-1">
                                                            <button
                                                                onClick={() => setEditingClientName(null)}
                                                                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-600 py-2 rounded-lg hover:bg-slate-100 transition-all"
                                                            >
                                                                <X size={11} /> CANCELAR
                                                            </button>
                                                            <button
                                                                onClick={() => handleSaveClientInfo(client.salesIds)}
                                                                disabled={saving}
                                                                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-black text-white bg-[#C69C6D] hover:bg-[#b58a5b] py-2 rounded-lg transition-all disabled:opacity-50"
                                                            >
                                                                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                                                SALVAR
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="mt-1.5 space-y-1">
                                                        {client.decisor && (
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">RESPONSÁVEL: <span className="text-slate-700">{client.decisor}</span></p>
                                                                <CopyButton text={client.decisor} label="Decisor" />
                                                            </div>
                                                        )}
                                                        {client.cnpj && (
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-[10px] font-black text-[#C69C6D]">CNPJ: {client.cnpj}</p>
                                                                <CopyButton text={client.cnpj} label="CNPJ" />
                                                            </div>
                                                        )}
                                                        {client.telefone && (
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-xs font-medium text-slate-500 break-all flex flex-wrap items-center gap-1">
                                                                    <span aria-hidden>📞</span>
                                                                    <WhatsAppPhoneLink phone={client.telefone} className="text-slate-600" />
                                                                </p>
                                                                <CopyButton text={client.telefone} label="Telefone" />
                                                            </div>
                                                        )}
                                                        {client.email && (
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-xs font-medium text-slate-500 break-all">✉️ {client.email}</p>
                                                                <CopyButton text={client.email} label="E-mail" />
                                                            </div>
                                                        )}
                                                        {!client.telefone && !client.email && !client.cnpj && <p className="text-xs text-slate-400 italic">Sem contato ou CNPJ registrado</p>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1">Seguros Contratados</p>
                                                {client.salesVendidas.length > 0 ? (
                                                    <div className="space-y-1.5">
                                                        {client.salesVendidas.map((sv) => (
                                                            <div key={sv.id} className="flex flex-col p-2.5 bg-slate-50 border border-slate-100 rounded-xl gap-1">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-[10px] font-black text-slate-700 uppercase">{sv.tipo || 'Seguro'}</span>
                                                                    {sv.seguradora && (
                                                                        <span className="text-[9px] font-bold text-[#C69C6D] bg-[#C69C6D]/10 px-2 py-0.5 rounded-full uppercase">{sv.seguradora}</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex justify-between items-center text-[9px] font-bold">
                                                                    <div className="text-slate-500 uppercase">IS: <span className="text-slate-800">{sv.is ? formatCurrency(parseNumber(sv.is)) : '-'}</span></div>
                                                                    <div className="text-slate-500 uppercase">Prêmio: <span className="text-slate-800">{sv.premio ? formatCurrency(parseNumber(sv.premio)) : '-'}</span></div>
                                                                </div>
                                                                <div className="text-[9px] text-slate-400">{sv.data.split('-').reverse().join('/')}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-slate-400 italic">Nenhum seguro emitido ainda.</p>
                                                )}
                                            </div>

                                            <div>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1 flex justify-between items-center">
                                                    <span>Crédito Aprovado nas Seguradoras</span>
                                                    <button
                                                        onClick={() => {
                                                            setEditingClientLimits(client.nome);
                                                            setTempClientLimits(client.limites);
                                                            setNewTempLimit({ seguradora: '', valor: '' });
                                                            setNewLimitSeguradoraOutro('');
                                                        }}
                                                        className="text-[#C69C6D] hover:text-[#b58a5b] transition-colors p-1"
                                                    >
                                                        <Plus size={12} strokeWidth={3} />
                                                    </button>
                                                </p>

                                                {editingClientLimits === client.nome ? (
                                                    <div className="space-y-3 p-3 bg-slate-50 rounded-2xl border border-[#C69C6D]/20 animate-in fade-in zoom-in-95 duration-200">
                                                        <div className="space-y-2">
                                                            {tempClientLimits.map((l, i) => (
                                                                <div key={i} className="flex justify-between items-center bg-white px-2 py-1.5 rounded-lg border border-slate-100 text-[11px]">
                                                                    <span className="font-bold text-slate-700">{l.seguradora}</span>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-black text-slate-400">{formatCurrency(l.valor)}</span>
                                                                        <button
                                                                            onClick={() => setTempClientLimits(prev => prev.filter((_, idx) => idx !== i))}
                                                                            className="text-red-400 hover:text-red-600"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1 items-stretch">
                                                            <select
                                                                value={newTempLimit.seguradora}
                                                                onChange={e => {
                                                                    const v = e.target.value;
                                                                    setNewTempLimit(prev => ({ ...prev, seguradora: v }));
                                                                    if (v !== SEGURADORA_OUTRO_CORRETOR) setNewLimitSeguradoraOutro('');
                                                                }}
                                                                className="flex-1 min-w-[120px] text-[10px] p-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-[#C69C6D] bg-white"
                                                            >
                                                                <option value="">Seguradora...</option>
                                                                {insurers.map(ins => (
                                                                    <option key={ins.id} value={ins.nome}>{ins.nome}</option>
                                                                ))}
                                                                <option value={SEGURADORA_OUTRO_CORRETOR}>Outro corretor</option>
                                                            </select>
                                                            {newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR && (
                                                                <input
                                                                    type="text"
                                                                    placeholder="Nome do corretor ou seguradora"
                                                                    value={newLimitSeguradoraOutro}
                                                                    onChange={e => setNewLimitSeguradoraOutro(e.target.value)}
                                                                    className="flex-1 min-w-[140px] text-[10px] p-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-[#C69C6D] bg-slate-50"
                                                                />
                                                            )}
                                                            <input
                                                                type="text" placeholder="R$ 0,00"
                                                                value={newTempLimit.valor}
                                                                onChange={e => {
                                                                    const digits = e.target.value.replace(/\D/g, '');
                                                                    const val = digits ? formatCurrency(parseFloat(digits) / 100) : '';
                                                                    setNewTempLimit(prev => ({ ...prev, valor: val }));
                                                                }}
                                                                className="w-20 text-[10px] p-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-[#C69C6D]"
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const resolvedSeguradora =
                                                                        newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR
                                                                            ? newLimitSeguradoraOutro.trim()
                                                                            : newTempLimit.seguradora;
                                                                    if (resolvedSeguradora && newTempLimit.valor) {
                                                                        setTempClientLimits(prev => [
                                                                            ...prev,
                                                                            { ...newTempLimit, seguradora: resolvedSeguradora },
                                                                        ]);
                                                                        setNewTempLimit({ seguradora: '', valor: '' });
                                                                        setNewLimitSeguradoraOutro('');
                                                                    }
                                                                }}
                                                                className="bg-[#C69C6D] text-white p-2 rounded-lg shrink-0"
                                                            >
                                                                <Plus size={12} />
                                                            </button>
                                                        </div>
                                                        <div className="flex gap-2 pt-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingClientLimits(null);
                                                                    setNewLimitSeguradoraOutro('');
                                                                }}
                                                                className="flex-1 text-[10px] font-black text-slate-400 hover:text-slate-600 transition-colors"
                                                            >
                                                                CANCELAR
                                                            </button>
                                                            <button
                                                                onClick={() => handleUpdateClientLimits(client.nome, client.salesIds)}
                                                                disabled={saving}
                                                                className="flex-1 text-[10px] font-black text-emerald-500 hover:text-emerald-700 transition-colors flex items-center justify-center gap-1"
                                                            >
                                                                {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                                                                SALVAR
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {client.limites && client.limites.length > 0 ? (
                                                            <div className="flex flex-col gap-2 w-full">
                                                                {client.limites.map((l: any, i: number) => (
                                                                    <div key={i} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                                                                        <div className="flex items-center gap-2">
                                                                            <Shield size={12} className="text-emerald-500" />
                                                                            <span className="text-xs font-bold text-slate-700">{l.seguradora}</span>
                                                                        </div>
                                                                        <span className="text-xs font-black text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                                                            {formatCurrency(l.valor)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                                <button
                                                                    onClick={() => handleSendLimits(client)}
                                                                    disabled={!!sendingLimitsTo}
                                                                    className="mt-2 w-full py-3 bg-[#1B263B] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#2c3e50] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                                                >
                                                                    {sendingLimitsTo === client.nome ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                                                    Enviar p/ Cliente
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <CarteiraEmptyLimitsForm
                                                                salesIds={client.salesIds}
                                                                insurers={insurers}
                                                                saving={saving}
                                                                onSave={(limits) => persistClientLimitsToSales(client.salesIds, limits)}
                                                            />
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        </div>
                                        {/* Task Manager for Clients */}
                                        <div className="mt-6 pt-6 border-t border-slate-100">
                                            <TaskManager saleIds={client.salesIds} onTaskChange={fetchTasks} />
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-slate-100">
                                            <div className="flex items-center gap-1.5 mb-1.5">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                    Observações
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingClientObs(client.nome);
                                                        setTempClientObs(client.obs || '');
                                                    }}
                                                    className="p-1 text-slate-400 hover:text-[#C69C6D] hover:bg-[#C69C6D]/10 rounded-lg transition-all"
                                                    title="Editar observações"
                                                    aria-label="Editar observações"
                                                >
                                                    <Edit2 size={12} />
                                                </button>
                                            </div>
                                            {editingClientObs === client.nome ? (
                                                <div className="space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                                    <textarea
                                                        value={tempClientObs}
                                                        onChange={e => setTempClientObs(e.target.value)}
                                                        rows={3}
                                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 outline-none focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] resize-y min-h-[72px]"
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingClientObs(null)}
                                                            className="flex-1 flex items-center justify-center gap-1 text-[10px] font-black text-slate-500 hover:text-slate-700 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-all"
                                                        >
                                                            <X size={11} /> Cancelar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSaveClientObs(client.salesIds)}
                                                            disabled={saving}
                                                            className="flex-1 flex items-center justify-center gap-1 text-[10px] font-black text-white bg-[#1B263B] hover:bg-[#243347] py-2 rounded-lg transition-all disabled:opacity-50"
                                                        >
                                                            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                                            Salvar
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p
                                                    className={`text-xs text-slate-500 leading-relaxed ${!client.obs?.trim() ? 'italic' : ''}`}
                                                >
                                                    {client.obs?.trim() ? client.obs : 'Sem observações.'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                            ));
                        })()}
                    </div>
                </section>
            )}

            {activeSection === 'pendencias' && <PendenciasHub />}

            {activeSection === 'goals' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-center flex-wrap gap-4">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">Metas do Mês</h2>
                            <p className="text-slate-500 font-medium">Acompanhe a performance proporcional por vendedor.</p>
                        </div>
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                            <Calendar size={18} className="text-[#C69C6D]" />
                            <input type="month" value={goalsMonthSelector} onChange={(e) => setGoalsMonthSelector(e.target.value)} className="bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 outline-none" />
                        </div>
                    </div>

                    <div className="bg-[#1B263B] rounded-2xl p-6 md:p-8 border border-white/10 text-white shadow-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[#C69C6D]/20 flex items-center justify-center">
                                    <Users size={20} className="text-[#C69C6D]" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black uppercase tracking-widest text-[#C69C6D]">Gestão de Vendedores</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cadastro e participação nas metas</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                disabled={sellerCrudBusy}
                                onClick={() => {
                                    setSellerMgmtError(null);
                                    setShowNewSellerForm((v) => !v);
                                    setEditingSellerId(null);
                                }}
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black text-sm uppercase tracking-wider border border-[#b8895a] hover:bg-[#b8895a] transition-all disabled:opacity-50"
                            >
                                <Plus size={18} strokeWidth={2.5} /> Novo Vendedor
                            </button>
                        </div>

                        {sellerMgmtError && (
                            <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/15 border border-red-400/40 text-red-200 text-sm font-bold">
                                {sellerMgmtError}
                            </div>
                        )}

                        {showNewSellerForm && (
                            <div className="mb-6 p-5 rounded-2xl border border-white/10 bg-white/5 space-y-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Novo vendedor</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input
                                        placeholder="Nome"
                                        value={newSellerDraft.name}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, name: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-[#C69C6D]/40"
                                    />
                                    <input
                                        placeholder="Email"
                                        type="email"
                                        value={newSellerDraft.email}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, email: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-[#C69C6D]/40"
                                    />
                                    <input
                                        placeholder="Share (%)"
                                        value={newSellerDraft.sharePercent}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, sharePercent: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-[#C69C6D]/40"
                                    />
                                    <input
                                        placeholder="Dias por semana"
                                        value={newSellerDraft.daysPerWeek}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, daysPerWeek: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-[#C69C6D]/40"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={sellerCrudBusy}
                                        onClick={() => void handleInsertSeller()}
                                        className="px-5 py-2.5 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black text-xs uppercase tracking-widest disabled:opacity-50"
                                    >
                                        Salvar
                                    </button>
                                    <button
                                        type="button"
                                        disabled={sellerCrudBusy}
                                        onClick={() => {
                                            setShowNewSellerForm(false);
                                            setNewSellerDraft({ name: '', email: '', sharePercent: '', daysPerWeek: '5' });
                                        }}
                                        className="px-5 py-2.5 rounded-xl border border-white/20 font-black text-xs uppercase tracking-widest text-slate-300 hover:bg-white/5"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {sellers.map((seller) => (
                                <div
                                    key={seller.id}
                                    className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-4 rounded-2xl border border-white/10 bg-white/[0.03]"
                                >
                                    {editingSellerId === seller.id ? (
                                        <div className="flex flex-wrap gap-3 flex-1 items-end">
                                            <input
                                                value={sellerEditDraft.name}
                                                onChange={(e) => setSellerEditDraft((p) => ({ ...p, name: e.target.value }))}
                                                className="min-w-[140px] flex-1 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-sm font-bold"
                                            />
                                            <input
                                                value={sellerEditDraft.email}
                                                onChange={(e) => setSellerEditDraft((p) => ({ ...p, email: e.target.value }))}
                                                className="min-w-[160px] flex-1 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-sm font-bold"
                                            />
                                            <input
                                                value={sellerEditDraft.sharePercent}
                                                onChange={(e) => setSellerEditDraft((p) => ({ ...p, sharePercent: e.target.value }))}
                                                className="w-28 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-sm font-black"
                                                placeholder="%"
                                            />
                                            <input
                                                value={sellerEditDraft.daysPerWeek}
                                                onChange={(e) => setSellerEditDraft((p) => ({ ...p, daysPerWeek: e.target.value }))}
                                                className="w-24 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-sm font-black"
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => void handleUpdateSeller(seller.id)}
                                                    className="px-4 py-2 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black text-xs uppercase"
                                                >
                                                    Salvar
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => setEditingSellerId(null)}
                                                    className="px-4 py-2 rounded-xl border border-white/20 text-xs font-black uppercase"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-black text-white text-lg truncate">{seller.name}</p>
                                                <p className="text-xs text-slate-400 font-bold truncate">{seller.email || '—'}</p>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-[#C69C6D] mt-2">
                                                    {Number(seller.share) * 100}% share · {seller.days_per_week} dias/semana
                                                    {!seller.active && <span className="ml-2 text-slate-500">(inativo)</span>}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => {
                                                        setSellerMgmtError(null);
                                                        setShowNewSellerForm(false);
                                                        setEditingSellerId(seller.id);
                                                        setSellerEditDraft({
                                                            name: seller.name,
                                                            email: seller.email || '',
                                                            sharePercent: String(Number(seller.share) * 100),
                                                            daysPerWeek: String(seller.days_per_week)
                                                        });
                                                    }}
                                                    className="px-4 py-2 rounded-xl border border-[#C69C6D]/50 text-[#C69C6D] font-black text-xs uppercase tracking-wider hover:bg-[#C69C6D]/10"
                                                >
                                                    Editar
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => void handleDeleteSeller(seller.id, seller.name)}
                                                    className="px-4 py-2 rounded-xl border border-red-400/40 text-red-300 font-black text-xs uppercase tracking-wider hover:bg-red-500/10"
                                                >
                                                    Excluir
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                            {sellers.length === 0 && !loading && (
                                <p className="text-sm font-bold text-slate-400 text-center py-6">Nenhum vendedor cadastrado. Adicione pelo botão acima.</p>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {sellers
                            .filter((s) => s.active)
                            .map((seller) => {
                                const [yearStr, monthStr] = goalsMonthSelector.split('-');
                                const year = parseInt(yearStr, 10);
                                const monthNum = parseInt(monthStr, 10);
                                const sellerTarget = getSellerMonthlyTarget(seller, year, monthNum);

                                const sellerSales = sales.filter(
                                    (s) => s.vendedor === seller.name && s.vendeu === 'Sim' && s.data.startsWith(goalsMonthSelector)
                                );
                                const totalAchieved = sellerSales.reduce((sum, s) => sum + parseNumber(s.comissao || '0'), 0);
                                const percent = sellerTarget > 0 ? Math.min((totalAchieved / sellerTarget) * 100, 100) : 0;

                                return (
                                    <div key={seller.id} className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden shadow-2xl border border-white/5">
                                        <div className="relative z-10 flex flex-col h-full">
                                            <div className="flex justify-between items-start mb-12">
                                                <div>
                                                    <h3 className="text-4xl font-black tracking-tighter text-[#C69C6D]">{seller.name}</h3>
                                                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mt-1">
                                                        {Number(seller.share) * 100}% da meta empresa (fallback proporcional)
                                                    </p>
                                                </div>
                                                <div className="bg-[#C69C6D]/20 p-4 rounded-3xl">
                                                    <Target size={32} className="text-[#C69C6D]" />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-8 mb-12">
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Meta Mensal</p>
                                                    {editingGoalTargetSellerId === seller.id ? (
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={goalTargetDraft}
                                                            onChange={(e) => setGoalTargetDraft(e.target.value)}
                                                            onBlur={() => {
                                                                void commitMonthlyTargetForSeller(seller.id, goalTargetDraft);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                                            }}
                                                            disabled={goalTargetSaving}
                                                            autoFocus
                                                            className="mt-1 w-full max-w-[11rem] bg-white/10 border border-[#C69C6D]/40 rounded-xl px-3 py-2 text-xl font-black text-white outline-none focus:ring-2 focus:ring-[#C69C6D]/30"
                                                        />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSellerMgmtError(null);
                                                                setEditingGoalTargetSellerId(seller.id);
                                                                setGoalTargetDraft(
                                                                    String(getSellerMonthlyTarget(seller, year, monthNum))
                                                                );
                                                            }}
                                                            className="text-left text-2xl font-black hover:text-[#C69C6D] transition-colors"
                                                        >
                                                            {formatCurrency(sellerTarget)}
                                                        </button>
                                                    )}
                                                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter pt-1">Clique para editar</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Meta Semanal</p>
                                                    <p className="text-2xl font-black text-slate-300">{formatCurrency(sellerTarget / 4)}</p>
                                                </div>
                                            </div>

                                            <div className="mt-auto pt-10 border-t border-white/5">
                                                <div className="flex justify-between items-end mb-4">
                                                    <div>
                                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Comissão Realizada</p>
                                                        <p className="text-5xl font-black text-[#C69C6D] tracking-tighter">{formatCurrency(totalAchieved)}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-3xl font-black text-white">{percent.toFixed(1)}%</p>
                                                    </div>
                                                </div>

                                                <div className="h-4 bg-white/5 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-[#C69C6D] to-white rounded-full transition-all duration-1000"
                                                        style={{ width: `${percent}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="absolute top-0 right-0 w-64 h-64 bg-[#C69C6D] opacity-[0.03] rounded-full blur-[80px] -mr-32 -mt-32"></div>
                                    </div>
                                );
                            })}
                    </div>
                    {sellers.filter((s) => s.active).length === 0 && !loading && (
                        <p className="text-center text-slate-500 font-bold text-sm">Nenhum vendedor ativo para exibir metas.</p>
                    )}
                </section>
            )}

            {activeSection === 'annualGoals' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div>
                        <h2 className="text-3xl font-black text-slate-800">Visão Anual {new Date().getFullYear()}</h2>
                        <p className="text-slate-500 font-medium">Histórico consolidado de performance por mês.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {Object.keys(MONTH_LABELS).sort().map((key) => {
                            const monthLabel = MONTH_LABELS[key];
                            const currentYear = new Date().getFullYear();
                            const monthNum = parseInt(key, 10);
                            const metaTotal = getCompanyMonthlyTargetTotal(currentYear, monthNum);
                            const monthSales = sales.filter(s => s.vendeu === 'Sim' && s.data.startsWith(`${currentYear}-${key}`));
                            const achieved = monthSales.reduce((sum, s) => sum + parseNumber(s.comissao || '0'), 0);
                            const percent = metaTotal > 0 ? Math.min((achieved / metaTotal) * 100, 100) : 0;
                            const isCurrent = key === String(new Date().getMonth() + 1).padStart(2, '0');

                            return (
                                <div key={key} className={`p-8 rounded-[2rem] border transition-all duration-500 hover:scale-105 ${isCurrent ? 'bg-[#1B263B] text-white border-[#C69C6D] shadow-2xl scale-105 z-10' : 'bg-white text-slate-800 border-slate-100 shadow-sm'
                                    }`}>
                                    <div className="flex justify-between items-start mb-6">
                                        <h3 className="text-2xl font-black tracking-tight">{monthLabel}</h3>
                                        <div className={`w-3 h-3 rounded-full ${isCurrent ? 'bg-[#C69C6D] animate-pulse' : 'bg-slate-200'}`}></div>
                                    </div>

                                    <div className="space-y-4 mb-8">
                                        <div>
                                            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isCurrent ? 'text-slate-400' : 'text-slate-400'}`}>Meta</p>
                                            <p className="text-lg font-bold">{formatCurrency(metaTotal)}</p>
                                        </div>
                                        <div>
                                            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isCurrent ? 'text-[#C69C6D]' : 'text-slate-400'}`}>Atingido</p>
                                            <p className={`text-2xl font-black ${isCurrent ? 'text-[#C69C6D]' : 'text-slate-800'}`}>{formatCurrency(achieved)}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between text-[11px] font-black uppercase tracking-wider">
                                            <span className={isCurrent ? 'text-slate-400' : 'text-slate-400'}>Progresso</span>
                                            <span className={isCurrent ? 'text-white' : 'text-slate-800'}>{percent.toFixed(0)}%</span>
                                        </div>
                                        <div className={`h-2 rounded-full overflow-hidden ${isCurrent ? 'bg-white/5' : 'bg-slate-50'}`}>
                                            <div
                                                className={`h-full transition-all duration-1000 ${isCurrent ? 'bg-[#C69C6D]' : 'bg-slate-200'}`}
                                                style={{ width: `${percent}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {activeSection === 'leads' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">Rastreamento de Leads</h2>
                            <p className="text-slate-500 font-medium">Métricas de investimento e eficiência de conversão.</p>
                        </div>
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                            <Calendar size={18} className="text-[#C69C6D]" />
                            <input type="month" value={leadsMonthSelector} onChange={(e) => setLeadsMonthSelector(e.target.value)} className="bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 outline-none" />
                        </div>
                    </div>

                    <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[2px] border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-5">Item de Controle</th>
                                        <th className="px-4 py-5">Semana 1</th>
                                        <th className="px-4 py-5">Semana 2</th>
                                        <th className="px-4 py-5">Semana 3</th>
                                        <th className="px-4 py-5">Semana 4</th>
                                        <th className="px-6 py-5 bg-slate-100/50">Total Mês</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 text-sm">
                                    {(() => {
                                        const weeks = [
                                            { start: 1, end: 7 },
                                            { start: 8, end: 14 },
                                            { start: 15, end: 21 },
                                            { start: 22, end: 31 }
                                        ];
                                        const monthlySales = sales.filter(s => s.data.startsWith(leadsMonthSelector));

                                        const getWeekData = (weekIdx: number) => {
                                            const w = weeks[weekIdx];
                                            const wSales = monthlySales.filter(s => {
                                                const day = parseInt(s.data.split('-')[2]);
                                                return day >= w.start && day <= w.end;
                                            });
                                            const cost = leadCosts.find(c => c.key === `${leadsMonthSelector}_w${weekIdx + 1}`)?.value || 0;
                                            const revenue = wSales.filter(s => s.vendeu === 'Sim').reduce((sum, s) => sum + parseNumber(s.comissao || '0'), 0);
                                            return {
                                                leads: wSales.length,
                                                qual: wSales.filter(s => s.qualificado === 'Sim').length,
                                                sales: wSales.filter(s => s.vendeu === 'Sim').length,
                                                cost,
                                                revenue
                                            };
                                        };

                                        const wD = [getWeekData(0), getWeekData(1), getWeekData(2), getWeekData(3)];
                                        const total = {
                                            leads: wD.reduce((s, x) => s + x.leads, 0),
                                            qual: wD.reduce((s, x) => s + x.qual, 0),
                                            sales: wD.reduce((s, x) => s + x.sales, 0),
                                            cost: wD.reduce((s, x) => s + x.cost, 0),
                                            revenue: wD.reduce((s, x) => s + x.revenue, 0)
                                        };

                                        const rows = [
                                            { label: 'Leads Recebidos', data: wD.map(x => x.leads), total: total.leads },
                                            { label: 'Leads Qualificados', data: wD.map(x => x.qual), total: total.qual },
                                            { label: 'Vendas Fechadas', data: wD.map(x => x.sales), total: total.sales },
                                            { label: 'Receita (Comissão)', data: wD.map(x => x.revenue), total: total.revenue, isCurrency: true },
                                            { label: 'Custo Tráfego (R$)', data: wD.map(x => x.cost), total: total.cost, isManual: true },
                                            { label: 'CPL (Custo/Lead)', data: wD.map(x => x.leads > 0 ? x.cost / x.leads : 0), total: total.leads > 0 ? total.cost / total.leads : 0, isCurrency: true, isKPI: true },
                                            { label: 'CPV (Custo/Venda)', data: wD.map(x => x.sales > 0 ? x.cost / x.sales : 0), total: total.sales > 0 ? total.cost / total.sales : 0, isCurrency: true, isKPI: true },
                                            { label: 'Taxa Conversão', data: wD.map(x => x.leads > 0 ? (x.sales / x.leads) * 100 : 0), total: total.leads > 0 ? (total.sales / total.leads) * 100 : 0, isPercent: true, isKPI: true }
                                        ];

                                        return rows.map((row) => (
                                            <tr key={row.label} className={row.isKPI ? 'bg-slate-50/30' : ''}>
                                                <td className={`px-6 py-4 font-bold ${row.isKPI ? 'text-[#C69C6D]' : 'text-slate-700'}`}>{row.label}</td>
                                                {row.data.map((val, i) => (
                                                    <td key={i} className="px-4 py-4">
                                                        {row.isManual ? (
                                                            <input
                                                                type="number"
                                                                value={val}
                                                                onChange={(e) => updateManualCost(`${leadsMonthSelector}_w${i + 1}`, parseFloat(e.target.value) || 0)}
                                                                className="w-24 bg-slate-50 border-slate-200 rounded-lg px-2 py-1 outline-none text-xs focus:ring-1 focus:ring-[#C69C6D]"
                                                            />
                                                        ) : (
                                                            <span className="font-medium text-slate-600">
                                                                {row.isCurrency ? formatCurrency(val) : (row.isPercent ? `${val.toFixed(1)}%` : val)}
                                                            </span>
                                                        )}
                                                    </td>
                                                ))}
                                                <td className="px-6 py-4 bg-slate-100/30 font-black text-slate-800">
                                                    {row.isCurrency ? formatCurrency(row.total) : (row.isPercent ? `${row.total.toFixed(1)}%` : row.total)}
                                                </td>
                                            </tr>
                                        ));
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Distribution Graph Simulation */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                            <h4 className="text-lg font-black text-slate-800 mb-6">Distribuição por Origem</h4>
                            <div className="space-y-6">
                                {(() => {
                                    const monthlySales = sales.filter(s => s.data.startsWith(leadsMonthSelector));
                                    const total = monthlySales.length;
                                    const counts = LIST_DATA.origem.map(o => ({
                                        name: o,
                                        count: monthlySales.filter(s => s.origem === o).length
                                    })).sort((a, b) => b.count - a.count);

                                    return counts.map((item) => {
                                        const p = total > 0 ? (item.count / total) * 100 : 0;
                                        return (
                                            <div key={item.name} className="space-y-2">
                                                <div className="flex justify-between text-xs font-bold">
                                                    <span className="text-slate-700">{item.name}</span>
                                                    <span className="text-slate-400">{item.count} leads ({p.toFixed(1)}%)</span>
                                                </div>
                                                <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                                                    <div className="h-full bg-[#1B263B] rounded-full" style={{ width: `${p}%` }} />
                                                </div>
                                            </div>
                                        )
                                    });
                                })()}
                            </div>
                        </div>

                        <div className="bg-[#1B263B] p-8 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
                            <h4 className="text-lg font-black text-[#C69C6D] mb-6">Eficiência de Vendas</h4>
                            <div className="flex items-center justify-center p-8">
                                {(() => {
                                    const monthlySales = sales.filter(s => s.data.startsWith(leadsMonthSelector));
                                    const total = monthlySales.length;
                                    const sold = monthlySales.filter(s => s.vendeu === 'Sim').length;
                                    const p = total > 0 ? (sold / total) * 100 : 0;
                                    return (
                                        <div className="relative w-48 h-48">
                                            <svg className="w-full h-full transform -rotate-90">
                                                <circle cx="96" cy="96" r="80" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-white/5" />
                                                <circle cx="96" cy="96" r="80" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={2 * Math.PI * 80} strokeDashoffset={2 * Math.PI * 80 * (1 - p / 100)} className="text-[#C69C6D] transition-all duration-1000" />
                                            </svg>
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <span className="text-4xl font-black">{p.toFixed(0)}%</span>
                                                <span className="text-[10px] font-black uppercase text-slate-400">Conversão</span>
                                            </div>
                                        </div>
                                    )
                                })()}
                            </div>
                            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-[#C69C6D]/10 rounded-full blur-3xl"></div>
                        </div>
                    </div>
                </section>
            )}
        </div>
        {isAddClientModalOpen &&
            createPortal(
                <div className="fixed inset-0 z-[99990] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm border-0 cursor-default"
                        aria-label="Fechar"
                        disabled={addingManualClient}
                        onClick={() => !addingManualClient && closeAddClientModal()}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="add-client-modal-title"
                        className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#C69C6D]/25 animate-in zoom-in-95 duration-200"
                    >
                        <div className="flex items-start justify-between gap-3 p-6 border-b border-[#C69C6D]/20 bg-[#1B263B] text-white rounded-t-[2rem]">
                            <div>
                                <h3 id="add-client-modal-title" className="text-lg font-black tracking-tight flex items-center gap-2">
                                    <Briefcase size={22} className="text-[#C69C6D] shrink-0" aria-hidden />
                                    Novo cliente na carteira
                                </h3>
                                <p className="text-xs text-white/70 font-medium mt-1">
                                    O cliente aparece na grade; você pode registrar seguros e limites depois.
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={addingManualClient}
                                onClick={() => closeAddClientModal()}
                                className="shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors disabled:opacity-50"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveManualClient} className="p-6 space-y-4">
                            {saveError && (
                                <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800 font-medium">
                                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                                    {saveError}
                                </div>
                            )}
                            {[
                                { label: 'Nome / Razão social', key: 'nome' as const, type: 'text', required: true, placeholder: 'Obrigatório' },
                                { label: 'CNPJ / CPF', key: 'cnpj' as const, type: 'text', required: false, placeholder: 'Opcional' },
                                { label: 'Telefone', key: 'telefone' as const, type: 'text', required: false, placeholder: 'Opcional' },
                                { label: 'E-mail', key: 'email' as const, type: 'email', required: false, placeholder: 'Opcional' },
                                { label: 'Decisor / Responsável', key: 'decisor' as const, type: 'text', required: false, placeholder: 'Opcional' },
                            ].map((field) => (
                                <div key={field.key}>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                                        {field.label}
                                        {field.required ? ' *' : ''}
                                    </label>
                                    <input
                                        type={field.type}
                                        required={field.required}
                                        autoComplete="off"
                                        placeholder={field.placeholder}
                                        value={newManualClientForm[field.key]}
                                        onChange={(e) =>
                                            setNewManualClientForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                                        }
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/30 focus:border-[#C69C6D] transition-all"
                                    />
                                </div>
                            ))}
                            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
                                <button
                                    type="button"
                                    disabled={addingManualClient}
                                    onClick={() => closeAddClientModal()}
                                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={addingManualClient}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black text-sm hover:bg-[#b8895a] transition-colors disabled:opacity-50 shadow-md"
                                >
                                    {addingManualClient ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    Salvar cliente
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};

export default ResultsDashboard;
