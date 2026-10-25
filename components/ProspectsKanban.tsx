import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Prospect, CRMTask } from '../types';
import { formatCurrency } from '../utils/formatters';
import { Plus, Upload, Search, MoreVertical, X, Loader2, GripVertical, Phone, Tag, Save, ArrowRight, Edit2, MoveRight, TrendingUp, Trash2, LayoutGrid, Palette, Calendar, Bell, Clock, CheckCircle2, AlertCircle, ExternalLink, Mail, Send, AlertTriangle, MessageCircle } from 'lucide-react';
import TaskManager from './TaskManager';
import WhatsAppPhoneLink from './WhatsAppPhoneLink';
import ModalPortal from './ModalPortal.tsx';
import { useToast } from './Toast.tsx';
import KanbanRoteiroModal, { ModoRoteiro } from './KanbanRoteiroModal.tsx';
import { Roteiro, grupoDoLead, normalizarTelefone, tipoTelefone } from '../lib/roteiros.ts';

interface KanbanColumn {
    id: string;
    title: string;
    color: string; // tailwind bg color key
    protected?: boolean;
}

const COLOR_OPTIONS = [
    { key: 'fg_blue_1', label: 'Azul F&G 1', header: 'bg-navy text-white' },
    { key: 'fg_blue_2', label: 'Azul F&G 2', header: 'bg-navy-light text-white' },
    { key: 'fg_blue_3', label: 'Azul F&G 3', header: 'bg-[#2E3F56] text-white' },
    { key: 'fg_gold_1', label: 'Dourado F&G 1', header: 'bg-gold text-navy' },
    { key: 'fg_gold_2', label: 'Dourado F&G 2', header: 'bg-gold-hover text-white' },
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
    return found ? found.header : 'bg-navy text-white';
};

// Colunas usadas pelas automações (webhook do Resend / prospecção PNCP).
// Elas precisam existir em todo Kanban, senão os leads movidos por status
// sumiriam da tela; por isso são fundidas na configuração salva do usuário.
const REQUIRED_COLUMNS: KanbanColumn[] = [
    { id: 'Em contato', title: 'Em contato', color: 'fg_gold_1', protected: true },
    // Leads do garimpo com telefone mas sem e-mail: a Bruna trabalha manualmente.
    { id: 'Contato por WhatsApp', title: 'Contato por WhatsApp', color: 'fg_gold_2', protected: true },
    { id: 'Sem e-mail válido', title: 'Sem e-mail válido', color: 'fg_blue_2', protected: true },
];

const DEFAULT_COLUMNS: KanbanColumn[] = [
    { id: 'Novos Leads', title: 'Novos Leads', color: 'fg_blue_1', protected: true },
    { id: 'Em contato', title: 'Em contato', color: 'fg_gold_1', protected: true },
    { id: 'Contato por WhatsApp', title: 'Contato por WhatsApp', color: 'fg_gold_2', protected: true },
    { id: 'Leads Sem demanda', title: 'Sem Demanda', color: 'fg_blue_2' },
    { id: 'Leads Rafael', title: 'Leads Rafael', color: 'fg_gold_1' },
    { id: 'Leads Andréia', title: 'Leads Andréia', color: 'fg_gold_2' },
    { id: 'Sem e-mail válido', title: 'Sem e-mail válido', color: 'fg_blue_2', protected: true },
];

// Até a migração 108 as colunas ficavam só no localStorage de cada navegador
// (apesar do nome "shared" na chave). Agora a lista vive na tabela
// kanban_colunas e todos veem o mesmo quadro. O localStorage serve apenas para
// importar, uma única vez por navegador, as colunas criadas à mão antes disso.
const STORAGE_KEY = 'kanban_columns_v1_shared';
const IMPORT_FLAG = 'kanban_colunas_importadas_v1';

/** Garante as colunas fixas (Novos Leads e as das automações), sem reordenar as demais. */
const garantirColunasFixas = (cols: KanbanColumn[]): KanbanColumn[] => {
    const fixas = [DEFAULT_COLUMNS[0], ...REQUIRED_COLUMNS];
    const faltantes = fixas.filter(f => !cols.some(c => c.id === f.id));
    if (!faltantes.length) return cols;
    const semNovos = faltantes.filter(f => f.id !== 'Novos Leads');
    const temNovos = faltantes.some(f => f.id === 'Novos Leads');
    return [...(temNovos ? [DEFAULT_COLUMNS[0]] : []), ...cols, ...semNovos];
};

/** Lê a configuração antiga deste navegador (só para a importação única). */
const lerColunasLocais = (): KanbanColumn[] | null => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('kanban_columns_v1_Seguro_Garantia');
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed.filter(c => c && typeof c.id === 'string' && typeof c.title === 'string') : null;
    } catch { return null; }
};

/** Estado inicial enquanto o banco não responde. */
const loadColumns = (): KanbanColumn[] => garantirColunasFixas(lerColunasLocais() || DEFAULT_COLUMNS.filter(c => c.protected));

type ColunaDb = { id: string; title: string; color: string; protected: boolean; ordem: number };

const doDb = (r: ColunaDb): KanbanColumn => ({ id: r.id, title: r.title, color: r.color, protected: r.protected || undefined });

const buscarColunasDb = async (): Promise<ColunaDb[] | null> => {
    const { data, error } = await supabase
        .from('kanban_colunas')
        .select('id, title, color, protected, ordem')
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true });
    if (error) { console.error('Erro ao carregar colunas do Kanban:', error); return null; }
    return (data || []) as ColunaDb[];
};

/**
 * Carrega as colunas compartilhadas. Na primeira abertura de cada navegador,
 * envia para o banco as colunas que só existiam nele:
 * - se o banco ainda só tem as colunas fixas, a ordem deste navegador vira a do quadro;
 * - senão, as colunas que faltam entram no fim, sem mexer nas que já existem.
 */
const carregarColunasCompartilhadas = async (): Promise<KanbanColumn[] | null> => {
    let rows = await buscarColunasDb();
    if (!rows) return null;

    let jaImportou = true;
    try { jaImportou = localStorage.getItem(IMPORT_FLAG) === '1'; } catch { /* ignore */ }

    if (!jaImportou) {
        const locais = lerColunasLocais();
        let ok = true;
        if (locais && locais.length) {
            const porId = new Map(rows.map(r => [r.id, r]));
            const soFixas = rows.every(r => r.protected);
            if (soFixas) {
                const todas = locais.map((c, i) => ({
                    id: c.id,
                    title: c.title,
                    color: c.color || 'fg_blue_2',
                    protected: !!porId.get(c.id)?.protected,
                    ordem: (i + 1) * 10,
                }));
                const { error } = await supabase.from('kanban_colunas').upsert(todas, { onConflict: 'id' });
                if (error) { ok = false; console.error('Erro ao importar colunas do Kanban:', error); }
            } else {
                const maxOrdem = Math.max(0, ...rows.map(r => r.ordem));
                const novas = locais
                    .filter(c => !porId.has(c.id))
                    .map((c, i) => ({ id: c.id, title: c.title, color: c.color || 'fg_blue_2', protected: false, ordem: maxOrdem + (i + 1) * 10 }));
                if (novas.length) {
                    const { error } = await supabase.from('kanban_colunas').upsert(novas, { onConflict: 'id', ignoreDuplicates: true });
                    if (error) { ok = false; console.error('Erro ao importar colunas do Kanban:', error); }
                }
            }
            if (ok) rows = (await buscarColunasDb()) || rows;
        }
        // Só marca como importado se deu certo; senão tenta de novo na próxima abertura.
        if (ok) { try { localStorage.setItem(IMPORT_FLAG, '1'); } catch { /* ignore */ } }
    }

    return garantirColunasFixas(rows.map(doDb));
};

/** Grava a ordem atual de todas as colunas. */
const salvarOrdemColunas = async (cols: KanbanColumn[]) => {
    const linhas = cols.map((c, i) => ({ id: c.id, title: c.title, color: c.color, protected: !!c.protected, ordem: i * 10 }));
    const { error } = await supabase.from('kanban_colunas').upsert(linhas, { onConflict: 'id' });
    if (error) throw error;
};

const PRODUCT_TYPES = ['Seguro Garantia', 'Judicial Depósito Recursal', 'Energia', 'Seguro de crédito'] as const;

const PRODUCT_BADGE: Record<string, string> = {
    'Seguro Garantia':            'bg-blue-50 text-blue-700 border-blue-200',
    'Judicial Depósito Recursal': 'bg-amber-50 text-amber-700 border-amber-200',
    'Energia':                    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Seguro de crédito':          'bg-purple-50 text-purple-700 border-purple-200',
};

// ---- Leads do PNCP: homologação e edital ----
// Janela de abordagem: até 10 dias da homologação é o lead mais quente (é a
// validade da fila da prospecção automática); até 30 dias ainda vale tentar,
// porque o art. 96, §3º, da Lei 14.133 dá no mínimo um mês da homologação
// para apresentar o seguro garantia. Depois disso o card fica neutro.
const HOMOLOGACAO_QUENTE_DIAS = 10;
const HOMOLOGACAO_MORNA_DIAS = 30;

/** Dias corridos entre a data 'AAAA-MM-DD' e hoje, no fuso do navegador. */
const diasDesdeData = (data?: string | null): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || '');
    if (!m) return null;
    const dia = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(dia.getTime())) return null;
    const hoje = new Date();
    const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.round((hojeZero.getTime() - dia.getTime()) / 86400000);
};

/** 'AAAA-MM-DD' para 'DD/MM'. */
const dataCurtaBr = (data?: string | null): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || '');
    return m ? `${m[3]}/${m[2]}` : '';
};

const rotuloDias = (dias: number): string => {
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'há 1 dia';
    return `há ${dias} dias`;
};

/**
 * Link da página da licitação no PNCP a partir do número de controle
 * ("CNPJ-1-SEQUENCIAL/ANO"). Os leads da regra antiga guardam o número do
 * contrato, em outro formato, e não geram link.
 */
const urlEditalPncp = (numero?: string | null): string | null => {
    const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec((numero || '').trim());
    if (!m) return null;
    return `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${Number(m[2])}`;
};

/** Classe do selo de homologação conforme a idade (classes inteiras, sem interpolação). */
const classeSeloHomologacao = (dias: number): string => {
    if (dias <= HOMOLOGACAO_QUENTE_DIAS) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (dias <= HOMOLOGACAO_MORNA_DIAS) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-slate-50 text-slate-500 border-slate-200';
};

type LeadSort = 'recent' | 'oldest' | 'homologacao';

// ---- E-mail da licitação: o 1º contato dos leads do PNCP ----
// O lead do PNCP entra no Kanban sem receber nada. Quem manda o primeiro
// e-mail é o Fábio, pelo botão do card, conferindo os dados da licitação na
// prévia. Esse envio conta como o E1 da trilha `garantia`; o cron segue do E2.
//
// "Aguardando 1º e-mail" não é coluna no banco: é não ter nenhuma linha em
// email_envios com ordem 1 para o contato daquele lead.
type EstadoE1 = 'oculto' | 'aguardando' | 'iniciada';

interface CadenciaDoLead {
    contatoId: string | null;
    /** timestamptz do envio da ordem 1, ou null se a trilha não começou. */
    iniciadaEm: string | null;
}

/** timestamptz -> 'DD/MM' em BRT. Um envio das 21h de São Paulo é 00h do dia
 *  seguinte em UTC: formatar a string crua mostraria a data errada. */
const diaMesBrDeTimestamp = (ts?: string | null): string => {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    });
};

/** Lê o Supabase página a página: email_cadencia e email_envios já passam de 1.000 linhas. */
async function buscarTodasLinhas<T>(tabela: string, colunas: string, filtrar?: (q: any) => any): Promise<T[]> {
    const todos: T[] = [];
    for (let de = 0; ; de += PAGINA_PROSPECTS) {
        let q = supabase.from(tabela).select(colunas).range(de, de + PAGINA_PROSPECTS - 1);
        if (filtrar) q = filtrar(q);
        const { data, error } = await q;
        if (error) throw error;
        const pagina = (data || []) as T[];
        todos.push(...pagina);
        if (pagina.length < PAGINA_PROSPECTS) break;
    }
    return todos;
}

// O Supabase devolve no máximo 1.000 linhas por consulta. Sem paginar, o
// Kanban mostrava só os 1.000 leads mais recentes e a checagem de duplicados
// do import CSV ignorava o resto. Busca página a página até acabar.
const PAGINA_PROSPECTS = 1000;

// Status de quem saiu do quadro pelo arquivamento automático (migração 118).
// Não é coluna do Kanban: o filtro principal esconde esses leads.
const STATUS_ARQUIVO_PNCP = 'Arquivo PNCP';
async function buscarTodosProspects<T = Prospect>(colunas: string): Promise<T[]> {
    const todos: T[] = [];
    for (let de = 0; ; de += PAGINA_PROSPECTS) {
        const { data, error } = await supabase
            .from('prospects')
            .select(colunas)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true }) // desempate estável entre páginas
            .range(de, de + PAGINA_PROSPECTS - 1);
        if (error) throw error;
        const pagina = (data || []) as T[];
        todos.push(...pagina);
        if (pagina.length < PAGINA_PROSPECTS) break;
    }
    return todos;
}

// ---- Toques manuais (WhatsApp, e-mail e ligação feitos à mão) ----
// Cada "Confirmar" no card grava uma linha em prospect_toques. O card mostra o
// último toque de cada canal e fica em alerta quando o último contato passou
// de TOQUE_ALERTA_DIAS sem o lead mudar de situação.
type CanalToque = 'whatsapp' | 'email' | 'ligacao';
const TOQUE_ALERTA_DIAS = 3;
interface ToqueCanal { em: string; autor: string | null }
interface ToquesDoLead {
    whatsapp?: ToqueCanal; email?: ToqueCanal; ligacao?: ToqueCanal;
    qtd: Partial<Record<CanalToque, number>>; total: number; ultimo: string;
}
const ROTULO_CANAL: Record<CanalToque, string> = { whatsapp: 'WhatsApp', email: 'E-mail', ligacao: 'Ligação' };

/** Data (AAAA-MM-DD) do horário de São Paulo, para contar os toques do dia. */
const diaSaoPaulo = (ts: string | number | Date): string =>
    new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const diasDesdeTimestamp = (ts?: string | null): number | null => {
    if (!ts) return null;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

interface ProspectsKanbanProps {
    onProductChange?: (product: string) => void;
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
    observationHistory,
    hideObservation
}: {
    form: Partial<Prospect>;
    setForm: (v: Partial<Prospect>) => void;
    columns: KanbanColumn[];
    observationHistory?: string;
    hideObservation?: boolean;
}) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4 col-span-2">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Informações Principais</h4>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Empresa *</label>
            <input required type="text" value={form.company || ''} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Nome da Empresa" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">CNPJ</label>
            <input type="text" value={form.cnpj || ''} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="00.000.000/0001-00" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Nome do Contato</label>
            <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Ciclano da Silva" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Cargo do Contato</label>
            <input type="text" value={form.position || ''} onChange={(e) => setForm({ ...form, position: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Diretor Financeiro" />
        </div>
        <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">Decisor / Responsável</label>
            <input type="text" value={form.decisor || ''} onChange={(e) => setForm({ ...form, decisor: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Nome do decisor" />
        </div>
        <div className="space-y-4 col-span-2 mt-2">
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Contato & Detalhes</h4>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Telefone / Celular</label>
            <input type="text" value={form.phonenumber || ''} onChange={(e) => setForm({ ...form, phonenumber: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="(00) 00000-0000" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">E-mail</label>
            <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="contato@empresa.com.br" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Ramo</label>
            <input type="text" value={form.ramo || ''} onChange={(e) => setForm({ ...form, ramo: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Engenharia / Construtora" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Segmento</label>
            <select
                value={form.segmento || ''}
                onChange={(e) => setForm({ ...form, segmento: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all cursor-pointer"
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
            <label className="text-sm font-bold text-slate-700">Foco do Atendimento</label>
            <select
                value={form.product_type || ''}
                onChange={(e) => setForm({ ...form, product_type: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all cursor-pointer"
            >
                <option value="">Selecione</option>
                {PRODUCT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">CEP</label>
            <input type="text" value={form.zip || ''} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="00000-000" />
        </div>
        <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">Endereço</label>
            <input type="text" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Rua, Número, Bairro" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Valor Estimado</label>
            <input type="number" step="0.01" value={form.lead_value || ''} onChange={(e) => setForm({ ...form, lead_value: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="150000.00" />
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Fase (Coluna)</label>
            <select value={form.status || 'Novos Leads'} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all cursor-pointer">
                {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
            </select>
        </div>
        <div className="space-y-1.5 col-span-2 md:col-span-1">
            <label className="text-sm font-bold text-slate-700">Origem do Contato</label>
            <input type="text" value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="Ex: Conlicitação, Portal, Indicação" />
        </div>
        {/* ── ADDITIONAL JUDICIAL FIELDS ── */}
        {form.product_type === 'Judicial Depósito Recursal' && (
            <>
                <div className="space-y-4 col-span-2 mt-4">
                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Dados do Processo</h4>
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                    <label className="text-sm font-bold text-slate-700">Nº do Processo</label>
                    <input type="text" value={form.judicial_process_number || ''} onChange={(e) => setForm({ ...form, judicial_process_number: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="0000000-00.0000.0.00.0000" />
                </div>
                <div className="space-y-1.5 col-span-2 md:col-span-1">
                    <label className="text-sm font-bold text-slate-700">Tribunal / Vara</label>
                    <input type="text" value={form.judicial_court || ''} onChange={(e) => setForm({ ...form, judicial_court: e.target.value })} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all" placeholder="TRT / Vara do Trabalho" />
                </div>
            </>
        )}

        {!hideObservation && <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-bold text-slate-700">{observationHistory ? 'Nova Observação' : 'Observações'}</label>
            <textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all resize-none" placeholder={observationHistory ? "Digite a nova atualização. Será adicionada ao histórico com data/hora." : "Anotações sobre este lead..."} />
            {observationHistory && (
                <div className="mt-2 bg-white border border-slate-200 rounded-xl p-3">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">Histórico de observações</p>
                    <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-sans">{observationHistory}</pre>
                </div>
            )}
        </div>}
    </div>
);

const ProspectsKanban: React.FC<ProspectsKanbanProps> = ({ onConvertToSale }) => {

    const [productFilter, setProductFilter] = useState<string>('');
    // Filtro por tag (ex.: "consultores", "imobiliarias", "pncp"). Vazio = todas.
    const [tagFilter, setTagFilter] = useState<string>('');
    const [columns, setColumns] = useState<KanbanColumn[]>(() => loadColumns());
    const [prospects, setProspects] = useState<Prospect[]>([]);
    const [tasks, setTasks] = useState<CRMTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    // Ordenação do quadro. Padrão: homologação mais recente (PNCP), que põe no
    // topo o lead com contrato ainda por assinar e, no empate, o de maior valor;
    // leads sem homologação seguem pelo tempo na coluna. A escolha de cada
    // usuário fica salva no navegador.
    const [leadAgeSort, setLeadAgeSortState] = useState<LeadSort>(() => {
        try {
            const salvo = localStorage.getItem('kanban_ordem_v1');
            if (salvo === 'recent' || salvo === 'oldest' || salvo === 'homologacao') return salvo;
        } catch { /* ignore */ }
        return 'homologacao';
    });
    const setLeadAgeSort = (v: LeadSort) => {
        setLeadAgeSortState(v);
        try { localStorage.setItem('kanban_ordem_v1', v); } catch { /* ignore */ }
    };
    // Filtro rápido: mostrar só os leads do PNCP com homologação registrada.
    const [soHomologadasPncp, setSoHomologadasPncp] = useState(false);

    // ── E-mail da licitação ──────────────────────────────────────────────────
    // Estado da trilha de cada lead, para o card saber se o botão está livre
    // (aguardando o 1º e-mail) ou travado (trilha já iniciada).
    const [cadenciaPorLead, setCadenciaPorLead] = useState<Record<string, CadenciaDoLead>>({});
    const [soAguardandoE1, setSoAguardandoE1] = useState(false);

    // Toques manuais por lead, nome curto de cada usuário e o botão em confirmação.
    const [toquesPorLead, setToquesPorLead] = useState<Record<string, ToquesDoLead>>({});
    const [nomePorEmail, setNomePorEmail] = useState<Record<string, string>>({});
    const [confirmandoToque, setConfirmandoToque] = useState<{ id: string; canal: CanalToque } | null>(null);
    const [salvandoToque, setSalvandoToque] = useState(false);
    const [soSemContato, setSoSemContato] = useState(false);
    // Leads do PNCP arquivados (homologação antiga, sem contato) ficam fora do
    // quadro. A caixa "Ver arquivo PNCP" traz de volta para consulta: como
    // 'Arquivo PNCP' não é coluna, eles aparecem em Novos Leads e podem ser
    // arrastados para qualquer coluna, o que os tira do arquivo.
    const [verArquivoPncp, setVerArquivoPncp] = useState(false);
    // E-mail de quem está logado e WhatsApps registrados hoje por autor (horário de SP).
    const [meuEmail, setMeuEmail] = useState('');
    const [whatsHojePorAutor, setWhatsHojePorAutor] = useState<Record<string, number>>({});
    // Roteiros de abordagem (energia, imobiliárias e consultores) e o modal aberto.
    const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
    const [roteiroAberto, setRoteiroAberto] = useState<{ leadId: string; modo: ModoRoteiro } | null>(null);
    const [leadEmailLicitacao, setLeadEmailLicitacao] = useState<Prospect | null>(null);
    const [emailLicPara, setEmailLicPara] = useState('');
    const [emailLicNome, setEmailLicNome] = useState('');
    const [emailLicAssunto, setEmailLicAssunto] = useState('');
    const [emailLicCorpo, setEmailLicCorpo] = useState('');
    const [emailLicHtml, setEmailLicHtml] = useState('');
    const [emailLicAvisos, setEmailLicAvisos] = useState<string[]>([]);
    const [emailLicCarregando, setEmailLicCarregando] = useState(false);
    const [emailLicEnviando, setEmailLicEnviando] = useState(false);
    const [emailLicErro, setEmailLicErro] = useState('');
    const { toast } = useToast();
    // Guarda quando o lead "entrou" na coluna (atualizado quando você move o card).
    // Se recarregar a página, cai para `created_at` (fallback) até você mover novamente.
    const [leadEnteredAtMs, setLeadEnteredAtMs] = useState<Record<string, number>>({});
    const [isDragging, setIsDragging] = useState(false);
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editingColTitle, setEditingColTitle] = useState('');

    // Colunas compartilhadas (tabela kanban_colunas). Recarrega ao voltar para a
    // aba, para pegar colunas criadas, renomeadas ou movidas por outro usuário.
    const recarregarColunas = async () => {
        const cols = await carregarColunasCompartilhadas();
        if (cols) setColumns(cols);
    };
    useEffect(() => {
        recarregarColunas();
        const aoFocar = () => { if (document.visibilityState === 'visible') recarregarColunas(); };
        document.addEventListener('visibilitychange', aoFocar);
        return () => document.removeEventListener('visibilitychange', aoFocar);
    }, []);

    // CSV Import State
    const [csvProductType, setCsvProductType] = useState<string>('Seguro Garantia');
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

    // Bulk Selection State
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

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
        fetchCadencia();
        fetchToques();
        fetchNomesUsuarios();
        supabase.auth.getUser().then(({ data }) => setMeuEmail((data.user?.email || '').toLowerCase()));
        fetchRoteiros();
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
            const data = await buscarTodosProspects<Prospect>('*');
            setProspects(data);
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

    /** Último toque de cada canal por lead, a partir de prospect_toques. */
    const montarToques = (linhas: { prospect_id: string; canal: CanalToque; autor_email: string | null; created_at: string }[]) => {
        const mapa: Record<string, ToquesDoLead> = {};
        for (const l of linhas) {
            const atual = mapa[l.prospect_id] || { qtd: {}, total: 0, ultimo: l.created_at };
            atual.total += 1;
            atual.qtd[l.canal] = (atual.qtd[l.canal] || 0) + 1;
            if (l.created_at > atual.ultimo) atual.ultimo = l.created_at;
            const anterior = atual[l.canal];
            if (!anterior || l.created_at > anterior.em) atual[l.canal] = { em: l.created_at, autor: l.autor_email };
            mapa[l.prospect_id] = atual;
        }
        return mapa;
    };

    const fetchToques = async () => {
        try {
            const linhas = await buscarTodasLinhas<{ prospect_id: string; canal: CanalToque; autor_email: string | null; created_at: string }>(
                'prospect_toques', 'prospect_id, canal, autor_email, created_at');
            setToquesPorLead(montarToques(linhas));
            const hoje = diaSaoPaulo(Date.now());
            const porAutor: Record<string, number> = {};
            for (const l of linhas) {
                if (l.canal !== 'whatsapp' || !l.autor_email || diaSaoPaulo(l.created_at) !== hoje) continue;
                const autor = l.autor_email.toLowerCase();
                porAutor[autor] = (porAutor[autor] || 0) + 1;
            }
            setWhatsHojePorAutor(porAutor);
        } catch (error) {
            console.error('Error fetching toques:', error);
        }
    };

    const fetchRoteiros = async () => {
        try {
            const { data, error } = await supabase
                .from('prospect_roteiros')
                .select('grupo, canal, etapa, variacao, assunto, corpo')
                .eq('ativo', true);
            if (error) throw error;
            setRoteiros((data || []) as Roteiro[]);
        } catch (error) {
            console.error('Error fetching roteiros:', error);
        }
    };

    const fetchNomesUsuarios = async () => {
        try {
            const { data, error } = await supabase.from('sellers').select('name, email');
            if (error) throw error;
            const mapa: Record<string, string> = {};
            for (const s of data || []) {
                if (s.email && s.name) mapa[String(s.email).toLowerCase()] = String(s.name).trim().split(/\s+/)[0];
            }
            setNomePorEmail(mapa);
        } catch (error) {
            console.error('Error fetching sellers:', error);
        }
    };

    const nomeCurto = (email: string | null): string => {
        if (!email) return '';
        const e = email.toLowerCase();
        return nomePorEmail[e] || e.split('@')[0];
    };

    /** Grava o toque. Devolve true quando gravou, para o modal de roteiro poder fechar. */
    const registrarToque = async (prospect: Prospect, canal: CanalToque): Promise<boolean> => {
        if (salvandoToque) return false;
        setSalvandoToque(true);
        try {
            const { data, error } = await supabase
                .from('prospect_toques')
                .insert({ prospect_id: prospect.id, canal })
                .select('prospect_id, canal, autor_email, created_at')
                .single();
            if (error) throw error;
            setToquesPorLead(prev => {
                const atual: ToquesDoLead = prev[prospect.id]
                    ? { ...prev[prospect.id], qtd: { ...prev[prospect.id].qtd } }
                    : { qtd: {}, total: 0, ultimo: data.created_at };
                atual.total += 1;
                atual.qtd[canal] = (atual.qtd[canal] || 0) + 1;
                atual.ultimo = data.created_at;
                atual[canal] = { em: data.created_at, autor: data.autor_email };
                return { ...prev, [prospect.id]: atual };
            });
            setProspects(prev => prev.map(p => p.id === prospect.id ? { ...p, ult_contato: data.created_at } : p));
            if (canal === 'whatsapp' && data.autor_email) {
                const autor = String(data.autor_email).toLowerCase();
                setWhatsHojePorAutor(prev => ({ ...prev, [autor]: (prev[autor] || 0) + 1 }));
            }
            toast(`${ROTULO_CANAL[canal]} registrad${canal === 'ligacao' ? 'a' : 'o'} no card.`, 'success');
            return true;
        } catch (error) {
            console.error('Error registrando toque:', error);
            toast('Não consegui registrar o contato. Tente de novo.', 'error');
            return false;
        } finally {
            setSalvandoToque(false);
            setConfirmandoToque(null);
        }
    };

    /**
     * Qual lead já teve o primeiro e-mail e qual ainda espera.
     *
     * Duas leituras em vez de um join: o PostgREST só aceita embed com chave
     * estrangeira declarada, e email_envios.contato_id não tem uma. Como as
     * duas tabelas já passam de 1.000 linhas, as duas paginam.
     */
    const fetchCadencia = async () => {
        try {
            const contatos = await buscarTodasLinhas<{ id: string; prospect_id: string | null }>(
                'email_cadencia', 'id, prospect_id');
            const envios = await buscarTodasLinhas<{ contato_id: string; enviado_em: string }>(
                'email_envios', 'contato_id, enviado_em', (q) => q.eq('ordem', 1));
            const envioPorContato = new Map(envios.map(e => [e.contato_id, e.enviado_em]));
            const mapa: Record<string, CadenciaDoLead> = {};
            for (const c of contatos) {
                if (!c.prospect_id) continue;
                const iniciadaEm = envioPorContato.get(c.id) ?? null;
                // Um lead pode ter mais de um contato (recadastro): vale o que
                // já começou a trilha, senão o primeiro que apareceu.
                const atual = mapa[c.prospect_id];
                if (!atual || (!atual.iniciadaEm && iniciadaEm)) {
                    mapa[c.prospect_id] = { contatoId: c.id, iniciadaEm };
                }
            }
            setCadenciaPorLead(mapa);
        } catch (error) {
            console.error('Error fetching cadencia:', error);
        }
    };

    /**
     * Estado do botão "E-mail da licitação" no card.
     * Só leads da prospecção automática do PNCP têm esse primeiro contato;
     * Radar, garimpo, manual, saúde e energia não mudam nada.
     */
    const estadoE1 = (p: Prospect): { estado: EstadoE1; iniciadaEm: string | null } => {
        if (p.source !== 'pncp_auto') return { estado: 'oculto', iniciadaEm: null };
        const c = cadenciaPorLead[p.id];
        // Sem linha na cadência (lead manual antigo) também espera: a função
        // cria a linha na hora do envio.
        if (c?.iniciadaEm) return { estado: 'iniciada', iniciadaEm: c.iniciadaEm };
        return { estado: 'aguardando', iniciadaEm: null };
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
    const handleAddColumn = async () => {
        if (!newColTitle.trim()) return;
        const id = `col_${Date.now()}`;
        const novaCol = { id, title: newColTitle.trim(), color: newColColor };
        const ordem = columns.length * 10;
        const { error } = await supabase.from('kanban_colunas').insert({ ...novaCol, protected: false, ordem });
        if (error) {
            console.error('Erro ao criar coluna:', error);
            alert('Não foi possível criar a coluna. Tente de novo.');
            return;
        }
        setColumns([...columns, novaCol]);
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

        const { error } = await supabase.from('kanban_colunas').delete().eq('id', colId);
        if (error) {
            console.error('Erro ao excluir coluna:', error);
            alert('Não foi possível excluir a coluna. Tente de novo.');
            recarregarColunas();
            return;
        }
        setColumns(columns.filter(c => c.id !== colId));
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
            salvarOrdemColunas(updatedColumns).catch(err => {
                console.error('Erro ao salvar a ordem das colunas:', err);
                alert('Não foi possível salvar a nova ordem das colunas.');
                recarregarColunas();
            });
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
        setColumns(prev => prev.map(c => (c.id === colId ? { ...c, title: nextTitle } : c)));
        cancelRenameColumn();
        supabase.from('kanban_colunas')
            .update({ title: nextTitle, updated_at: new Date().toISOString() })
            .eq('id', colId)
            .then(({ error }) => {
                if (error) {
                    console.error('Erro ao renomear coluna:', error);
                    alert('Não foi possível renomear a coluna.');
                    recarregarColunas();
                }
            });
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

    const toggleLeadSelection = (prospectId: string) => {
        setSelectedLeadIds(prev => {
            const next = new Set(prev);
            if (next.has(prospectId)) next.delete(prospectId);
            else next.add(prospectId);
            return next;
        });
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedLeadIds(new Set());
    };

    const handleBulkDelete = async () => {
        const count = selectedLeadIds.size;
        if (count === 0) return;
        if (!confirm(`Deseja excluir ${count} lead(s) permanentemente? Esta ação não pode ser desfeita.`)) return;
        const ids = Array.from(selectedLeadIds);
        setProspects(prev => prev.filter(p => !selectedLeadIds.has(p.id)));
        exitSelectionMode();
        try {
            await supabase.from('prospects').delete().in('id', ids);
        } catch (error) {
            console.error('Error bulk deleting leads:', error);
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

    /**
     * Fecha o modal de editar lead avisando se houver alteração não salva.
     *
     * Aqui não usamos salvamento automático de propósito: salvar carimba a
     * observação com data/hora no histórico e reinicia o "tempo na coluna"
     * quando a fase muda. Gravar sozinho a cada tecla encheria o histórico de
     * entradas pela metade. Então protegemos o trabalho com um aviso na saída.
     */
    const fecharEdicaoLead = () => {
        const alterouCampos =
            !!editingLead &&
            Object.entries(editLeadForm).some(([chave, valor]) => {
                if (chave === 'tasks' || chave === 'created_at' || chave === 'description') return false;
                const original = (editingLead as any)[chave];
                return (valor ?? '') !== (original ?? '');
            });
        const temObservacaoPendente = editObservationText.trim().length > 0;
        const temLimitePendente =
            (editCurrentLimit.seguradora || '').trim().length > 0 ||
            (editCurrentLimit.valor || '').trim().length > 0;

        if (alterouCampos || temObservacaoPendente || temLimitePendente) {
            if (!window.confirm('Você alterou este lead e ainda não salvou. Fechar mesmo assim?')) return;
        }
        setIsEditModalOpen(false);
        setEditingLead(null);
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
            const existingLeads = await buscarTodosProspects<{ cnpj?: string | null; email?: string | null }>('cnpj, email');
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
                    product_type: csvProductType,
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
                product_type: newLeadForm.product_type || 'Seguro Garantia',
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

    // ── E-mail da licitação: prévia e envio ──────────────────────────────────

    /** Chama a Edge Function. Devolve o corpo da resposta e o status HTTP. */
    const chamarCadencia = async (body: Record<string, unknown>) => {
        const { data, error } = await supabase.functions.invoke('prospecting-cadence', { body });
        if (error) {
            // A função responde 409/422 com a mensagem no corpo; o supabase-js
            // trata status >= 400 como erro e esconde o corpo no context.
            let msg = error.message || 'Erro ao falar com a função.';
            try {
                const corpo = await (error as { context?: Response }).context?.json?.();
                if (corpo?.error) msg = corpo.error;
            } catch { /* mantém a mensagem genérica */ }
            return { ok: false as const, erro: msg };
        }
        if (data?.success === false) return { ok: false as const, erro: data.error || 'A função recusou o envio.' };
        return { ok: true as const, data };
    };

    const abrirEmailLicitacao = async (prospect: Prospect) => {
        setOpenMenuId(null);
        setLeadEmailLicitacao(prospect);
        setEmailLicPara(''); setEmailLicNome(''); setEmailLicAssunto(''); setEmailLicCorpo('');
        setEmailLicHtml(''); setEmailLicAvisos([]); setEmailLicErro('');
        setEmailLicCarregando(true);
        const r = await chamarCadencia({ modo: 'licitacao_preview', prospect_id: prospect.id });
        setEmailLicCarregando(false);
        if (!r.ok) { setEmailLicErro(r.erro); return; }
        setEmailLicPara(r.data.para || '');
        setEmailLicNome(r.data.nome_contato || '');
        setEmailLicAssunto(r.data.assunto || '');
        setEmailLicCorpo(r.data.corpo_texto || '');
        setEmailLicHtml(r.data.html || '');
        setEmailLicAvisos(r.data.avisos || []);
    };

    const fecharEmailLicitacao = () => {
        setLeadEmailLicitacao(null);
        setEmailLicHtml(''); setEmailLicAvisos([]); setEmailLicErro('');
    };

    // Prévia refeita a cada edição, com folga de 600 ms para não chamar a
    // função a cada tecla. A prévia é o que o envio manda, então ela precisa
    // acompanhar o que está escrito na tela.
    useEffect(() => {
        if (!leadEmailLicitacao) return;
        if (!emailLicAssunto && !emailLicCorpo) return;
        const id = setTimeout(async () => {
            setEmailLicCarregando(true);
            const r = await chamarCadencia({
                modo: 'licitacao_preview',
                prospect_id: leadEmailLicitacao.id,
                email: emailLicPara,
                nome_contato: emailLicNome,
                assunto: emailLicAssunto,
                corpo: emailLicCorpo,
            });
            setEmailLicCarregando(false);
            if (!r.ok) { setEmailLicErro(r.erro); return; }
            setEmailLicErro('');
            setEmailLicHtml(r.data.html || '');
            setEmailLicAvisos(r.data.avisos || []);
        }, 600);
        return () => clearTimeout(id);
    }, [leadEmailLicitacao?.id, emailLicPara, emailLicNome, emailLicAssunto, emailLicCorpo]);

    const enviarEmailLicitacao = async () => {
        if (!leadEmailLicitacao) return;
        setEmailLicEnviando(true);
        setEmailLicErro('');
        const r = await chamarCadencia({
            modo: 'licitacao_enviar',
            prospect_id: leadEmailLicitacao.id,
            email: emailLicPara,
            nome_contato: emailLicNome,
            assunto: emailLicAssunto,
            corpo: emailLicCorpo,
        });
        setEmailLicEnviando(false);
        if (!r.ok) { setEmailLicErro(r.erro); return; }
        toast(`E-mail da licitação enviado para ${r.data.para}. A trilha segue sozinha do 2º e-mail em diante.`, 'success');
        fecharEmailLicitacao();
        await Promise.all([fetchProspects(), fetchCadencia()]);
    };

    const filteredProspects = prospects.filter(p => {
        const matchesProduct = !productFilter ||
            p.product_type === productFilter ||
            (!p.product_type && productFilter === 'Seguro Garantia');
        const matchesSearch = (p.company?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.email?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.cnpj || '').includes(searchQuery) ||
            (p.tags || []).some(t => (t || '').toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesTag = !tagFilter || (p.tags || []).includes(tagFilter);
        const matchesHomologadas = !soHomologadasPncp ||
            (p.source === 'pncp_auto' && !!p.data_homologacao);
        const matchesAguardando = !soAguardandoE1 || estadoE1(p).estado === 'aguardando';
        const matchesSemContato = !soSemContato || !toquesPorLead[p.id];
        const matchesArquivo = verArquivoPncp ? p.status === STATUS_ARQUIVO_PNCP : p.status !== STATUS_ARQUIVO_PNCP;
        return matchesProduct && matchesTag && matchesSearch && matchesHomologadas && matchesAguardando && matchesSemContato && matchesArquivo;
    });

    // Tags existentes nos leads carregados, da mais usada para a menos usada.
    const tagOptions: { tag: string; qtd: number }[] = (() => {
        const contagem = new Map<string, number>();
        for (const p of prospects) {
            for (const t of p.tags || []) {
                if (!t) continue;
                contagem.set(t, (contagem.get(t) || 0) + 1);
            }
        }
        return Array.from(contagem, ([tag, qtd]) => ({ tag, qtd }))
            .sort((x, y) => y.qtd - x.qtd || x.tag.localeCompare(y.tag, 'pt-BR'));
    })();

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 size={40} className="animate-spin mb-4 text-gold" />
                <p className="font-bold uppercase tracking-widest text-xs">Carregando prospectos...</p>
            </div>
        );
    }



    return (
        <div className="space-y-6">

            {/* Action Bar */}
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Product filter */}
                    <select
                        value={productFilter}
                        onChange={e => setProductFilter(e.target.value)}
                        className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold shadow-sm cursor-pointer transition-all"
                    >
                        <option value="">Todos os produtos</option>
                        {PRODUCT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                    </select>
                    {/* Tag filter */}
                    <select
                        value={tagFilter}
                        onChange={e => setTagFilter(e.target.value)}
                        className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold shadow-sm cursor-pointer transition-all"
                        title="Filtrar por tag"
                    >
                        <option value="">Todas as tags</option>
                        {tagOptions.map(({ tag, qtd }) => <option key={tag} value={tag}>{tag} ({qtd})</option>)}
                    </select>
                    <div className="h-8 w-[1px] bg-slate-200 hidden md:block" />
                    <button onClick={() => { setIsNewLeadModalOpen(true); setNewLimitesArray([]); setNewCurrentLimit({ seguradora: '', valor: '' }); setNewLeadForm({ status: 'Novos Leads' }); }} className="bg-navy hover:bg-navy-light text-areia border border-gold/35 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2">
                        <Plus size={18} /> Novo Lead
                    </button>
                    <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                    <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-navy-light hover:bg-navy text-areia border border-gold/35 px-5 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2 disabled:opacity-70">
                        {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                        {importing ? 'Importando...' : 'Importar Leads (CSV)'}
                    </button>
                    <div className="h-8 w-[1px] bg-slate-200 mx-1 hidden md:block" />
                    <button onClick={() => setIsAddColumnOpen(true)} className="bg-white border border-slate-200 hover:border-gold/40 hover:bg-gold/10 text-slate-600 hover:text-navy px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm flex items-center gap-2">
                        <LayoutGrid size={16} /> Nova Coluna
                    </button>
                    <button
                        onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                        className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm flex items-center gap-2 border ${selectionMode ? 'bg-rose-600 border-rose-600 text-white hover:bg-rose-700' : 'bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50'}`}
                    >
                        <Trash2 size={15} /> {selectionMode ? 'Cancelar' : 'Selecionar'}
                    </button>
                </div>
                <div className="w-full md:w-64 flex flex-col gap-2">
                    <div className="relative w-full">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="Procurar leads..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold shadow-sm transition-all" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Tempo</label>
                        <select
                            value={leadAgeSort}
                            onChange={(e) => {
                                const v = e.target.value;
                                setLeadAgeSort(v === 'oldest' ? 'oldest' : v === 'homologacao' ? 'homologacao' : 'recent');
                            }}
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold shadow-sm transition-all cursor-pointer"
                        >
                            <option value="recent">Menor tempo primeiro</option>
                            <option value="oldest">Maior tempo primeiro</option>
                            <option value="homologacao">Homologação mais recente (PNCP)</option>
                        </select>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={soHomologadasPncp}
                            onChange={(e) => setSoHomologadasPncp(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-navy focus:ring-gold/30 cursor-pointer"
                        />
                        <span className="text-[12px] font-bold text-slate-600">Só homologadas do PNCP</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={soSemContato}
                            onChange={(e) => setSoSemContato(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-navy focus:ring-gold/30 cursor-pointer"
                        />
                        <span className="text-[12px] font-bold text-slate-600">Sem contato ainda</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none" title="Leads do PNCP com homologação há mais de 30 dias e sem contato, tirados do quadro automaticamente">
                        <input
                            type="checkbox"
                            checked={verArquivoPncp}
                            onChange={(e) => setVerArquivoPncp(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-navy focus:ring-gold/30 cursor-pointer"
                        />
                        <span className="text-[12px] font-bold text-slate-600">
                            Ver arquivo PNCP ({prospects.filter(p => p.status === STATUS_ARQUIVO_PNCP).length})
                        </span>
                    </label>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex gap-6 overflow-x-auto pb-8 custom-scroll items-start">
                {columns.map(column => {
                    const columnProspects = filteredProspects.filter(p => {
                        if (column.id === 'Novos Leads') {
                            const validIds = columns.map(c => c.id);
                            return p.status === column.id || !validIds.includes(p.status);
                        }
                        return p.status === column.id;
                    }).sort((a, b) => {
                        // 'homologacao' => leads do PNCP com homologação mais recente primeiro
                        // (empate: maior valor homologado); os demais vêm depois, pelo tempo na coluna.
                        if (leadAgeSort === 'homologacao') {
                            const ha = a.data_homologacao || '';
                            const hb = b.data_homologacao || '';
                            if (ha && hb) {
                                if (ha !== hb) return ha < hb ? 1 : -1;
                                return (Number(b.valor_contrato) || 0) - (Number(a.valor_contrato) || 0);
                            }
                            if (ha) return -1;
                            if (hb) return 1;
                        }
                        // 'recent' => maior data primeiro (menor tempo na coluna primeiro)
                        // 'oldest' => menor data primeiro (maior tempo na coluna primeiro)
                        const ta = getLeadEnteredAtMs(a);
                        const tb = getLeadEnteredAtMs(b);
                        if (!ta && !tb) return 0;
                        if (!ta) return 1;
                        if (!tb) return -1;
                        return leadAgeSort === 'oldest' ? (ta - tb) : (tb - ta);
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
                            className={`flex-shrink-0 w-80 flex flex-col gap-4 max-h-[calc(100dvh-230px)] overflow-hidden transition-all ${draggingCol === column.id ? 'opacity-40 scale-95' : 'opacity-100'}`} 
                            onDragOver={handleDragOver} 
                            onDrop={(e) => handleDrop(e, column.id)}
                        >
                            {/* Column Header */}
                            <div className={`shrink-0 p-4 rounded-xl shadow-sm flex flex-col gap-1 cursor-grab active:cursor-grabbing ${headerClass}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2 min-w-0">
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
                                                className="w-full max-w-[190px] px-2 py-1 rounded-xl bg-white/20 border border-white/30 text-white placeholder-white/70 outline-none focus:ring-2 focus:ring-white/30 font-bold tracking-wider uppercase text-sm"
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
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-xl bg-white/20 text-white">
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

                                {/* A fila do dia: leads do PNCP que entraram e ainda não
                                    receberam o primeiro e-mail. Conta sobre todos os leads,
                                    não sobre a coluna, para o número não mudar com o filtro
                                    ligado (senão viraria sempre o total filtrado). */}
                                {column.id === 'Novos Leads' && (() => {
                                    const naFila = prospects.filter(p => estadoE1(p).estado === 'aguardando').length;
                                    if (!naFila && !soAguardandoE1) return null;
                                    return (
                                        <button
                                            type="button"
                                            draggable={false}
                                            onClick={(e) => { e.stopPropagation(); setSoAguardandoE1(v => !v); }}
                                            title={soAguardandoE1
                                                ? 'Mostrar todos os leads de novo'
                                                : 'Filtrar só os leads que esperam o primeiro e-mail'}
                                            className={`mt-1 self-start inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                                                soAguardandoE1
                                                    ? 'bg-amber-400 text-navy border-amber-300'
                                                    : 'bg-white/15 text-white border-white/25 hover:bg-white/25'
                                            }`}
                                        >
                                            <Clock size={11} /> Aguardando 1º e-mail ({naFila})
                                        </button>
                                    );
                                })()}
                            </div>

                            {/* Cards — min-h-0 obrigatório no flex para overflow-y funcionar */}
                            <div className={`flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto overflow-x-hidden custom-scroll rounded-2xl p-1.5 transition-colors ${isDragging ? 'bg-slate-100/50 border border-dashed border-slate-300' : 'bg-transparent'}`}>
                                {columnProspects.map(prospect => {
                                    const isSelected = selectedLeadIds.has(prospect.id);
                                    const enteredAtMs = getLeadEnteredAtMs(prospect);
                                    const ageLabel = formatLeadAge(enteredAtMs);
                                    return (
                                    <div
                                        key={prospect.id}
                                        draggable={!selectionMode}
                                        onDragStart={(e) => { if (!selectionMode) handleDragStart(e, prospect.id); }}
                                        onDragEnd={handleDragEnd}
                                        onClick={() => { if (selectionMode) toggleLeadSelection(prospect.id); else handleOpenEdit(prospect); }}
                                        title={selectionMode ? undefined : 'Clique para editar o lead'}
                                        className={`rounded-xl p-3 shadow-sm border transition-all flex flex-col gap-2 cursor-pointer active:cursor-grabbing ${isSelected ? 'bg-rose-50 border-rose-400 shadow-md ring-2 ring-rose-300' : 'bg-white border-slate-200 hover:shadow-md hover:border-gold/40'}`}
                                    >
                                        {/* Grupo 1: empresa, ramo e produto */}
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-start gap-2 min-w-0">
                                                {selectionMode && (
                                                    <div className={`w-5 h-5 rounded-md border-2 shrink-0 mt-0.5 flex items-center justify-center transition-all ${isSelected ? 'bg-rose-600 border-rose-600' : 'border-slate-300 bg-white'}`}>
                                                        {isSelected && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <h4 className="font-bold text-slate-800 text-sm truncate" title={prospect.company || prospect.name}>
                                                        {prospect.company || prospect.name || 'Nova Empresa'}
                                                    </h4>
                                                    {prospect.ramo && prospect.ramo !== 'nan' && (
                                                        <p className="text-[12px] text-slate-500 truncate">{prospect.ramo}</p>
                                                    )}
                                                    {prospect.product_type && (
                                                        <span className={`mt-1 inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md border truncate max-w-[180px] ${PRODUCT_BADGE[prospect.product_type] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                            {prospect.product_type}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {!selectionMode && <div className="relative" ref={openMenuId === prospect.id ? menuRef : null}>
                                                    <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === prospect.id ? null : prospect.id); }} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1 transition-colors">
                                                        <MoreVertical size={16} />
                                                    </button>
                                                    {openMenuId === prospect.id && (
                                                        <div className="absolute right-0 top-8 z-50 w-52 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
                                                            <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mover para</p>
                                                            {columns.filter(col => col.id !== prospect.status).map(col => (
                                                                <button key={col.id} onClick={() => handleMoveToColumn(prospect.id, col.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                                                    <MoveRight size={14} className="text-slate-400" /> {col.title}
                                                                </button>
                                                            ))}
                                                            {onConvertToSale && (
                                                                <div className="border-t border-slate-100">
                                                                    <button onClick={() => handleConvertToSale(prospect)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-navy hover:bg-gold/10 transition-colors">
                                                                        <TrendingUp size={15} className="text-gold" /> Converter em Venda
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
                                                </div>}
                                            </div>
                                        </div>

                                        {/* Grupo 2: contato principal */}
                                        {((prospect.decisor && prospect.decisor !== 'nan') || (prospect.phonenumber && prospect.phonenumber !== 'nan')) && (
                                            <div className="flex flex-col gap-1">
                                                {prospect.decisor && prospect.decisor !== 'nan' && (
                                                    <p className="text-[12px] text-slate-600 truncate">{prospect.decisor}</p>
                                                )}
                                                {prospect.phonenumber && prospect.phonenumber !== 'nan' && (
                                                    <div className="flex items-center gap-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                                                        <Phone size={12} className="text-slate-400 shrink-0" />
                                                        <WhatsAppPhoneLink phone={prospect.phonenumber} className="truncate min-w-0 text-[12px] text-slate-600" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Grupo PNCP: homologação, valor homologado e edital */}
                                        {prospect.source === 'pncp_auto' && (() => {
                                            const dias = diasDesdeData(prospect.data_homologacao);
                                            const linkEdital = urlEditalPncp(prospect.numero_licitacao);
                                            const valorHomologado = Number(prospect.valor_contrato) || 0;
                                            return (
                                                <div className="flex flex-col gap-1.5">
                                                    {dias !== null ? (
                                                        <span
                                                            className={`self-start inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md border ${classeSeloHomologacao(dias)}`}
                                                            title="Data em que a homologação apareceu no PNCP"
                                                        >
                                                            Homologada em {dataCurtaBr(prospect.data_homologacao)} · {rotuloDias(dias)}
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className="self-start inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md border bg-slate-50 text-slate-500 border-slate-200"
                                                            title="Lead anterior a 10/09/2026, captado pelo contrato publicado (pode já estar com contrato assinado)"
                                                        >
                                                            PNCP · regra antiga (contrato)
                                                        </span>
                                                    )}
                                                    <div className="flex items-center justify-between gap-2 min-w-0">
                                                        {valorHomologado > 0 ? (
                                                            <span className="text-[11px] text-slate-600 truncate" title={prospect.orgao_licitante || undefined}>
                                                                {dias !== null ? 'Homologado' : 'Contrato'} {formatCurrency(valorHomologado)}
                                                            </span>
                                                        ) : <span />}
                                                        {linkEdital && (
                                                            <a
                                                                href={linkEdital}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                draggable={false}
                                                                onClick={(e) => e.stopPropagation()}
                                                                title="Abrir a licitação no PNCP (edital e anexos)"
                                                                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-800 hover:underline"
                                                            >
                                                                Ver edital <ExternalLink size={11} />
                                                            </a>
                                                        )}
                                                    </div>

                                                    {/* E-mail da licitação: o 1º contato, enviado à mão.
                                                        Aguardando = botão livre; trilha iniciada = travado
                                                        com a data, porque o E1 já saiu e o cron cuida do resto. */}
                                                    {(() => {
                                                        const { estado, iniciadaEm } = estadoE1(prospect);
                                                        if (estado === 'oculto') return null;
                                                        if (estado === 'iniciada') {
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    disabled
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    title={`Trilha iniciada em ${diaMesBrDeTimestamp(iniciadaEm)}`}
                                                                    className="self-start inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed"
                                                                >
                                                                    <CheckCircle2 size={12} /> Trilha iniciada em {diaMesBrDeTimestamp(iniciadaEm)}
                                                                </button>
                                                            );
                                                        }
                                                        return (
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span
                                                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200"
                                                                    title="O lead entrou sem receber e-mail e está na fila do primeiro contato"
                                                                >
                                                                    <Clock size={10} /> Aguardando 1º e-mail
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    draggable={false}
                                                                    onClick={(e) => { e.stopPropagation(); abrirEmailLicitacao(prospect); }}
                                                                    title="Abrir a prévia do e-mail desta licitação"
                                                                    className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-navy text-areia border border-gold/35 hover:bg-navy-light transition-colors"
                                                                >
                                                                    <Mail size={12} /> E-mail da licitação
                                                                </button>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            );
                                        })()}

                                        {/* Grupo toques: WhatsApp e e-mail enviados à mão, com confirmação */}
                                        {(() => {
                                            const t = toquesPorLead[prospect.id];
                                            const diasUltimo = t ? diasDesdeTimestamp(t.ultimo) : null;
                                            const emAlerta = diasUltimo !== null && diasUltimo >= TOQUE_ALERTA_DIAS;
                                            const confirmando = confirmandoToque?.id === prospect.id ? confirmandoToque.canal : null;
                                            const selo = (canal: CanalToque, toque: ToqueCanal) => (
                                                <span
                                                    key={canal}
                                                    title={`${ROTULO_CANAL[canal]} em ${new Date(toque.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}
                                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border bg-slate-50 text-slate-600 border-slate-200"
                                                >
                                                    {canal === 'whatsapp' ? <MessageCircle size={10} /> : canal === 'ligacao' ? <Phone size={10} /> : <Mail size={10} />}
                                                    {ROTULO_CANAL[canal]} {diaMesBrDeTimestamp(toque.em)}
                                                    {toque.autor ? ` · ${nomeCurto(toque.autor)}` : ''}
                                                </span>
                                            );
                                            return (
                                                <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                    {t && (
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            {t.whatsapp && selo('whatsapp', t.whatsapp)}
                                                            {t.email && selo('email', t.email)}
                                                            {t.ligacao && selo('ligacao', t.ligacao)}
                                                            <span className="text-[10px] font-bold text-slate-400">
                                                                {t.total} {t.total === 1 ? 'contato' : 'contatos'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {emAlerta && (
                                                        <span
                                                            className="self-start inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200"
                                                            title={`Último contato há ${diasUltimo} dias. Hora de cobrar retorno ou mudar o card de coluna.`}
                                                        >
                                                            <Clock size={10} /> Último contato há {diasUltimo} dias
                                                        </span>
                                                    )}
                                                    {confirmando ? (
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                draggable={false}
                                                                disabled={salvandoToque}
                                                                onClick={(e) => { e.stopPropagation(); registrarToque(prospect, confirmando); }}
                                                                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-navy text-areia border border-gold/35 hover:bg-navy-light transition-colors disabled:opacity-60"
                                                            >
                                                                {salvandoToque ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                                                Confirmar {confirmando === 'whatsapp' ? 'WhatsApp' : 'e-mail'} enviado
                                                            </button>
                                                            <button
                                                                type="button"
                                                                draggable={false}
                                                                disabled={salvandoToque}
                                                                onClick={(e) => { e.stopPropagation(); setConfirmandoToque(null); }}
                                                                className="text-[11px] font-bold text-slate-500 hover:text-slate-700"
                                                            >
                                                                Cancelar
                                                            </button>
                                                        </div>
                                                    ) : grupoDoLead(prospect.source) ? (() => {
                                                        // Leads dos garimpos: os botões abrem o roteiro do grupo.
                                                        const celular = tipoTelefone(normalizarTelefone(prospect.phonenumber)) === 'celular';
                                                        return (
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    draggable={false}
                                                                    onClick={(e) => { e.stopPropagation(); setRoteiroAberto({ leadId: prospect.id, modo: celular ? 'whatsapp' : 'ligacao' }); }}
                                                                    title={celular ? 'Abrir a mensagem de WhatsApp deste lead' : 'Telefone fixo ou incompleto: abrir o roteiro de ligação'}
                                                                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy transition-colors"
                                                                >
                                                                    {celular ? <><MessageCircle size={12} /> WhatsApp</> : <><Phone size={12} /> Ligação</>}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    draggable={false}
                                                                    onClick={(e) => { e.stopPropagation(); setRoteiroAberto({ leadId: prospect.id, modo: prospect.email ? 'email' : 'sem-email' }); }}
                                                                    title="Abrir o e-mail deste lead"
                                                                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy transition-colors"
                                                                >
                                                                    <Mail size={12} /> E-mail
                                                                </button>
                                                            </div>
                                                        );
                                                    })() : (
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                draggable={false}
                                                                onClick={(e) => { e.stopPropagation(); setConfirmandoToque({ id: prospect.id, canal: 'whatsapp' }); }}
                                                                title="Registrar que um WhatsApp foi enviado a este lead"
                                                                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy transition-colors"
                                                            >
                                                                <MessageCircle size={12} /> WhatsApp
                                                            </button>
                                                            <button
                                                                type="button"
                                                                draggable={false}
                                                                onClick={(e) => { e.stopPropagation(); setConfirmandoToque({ id: prospect.id, canal: 'email' }); }}
                                                                title="Registrar que um e-mail foi enviado a este lead"
                                                                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-white text-slate-600 border-slate-200 hover:border-gold/40 hover:text-navy transition-colors"
                                                            >
                                                                <Mail size={12} /> E-mail
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {/* Grupo 3: valor estimado e idade do lead */}
                                        <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                                            <span className="text-[12px] font-bold text-navy">{formatCurrency(prospect.lead_value || 0)}</span>
                                            {ageLabel && <span className="text-[10px] font-bold text-gold">{ageLabel}</span>}
                                        </div>
                                    </div>
                                    );
                                })}
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
                    <button onClick={() => setIsAddColumnOpen(true)} className="w-full flex items-center justify-center gap-2 p-5 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-gold/45 hover:text-navy hover:bg-gold/8 transition-all font-bold text-sm">
                        <Plus size={18} /> Nova Coluna
                    </button>
                </div>
            </div>

            {/* ── BULK DELETE FLOATING BAR ── */}
            {selectionMode && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-navy text-white px-6 py-3.5 rounded-2xl shadow-2xl border border-gold/30 animate-in slide-in-from-bottom-4 duration-200">
                    <span className="text-sm font-bold">
                        {selectedLeadIds.size === 0
                            ? 'Clique nos leads para selecionar'
                            : `${selectedLeadIds.size} lead(s) selecionado(s)`}
                    </span>
                    {selectedLeadIds.size > 0 && (
                        <button
                            onClick={handleBulkDelete}
                            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl font-bold text-sm transition-colors"
                        >
                            <Trash2 size={15} /> Excluir Selecionados
                        </button>
                    )}
                    <button
                        onClick={exitSelectionMode}
                        className="text-slate-400 hover:text-white transition-colors p-1 rounded-xl hover:bg-white/10"
                        title="Cancelar"
                    >
                        <X size={18} />
                    </button>
                </div>
            )}

            {/* ── ADD COLUMN MODAL ── */}
            {isAddColumnOpen && (
                <ModalPortal>
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 overflow-hidden">
                          <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                              <div>
                                  <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><LayoutGrid size={20} className="text-gold" /> Nova Coluna</h3>
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
                                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all font-medium"
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
                                              className={`h-10 rounded-xl ${opt.header} transition-all font-bold text-[10px] flex items-center justify-center ${newColColor === opt.key ? 'ring-4 ring-offset-2 ring-gold scale-105' : 'opacity-70 hover:opacity-100'}`}
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
                              <button onClick={handleAddColumn} disabled={!newColTitle.trim()} className="bg-navy hover:bg-navy-light text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-40">
                                  <Plus size={18} /> Criar Coluna
                              </button>
                          </div>
                      </div>
                  </div>
                </ModalPortal>
            )}

            {/* ── NEW LEAD MODAL ── */}
            {isNewLeadModalOpen && (
                <ModalPortal>
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                          <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                              <div>
                                  <h3 className="text-xl font-black text-slate-800">Criar Novo Lead</h3>
                                  <p className="text-sm text-slate-500 font-medium mt-1">Cadastre manualmente os dados da prospecção.</p>
                              </div>
                              <button onClick={() => setIsNewLeadModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                          </div>
                          <div className="p-8 overflow-y-auto custom-scroll flex-1">
                                      <form id="new-lead-form" onSubmit={handleCreateNewLead}>
                                          <LeadFormFields form={newLeadForm} setForm={setNewLeadForm} columns={columns} />
                              </form>
                            
                              {/* Insurer Limits Section for New Lead */}
                              <div className="mt-8 pt-6 border-t border-slate-100 space-y-4">
                                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Limites de Seguradoras</h4>
                                  {newLimitesArray.length > 0 && (
                                      <div className="space-y-2">
                                          {newLimitesArray.map((lim, i) => (
                                              <div key={i} className="flex items-center gap-2 bg-gold/10 px-3 py-2 rounded-xl border border-gold/25">
                                                  <span className="flex-1 text-sm font-bold text-navy">{lim.seguradora}</span>
                                                  <span className="text-sm font-bold text-gold-hover">{lim.valor}</span>
                                                  <button
                                                      type="button"
                                                      onClick={() => setNewLimitesArray(prev => prev.filter((_, idx) => idx !== i))}
                                                      className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
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
                                          className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
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
                                          className="w-32 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
                                      />
                                      <button
                                          type="button"
                                          onClick={() => {
                                              if (!newCurrentLimit.seguradora) return;
                                              setNewLimitesArray(prev => [...prev, newCurrentLimit]);
                                              setNewCurrentLimit({ seguradora: '', valor: '' });
                                          }}
                                          className="px-4 py-2 bg-navy hover:bg-navy-light text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center whitespace-nowrap shadow-md shrink-0"
                                      >
                                          Adicionar
                                      </button>
                                  </div>
                              </div>
                          </div>
                          <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                              <button type="button" onClick={() => setIsNewLeadModalOpen(false)} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                              <button type="submit" form="new-lead-form" disabled={savingLead} className="bg-navy hover:bg-navy-light text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-50">
                                  {savingLead ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                  {savingLead ? 'Salvando...' : 'Salvar Lead'}
                              </button>
                          </div>
                      </div>
                  </div>
                </ModalPortal>
            )}

            {/* ── MODAL DOS ROTEIROS (leads dos garimpos) ── */}
            {roteiroAberto && (() => {
                const lead = prospects.find(p => p.id === roteiroAberto.leadId);
                const grupo = lead ? grupoDoLead(lead.source) : null;
                if (!lead || !grupo) return null;
                const t = toquesPorLead[lead.id];
                return (
                    <KanbanRoteiroModal
                        lead={lead}
                        grupo={grupo}
                        modo={roteiroAberto.modo}
                        roteiros={roteiros}
                        whatsEnviados={t?.qtd.whatsapp || 0}
                        ultimoWhatsEm={t?.whatsapp?.em}
                        whatsHoje={whatsHojePorAutor[meuEmail] || 0}
                        remetentePadrao={nomePorEmail[meuEmail] || ''}
                        salvando={salvandoToque}
                        onRegistrar={(canal) => registrarToque(lead, canal)}
                        onTrocarModo={(modo) => setRoteiroAberto({ leadId: lead.id, modo })}
                        onFechar={() => setRoteiroAberto(null)}
                    />
                );
            })()}

            {/* ── MODAL DO E-MAIL DA LICITAÇÃO ──
                O primeiro contato do lead do PNCP. Nada sai daqui sem o clique
                em Enviar: a esquerda edita, a direita mostra exatamente o que
                vai sair, montado pela própria Edge Function que envia. */}
            {leadEmailLicitacao && (
                <ModalPortal>
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                          <div className="flex justify-between items-center p-6 border-b border-gold/20 bg-gold/10">
                              <div className="min-w-0">
                                  <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                      <Mail size={20} className="text-gold" /> E-mail da licitação
                                  </h3>
                                  <p className="text-sm text-slate-500 font-medium mt-1 truncate">
                                      {leadEmailLicitacao.company || leadEmailLicitacao.name}
                                      {leadEmailLicitacao.orgao_licitante ? ` · ${leadEmailLicitacao.orgao_licitante}` : ''}
                                  </p>
                                  <p className="text-[11px] text-slate-500 font-bold mt-1">
                                      Este envio conta como o 1º e-mail da trilha. O 2º sai sozinho em 3 dias.
                                  </p>
                              </div>
                              <button onClick={fecharEmailLicitacao} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm shrink-0">
                                  <X size={20} />
                              </button>
                          </div>

                          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
                              {/* Esquerda: o que o Fábio ajusta */}
                              <div className="p-6 overflow-y-auto custom-scroll space-y-4 border-r border-slate-100">
                                  <div className="space-y-1.5">
                                      <label className="text-sm font-bold text-slate-700">Para</label>
                                      <input
                                          type="email"
                                          value={emailLicPara}
                                          onChange={(e) => setEmailLicPara(e.target.value)}
                                          placeholder="contato@empresa.com.br"
                                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all"
                                      />
                                  </div>
                                  <div className="space-y-1.5">
                                      <label className="text-sm font-bold text-slate-700">Nome do contato</label>
                                      <input
                                          type="text"
                                          value={emailLicNome}
                                          onChange={(e) => setEmailLicNome(e.target.value)}
                                          placeholder="Nome que abre o Olá"
                                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all"
                                      />
                                  </div>
                                  <div className="space-y-1.5">
                                      <label className="text-sm font-bold text-slate-700">Assunto</label>
                                      <input
                                          type="text"
                                          value={emailLicAssunto}
                                          onChange={(e) => setEmailLicAssunto(e.target.value)}
                                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all"
                                      />
                                  </div>
                                  <div className="space-y-1.5">
                                      <label className="text-sm font-bold text-slate-700">Corpo</label>
                                      <textarea
                                          value={emailLicCorpo}
                                          onChange={(e) => setEmailLicCorpo(e.target.value)}
                                          rows={14}
                                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold focus:bg-white transition-all resize-y leading-relaxed"
                                      />
                                      <p className="text-[11px] text-slate-400 font-medium">
                                          Uma linha em branco separa os parágrafos. O objeto da licitação vem inteiro do PNCP: apare o que não precisa.
                                      </p>
                                  </div>
                              </div>

                              {/* Direita: o e-mail como ele vai chegar */}
                              <div className="p-6 overflow-hidden flex flex-col bg-slate-50/50">
                                  <div className="flex items-center justify-between mb-2">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Prévia</span>
                                      {emailLicCarregando && <Loader2 size={14} className="animate-spin text-gold" />}
                                  </div>
                                  <div className="flex-1 min-h-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
                                      {emailLicHtml ? (
                                          <iframe
                                              title="Prévia do e-mail da licitação"
                                              srcDoc={emailLicHtml}
                                              sandbox=""
                                              className="w-full h-full border-0"
                                          />
                                      ) : (
                                          <div className="h-full flex items-center justify-center text-slate-400 text-sm font-bold">
                                              {emailLicCarregando ? 'Montando a prévia...' : 'Sem prévia'}
                                          </div>
                                      )}
                                  </div>
                              </div>
                          </div>

                          <div className="border-t border-slate-100 bg-slate-50 p-5 space-y-3">
                              {emailLicAvisos.length > 0 && (
                                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                                      {emailLicAvisos.map((a, i) => (
                                          <p key={i} className="text-[12px] text-amber-800 font-bold flex items-start gap-2">
                                              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {a}
                                          </p>
                                      ))}
                                  </div>
                              )}
                              {emailLicErro && (
                                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                      <p className="text-[12px] text-rose-800 font-bold flex items-start gap-2">
                                          <AlertCircle size={13} className="mt-0.5 shrink-0" /> {emailLicErro}
                                      </p>
                                  </div>
                              )}
                              <div className="flex justify-end gap-3">
                                  <button
                                      onClick={fecharEmailLicitacao}
                                      disabled={emailLicEnviando}
                                      className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                                  >
                                      Cancelar
                                  </button>
                                  <button
                                      onClick={enviarEmailLicitacao}
                                      disabled={emailLicEnviando || emailLicCarregando || !emailLicPara.trim() || !emailLicHtml}
                                      className="bg-navy hover:bg-navy-light text-areia border border-gold/35 px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-50"
                                  >
                                      {emailLicEnviando ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
                                      {emailLicEnviando ? 'Enviando...' : 'Enviar'}
                                  </button>
                              </div>
                          </div>
                      </div>
                  </div>
                </ModalPortal>
            )}

            {/* ── EDIT LEAD MODAL ── */}
            {isEditModalOpen && editingLead && (
                <ModalPortal>
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                          <div className="flex justify-between items-center p-6 border-b border-gold/20 bg-gold/10">
                              <div>
                                  <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><Edit2 size={20} className="text-gold" />Editar Lead</h3>
                                  <p className="text-sm text-slate-500 font-medium mt-1 px-1">{editLeadForm.company || editLeadForm.name || 'Sem Identificação'}</p>
                                  {editObservationEntries.length > 0 && (
                                      <p className="text-xs text-slate-500 font-bold mt-1 px-1">
                                          Ultima atualizacao da observacao: {editObservationEntries[editObservationEntries.length - 1].timestamp}
                                      </p>
                                  )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                  {(() => {
                                      const { estado, iniciadaEm } = estadoE1(editingLead);
                                      if (estado === 'oculto') return null;
                                      if (estado === 'iniciada') {
                                          return (
                                              <span
                                                  title={`Trilha iniciada em ${diaMesBrDeTimestamp(iniciadaEm)}`}
                                                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-xl border bg-slate-50 text-slate-400 border-slate-200"
                                              >
                                                  <CheckCircle2 size={13} /> Trilha iniciada em {diaMesBrDeTimestamp(iniciadaEm)}
                                              </span>
                                          );
                                      }
                                      return (
                                          <button
                                              type="button"
                                              onClick={() => { const lead = editingLead; fecharEdicaoLead(); abrirEmailLicitacao(lead); }}
                                              title="Abrir a prévia do e-mail desta licitação"
                                              className="inline-flex items-center gap-2 text-[12px] font-bold px-4 py-2 rounded-xl bg-navy text-areia border border-gold/35 hover:bg-navy-light transition-colors"
                                          >
                                              <Mail size={14} /> E-mail da licitação
                                          </button>
                                      );
                                  })()}
                                  <button onClick={fecharEdicaoLead} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                              </div>
                          </div>
                          <div className="p-8 overflow-y-auto custom-scroll flex-1">
                              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8">
                                  <div className="min-w-0">
                                      <form id="edit-lead-form" onSubmit={handleSaveEdit}>
                                          <LeadFormFields form={editLeadForm} setForm={setEditLeadForm} columns={columns} hideObservation />
                                      </form>

                                      <div className="mt-8 pt-6 border-t border-slate-100 space-y-4">
                                          <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Observacoes do Lead</h4>
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                              <div className="md:col-span-1 space-y-1.5">
                                                  <label className="text-xs font-bold text-slate-600">Data da observacao</label>
                                                  <input
                                                      type="datetime-local"
                                                      value={editObservationDateTime}
                                                      onChange={(e) => setEditObservationDateTime(e.target.value)}
                                                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
                                                  />
                                              </div>
                                              <div className="md:col-span-2 space-y-1.5">
                                                  <label className="text-xs font-bold text-slate-600">{editingObservationIndex === null ? 'Nova observacao' : 'Editar observacao'}</label>
                                                  <textarea
                                                      value={editObservationText}
                                                      onChange={(e) => setEditObservationText(e.target.value)}
                                                      rows={3}
                                                      placeholder="Digite a observacao..."
                                                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold resize-none"
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
                                                  className="px-4 py-2 rounded-xl bg-navy text-white font-bold text-sm hover:bg-navy-light"
                                              >
                                                  {editingObservationIndex === null ? 'Adicionar Nota' : 'Salvar Nota'}
                                              </button>
                                          </div>

                                          <div className="mt-5">
                                              <h5 className="text-xs font-bold text-navy uppercase tracking-widest mb-2">Histórico de observações</h5>
                                              <div className="space-y-2 max-h-56 overflow-y-auto custom-scroll pr-1">
                                                  {editObservationEntries.length === 0 ? (
                                                      <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl p-3">
                                                          Nenhuma observacao registrada ainda.
                                                      </div>
                                                  ) : editObservationEntries.map((entry, idx) => (
                                                      <div
                                                          key={`${entry.timestamp}-${idx}`}
                                                          className="rounded-xl border border-gold/30 bg-white shadow-sm overflow-hidden"
                                                      >
                                                          <div className="flex items-start justify-between gap-2 px-3 py-2 bg-navy">
                                                              <span className="inline-flex items-center gap-1.5 rounded-xl bg-navy-light px-2 py-1 text-[11px] font-bold tabular-nums text-gold ring-1 ring-gold/40">
                                                                  <Clock size={12} className="shrink-0 text-gold/90" aria-hidden />
                                                                  {entry.timestamp}
                                                              </span>
                                                              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                                                  <button
                                                                      type="button"
                                                                      onClick={() => handleEditObservation(idx)}
                                                                      className="text-[11px] font-bold text-gold hover:text-white transition-colors"
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
                                          <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Limites de Seguradoras</h4>
                                          {editLimitesArray.length > 0 && (
                                              <div className="space-y-2">
                                                  {editLimitesArray.map((lim, i) => (
                                                      <div key={i} className="flex items-center gap-2 bg-gold/10 px-3 py-2 rounded-xl border border-gold/25">
                                                          <span className="flex-1 text-sm font-bold text-navy">{lim.seguradora}</span>
                                                          <span className="text-sm font-bold text-gold-hover">{lim.valor}</span>
                                                          <button
                                                              type="button"
                                                              onClick={() => setEditLimitesArray(prev => prev.filter((_, idx) => idx !== i))}
                                                              className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
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
                                                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
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
                                                  className="w-32 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold"
                                              />
                                              <button
                                                  type="button"
                                                  onClick={() => {
                                                      if (!editCurrentLimit.seguradora) return;
                                                      setEditLimitesArray(prev => [...prev, editCurrentLimit]);
                                                      setEditCurrentLimit({ seguradora: '', valor: '' });
                                                  }}
                                                  className="px-4 py-2 bg-navy hover:bg-navy-light text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center whitespace-nowrap shadow-md shrink-0"
                                              >
                                                  Adicionar
                                              </button>
                                          </div>
                                      </div>
                                  </div>
                                  <div className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-8">
                                      <TaskManager prospectId={editingLead.id} onTaskChange={fetchTasks} />
                                  </div>
                              </div>
                          </div>
                          <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                              <button type="button" onClick={() => { setIsEditModalOpen(false); setEditingLead(null); }} className="px-5 py-2.5 font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                              <button type="submit" form="edit-lead-form" disabled={savingLead} className="bg-navy hover:bg-navy-light text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-50">
                                  {savingLead ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                  {savingLead ? 'Salvando...' : 'Salvar Alterações'}
                              </button>
                          </div>
                      </div>
                  </div>
                </ModalPortal>
            )}

            {/* ── CSV MAPPING MODAL ── */}
            {isImportModalOpen && (
                <ModalPortal>
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                          <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                              <div>
                                  <h3 className="text-xl font-black text-slate-800">Mapear Colunas do CSV</h3>
                                  <p className="text-sm text-slate-500 font-medium mt-1">Nós encontramos <strong className="text-navy">{csvRows.length}</strong> leads no arquivo.</p>
                              </div>
                              <button onClick={() => setIsImportModalOpen(false)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors shadow-sm cursor-pointer"><X size={20} /></button>
                          </div>
                          <div className="p-8 overflow-y-auto custom-scroll flex-1">
                              <div className="bg-areia border border-gold/25 rounded-2xl p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                  <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-navy rounded-xl flex items-center justify-center text-gold shadow-lg"><ArrowRight size={20} /></div>
                                      <div>
                                          <h4 className="font-bold text-navy">Coluna de Destino</h4>
                                          <p className="text-xs text-navy/70 font-medium">Os leads serão importados para qual coluna?</p>
                                      </div>
                                  </div>
                                  <select value={importStatus} onChange={(e) => setImportStatus(e.target.value)} className="px-4 py-2.5 bg-white border border-gold/30 rounded-xl text-sm font-bold text-navy outline-none focus:ring-4 focus:ring-gold/15 transition-all cursor-pointer shadow-sm min-w-[200px]">
                                      {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
                                  </select>
                              </div>
                              <div className="flex items-center gap-4 flex-wrap">
                                  <div className="flex items-center gap-3">
                                      <Tag size={18} className="text-gold" />
                                      <div>
                                          <p className="text-sm font-bold text-navy">Foco do Atendimento</p>
                                          <p className="text-xs text-navy/70 font-medium">Qual produto/serviço destes leads?</p>
                                      </div>
                                  </div>
                                  <select value={csvProductType} onChange={(e) => setCsvProductType(e.target.value)} className="px-4 py-2.5 bg-white border border-gold/30 rounded-xl text-sm font-bold text-navy outline-none focus:ring-4 focus:ring-gold/15 transition-all cursor-pointer shadow-sm min-w-[200px]">
                                      {PRODUCT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                                  </select>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                                  {DB_FIELDS.map(field => (
                                      <div key={field.key} className="flex flex-col gap-1.5 p-3 rounded-xl hover:bg-slate-50 border-2 border-transparent hover:border-slate-100 transition-colors">
                                          <label className="text-sm font-bold text-slate-700">{field.label}</label>
                                          <div className="relative">
                                              <select value={csvMapping[field.key] || ''} onChange={(e) => setCsvMapping({ ...csvMapping, [field.key]: e.target.value })} className="w-full px-4 py-2.5 pr-10 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold transition-all cursor-pointer appearance-none shadow-sm font-medium">
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
                              <button onClick={handleConfirmImport} disabled={importing} className="bg-navy hover:bg-navy-light text-white px-6 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-lg shadow-navy/25 disabled:opacity-50">
                                  {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                                  {importing ? 'Importando...' : 'Confirmar Importação'}
                              </button>
                          </div>
                      </div>
                  </div>
                </ModalPortal>
            )}
        </div>
    );
};

export default ProspectsKanban;
