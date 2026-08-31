import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from './Toast.tsx';
import { createPortal } from 'react-dom';
import ClienteDocumentos, { documentosDoCliente, type DocumentoCliente } from './ClienteDocumentos.tsx';
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
import LicitanteAnalyzer from './LicitanteAnalyzer';
import ContratoAnalyzer from './ContratoAnalyzer';
import { generateThankYouEmail } from '../utils/emailTemplates';
import { useAutoSave } from '../hooks/useAutoSave.ts';
import SaveIndicator from './SaveIndicator.tsx';

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

/** Diferença em dias entre duas datas ISO (yyyy-mm-dd); null se alguma faltar ou for inválida. */
function diffDias(inicio?: string, fim?: string): number | null {
    if (!inicio || !fim) return null;
    const dias = Math.round((+new Date(fim) - +new Date(inicio)) / 86400000);
    return Number.isFinite(dias) ? dias : null;
}

/** Valor do `<select>` quando o usuário informa corretor/seguradora manualmente. */
const SEGURADORA_OUTRO_CORRETOR = '__outro_corretor__';

/** Caixa baixa e sem acento: "CONSTRUÇÃO" e "construcao" viram a mesma coisa. */
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Dá para transformar `a` em `b` com no máximo um erro (uma letra trocada,
 *  faltando ou sobrando)? É o que separa "cont" de "cons" — quem digita rápido
 *  erra uma letra e não quer ver a busca voltar vazia. */
function pertoDe(a: string, b: string): boolean {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, erros = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++erros > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else { i++; j++; }
    }
    return erros + (a.length - i) + (b.length - j) <= 1;
}

/** Uma palavra digitada bate com o texto?
 *  Vale como pedaço ("cons" dentro de "construtora") e também como começo de
 *  qualquer palavra com um erro de digitação ("cont" → "cons|trutora"). */
function bateTermo(texto: string, termo: string): boolean {
    const t = semAcento(texto);
    if (t.includes(termo)) return true;
    if (termo.length < 4) return false;
    return t.split(/[^a-z0-9]+/).some(p => p.length >= termo.length && pertoDe(termo, p.slice(0, termo.length)));
}

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
    const [localError, setLocalError] = useState<string | null>(null);

    const resolvedSeguradora = (lim: InsurerLimit, outro: string) =>
        lim.seguradora === SEGURADORA_OUTRO_CORRETOR ? outro.trim() : lim.seguradora;

    const appendPendingRow = (list: InsurerLimit[]) => {
        const r = resolvedSeguradora(newTemp, outroNome);
        if (r && (newTemp.valor || '').trim()) {
            return [...list, { seguradora: r, valor: (newTemp.valor || '').trim() }];
        }
        return list;
    };

    const handleSalvar = async () => {
        setLocalError(null);
        if (!salesIds.length) {
            setLocalError('Este cliente não tem vendas vinculadas; não é possível salvar limites.');
            return;
        }
        const finalLimits = appendPendingRow([...tempLimits]);
        if (finalLimits.length === 0) {
            setLocalError(
                'Informe seguradora (lista) ou Outro corretor + nome, e o valor em R$, depois Salvar.',
            );
            return;
        }
        try {
            await onSave(finalLimits);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Erro ao salvar limites.';
            setLocalError(msg);
        }
    };

    return (
        <div className="space-y-3 p-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            {localError && (
                <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-800 font-medium">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    {localError}
                </div>
            )}
            <p className="text-[10px] font-bold text-slate-500 leading-snug">
                Nenhum limite cadastrado. Escolha a seguradora na lista ou use o botão <span className="text-gold font-bold">Outro corretor</span> ao lado do valor, informe o nome e o valor em R$, depois salve.
            </p>
            <div className="space-y-2">
                {tempLimits.map((l, i) => (
                    <div key={i} className="flex justify-between items-center bg-white px-2 py-1.5 rounded-xl border border-slate-100 text-[11px]">
                        <span className="font-bold text-slate-700">{l.seguradora}</span>
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-400">{formatCurrency(l.valor)}</span>
                            <button
                                type="button"
                                onClick={() => setTempLimits(prev => prev.filter((_, idx) => idx !== i))}
                                className="text-rose-400 hover:text-rose-600"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-1.5 items-stretch">
                <select
                    value={newTemp.seguradora === SEGURADORA_OUTRO_CORRETOR ? '' : newTemp.seguradora}
                    onChange={e => {
                        const v = e.target.value;
                        setNewTemp(prev => ({ ...prev, seguradora: v }));
                        setOutroNome('');
                    }}
                    className="flex-1 min-w-[100px] text-[10px] p-2 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-gold bg-white"
                >
                    <option value="">Seguradora...</option>
                    {insurers.map(ins => (
                        <option key={ins.id} value={ins.nome}>{ins.nome}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => {
                        setNewTemp(prev => ({ ...prev, seguradora: SEGURADORA_OUTRO_CORRETOR }));
                    }}
                    className={`shrink-0 px-2.5 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-tight transition-all ${
                        newTemp.seguradora === SEGURADORA_OUTRO_CORRETOR
                            ? 'border-navy bg-navy text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-gold/50 hover:text-gold'
                    }`}
                >
                    Outro corretor
                </button>
                {newTemp.seguradora === SEGURADORA_OUTRO_CORRETOR && (
                    <input
                        type="text"
                        placeholder="Nome do corretor ou seguradora"
                        value={outroNome}
                        onChange={e => setOutroNome(e.target.value)}
                        className="flex-1 min-w-[120px] text-[10px] p-2 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-gold bg-slate-50"
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
                    className="w-20 text-[10px] p-2 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-gold bg-white"
                />
                <button
                    type="button"
                    onClick={() => {
                        setLocalError(null);
                        const r = resolvedSeguradora(newTemp, outroNome);
                        if (!r) {
                            setLocalError('Escolha uma seguradora ou Outro corretor e preencha o nome.');
                            return;
                        }
                        if (!newTemp.valor?.trim()) {
                            setLocalError('Informe o valor do limite em R$.');
                            return;
                        }
                        setTempLimits(prev => [...prev, { seguradora: r, valor: newTemp.valor.trim() }]);
                        setNewTemp({ seguradora: '', valor: '' });
                        setOutroNome('');
                    }}
                    className="bg-gold text-white p-2 rounded-xl shrink-0"
                >
                    <Plus size={12} />
                </button>
            </div>
            <button
                type="button"
                onClick={() => void handleSalvar()}
                disabled={saving || appendPendingRow([...tempLimits]).length === 0}
                className="w-full flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 py-2.5 rounded-xl border border-emerald-200 bg-white hover:bg-emerald-50/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
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
            className="group/copy flex items-center gap-1.5 hover:text-gold transition-colors focus:outline-none"
            title={`Copiar ${label || ''}`}
        >
            {copied ? (
                <Check size={10} className="text-emerald-500 animate-in zoom-in duration-200" />
            ) : (
                <Copy size={10} className="text-slate-300 group-hover/copy:text-gold transition-all" />
            )}
            {copied && <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tighter animate-in fade-in slide-in-from-left-1 duration-200">Copiado</span>}
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

type Section = 'sales' | 'prospects' | 'pendencias' | 'goals' | 'annualGoals' | 'carteira' | 'pnpc' | 'licitante' | 'contrato';

const ResultsDashboard: React.FC<{ initialSection?: Section; hideTabs?: boolean; onVerVendas?: () => void; initialSaleData?: { nome: string; telefone: string }; initialEditSaleId?: number; initialClienteFiltro?: string }> = ({ initialSection = 'sales', hideTabs = false, onVerVendas, initialSaleData, initialEditSaleId, initialClienteFiltro }) => {
    // Modo embutido (modal "Abrir cadastro completo" da aba Pós-venda):
    // a seção de vendas mostra só o formulário, sem banner, filtros e listagem.
    const somenteFormulario = !!initialEditSaleId;
    // Modo embutido (modal "ficha do cliente" da aba Pós-venda): a carteira abre
    // já filtrada num cliente (CNPJ ou nome), sem o cabeçalho de busca.
    const somenteFicha = !!initialClienteFiltro;
    const { toast, confirm: confirmDialog } = useToast();
    const [activeSection, setActiveSection] = useState<Section>(initialSection);
    const saleFormRef = useRef<HTMLDivElement>(null);
    const [sales, setSales] = useState<Sale[]>([]);
    const [leadCosts, setLeadCosts] = useState<LeadCost[]>([]);
    const [insurers, setInsurers] = useState<any[]>([]);
    const [sellers, setSellers] = useState<Seller[]>([]);
    const [monthlyTargets, setMonthlyTargets] = useState<MonthlyTarget[]>([]);
    const [parceiros, setParceiros] = useState<{ id: number; name: string }[]>([]);
    const [partnerThankYou, setPartnerThankYou] = useState<{ name: string; email: string; clientName: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    /**
     * Valor de `vendeu` que o registro tinha no banco quando foi aberto para edição.
     * Serve para disparar os e-mails só na TRANSIÇÃO para "Sim" — sem isso, toda
     * vez que a venda fechada era editada (anexar boleto, corrigir um campo) o
     * cliente e o parceiro recebiam o e-mail de novo.
     * `null` = entrada nova, ainda não existe no banco.
     */
    const vendeuOriginalRef = React.useRef<string | null>(null);

    /**
     * Qual botão disparou o submit.
     *
     * Os dois botões do rodapé ("Enviar Apólice" e "Adicionar Venda") usam o
     * mesmo `handleSaleSubmit`, então sem esta marca eles teriam exatamente o
     * mesmo comportamento — era por isso que "Adicionar Venda" também mandava
     * e-mail para o cliente.
     *
     * "Enviar Apólice" liga a marca no onClick, antes do submit; "Adicionar
     * Venda" desliga. O handler lê e zera no início, para que um submit por
     * Enter no formulário nunca herde a marca do clique anterior.
     */
    const enviarAoClienteRef = React.useRef(false);
    const [tasks, setTasks] = useState<CRMTask[]>([]);

    // Pre-fill form when arriving from WhatsApp
    useEffect(() => {
        if (initialSaleData) {
            setFormData(prev => ({ ...prev, nome: initialSaleData.nome, telefone: initialSaleData.telefone }));
            setActiveSection('sales');
            setTimeout(() => saleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
    // Confirma na tela que a apólice/boleto saíram para o cliente. Existia uma
    // chamada a `setEmailSuccess` sem estado correspondente: todo envio bem-
    // sucedido estourava ReferenceError e caía no catch, logando "Failed".
    const [emailSuccess, setEmailSuccess] = useState(false);
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
    const [nameSuggestions, setNameSuggestions] = useState<{ nome: string; cnpj: string; telefone: string; email: string; decisor: string }[]>([]);
    const [showNameSuggestions, setShowNameSuggestions] = useState(false);
    const nameSearchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const [limitesArray, setLimitesArray] = useState<InsurerLimit[]>([]);
    const [currentLimit, setCurrentLimit] = useState<InsurerLimit>({ seguradora: '', valor: '' });

    // Client Portfolio Specific States
    // Documentos de todos os clientes, buscados de uma vez só. Se cada card
    // fizesse a própria consulta, abrir a Carteira dispararia uma requisição por
    // cliente na tela.
    const [docsClientes, setDocsClientes] = useState<DocumentoCliente[]>([]);
    const carregarDocsClientes = useCallback(async () => {
        const { data } = await supabase.from('cliente_documentos').select('*');
        setDocsClientes((data as DocumentoCliente[]) ?? []);
    }, []);
    useEffect(() => { carregarDocsClientes(); }, [carregarDocsClientes]);

    const [editingClientLimits, setEditingClientLimits] = useState<string | null>(null);
    const [tempClientLimits, setTempClientLimits] = useState<InsurerLimit[]>([]);
    const [newTempLimit, setNewTempLimit] = useState<InsurerLimit>({ seguradora: '', valor: '' });
    const [newLimitSeguradoraOutro, setNewLimitSeguradoraOutro] = useState('');
    const [editingClientObs, setEditingClientObs] = useState<string | null>(null);
    const [tempClientObs, setTempClientObs] = useState('');
    const [editingClientName, setEditingClientName] = useState<string | null>(null);
    const [clientEditForm, setClientEditForm] = useState({ nome: '', cnpj: '', telefone: '', email: '', decisor: '' });
    const [sendingLimitsTo, setSendingLimitsTo] = useState<string | null>(null);
    /** Cliente aguardando confirmação de exclusão (nome exibido) e o que será apagado junto. */
    const [clienteParaExcluir, setClienteParaExcluir] = useState<{ nome: string; salesIds: number[]; vendas: number } | null>(null);
    const [excluindoCliente, setExcluindoCliente] = useState(false);
    const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
    const [newManualClientForm, setNewManualClientForm] = useState({ nome: '', cnpj: '', telefone: '', email: '', decisor: '' });
    const [addingManualClient, setAddingManualClient] = useState(false);

    // Filters
    const [salesMonthFilter, setSalesMonthFilter] = useState('');
    const [salesSearch, setSalesSearch] = useState(initialClienteFiltro ?? '');
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
    // Quantidade de parcelas do formulário de venda.
    //
    // Fica fora de `formData` de propósito: o payload enviado ao Supabase é uma
    // lista fechada de colunas que existem na tabela `sales`, e parcela não é
    // uma delas — mora em `boletos`. Uma chave desconhecida quebraria o insert.
    const [qtdParcelas, setQtdParcelas] = useState('1');
    const [uploadingApoliceId, setUploadingApoliceId] = useState<number | null>(null);
    const [boletoModalSaleId, setBoletoModalSaleId] = useState<number | null>(null);
    const [boletoModalNome, setBoletoModalNome] = useState('');
    const [boletoModalEmail, setBoletoModalEmail] = useState('');
    const [boletoModalContato, setBoletoModalContato] = useState('');
    const [sendingBoletoEmail, setSendingBoletoEmail] = useState<number | null>(null);
    const [boletoEmailSent, setBoletoEmailSent] = useState<Set<number>>(new Set());
    const [boletos, setBoletos] = useState<{ id: number; parcela: number; vencimento: string | null; url: string; pago: boolean; valor: number | null }[]>([]);
    const [boletosSummary, setBoletosSummary] = useState<Record<number, { total: number; emAberto: number }>>({});
    const [boletoForm, setBoletoForm] = useState<{ parcela: string; vencimento: string; valor: string; file: File | null }>({ parcela: '', vencimento: '', valor: '', file: null });
    const [uploadingBoleto, setUploadingBoleto] = useState(false);
    // ── Importação de carnê ───────────────────────────────────────────────
    // Um carnê é um único PDF com todas as parcelas (normalmente dois boletos
    // por página). Em vez de cadastrar seis vezes na mão, lemos o PDF, o
    // usuário confere/corrige a lista e cadastra tudo de uma vez.
    const [carneFile, setCarneFile] = useState<File | null>(null);
    const [salvandoCarne, setSalvandoCarne] = useState(false);
    const [carneParcelas, setCarneParcelas] = useState<{ parcela: string; vencimento: string; valor: string }[]>([]);
    const [carneQtd, setCarneQtd] = useState('');
    const [carnePrimeiroVenc, setCarnePrimeiroVenc] = useState('');
    const [carneValor, setCarneValor] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);

    const [showEmailDispatcher, setShowEmailDispatcher] = useState(false);
    const [emailTemplate, setEmailTemplate] = useState('');
    const [emailDispatchStatus, setEmailDispatchStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
    const [activeKanbanProduct, setActiveKanbanProduct] = useState('Seguro Garantia');

    const WEBHOOK_URLS: Record<string, string> = {
        'Seguro Garantia':          'https://webhook.jvstomaz.com/webhook/ddbd9ccc-e675-4600-b137-1bf9ed14055a',
        'Judicial Depósito Recursal': 'https://webhook.jvstomaz.com/webhook/6ed9e1e5-6067-4851-a830-200c561e5495',
        'Energia':                  'https://webhook.jvstomaz.com/webhook/9c27347a-e4b2-4687-88d7-52334f155d83',
        'Seguro de crédito':        'https://webhook.jvstomaz.com/webhook/dce23040-9499-4344-88d0-432dd633cdfc',
    };

    const handleDispatchEmails = async () => {
        if (!emailTemplate.trim()) { toast('Por favor, insira o código HTML do email antes de enviar.', 'warning'); return; }
        setEmailDispatchStatus('sending');
        const url = WEBHOOK_URLS[activeKanbanProduct] || WEBHOOK_URLS['Seguro Garantia'];
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ template_html: emailTemplate, assunto_base: `${activeKanbanProduct} - [NOME_EMPRESA]` }),
            });
            setEmailDispatchStatus(res.ok ? 'success' : 'error');
        } catch {
            setEmailDispatchStatus('error');
        }
    };

    const [showNewSellerForm, setShowNewSellerForm] = useState(false);
    const [newSellerDraft, setNewSellerDraft] = useState({ name: '', email: '', sharePercent: '', daysPerWeek: '5' });
    const [editingSellerId, setEditingSellerId] = useState<string | null>(null);
    const [sellerEditDraft, setSellerEditDraft] = useState({ name: '', email: '', sharePercent: '', daysPerWeek: '' });
    const [sellerCrudBusy, setSellerCrudBusy] = useState(false);
    const [sellerMgmtError, setSellerMgmtError] = useState<string | null>(null);
    const [editingGoalTargetSellerId, setEditingGoalTargetSellerId] = useState<string | null>(null);
    const [goalTargetDraft, setGoalTargetDraft] = useState('');
    const [goalTargetSaving, setGoalTargetSaving] = useState(false);

    // PDF Import State
    const [importingPdf, setImportingPdf] = useState(false);
    const [importedFields, setImportedFields] = useState<string[]>([]);

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
        comissaoPerc: '',
        vendedor: '',
        indicacao: 'Não',
        limites: 'Não',
        catalogo: 'Não',
        vigencia_inicio: '',
        vigencia_fim: '',
        vigencia_contrato_inicio: '',
        vigencia_contrato_fim: '',
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
                { data: mtData },
                { data: boletosAllData },
                { data: parceirosData }
            ] = await Promise.all([
                supabase.from('sales').select('*').order('created_at', { ascending: false }),
                supabase.from('lead_costs').select('*'),
                supabase.from('insurers').select('*').order('nome'),
                supabase.from('sellers').select('*').order('name'),
                supabase.from('monthly_targets').select('*'),
                supabase.from('boletos').select('sale_id, pago'),
                supabase.from('partners').select('id, name').neq('partner_type', 'imobiliaria').order('name')
            ]);
            setSales((salesData || []).map((row) => normalizeSaleFromDb(row as Record<string, unknown>)));
            setLeadCosts(costsData || []);
            setInsurers(insurersData || []);
            setSellers((sellersData || []).map((row) => normalizeSellerRow(row as Record<string, unknown>)));
            setMonthlyTargets((mtData || []).map((row) => normalizeMonthlyTargetRow(row as Record<string, unknown>)));
            setParceiros((parceirosData || []) as { id: number; name: string }[]);
            const summary: Record<number, { total: number; emAberto: number }> = {};
            (boletosAllData || []).forEach((b: { sale_id: number; pago: boolean }) => {
                if (!summary[b.sale_id]) summary[b.sale_id] = { total: 0, emAberto: 0 };
                summary[b.sale_id].total++;
                if (!b.pago) summary[b.sale_id].emAberto++;
            });
            setBoletosSummary(summary);
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
        if (!(await confirmDialog(`Excluir o vendedor "${name}"? As metas mensais associadas serão removidas.`))) return;
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

        // C1: Auto-fill vigencia_fim = vigencia_inicio + 1 ano (último dia antes do aniversário)
        if (id === 'vigencia_inicio' && value) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) {
                d.setFullYear(d.getFullYear() + 1);
                d.setDate(d.getDate() - 1);
                setFormData(prev => ({ ...prev, vigencia_inicio: value, vigencia_fim: d.toISOString().slice(0, 10) }));
                return;
            }
        }

        // C2: Auto-fill comissao = 20% do prêmio (padrão seguro garantia)
        if (id === 'premio' && value) {
            const digits = value.replace(/\D/g, '');
            const num = digits ? parseFloat(digits) / 100 : 0;
            if (num > 0) {
                const comissao = (num * 0.20).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const premioFormatted = formatCurrency(num);
                setFormData(prev => ({ ...prev, premio: premioFormatted, comissao }));
                return;
            }
        }

        if (id === 'comissaoPerc') {
            const perc = parseFloat(value.replace(',', '.'));
            const premioRaw = parseFloat(formData.premio.replace(/[R$\s.]/g, '').replace(',', '.'));
            setFormData(prev => ({
                ...prev,
                comissaoPerc: value,
                comissao: (!isNaN(perc) && !isNaN(premioRaw) && premioRaw > 0)
                    ? formatCurrency(premioRaw * perc / 100)
                    : prev.comissao
            }));
            return;
        }
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

    const maskTelefone = (value: string): string => {
        const digits = value.replace(/\D/g, '').substring(0, 11);
        if (digits.length <= 10) {
            return digits
                .replace(/^(\d{2})(\d)/, '($1) $2')
                .replace(/(\d{4})(\d)/, '$1-$2');
        }
        return digits
            .replace(/^(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{5})(\d)/, '$1-$2');
    };

    const handleImportPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportingPdf(true);
        setImportedFields([]);
        try {
            // Convert to base64 via FileReader (mais robusto)
            const b64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    // result = "data:application/pdf;base64,XXXX" — pegar só o XXXX
                    resolve(result.split(',')[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Call Edge Function via fetch direto (mais confiável para payloads grandes)
            const fnUrl = 'https://hfjvwibucplyhsvnwfor.supabase.co/functions/v1/parse-documento-seguro';
            const fnRes = await fetch(fnUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdf_base64: b64 }),
            });
            if (!fnRes.ok) {
                const errText = await fnRes.text();
                throw new Error(`HTTP ${fnRes.status}: ${errText}`);
            }
            const data = await fnRes.json();

            // Convert dd/mm/aaaa → yyyy-mm-dd
            const toISO = (s: string) => {
                if (!s) return '';
                const [d, m, y] = s.split('/');
                if (!d || !m || !y) return '';
                return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            };

            // Map fields
            const filled: string[] = [];
            const updates: Partial<typeof formData> = {};

            if (data.nome) { updates.nome = data.nome; filled.push('nome'); }
            if (data.cnpj) { updates.cnpj = data.cnpj; filled.push('cnpj'); }
            if (data.orgao_licitante) { updates.orgaoLicitante = data.orgao_licitante; filled.push('orgao_licitante'); }
            if (data.seguradora) { updates.seguradora = data.seguradora; filled.push('seguradora'); }
            if (data.premio) { updates.premio = data.premio; filled.push('premio'); }
            if (data.valor_garantia) { updates.is = data.valor_garantia; filled.push('is'); }
            const vi = toISO(data.vigencia_inicio);
            const vf = toISO(data.vigencia_fim);
            if (vi) { updates.vigencia_inicio = vi; updates.vendeu = updates.vendeu || formData.vendeu || 'Em andamento'; filled.push('vigencia_inicio'); }
            if (vf) { updates.vigencia_fim = vf; filled.push('vigencia_fim'); }

            setFormData(prev => ({ ...prev, ...updates }));
            setImportedFields(filled);
        } catch (err) {
            console.error('Import PDF error:', err);
            toast(`Erro ao importar o PDF: ${String(err)}`, 'error');
        } finally {
            setImportingPdf(false);
            e.target.value = '';
        }
    };

    const handleNomeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAutoFilledFields(prev => { const s = new Set(prev); s.delete('nome'); return s; });
        handleInputChange(e);
        if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
        if (value.length < 2) { setNameSuggestions([]); setShowNameSuggestions(false); return; }
        nameSearchTimer.current = setTimeout(async () => {
            const { data } = await supabase
                .from('sales')
                .select('nome, cnpj, telefone, email, decisor')
                .ilike('nome', `%${value}%`)
                .not('nome', 'is', null)
                .order('nome')
                .limit(6);
            const unique = Array.from(new Map((data || []).map(r => [r.cnpj || r.nome, r])).values());
            setNameSuggestions(unique as { nome: string; cnpj: string; telefone: string; email: string; decisor: string }[]);
            setShowNameSuggestions(unique.length > 0);
        }, 300);
    };

    const handleNameSuggestionSelect = (s: { nome: string; cnpj: string; telefone: string; email: string; decisor: string }) => {
        const filled = new Set<string>();
        setFormData(prev => {
            const updated = { ...prev };
            if (s.nome) { updated.nome = s.nome; filled.add('nome'); }
            if (s.cnpj) { updated.cnpj = s.cnpj; filled.add('cnpj'); }
            if (s.telefone) { updated.telefone = s.telefone; filled.add('telefone'); }
            if (s.email) { updated.email = s.email; filled.add('email'); }
            if (s.decisor) { updated.decisor = s.decisor; filled.add('decisor'); }
            return updated;
        });
        setAutoFilledFields(filled);
        setShowNameSuggestions(false);
        setNameSuggestions([]);
        setCnpjLookupStatus('found');
    };

    const handleSaleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Lê e zera de imediato: se o próximo submit vier de outro botão (ou de
        // um Enter no formulário), ele começa sem enviar nada.
        const enviarAoCliente = enviarAoClienteRef.current;
        enviarAoClienteRef.current = false;

        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);
        setEmailSuccess(false);

        // Validação: dataPregao obrigatório quando tipo = 'Licitante'
        if (formData.tipo === 'Licitante' && !formData.dataPregao) {
            setSaveError('Para vendas do tipo Licitante, é obrigatório informar a data do pregão. Esse campo é necessário para o envio automático dos lembretes ao cliente e ao vendedor.');
            setSaving(false);
            document.getElementById('dataPregao')?.focus();
            return;
        }

        // Validação: vencimento_boleto obrigatório quando vendeu = 'Sim'
        if (formData.vendeu === 'Sim' && !(formData as any).vencimento_boleto) {
            setSaveError('Para registrar uma venda como emitida, é necessário informar a data de vencimento do boleto. Esse campo é obrigatório para o envio automático dos lembretes de pagamento.');
            setSaving(false);
            document.getElementById('vencimento_boleto')?.focus();
            return;
        }

        // Validação: fim da vigência da apólice não pode ser anterior ao início
        if (formData.vigencia_inicio && formData.vigencia_fim && formData.vigencia_fim < formData.vigencia_inicio) {
            setSaveError('O fim da vigência da apólice é anterior ao início. Corrija as datas antes de salvar.');
            setSaving(false);
            document.getElementById('vigencia_fim')?.focus();
            return;
        }

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
            // Prazo do contrato garantido — informativo, não gera lembrete
            vigencia_contrato_inicio: formData.vigencia_contrato_inicio || null,
            vigencia_contrato_fim: formData.vigencia_contrato_fim || null,
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
            parceiro: (formData as any).parceiro || null,
            vencimento_boleto: (formData as any).vencimento_boleto || null,
            pagamento_status: (formData as any).pagamento_status || 'Em dia',
        };

        try {
            let savedId = editingId;
            if (editingId) {
                const { error } = await supabase.from('sales').update(payload).eq('id', editingId);
                if (error) throw error;
            } else {
                const { data: inserted, error } = await supabase.from('sales').insert([payload]).select('id').single();
                if (error) throw error;
                savedId = inserted?.id ?? null;
            }

            // Upload apólice PDF to Storage if provided
            if (selectedApolice && savedId && payload.vendeu === 'Sim') {
                const ext = selectedApolice.name.split('.').pop() || 'pdf';
                const path = `${savedId}/apolice.${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from('apolices')
                    .upload(path, selectedApolice, { upsert: true, contentType: 'application/pdf' });
                if (!uploadError) {
                    const { data: urlData } = supabase.storage.from('apolices').getPublicUrl(path);
                    await supabase.from('sales').update({ apolice_url: urlData.publicUrl }).eq('id', savedId);
                }
            }

            // Upload boleto PDF to Storage if provided
            if (selectedBoleto && savedId && payload.vendeu === 'Sim') {
                const ext = selectedBoleto.name.split('.').pop() || 'pdf';
                const path = `${savedId}/boletos/parcela-1.${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from('apolices')
                    .upload(path, selectedBoleto, { upsert: true, contentType: 'application/pdf' });
                if (!uploadError) {
                    const { data: urlData } = supabase.storage.from('apolices').getPublicUrl(path);
                    const boletoUrl = urlData.publicUrl;
                    // Salva em sales.boleto_url (retrocompatibilidade)
                    await supabase.from('sales').update({ boleto_url: boletoUrl }).eq('id', savedId);
                    // Registra na tabela boletos (aparece no portal do parceiro)
                    // Upsert para evitar duplicata se o usuário re-salvar
                    // O vencimento vai junto: sem ele a linha em `boletos` é só
                    // um anexo, e a cobrança automática não tem data para
                    // disparar naquela parcela.
                    const { data: existing } = await supabase.from('boletos')
                        .select('id').eq('sale_id', savedId).eq('parcela', 1).single();
                    if (existing) {
                        await supabase.from('boletos')
                            .update({ url: boletoUrl, vencimento: payload.vencimento_boleto || null })
                            .eq('id', existing.id);
                    } else {
                        await supabase.from('boletos').insert({
                            sale_id: savedId,
                            parcela: 1,
                            url: boletoUrl,
                            pago: false,
                            vencimento: payload.vencimento_boleto || null,
                        });
                    }
                }
            }

            // Parcelamento: cria as parcelas em `boletos` já no registro da venda.
            //
            // Fica FORA do bloco do PDF acima de propósito — as parcelas existem
            // para o lembrete disparar na data certa, e isso independe de ter
            // carnê anexado. O PDF, quando vem, é da parcela 1 e o bloco acima
            // já cuidou dela.
            //
            // Só insere o que falta: reeditar uma venda não pode duplicar nem
            // sobrescrever parcela que ele já ajustou à mão no modal de Boletos.
            const qtd = parseInt(qtdParcelas) || 1;
            if (savedId && payload.vendeu === 'Sim' && qtd > 1 && payload.vencimento_boleto) {
                const datas   = gerarVencimentosMensais(payload.vencimento_boleto, qtd);
                const premio  = parseValorParcela(payload.premio || '');
                const valores = premio ? dividirEmParcelas(premio, qtd) : null;

                const { data: jaExistem } = await supabase.from('boletos')
                    .select('parcela').eq('sale_id', savedId);
                const cadastradas = new Set((jaExistem ?? []).map(b => b.parcela));

                const novas = datas
                    .map((venc, i) => ({
                        sale_id: savedId,
                        parcela: i + 1,
                        vencimento: venc,
                        valor: valores ? valores[i] : null,
                        pago: false,
                    }))
                    .filter(p => !cadastradas.has(p.parcela));

                if (novas.length) await supabase.from('boletos').insert(novas);
            }

            await fetchData();
            setSaveSuccess(true);

            // O aviso ao parceiro sai só quando a venda ACABA de virar "Sim" —
            // nunca em reedições de uma venda que já estava fechada (anexar
            // boleto, corrigir um campo). Entrada nova tem `vendeuOriginalRef`
            // = null, então conta como transição.
            const virouVenda = payload.vendeu === 'Sim' && vendeuOriginalRef.current !== 'Sim';

            // Se venda fechada com parceiro → dispara email de agradecimento automaticamente
            if (virouVenda && payload.parceiro) {
                const { data: pData } = await supabase
                    .from('partners')
                    .select('name, email')
                    .eq('name', payload.parceiro)
                    .single();
                if (pData?.email) {
                    setPartnerThankYou({ name: pData.name, email: pData.email, clientName: payload.nome || '' });
                    // P6: Notifica o parceiro que a apólice foi emitida
                    supabase.functions.invoke('parceiro-status-changed', {
                        body: {
                            saleId: savedId,
                            oldVendeu: 'Não',
                            newVendeu: 'Sim',
                            parceiro: payload.parceiro,
                        },
                    }).catch((e: any) => console.warn('P6 status email:', e));
                    // Disparo automático de agradecimento
                    supabase.functions.invoke('parceiro-referral-thanks', {
                        body: {
                            partnerName: pData.name,
                            partnerEmail: pData.email,
                            clientName: payload.nome || '',
                            productType: payload.tipo || (payload as any).product_type || 'Seguro Garantia',
                        },
                    }).catch((e: any) => console.warn('Parceiro referral email:', e));
                }
            }

            // E-mail com a apólice e o boleto: sai APENAS quando o clique veio
            // do botão "Enviar Apólice". "Adicionar Venda" registra e não manda
            // nada ao cliente. Aqui não checamos a transição de `vendeu`: se o
            // usuário clicou em "Enviar Apólice", ele quer enviar — inclusive
            // reenviar numa venda já fechada (ex.: boleto que faltava).
            if (enviarAoCliente && payload.vendeu === 'Sim' && payload.email) {
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
        descartarRascunho();
        setEditingId(null);
        vendeuOriginalRef.current = null;
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
            comissaoPerc: '',
            vendedor: '',
            indicacao: 'Não',
            limites: 'Não',
            catalogo: 'Não',
            vigencia_inicio: '',
            vigencia_fim: '',
            vigencia_contrato_inicio: '',
            vigencia_contrato_fim: '',
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
        setQtdParcelas('1');
    };

    /**
     * Conteúdo vigiado pelo salvamento automático. Os limites por seguradora
     * entram junto porque também fazem parte do que é gravado.
     */
    const dadosAutoSave = useMemo(
        () => ({ ...formData, _limitesArray: limitesArray }),
        [formData, limitesArray],
    );

    const gravarVendaEmEdicao = React.useCallback(async (dados: typeof dadosAutoSave) => {
        if (!editingId) return;
        // Mesma validação do botão de salvar: com o fim anterior ao início a gravação
        // fica retida (o hook marca erro e tenta de novo; grava quando corrigir).
        if (dados.vigencia_inicio && dados.vigencia_fim && dados.vigencia_fim < dados.vigencia_inicio) {
            throw new Error('Vigência da apólice com fim anterior ao início — salvamento retido até a correção.');
        }
        const limites = dados._limitesArray || [];
        const payload = {
            data: dados.data || null, nome: dados.nome || null, origem: dados.origem || null,
            tipo: dados.tipo || null, is: dados.is || null, seguradora: dados.seguradora || null,
            premio: dados.premio || null, vendeu: dados.vendeu || null, comissao: dados.comissao || null,
            vendedor: dados.vendedor || null, indicacao: dados.indicacao || null, limites: dados.limites || null,
            catalogo: dados.catalogo || null, vigencia_inicio: dados.vigencia_inicio || null,
            vigencia_fim: dados.vigencia_fim || null, telefone: dados.telefone || null,
            vigencia_contrato_inicio: dados.vigencia_contrato_inicio || null,
            vigencia_contrato_fim: dados.vigencia_contrato_fim || null,
            email: dados.email || null, cnpj: dados.cnpj || null, decisor: dados.decisor || null,
            product_type: dados.product_type || 'Seguro Garantia', process_number: dados.process_number || null,
            court: dados.court || null, valorLote: dados.valorLote || null, orgaoLicitante: dados.orgaoLicitante || null,
            dataPregao: dados.dataPregao || null, numeroContrato: dados.numeroContrato || null,
            objetoContrato: dados.objetoContrato || null, segurado: dados.segurado || null,
            valorContrato: dados.valorContrato || null,
            limites_seguradoras: limites.length > 0 ? JSON.stringify(limites) : null,
            parceiro: (dados as any).parceiro || null,
            vencimento_boleto: (dados as any).vencimento_boleto || null,
            pagamento_status: (dados as any).pagamento_status || 'Em dia',
        };
        const { error } = await supabase.from('sales').update(payload).eq('id', editingId);
        if (error) throw error;
    }, [editingId]);

    const {
        estado: autoSaveState,
        salvarAgora: salvarVendaAgora,
        sincronizar: sincronizarAutoSave,
        rascunho: rascunhoVenda,
        descartarRascunho,
    } = useAutoSave({
        dados: dadosAutoSave,
        ativo: !!editingId,
        identidade: editingId,
        salvar: gravarVendaEmEdicao,
        chaveRascunho: 'venda-garantia',
        ignorar: ['id', 'created_at'],
    });

    // Recupera uma única vez o rascunho de cadastro novo deixado na sessão anterior.
    const rascunhoRestauradoRef = React.useRef(false);
    const [rascunhoRestaurado, setRascunhoRestaurado] = useState(false);
    useEffect(() => {
        if (rascunhoRestauradoRef.current || editingId || !rascunhoVenda) return;
        // Só repõe se o formulário ainda estiver em branco, para nunca sobrescrever
        // algo que o usuário já começou a digitar agora.
        if (formData.nome || formData.cnpj || formData.premio) return;
        rascunhoRestauradoRef.current = true;
        const { _limitesArray, ...campos } = rascunhoVenda as any;
        setFormData(prev => ({ ...prev, ...campos }));
        if (Array.isArray(_limitesArray)) setLimitesArray(_limitesArray);
        setRascunhoRestaurado(true);
    }, [rascunhoVenda, editingId, formData.nome, formData.cnpj, formData.premio]);

    const handleEdit = (sale: Sale) => {
        setRascunhoRestaurado(false);
        setEditingId(sale.id);
        // Guarda o `vendeu` que veio do banco, antes de qualquer alteração no formulário.
        vendeuOriginalRef.current = sale.vendeu ?? null;
        setFormData(sale);
        // Reabre mostrando o parcelamento que a venda já tem. Sem isso o campo
        // voltaria em "à vista" e um simples reeditar pareceria uma mudança.
        setQtdParcelas(String(boletosSummary[sale.id]?.total || 1));
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

    // Abre uma venda específica para edição assim que a lista chega do banco
    // (ex.: "Abrir cadastro completo" na aba Pós-venda). Aplica uma única vez.
    const editInicialAplicadoRef = React.useRef(false);
    useEffect(() => {
        if (!initialEditSaleId || editInicialAplicadoRef.current) return;
        const alvo = sales.find(s => s.id === initialEditSaleId);
        if (!alvo) return;
        editInicialAplicadoRef.current = true;
        handleEdit(alvo);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialEditSaleId, sales]);

    const handleDelete = async (id: number) => {
        if (!(await confirmDialog('Deseja realmente excluir este registro? Esta ação não pode ser desfeita.'))) return;
        try {
            await supabase.from('sales').delete().eq('id', id);
            await fetchData();
        } catch (error) {
            console.error('Error deleting sale:', error);
        }
    };

    const handleSendBoletoEmail = async (b: { id: number; parcela: number; vencimento: string | null; url: string }) => {
        if (!boletoModalEmail) {
            alert('Este cliente não tem e-mail cadastrado. Adicione o e-mail no registro de venda.');
            return;
        }
        setSendingBoletoEmail(b.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const supabaseUrl = (supabase as any).supabaseUrl as string;
            const supabaseKey = (supabase as any).supabaseKey as string;
            const res = await fetch(`${supabaseUrl}/functions/v1/send-boleto-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
                body: JSON.stringify({ toEmail: boletoModalEmail, toName: boletoModalNome, toContato: boletoModalContato, parcela: b.parcela, vencimento: b.vencimento, boletoUrl: b.url }),
            });
            if (!res.ok) throw new Error();
            setBoletoEmailSent(prev => new Set([...prev, b.id]));
        } catch {
            alert('Erro ao enviar e-mail. Verifique a conexão e tente novamente.');
        } finally {
            setSendingBoletoEmail(null);
        }
    };

    const openBoletoModal = async (saleId: number, nome: string, email = '', contato = '') => {
        setBoletoModalSaleId(saleId);
        setBoletoModalNome(nome);
        setBoletoModalEmail(email);
        setBoletoModalContato(contato);
        setBoletoEmailSent(new Set());
        setBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
        // Zera o gerador de parcelas: abrir outra venda não pode herdar a lista
        // montada para a venda anterior.
        setCarneFile(null);
        setCarneParcelas([]);
        setCarneQtd('');
        setCarnePrimeiroVenc('');
        setCarneValor('');
        const { data } = await supabase
            .from('boletos')
            .select('id, parcela, vencimento, url, pago, valor')
            .eq('sale_id', saleId)
            .order('parcela');
        setBoletos(data || []);
    };

    /** Aceita "2.083,53", "2083,53" ou "2083.53" e devolve o número, ou null se vier vazio. */
    const parseValorParcela = (v: string): number | null => {
        const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
        const n = parseFloat(limpo);
        return Number.isFinite(n) && n > 0 ? n : null;
    };

    /**
     * Datas das parcelas a partir do primeiro vencimento: mesmo dia, meses
     * seguintes. Carnê de seguro garantia é mensal, então a primeira data já
     * determina todas as outras.
     *
     * O dia é limitado ao último do mês de destino: 31/01 + 1 mês vira 28/02,
     * nunca 03/03 (que é o que `setMonth` faria).
     */
    const gerarVencimentosMensais = (primeiro: string, qtd: number): string[] => {
        const [y, m, d] = primeiro.split('-').map(Number);
        return Array.from({ length: qtd }, (_, i) => {
            const alvoMes   = m - 1 + i;
            const ano       = y + Math.floor(alvoMes / 12);
            const mes       = ((alvoMes % 12) + 12) % 12;
            const ultimoDia = new Date(ano, mes + 1, 0).getDate();
            const dia       = Math.min(d, ultimoDia);
            return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        });
    };

    /**
     * Divide um valor em N parcelas sem perder centavo.
     *
     * A divisão simples deixa sobra (12.501,20 ÷ 6 = 2.083,5333...). Aqui cada
     * parcela fica com o valor arredondado para baixo e a sobra vai toda para
     * a primeira — que é como as seguradoras montam o carnê. A soma volta a
     * bater exatamente com o prêmio.
     */
    const dividirEmParcelas = (total: number, qtd: number): number[] => {
        const centavos = Math.round(total * 100);
        const base     = Math.floor(centavos / qtd);
        const sobra    = centavos - base * qtd;
        return Array.from({ length: qtd }, (_, i) => (i === 0 ? base + sobra : base) / 100);
    };

    const handleAddBoleto = async () => {
        if (!boletoModalSaleId || !boletoForm.file || !boletoForm.parcela) return;
        setUploadingBoleto(true);
        try {
            const ext = boletoForm.file.name.split('.').pop() || 'pdf';
            const path = `${boletoModalSaleId}/boletos/parcela-${boletoForm.parcela}.${ext}`;

            const { error: uploadError } = await supabase.storage
                .from('apolices')
                .upload(path, boletoForm.file, { upsert: true, contentType: 'application/pdf' });
            if (uploadError) throw new Error(`Upload: ${uploadError.message}`);

            const { data: urlData } = supabase.storage.from('apolices').getPublicUrl(path);
            if (!urlData?.publicUrl) throw new Error('Não foi possível obter a URL pública.');

            const { error: insertError } = await supabase.from('boletos').insert({
                sale_id: boletoModalSaleId,
                parcela: parseInt(boletoForm.parcela),
                vencimento: boletoForm.vencimento || null,
                valor: parseValorParcela(boletoForm.valor),
                url: urlData.publicUrl,
            });
            if (insertError) throw new Error(`Insert: ${insertError.message}`);

            const { data, error: selectError } = await supabase
                .from('boletos')
                .select('id, parcela, vencimento, url, pago, valor')
                .eq('sale_id', boletoModalSaleId)
                .order('parcela');
            if (selectError) throw new Error(`Select: ${selectError.message}`);

            setBoletos(data || []);
            setBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
        } catch (err: any) {
            console.error('Erro ao enviar boleto:', err);
            toast(`Erro ao enviar boleto: ${err?.message || 'Tente novamente.'}`, 'error');
        } finally {
            setUploadingBoleto(false);
        }
    };

    /**
     * Monta a lista de parcelas a partir de três dados: quantidade, primeiro
     * vencimento e valor.
     *
     * Não lê o PDF nem usa IA — de propósito. Carnê de seguro garantia é
     * mensal: sabendo a primeira data, as outras são o mesmo dia nos meses
     * seguintes. Ler o PDF com IA custaria uma chamada paga por importação
     * para adivinhar o que estas três informações já dizem.
     *
     * A lista sai editável na tela porque o banco antecipa ou empurra o
     * vencimento que cai em fim de semana ou feriado (20/07, 21/09, 23/11...),
     * e é a data certa que faz o lembrete disparar no dia certo.
     */
    const handleGerarParcelas = () => {
        const qtd = parseInt(carneQtd);
        if (!qtd || qtd < 1 || qtd > 60) {
            toast('Informe a quantidade de parcelas (1 a 60).', 'error');
            return;
        }
        if (!carnePrimeiroVenc) {
            toast('Informe o vencimento da primeira parcela.', 'error');
            return;
        }

        const lista = gerarVencimentosMensais(carnePrimeiroVenc, qtd).map((venc, i) => ({
            parcela: String(i + 1),
            vencimento: venc,
            valor: carneValor.trim(),
        }));
        setCarneParcelas(lista);
    };

    /**
     * Cadastra de uma vez todas as parcelas conferidas.
     *
     * O PDF do carnê é opcional. Quando enviado, sobe UMA vez e todas as
     * parcelas apontam para ele — o cliente recebe o carnê inteiro e localiza
     * a parcela pela data. Separar o PDF em seis arquivos exigiria um editor
     * de PDF no navegador, e o ganho seria pequeno perto do risco de cortar a
     * página errada.
     */
    const handleSalvarCarne = async () => {
        if (!boletoModalSaleId || !carneParcelas.length) return;
        const novas = carneParcelas.filter(p => !boletos.some(b => b.parcela === parseInt(p.parcela)));
        if (!novas.length) {
            toast('Todas essas parcelas já estão cadastradas.', 'error');
            return;
        }
        setSalvandoCarne(true);
        try {
            let carneUrl: string | null = null;
            if (carneFile) {
                const ext = carneFile.name.split('.').pop() || 'pdf';
                const path = `${boletoModalSaleId}/boletos/carne.${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from('apolices')
                    .upload(path, carneFile, { upsert: true, contentType: 'application/pdf' });
                if (uploadError) throw new Error(`Upload: ${uploadError.message}`);

                const { data: urlData } = supabase.storage.from('apolices').getPublicUrl(path);
                if (!urlData?.publicUrl) throw new Error('Não foi possível obter a URL pública.');
                carneUrl = urlData.publicUrl;
            }

            const { error: insertError } = await supabase.from('boletos').insert(
                novas.map(p => ({
                    sale_id: boletoModalSaleId,
                    parcela: parseInt(p.parcela),
                    vencimento: p.vencimento || null,
                    valor: parseValorParcela(p.valor),
                    url: carneUrl,
                }))
            );
            if (insertError) throw new Error(`Insert: ${insertError.message}`);

            const { data } = await supabase
                .from('boletos')
                .select('id, parcela, vencimento, url, pago, valor')
                .eq('sale_id', boletoModalSaleId)
                .order('parcela');
            setBoletos(data || []);
            setBoletosSummary(prev => ({
                ...prev,
                [boletoModalSaleId]: {
                    total: (data || []).length,
                    emAberto: (data || []).filter(b => !b.pago).length,
                },
            }));
            setCarneParcelas([]);
            setCarneFile(null);
            setCarneQtd('');
            setCarnePrimeiroVenc('');
            setCarneValor('');
            toast(`${novas.length} parcela(s) cadastrada(s).`, 'success');
        } catch (err: any) {
            console.error('Erro ao cadastrar carnê:', err);
            toast(`Erro ao cadastrar as parcelas: ${err?.message || 'Tente novamente.'}`, 'error');
        } finally {
            setSalvandoCarne(false);
        }
    };

    const handleTogglePago = async (boletoId: number, currentPago: boolean) => {
        await supabase.from('boletos').update({ pago: !currentPago }).eq('id', boletoId);
        setBoletos(prev => prev.map(b => b.id === boletoId ? { ...b, pago: !currentPago } : b));
        if (boletoModalSaleId !== null) {
            setBoletosSummary(prev => {
                const cur = prev[boletoModalSaleId] || { total: 0, emAberto: 0 };
                return {
                    ...prev,
                    [boletoModalSaleId]: {
                        total: cur.total,
                        emAberto: currentPago ? cur.emAberto + 1 : Math.max(0, cur.emAberto - 1)
                    }
                };
            });
        }
    };

    const handleDeleteBoleto = async (boletoId: number) => {
        if (!(await confirmDialog('Remover este boleto?'))) return;
        await supabase.from('boletos').delete().eq('id', boletoId);
        setBoletos(prev => prev.filter(b => b.id !== boletoId));
    };

    const handleUploadApolice = async (saleId: number, file: File) => {
        setUploadingApoliceId(saleId);
        try {
            const ext = file.name.split('.').pop() || 'pdf';
            const path = `${saleId}/apolice.${ext}`;
            const { error: uploadError } = await supabase.storage
                .from('apolices')
                .upload(path, file, { upsert: true, contentType: 'application/pdf' });
            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('apolices').getPublicUrl(path);
            await supabase.from('sales').update({ apolice_url: urlData.publicUrl }).eq('id', saleId);
            await fetchData();
        } catch (err) {
            console.error('Erro ao fazer upload da apólice:', err);
            toast('Erro ao enviar apólice. Tente novamente.', 'error');
        } finally {
            setUploadingApoliceId(null);
        }
    };

    const handleSaveClientObs = async (salesIds: number[]) => {
        if (!salesIds.length) {
            setSaveError('Este cliente não tem vendas vinculadas; não é possível salvar observações.');
            return;
        }
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

    /** Apaga o cliente da carteira.
     *
     *  A carteira não é uma tabela: é o agrupamento das linhas de `sales` pelo
     *  nome. Então "excluir o cliente" é apagar os registros dele — e o banco
     *  leva junto, em cascata, as tarefas do CRM e os boletos ligados a cada um.
     *  Por isso a confirmação mostra o que vai embora antes de apagar. */
    const handleExcluirCliente = async () => {
        if (!clienteParaExcluir) return;
        setExcluindoCliente(true);
        setSaveError(null);
        try {
            const { error } = await supabase.from('sales').delete().in('id', clienteParaExcluir.salesIds);
            if (error) throw error;
            await fetchData();
            await fetchTasks();
            setClienteParaExcluir(null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error: any) {
            setSaveError(error?.message || 'Não foi possível excluir o cliente.');
        } finally {
            setExcluindoCliente(false);
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
        if (!salesIds.length) {
            const msg = 'Este cliente não tem vendas vinculadas; não é possível salvar os limites.';
            setSaveError(msg);
            throw new Error(msg);
        }
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
            const msg =
                error?.message ||
                error?.error_description ||
                'Erro ao atualizar limites. No Supabase, confira se a coluna `limites_seguradoras` existe em `sales` (migração 017).';
            setSaveError(msg);
            throw new Error(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateClientLimits = async (_clientName: string, salesIds: number[]) => {
        let finalLimits = [...tempClientLimits];
        const resolvedSeguradora =
            newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR
                ? newLimitSeguradoraOutro.trim()
                : newTempLimit.seguradora.trim();
        const valorTrim = (newTempLimit.valor || '').trim();
        if (resolvedSeguradora && valorTrim) {
            finalLimits.push({
                seguradora: resolvedSeguradora,
                valor: valorTrim,
            });
        }
        try {
            await persistClientLimitsToSales(salesIds, finalLimits);
        } catch {
            /* saveError definido em persistClientLimitsToSales */
        }
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
                <Loader2 size={40} className="animate-spin mb-4 text-gold" />
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
            {!hideTabs && <div className="bg-navy p-2 rounded-2xl inline-flex gap-1 shadow-xl no-print">
                {(['sales', 'pendencias'] as Section[]).map((section) => (
                    <button
                        key={section}
                        onClick={() => setActiveSection(section)}
                        className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${activeSection === section
                            ? 'bg-gold text-white shadow-lg'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        {section === 'sales' && 'Vendas'}
                        {section === 'pendencias' && 'Pendências'}
                    </button>
                ))}
            </div>}

            {activeSection === 'sales' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    {/* Expiry Alert Banner */}
                    {!somenteFormulario && (() => {
                        const alerts = getExpiringAlerts();
                        if (alerts.length === 0) return null;
                        return (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                                        <AlertCircle size={18} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-amber-800 text-sm">
                                            {alerts.length} apólice{alerts.length > 1 ? 's' : ''} <span className="text-amber-900">Performance</span>{' '}
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
                                                    <p className="font-bold text-slate-800 text-sm truncate">{s.nome}</p>
                                                    <p className="text-xs text-slate-500">{s.tipo} • {s.vendedor}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="font-bold text-amber-600 text-sm">{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</p>
                                                    <p className="text-xs text-slate-400">Vence {fim.toLocaleDateString('pt-BR')}</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => markExpiryReminderDone(s)}
                                                        className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 font-bold text-xs px-3 py-2 rounded-xl transition-all"
                                                        title="Remover da lista (pendência já tratada)"
                                                    >
                                                        <Check size={13} strokeWidth={2.5} /> Concluído
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEdit(s)}
                                                        className="flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 font-bold text-xs px-3 py-2 rounded-xl transition-all"
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

                    {!somenteFormulario && (
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
                                        className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full md:w-64 focus:ring-2 focus:ring-gold/20 shadow-sm"
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
                                <Calendar size={18} className="text-gold" />
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
                            <button
                                onClick={() => navigator.clipboard.writeText('https://hub.fegsegurogarantia.com/apolices.html')}
                                className="bg-white text-gold px-5 py-2.5 rounded-xl font-bold text-sm border border-gold/30 shadow-sm hover:bg-gold/5 transition-all flex items-center gap-2"
                                title="Copiar link do portal de apólices"
                            >
                                <Copy size={18} />
                                Portal Cliente
                            </button>
                        </div>
                    </div>
                    )}

                    {/* Form Card */}
                    <div ref={saleFormRef} className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
                        <h3 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3">
                            <div className="w-1.5 h-6 bg-gold rounded-full"></div>
                            {editingId ? 'Editar Registro' : 'Nova Entrada de Venda'}
                            {editingId && (
                                <SaveIndicator estado={autoSaveState} aoTentarNovamente={salvarVendaAgora} className="ml-2" />
                            )}
                        </h3>

                        {rascunhoRestaurado && !editingId && (
                            <div className="mb-6 flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 text-slate-500 px-4 py-2.5 rounded-xl text-xs font-semibold">
                                <span>Recuperamos o que você tinha começado a preencher aqui.</span>
                                <button
                                    type="button"
                                    onClick={() => { resetForm(); setRascunhoRestaurado(false); }}
                                    className="text-slate-400 hover:text-slate-600 underline underline-offset-2"
                                >
                                    limpar e começar do zero
                                </button>
                            </div>
                        )}

                        {saveError && (
                            <div className="mb-6 flex items-center gap-3 bg-rose-50 border border-rose-200 text-rose-600 px-5 py-4 rounded-xl text-sm font-bold">
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
                                {emailSuccess && (
                                    <div className="bg-white border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                                        <span className="text-emerald-600 text-base">📎</span>
                                        <p className="text-emerald-700 text-xs font-bold flex-1">
                                            Apólice e boleto enviados ao cliente por e-mail.
                                        </p>
                                    </div>
                                )}
                                {partnerThankYou && (
                                    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center gap-3">
                                        <span className="text-blue-500 text-base">✉️</span>
                                        <p className="text-blue-700 text-xs font-bold flex-1">
                                            E-mail de agradecimento enviado automaticamente para <strong>{partnerThankYou.name}</strong>.
                                        </p>
                                        <button onClick={() => setPartnerThankYou(null)} className="text-blue-300 hover:text-blue-500 text-xs"><X size={14} /></button>
                                    </div>
                                )}
                                
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
                                                className="bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-[10px] hover:bg-slate-200 transition-colors flex items-center gap-2"
                                            >
                                                <Mail size={14} />
                                                Abrir Cópia Manual
                                            </button>
                                            <button
                                                onClick={() => setShowEmailPrompt(null)}
                                                className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] hover:bg-emerald-700 transition-colors"
                                            >
                                                Entendido
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Importar Minuta / Apólice ── */}
                        <div className="mb-6 relative overflow-hidden rounded-2xl border border-gold/40 bg-areia-clara shadow-sm">
                            {/* decorative gradient bar */}
                            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gold" />
                            <div className="flex items-center justify-between gap-4 px-5 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-navy text-gold flex items-center justify-center shadow-md">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                            <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                                        </svg>
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-gray-800 leading-tight">Importar Minuta ou Apólice</div>
                                        <div className="text-xs mt-0.5 leading-tight">
                                            {importedFields.length > 0
                                                ? <span className="text-emerald-600 font-semibold">✓ Preencheu: {importedFields.join(', ')}</span>
                                                : <span className="text-gray-400">Suba o PDF e os campos são preenchidos automaticamente com IA</span>}
                                        </div>
                                    </div>
                                </div>
                                <label className={`cursor-pointer flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md transition-all ${importingPdf ? 'bg-navy/50 cursor-not-allowed' : 'bg-navy hover:bg-navy-light hover:shadow-lg'}`}>
                                    {importingPdf
                                        ? <><Loader2 size={13} className="animate-spin" /> Processando...</>
                                        : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Selecionar PDF</>}
                                    <input type="file" accept=".pdf" className="hidden" onChange={handleImportPdf} disabled={importingPdf} />
                                </label>
                            </div>
                        </div>

                        <form onSubmit={handleSaleSubmit} className="space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">Data</label>
                                    <div className="relative">
                                        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input type="date" id="data" value={formData.data} onChange={handleInputChange} className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all" />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">Nome do Cliente / Tomador</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="nome" value={formData.nome || ''}
                                            onChange={handleNomeChange}
                                            onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
                                            onFocus={() => nameSuggestions.length > 0 && setShowNameSuggestions(true)}
                                            required placeholder="Ex: Empresa XYZ"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('nome')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-gold/20 focus:border-gold'
                                                }`}
                                        />
                                        {showNameSuggestions && nameSuggestions.length > 0 && (
                                            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                                                {nameSuggestions.map((s, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onMouseDown={() => handleNameSuggestionSelect(s)}
                                                        className="w-full text-left px-4 py-3 hover:bg-gold/10 transition-colors border-b border-slate-50 last:border-0"
                                                    >
                                                        <div className="font-bold text-sm text-slate-800">{s.nome}</div>
                                                        {s.cnpj && <div className="text-[11px] text-slate-400 font-medium">{s.cnpj}</div>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">CNPJ / CPF</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="cnpj" value={formData.cnpj || ''}
                                            onChange={handleCnpjChange}
                                            placeholder="00.000.000/0000-00"
                                            className="w-full px-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all"
                                        />
                                        {/* CNPJ lookup status icon */}
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                            {cnpjLookupStatus === 'searching' && (
                                                <Loader2 size={16} className="animate-spin text-gold" />
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
                                        <p className="text-[10px] font-bold text-emerald-600 mt-1">Cliente encontrado. Dados preenchidos automaticamente</p>
                                    )}
                                    {cnpjLookupStatus === 'not_found' && (
                                        <p className="text-[10px] font-bold text-amber-600 mt-1">⚠ CNPJ não encontrado na base. Preencha manualmente.</p>
                                    )}
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">Telefone</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="telefone" value={formData.telefone || ''}
                                            onChange={(e) => {
                                                setAutoFilledFields(prev => { const s = new Set(prev); s.delete('telefone'); return s; });
                                                setFormData(prev => ({ ...prev, telefone: maskTelefone(e.target.value) }));
                                            }}
                                            placeholder="(00) 00000-0000"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('telefone')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-gold/20 focus:border-gold'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">Decisor / Responsável</label>
                                    <div className="relative">
                                        <input
                                            type="text" id="decisor" value={formData.decisor || ''}
                                            onChange={(e) => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('decisor'); return s; }); handleInputChange(e); }}
                                            placeholder="Nome do responsável"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('decisor')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-gold/20 focus:border-gold'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">E-mail</label>
                                    <div className="relative">
                                        <input
                                            type="email" id="email" value={formData.email || ''}
                                            onChange={(e) => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('email'); return s; }); handleInputChange(e); }}
                                            placeholder="email@empresa.com"
                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 transition-all ${autoFilledFields.has('email')
                                                ? 'bg-emerald-50 border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
                                                : 'bg-slate-50 border-slate-200 focus:ring-gold/20 focus:border-gold'
                                                }`}
                                        />
                                    </div>
                                </div>
                                <div className="group/field relative">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 transition-colors group-focus-within/field:text-gold">Origem</label>
                                    <select id="origem" value={formData.origem} onChange={handleInputChange} required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all">
                                        <option value="">Selecione...</option>
                                        {LIST_DATA.origem.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Tipo Seguro</label>
                                    <select id="tipo" value={formData.tipo} onChange={handleInputChange} required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="">Selecione...</option>
                                        {LIST_DATA.tipoSeguro.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">IS Garantida</label>
                                    <input type="text" id="is" value={formData.is} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Seguradora</label>
                                    <input type="text" id="seguradora" value={formData.seguradora} onChange={handleInputChange} placeholder="Nome" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Valor Prêmio</label>
                                    <input type="text" id="premio" value={formData.premio} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Vendeu?</label>
                                    <select id="vendeu" value={formData.vendeu} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="Sim">Sim</option>
                                        <option value="Não">Não</option>
                                        <option value="Em andamento">Em andamento</option>
                                    </select>
                                    {/*
                                      * O salvamento automático grava os campos, mas nunca envia e-mail.
                                      * Quando a venda ACABA de virar "Sim", explicamos qual botão faz o
                                      * quê — senão a venda fica registrada e a apólice nunca sai, sem
                                      * ninguém perceber. Só aparece quando o botão "Enviar Apólice"
                                      * existe na tela (tipos Licitante e Performance).
                                      */}
                                    {formData.vendeu === 'Sim' && vendeuOriginalRef.current !== 'Sim'
                                      && (formData.tipo === 'Licitante' || formData.tipo === 'Performance') && (
                                        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] font-semibold text-amber-800 leading-relaxed">
                                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                            <span>
                                                Para o cliente receber, clique em <strong>Enviar Apólice</strong> aqui
                                                embaixo. É esse botão que manda a apólice e o boleto.
                                                <strong> Adicionar Venda</strong> apenas registra, sem enviar nada.
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {formData.vendeu === 'Não' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Motivo da Perda</label>
                                        <select id="motivoPerda" value={formData.motivoPerda} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                            <option value="">Selecione...</option>
                                            {LIST_DATA.motivoPerda.map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                    </div>
                                )}
                                {(formData.vendeu === 'Sim' || (formData.vendeu === 'Em andamento' && formData.tipo === 'Licitante')) && (
                                    <>
                                        {/* ── Vigência da APÓLICE (gera lembretes de renovação) ── */}
                                        <div className="md:col-span-2 lg:col-span-4 -mb-3 px-1">
                                            <span className="text-[10px] font-bold text-gold-dark uppercase tracking-widest">
                                                {formData.tipo === 'Licitante' ? 'Vigência da garantia de proposta' : 'Vigência da garantia de execução'}
                                            </span>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">📅 Início Vigência</label>
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
                                                className="w-full bg-gold/5 border border-gold/30 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">⏱ Dias de Vigência</label>
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
                                                className="w-full bg-navy/5 border border-navy/20 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all outline-none font-bold text-navy"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">📅 Fim Vigência</label>
                                            <input
                                                type="date"
                                                id="vigencia_fim"
                                                value={formData.vigencia_fim || ''}
                                                onChange={handleInputChange}
                                                className="w-full bg-gold/5 border border-gold/30 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all outline-none"
                                            />
                                        </div>
                                        {/* Duração calculada + avisos (não bloqueia digitação; datas invertidas bloqueiam só o salvar) */}
                                        {(() => {
                                            const dias = diffDias(formData.vigencia_inicio, formData.vigencia_fim);
                                            if (dias === null) return null;
                                            if (dias < 0) return (
                                                <div className="md:col-span-2 lg:col-span-4 -mt-3 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5 text-[11px] font-semibold text-rose-700 leading-relaxed">
                                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                                    <span>O fim da vigência é anterior ao início. Corrija as datas para conseguir salvar.</span>
                                                </div>
                                            );
                                            return (
                                                <div className="md:col-span-2 lg:col-span-4 -mt-3 space-y-2">
                                                    <p className="text-[11px] font-semibold text-slate-500 px-1">
                                                        Duração da apólice: <strong className="text-navy">{dias} {dias === 1 ? 'dia' : 'dias'}</strong>
                                                    </p>
                                                    {formData.tipo === 'Licitante' && dias > 180 && (
                                                        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] font-semibold text-amber-800 leading-relaxed">
                                                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                                            <span>Garantia de proposta raramente passa de 180 dias. Confira se você não preencheu a vigência do contrato aqui.</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        {/* ── Prazo do contrato garantido (informativo, não gera lembrete) ── */}
                                        <div className="md:col-span-2 lg:col-span-4 -mb-3 flex items-baseline gap-2 px-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Prazo do contrato garantido</span>
                                            <span className="text-[10px] font-semibold text-slate-400">Opcional · informativo, não gera lembrete</span>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">📅 Início do Contrato</label>
                                            <input
                                                type="date"
                                                id="vigencia_contrato_inicio"
                                                value={formData.vigencia_contrato_inicio || ''}
                                                onChange={handleInputChange}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">📅 Fim do Contrato</label>
                                            <input
                                                type="date"
                                                id="vigencia_contrato_fim"
                                                value={formData.vigencia_contrato_fim || ''}
                                                onChange={handleInputChange}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none"
                                            />
                                        </div>
                                    </>
                                )}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Comissão</label>
                                    <div className="flex gap-2">
                                        <div className="relative w-28 flex-shrink-0">
                                            <input
                                                type="number"
                                                id="comissaoPerc"
                                                value={formData.comissaoPerc}
                                                onChange={handleInputChange}
                                                placeholder="0"
                                                min="0" max="100" step="0.1"
                                                className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 pr-8 text-sm outline-none focus:border-amber-400 transition-all"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 font-bold text-sm">%</span>
                                        </div>
                                        <input type="text" id="comissao" value={formData.comissao} onChange={handleInputChange} placeholder="R$ 0,00" className="flex-1 bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Vendedor</label>
                                    <select id="vendedor" value={formData.vendedor} onChange={handleInputChange} required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="">Selecione...</option>
                                        {vendedorSelectOptions.map((v) => (
                                            <option key={v.email || v.name} value={v.name}>{v.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Parceiro</label>
                                    <select id="parceiro" value={(formData as any).parceiro || ''} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                        <option value="">Nenhum</option>
                                        {parceiros.map(p => (
                                            <option key={p.id} value={p.name}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>




                            {formData.tipo === 'Licitante' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-amber-50/50 rounded-2xl border border-amber-100">
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1.5">Órgão Licitante</label>
                                        <input type="text" id="orgaoLicitante" value={formData.orgaoLicitante || ''} onChange={handleInputChange} placeholder="Ex: Município de..." className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1.5">Valor do Edital</label>
                                        <input type="text" id="valorLote" value={formData.valorLote || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                            <span className={formData.tipo === 'Licitante' && !formData.dataPregao ? 'text-rose-500' : 'text-amber-600'}>📅 Data do Pregão</span>
                                            {formData.tipo === 'Licitante' && <span className="text-rose-500">*</span>}
                                        </label>
                                        <input type="date" id="dataPregao" value={formData.dataPregao || ''} onChange={handleInputChange}
                                            className={`w-full px-4 py-2.5 bg-white rounded-xl text-sm outline-none focus:ring-2 transition-all ${formData.tipo === 'Licitante' && !formData.dataPregao ? 'border-2 border-rose-400 focus:ring-rose-400/20 bg-rose-50/30' : 'border border-amber-200 focus:ring-amber-500/20'}`} />
                                        {formData.tipo === 'Licitante' && !formData.dataPregao && (
                                            <p className="text-[10px] text-rose-500 font-bold mt-1">Obrigatório para envio dos lembretes automáticos</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {formData.tipo === 'Performance' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-blue-50/50 rounded-2xl border border-blue-100">
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Número do Contrato</label>
                                        <input type="text" id="numeroContrato" value={formData.numeroContrato || ''} onChange={handleInputChange} placeholder="Ex: 001/2024" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Segurado (Beneficiário)</label>
                                        <input type="text" id="segurado" value={formData.segurado || ''} onChange={handleInputChange} placeholder="Nome do Segurado" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                    <div className="group/field relative md:col-span-2">
                                        <label className="block text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Objeto do Contrato</label>
                                        <input type="text" id="objetoContrato" value={formData.objetoContrato || ''} onChange={handleInputChange} placeholder="Descrição curta do objeto" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                    <div className="group/field relative">
                                        <label className="block text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Valor do Contrato</label>
                                        <input type="text" id="valorContrato" value={formData.valorContrato || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                                    </div>
                                </div>
                            )}

                            {formData.vendeu === 'Sim' && (
                                <div className="p-5 bg-amber-50/60 rounded-2xl border border-amber-100 space-y-3">
                                    <label className="block text-[10px] font-bold text-amber-600 uppercase tracking-widest px-1">💰 Cobrança / Boleto</label>
                                    {/* O campo "Nº do Boleto" saiu daqui: nunca era preenchido, e o
                                        que ele alimentava (o número citado no WhatsApp) foi removido
                                        da mensagem. A coluna continua na tabela com o histórico. */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                                <span className={!(formData as any).vencimento_boleto ? 'text-rose-500' : 'text-slate-400'}>{parseInt(qtdParcelas) > 1 ? '1º Vencimento' : 'Vencimento do Boleto'}</span>
                                                <span className="text-rose-500">*</span>
                                            </label>
                                            <input type="date" id="vencimento_boleto" value={(formData as any).vencimento_boleto || ''} onChange={handleInputChange}
                                                className={`w-full px-4 py-2.5 bg-white rounded-xl text-sm outline-none focus:ring-2 transition-all ${!(formData as any).vencimento_boleto ? 'border-2 border-rose-400 focus:ring-rose-400/20 bg-rose-50/30' : 'border border-amber-200 focus:ring-amber-400/20'}`} />
                                            {!(formData as any).vencimento_boleto && (
                                                <p className="text-[10px] text-rose-500 font-bold mt-1">Obrigatório para envio dos lembretes automáticos</p>
                                            )}
                                        </div>
                                        <div>
                                            {/* Parcelamento aqui mesmo: registrar a venda já cria as parcelas
                                                em `boletos`, sem precisar abrir o modal depois. */}
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Parcelas</label>
                                            <select value={qtdParcelas} onChange={e => setQtdParcelas(e.target.value)}
                                                className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400/20">
                                                <option value="1">À vista (1x)</option>
                                                {Array.from({ length: 23 }, (_, i) => i + 2).map(n => (
                                                    <option key={n} value={String(n)}>{n}x mensais</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Status Pagamento</label>
                                            <select id="pagamento_status" value={(formData as any).pagamento_status || 'Em dia'} onChange={async (e) => {
                                                const val = e.target.value;
                                                handleInputChange(e as any);
                                                // 'Pago' grava na hora: é o único status que a rotina
                                                // diária nunca sobrescreve, então vale registrar mesmo
                                                // que o formulário não seja salvo depois.
                                                if (val === 'Pago' && editingId) {
                                                    await supabase.from('sales').update({ pagamento_status: 'Pago' }).eq('id', editingId);
                                                }
                                            }}
                                                className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400/20">
                                                <option value="Em dia">Em dia</option>
                                                <option value="A vencer">A vencer</option>
                                                <option value="Vencido">Vencido</option>
                                                <option value="Pago">💚 Pago</option>
                                            </select>
                                        </div>
                                    </div>
                                    {/* Prévia do carnê: mostra o que vai ser gravado antes de salvar,
                                        para ele conferir o valor da parcela contra o carnê da seguradora. */}
                                    {(() => {
                                        const qtd = parseInt(qtdParcelas) || 1;
                                        const venc = (formData as any).vencimento_boleto;
                                        if (qtd < 2 || !venc) return null;
                                        const datas = gerarVencimentosMensais(venc, qtd);
                                        const premio = parseValorParcela(formData.premio || '');
                                        const valores = premio ? dividirEmParcelas(premio, qtd) : null;
                                        return (
                                            <div className="px-3 py-2 rounded-xl bg-white border border-amber-200 text-[11px] text-slate-600 font-medium">
                                                <span className="font-bold text-amber-600">{qtd}x</span>
                                                {valores && <> de <span className="font-bold">{formatCurrency(valores[1])}</span> (1ª de {formatCurrency(valores[0])})</>}
                                                {': '}1º vencimento em {datas[0].split('-').reverse().join('/')}, último em {datas[qtd - 1].split('-').reverse().join('/')}.
                                                {!valores && <span className="text-amber-600"> Preencha o prêmio para dividir o valor.</span>}
                                            </div>
                                        );
                                    })()}
                                    <p className="text-[10px] text-amber-600/70 font-medium italic">
                                        O lembrete sai 3 dias antes do vencimento, uma vez só. Não precisa marcar "Pago" para ele parar.
                                        {parseInt(qtdParcelas) > 1
                                            ? ' As parcelas são criadas ao salvar; para ajustar datas ou valores, use o botão Boletos na tabela abaixo.'
                                            : ''}
                                    </p>
                                </div>
                            )}

                            {formData.vendeu === 'Sim' && (
                                <div className="p-6 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-4">
                                    <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-widest px-1">📎 Documentos de Fechamento</label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="flex items-center gap-3">
                                            <input type="file" id="apolice-file" accept=".pdf" onChange={(e) => setSelectedApolice(e.target.files?.[0] || null)} className="hidden" />
                                            <label htmlFor="apolice-file" className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${selectedApolice ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                                                <Shield size={16} /> {selectedApolice ? selectedApolice.name.substring(0, 15) : 'Anexar Apólice (PDF)'}
                                            </label>
                                            {selectedApolice && <button type="button" onClick={() => setSelectedApolice(null)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"><X size={16} /></button>}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <input type="file" id="boleto-file" accept=".pdf" onChange={(e) => setSelectedBoleto(e.target.files?.[0] || null)} className="hidden" />
                                            <label htmlFor="boleto-file" className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${selectedBoleto ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                                                <DollarSign size={16} /> {selectedBoleto ? selectedBoleto.name.substring(0, 15) : 'Anexar Boleto (PDF)'}
                                            </label>
                                            {selectedBoleto && <button type="button" onClick={() => setSelectedBoleto(null)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"><X size={16} /></button>}
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-emerald-600/70 font-medium italic text-center">
                                        {sendingEmail
                                            ? "📤 Enviando e-mail com anexos... por favor aguarde."
                                            : "Estes arquivos só vão para o cliente quando você clicar em “Enviar Apólice”. “Adicionar Venda” apenas registra a venda."}
                                    </p>
                                </div>
                            )}

                            <div className="flex justify-between items-center gap-3">
                                {editingId ? (
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(editingId)}
                                        className="px-5 py-3.5 rounded-xl font-bold text-sm text-rose-500 hover:bg-rose-50 border border-rose-200 transition-all flex items-center gap-2"
                                    >
                                        <Trash2 size={16} /> Excluir
                                    </button>
                                ) : <div />}
                                <div className="flex items-center gap-3">
                                {editingId && (
                                    <button type="button" onClick={resetForm} className="px-8 py-3.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-all flex items-center gap-2">
                                        <X size={18} /> Fechar
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
                                        // Só este botão marca o envio ao cliente. O submit acontece
                                        // logo depois do onClick, e o handler lê a marca.
                                        onClick={formData.vendeu === 'Sim'
                                            ? () => { enviarAoClienteRef.current = true; }
                                            : handleSendDraft}
                                        disabled={saving || !formData.email}
                                        className={`${formData.vendeu === 'Sim' ? 'bg-navy hover:bg-navy-light' : 'bg-slate-800 hover:bg-slate-900'} text-white px-8 py-3.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 disabled:opacity-50`}
                                    >
                                        <Mail size={18} /> 
                                        {formData.vendeu === 'Sim' ? 'Enviar Apólice' : 'Enviar Minuta'}
                                    </button>
                                )}

                                {!editingId && (
                                    <button
                                        type="submit"
                                        // Registra a venda e não envia nada ao cliente.
                                        onClick={() => { enviarAoClienteRef.current = false; }}
                                        disabled={saving}
                                        title="Registra a venda sem enviar e-mail ao cliente"
                                        className="bg-gold text-white px-10 py-3.5 rounded-xl font-bold text-sm hover:bg-gold-hover transition-all shadow-lg active:scale-95 flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                                        Adicionar Venda
                                    </button>
                                )}
                                </div>
                            </div>
                        </form>
                    </div>

                    {/* Table Card */}
                    {!somenteFormulario && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                        <div className="table-scroll-x">
                            {/* min-w garante que a tabela transborde o card e o wrapper role na horizontal,
                                em vez de espremer a coluna Vendedor. */}
                            <table className="w-full min-w-[1180px] text-left">
                                <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap w-[92px] text-slate-600">Data</th>
                                        <th className="px-4 py-3 align-middle w-[220px]">
                                            <span className="block text-slate-600">Lead</span>
                                            <select
                                                value={salesLeadNomeFilter}
                                                onChange={(e) => setSalesLeadNomeFilter(e.target.value)}
                                                aria-label="Filtrar por cliente"
                                                className="mt-1.5 block w-fit max-w-[160px] cursor-pointer rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy outline-none transition-colors hover:border-gold focus:border-gold focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                {([...new Set(sales.map((s) => (s.nome ?? '').trim()).filter((x): x is string => Boolean(x)))] as string[]).sort((a, b) =>
                                                    a.localeCompare(b, 'pt-BR')
                                                ).map((nome) => (
                                                    <option key={nome} value={nome}>{nome}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-4 py-3 align-middle w-[120px]">
                                            <span className="block text-slate-600">Origem</span>
                                            <select
                                                value={salesOrigemFilter}
                                                onChange={(e) => setSalesOrigemFilter(e.target.value)}
                                                aria-label="Filtrar por origem"
                                                className="mt-1.5 block w-fit max-w-[100px] cursor-pointer rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy outline-none transition-colors hover:border-gold focus:border-gold focus:ring-0"
                                            >
                                                <option value="">Todas</option>
                                                {LIST_DATA.origem.map((o) => (
                                                    <option key={o} value={o}>{o}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-4 py-3 align-middle w-[130px]">
                                            <span className="block text-slate-600">Status</span>
                                            <select
                                                value={salesStatusFilter}
                                                onChange={(e) => setSalesStatusFilter(e.target.value)}
                                                aria-label="Filtrar por status"
                                                className="mt-1.5 block w-fit max-w-[100px] cursor-pointer rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy outline-none transition-colors hover:border-gold focus:border-gold focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                <option value="Sim">Sim</option>
                                                <option value="Não">Não</option>
                                                <option value="Em andamento">Em andamento</option>
                                            </select>
                                        </th>
                                        <th className="px-4 py-3 align-middle w-[130px]">
                                            <span className="block text-slate-600">Seguro</span>
                                            <select
                                                value={salesTipoFilter}
                                                onChange={(e) => setSalesTipoFilter(e.target.value)}
                                                aria-label="Filtrar por tipo de seguro"
                                                className="mt-1.5 block w-fit max-w-[100px] cursor-pointer rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy outline-none transition-colors hover:border-gold focus:border-gold focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                {LIST_DATA.tipoSeguro.map((t) => (
                                                    <option key={t} value={t}>{t}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap w-[120px] text-slate-600">Prêmio</th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap w-[120px] text-slate-600">Comissão</th>
                                        <th className="px-4 py-3 align-middle w-[140px]">
                                            <span className="block text-slate-600">Vendedor</span>
                                            <select
                                                value={salesVendedorFilter}
                                                onChange={(e) => setSalesVendedorFilter(e.target.value)}
                                                aria-label="Filtrar por vendedor"
                                                className="mt-1.5 block w-fit max-w-[110px] cursor-pointer rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy outline-none transition-colors hover:border-gold focus:border-gold focus:ring-0"
                                            >
                                                <option value="">Todos</option>
                                                {vendedorSelectOptions.map((v) => (
                                                    <option key={v.email || v.name} value={v.name}>{v.name}</option>
                                                ))}
                                            </select>
                                        </th>
                                        <th className="px-4 py-3 text-center align-middle whitespace-nowrap w-[110px] text-slate-600">Apólice</th>
                                        <th className="px-4 py-3 text-center align-middle whitespace-nowrap w-[130px] text-slate-600">Boleto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
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
                                            <tr key={sale.id} onClick={() => handleEdit(sale)} className={`group transition-colors duration-150 cursor-pointer ${editingId === sale.id ? 'bg-gold/10 border-l-2 border-l-gold' : 'hover:bg-slate-50'}`}>
                                                <td className="px-4 py-3.5 align-middle text-xs font-medium text-slate-500 whitespace-nowrap">{sale.data.split('-').reverse().join('/')}</td>
                                                <td className="px-4 py-3.5 align-middle max-w-[220px]">
                                                    <div className="flex items-center gap-2">
                                                        <div className="truncate text-sm font-bold text-slate-800 tracking-tight" title={sale.nome}>{sale.nome}</div>
                                                        {(sale as any).survey_score && (
                                                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-xl text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200 shrink-0">
                                                                ⭐ {(sale as any).survey_score}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="truncate text-[10px] text-slate-400 font-bold uppercase">{sale.seguradora || 'S/ Seguradora'}</div>
                                                </td>
                                                <td className="px-4 py-3.5 align-middle text-xs text-slate-600 font-medium">{sale.origem}</td>
                                                <td className="px-4 py-3.5 align-middle">
                                                    {/* Badge discreto: o significado fica no ponto colorido, não no fundo inteiro. */}
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200 bg-white text-[10px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap">
                                                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${sale.vendeu === 'Sim' ? 'bg-emerald-500' :
                                                            sale.vendeu === 'Não' ? 'bg-rose-400' : 'bg-blue-400'
                                                            }`} />
                                                        {sale.vendeu}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3.5 align-middle text-xs text-slate-700 font-semibold">{sale.tipo}</td>
                                                <td className="px-4 py-3.5 align-middle text-[15px] text-navy font-bold tabular-nums whitespace-nowrap">{sale.premio || <span className="font-normal text-slate-300">-</span>}</td>
                                                <td className="px-4 py-3.5 align-middle text-sm text-gold font-bold tabular-nums whitespace-nowrap">{sale.comissao || <span className="font-normal text-slate-300">-</span>}</td>
                                                <td className="px-4 py-3.5 align-middle text-xs text-slate-600 font-medium whitespace-nowrap">{sale.vendedor}</td>
                                                <td className="px-4 py-3.5 align-middle text-center">
                                                    {(sale as any).apolice_url ? (
                                                        <a
                                                            href={(sale as any).apolice_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all"
                                                        >
                                                            <Download size={13} /> PDF
                                                        </a>
                                                    ) : (
                                                        <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all">
                                                            {uploadingApoliceId === sale.id ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
                                                            {uploadingApoliceId === sale.id ? '...' : 'Upload'}
                                                            <input
                                                                type="file"
                                                                accept=".pdf"
                                                                className="hidden"
                                                                onChange={(e) => {
                                                                    const f = e.target.files?.[0];
                                                                    if (f) handleUploadApolice(sale.id, f);
                                                                    e.target.value = '';
                                                                }}
                                                            />
                                                        </label>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3.5 align-middle text-center">
                                                    {(() => {
                                                        const s = boletosSummary[sale.id];
                                                        return (
                                                            <button
                                                                onClick={() => openBoletoModal(sale.id, sale.nome || '', (sale as any).email || '', (sale as any).decisor || '')}
                                                                className={`inline-flex flex-col items-center px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${s && s.emAberto > 0 ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : s && s.total > 0 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                                                            >
                                                                <span className="inline-flex items-center gap-1 whitespace-nowrap"><FileText size={13} /> Boletos</span>
                                                                {s && s.total > 0 && (
                                                                    <span className={`text-[10px] font-bold leading-tight whitespace-nowrap ${s.emAberto > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                        {s.emAberto > 0 ? `${s.emAberto} em aberto` : 'Todos pagos'}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        );
                                                    })()}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    )}
                </section>
            )}

            {activeSection === 'prospects' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">Prospecção Ativa</h2>
                            <p className="text-slate-500 font-medium">Gestão de contatos e captação de novos clientes no formato Kanban.</p>
                        </div>
                        <button
                            onClick={() => { setShowEmailDispatcher(true); setEmailDispatchStatus('idle'); }}
                            className="flex items-center gap-2 px-5 py-3 bg-navy hover:bg-navy-light text-white font-bold text-sm rounded-xl shadow transition-all shrink-0"
                        >
                            <Send size={15} /> Disparador de Emails
                        </button>
                    </div>

                    <div className="mt-8">
                        <ProspectsKanban onConvertToSale={handleConvertToSale} onProductChange={setActiveKanbanProduct} />
                    </div>
                </section>
            )}

            {showEmailDispatcher && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowEmailDispatcher(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800">Disparador de Emails · {activeKanbanProduct}</h3>
                            <button onClick={() => setShowEmailDispatcher(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all"><X size={14} /></button>
                        </div>
                        <p className="text-xs text-slate-500">Cole o HTML do email abaixo. Use <code className="bg-slate-100 px-1 rounded-xl">[NOME_CONTATO]</code> e <code className="bg-slate-100 px-1 rounded-xl">[NOME_EMPRESA]</code> como variáveis.</p>
                        <textarea
                            value={emailTemplate}
                            onChange={e => setEmailTemplate(e.target.value)}
                            rows={10}
                            placeholder="Cole seu código HTML aqui..."
                            className="w-full font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold resize-y transition-all"
                        />
                        <button
                            onClick={handleDispatchEmails}
                            disabled={emailDispatchStatus === 'sending'}
                            className="w-full py-3 bg-navy hover:bg-navy-light disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-all"
                        >
                            {emailDispatchStatus === 'sending' ? 'Enviando...' : 'Salvar Template e Iniciar Envios'}
                        </button>
                        {emailDispatchStatus === 'success' && (
                            <p className="text-center text-sm font-bold text-emerald-600 bg-emerald-50 rounded-xl py-3">Comando recebido! O n8n já está enviando os emails.</p>
                        )}
                        {emailDispatchStatus === 'error' && (
                            <p className="text-center text-sm font-bold text-rose-600 bg-rose-50 rounded-xl py-3">Erro de conexão. Verifique se a automação está ativa.</p>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {boletoModalSaleId !== null && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setBoletoModalSaleId(null)}>
                    {/* max-h + scroll: com o carnê importado a lista de parcelas cresce e passaria da tela */}
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-black text-slate-800">Boletos · {boletoModalNome}</h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {boletoModalEmail
                                        ? <>Para <span className="font-bold text-gold">{boletoModalContato || boletoModalNome}</span> · {boletoModalEmail}</>
                                        : <span className="text-amber-500">⚠ Sem e-mail cadastrado neste registro</span>
                                    }
                                </p>
                            </div>
                            <button onClick={() => setBoletoModalSaleId(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all"><X size={18} /></button>
                        </div>

                        {/* Lista de boletos existentes */}
                        {boletos.length > 0 ? (
                            <div className="space-y-2">
                                {boletos.map(b => (
                                    <div key={b.id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${b.pago ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className={`text-xs font-bold px-2.5 py-1 rounded-xl ${b.pago ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>Parcela {b.parcela}</span>
                                            {b.vencimento && <span className="text-xs text-slate-500 font-medium">Venc. {b.vencimento.split('-').reverse().join('/')}</span>}
                                            {b.valor != null && <span className="text-xs font-bold text-slate-700">{formatCurrency(Number(b.valor))}</span>}
                                            {b.pago
                                                ? <span className="text-xs font-bold text-emerald-600">✓ Pago</span>
                                                : <span className="text-xs font-bold text-rose-600">⚠ Em Aberto</span>
                                            }
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleTogglePago(b.id, b.pago)}
                                                className={`text-[10px] font-bold px-2.5 py-1 rounded-xl transition-all ${b.pago ? 'bg-slate-100 text-slate-600 hover:bg-rose-100 hover:text-rose-600' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                                            >
                                                {b.pago ? 'Marcar como Em Aberto' : 'Marcar como Pago'}
                                            </button>
                                            <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 transition-all">
                                                <Download size={13} /> PDF
                                            </a>
                                            {!b.pago && (
                                                <button
                                                    onClick={() => handleSendBoletoEmail(b)}
                                                    disabled={sendingBoletoEmail === b.id}
                                                    className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-xl transition-all ${boletoEmailSent.has(b.id) ? 'bg-emerald-50 text-emerald-600' : 'bg-gold/10 text-gold-hover hover:bg-gold/20'}`}
                                                    title={boletoModalEmail ? `Enviar para ${boletoModalEmail}` : 'Sem e-mail cadastrado'}
                                                >
                                                    {sendingBoletoEmail === b.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                                                    {boletoEmailSent.has(b.id) ? 'Enviado' : 'E-mail'}
                                                </button>
                                            )}
                                            <button onClick={() => handleDeleteBoleto(b.id)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={13} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 text-center py-4">Nenhum boleto cadastrado ainda.</p>
                        )}

                        {/* Venda parcelada — gera todas as parcelas de uma vez */}
                        <div className="border-t border-slate-100 pt-5 space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Venda parcelada? Gere as parcelas</p>
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                                Informe quantas parcelas, a data da primeira e o valor. Eu monto o carnê inteiro mês a mês,
                                você ajusta as datas que o banco mudou e cadastra tudo de uma vez. Cada parcela passa a
                                ter seu próprio lembrete, 3 dias antes do vencimento.
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Parcelas</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="60"
                                        value={carneQtd}
                                        onChange={e => setCarneQtd(e.target.value)}
                                        placeholder="6"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">1º vencimento</label>
                                    <input
                                        type="date"
                                        value={carnePrimeiroVenc}
                                        onChange={e => setCarnePrimeiroVenc(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2.5 text-sm outline-none focus:border-gold transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Valor</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={carneValor}
                                        onChange={e => setCarneValor(e.target.value)}
                                        placeholder="2.083,53"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all"
                                    />
                                </div>
                            </div>
                            <button
                                onClick={handleGerarParcelas}
                                className="w-full py-2.5 bg-white border border-gold text-gold-hover hover:bg-gold/10 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                            >
                                <Plus size={14} /> Gerar parcelas
                            </button>

                            {carneParcelas.length > 0 && (
                                <div className="space-y-2 rounded-xl bg-areia-clara border border-linha p-3">
                                    <p className="text-[10px] font-bold text-navy uppercase tracking-widest">
                                        Confira antes de cadastrar: {carneParcelas.length} parcela(s)
                                    </p>
                                    {carneParcelas.map((p, i) => {
                                        const jaExiste = boletos.some(b => b.parcela === parseInt(p.parcela));
                                        return (
                                            <div key={i} className={`flex items-center gap-2 ${jaExiste ? 'opacity-40' : ''}`}>
                                                <span className="text-[11px] font-bold text-slate-600 w-8 shrink-0">{p.parcela}ª</span>
                                                <input
                                                    type="date"
                                                    value={p.vencimento}
                                                    onChange={e => setCarneParcelas(prev => prev.map((x, j) => j === i ? { ...x, vencimento: e.target.value } : x))}
                                                    className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs outline-none focus:border-gold"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={p.valor}
                                                    onChange={e => setCarneParcelas(prev => prev.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))}
                                                    placeholder="2.083,53"
                                                    className="w-24 shrink-0 bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs outline-none focus:border-gold"
                                                />
                                                <button
                                                    onClick={() => setCarneParcelas(prev => prev.filter((_, j) => j !== i))}
                                                    className="p-1 text-slate-400 hover:text-rose-500 rounded-xl transition-all shrink-0"
                                                    title="Remover esta parcela da lista"
                                                >
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {carneParcelas.some(p => boletos.some(b => b.parcela === parseInt(p.parcela))) && (
                                        <p className="text-[10px] text-amber-600 font-bold">
                                            As parcelas esmaecidas já estão cadastradas e serão ignoradas.
                                        </p>
                                    )}
                                    {carneParcelas.some(p => !p.vencimento) && (
                                        <p className="text-[10px] text-rose-500 font-bold">
                                            Preencha o vencimento das parcelas em branco. É a data que dispara o lembrete.
                                        </p>
                                    )}

                                    {/* PDF do carnê: opcional, e o mesmo arquivo vale para todas as parcelas. */}
                                    <label className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-dashed border-slate-300 bg-white text-[11px] font-bold text-slate-500 hover:border-gold hover:text-gold-hover cursor-pointer transition-all">
                                        <FileText size={13} />
                                        {carneFile ? carneFile.name.substring(0, 30) : 'Anexar PDF do carnê (opcional)'}
                                        <input
                                            type="file"
                                            accept=".pdf"
                                            className="hidden"
                                            onChange={e => { const f = e.target.files?.[0]; if (f) setCarneFile(f); e.target.value = ''; }}
                                        />
                                    </label>

                                    <button
                                        onClick={handleSalvarCarne}
                                        disabled={salvandoCarne || carneParcelas.some(p => !p.vencimento)}
                                        className="w-full py-2.5 bg-gold hover:bg-gold-hover disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                                    >
                                        {salvandoCarne ? <><Loader2 size={14} className="animate-spin" /> Cadastrando...</> : <><Plus size={14} /> Cadastrar todas as parcelas</>}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Formulário para adicionar parcela */}
                        <div className="border-t border-slate-100 pt-5 space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Adicionar parcela avulsa</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Nº da Parcela</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={boletoForm.parcela}
                                        onChange={e => setBoletoForm(f => ({ ...f, parcela: e.target.value }))}
                                        placeholder="1"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Vencimento</label>
                                    <input
                                        type="date"
                                        value={boletoForm.vencimento}
                                        onChange={e => setBoletoForm(f => ({ ...f, vencimento: e.target.value }))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Valor da Parcela</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={boletoForm.valor}
                                    onChange={e => setBoletoForm(f => ({ ...f, valor: e.target.value }))}
                                    placeholder="2.083,53"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">
                                    Opcional, mas é o que permite mostrar ao parceiro quanto ele recebe em cada parcela.
                                </p>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Arquivo PDF</label>
                                <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${boletoForm.file ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    <FileText size={14} />
                                    {boletoForm.file ? boletoForm.file.name.substring(0, 25) : 'Selecionar PDF'}
                                    <input type="file" accept=".pdf" className="hidden" onChange={e => setBoletoForm(f => ({ ...f, file: e.target.files?.[0] || null }))} />
                                </label>
                            </div>
                            <button
                                onClick={handleAddBoleto}
                                disabled={uploadingBoleto || !boletoForm.file || !boletoForm.parcela}
                                className="w-full py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2"
                            >
                                {uploadingBoleto ? <><Loader2 size={16} className="animate-spin" /> Enviando...</> : <><Plus size={16} /> Adicionar Parcela</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {activeSection === 'carteira' && (
                <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                    {!somenteFicha && (
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
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gold text-navy font-bold text-sm shadow-md shadow-gold/25 border border-gold-hover/60 hover:bg-gold-hover hover:border-gold-hover transition-all order-2 sm:order-1 whitespace-nowrap"
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
                                    className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full focus:ring-2 focus:ring-gold/20 shadow-sm"
                                />
                            </div>
                        </div>
                    </div>
                    )}

                    {saveError && (
                        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm font-medium">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />
                            <span>{saveError}</span>
                        </div>
                    )}
                    {saveSuccess && (
                        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm font-bold">
                            <CheckCircle2 size={18} />
                            Alterações salvas.
                        </div>
                    )}

                    <div className={somenteFicha ? 'grid grid-cols-1 gap-6' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'}>
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
                                /** Data da venda de onde veio o nome exibido. Só serve para o desempate abaixo. */
                                nomeData: string;
                            }

                            // O agrupamento é pelo CNPJ; o nome só entra quando não
                            // há CNPJ. Antes a chave era o nome, e a mesma empresa
                            // virava dois cards quando ele digitava diferente
                            // ("LTDA" e "LTDA EPP", "SERVICOS" e "SERVIÇOS").
                            const soDigitos = (v?: string | null) => (v || '').replace(/\D/g, '');

                            // Venda com o CNPJ em branco herda o do xará de nome.
                            // Sem isso, registro antigo (de antes do campo existir)
                            // se separaria do card da própria empresa.
                            const cnpjPorNome = sales.reduce((mapa, sale) => {
                                const chaveNome = (sale.nome || '').trim().toUpperCase();
                                const doc = soDigitos(sale.cnpj);
                                if (chaveNome && doc && !mapa[chaveNome]) mapa[chaveNome] = doc;
                                return mapa;
                            }, {} as Record<string, string>);

                            const portfolio = sales.reduce((acc, sale) => {
                                if (!sale.nome) return acc;
                                const clientName = sale.nome.trim().toUpperCase();
                                const doc = soDigitos(sale.cnpj) || cnpjPorNome[clientName] || '';
                                const chave = doc || clientName;

                                if (!acc[chave]) {
                                    acc[chave] = {
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
                                        salesIds: [],
                                        nomeData: '',
                                    };
                                }

                                // Entre as grafias do mesmo CNPJ, exibe a da venda
                                // mais recente: é a última que ele digitou.
                                if ((sale.data || '') >= acc[chave].nomeData) {
                                    acc[chave].nome = sale.nome;
                                    acc[chave].nomeData = sale.data || '';
                                }

                                acc[chave].salesIds.push(sale.id);

                                const saleObs = (sale.obs ?? '').trim();
                                if (saleObs && !acc[chave].obs) {
                                    acc[chave].obs = saleObs;
                                }

                                // Update contact info if missing
                                if (!acc[chave].cnpj && sale.cnpj) acc[chave].cnpj = sale.cnpj;
                                if (!acc[chave].telefone && sale.telefone) acc[chave].telefone = sale.telefone;
                                if (!acc[chave].email && sale.email) acc[chave].email = sale.email;
                                if (!acc[chave].decisor && sale.decisor) acc[chave].decisor = sale.decisor;

                                // Parse limits
                                if (sale.limites_seguradoras) {
                                    try {
                                        const parsed = JSON.parse(sale.limites_seguradoras);
                                        if (Array.isArray(parsed)) {
                                            parsed.forEach(p => {
                                                // Avoid adding duplicates
                                                if (!acc[chave].limites.some((l: any) => l.seguradora === p.seguradora)) {
                                                    acc[chave].limites.push(p);
                                                }
                                            });
                                        }
                                    } catch (e) { }
                                }

                                if (sale.vendeu === 'Sim') {
                                    acc[chave].salesVendidas.push({
                                        id: sale.id,
                                        data: sale.data,
                                        tipo: sale.tipo || '',
                                        seguradora: sale.seguradora || '',
                                        is: sale.is || '',
                                        premio: sale.premio || '',
                                        comissao: sale.comissao || '',
                                    });
                                    acc[chave].totalPremio += parseNumber(sale.premio || '0');
                                    acc[chave].totalIS += parseNumber(sale.is || '0');
                                    acc[chave].totalComissao += parseNumber(sale.comissao || '0');
                                }

                                return acc;
                            }, {} as Record<string, ClientPortfolioItem>);

                            const clients = (Object.values(portfolio) as ClientPortfolioItem[])
                                .filter(c => {
                                    const termo = semAcento(salesSearch.trim());
                                    if (!termo) return true;

                                    // Só procura por CNPJ quando o que foi digitado é de fato um
                                    // número. Antes bastava um dígito solto no meio do texto
                                    // ("g2 cont" vira "2") para casar com quase todo CNPJ da
                                    // carteira — e a busca devolvia tudo, como se ignorasse o campo.
                                    const digitos = termo.replace(/\D/g, '');
                                    if (digitos.length >= 3 && !/[a-z]/.test(termo)) {
                                        return !!c.cnpj && c.cnpj.replace(/\D/g, '').includes(digitos);
                                    }

                                    // Cada palavra digitada precisa aparecer no nome ou no
                                    // responsável — em qualquer ordem, e tolerando um erro de
                                    // digitação por palavra.
                                    const alvo = `${c.nome} ${c.decisor || ''}`;
                                    return termo.split(/\s+/).every(p => bateTermo(alvo, p));
                                })
                                .sort((a, b) => a.nome.localeCompare(b.nome));

                            if (clients.length === 0) {
                                const filteredOut = salesSearch.trim().length > 0;
                                return (
                                    <div className="col-span-full py-20 text-center bg-white rounded-2xl border border-slate-100 shadow-sm">
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
                                <div key={idx} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group flex flex-col h-full relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-gold/5 rounded-bl-full -z-0"></div>

                                    <div className="relative z-10 flex-1">
                                        <div className="flex items-start gap-4 mb-6">
                                            <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                                                <Briefcase size={20} className="text-gold" />
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
                                                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-xl ${hasOverdue ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`} title={`${clientTasks.length} tarefa(s) pendente(s)`}>
                                                                <Clock size={10} className={hasOverdue ? 'animate-pulse' : ''} />
                                                                <span className="text-[10px] font-bold">{clientTasks.length}</span>
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
                                                        className="shrink-0 p-1.5 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-xl transition-all"
                                                        title="Editar dados do cliente"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => setClienteParaExcluir({
                                                            nome: client.nome,
                                                            salesIds: client.salesIds,
                                                            vendas: client.salesVendidas.length,
                                                        })}
                                                        className="shrink-0 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                                        title="Excluir cliente da carteira"
                                                    >
                                                        <Trash2 size={14} />
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
                                                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{label}</label>
                                                                <input
                                                                    type={type}
                                                                    value={(clientEditForm as any)[key]}
                                                                    onChange={e => setClientEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                                                                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold transition-all"
                                                                />
                                                            </div>
                                                        ))}
                                                        <div className="flex gap-2 pt-1">
                                                            <button
                                                                onClick={() => setEditingClientName(null)}
                                                                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 py-2 rounded-xl hover:bg-slate-100 transition-all"
                                                            >
                                                                <X size={11} /> CANCELAR
                                                            </button>
                                                            <button
                                                                onClick={() => handleSaveClientInfo(client.salesIds)}
                                                                disabled={saving}
                                                                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold text-white bg-gold hover:bg-gold-hover py-2 rounded-xl transition-all disabled:opacity-50"
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
                                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">RESPONSÁVEL: <span className="text-slate-700">{client.decisor}</span></p>
                                                                <CopyButton text={client.decisor} label="Decisor" />
                                                            </div>
                                                        )}
                                                        {client.cnpj && (
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-[10px] font-bold text-gold">CNPJ: {client.cnpj}</p>
                                                                <CopyButton text={client.cnpj} label="CNPJ" />
                                                            </div>
                                                        )}
                                                        {client.telefone && (
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-xs font-medium text-slate-500 break-all flex flex-wrap items-center gap-1">
                                                                    
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
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1">Seguros Contratados</p>
                                                {client.salesVendidas.length > 0 ? (
                                                    <div className="space-y-1.5">
                                                        {client.salesVendidas.map((sv) => (
                                                            <div key={sv.id} className="flex flex-col p-2.5 bg-slate-50 border border-slate-100 rounded-xl gap-1">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-[10px] font-bold text-slate-700 uppercase">{sv.tipo || 'Seguro'}</span>
                                                                    {sv.seguradora && (
                                                                        <span className="text-[10px] font-bold text-gold bg-gold/10 px-2 py-0.5 rounded-xl uppercase">{sv.seguradora}</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex justify-between items-center text-[10px] font-bold">
                                                                    <div className="text-slate-500 uppercase">IS: <span className="text-slate-800">{sv.is ? formatCurrency(parseNumber(sv.is)) : '-'}</span></div>
                                                                    <div className="text-slate-500 uppercase">Prêmio: <span className="text-slate-800">{sv.premio ? formatCurrency(parseNumber(sv.premio)) : '-'}</span></div>
                                                                </div>
                                                                <div className="text-[10px] text-slate-400">{sv.data.split('-').reverse().join('/')}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-slate-400 italic">Nenhum seguro emitido ainda.</p>
                                                )}
                                            </div>

                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1 flex justify-between items-center">
                                                    <span>Crédito Aprovado nas Seguradoras</span>
                                                    <button
                                                        onClick={() => {
                                                            setEditingClientLimits(client.nome);
                                                            setTempClientLimits(client.limites);
                                                            setNewTempLimit({ seguradora: '', valor: '' });
                                                            setNewLimitSeguradoraOutro('');
                                                        }}
                                                        className="text-gold hover:text-gold-hover transition-colors p-1"
                                                    >
                                                        <Plus size={12} strokeWidth={3} />
                                                    </button>
                                                </p>

                                                {editingClientLimits === client.nome ? (
                                                    <div className="space-y-3 p-3 bg-slate-50 rounded-2xl border border-gold/20 animate-in fade-in zoom-in-95 duration-200">
                                                        <div className="space-y-2">
                                                            {tempClientLimits.map((l, i) => (
                                                                <div key={i} className="flex justify-between items-center bg-white px-2 py-1.5 rounded-xl border border-slate-100 text-[11px]">
                                                                    <span className="font-bold text-slate-700">{l.seguradora}</span>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-bold text-slate-400">{formatCurrency(l.valor)}</span>
                                                                        <button
                                                                            onClick={() => setTempClientLimits(prev => prev.filter((_, idx) => idx !== i))}
                                                                            className="text-rose-400 hover:text-rose-600"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5 items-stretch">
                                                            <select
                                                                value={newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR ? '' : newTempLimit.seguradora}
                                                                onChange={e => {
                                                                    const v = e.target.value;
                                                                    setNewTempLimit(prev => ({ ...prev, seguradora: v }));
                                                                    setNewLimitSeguradoraOutro('');
                                                                }}
                                                                className="flex-1 min-w-[100px] text-[10px] p-2 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-gold bg-white"
                                                            >
                                                                <option value="">Seguradora...</option>
                                                                {insurers.map(ins => (
                                                                    <option key={ins.id} value={ins.nome}>{ins.nome}</option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setNewTempLimit(prev => ({
                                                                        ...prev,
                                                                        seguradora: SEGURADORA_OUTRO_CORRETOR,
                                                                    }));
                                                                }}
                                                                className={`shrink-0 px-2.5 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-tight transition-all ${
                                                                    newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR
                                                                        ? 'border-navy bg-navy text-white shadow-sm'
                                                                        : 'border-slate-200 bg-white text-slate-600 hover:border-gold/50 hover:text-gold'
                                                                }`}
                                                            >
                                                                Outro corretor
                                                            </button>
                                                            {newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR && (
                                                                <input
                                                                    type="text"
                                                                    placeholder="Nome do corretor ou seguradora"
                                                                    value={newLimitSeguradoraOutro}
                                                                    onChange={e => setNewLimitSeguradoraOutro(e.target.value)}
                                                                    className="flex-1 min-w-[120px] text-[10px] p-2 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-gold bg-slate-50"
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
                                                                className="w-20 text-[10px] p-2 rounded-xl border border-slate-200 outline-none focus:ring-1 focus:ring-gold"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const resolvedSeguradora =
                                                                        newTempLimit.seguradora === SEGURADORA_OUTRO_CORRETOR
                                                                            ? newLimitSeguradoraOutro.trim()
                                                                            : newTempLimit.seguradora.trim();
                                                                    const valorTrim = (newTempLimit.valor || '').trim();
                                                                    if (resolvedSeguradora && valorTrim) {
                                                                        setTempClientLimits(prev => [
                                                                            ...prev,
                                                                            { seguradora: resolvedSeguradora, valor: valorTrim },
                                                                        ]);
                                                                        setNewTempLimit({ seguradora: '', valor: '' });
                                                                        setNewLimitSeguradoraOutro('');
                                                                    }
                                                                }}
                                                                className="bg-gold text-white p-2 rounded-xl shrink-0"
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
                                                                className="flex-1 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
                                                            >
                                                                CANCELAR
                                                            </button>
                                                            <button
                                                                onClick={() => handleUpdateClientLimits(client.nome, client.salesIds)}
                                                                disabled={saving}
                                                                className="flex-1 text-[10px] font-bold text-emerald-500 hover:text-emerald-700 transition-colors flex items-center justify-center gap-1"
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
                                                                        <span className="text-xs font-bold text-slate-600 bg-white px-2 py-0.5 rounded-xl border border-slate-200">
                                                                            {formatCurrency(l.valor)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                                <button
                                                                    onClick={() => handleSendLimits(client)}
                                                                    disabled={!!sendingLimitsTo}
                                                                    className="mt-2 w-full py-3 bg-navy text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-navy-light transition-all flex items-center justify-center gap-2 disabled:opacity-50"
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
                                        {/* Documentos do cliente: contrato social, balancetes, DRE */}
                                        <div className="mt-6 pt-6 border-t border-slate-100">
                                            <ClienteDocumentos
                                                nome={client.nome}
                                                cnpj={client.cnpj}
                                                documentos={documentosDoCliente(docsClientes, client.nome, client.cnpj)}
                                                aoMudar={carregarDocsClientes}
                                            />
                                        </div>
                                        {/* Task Manager for Clients */}
                                        <div className="mt-6 pt-6 border-t border-slate-100">
                                            <TaskManager saleIds={client.salesIds} onTaskChange={fetchTasks} />
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-slate-100">
                                            <div className="flex items-center gap-1.5 mb-1.5">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                    Observações
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingClientObs(client.nome);
                                                        setTempClientObs(client.obs || '');
                                                    }}
                                                    className="p-1 text-slate-400 hover:text-gold hover:bg-gold/10 rounded-xl transition-all"
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
                                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold resize-y min-h-[72px]"
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingClientObs(null)}
                                                            className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all"
                                                        >
                                                            <X size={11} /> Cancelar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSaveClientObs(client.salesIds)}
                                                            disabled={saving}
                                                            className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold text-white bg-navy hover:bg-navy-light py-2 rounded-xl transition-all disabled:opacity-50"
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
                            <Calendar size={18} className="text-gold" />
                            <input type="month" value={goalsMonthSelector} onChange={(e) => setGoalsMonthSelector(e.target.value)} className="bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 outline-none" />
                        </div>
                    </div>

                    <div className="bg-navy rounded-2xl p-6 md:p-8 border border-white/10 text-white shadow-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gold/20 flex items-center justify-center">
                                    <Users size={20} className="text-gold" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black uppercase tracking-widest text-gold">Gestão de Vendedores</h3>
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
                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gold text-navy font-bold text-sm uppercase tracking-wider border border-gold-hover hover:bg-gold-hover transition-all disabled:opacity-50"
                            >
                                <Plus size={18} strokeWidth={2.5} /> Novo Vendedor
                            </button>
                        </div>

                        {sellerMgmtError && (
                            <div className="mb-4 px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-400/40 text-rose-200 text-sm font-bold">
                                {sellerMgmtError}
                            </div>
                        )}

                        {showNewSellerForm && (
                            <div className="mb-6 p-5 rounded-2xl border border-white/10 bg-white/5 space-y-4">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Novo vendedor</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input
                                        placeholder="Nome"
                                        value={newSellerDraft.name}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, name: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-gold/40"
                                    />
                                    <input
                                        placeholder="Email"
                                        type="email"
                                        value={newSellerDraft.email}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, email: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-gold/40"
                                    />
                                    <input
                                        placeholder="Share (%)"
                                        value={newSellerDraft.sharePercent}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, sharePercent: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-gold/40"
                                    />
                                    <input
                                        placeholder="Dias por semana"
                                        value={newSellerDraft.daysPerWeek}
                                        onChange={(e) => setNewSellerDraft((p) => ({ ...p, daysPerWeek: e.target.value }))}
                                        className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-gold/40"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={sellerCrudBusy}
                                        onClick={() => void handleInsertSeller()}
                                        className="px-5 py-2.5 rounded-xl bg-gold text-navy font-bold text-xs uppercase tracking-widest disabled:opacity-50"
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
                                        className="px-5 py-2.5 rounded-xl border border-white/20 font-bold text-xs uppercase tracking-widest text-slate-300 hover:bg-white/5"
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
                                                className="w-28 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-sm font-bold"
                                                placeholder="%"
                                            />
                                            <input
                                                value={sellerEditDraft.daysPerWeek}
                                                onChange={(e) => setSellerEditDraft((p) => ({ ...p, daysPerWeek: e.target.value }))}
                                                className="w-24 bg-white/10 border border-white/15 rounded-xl px-3 py-2 text-sm font-bold"
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => void handleUpdateSeller(seller.id)}
                                                    className="px-4 py-2 rounded-xl bg-gold text-navy font-bold text-xs uppercase"
                                                >
                                                    Salvar
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => setEditingSellerId(null)}
                                                    className="px-4 py-2 rounded-xl border border-white/20 text-xs font-bold uppercase"
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
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-gold mt-2">
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
                                                    className="px-4 py-2 rounded-xl border border-gold/50 text-gold font-bold text-xs uppercase tracking-wider hover:bg-gold/10"
                                                >
                                                    Editar
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sellerCrudBusy}
                                                    onClick={() => void handleDeleteSeller(seller.id, seller.name)}
                                                    className="px-4 py-2 rounded-xl border border-rose-400/40 text-rose-300 font-bold text-xs uppercase tracking-wider hover:bg-rose-500/10"
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
                                    <div key={seller.id} className="bg-slate-900 rounded-2xl p-10 text-white relative overflow-hidden shadow-2xl border border-white/5">
                                        <div className="relative z-10 flex flex-col h-full">
                                            <div className="flex justify-between items-start mb-12">
                                                <div>
                                                    <h3 className="text-4xl font-black tracking-tighter text-gold">{seller.name}</h3>
                                                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mt-1">
                                                        {Number(seller.share) * 100}% da meta empresa (fallback proporcional)
                                                    </p>
                                                </div>
                                                <div className="bg-gold/20 p-4 rounded-2xl">
                                                    <Target size={32} className="text-gold" />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-8 mb-12">
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Meta Mensal</p>
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
                                                            className="mt-1 w-full max-w-[11rem] bg-white/10 border border-gold/40 rounded-xl px-3 py-2 text-xl font-black text-white outline-none focus:ring-2 focus:ring-gold/30"
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
                                                            className="text-left text-2xl font-black hover:text-gold transition-colors"
                                                        >
                                                            {formatCurrency(sellerTarget)}
                                                        </button>
                                                    )}
                                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter pt-1">Clique para editar</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Meta Semanal</p>
                                                    <p className="text-2xl font-black text-slate-300">{formatCurrency(sellerTarget / 4)}</p>
                                                </div>
                                            </div>

                                            <div className="mt-auto pt-10 border-t border-white/5">
                                                <div className="flex justify-between items-end mb-4">
                                                    <div>
                                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Comissão Realizada</p>
                                                        <p className="text-5xl font-black text-gold tracking-tighter">{formatCurrency(totalAchieved)}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-3xl font-black text-white">{percent.toFixed(1)}%</p>
                                                    </div>
                                                </div>

                                                <div className="h-4 bg-white/5 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-gold to-white rounded-full transition-all duration-1000"
                                                        style={{ width: `${percent}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="absolute top-0 right-0 w-64 h-64 bg-gold opacity-[0.03] rounded-full blur-[80px] -mr-32 -mt-32"></div>
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
                                <div key={key} className={`p-8 rounded-2xl border transition-all duration-500 hover:scale-105 ${isCurrent ? 'bg-navy text-white border-gold shadow-2xl scale-105 z-10' : 'bg-white text-slate-800 border-slate-100 shadow-sm'
                                    }`}>
                                    <div className="flex justify-between items-start mb-6">
                                        <h3 className="text-2xl font-black tracking-tight">{monthLabel}</h3>
                                        <div className={`w-3 h-3 rounded-full ${isCurrent ? 'bg-gold animate-pulse' : 'bg-slate-200'}`}></div>
                                    </div>

                                    <div className="space-y-4 mb-8">
                                        <div>
                                            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${isCurrent ? 'text-slate-400' : 'text-slate-400'}`}>Meta</p>
                                            <p className="text-lg font-bold">{formatCurrency(metaTotal)}</p>
                                        </div>
                                        <div>
                                            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${isCurrent ? 'text-gold' : 'text-slate-400'}`}>Atingido</p>
                                            <p className={`text-2xl font-black ${isCurrent ? 'text-gold' : 'text-slate-800'}`}>{formatCurrency(achieved)}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider">
                                            <span className={isCurrent ? 'text-slate-400' : 'text-slate-400'}>Progresso</span>
                                            <span className={isCurrent ? 'text-white' : 'text-slate-800'}>{percent.toFixed(0)}%</span>
                                        </div>
                                        <div className={`h-2 rounded-full overflow-hidden ${isCurrent ? 'bg-white/5' : 'bg-slate-50'}`}>
                                            <div
                                                className={`h-full transition-all duration-1000 ${isCurrent ? 'bg-gold' : 'bg-slate-200'}`}
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

            {activeSection === 'pnpc' && (
                <section className="animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800">PNPC · Consulta</h2>
                            <p className="text-slate-500 font-medium">Consulta de editais e licitações.</p>
                        </div>
                        <a
                            href="https://yellowgreen-cormorant-961745.hostingersite.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-5 py-2.5 bg-navy hover:bg-navy-light text-white font-bold text-sm rounded-xl transition-all shadow shrink-0"
                        >
                            Abrir em nova aba ↗
                        </a>
                    </div>
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden" style={{height: '80vh'}}>
                        <iframe
                            src="https://yellowgreen-cormorant-961745.hostingersite.com/"
                            className="w-full h-full border-0"
                            title="PNPC Consulta"
                        />
                    </div>
                </section>
            )}

            {activeSection === 'licitante' && (
                <section className="animate-in slide-in-from-bottom-4 duration-500">
                    <LicitanteAnalyzer onVerVendas={onVerVendas ?? (() => setActiveSection('sales'))} />
                </section>
            )}

            {activeSection === 'contrato' && (
                <section className="animate-in slide-in-from-bottom-4 duration-500">
                    <ContratoAnalyzer onVerVendas={onVerVendas ?? (() => setActiveSection('sales'))} />
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
                            <Calendar size={18} className="text-gold" />
                            <input type="month" value={leadsMonthSelector} onChange={(e) => setLeadsMonthSelector(e.target.value)} className="bg-transparent border-none focus:ring-0 text-sm font-bold text-slate-700 outline-none" />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                        <div className="table-scroll-x">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-widest border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap">Item de Controle</th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap">Semana 1</th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap">Semana 2</th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap">Semana 3</th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap">Semana 4</th>
                                        <th className="px-4 py-3 align-middle whitespace-nowrap bg-slate-100">Total Mês</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-sm">
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
                                            <tr key={row.label} className={`transition-colors duration-150 hover:bg-slate-50 ${row.isKPI ? 'bg-slate-50/60' : ''}`}>
                                                <td className={`px-4 py-3 align-middle text-sm font-bold ${row.isKPI ? 'text-gold' : 'text-slate-700'}`}>{row.label}</td>
                                                {row.data.map((val, i) => (
                                                    <td key={i} className="px-4 py-3 align-middle">
                                                        {row.isManual ? (
                                                            <input
                                                                type="number"
                                                                value={val}
                                                                onChange={(e) => updateManualCost(`${leadsMonthSelector}_w${i + 1}`, parseFloat(e.target.value) || 0)}
                                                                className="w-24 bg-slate-50 border-slate-200 rounded-xl px-2 py-1 outline-none text-xs focus:ring-1 focus:ring-gold"
                                                            />
                                                        ) : (
                                                            <span className="font-medium text-slate-600">
                                                                {row.isCurrency ? formatCurrency(val) : (row.isPercent ? `${val.toFixed(1)}%` : val)}
                                                            </span>
                                                        )}
                                                    </td>
                                                ))}
                                                <td className="px-4 py-3 align-middle bg-slate-50 text-sm font-bold text-navy tabular-nums whitespace-nowrap">
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
                        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
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
                                                    <div className="h-full bg-navy rounded-full" style={{ width: `${p}%` }} />
                                                </div>
                                            </div>
                                        )
                                    });
                                })()}
                            </div>
                        </div>

                        <div className="bg-navy p-8 rounded-2xl shadow-xl text-white relative overflow-hidden">
                            <h4 className="text-lg font-black text-gold mb-6">Eficiência de Vendas</h4>
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
                                                <circle cx="96" cy="96" r="80" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={2 * Math.PI * 80} strokeDashoffset={2 * Math.PI * 80 * (1 - p / 100)} className="text-gold transition-all duration-1000" />
                                            </svg>
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <span className="text-4xl font-black">{p.toFixed(0)}%</span>
                                                <span className="text-[10px] font-bold uppercase text-slate-400">Conversão</span>
                                            </div>
                                        </div>
                                    )
                                })()}
                            </div>
                            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-gold/10 rounded-full blur-3xl"></div>
                        </div>
                    </div>
                </section>
            )}
        </div>
        {/* Confirmação de exclusão: diz em números o que some junto antes de apagar. */}
        {clienteParaExcluir &&
            createPortal(
                <div className="fixed inset-0 z-[99990] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm border-0 cursor-default"
                        aria-label="Fechar"
                        disabled={excluindoCliente}
                        onClick={() => !excluindoCliente && setClienteParaExcluir(null)}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-in zoom-in-95 duration-200"
                    >
                        <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mb-5">
                            <Trash2 size={20} className="text-rose-600" />
                        </div>
                        <h3 className="text-xl font-black text-slate-800 leading-tight">Excluir {clienteParaExcluir.nome}?</h3>
                        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                            Isso apaga {clienteParaExcluir.salesIds.length === 1 ? 'o registro' : `os ${clienteParaExcluir.salesIds.length} registros`} deste cliente
                            {clienteParaExcluir.vendas > 0 && (
                                <>, incluindo <strong className="text-rose-600">{clienteParaExcluir.vendas} venda{clienteParaExcluir.vendas > 1 ? 's' : ''} fechada{clienteParaExcluir.vendas > 1 ? 's' : ''}</strong>, que {clienteParaExcluir.vendas > 1 ? 'saem' : 'sai'} das metas e dos resultados</>
                            )}.
                            As tarefas do CRM e os boletos vinculados também vão junto. Não dá para desfazer.
                        </p>
                        {saveError && (
                            <p className="mt-4 text-xs font-bold text-rose-600 bg-rose-50 rounded-xl px-4 py-3">{saveError}</p>
                        )}
                        <div className="flex gap-3 mt-7">
                            <button
                                type="button"
                                disabled={excluindoCliente}
                                onClick={() => setClienteParaExcluir(null)}
                                className="flex-1 py-3 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-all disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={excluindoCliente}
                                onClick={handleExcluirCliente}
                                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white bg-rose-600 hover:bg-rose-700 transition-all disabled:opacity-50"
                            >
                                {excluindoCliente ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                                {excluindoCliente ? 'Excluindo…' : 'Excluir'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
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
                        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gold/25 animate-in zoom-in-95 duration-200"
                    >
                        <div className="flex items-start justify-between gap-3 p-6 border-b border-gold/20 bg-navy text-white rounded-t-[2rem]">
                            <div>
                                <h3 id="add-client-modal-title" className="text-lg font-black tracking-tight flex items-center gap-2">
                                    <Briefcase size={22} className="text-gold shrink-0" aria-hidden />
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
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
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
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold transition-all"
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
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gold text-navy font-bold text-sm hover:bg-gold-hover transition-colors disabled:opacity-50 shadow-md"
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
