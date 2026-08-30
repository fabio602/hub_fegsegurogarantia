import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from './Toast.tsx';
import { createPortal } from 'react-dom';
import {
    Plus, Download, Edit2, Trash2, Calendar, Search,
    Loader2, Save, X, AlertCircle, CheckCircle2, Clock, Home, Copy, ExternalLink, FileText, Mail
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getPublicResidentialFormPath, getPublicResidentialFormUrl } from '../utils/publicUrls';
import { FeatureTip } from './FeatureTip.tsx';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';
import { useAutoSave } from '../hooks/useAutoSave.ts';
import SaveIndicator from './SaveIndicator.tsx';

interface ResidentialClient {
    id: number;
    nome: string;
    cpf: string;
    telefone: string;
    telefone_2?: string | null;
    email: string;
    produto: string;
    apolice: string;
    premio_total: string;
    comissao: string;
    data_emissao: string;
    fim_vigencia: string;
    forma_pagamento: string;
    situacao: string;
    obs: string;
    estado_civil?: string | null;
    cep_imovel?: string | null;
    numero_imovel?: string | null;
    tipo_imovel?: string | null;
    valor_imovel?: string | null;
    valor_aluguel?: string | null;
    data_primeiro_pag_aluguel?: string | null;
    valor_iptu_condominio?: string | null;
    tem_garantia: string;
    garantia_inicio?: string;
    garantia_fim?: string;
    garantia_valor?: string;
    apolice_garantia_url?: string | null;
    contrato_locacao_url?: string | null;
    created_at?: string;
    /** true = formulário público (RLS anon); legado: obs com marcador */
    origem_publica?: boolean | null;
    /** Nome da imobiliária parceira que enviou a solicitação */
    parceiro_nome?: string | null;
    nao_renovar?: boolean | null;
}

const EMPTY_FORM: Partial<ResidentialClient> = {
    nome: '', cpf: '', telefone: '', telefone_2: '', email: '',
    produto: '', apolice: '', premio_total: '',
    comissao: '', data_emissao: '', fim_vigencia: '',
    forma_pagamento: '', situacao: 'Ativo', obs: '',
    estado_civil: '', cep_imovel: '', numero_imovel: '', tipo_imovel: '',
    valor_imovel: '', valor_aluguel: '', data_primeiro_pag_aluguel: '', valor_iptu_condominio: '',
    tem_garantia: 'Não', garantia_inicio: '', garantia_fim: '', garantia_valor: '',
    origem_publica: false,
};

const ESTADO_CIVIL_OPTS = ['Casado(a)', 'Solteiro(a)', 'Separado(a)', 'Viúvo(a)'] as const;
const TIPO_IMOVEL_OPTS = ['Casa', 'Apartamento', 'Casa em condomínio', 'Comercial'] as const;

const ORIGEM_PUBLIC = '[origem:formulario-publico]';

/** Preenche campos a partir de leads antigos que tinham tudo em `obs`. */
function parseStructuredObs(obs: string | null | undefined): Partial<Pick<ResidentialClient,
    'telefone_2' | 'estado_civil' | 'cep_imovel' | 'numero_imovel' | 'tipo_imovel' | 'valor_imovel' | 'valor_aluguel' | 'data_primeiro_pag_aluguel' | 'valor_iptu_condominio'
>> {
    if (!obs?.includes(ORIGEM_PUBLIC)) return {};
    const line = (prefix: string): string => {
        const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${esc}:\\s*(.+)$`, 'm');
        const m = obs.match(re);
        if (!m) return '';
        const v = m[1].trim();
        return v === '—' ? '' : v;
    };
    return {
        telefone_2: line('Telefone / Celular 2'),
        estado_civil: line('Estado civil'),
        cep_imovel: line('CEP do imóvel'),
        numero_imovel: line('Número do imóvel'),
        tipo_imovel: line('Tipo de imóvel'),
        valor_imovel: line('Valor do imóvel'),
        valor_aluguel: line('Valor do aluguel'),
        data_primeiro_pag_aluguel: line('Data do 1º pagamento do aluguel'),
        valor_iptu_condominio: line('Valor IPTU e/ou condomínio'),
    };
}

function pickDbOrParsed(db: string | null | undefined, fromObs: string | undefined): string {
    if (db != null && String(db).trim() !== '') return String(db);
    return (fromObs ?? '').trim();
}

function formatEntrada(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PRODUTOS = [
    'Apenas Garantia Locatícia',
    'Apenas Seguro Residencial',
    'Garantia Locatícia & Seguro Residencial',
    'Residencial',
    'Locatícia',
    'Residencial + Locatícia',
    'Condomínio',
];
const FORMAS_PAGAMENTO = ['Boleto Mensal', 'Boleto Anual', 'Cartão de Crédito', 'Débito Automático', 'PIX'];
const SITUACOES = ['Lead (site)', 'Ativo', 'Vencido', 'Cancelado', 'Saiu do Imóvel', 'Optou Não Contratar', 'Desistiu da Locação', 'Pendente Renovação', 'Em Renovação', 'Reprovado'];

// Funções de Máscara e Formatação
const formatCPF = (value: string) => {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
};

const formatPhone = (value: string) => {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{4})\d+?$/, '$1');
};

const formatCEP = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 8);
    return d.replace(/(\d{5})(\d)/, '$1-$2');
};

const formatCurrency = (value: string) => {
    const numericValue = value.replace(/\D/g, '');
    if (!numericValue) return '';
    const formatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(Number(numericValue) / 100);
    return formatted;
};

interface ResidentialInsuranceProps {
    /** Cliente vindo do Repasse Imobiliárias pelo botão "→ Registro de Venda". */
    prefill?: { nome: string; telefone: string } | null;
    /** Avisa o App que o prefill já foi aplicado, para não reabrir o modal. */
    onPrefillConsumed?: () => void;
}

const ResidentialInsurance: React.FC<ResidentialInsuranceProps> = ({ prefill, onPrefillConsumed }) => {
    const { toast, confirm: confirmDialog } = useToast();
    const [clients, setClients] = useState<ResidentialClient[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showModal, setShowModal] = useState(false);
    const formRef = useRef<HTMLDivElement>(null);
    const [formData, setFormData] = useState<Partial<ResidentialClient>>(EMPTY_FORM);
    const [search, setSearch] = useState('');
    const [filterProduto, setFilterProduto] = useState('');
    const [filterSituacao, setFilterSituacao] = useState('');
    const [imobParceiros, setImobParceiros] = useState<string[]>([]);
    const [uploadingApolice, setUploadingApolice] = useState(false);
    const [uploadingGarantiaDoc, setUploadingGarantiaDoc] = useState<string | null>(null);


    const [resBoletos, setResBoletos] = useState<{id: number; parcela: number; vencimento: string|null; valor: number|null; url: string; pago: boolean}[]>([]);
    const [resBoletoForm, setResBoletoForm] = useState<{parcela: string; vencimento: string; valor: string; file: File|null}>({parcela: '', vencimento: '', valor: '', file: null});
    const [resBoletoAdding, setResBoletoAdding] = useState(false);
    const [sendingResBoletoEmail, setSendingResBoletoEmail] = useState<number|null>(null);
    const [resBoletoEmailSent, setResBoletoEmailSent] = useState<Set<number>>(new Set());

    const handleGarantiaDocUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'apolice_garantia_url' | 'contrato_locacao_url') => {
        const file = e.target.files?.[0];
        if (!file || !editingId) return;
        setUploadingGarantiaDoc(field);
        try {
            const label = field === 'apolice_garantia_url' ? 'apolice-garantia' : 'contrato-locacao';
            const path = `garantia-docs/${editingId}/${label}_${Date.now()}.pdf`;
            await supabase.storage.from('imobiliaria-docs').upload(path, file, { contentType: 'application/pdf', upsert: true });
            const { data: urlData } = supabase.storage.from('imobiliaria-docs').getPublicUrl(path);
            const url = urlData.publicUrl;
            await supabase.from('residential_clients').update({ [field]: url }).eq('id', editingId);
            setFormData(prev => ({ ...prev, [field]: url }));
            toast('Documento enviado com sucesso!', 'success');
        } catch (err: any) { toast('Erro ao enviar: ' + err.message, 'error'); }
        finally { setUploadingGarantiaDoc(null); e.target.value = ''; }
    };
    useEffect(() => {
        supabase.from('partners').select('name').eq('partner_type', 'imobiliaria').order('name')
            .then(({ data }) => setImobParceiros((data || []).map((p: any) => p.name)));
    }, []);

    const handleApoliceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editingId) return;
        setUploadingApolice(true);
        try {
            const path = `apolices/residencial/${editingId}_${Date.now()}.pdf`;
            await supabase.storage.from('imobiliaria-docs').upload(path, file, { contentType: 'application/pdf', upsert: true });
            const { data: urlData } = supabase.storage.from('imobiliaria-docs').getPublicUrl(path);
            const url = urlData.publicUrl;
            // Save to residential_clients
            await supabase.from('residential_clients').update({ apolice_url: url }).eq('id', editingId);
            // Sync to imobiliaria_clientes if client has a partner
            if (formData.parceiro_nome && formData.nome) {
                const syncPayload = { apolice_residencial_url: url, status_residencial: 'emitido', kanban_status: 'aprovado', numero_apolice: formData.apolice || undefined };
                // Tenta por apólice primeiro; fallback por nome do inquilino
                if (formData.apolice) {
                    const { data: byApolice } = await supabase.from('imobiliaria_clientes')
                        .update(syncPayload)
                        .eq('numero_apolice', formData.apolice)
                        .select('id');
                    if (!byApolice?.length) {
                        await supabase.from('imobiliaria_clientes')
                            .update(syncPayload)
                            .ilike('inquilino_nome', formData.nome.trim());
                    }
                } else {
                    await supabase.from('imobiliaria_clientes')
                        .update(syncPayload)
                        .ilike('inquilino_nome', formData.nome.trim());
                }
            }
            setFormData(prev => ({ ...prev, apolice_url: url } as any));
            toast('PDF da apólice enviado com sucesso!', 'success');
        } catch (err: any) { toast('Erro ao enviar PDF: ' + err.message, 'error'); }
        finally { setUploadingApolice(false); e.target.value = ''; }
    };
    const [filterPagamento, setFilterPagamento] = useState('');
    const [filterGarantia, setFilterGarantia] = useState('');
    const [filterClienteId, setFilterClienteId] = useState('');
    const [sortBy, setSortBy] = useState<'entrada' | 'vigencia' | 'nome'>('entrada');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // Batch selection state
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [batchMode, setBatchMode] = useState(false);

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const selectAll = (ids: number[]) => setSelectedIds(new Set(ids));
    const clearSelection = () => { setSelectedIds(new Set()); setBatchMode(false); };

    const batchChangeSituacao = async (situacao: string) => {
        if (selectedIds.size === 0) return;
        const confirmed = await confirmDialog(`Alterar situação de ${selectedIds.size} cliente(s) para "${situacao}"?`);
        if (!confirmed) return;
        await supabase.from('residential_clients')
            .update({ situacao })
            .in('id', [...selectedIds]);
        toast(`${selectedIds.size} cliente(s) atualizados`, 'success');
        clearSelection();
        fetchClients();
    };
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [publicFormCopied, setPublicFormCopied] = useState(false);

    const tableScrollRef = useRef<HTMLDivElement>(null);
    const topScrollRef = useRef<HTMLDivElement>(null);
    const topScrollInnerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const table = tableScrollRef.current;
        const top = topScrollRef.current;
        const inner = topScrollInnerRef.current;
        if (!table || !top || !inner) return;

        const syncWidth = () => {
            inner.style.width = table.scrollWidth + 'px';
        };
        syncWidth();
        const ro = new ResizeObserver(syncWidth);
        ro.observe(table);

        const onTableScroll = () => { top.scrollLeft = table.scrollLeft; };
        const onTopScroll = () => { table.scrollLeft = top.scrollLeft; };
        table.addEventListener('scroll', onTableScroll);
        top.addEventListener('scroll', onTopScroll);
        return () => {
            table.removeEventListener('scroll', onTableScroll);
            top.removeEventListener('scroll', onTopScroll);
            ro.disconnect();
        };
    }, []);

    const copyPublicFormUrl = () => {
        const url = getPublicResidentialFormUrl();
        if (!url) return;
        void navigator.clipboard.writeText(url);
        setPublicFormCopied(true);
        window.setTimeout(() => setPublicFormCopied(false), 2000);
    };

    /**
     * O spinner de tela cheia só pode aparecer na primeira carga.
     *
     * Esta função também é chamada ao fim de cada salvamento automático, e o
     * `loading` troca a tela inteira por "Carregando Base..." (ver abaixo).
     * Enquanto a pessoa preenchia uma data, o formulário era desmontado no meio
     * da digitação e o campo voltava vazio — e num `<input type="date">` vazio o
     * Chrome preenche os pedaços que faltam com a data de hoje. Era esse o bug
     * do "altero a vigência e ela volta para hoje".
     */
    const jaCarregouRef = useRef(false);

    const fetchClients = useCallback(async () => {
        if (!jaCarregouRef.current) setLoading(true);
        const { data, error } = await supabase
            .from('residential_clients')
            .select('*')
            .order('id', { ascending: false });
        if (error) console.error('Erro ao buscar clientes:', error);
        setClients(data || []);
        jaCarregouRef.current = true;
        setLoading(false);
    }, []);

    useEffect(() => { fetchClients(); }, [fetchClients]);

    const fetchResBoletos = useCallback(async (clientId: number) => {
        const { data } = await supabase.from('residential_boletos').select('*').eq('residential_client_id', clientId).order('parcela');
        setResBoletos(data || []);
    }, []);

    useEffect(() => { if (editingId) fetchResBoletos(editingId); else setResBoletos([]); }, [editingId, fetchResBoletos]);

    const gravarClienteEmEdicao = useCallback(async (dados: typeof formData) => {
        if (!editingId) return;
        const formData = dados;
        const payload = {
            nome: formData.nome || null,
            cpf: formData.cpf || null,
            telefone: formData.telefone || null,
            telefone_2: formData.telefone_2?.trim() || null,
            email: formData.email || null,
            produto: formData.produto || null,
            apolice: formData.apolice || null,
            premio_total: formData.premio_total || null,
            comissao: formData.comissao || null,
            data_emissao: formData.data_emissao || null,
            fim_vigencia: formData.fim_vigencia || null,
            forma_pagamento: formData.forma_pagamento || null,
            situacao: formData.situacao || null,
            obs: formData.obs || null,
            estado_civil: formData.estado_civil?.trim() || null,
            cep_imovel: formData.cep_imovel?.trim() || null,
            numero_imovel: formData.numero_imovel?.trim() || null,
            tipo_imovel: formData.tipo_imovel?.trim() || null,
            valor_imovel: formData.valor_imovel?.trim() || null,
            valor_aluguel: formData.valor_aluguel?.trim() || null,
            data_primeiro_pag_aluguel: formData.data_primeiro_pag_aluguel?.trim() || null,
            valor_iptu_condominio: formData.valor_iptu_condominio?.trim() || null,
            tem_garantia: formData.tem_garantia || 'Não',
            garantia_inicio: formData.tem_garantia === 'Sim' ? (formData.garantia_inicio || null) : null,
            garantia_fim: formData.tem_garantia === 'Sim' ? (formData.garantia_fim || null) : null,
            garantia_valor: formData.tem_garantia === 'Sim' ? (formData.garantia_valor || null) : null,
            apolice_garantia_url: (formData as any).apolice_garantia_url || null,
            contrato_locacao_url: (formData as any).contrato_locacao_url || null,
            origem_publica: !!formData.origem_publica,
            parceiro_nome: formData.parceiro_nome?.trim() || null,
            apolice_url: (formData as any).apolice_url || null,
        };
        const { error } = await supabase.from('residential_clients').update(payload).eq('id', editingId);
        if (error) throw error;
        fetchClients();
    }, [editingId, fetchClients]);

    const {
        estado: autoSaveState,
        salvarAgora: salvarClienteAgora,
        descartarRascunho,
    } = useAutoSave({
        dados: formData,
        ativo: !!editingId,
        identidade: editingId,
        salvar: gravarClienteEmEdicao,
    });

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        let { id, value } = e.target;

        // Aplicar máscaras
        if (id === 'cpf') value = formatCPF(value);
        if (id === 'telefone' || id === 'telefone_2') value = formatPhone(value);
        if (id === 'cep_imovel') value = formatCEP(value);
        if (id === 'premio_total' || id === 'comissao' || id === 'garantia_valor'
            || id === 'valor_imovel' || id === 'valor_aluguel' || id === 'valor_iptu_condominio') {
            value = formatCurrency(value);
        }

        // A1: Auto-fill fim_vigencia = data_emissao + 1 ano (último dia antes do aniversário)
        if (id === 'data_emissao' && value) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) {
                d.setFullYear(d.getFullYear() + 1);
                d.setDate(d.getDate() - 1);
                const fim = d.toISOString().slice(0, 10);
                setFormData(prev => ({ ...prev, data_emissao: value, fim_vigencia: fim }));
                return;
            }
        }

        // A2: Auto-fill comissao = 30% do prêmio total
        if (id === 'premio_total') {
            const numericStr = value.replace(/[^\d,]/g, '').replace(',', '.');
            const numeric = parseFloat(numericStr) || 0;
            const comissao = numeric > 0
                ? (numeric * 0.30).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : '';
            setFormData(prev => ({ ...prev, premio_total: value, comissao }));
            return;
        }

        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleAddResBoleto = async () => {
        if (!editingId || !resBoletoForm.parcela || !resBoletoForm.file) return;
        setResBoletoAdding(true);
        try {
            const file = resBoletoForm.file;
            const ext = file.name.split('.').pop() || 'pdf';
            const path = `residential-clients/${editingId}/boletos/parcela-${resBoletoForm.parcela}.${ext}`;
            await supabase.storage.from('sales-documents').upload(path, file, { contentType: 'application/pdf', upsert: true });
            const { data: { publicUrl } } = supabase.storage.from('sales-documents').getPublicUrl(path);

            const existing = resBoletos.find(b => b.parcela === parseInt(resBoletoForm.parcela));
            if (existing) {
                await supabase.from('residential_boletos').update({ url: publicUrl, vencimento: resBoletoForm.vencimento || null, valor: resBoletoForm.valor ? parseFloat(resBoletoForm.valor.replace(/\D/g, '')) / 100 : null }).eq('id', existing.id);
            } else {
                await supabase.from('residential_boletos').insert({ residential_client_id: editingId, parcela: parseInt(resBoletoForm.parcela), vencimento: resBoletoForm.vencimento || null, valor: resBoletoForm.valor ? parseFloat(resBoletoForm.valor.replace(/\D/g, '')) / 100 : null, url: publicUrl });
            }
            await fetchResBoletos(editingId);
            setResBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
        } catch (err) {
            alert('Erro ao adicionar boleto. Tente novamente.');
        } finally {
            setResBoletoAdding(false);
        }
    };

    const handleToggleResPago = async (id: number, pago: boolean) => {
        await supabase.from('residential_boletos').update({ pago: !pago }).eq('id', id);
        if (editingId) fetchResBoletos(editingId);
    };

    const handleDeleteResBoleto = async (id: number) => {
        if (!window.confirm('Excluir este boleto?')) return;
        await supabase.from('residential_boletos').delete().eq('id', id);
        if (editingId) fetchResBoletos(editingId);
    };

    const handleSendResBoletoEmail = async (b: {id: number; parcela: number; vencimento: string|null; url: string}) => {
        if (!formData.email) {
            alert('Este cliente não tem e-mail cadastrado.');
            return;
        }
        setSendingResBoletoEmail(b.id);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const supabaseUrl = (supabase as any).supabaseUrl as string;
            const supabaseKey = (supabase as any).supabaseKey as string;
            await fetch(`${supabaseUrl}/functions/v1/send-boleto-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
                body: JSON.stringify({ toEmail: formData.email, toName: formData.nome, toContato: (formData as any).decisor || undefined, parcela: b.parcela, vencimento: b.vencimento, boletoUrl: b.url, tipoProduto: 'Seguro Residencial' }),
            });
            setResBoletoEmailSent(prev => new Set([...prev, b.id]));
        } catch {
            alert('Erro ao enviar e-mail.');
        } finally {
            setSendingResBoletoEmail(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        // A3: Verificar duplicata por CPF ou nome (somente para novos clientes)
        if (!editingId && formData.cpf) {
            const cpfClean = (formData.cpf || '').replace(/\D/g, '');
            const dupCheck = clients.find(c =>
                c.id !== editingId &&
                (c.cpf?.replace(/\D/g, '') === cpfClean ||
                 c.nome?.toLowerCase().trim() === formData.nome?.toLowerCase().trim())
            );
            if (dupCheck) {
                const proceed = await confirmDialog(
                    `Já existe um cliente com este CPF ou nome: "${dupCheck.nome}". Deseja continuar mesmo assim?`
                );
                if (!proceed) { setSaving(false); return; }
            }
        }

        const payload = {
            nome: formData.nome || null,
            cpf: formData.cpf || null,
            telefone: formData.telefone || null,
            telefone_2: formData.telefone_2?.trim() || null,
            email: formData.email || null,
            produto: formData.produto || null,
            apolice: formData.apolice || null,
            premio_total: formData.premio_total || null,
            comissao: formData.comissao || null,
            data_emissao: formData.data_emissao || null,
            fim_vigencia: formData.fim_vigencia || null,
            forma_pagamento: formData.forma_pagamento || null,
            situacao: formData.situacao || null,
            obs: formData.obs || null,
            estado_civil: formData.estado_civil?.trim() || null,
            cep_imovel: formData.cep_imovel?.trim() || null,
            numero_imovel: formData.numero_imovel?.trim() || null,
            tipo_imovel: formData.tipo_imovel?.trim() || null,
            valor_imovel: formData.valor_imovel?.trim() || null,
            valor_aluguel: formData.valor_aluguel?.trim() || null,
            data_primeiro_pag_aluguel: formData.data_primeiro_pag_aluguel?.trim() || null,
            valor_iptu_condominio: formData.valor_iptu_condominio?.trim() || null,
            tem_garantia: formData.tem_garantia || 'Não',
            garantia_inicio: formData.tem_garantia === 'Sim' ? (formData.garantia_inicio || null) : null,
            garantia_fim: formData.tem_garantia === 'Sim' ? (formData.garantia_fim || null) : null,
            garantia_valor: formData.tem_garantia === 'Sim' ? (formData.garantia_valor || null) : null,
            apolice_garantia_url: (formData as any).apolice_garantia_url || null,
            contrato_locacao_url: (formData as any).contrato_locacao_url || null,
            origem_publica: !!formData.origem_publica,
            parceiro_nome: formData.parceiro_nome?.trim() || null,
            apolice_url: (formData as any).apolice_url || null,
        };

        // Situações que encerram o fluxo → kanban_status = 'recusado' no portal
        const SITUACOES_RECUSADAS = ['Desistiu da Locação', 'Optou Não Contratar', 'Cancelado', 'Reprovado', 'Saiu do Imóvel'];

        // Mapeamento hub situacao → portal status_apolice
        const SITUACAO_MAP: Record<string, string> = {
            'Ativo':               'ativo',
            'Vencido':             'vencido',
            'Cancelado':           'cancelado',
            'Reprovado':           'reprovado',
            'Saiu do Imóvel':      'saiu_imovel',
            'Desistiu da Locação': 'desistiu',
            'Optou Não Contratar': 'desistiu',
            'Pendente Renovação':  'pendente_renovacao',
            'Em Renovação':        'em_renovacao',
        };

        try {
            if (editingId) {
                const { error } = await supabase.from('residential_clients').update(payload).eq('id', editingId);
                if (error) throw error;

                // ── Sync imobiliaria_clientes: a tag é a fonte de verdade ──
                // Encontra o registro correspondente por apólice ou nome
                const findQuery = payload.apolice
                    ? supabase.from('imobiliaria_clientes').select('id').eq('numero_apolice', payload.apolice).maybeSingle()
                    : supabase.from('imobiliaria_clientes').select('id').ilike('inquilino_nome', payload.nome ?? '').maybeSingle();
                const { data: imobCliente } = await findQuery;

                if (imobCliente) {
                    if (payload.parceiro_nome) {
                        // Busca partner_id pelo nome da imobiliária
                        const { data: partner } = await supabase.from('partners').select('id').eq('name', payload.parceiro_nome).maybeSingle();
                        if (partner) {
                            const imobUpdate: Record<string, unknown> = { partner_id: partner.id };
                            // Sempre sincroniza vigência e apólice
                            if (payload.fim_vigencia) imobUpdate.vigencia_fim = payload.fim_vigencia;
                            if (payload.apolice) imobUpdate.numero_apolice = payload.apolice;
                            // Situação → status no portal (mapeamento completo)
                            const statusPortal = SITUACAO_MAP[payload.situacao ?? ''];
                            if (statusPortal) imobUpdate.status_apolice = statusPortal;
                            if (SITUACOES_RECUSADAS.includes(payload.situacao ?? '')) {
                                imobUpdate.kanban_status = 'recusado';
                                imobUpdate.status = 'cancelado';
                            } else if (payload.situacao === 'Ativo') {
                                imobUpdate.status = 'ativo';
                                imobUpdate.status_residencial = payload.apolice ? 'emitido' : 'aprovado';
                            }
                            await supabase.from('imobiliaria_clientes').update(imobUpdate).eq('id', imobCliente.id);
                        }
                    } else {
                        // Tag removida → desvincula do portal (partner_id = null)
                        await supabase.from('imobiliaria_clientes').update({ partner_id: null }).eq('id', imobCliente.id);
                    }
                }
            } else {
                const { error } = await supabase.from('residential_clients').insert([payload]);
                if (error) throw error;
            }
            await fetchClients();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
            resetForm();
        } catch (error: any) {
            setSaveError(error?.message || 'Erro ao salvar. Tente novamente.');
        } finally {
            setSaving(false);
        }
    };

    const resetForm = () => {
        descartarRascunho();
        setEditingId(null);
        setFormData(EMPTY_FORM);
        setShowModal(false);
        setResBoletos([]);
        setResBoletoForm({ parcela: '', vencimento: '', valor: '', file: null });
        setResBoletoEmailSent(new Set());
    };

    const handleEdit = (client: ResidentialClient) => {
        setEditingId(client.id);
        const fromObs = parseStructuredObs(client.obs);
        setFormData({
            ...client,
            origem_publica: client.origem_publica === true || (client.obs || '').includes(ORIGEM_PUBLIC),
            telefone_2: pickDbOrParsed(client.telefone_2, fromObs.telefone_2),
            estado_civil: pickDbOrParsed(client.estado_civil, fromObs.estado_civil),
            cep_imovel: pickDbOrParsed(client.cep_imovel, fromObs.cep_imovel),
            numero_imovel: pickDbOrParsed(client.numero_imovel, fromObs.numero_imovel),
            tipo_imovel: pickDbOrParsed(client.tipo_imovel, fromObs.tipo_imovel),
            valor_imovel: pickDbOrParsed(client.valor_imovel, fromObs.valor_imovel),
            valor_aluguel: pickDbOrParsed(client.valor_aluguel, fromObs.valor_aluguel),
            data_primeiro_pag_aluguel: pickDbOrParsed(client.data_primeiro_pag_aluguel, fromObs.data_primeiro_pag_aluguel),
            valor_iptu_condominio: pickDbOrParsed(client.valor_iptu_condominio, fromObs.valor_iptu_condominio),
        });
        setShowModal(true);
        setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' }), 50);
    };

    /**
     * Abre o cadastro quando o usuário chega pelo botão "→ Registro de Venda"
     * do Repasse Imobiliárias.
     *
     * Antes de abrir um cadastro novo, procura o cliente pelo nome usando a
     * mesma busca do sync do Repasse (ilike). Sem isso, quem já foi
     * sincronizado quando a apólice foi emitida ganharia um registro
     * duplicado a cada clique no botão.
     */
    useEffect(() => {
        if (!prefill?.nome) return;
        let cancelado = false;

        (async () => {
            const { data, error } = await supabase
                .from('residential_clients')
                .select('*')
                .ilike('nome', prefill.nome.trim())
                .limit(1);

            if (cancelado) return;

            if (error) {
                console.error('[prefill] falha ao procurar cliente existente:', error);
            }

            if (data && data.length > 0) {
                handleEdit(data[0] as ResidentialClient);
            } else {
                setEditingId(null);
                setFormData({
                    ...EMPTY_FORM,
                    nome: prefill.nome,
                    telefone: prefill.telefone || '',
                    produto: 'Residencial',
                });
                setShowModal(true);
                setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' }), 50);
            }

            onPrefillConsumed?.();
        })();

        return () => { cancelado = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill?.nome, prefill?.telefone]);

    const handleDelete = async (id: number) => {
        if (!(await confirmDialog('Deseja excluir este cliente? Esta ação não pode ser desfeita.'))) return;
        // Busca o cliente antes de deletar para saber o nome e desvinculá-lo do portal
        const clientToDelete = clients.find(c => c.id === id);
        await supabase.from('residential_clients').delete().eq('id', id);
        // Remove do portal da imobiliária (partner_id = null)
        if (clientToDelete?.nome) {
            await supabase.from('imobiliaria_clientes')
                .update({ partner_id: null })
                .ilike('inquilino_nome', clientToDelete.nome.trim());
        }
        fetchClients();
    };

    const handleNaoRenovar = async (id: number) => {
        if (!(await confirmDialog('Marcar este cliente como "Não irá renovar"? Ele sairá do alerta de vencimento.'))) return;
        await supabase.from('residential_clients').update({ nao_renovar: true }).eq('id', id);
        fetchClients();
    };

    const getExpiringAlerts = () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
        return clients.filter(c => {
            if (!c.fim_vigencia) return false;
            if (c.nao_renovar) return false;
            const fim = new Date(c.fim_vigencia);
            return fim >= today && fim <= in30 && c.situacao === 'Ativo';
        }).sort((a, b) => new Date(a.fim_vigencia).getTime() - new Date(b.fim_vigencia).getTime());
    };

    const exportCSV = () => {
        if (filtered.length === 0) return;
        const headers = ['Nome', 'CPF', 'Telefone', 'Email', 'Produto', 'Apólice', 'Prêmio Total', 'Comissão', 'Emissão', 'Fim Vigência', 'Pagamento', 'Situação', 'Garantia'];
        const rows = filtered.map(c => [
            `"${c.nome}"`, c.cpf, c.telefone, c.email,
            c.produto, c.apolice, c.premio_total, c.comissao,
            c.data_emissao, c.fim_vigencia, c.forma_pagamento,
            c.situacao, c.tem_garantia
        ].join(','));
        const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = 'Clientes_Residencial.csv'; a.click();
    };

    const clienteFilterOptions = useMemo(
        () => [...clients].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')),
        [clients],
    );

    const filtered = clients
        .filter(c => {
            const q = search.toLowerCase();
            const qDigits = search.replace(/\D/g, '');
            const cepDigits = (c.cep_imovel || '').replace(/\D/g, '');
            const cepMatch = qDigits.length > 0 && cepDigits.includes(qDigits);
            return (
                c.nome?.toLowerCase().includes(q) ||
                c.cpf?.includes(search) ||
                c.apolice?.includes(search) ||
                (c.telefone_2 && c.telefone_2.includes(search)) ||
                cepMatch
            );
        })
        .filter(c => !filterClienteId || String(c.id) === filterClienteId)
        .filter(c => !filterProduto || c.produto === filterProduto)
        .filter(c => !filterSituacao || c.situacao === filterSituacao)
        .filter(c => !filterPagamento || c.forma_pagamento === filterPagamento)
        .filter(c => !filterGarantia || c.tem_garantia === filterGarantia)
        .sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            if (sortBy === 'nome') {
                return mul * (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
            }
            if (sortBy === 'vigencia') {
                const da = new Date(a.fim_vigencia || 0).getTime();
                const db = new Date(b.fim_vigencia || 0).getTime();
                const na = Number.isNaN(da) ? 0 : da;
                const nb = Number.isNaN(db) ? 0 : db;
                return mul * (na - nb);
            }
            const da = new Date(a.created_at || 0).getTime();
            const db = new Date(b.created_at || 0).getTime();
            return mul * (da - db);
        });

    const hasTableFilters = !!(
        filterClienteId ||
        filterProduto ||
        filterSituacao ||
        filterPagamento ||
        filterGarantia
    );

    const expiringAlerts = getExpiringAlerts();

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 size={40} className="animate-spin mb-4 text-gold" />
                <p className="font-bold uppercase tracking-widest text-xs">Carregando Base...</p>
            </div>
        );
    }

    const isPublicLead = (c: ResidentialClient) =>
        c.origem_publica === true || (c.obs || '').includes(ORIGEM_PUBLIC);

    const isNovoLead = (c: ResidentialClient) => c.situacao === 'Lead (site)';

    const situacaoColor = (s: string) => {
        if (s === 'Lead (site)') return 'bg-gold/15 text-navy border border-gold/40';
        if (s === 'Ativo') return 'bg-emerald-50 text-emerald-600';
        if (s === 'Vencido') return 'bg-red-50 text-red-600';
        if (s === 'Cancelado') return 'bg-slate-100 text-slate-500';
        if (s === 'Saiu do Imóvel') return 'bg-orange-50 text-orange-600';
        if (s === 'Optou Não Contratar') return 'bg-slate-100 text-slate-500';
        if (s === 'Desistiu da Locação') return 'bg-slate-100 text-slate-500';
        if (s === 'Reprovado') return 'bg-red-100 text-red-700';
        return 'bg-blue-50 text-blue-600';
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-[1600px] mx-auto">

            {/* Expiry Alert */}
            {expiringAlerts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                            <AlertCircle size={18} className="text-amber-600" />
                        </div>
                        <div>
                            <p className="font-black text-amber-800 text-sm">⚠️ {expiringAlerts.length} apólice{expiringAlerts.length > 1 ? 's vencem' : ' vence'} nos próximos 30 dias</p>
                            <p className="text-amber-600 text-xs font-medium">Acione o cliente para renovação</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {expiringAlerts.map(c => {
                            const fim = new Date(c.fim_vigencia);
                            const today = new Date(); today.setHours(0, 0, 0, 0);
                            const daysLeft = Math.ceil((fim.getTime() - today.getTime()) / 86400000);
                            return (
                                <div key={c.id} className="flex justify-between items-center bg-white rounded-xl px-4 py-3 border border-amber-100 gap-4">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-slate-800 text-sm truncate">{c.nome}</p>
                                        <p className="text-xs text-slate-500">{c.produto} • {c.apolice}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-black text-amber-600 text-sm">{daysLeft} dia{daysLeft !== 1 ? 's' : ''}</p>
                                        <p className="text-xs text-slate-400">Vence {fim.toLocaleDateString('pt-BR')}</p>
                                    </div>
                                    <button onClick={() => handleEdit(c)} className="shrink-0 flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 font-black text-xs px-3 py-2 rounded-lg transition-all">
                                        <Edit2 size={13} /> Editar
                                    </button>
                                    <button onClick={() => handleNaoRenovar(c.id)} className="shrink-0 flex items-center gap-1.5 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 font-black text-xs px-3 py-2 rounded-lg transition-all">
                                        ✕ Não renovar
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">Seguro Residencial / Locatícia</h2>
                    <p className="text-slate-500 font-medium">Base de clientes e apólices residenciais.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:flex-none min-w-0">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text" placeholder="Buscar nome, CPF, apólice, CEP..."
                            value={search} onChange={e => setSearch(e.target.value)}
                            className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full md:w-64 focus:ring-2 focus:ring-gold/20"
                        />
                    </div>
                    {hasTableFilters && (
                        <button
                            type="button"
                            onClick={() => {
                                setFilterClienteId('');
                                setFilterProduto('');
                                setFilterSituacao('');
                                setFilterPagamento('');
                                setFilterGarantia('');
                            }}
                            className="shrink-0 bg-white text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all whitespace-nowrap"
                        >
                            Limpar filtros
                        </button>
                    )}
                    <button onClick={exportCSV} className="shrink-0 bg-white text-slate-700 px-4 py-2.5 rounded-xl font-bold text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2">
                        <Download size={16} /> Exportar
                    </button>
                </div>
            </div>

            <div className="bg-navy/[0.04] border border-gold/25 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black text-gold uppercase tracking-widest">Link para o cliente (site público)</p>
                    <p className="text-xs text-slate-600 truncate font-mono mt-1" title={getPublicResidentialFormUrl()}>{getPublicResidentialFormUrl()}</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <a
                        href={getPublicResidentialFormPath()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-navy text-white px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-navy-light transition-all"
                    >
                        <ExternalLink size={14} /> Abrir
                    </a>
                    <button
                        type="button"
                        onClick={copyPublicFormUrl}
                        className="inline-flex items-center gap-2 bg-white text-navy px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-200 hover:border-gold/40 transition-all"
                    >
                        <Copy size={14} /> {publicFormCopied ? 'Copiado!' : 'Copiar'}
                    </button>
                </div>
            </div>

            {/* Form */}
            <div ref={formRef} className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                        <div className="w-1.5 h-6 bg-gold rounded-full"></div>
                        {editingId ? 'Editar Cliente' : 'Novo Cliente'}
                    </h3>
                    {editingId && (
                        <SaveIndicator estado={autoSaveState} aoTentarNovamente={salvarClienteAgora} />
                    )}
                </div>

                {editingId && (formData.created_at || formData.origem_publica) && (
                    <div className="mb-6 flex flex-wrap gap-3 items-center text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-navy">
                            <Calendar size={14} className="text-gold" />
                            Entrada no sistema:
                            <span className="font-black text-slate-800">{formatEntrada(formData.created_at)}</span>
                        </span>
                        {formData.origem_publica && (
                            <span className="text-[10px] font-black uppercase tracking-wider bg-navy text-gold px-2 py-1 rounded-md">
                                Formulário do site
                            </span>
                        )}
                    </div>
                )}

                {saveError && (
                    <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-600 px-5 py-4 rounded-xl text-sm font-bold">
                        <AlertCircle size={18} />{saveError}
                    </div>
                )}
                {saveSuccess && (
                    <div className="mb-6 flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-600 px-5 py-4 rounded-xl text-sm font-bold">
                        <CheckCircle2 size={18} />Cliente salvo com sucesso!
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-8">
                    {/* Block 1: Client Data */}
                    <div>
                        <p className="text-[10px] font-black text-gold uppercase tracking-widest mb-4">Dados do Cliente</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            {[
                                { id: 'nome', label: 'Nome do Cliente', placeholder: 'Nome completo', required: true },
                                { id: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
                                { id: 'telefone', label: 'Telefone', placeholder: '(00) 00000-0000' },
                                { id: 'telefone_2', label: 'Telefone / Celular 2', placeholder: '(00) 00000-0000' },
                                { id: 'email', label: 'E-mail', placeholder: 'cliente@email.com' },
                            ].map(f => (
                                <div key={f.id} className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">{f.label}</label>
                                    <input
                                        type="text" id={f.id}
                                        value={(formData as any)[f.id] || ''}
                                        onChange={handleInputChange}
                                        required={f.required}
                                        placeholder={f.placeholder}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all outline-none"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Block 1b: Lead site / imóvel (preenchido pelo formulário público ou manualmente) */}
                    <div className="p-6 bg-areia/80 rounded-2xl border border-gold/20">
                        <p className="text-[10px] font-black text-gold uppercase tracking-widest mb-4">Cotação e imóvel (formulário do site)</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Estado civil</label>
                                <select
                                    id="estado_civil"
                                    value={formData.estado_civil || ''}
                                    onChange={handleInputChange}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none"
                                >
                                    <option value="">Selecione...</option>
                                    {ESTADO_CIVIL_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">CEP do imóvel</label>
                                <input type="text" id="cep_imovel" value={formData.cep_imovel || ''} onChange={handleInputChange} placeholder="00000-000" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Número do imóvel</label>
                                <input type="text" id="numero_imovel" value={formData.numero_imovel || ''} onChange={handleInputChange} placeholder="Nº, bloco, apto..." className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tipo de imóvel</label>
                                <select id="tipo_imovel" value={formData.tipo_imovel || ''} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">Selecione...</option>
                                    {TIPO_IMOVEL_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor do imóvel</label>
                                <input type="text" id="valor_imovel" value={formData.valor_imovel || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor do aluguel</label>
                                <input type="text" id="valor_aluguel" value={formData.valor_aluguel || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">1º pagamento do aluguel</label>
                                <input type="date" id="data_primeiro_pag_aluguel" value={formData.data_primeiro_pag_aluguel || ''} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">IPTU / condomínio</label>
                                <input type="text" id="valor_iptu_condominio" value={formData.valor_iptu_condominio || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                        </div>
                    </div>

                    {/* Block 2: Policy Data */}
                    <div>
                        <p className="text-[10px] font-black text-gold uppercase tracking-widest mb-4">Dados da Apólice</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Produto</label>
                                <select id="produto" value={formData.produto || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">Selecione...</option>
                                    {PRODUTOS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Apólice</label>
                                <input type="text" id="apolice" value={formData.apolice || ''} onChange={handleInputChange} placeholder="Nº da apólice" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Prêmio Total</label>
                                <input type="text" id="premio_total" value={formData.premio_total || ''} onChange={handleInputChange} placeholder="R$ 0,00" title="A comissão será calculada automaticamente (30%)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Comissão</label>
                                <input type="text" id="comissao" value={formData.comissao || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Data Emissão</label>
                                <input type="date" id="data_emissao" value={formData.data_emissao || ''} onChange={handleInputChange} title="O fim da vigência será preenchido automaticamente (1 ano)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Fim de Vigência</label>
                                <input type="date" id="fim_vigencia" value={formData.fim_vigencia || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Forma de Pagamento</label>
                                <select id="forma_pagamento" value={formData.forma_pagamento || ''} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    <option value="">Selecione...</option>
                                    {FORMAS_PAGAMENTO.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Situação</label>
                                <select id="situacao" value={formData.situacao || 'Ativo'} onChange={handleInputChange} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                                    {SITUACOES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">🏠 Parceiro / Imobiliária</label>
                                <select
                                    id="parceiro_nome"
                                    value={formData.parceiro_nome || ''}
                                    onChange={handleInputChange}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gold cursor-pointer"
                                >
                                    <option value="">— Sem parceiro —</option>
                                    {imobParceiros.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            {/* Apólice PDF Upload */}
                            {editingId && (
                              <FeatureTip
                                id="apolice-pdf-sync-2026"
                                title="PDF sincroniza com o portal"
                                description="Ao anexar o PDF da apólice, ele aparece automaticamente no portal da imobiliária para o parceiro baixar."
                                position="top"
                              >
                              <div className="space-y-2 col-span-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📄 PDF da Apólice</label>
                                {(formData as any).apolice_url ? (
                                  <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                                    <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                                    <a href={(formData as any).apolice_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-emerald-700 hover:underline flex-1 truncate">PDF anexado — clique para ver</a>
                                    <button onClick={() => setFormData(prev => ({ ...prev, apolice_url: null } as any))} className="text-slate-400 hover:text-red-400 transition-colors"><X size={14} /></button>
                                  </div>
                                ) : (
                                  <label className={`flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploadingApolice ? 'border-slate-200 bg-slate-50' : 'border-gold/40 hover:border-gold hover:bg-gold/5'}`}>
                                    <input type="file" accept="application/pdf" className="hidden" onChange={handleApoliceUpload} disabled={uploadingApolice} />
                                    {uploadingApolice ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <FileText size={16} className="text-gold" />}
                                    <span className="text-sm font-bold text-slate-600">{uploadingApolice ? 'Enviando PDF...' : 'Clique para anexar PDF da apólice'}</span>
                                    {formData.parceiro_nome && <span className="text-xs text-emerald-600 font-bold ml-auto">↗ Sincroniza com portal da imobiliária</span>}
                                  </label>
                                )}
                              </div>
                              </FeatureTip>
                            )}
                        </div>
                    </div>

                    {/* Block 3: Garantia Locatícia */}
                    <FeatureTip
                      id="garantia-docs-2026"
                      title="Documentos da garantia"
                      description="Com garantia ativa, você pode anexar a apólice e o contrato de locação. Eles aparecem na carteira da imobiliária."
                      position="top"
                    >
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-4 mb-4">
                            <Home size={18} className="text-gold" />
                            <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Tem Garantia Locatícia?</p>
                            <div className="flex gap-3 ml-auto">
                                {['Sim', 'Não'].map(v => (
                                    <button
                                        key={v} type="button"
                                        onClick={() => { setFormData(prev => ({ ...prev, tem_garantia: v })); }}
                                        className={`px-5 py-2 rounded-xl font-black text-sm transition-all ${formData.tem_garantia === v ? 'bg-gold text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200 hover:border-gold'}`}
                                    >{v}</button>
                                ))}
                            </div>
                        </div>
                        {formData.tem_garantia === 'Sim' && (
                            <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-4 pt-4 border-t border-slate-200">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Início Vigência Garantia</label>
                                    <input type="date" id="garantia_inicio" value={formData.garantia_inicio || ''} onChange={handleInputChange} className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📅 Fim Vigência Garantia</label>
                                    <input type="date" id="garantia_fim" value={formData.garantia_fim || ''} onChange={handleInputChange} className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Valor da Garantia</label>
                                    <input type="text" id="garantia_valor" value={formData.garantia_valor || ''} onChange={handleInputChange} placeholder="R$ 0,00" className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
                                </div>
                            </div>
                            {/* Documentos da Garantia — só aparecem ao editar */}
                            {editingId && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200">
                                    {/* Apólice da Garantia */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📄 Apólice da Garantia Locatícia</label>
                                        {(formData as any).apolice_garantia_url ? (
                                            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                                                <FileText size={15} className="text-emerald-600 shrink-0" />
                                                <a href={(formData as any).apolice_garantia_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-emerald-700 hover:underline flex-1 truncate">Ver apólice anexada</a>
                                                <button type="button" onClick={() => setFormData(prev => ({ ...prev, apolice_garantia_url: null }))} className="text-slate-400 hover:text-red-400"><X size={14} /></button>
                                            </div>
                                        ) : (
                                            <label className={`flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploadingGarantiaDoc === 'apolice_garantia_url' ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/30'}`}>
                                                <input type="file" accept="application/pdf" className="hidden" onChange={e => handleGarantiaDocUpload(e, 'apolice_garantia_url')} disabled={!!uploadingGarantiaDoc} />
                                                {uploadingGarantiaDoc === 'apolice_garantia_url' ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <FileText size={15} className="text-emerald-600" />}
                                                <span className="text-sm font-bold text-slate-600">{uploadingGarantiaDoc === 'apolice_garantia_url' ? 'Enviando...' : 'Anexar PDF da apólice'}</span>
                                            </label>
                                        )}
                                    </div>
                                    {/* Contrato de Locação */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">📝 Termo de Contrato de Locação</label>
                                        {(formData as any).contrato_locacao_url ? (
                                            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                                                <FileText size={15} className="text-blue-600 shrink-0" />
                                                <a href={(formData as any).contrato_locacao_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-700 hover:underline flex-1 truncate">Ver contrato anexado</a>
                                                <button type="button" onClick={() => setFormData(prev => ({ ...prev, contrato_locacao_url: null }))} className="text-slate-400 hover:text-red-400"><X size={14} /></button>
                                            </div>
                                        ) : (
                                            <label className={`flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploadingGarantiaDoc === 'contrato_locacao_url' ? 'border-slate-200 bg-slate-50' : 'border-blue-200 hover:border-blue-400 hover:bg-blue-50/30'}`}>
                                                <input type="file" accept="application/pdf" className="hidden" onChange={e => handleGarantiaDocUpload(e, 'contrato_locacao_url')} disabled={!!uploadingGarantiaDoc} />
                                                {uploadingGarantiaDoc === 'contrato_locacao_url' ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <FileText size={15} className="text-blue-600" />}
                                                <span className="text-sm font-bold text-slate-600">{uploadingGarantiaDoc === 'contrato_locacao_url' ? 'Enviando...' : 'Anexar PDF do contrato'}</span>
                                            </label>
                                        )}
                                    </div>
                                </div>
                            )}
                            </>
                        )}
                    </div>
                    </FeatureTip>

                    {/* Block 4: Obs */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observações</label>
                        <textarea id="obs" value={formData.obs || ''} onChange={handleInputChange} rows={3} placeholder="Anotações internas opcionais — dados do site ficam nos campos acima." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none resize-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all" />
                    </div>

                    {/* Parcelas / Boletos */}
                    {editingId && (
                        <div className="border-t border-slate-100 pt-6">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gold mb-4 flex items-center gap-2">
                                <FileText size={12} /> Parcelas / Boletos
                                {!formData.email && <span className="text-amber-500 font-bold normal-case text-[10px]">⚠ Sem e-mail — configure para enviar boletos</span>}
                            </p>

                            {/* List of boletos */}
                            {resBoletos.length > 0 && (
                                <div className="space-y-2 mb-4">
                                    {resBoletos.map(b => (
                                        <div key={b.id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${b.pago ? 'bg-emerald-50' : 'bg-red-50'}`}>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${b.pago ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>Parcela {b.parcela}</span>
                                                {b.vencimento && <span className="text-xs text-slate-500">Venc. {b.vencimento.split('-').reverse().join('/')}</span>}
                                                {b.valor && <span className="text-xs font-bold text-slate-700">{new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(b.valor)}</span>}
                                                <span className={`text-xs font-black ${b.pago ? 'text-emerald-600' : 'text-red-600'}`}>{b.pago ? '✓ Pago' : '⚠ Em Aberto'}</span>
                                            </div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <button onClick={() => handleToggleResPago(b.id, b.pago)} className={`text-[10px] font-black px-2.5 py-1 rounded-lg transition-all ${b.pago ? 'bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-600' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                                                    {b.pago ? 'Marcar Em Aberto' : 'Marcar Pago'}
                                                </button>
                                                <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-blue-600 hover:text-blue-800">
                                                    <Download size={12} /> PDF
                                                </a>
                                                {!b.pago && (
                                                    <button onClick={() => handleSendResBoletoEmail(b)} disabled={sendingResBoletoEmail === b.id} className={`inline-flex items-center gap-1 text-xs font-black px-2 py-1 rounded-lg transition-all ${resBoletoEmailSent.has(b.id) ? 'bg-emerald-50 text-emerald-600' : 'bg-gold/10 text-gold-hover hover:bg-gold/20'}`}>
                                                        {sendingResBoletoEmail === b.id ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                                                        {resBoletoEmailSent.has(b.id) ? 'Enviado' : 'E-mail'}
                                                    </button>
                                                )}
                                                <button onClick={() => handleDeleteResBoleto(b.id)} className="p-1 text-slate-300 hover:text-red-500 rounded-lg transition-all"><Trash2 size={13} /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add boleto form */}
                            <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Adicionar parcela</p>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Nº Parcela</label>
                                        <input type="number" min="1" value={resBoletoForm.parcela} onChange={e => setResBoletoForm(f => ({...f, parcela: e.target.value}))} placeholder="1" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Vencimento</label>
                                        <input type="date" value={resBoletoForm.vencimento} onChange={e => setResBoletoForm(f => ({...f, vencimento: e.target.value}))} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Valor</label>
                                        <input type="text" value={resBoletoForm.valor} onChange={e => setResBoletoForm(f => ({...f, valor: e.target.value}))} placeholder="R$ 0,00" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gold transition-all" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">PDF do Boleto</label>
                                    <input type="file" accept="application/pdf" onChange={e => setResBoletoForm(f => ({...f, file: e.target.files?.[0] || null}))} className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-navy file:text-gold hover:file:bg-navy-light cursor-pointer" />
                                </div>
                                <button onClick={handleAddResBoleto} disabled={resBoletoAdding || !resBoletoForm.parcela || !resBoletoForm.file} className="flex items-center gap-2 bg-navy text-gold px-5 py-2.5 rounded-xl font-black text-sm hover:bg-navy-light disabled:opacity-50 transition-all">
                                    {resBoletoAdding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                    {resBoletoAdding ? 'Salvando...' : 'Adicionar Boleto'}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-between items-center gap-3">
                        {editingId ? (
                            <button type="button" onClick={() => handleDelete(editingId)}
                                className="px-5 py-3.5 rounded-xl font-bold text-sm text-red-500 hover:bg-red-50 border border-red-200 transition-all flex items-center gap-2">
                                <Trash2 size={16} /> Excluir
                            </button>
                        ) : <div />}
                        <div className="flex gap-3">
                            {editingId ? (
                                <button type="button" onClick={resetForm}
                                    className="px-8 py-3.5 rounded-xl font-bold text-sm text-slate-500 hover:bg-slate-100 transition-all border border-slate-200">
                                    Fechar
                                </button>
                            ) : (
                                <button type="submit" disabled={saving} className="bg-gold text-white px-10 py-3.5 rounded-xl font-black text-sm hover:bg-gold-hover transition-all shadow-lg active:scale-95 flex items-center gap-2 disabled:opacity-50">
                                    {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                                    Adicionar Cliente
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>

            {/* Table */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-slate-100 bg-slate-50/40">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
                        Ordenar lista
                    </span>
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm shrink-0">
                        {(['entrada', 'vigencia', 'nome'] as const).map(opt => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                    if (sortBy === opt) {
                                        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
                                    } else {
                                        setSortBy(opt);
                                        setSortDir(
                                            opt === 'nome' ? 'asc' : opt === 'vigencia' ? 'asc' : 'desc',
                                        );
                                    }
                                }}
                                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                    sortBy === opt
                                        ? 'bg-navy text-white shadow'
                                        : 'text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                {opt === 'nome'
                                    ? 'A-Z'
                                    : opt === 'vigencia'
                                      ? 'Fim vigência'
                                      : 'Data entrada'}
                                {sortBy === opt && (
                                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    {/* Batch mode toggle */}
                    <button
                        onClick={() => { setBatchMode(b => !b); clearSelection(); }}
                        className={`px-4 py-2.5 rounded-xl font-bold text-sm border transition-all shrink-0 ${batchMode ? 'bg-navy text-white border-navy' : 'bg-white text-slate-600 border-slate-200 hover:border-gold'}`}
                    >
                        {batchMode ? `✓ ${selectedIds.size} selecionados` : '☰ Selecionar'}
                    </button>

                    {/* Search inline with sort */}
                    <div className="relative flex-1 min-w-[200px] max-w-xs ml-auto">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Buscar nome, CPF, apólice..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none w-full focus:ring-2 focus:ring-gold/20 focus:border-gold"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                                <X size={13} />
                            </button>
                        )}
                    </div>
                </div>
                {batchMode && selectedIds.size > 0 && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-navy/5 border-b border-gold/20">
                        <span className="text-sm font-black text-navy">{selectedIds.size} selecionado(s)</span>
                        <div className="flex gap-2 ml-auto flex-wrap">
                            <select
                                value=""
                                onChange={e => { const v = e.target.value; if (v) batchChangeSituacao(v); }}
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-gold"
                            >
                                <option value="">Mudar situação...</option>
                                {SITUACOES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button
                                onClick={clearSelection}
                                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
                <div ref={topScrollRef} className="table-scroll-x res-top-scroll" style={{height: 10}}>
                    <div ref={topScrollInnerRef} style={{height: 1}} />
                </div>
                {/* Mobile card view */}
                <style>{`
                  @media (max-width: 768px) {
                    .res-table-wrapper { display: none !important; }
                    .res-mobile-cards { display: flex !important; }
                    .res-top-scroll { display: none !important; }
                  }
                  .res-mobile-cards { display: none; flex-direction: column; gap: 10px; padding: 16px; }
                `}</style>
                <div className="res-mobile-cards">
                    {filtered.map(c => (
                        <div key={c.id} className="bg-white rounded-2xl border border-slate-100 p-4">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <p className="font-black text-slate-800 text-sm">{c.nome}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{c.produto || '—'}</p>
                                </div>
                                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${situacaoColor(c.situacao)}`}>{c.situacao}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><span className="text-slate-400">Apólice:</span> <span className="font-bold">{c.apolice || '—'}</span></div>
                                <div><span className="text-slate-400">Prêmio:</span> <span className="font-bold">{c.premio_total || '—'}</span></div>
                                <div><span className="text-slate-400">Vence:</span> <span className="font-bold">{c.fim_vigencia ? new Date(c.fim_vigencia + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</span></div>
                                <div><span className="text-slate-400">Parceiro:</span> <span className="font-bold">{c.parceiro_nome?.replace('Imobiliária ', '') || '—'}</span></div>
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button onClick={() => handleEdit(c)} className="flex-1 py-2 bg-navy text-white text-xs font-black rounded-xl">Editar</button>
                                <button onClick={() => handleDelete(c.id)} className="py-2 px-3 bg-red-50 text-red-500 text-xs font-black rounded-xl border border-red-100">✕</button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="res-table-wrapper table-scroll-x" ref={tableScrollRef}>
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-[2px] border-b border-slate-100">
                            <tr>
                                {batchMode && (
                                    <th className="px-4 py-3 w-10">
                                        <input
                                            type="checkbox"
                                            onChange={e => e.target.checked ? selectAll(filtered.map(c => c.id)) : clearSelection()}
                                            checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                                        />
                                    </th>
                                )}
                                <th className="px-4 py-5 align-top"></th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Cliente</span>
                                    <select
                                        value={filterClienteId}
                                        onChange={(e) => setFilterClienteId(e.target.value)}
                                        aria-label="Filtrar por cliente"
                                        className="mt-1 block w-fit max-w-[min(100%,200px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todos</option>
                                        {clienteFilterOptions.map((c) => (
                                            <option key={c.id} value={String(c.id)}>
                                                {c.nome}
                                            </option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">Entrada</th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Produto</span>
                                    <select
                                        value={filterProduto}
                                        onChange={(e) => setFilterProduto(e.target.value)}
                                        aria-label="Filtrar por produto"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todos</option>
                                        {PRODUTOS.map((p) => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">Apólice</th>
                                <th className="px-6 py-5 align-top">Prêmio</th>
                                <th className="px-6 py-5 align-top">Comissão</th>
                                <th className="px-6 py-5 align-top">Fim Vigência</th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Pagamento</span>
                                    <select
                                        value={filterPagamento}
                                        onChange={(e) => setFilterPagamento(e.target.value)}
                                        aria-label="Filtrar por forma de pagamento"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todas</option>
                                        {FORMAS_PAGAMENTO.map((f) => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Situação</span>
                                    <select
                                        value={filterSituacao}
                                        onChange={(e) => setFilterSituacao(e.target.value)}
                                        aria-label="Filtrar por situação"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todas</option>
                                        {SITUACOES.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </th>
                                <th className="px-6 py-5 align-top">
                                    <span className="block">Garantia</span>
                                    <select
                                        value={filterGarantia}
                                        onChange={(e) => setFilterGarantia(e.target.value)}
                                        aria-label="Filtrar por garantia"
                                        className="mt-1 block w-fit max-w-[min(100%,140px)] bg-transparent border-none outline-none cursor-pointer text-[9px] font-black uppercase tracking-wider text-slate-400 focus:ring-0"
                                    >
                                        <option value="">Todas</option>
                                        <option value="Sim">Sim</option>
                                        <option value="Não">Não</option>
                                    </select>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={batchMode ? 12 : 11} className="px-6 py-16 text-center text-slate-400 font-bold text-sm">
                                        {search || hasTableFilters ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
                                    </td>
                                </tr>
                            ) : filtered.map(c => {
                                const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
                                const fim = c.fim_vigencia ? new Date(c.fim_vigencia) : null;
                                const dias = fim ? Math.ceil((fim.getTime() - hoje.getTime()) / 86400000) : null;
                                const nearExpiry = dias !== null && dias <= 30 && dias >= 0 && c.situacao === 'Ativo';
                                return (
                                    <tr key={c.id} onClick={() => !batchMode && handleEdit(c)} className={`group transition-all ${editingId === c.id ? 'bg-gold/10 border-l-2 border-l-gold' : nearExpiry ? 'bg-amber-50/40 hover:bg-amber-50' : ''} ${batchMode ? '' : 'cursor-pointer hover:bg-gold/5'}`}>
                                        {batchMode && (
                                            <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(c.id)}
                                                    onChange={() => toggleSelect(c.id)}
                                                />
                                            </td>
                                        )}
                                        <td className="px-4 py-5 w-0"></td>
                                        <td className="px-6 py-5 min-w-[200px] max-w-[300px] whitespace-nowrap overflow-hidden text-ellipsis">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-black text-slate-800 text-sm truncate">{c.nome}</span>
                                                {isPublicLead(c) && (
                                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider bg-navy text-gold px-2 py-0.5 rounded-md">
                                                        Site
                                                    </span>
                                                )}
                                                {isNovoLead(c) && (
                                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md">
                                                        Novo lead
                                                    </span>
                                                )}
                                                {c.parceiro_nome && (
                                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md">
                                                        🏠 {c.parceiro_nome.replace('Imobiliária ', '')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                                <span>{c.cpf ? (c.cpf.includes('.') ? c.cpf : formatCPF(c.cpf)) : '-'}</span>
                                                <span aria-hidden>•</span>
                                                {c.telefone ? (
                                                    <WhatsAppPhoneLink
                                                        phone={c.telefone}
                                                        display={c.telefone.includes('(') ? c.telefone : formatPhone(c.telefone)}
                                                        className="text-slate-500 font-bold"
                                                    />
                                                ) : (
                                                    <span>-</span>
                                                )}
                                                {c.telefone_2 ? (
                                                    <>
                                                        <span aria-hidden>•</span>
                                                        <WhatsAppPhoneLink
                                                            phone={c.telefone_2}
                                                            display={
                                                                c.telefone_2.includes('(') ? c.telefone_2 : formatPhone(c.telefone_2)
                                                            }
                                                            className="text-slate-500 font-bold"
                                                        />
                                                    </>
                                                ) : null}
                                                {c.cep_imovel ? (
                                                    <>
                                                        <span aria-hidden>•</span>
                                                        <span>
                                                            CEP {c.cep_imovel.includes('-') ? c.cep_imovel : formatCEP(c.cep_imovel)}
                                                        </span>
                                                    </>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-xs font-bold text-slate-600 whitespace-nowrap align-top">
                                            {formatEntrada(c.created_at)}
                                        </td>
                                        <td className="px-6 py-5 text-sm font-bold text-slate-700 whitespace-nowrap">{c.produto || '-'}</td>
                                        <td className="px-6 py-5 text-sm text-slate-600 whitespace-nowrap">{c.apolice || '-'}</td>
                                        <td className="px-6 py-5 text-sm font-black text-slate-800 whitespace-nowrap">{c.premio_total ? (c.premio_total.includes('R$') ? c.premio_total : formatCurrency(c.premio_total)) : '-'}</td>
                                        <td className="px-6 py-5 text-sm font-black text-gold whitespace-nowrap">{c.comissao ? (c.comissao.includes('R$') ? c.comissao : formatCurrency(c.comissao)) : '-'}</td>
                                        <td className="px-6 py-5 text-sm">
                                            <span className={nearExpiry ? 'text-amber-600 font-black' : 'text-slate-600'}>
                                                {c.fim_vigencia ? new Date(c.fim_vigencia).toLocaleDateString('pt-BR') : '-'}
                                                {nearExpiry && <span className="ml-2 text-[10px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-black">{dias}d</span>}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-sm text-slate-600">{c.forma_pagamento || '-'}</td>
                                        <td className="px-6 py-5">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${situacaoColor(c.situacao)}`}>
                                                {c.situacao === 'Lead (site)' ? <Home size={12} /> : c.situacao === 'Ativo' ? <CheckCircle2 size={12} /> : c.situacao === 'Vencido' ? <AlertCircle size={12} /> : <Clock size={12} />}
                                                {c.situacao}
                                            </span>
                                        </td>
                                        <td className="px-6 py-5 text-sm">
                                            {c.tem_garantia === 'Sim'
                                                ? <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 font-black text-[10px]"><Home size={11} /> Sim</span>
                                                : <span className="text-slate-400 text-xs">—</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ResidentialInsurance;
