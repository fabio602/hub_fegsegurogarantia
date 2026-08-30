import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Send, RefreshCw,
  User, Shield, FileText, DollarSign, Calendar, CheckCircle2, X, Loader2, AlertTriangle, Pencil, Search,
  XCircle, Mail, Info
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Cliente {
  id: string;
  inquilino_nome: string;
  seguradora: string;
  numero_apolice: string;
  valor_seguro: number;
  parcela_atual: number;
  total_parcelas: number;
  data_inicio: string;
  status: 'ativo' | 'encerrado' | 'aguardando_cotacao';
  tipo_seguro?: string;
  status_residencial?: string;
  status_garantia?: string | null;
  apolice_residencial_url?: string | null;
  apolice_garantia_url?: string | null;
  observacoes?: string;
  created_at: string;
  dia_vencimento_aluguel?: number | null;
  repasse_pago_em?: string | null;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Datas do banco vêm como 'YYYY-MM-DD'. new Date('2026-06-26') é interpretado como
// UTC e, no fuso de Brasília, "volta" um dia. Por isso montamos a data local na mão.
const parseDataLocal = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
};

const diasAte = (s: string) => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((parseDataLocal(s).getTime() - hoje.getTime()) / 86400000);
};

const fmtData = (s: string) => parseDataLocal(s).toLocaleDateString('pt-BR');

// Etapas anteriores à emissão da apólice — o registro ainda é uma solicitação.
const ETAPAS_EM_ANDAMENTO = ['solicitado', 'atendimento_iniciado', 'aguardando_seguradora', 'aguardando_cliente'];

// "Apenas Garantia Locatícia" é a primeira opção do formulário do portal e grava
// tipo_seguro = 'garantia'. Testar só por 'residencial_garantia' deixava esse caso
// de fora de tudo: rescisão, distrato e rótulo na tela.
const temGarantia = (c: any) => c?.tipo_seguro === 'residencial_garantia' || c?.tipo_seguro === 'garantia';
const temResidencial = (c: any) => c?.tipo_seguro === 'residencial_garantia' || c?.tipo_seguro === 'residencial';
const rotuloTipoSeguro = (c: any) =>
  temGarantia(c) && temResidencial(c) ? '🏠🔒 + Garantia' : temGarantia(c) ? '🔒 Garantia Locatícia' : '🏠 Residencial';

// Passo a passo da operação, escrito para quem nunca mexeu nesta tela. Fica no
// botão "Como funciona", ao lado do título.
const GUIA_PASSOS: { titulo: string; texto: string; atencao?: string }[] = [
  {
    titulo: 'A imobiliária pede o seguro pelo portal',
    texto: 'Ela preenche os dados do inquilino no portal e o cadastro cai aqui automaticamente, na coluna Solicitado do quadro. Você recebe um e-mail avisando. Não precisa cadastrar nada à mão.',
  },
  {
    titulo: 'Você assume e cota na seguradora',
    texto: 'Arraste o card para F&G em Atendimento e faça a cotação. Enquanto espera resposta da seguradora, deixe em Aguardando Seguradora. Se a bola estiver com o inquilino (documento faltando, escolha de plano), use Aguardando o Cliente.',
    atencao: 'A imobiliária enxerga em que coluna o cadastro está. Manter a coluna certa evita a cobrança de "e aí, saiu?".',
  },
  {
    titulo: 'Precisa falar com a imobiliária? Use o recado',
    texto: 'Clique no nome do inquilino, escreva no campo de recado e marque "preciso de retorno". O recado aparece em destaque no portal e sai um e-mail pedindo a resposta. Serve para pedir documento, distrato, confirmação de valor.',
  },
  {
    titulo: 'Aprovou: arraste para Aprovado e configure o repasse',
    texto: 'Ao soltar o card em Aprovado, o hub abre uma tela pedindo o valor mensal do seguro, o dia de vencimento do aluguel e a quantidade de parcelas. Preencha na hora, é o que faz o cliente entrar na cobrança.',
    atencao: 'Sem valor mensal preenchido o cliente nunca aparece no repasse e você deixa de cobrar. Ele vai parar no painel laranja "Precisa de atenção", no topo desta tela.',
  },
  {
    titulo: 'A 1ª parcela é do inquilino, o repasse começa na 2ª',
    texto: 'O inquilino paga a primeira parcela direto para a seguradora. Por isso o hub já marca o cadastro como parcela 2 e a imobiliária só passa a ver o cliente na cobrança a partir daí.',
  },
  {
    titulo: 'Todo mês você confere e envia o relatório',
    texto: 'A lista de ativos mostra quem entra na cobrança do mês, com valor e número da parcela. Confira, clique em Enviar Relatório e a imobiliária recebe o fechamento por e-mail. O botão Enviar Teste Para Mim manda uma cópia só para você antes.',
  },
  {
    titulo: 'Recebeu o pagamento: registre o repasse',
    texto: 'Use Registrar Repasse para lançar o mês, o valor total pago e o comprovante. É o que fecha o mês e serve de histórico quando a imobiliária questiona algum valor.',
  },
  {
    titulo: 'Renovação, rescisão e saída caem em Pendências do portal',
    texto: 'Quando a imobiliária confirma renovação, avisa que não vai renovar ou pede rescisão, o cadastro aparece no painel escuro Pendências do portal. Ele fica lá até você dar a baixa, então nada se perde.',
  },
  {
    titulo: 'Dar baixa: Renovada ou Não vai renovar',
    texto: 'Em Renovada você informa a nova data de fim de vigência e o cliente continua na carteira. Em Não vai renovar você escolhe o que aconteceu (saiu do imóvel, cancelado, optou não contratar ou reprovado) e o hub oferece avisar a imobiliária por e-mail.',
    atencao: 'O e-mail de encerramento já avisa que a parcela sai da cobrança. Enviar evita a dúvida no repasse do mês seguinte.',
  },
];

const GUIA_LEMBRETES = [
  'Garantia locatícia só é cancelada com o distrato em mãos. A linha da pendência mostra se o documento já chegou.',
  'O aviso automático de repasse sai 10 dias antes do vencimento do aluguel, por isso o dia precisa estar preenchido.',
  'Clicar no nome do inquilino abre a edição completa, inclusive para corrigir o nome, o valor e a apólice.',
  'O painel laranja no topo aponta quem está com repasse mal configurado. Se ele estiver vazio, a carteira está redonda.',
];

// As quatro saídas possíveis de um cliente da carteira. São os mesmos valores
// que o portal da imobiliária já entende como encerrado, então basta gravar
// status_apolice com um deles para o cadastro sair da lista de ativos.
const SITUACOES_ENCERRAMENTO = [
  {
    valor: 'saiu_imovel',
    rotulo: 'Saiu do Imóvel',
    ajuda: 'O inquilino desocupou o imóvel.',
    motivoEmail: 'O inquilino saiu do imóvel.',
    cor: '#7c3aed', bg: '#f5f3ff', borda: '#ddd6fe',
  },
  {
    valor: 'cancelado',
    rotulo: 'Cancelado',
    ajuda: 'A apólice foi cancelada na seguradora.',
    motivoEmail: 'A apólice foi cancelada na seguradora.',
    cor: '#dc2626', bg: '#fef2f2', borda: '#fecaca',
  },
  {
    valor: 'desistiu',
    rotulo: 'Optou Não Contratar',
    ajuda: 'Desistiu antes de a apólice ser emitida.',
    motivoEmail: 'O cliente optou por não contratar o seguro.',
    cor: '#c2410c', bg: '#fff7ed', borda: '#fdba74',
  },
  {
    valor: 'reprovado',
    rotulo: 'Reprovado',
    ajuda: 'A análise da seguradora não aprovou.',
    motivoEmail: 'A análise da seguradora não aprovou o cliente.',
    cor: '#475569', bg: '#f8fafc', borda: '#e2e8f0',
  },
];

// Linha do painel "Pendências do portal". Renovação, cancelamento e rescisão têm
// o mesmo formato — só muda a etiqueta, os documentos e o botão de baixa.
function LinhaPendencia({
  cliente, parceiros, etiqueta, detalhe, documentos = [], observacao, acao, acaoSecundaria, onGoToSale, fundo,
}: {
  // O projeto não tem @types/react instalado, então o TS não reconhece `key`
  // como prop reservada de componente — por isso ela é declarada aqui.
  key?: string | undefined;
  cliente: any;
  parceiros: { id: number; name: string }[];
  etiqueta: { texto: string; bg: string; cor: string };
  detalhe?: { texto: string; bg: string; cor: string } | undefined;
  documentos?: { label: string; url?: string | null | undefined }[] | undefined;
  observacao?: string | undefined;
  acao: { label: string; onClick: () => void };
  // Segunda saída da linha, quando existe mais de um desfecho possível. Ex.: a
  // renovação que não vai acontecer porque o inquilino avisou direto para nós.
  acaoSecundaria?: { label: string; onClick: () => void } | undefined;
  onGoToSale?: ((data: { nome: string; telefone: string }) => void) | undefined;
  fundo?: string | undefined;
}) {
  const parceiro = parceiros.find(p => p.id === cliente.partner_id);
  return (
    <div
      className="flex items-start justify-between gap-3 flex-wrap px-6 py-4 border-b border-slate-50 last:border-b-0"
      style={{ background: fundo }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-xl" style={{ background: etiqueta.bg, color: etiqueta.cor }}>
            {etiqueta.texto}
          </span>
          <p className="font-bold text-[13px] text-navy">{cliente.inquilino_nome}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          {detalhe && (
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-xl" style={{ background: detalhe.bg, color: detalhe.cor }}>
              {detalhe.texto}
            </span>
          )}
          <span className="text-[10px] font-bold text-slate-400">{rotuloTipoSeguro(cliente)}</span>
          {parceiro && (
            <span className="text-[10px] font-bold text-stone-500 bg-areia px-2 py-0.5 rounded-xl">
              {parceiro.name.replace('Imobiliária ', '')}
            </span>
          )}
        </div>
        {documentos.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            {documentos.map(d => d.url ? (
              <a
                key={d.label} href={d.url} target="_blank" rel="noreferrer"
                className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-xl hover:underline"
              >{d.label}</a>
            ) : (
              <span key={d.label} className="text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-300 px-2 py-0.5 rounded-xl">
                {d.label}
              </span>
            ))}
          </div>
        )}
        {observacao && (
          <p className="text-[11px] text-slate-500 font-semibold mt-1.5 max-w-xl">{observacao}</p>
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {onGoToSale && (
          <button
            onClick={() => onGoToSale({ nome: cliente.inquilino_nome, telefone: cliente.telefone || '' })}
            className="text-[11px] font-bold bg-white border border-slate-200 hover:border-gold text-slate-600 px-3 py-2 rounded-xl transition-colors"
          >
            → Registro de Venda
          </button>
        )}
        {acaoSecundaria && (
          <button
            onClick={acaoSecundaria.onClick}
            className="flex items-center gap-1.5 text-[11px] font-bold bg-white border border-slate-200 hover:border-rose-600 hover:text-rose-600 text-slate-600 px-3 py-2 rounded-xl transition-colors"
          >
            <XCircle size={13} /> {acaoSecundaria.label}
          </button>
        )}
        <button
          onClick={acao.onClick}
          className="flex items-center gap-1.5 text-[11px] font-bold bg-navy hover:bg-navy-light text-gold px-3 py-2 rounded-xl transition-colors"
        >
          <CheckCircle2 size={13} /> {acao.label}
        </button>
      </div>
    </div>
  );
}

/** Lê um valor em reais digitado à mão.
 *
 *  O campo é texto livre, então chega de tudo: "44,28", "R$ 44,28", "1.234,56",
 *  "1234.56". O código antigo só trocava a vírgula por ponto — "R$ 44,28" virava
 *  "R$ 44.28", que o parseFloat lê como NaN. Resultado: o hub avisava que o
 *  valor estava em branco com R$ 44,28 escrito na tela. Pior, "1.234,56" virava
 *  "1.234.56" e era salvo como 1,23.
 *
 *  Devolve null quando não há número nenhum. */
export function lerValorBRL(bruto: string): number | null {
  const limpo = (bruto || '').replace(/[^\d.,-]/g, '');
  if (!limpo) return null;
  let normal: string;
  if (limpo.includes(',')) {
    // Tem vírgula: ela é o decimal e o ponto só pode ser separador de milhar.
    normal = limpo.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpo)) {
    // "1.234" / "1.234.567": em pt-BR isso é milhar, não decimal.
    normal = limpo.replace(/\./g, '');
  } else {
    normal = limpo;
  }
  const n = parseFloat(normal);
  return isNaN(n) ? null : n;
}

const EMPTY_FORM = {
  inquilino_nome: '',
  seguradora: '',
  numero_apolice: '',
  valor_seguro: '',
  parcela_atual: '1',
  total_parcelas: '12',
  data_inicio: new Date().toISOString().split('T')[0],
  observacoes: '',
};

function ApoliceUpload({ clienteId, field, onUploaded }: { clienteId: string; field: string; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = React.useState(false);
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `apolices/${clienteId}/${field}_${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from('imobiliaria-docs').upload(path, file, { contentType: 'application/pdf', upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('imobiliaria-docs').getPublicUrl(path);
      onUploaded(data.publicUrl);
    } catch (err: any) { alert('Erro ao enviar PDF: ' + err.message); }
    finally { setUploading(false); e.target.value = ''; }
  };
  return (
    <label className={`flex items-center gap-2 px-4 py-2.5 border-2 border-dashed rounded-xl cursor-pointer transition-all ${uploading ? 'border-slate-200 bg-slate-50' : 'border-gold/40 hover:border-gold hover:bg-gold/5'}`}>
      <input type="file" accept="application/pdf" className="hidden" onChange={handleFile} disabled={uploading} />
      {uploading ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <FileText size={15} className="text-gold" />}
      <span className="text-sm font-bold text-slate-600">{uploading ? 'Enviando...' : 'Clique para anexar PDF da apólice'}</span>
    </label>
  );
}

export default function ImobiliariaRepasse({ onGoToSale }: { onGoToSale?: (data: { nome: string; telefone: string }) => void } = {}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [parceiros, setParceiros] = useState<{id: number; name: string; email?: string}[]>([]);
  const [filterParceiro, setFilterParceiro] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showEncerrados, setShowEncerrados] = useState(false);
  const [repasseModal, setRepasseModal] = useState(false);
  const [repasseForm, setRepasseForm] = useState({ mes: new Date().getMonth() + 1, ano: new Date().getFullYear(), data_pagamento: '', observacoes: '' });
  const [repasseFile, setRepasseFile] = useState<File | null>(null);
  const [savingRepasse, setSavingRepasse] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const salvarRepasse = async () => {
    setSavingRepasse(true);
    try {
      let comprovante_url = null;
      if (repasseFile) {
        const path = `${repasseForm.ano}/${repasseForm.mes}/${Date.now()}_${repasseFile.name}`;
        await supabase.storage.from('repasse-comprovantes').upload(path, repasseFile, { upsert: true });
        const { data: urlData } = supabase.storage.from('repasse-comprovantes').getPublicUrl(path);
        comprovante_url = urlData.publicUrl;
      }
      const valor_total = ativos.reduce((s, c) => s + Number(c.valor_seguro || 0), 0);
      await supabase.from('imobiliaria_repasses').upsert({
        partner_id: ativos[0]?.partner_id || null,
        mes: repasseForm.mes,
        ano: repasseForm.ano,
        valor_total,
        data_pagamento: repasseForm.data_pagamento || null,
        comprovante_url,
        status: repasseForm.data_pagamento ? 'pago' : 'pendente',
        observacoes: repasseForm.observacoes || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,mes,ano' });
      setRepasseModal(false);
      setRepasseFile(null);
    } catch (e) { console.error(e); }
    finally { setSavingRepasse(false); }
  };
  // Modal de configuração de repasse ao aprovar cliente do portal
  const [repasseSetupModal, setRepasseSetupModal] = useState<{ clienteId: string; nome: string; newStatus: string } | null>(null);
  const [repasseSetupForm, setRepasseSetupForm] = useState({ total_parcelas: 12, valor_seguro: '', dia_vencimento_aluguel: '' });

  // Modal de encerramento: uma tela só para todo cliente que sai da carteira,
  // não importa se a notícia veio pelo portal ou se o próprio inquilino avisou.
  const [encerramentoModal, setEncerramentoModal] = useState<{ cliente: any; situacao: string; observacao: string; avisar: boolean } | null>(null);
  const [encerrando, setEncerrando] = useState(false);
  const [encerramentoErro, setEncerramentoErro] = useState('');

  // Guia de operação. Hoje só o Fábio sabe a ordem certa das coisas nesta tela,
  // então o passo a passo mora aqui dentro, não na cabeça dele.
  const [guiaAberto, setGuiaAberto] = useState(false);

  const moveCard = async (clienteId: string, newStatus: string) => {
    setDraggingId(null); setDragOver(null);
    // Ao aprovar, pede a configuração do repasse se ainda não há valor mensal.
    // Antes o teste era `!is_repasse`, mas o portal já insere is_repasse: true com
    // valor_seguro 0 — o modal nunca abria e o valor ficava zerado para sempre.
    if (newStatus === 'aprovado') {
      const cliente = clientes.find(c => c.id === clienteId);
      if (cliente && !(Number((cliente as any).valor_seguro) > 0)) {
        setRepasseSetupForm({ total_parcelas: 12, valor_seguro: '' });
        setRepasseSetupModal({ clienteId, nome: cliente.inquilino_nome, newStatus });
        return; // aguarda confirmação no modal
      }
    }
    await supabase.from('imobiliaria_clientes')
      .update({ kanban_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', clienteId);
    setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, kanban_status: newStatus } as any : c));
  };

  const confirmarRepasseSetup = async () => {
    if (!repasseSetupModal) return;
    const valor = lerValorBRL(repasseSetupForm.valor_seguro) ?? 0;
    const diaVenc = parseInt(repasseSetupForm.dia_vencimento_aluguel) || null;
    // Marcar como repasse sem valor faz a imobiliária receber cobrança de R$ 0,00.
    if (!(valor > 0)) {
      alert('Informe o "Valor Mensal (R$)" do seguro.\n\nSem ele, a imobiliária receberia um e-mail pedindo repasse de R$ 0,00.');
      return;
    }
    // parcela_atual = 2: a 1ª sempre é paga pelo cliente diretamente
    // o repasse começa a partir da 2ª parcela
    await supabase.from('imobiliaria_clientes').update({
      kanban_status: repasseSetupModal.newStatus,
      is_repasse: true,
      total_parcelas: repasseSetupForm.total_parcelas,
      parcela_atual: 2,
      valor_seguro: valor,
      dia_vencimento_aluguel: diaVenc,
      updated_at: new Date().toISOString(),
    }).eq('id', repasseSetupModal.clienteId);
    setClientes(prev => prev.map(c => c.id === repasseSetupModal.clienteId
      ? { ...c, kanban_status: repasseSetupModal.newStatus, is_repasse: true, total_parcelas: repasseSetupForm.total_parcelas, valor_seguro: valor } as any
      : c));
    setRepasseSetupModal(null);
  };

  const [editingStatus, setEditingStatus] = useState<Cliente | null>(null);
  const [editStatusForm, setEditStatusForm] = useState({ inquilino_nome: '', status_residencial: '', status_garantia: '', apolice_residencial_url: '', apolice_garantia_url: '', vigencia_fim: '', status_apolice: 'ativo', kanban_status: 'solicitado', seguradora: '', numero_apolice: '', dia_vencimento_aluguel: '', valor_seguro: '', observacao_imobiliaria: '', recado_precisa_retorno: false, is_repasse: false });

  const STATUS_LABELS: Record<string, string> = { aguardando_cotacao: '⏳ Aguardando', em_analise: '🔍 Em análise', aprovado: '✅ Aprovado', emitido: '📄 Emitido', recusado: '❌ Encerrado' };
  const STATUS_COLORS: Record<string, string> = { aguardando_cotacao: 'bg-yellow-50 text-yellow-800', em_analise: 'bg-blue-50 text-blue-700', aprovado: 'bg-emerald-50 text-emerald-700', emitido: 'bg-emerald-100 text-emerald-800', recusado: 'bg-slate-50 text-slate-600' };

  // Detalhamento do status quando encerrado — usa status_apolice para mostrar o motivo real
  const STATUS_APOLICE_LABELS: Record<string, string> = {
    ativo:          'Ativo',
    cancelado:      'Cancelado',
    desistiu:       'Optou Não Contratar',
    reprovado:      'Reprovado',
    vencido:        'Vencido',
    saiu_imovel:    'Saiu do Imóvel',
    pagamento_atrasado: 'Pgto. Atrasado',
    em_renovacao:   'Em Renovação',
  };

  /** Retorna o label de exibição correto, usando status_apolice quando encerrado */
  const getStatusLabel = (statusResidencial: string, statusApolice?: string): string => {
    if (statusResidencial === 'recusado' && statusApolice && STATUS_APOLICE_LABELS[statusApolice]) {
      return STATUS_APOLICE_LABELS[statusApolice];
    }
    return STATUS_LABELS[statusResidencial] ?? statusResidencial;
  };

  const openEditStatus = (c: Cliente) => {
    setEditingStatus(c);
    setEditStatusForm({ inquilino_nome: c.inquilino_nome || '', status_residencial: c.status_residencial || 'aguardando_cotacao', status_garantia: c.status_garantia || 'aguardando_cotacao', apolice_residencial_url: c.apolice_residencial_url || '', apolice_garantia_url: c.apolice_garantia_url || '', vigencia_fim: (c as any).vigencia_fim || '', status_apolice: (c as any).status_apolice || 'ativo', kanban_status: (c as any).kanban_status || 'solicitado', seguradora: c.seguradora || '', numero_apolice: c.numero_apolice || '', dia_vencimento_aluguel: c.dia_vencimento_aluguel?.toString() || '', valor_seguro: Number(c.valor_seguro) > 0 ? String(c.valor_seguro) : '', observacao_imobiliaria: (c as any).observacao_imobiliaria || '', recado_precisa_retorno: Boolean((c as any).recado_precisa_retorno), is_repasse: Boolean((c as any).is_repasse) });
  };
  const saveStatus = async () => {
    if (!editingStatus) return;

    // O nome é como o cliente aparece na lista, nos e-mails e no portal da
    // imobiliária — deixar salvar em branco sumiria com a linha da tela.
    const nomeEditado = editStatusForm.inquilino_nome.trim();
    if (!nomeEditado) {
      alert('O nome do inquilino não pode ficar em branco.');
      return;
    }
    const nomeAntigo = (editingStatus.inquilino_nome || '').trim();

    // Auto-advance kanban when policy is emitted or approved
    let kanban = editStatusForm.kanban_status || 'solicitado';
    if (['emitido','aprovado'].includes(editStatusForm.status_residencial) &&
        ['solicitado','atendimento_iniciado','aguardando_seguradora'].includes(kanban)) {
      kanban = 'aprovado';
    }
    if (editStatusForm.status_residencial === 'recusado') kanban = 'recusado';

    const diaVencEdit = parseInt(editStatusForm.dia_vencimento_aluguel) || null;
    const valorSegRaw = lerValorBRL(editStatusForm.valor_seguro);
    const valorSegEdit = valorSegRaw === null || valorSegRaw === 0 ? undefined : valorSegRaw;

    // Repasse com dia de vencimento mas sem valor é o cadastro que gerava o
    // e-mail de "R$ 0,00". Avisamos, mas não travamos o salvamento: muitas
    // vezes o cliente ainda está em cotação e só se quer anotar um recado.
    const jaTemValor = Number((editingStatus as any).valor_seguro) > 0;
    const ehRepasse = editStatusForm.is_repasse;
    const eraRepasse = Boolean((editingStatus as any).is_repasse);

    // Marcar "É repasse" sem valor mensal não faz sentido: o cliente entraria na
    // lista de ativos e a imobiliária receberia cobrança de R$ 0,00.
    if (ehRepasse && !eraRepasse && valorSegEdit === undefined && !jaTemValor) {
      alert('Informe o "Valor Mensal (R$)" antes de marcar este cliente como repasse.');
      return;
    }

    if (ehRepasse && diaVencEdit && valorSegEdit === undefined && !jaTemValor) {
      const seguir = confirm(
        'Este cliente está como repasse, vencimento dia ' + diaVencEdit + ', mas sem "Valor Mensal (R$)".\n\n' +
        'Pode salvar assim — ele fica de fora dos avisos de repasse até o valor ser preenchido, ' +
        'então a imobiliária não recebe cobrança de R$ 0,00.\n\n' +
        'OK para salvar assim. Cancelar para preencher o valor agora.'
      );
      if (!seguir) return;
    }

    // Recado: decide se a imobiliária precisa ser avisada por e-mail.
    // Só dispara quando o corretor marcou "preciso de retorno" e o aviso ainda
    // não saiu para este texto — assim salvar o cadastro de novo não reenvia.
    const recadoNovo = editStatusForm.observacao_imobiliaria.trim();
    const recadoAntigo = ((editingStatus as any).observacao_imobiliaria || '').trim();
    const pedeRetorno = Boolean(recadoNovo) && editStatusForm.recado_precisa_retorno;
    const avisarRecado = pedeRetorno && (
      recadoNovo !== recadoAntigo ||
      !(editingStatus as any).recado_precisa_retorno ||
      !(editingStatus as any).recado_enviado_em
    );

    const updatePayload: Record<string, unknown> = {
      inquilino_nome: nomeEditado,
      status_residencial: editStatusForm.status_residencial,
      status_garantia: temGarantia(editingStatus) ? editStatusForm.status_garantia : null,
      apolice_residencial_url: editStatusForm.apolice_residencial_url || null,
      apolice_garantia_url: temGarantia(editingStatus) ? editStatusForm.apolice_garantia_url || null : null,
      vigencia_fim: editStatusForm.vigencia_fim || null,
      status_apolice: editStatusForm.status_apolice || 'ativo',
      status: editStatusForm.status_apolice || 'ativo',
      kanban_status: kanban,
      seguradora: editStatusForm.seguradora || null,
      numero_apolice: editStatusForm.numero_apolice || null,
      dia_vencimento_aluguel: diaVencEdit,
      // Recado que a imobiliária lê no portal — não confundir com "observacoes",
      // que é anotação interna e continua invisível para o parceiro.
      observacao_imobiliaria: recadoNovo || null,
      recado_precisa_retorno: Boolean(recadoNovo) && editStatusForm.recado_precisa_retorno,
      is_repasse: ehRepasse,
      updated_at: new Date().toISOString(),
    };
    if (valorSegEdit !== undefined) updatePayload.valor_seguro = valorSegEdit;

    // A 1ª parcela sempre é paga pelo próprio cliente, então a cobrança da
    // imobiliária começa na 2ª. Vale para quem está virando repasse agora e
    // também para quem já estava marcado como repasse e só agora ganhou valor
    // mensal: sem isso ele ficaria parado em 1/12 e nunca apareceria no portal,
    // que esconde a 1ª parcela de propósito.
    const ganhouValorAgora = ehRepasse && eraRepasse && !jaTemValor && valorSegEdit !== undefined;
    if ((ehRepasse && !eraRepasse) || ganhouValorAgora) {
      if (!Number((editingStatus as any).total_parcelas)) updatePayload.total_parcelas = 12;
      if (!(Number((editingStatus as any).parcela_atual) > 1)) updatePayload.parcela_atual = 2;
    }

    const { error: updateError } = await supabase
      .from('imobiliaria_clientes')
      .update(updatePayload)
      .eq('id', editingStatus.id);

    if (updateError) {
      console.error('[saveStatus] Erro ao salvar:', updateError);
      alert(`Erro ao salvar: ${updateError.message}`);
      return;
    }

    // Atualiza estado local imediatamente (otimista) para evitar flash do valor antigo
    setClientes(prev => prev.map(c => c.id === editingStatus.id
      ? { ...c, ...updatePayload, kanban_status: kanban } as any
      : c
    ));
    setEditingStatus(null);

    // ── Sync para residential_clients quando emitido ──────────────
    if (editStatusForm.status_residencial === 'emitido') {
      const parceiroNome = (editingStatus as any).parceiro_nome ||
        parceiros.find(p => p.id === (editingStatus as any).partner_id)?.name || null;

      // Busca o registro correspondente em residential_clients.
      // Procura pelo nome antigo, que é o que está gravado lá; se o nome mudou
      // aqui, o registro do Residencial é renomeado junto para os dois não
      // ficarem apontando para pessoas com nomes diferentes.
      const { data: rcList } = await supabase
        .from('residential_clients')
        .select('id, situacao')
        .ilike('nome', nomeAntigo || nomeEditado)
        .limit(1);

      const rcUpdate: Record<string, unknown> = {
        nome: nomeEditado,
        situacao: 'Ativo',
        parceiro_nome: parceiroNome,
      };
      if (editStatusForm.seguradora) rcUpdate.seguradora_residencial = editStatusForm.seguradora; // campo extra se existir
      if (editStatusForm.numero_apolice) rcUpdate.apolice = editStatusForm.numero_apolice;
      if (editStatusForm.vigencia_fim) rcUpdate.fim_vigencia = editStatusForm.vigencia_fim;
      if (editStatusForm.apolice_residencial_url) rcUpdate.apolice_url = editStatusForm.apolice_residencial_url;

      if (rcList && rcList.length > 0) {
        // Atualiza registro existente
        await supabase.from('residential_clients').update(rcUpdate).eq('id', rcList[0].id);
      } else {
        // Cria novo registro no Residencial
        await supabase.from('residential_clients').insert({
          nome: nomeEditado,
          cpf: (editingStatus as any).cpf || null,
          telefone: (editingStatus as any).telefone || null,
          email: (editingStatus as any).email_inquilino || null,
          produto: 'Residencial',
          apolice: editStatusForm.numero_apolice || null,
          fim_vigencia: editStatusForm.vigencia_fim || null,
          apolice_url: editStatusForm.apolice_residencial_url || null,
          situacao: 'Ativo',
          parceiro_nome: parceiroNome,
          obs: 'Criado automaticamente via Repasse Imobiliárias',
        });
      }
    }

    // Email para imobiliária quando apólice é adicionada
    const apoliceNova = editStatusForm.apolice_residencial_url && editStatusForm.apolice_residencial_url !== (editingStatus.apolice_residencial_url || '');
    if (apoliceNova && (editingStatus as any).partner_id) {
      supabase.functions.invoke('imobiliaria-envia-apolice', {
        body: { client_id: editingStatus.id },
      }).catch(e => console.warn('Email apólice:', e));
    }

    // Aviso do recado que pede retorno — aqui esperamos a resposta de propósito:
    // se o e-mail não sair, o corretor precisa saber na hora, senão fica
    // esperando um retorno que nunca foi pedido.
    if (avisarRecado) {
      const { data: aviso, error: avisoErr } = await supabase.functions.invoke('imobiliaria-recado', {
        body: { client_id: editingStatus.id },
      });
      if (avisoErr || (aviso as any)?.error) {
        alert(`Recado salvo, mas o e-mail para a imobiliária não foi enviado.\n\n${(aviso as any)?.error || avisoErr?.message || ''}`);
      } else {
        alert(`E-mail enviado para ${((aviso as any)?.enviado_para || []).join(', ')} pedindo o retorno.`);
      }
    }

    load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    // Load all imobiliária partners
    const { data: partnerData } = await supabase
      .from('partners')
      .select('id, name, email')
      .eq('partner_type', 'imobiliaria')
      .order('name');
    setParceiros(partnerData ?? []);

    // Load clients filtered by partner if selected
    let query = supabase.from('imobiliaria_clientes').select('*').order('inquilino_nome');
    if (filterParceiro) query = query.eq('partner_id', filterParceiro);
    const { data } = await query;
    setClientes(data ?? []);
    setLoading(false);
  }, [filterParceiro]);

  useEffect(() => { load(); }, [load]);

  // Renovações que a imobiliária já confirmou no portal e que ainda não foram feitas.
  // Sem esse painel a confirmação só chegava por WhatsApp e se perdia — apólices
  // venceram sem ninguém perceber. A baixa é dar a nova vigência: aí o registro
  // sai daqui e some também do alerta do portal.
  const encerrado = (c: any) => ['cancelado', 'saiu_imovel', 'desistiu', 'reprovado'].includes(c.status_apolice);

  const renovacoesPendentes = clientes
    .filter(c => {
      if ((c as any).renovacao_confirmacao !== 'vai_renovar') return false;
      if (!(c as any).vigencia_fim) return false;
      if (encerrado(c)) return false;
      return diasAte((c as any).vigencia_fim) <= 45;
    })
    .sort((a, b) => diasAte((a as any).vigencia_fim) - diasAte((b as any).vigencia_fim));

  // A imobiliária avisou que não renova: é preciso cancelar na seguradora.
  // Sem garantia locatícia basta deixar vencer, mas a garantia só é cancelada
  // com o distrato em mãos — por isso o documento aparece aqui.
  const cancelamentosPendentes = clientes
    .filter(c => (c as any).renovacao_confirmacao === 'nao_vai_renovar' && !encerrado(c))
    .sort((a, b) => String((a as any).vigencia_fim || '').localeCompare(String((b as any).vigencia_fim || '')));

  // Rescisão no meio do contrato: o portal grava a data e os dois documentos,
  // e até agora nada disso aparecia aqui — só um e-mail.
  const rescisoesPendentes = clientes
    .filter(c => (c as any).rescisao_solicitada_em && !encerrado(c))
    .sort((a, b) => String((b as any).rescisao_solicitada_em).localeCompare(String((a as any).rescisao_solicitada_em)));

  const totalPendenciasPortal = renovacoesPendentes.length + cancelamentosPendentes.length + rescisoesPendentes.length;

  // Pendentes = solicitações da imobiliária sem apólice ainda emitida
  const emAndamento = (c: any) => ETAPAS_EM_ANDAMENTO.includes(c.kanban_status || 'solicitado') && !c.numero_apolice;
  const pendentes = clientes.filter(emAndamento);
  // O insert do portal já grava status: 'ativo' na própria solicitação, então o
  // teste de status sozinho contava como ativo quem ainda nem tem apólice.
  // Quem está em andamento é pendente e não pode aparecer também aqui.
  const ativos = clientes.filter(c =>
    (c as any).is_repasse === true
    && !emAndamento(c)
    && ((c as any).status_apolice === 'ativo' || c.status === 'ativo')
  );
  // ── Precisa de atenção ──────────────────────────────────────────────────
  // Um repasse só chega a ser cobrado quando três campos independentes
  // concordam: is_repasse marcado, status_apolice = 'ativo' e o kanban já fora
  // das etapas de atendimento. Quando eles se contradizem o cliente não entra
  // em nenhuma das listas da tela — simplesmente some, sem aviso. Foi o caso da
  // Kamila: repasse marcado, mas em renovação. Aqui a contradição fica visível.
  const SITUACOES_ENCERRADAS = ['cancelado', 'desistiu', 'reprovado', 'vencido', 'saiu_imovel'];
  const problemasDoRepasse = (c: any): string[] => {
    if (c.is_repasse !== true) return [];
    // Quem já encerrou não é pendência: não há repasse a cobrar.
    if (c.status === 'encerrado' || SITUACOES_ENCERRADAS.includes(c.status_apolice)) return [];
    const p: string[] = [];
    if (!(Number(c.valor_seguro) > 0)) p.push('Sem valor mensal');
    if (!c.dia_vencimento_aluguel) p.push('Sem dia de vencimento');
    if (c.status_apolice && c.status_apolice !== 'ativo') {
      p.push(STATUS_APOLICE_LABELS[c.status_apolice] || c.status_apolice);
    }
    if (emAndamento(c)) p.push('Apólice não emitida');
    return p;
  };
  const precisamAtencao = clientes
    .map(c => ({ cliente: c, problemas: problemasDoRepasse(c) }))
    .filter(x => x.problemas.length > 0);
  // Fora da tabela de ativos = fora do total mensal e fora do e-mail automático.
  const foraDaCobranca = (c: any) => !ativos.some(a => a.id === c.id);
  const encerrados = clientes.filter(c => c.status === 'encerrado');
  const totalMensal = ativos.reduce((s, c) => s + Number(c.valor_seguro), 0);

  // Busca em TODOS os clientes, não só nos ativos.
  //
  // Existia um buraco: a tela só lista renovações pendentes, ativos e
  // encerrados, e o kanban esconde os "aprovado" com mais de 3 dias. Quem está
  // em renovação, por exemplo, não aparecia em lugar nenhum — não tinha como
  // abrir o cadastro para informar o valor do repasse. Daí a busca.
  const [busca, setBusca] = useState('');
  const termoBusca = busca.trim().toLowerCase();
  const resultadosBusca = termoBusca.length < 2 ? [] : clientes.filter(c =>
    (c.inquilino_nome || '').toLowerCase().includes(termoBusca) ||
    (c.numero_apolice || '').toLowerCase().includes(termoBusca)
  );

  // Dar baixa = informar a nova vigência. Com a data nova o registro sai deste painel
  // e some do alerta de vencimento do portal da imobiliária, sem precisar de flag extra.
  const darBaixaRenovacao = async (c: any) => {
    const atual = parseDataLocal(c.vigencia_fim);
    const sugestao = new Date(atual.getFullYear() + 1, atual.getMonth(), atual.getDate());
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const resp = prompt(
      `Renovação de ${c.inquilino_nome}\n\nNova data de fim de vigência (AAAA-MM-DD):`,
      iso(sugestao)
    );
    if (!resp) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resp.trim())) { alert('Data inválida. Use o formato AAAA-MM-DD.'); return; }

    const novaData = resp.trim();
    if (diasAte(novaData) <= 0) { alert('A nova vigência precisa ser uma data futura.'); return; }

    const { error } = await supabase
      .from('imobiliaria_clientes')
      .update({
        vigencia_fim: novaData,
        renovacao_confirmacao: null, // zera para o próximo ciclo de vencimento
        status_apolice: 'ativo',
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.id);

    if (error) { alert(`Erro ao dar baixa: ${error.message}`); return; }
    load();
  };

  // Abre a tela de encerramento já sugerindo a situação mais provável para
  // aquela origem. Fábio confirma ou troca, porque quem sabe o que aconteceu
  // de verdade é ele, não o motivo que estava registrado no portal.
  const abrirEncerramento = (c: any, situacaoSugerida: string) => {
    setEncerramentoErro('');
    // Sem imobiliária vinculada não há para quem mandar, então já vem desmarcado.
    setEncerramentoModal({ cliente: c, situacao: situacaoSugerida, observacao: '', avisar: !!c.partner_id });
  };

  // Baixa de encerramento: marca a apólice com a situação escolhida. Com isso o
  // registro sai deste painel e o portal para de exibir o cliente como ativo.
  const confirmarEncerramento = async () => {
    if (!encerramentoModal) return;
    const { cliente: c, situacao, observacao, avisar } = encerramentoModal;
    setEncerrando(true);
    setEncerramentoErro('');
    try {
      const { error } = await supabase
        .from('imobiliaria_clientes')
        .update({
          status_apolice: situacao,
          status: 'encerrado',
          renovacao_confirmacao: null,
          rescisao_solicitada_em: null, // sai também do grupo de rescisões pendentes
          observacoes: observacao.trim()
            ? `${c.observacoes ? c.observacoes + '\n' : ''}${SITUACOES_ENCERRAMENTO.find(s => s.valor === situacao)?.rotulo}: ${observacao.trim()}`
            : c.observacoes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', c.id);
      if (error) throw new Error(error.message);

      if (avisar) {
        const { data: { session } } = await supabase.auth.getSession();
        const supabaseUrl = (supabase as any).supabaseUrl as string;
        const supabaseKey = (supabase as any).supabaseKey as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/imobiliaria-encerramento`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
          body: JSON.stringify({
            client_id: c.id,
            motivo: SITUACOES_ENCERRAMENTO.find(s => s.valor === situacao)?.motivoEmail || situacao,
            observacao: observacao.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          // A baixa já está gravada. Avisamos que só o e-mail falhou para ele
          // não achar que precisa refazer tudo.
          throw new Error(`A baixa foi salva, mas o e-mail não saiu: ${json.error || 'erro no envio'}`);
        }
      }

      setEncerramentoModal(null);
      load();
    } catch (e) {
      setEncerramentoErro(e instanceof Error ? e.message : 'Erro ao encerrar');
    } finally {
      setEncerrando(false);
    }
  };

  const handleSave = async () => {
    if (!form.inquilino_nome || !form.seguradora || !form.numero_apolice || !form.valor_seguro) return;
    setSaving(true);
    await supabase.from('imobiliaria_clientes').insert({
      inquilino_nome: form.inquilino_nome,
      seguradora: form.seguradora,
      numero_apolice: form.numero_apolice,
      valor_seguro: lerValorBRL(form.valor_seguro) ?? 0,
      parcela_atual: parseInt(form.parcela_atual),
      total_parcelas: parseInt(form.total_parcelas),
      data_inicio: form.data_inicio,
      observacoes: form.observacoes || null,
    });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setSaving(false);
    load();
  };

  const avancarParcela = async (c: Cliente) => {
    const proxima = c.parcela_atual + 1;
    if (proxima > c.total_parcelas) {
      // Grava os dois campos: o portal lê status_apolice e continuaria exibindo "Ativo".
      await supabase.from('imobiliaria_clientes').update({ status: 'encerrado', status_apolice: 'encerrado', updated_at: new Date().toISOString() }).eq('id', c.id);
    } else {
      await supabase.from('imobiliaria_clientes').update({ parcela_atual: proxima, updated_at: new Date().toISOString() }).eq('id', c.id);
    }
    load();
  };

  const deletar = async (id: string) => {
    await supabase.from('imobiliaria_clientes').delete().eq('id', id);
    setConfirmDelete(null);
    load();
  };

  const enviarRelatorio = async () => {
    setSending(true);
    setSendError('');
    setSendSuccess(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/imobiliaria-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao enviar');
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 5000);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Erro ao enviar relatório');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl lg:text-3xl font-black text-slate-800 tracking-tight">
            Repasse Imobiliárias
            {filterParceiro && parceiros.find(p => p.id === filterParceiro) && (
              <span className="text-lg text-gold ml-2">— {parceiros.find(p => p.id === filterParceiro)?.name}</span>
            )}
          </h2>
          <p className="text-slate-500 font-semibold mt-1 flex items-center gap-2 flex-wrap">
            Gestão de clientes residenciais por imobiliária parceira
            <button
              onClick={() => setGuiaAberto(true)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-navy bg-gold/15 hover:bg-gold/30 border border-gold/40 px-2.5 py-1 rounded-xl transition-colors"
              title="Como operar esta tela, passo a passo"
            >
              <Info size={12} /> Como funciona
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter by partner — always visible */}
          {parceiros.length > 0 && (
            <select
              value={filterParceiro ?? ''}
              onChange={e => setFilterParceiro(e.target.value ? parseInt(e.target.value) : null)}
              className="text-sm font-bold border border-slate-200 rounded-xl px-3 py-2 text-slate-700 bg-white focus:outline-none focus:border-gold cursor-pointer"
            >
              <option value="">Todas as imobiliárias</option>
              {parceiros.map(p => <option key={p.id} value={p.id}>{p.name.replace('Imobiliária ', '')}</option>)}
            </select>
          )}
          <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 transition-colors" title="Atualizar">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={async () => {
              setSending(true); setSendError(''); setSendSuccess(false);
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const supabaseUrl = (supabase as any).supabaseUrl as string;
                const supabaseKey = (supabase as any).supabaseKey as string;
                const res = await fetch(`${supabaseUrl}/functions/v1/imobiliaria-report`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || supabaseKey}`, 'apikey': supabaseKey },
                  body: JSON.stringify({ test_mode: true, to: 'fabio@fegsegurogarantia.com.br' }),
                });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Erro');
                setSendSuccess(true); setTimeout(() => setSendSuccess(false), 5000);
              } catch (e) { setSendError(e instanceof Error ? e.message : 'Erro'); }
              finally { setSending(false); }
            }}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-sm rounded-xl transition-all disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Enviar Teste Para Mim
          </button>
          <button
            onClick={enviarRelatorio}
            disabled={sending || ativos.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-navy hover:bg-navy-light text-white font-bold text-sm rounded-xl transition-all disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {sending ? 'Enviando...' : 'Enviar Relatório'}
          </button>
          <button
            onClick={() => setShowForm(f => !f)}
            className="flex items-center gap-2 px-4 py-2 bg-gold hover:bg-gold-hover text-white font-bold text-sm rounded-xl transition-all"
          >
            <Plus size={15} /> Novo Cliente
          </button>
          <button
            onClick={() => setRepasseModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-all"
          >
            <CheckCircle2 size={15} /> Registrar Repasse
          </button>
        </div>
      </div>

      {/* Feedback */}
      {sendSuccess && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 px-5 py-3 rounded-xl font-bold text-sm">
          <CheckCircle2 size={16} /> Relatório enviado para bordimezanolla@gmail.com com sucesso!
        </div>
      )}
      {sendError && (
        <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 text-rose-600 px-5 py-3 rounded-xl font-bold text-sm">
          <AlertTriangle size={16} /> {sendError}
        </div>
      )}

      {/* Precisa de atenção — repasses que, como estão, não vão ser cobrados.
          O alerta antigo só olhava a lista de ativos, então justamente quem
          havia sumido da tela não era apontado em lugar nenhum. */}
      {precisamAtencao.length > 0 && (
        <div className="bg-white rounded-2xl border border-orange-300 shadow-sm overflow-hidden">
          <div className="bg-orange-900 px-6 py-4 flex items-center gap-3">
            <AlertTriangle size={17} className="text-orange-300" />
            <div>
              <p className="text-white font-bold text-sm">Precisa de atenção ({precisamAtencao.length})</p>
              <p className="text-white/60 text-[11px] font-semibold mt-0.5">
                Marcados como repasse, mas com dado faltando. Clique no cliente para corrigir.
              </p>
            </div>
          </div>
          {precisamAtencao.map(({ cliente: c, problemas }) => (
            <button
              key={c.id}
              onClick={() => openEditStatus(c)}
              className="w-full flex items-center gap-3 px-6 py-3.5 border-b border-slate-50 last:border-0 hover:bg-orange-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-navy flex items-center justify-center shrink-0">
                <User size={14} className="text-gold" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-800 text-sm truncate">{c.inquilino_nome}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {problemas.map(p => (
                    <span key={p} className="px-2 py-0.5 rounded-xl bg-orange-50 border border-orange-300 text-orange-700 text-[10px] font-bold">
                      {p}
                    </span>
                  ))}
                  {foraDaCobranca(c) && (
                    <span className="text-[10px] font-bold text-slate-400">· não aparece na lista de ativos</span>
                  )}
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-gold font-bold text-xs shrink-0">
                <Pencil size={13} /> Corrigir
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Pendências do portal — tudo que a imobiliária pediu e ainda está em aberto */}
      {totalPendenciasPortal > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="bg-navy px-6 py-4 flex items-center gap-3">
            <RefreshCw size={17} className="text-gold" />
            <div>
              <p className="text-white font-bold text-sm">Pendências do portal ({totalPendenciasPortal})</p>
              <p className="text-white/50 text-[11px] font-semibold mt-0.5">
                O que a imobiliária registrou e ainda depende de você. Fica aqui até dar baixa.
              </p>
            </div>
          </div>

          {/* Renovações confirmadas pela imobiliária */}
          {renovacoesPendentes.map(c => {
            const dias = diasAte((c as any).vigencia_fim);
            const vencido = dias < 0;
            const urgente = dias >= 0 && dias <= 7;
            const prazo = dias === 0
              ? 'Vence hoje!'
              : vencido
                ? `Venceu há ${-dias} dia${dias !== -1 ? 's' : ''}`
                : `Vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
            return (
              <LinhaPendencia
                key={`ren-${c.id}`}
                cliente={c}
                parceiros={parceiros}
                fundo={vencido ? '#fef2f2' : undefined}
                etiqueta={{ texto: '🔄 Renovar', bg: '#f8f5f0', cor: '#78716c' }}
                detalhe={{
                  texto: `${vencido ? '⛔ ' : urgente ? '⚠️ ' : ''}${prazo} — ${fmtData((c as any).vigencia_fim)}`,
                  bg: vencido ? '#fecaca' : urgente ? '#fff7ed' : '#f4f1ec',
                  cor: vencido ? '#7f1d1d' : urgente ? '#c2410c' : '#78716c',
                }}
                onGoToSale={onGoToSale}
                acaoSecundaria={{ label: 'Não vai renovar', onClick: () => abrirEncerramento(c, 'saiu_imovel') }}
                acao={{ label: 'Renovada', onClick: () => darBaixaRenovacao(c) }}
              />
            );
          })}

          {/* Não vai renovar — precisa cancelar na seguradora */}
          {cancelamentosPendentes.map(c => (
            <LinhaPendencia
              key={`can-${c.id}`}
              cliente={c}
              parceiros={parceiros}
              etiqueta={{ texto: '❌ Cancelar na seguradora', bg: '#fef2f2', cor: '#dc2626' }}
              detalhe={
                (c as any).vigencia_fim
                  ? { texto: `Vigência até ${fmtData((c as any).vigencia_fim)}`, bg: '#f4f1ec', cor: '#78716c' }
                  : undefined
              }
              documentos={
                temGarantia(c)
                  ? [{ label: (c as any).distrato_url ? '📄 Distrato' : '⚠️ Sem distrato', url: (c as any).distrato_url }]
                  : []
              }
              observacao={temGarantia(c) && !(c as any).distrato_url ? 'A garantia locatícia só é cancelada com o distrato — cobre a imobiliária.' : undefined}
              acao={{ label: 'Cancelada', onClick: () => abrirEncerramento(c, 'cancelado') }}
            />
          ))}

          {/* Rescisão no meio do contrato */}
          {rescisoesPendentes.map(c => (
            <LinhaPendencia
              key={`res-${c.id}`}
              cliente={c}
              parceiros={parceiros}
              fundo="#f5f3ff"
              etiqueta={{ texto: '📋 Rescisão solicitada', bg: '#ddd6fe', cor: '#5b21b6' }}
              detalhe={{
                texto: `Pedida em ${new Date((c as any).rescisao_solicitada_em).toLocaleDateString('pt-BR')}`,
                bg: '#ede9fe',
                cor: '#5b21b6',
              }}
              documentos={[
                { label: (c as any).rescisao_distrato_url ? '📄 Distrato' : '⚠️ Sem distrato', url: (c as any).rescisao_distrato_url },
                { label: (c as any).rescisao_vistoria_url ? '📄 Vistoria' : '⚠️ Sem vistoria', url: (c as any).rescisao_vistoria_url },
              ]}
              observacao={(c as any).rescisao_obs || undefined}
              acao={{ label: 'Cancelada', onClick: () => abrirEncerramento(c, 'saiu_imovel') }}
            />
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-navy rounded-2xl p-5 text-white">
          <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-1">Total Mensal</p>
          <p className="text-2xl font-black text-gold">{fmtBRL(totalMensal)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Clientes Ativos</p>
          <p className="text-2xl font-black text-slate-800">{ativos.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Envio Automático</p>
          <p className="text-2xl font-black text-slate-800">Todo dia 10</p>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 lg:p-7">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-black text-slate-800">Novo Cliente</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Nome do Inquilino *</label>
              <input value={form.inquilino_nome} onChange={e => setForm(f => ({ ...f, inquilino_nome: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" placeholder="Ex: Maria da Silva" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Seguradora *</label>
              <input value={form.seguradora} onChange={e => setForm(f => ({ ...f, seguradora: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" placeholder="Ex: Porto Seguro" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Número da Apólice *</label>
              <input value={form.numero_apolice} onChange={e => setForm(f => ({ ...f, numero_apolice: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" placeholder="Ex: APL-2024-001" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Valor do Seguro (R$) *</label>
              <input value={form.valor_seguro} onChange={e => setForm(f => ({ ...f, valor_seguro: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" placeholder="Ex: 150,00" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Parcela Inicial</label>
              <input type="number" min="1" max="12" value={form.parcela_atual} onChange={e => setForm(f => ({ ...f, parcela_atual: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Total de Parcelas</label>
              <input type="number" min="1" value={form.total_parcelas} onChange={e => setForm(f => ({ ...f, total_parcelas: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Data de Início</label>
              <input type="date" value={form.data_inicio} onChange={e => setForm(f => ({ ...f, data_inicio: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Observações</label>
              <input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" placeholder="Opcional" />
            </div>
          </div>
          <div className="flex gap-3 mt-6 justify-end">
            <button onClick={() => setShowForm(false)} className="px-6 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !form.inquilino_nome || !form.seguradora || !form.numero_apolice || !form.valor_seguro}
              className="px-6 py-2.5 bg-navy hover:bg-navy-light text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-all disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {saving ? 'Salvando...' : 'Salvar Cliente'}
            </button>
          </div>
        </div>
      )}

      {/* Kanban Board — All clients */}
      {(() => {
        const KANBAN_COLS = [
          { key: 'solicitado',           label: 'Solicitado',           accent: '#94a3b8', labelColor: '#64748b' },
          { key: 'atendimento_iniciado', label: 'F&G em Atendimento',   accent: '#C69C6D', labelColor: '#B58A5B' },
          { key: 'aguardando_seguradora',label: 'Aguardando Seguradora',accent: '#1B263B', labelColor: '#1B263B' },
          { key: 'aguardando_cliente',   label: 'Aguardando o Cliente', accent: '#7c3aed', labelColor: '#7c3aed' },
          { key: 'aprovado',             label: 'Aprovado',             accent: '#2d6a4f', labelColor: '#2d6a4f' },
          { key: 'recusado',             label: 'Recusado',             accent: '#9b1c1c', labelColor: '#9b1c1c' },
        ];
        return (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-widest">Pipeline de Solicitações</h3>
              <span className="text-xs text-slate-400 font-bold">Arraste para mover entre etapas</span>
            </div>
            <div className="overflow-x-auto pb-1">
            <div className="flex gap-2 pb-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(160px, 1fr))', gap: '10px' }}>
              {KANBAN_COLS.map(col => {
                // Pending always show; approved/rejected only last 3 days
                const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
                const colCards = clientes.filter(c => {
                  const status = (c as any).kanban_status || 'solicitado';
                  if (status !== col.key) return false;
                  if (['solicitado','atendimento_iniciado','aguardando_seguradora','aguardando_cliente'].includes(status)) return true;
                  return new Date(c.created_at) >= tresDiasAtras;
                });
                const isOver = dragOver === col.key;
                return (
                  <div
                    key={col.key}
                    className="rounded-2xl transition-all"
                    style={{ minWidth: 0, padding: '12px', background: '#fff', border: `1px solid ${isOver ? '#C69C6D' : '#e8e4dc'}`, borderTop: `3px solid ${isOver ? '#C69C6D' : col.accent}`, boxShadow: isOver ? '0 4px 20px rgba(198,156,109,.15)' : 'none' }}
                    onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                    onDrop={e => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('clienteId');
                      if (id) moveCard(id, col.key);
                    }}
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-3">
                      <span style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1.5px', color: col.labelColor }}>{col.label}</span>
                      <span style={{ fontSize: '11px', fontWeight: 900, background: `${col.accent}18`, color: col.labelColor, padding: '2px 8px', borderRadius: '20px', minWidth: '24px', textAlign: 'center' }}>{colCards.length}</span>
                    </div>
                    {/* Cards */}
                    {colCards.length === 0 ? (
                      <div className="text-center py-5" style={{ fontSize: '11px', fontWeight: 700, color: '#c9c2b8', letterSpacing: '.5px' }}>Nenhum</div>
                    ) : (
                      colCards.map(c => {
                        const isDragging = draggingId === c.id;
                        const valorStr = Number((c as any).valor_seguro) > 0 ? fmtBRL(Number((c as any).valor_seguro)) : null;
                        const dataCriacao = new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                        const parceiro = !filterParceiro ? parceiros.find(p => p.id === (c as any).partner_id) : null;
                        return (
                          <div
                            key={c.id}
                            draggable={true}
                            onDragStart={e => { e.dataTransfer.setData('clienteId', c.id); setDraggingId(c.id); }}
                            onDragEnd={() => { setDraggingId(null); setDragOver(null); }}
                            onClick={() => openEditStatus(c)}
                            className={`select-none transition-all ${isDragging ? 'opacity-40' : ''}`}
                            style={{ background: '#fafaf8', border: '1px solid #ede9e1', borderRadius: '12px', padding: '12px', marginBottom: '8px', cursor: isDragging ? 'grabbing' : 'grab', boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,.12)' : 'none' }}
                            onMouseEnter={e => { if (!isDragging) { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#C69C6D40'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(27,38,59,.07)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; } }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fafaf8'; (e.currentTarget as HTMLElement).style.borderColor = '#ede9e1'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '5px' }}>
                              <div style={{ fontWeight: 900, fontSize: '12px', color: '#1B263B', lineHeight: 1.3 }}>{c.inquilino_nome}</div>
                              <button
                                onClick={async e => {
                                  e.stopPropagation();
                                  if (!confirm(`Excluir ${c.inquilino_nome} do kanban?`)) return;
                                  await supabase.from('imobiliaria_clientes').delete().eq('id', c.id);
                                  load();
                                }}
                                style={{ marginLeft: '6px', padding: '2px 5px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}
                                title="Excluir"
                              >✕</button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8' }}>
                                {rotuloTipoSeguro(c)}
                              </span>
                              {(c as any).intencao === 'contratar' ? (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#f0fdf4', color: '#16a34a', border: '1px solid #c3dfd4', padding: '1px 6px', borderRadius: '20px' }}>✅ Contratar</span>
                              ) : (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#fef9c3', color: '#a16207', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '20px' }}>📋 Cotação</span>
                              )}
                            </div>
                            {parceiro && (
                              <div style={{ fontSize: '10px', fontWeight: 900, color: '#78716c', background: '#f4f1ec', padding: '2px 7px', borderRadius: '8px', display: 'inline-block', marginBottom: '4px' }}>
                                {parceiro.name.replace('Imobiliária ', '')}
                              </div>
                            )}
                            {valorStr && (
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#1B263B' }}>{valorStr}</div>
                            )}
                            <div style={{ fontSize: '9px', color: '#c9c2b8', fontWeight: 600, marginTop: '8px' }}>{dataCriacao}</div>
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {(c as any).doc_contrato_url && (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#f5f7fa', color: '#1B263B', border: '1px solid #dde3ec', padding: '2px 7px', borderRadius: '20px' }}>📎 Docs</span>
                              )}
                              {(c as any).apolice_residencial_url && (
                                <span style={{ fontSize: '9px', fontWeight: 900, background: '#fdf6ee', color: '#B58A5B', border: '1px solid #e8d5bc', padding: '2px 7px', borderRadius: '20px' }}>📄 Apólice</span>
                              )}
                            </div>
                            {/* Disponível em todas as etapas: o registro de venda pode ser aberto
                                a qualquer momento, não só depois da aprovação. */}
                            {onGoToSale && (
                              <button
                                onClick={e => { e.stopPropagation(); onGoToSale({ nome: c.inquilino_nome, telefone: (c as any).telefone || '' }); }}
                                className="mt-2 w-full text-[10px] font-bold bg-gold hover:bg-gold-hover text-white py-1.5 rounded-xl transition-colors"
                              >
                                → Registro de Venda
                              </button>
                            )}
                            {col.key === 'aprovado' && temGarantia(c) && (
                              <button
                                onClick={async e => {
                                  e.stopPropagation();
                                  const partner = parceiros.find(p => p.id === (c as any).partner_id);
                                  if (!partner) { alert('Parceiro sem email cadastrado.'); return; }
                                  const docsEmFalta = [
                                    !(c as any).doc_contrato_url && 'Contrato de Locação',
                                    !(c as any).doc_termo_vistoria_url && 'Termo de Vistoria',
                                    !(c as any).doc_fotos_vistoria_url && 'Fotos da Vistoria',
                                  ].filter(Boolean);
                                  if (docsEmFalta.length === 0) { alert('Todos os documentos já foram enviados!'); return; }
                                  await supabase.functions.invoke('imobiliaria-solicitar-docs', {
                                    body: {
                                      parceiro_email: (partner as any).email || '',
                                      parceiro_nome: partner.name,
                                      inquilino_nome: c.inquilino_nome,
                                      docs_faltando: docsEmFalta,
                                    },
                                  });
                                  alert(`✅ Email enviado solicitando ${docsEmFalta.length} documento(s).`);
                                }}
                                className="mt-1 w-full text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 py-1.5 rounded-xl transition-colors border border-slate-200"
                              >
                                📎 Solicitar Documentos
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        );
      })()}

      {/* Busca — abre qualquer cliente, esteja ele em que lista estiver */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-5">
        <div className="flex items-center gap-3">
          <Search size={16} className="text-slate-400 shrink-0" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar qualquer cliente por nome ou nº da apólice (inclusive em renovação e encerrados)"
            className="flex-1 text-sm font-bold text-slate-700 placeholder:font-medium placeholder:text-slate-300 outline-none"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="text-slate-300 hover:text-slate-500 shrink-0">
              <X size={16} />
            </button>
          )}
        </div>

        {termoBusca.length >= 2 && (
          <div className="mt-4 border-t border-slate-100 pt-3 space-y-1">
            {resultadosBusca.length === 0 ? (
              <p className="text-sm font-bold text-slate-300 py-2">Nenhum cliente encontrado</p>
            ) : resultadosBusca.map(c => (
              <button
                key={c.id}
                onClick={() => openEditStatus(c)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-navy flex items-center justify-center shrink-0">
                  <User size={13} className="text-gold" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{c.inquilino_nome}</p>
                  <p className="text-[11px] font-bold text-slate-400">
                    {STATUS_APOLICE_LABELS[(c as any).status_apolice] || (c as any).status_apolice || '—'}
                    {c.numero_apolice ? ` · ${c.numero_apolice}` : ''}
                  </p>
                </div>
                {(c as any).is_repasse && (
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-xl bg-amber-50 text-amber-600 shrink-0">
                    Repasse {Number(c.valor_seguro) > 0 ? '' : '· sem valor'}
                  </span>
                )}
                <Pencil size={14} className="text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active clients table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="text-gold animate-spin" /></div>
      ) : ativos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <User size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="font-bold text-slate-400">Nenhum cliente ativo</p>
          <p className="text-slate-300 text-sm mt-1">Clique em "Novo Cliente" para começar</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-7 py-4 border-b border-slate-100 flex items-center justify-between">
            <p className="font-bold text-slate-800 text-sm">{ativos.length} cliente(s) ativo(s)</p>
            <p className="text-xs font-bold text-slate-400">Clique em "Avançar Parcela" nos clientes com repasse quando o pagamento for confirmado</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Inquilino</th>
                  {!filterParceiro && <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Parceiro</th>}
                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Seguradora</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Nº Apólice</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Seg. Residencial</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Garantia / Docs</th>
                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Valor</th>
                  <th className="text-center px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Venc.</th>
                  <th className="text-center px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Parcela</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {ativos.map(c => (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      {/* O nome abre a edição: é onde a mão vai primeiro quando
                          se quer mexer numa linha. O botão "Status" no fim da
                          linha continua ali para quem já se acostumou com ele. */}
                      <button
                        type="button"
                        onClick={() => openEditStatus(c)}
                        className="group flex items-center gap-2 text-left"
                        title="Clique para editar este cliente"
                      >
                        <div className="w-8 h-8 rounded-full bg-navy flex items-center justify-center shrink-0">
                          <User size={13} className="text-gold" />
                        </div>
                        <span className="font-bold text-slate-800 text-sm group-hover:text-gold transition-colors">
                          {c.inquilino_nome}
                        </span>
                        <Pencil size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </button>
                    </td>
                    {!filterParceiro && (
                      <td className="px-5 py-4">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-xl bg-slate-100 text-slate-600">
                          {parceiros.find(p => p.id === (c as any).partner_id)?.name?.replace('Imobiliária ', '') || '—'}
                        </span>
                      </td>
                    )}
                    <td className="px-5 py-4 text-sm font-bold text-slate-700">{c.seguradora && c.seguradora !== 'Importado' ? c.seguradora : <span className="text-slate-300">—</span>}</td>
                    <td className="px-5 py-4 text-sm font-mono text-slate-500">{c.numero_apolice || <span className="text-slate-300">—</span>}</td>
                    <td className="px-5 py-4">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-xl ${STATUS_COLORS[c.status_residencial || 'aguardando_cotacao'] || 'bg-slate-50 text-slate-500'}`}>
                        {getStatusLabel(c.status_residencial || 'aguardando_cotacao', (c as any).status_apolice)}
                      </span>
                      {c.apolice_residencial_url && <a href={c.apolice_residencial_url} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] font-bold text-emerald-600 hover:underline">⬇ Apólice</a>}
                    </td>
                    <td className="px-5 py-4">
                      {temGarantia(c) ? (
                        <div className="space-y-1">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-xl ${STATUS_COLORS[c.status_garantia || 'aguardando_cotacao'] || 'bg-slate-50 text-slate-500'}`}>
                            {STATUS_LABELS[c.status_garantia || 'aguardando_cotacao']}
                          </span>
                          {c.apolice_garantia_url && <a href={c.apolice_garantia_url} target="_blank" rel="noreferrer" className="block text-[10px] font-bold text-emerald-600 hover:underline">⬇ Apólice</a>}
                          {/* Documentos */}
                          <div className="flex flex-col gap-0.5 mt-1">
                            {[['doc_contrato_url','Contrato'],['doc_termo_vistoria_url','Vistoria'],['doc_fotos_vistoria_url','Fotos']].map(([key, label]) => (
                              (c as any)[key]
                                ? <a key={key} href={(c as any)[key]} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-600 hover:underline">📎 {label}</a>
                                : <span key={key} className="text-[10px] text-slate-300">📎 {label} pendente</span>
                            ))}
                          </div>
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-slate-800">{fmtBRL(Number(c.valor_seguro))}</td>
                    <td className="px-5 py-4 text-center">
                      {c.dia_vencimento_aluguel ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-xl text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          dia {c.dia_vencimento_aluguel}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center px-3 py-1 rounded-xl text-xs font-bold ${
                        c.parcela_atual === c.total_parcelas
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {c.parcela_atual}/{c.total_parcelas}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openEditStatus(c)}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl transition-colors"
                          title="Atualizar status e apólice">
                          <Pencil size={12} className="inline mr-1" /> Status
                        </button>
                        {(c as any).is_repasse && (
                          <button
                            onClick={() => avancarParcela(c)}
                            className="px-3 py-1.5 bg-gold/15 hover:bg-gold/30 text-gold text-xs font-bold rounded-xl transition-colors"
                            title={c.parcela_atual === c.total_parcelas ? 'Encerrar contrato' : 'Avançar para próxima parcela'}
                          >
                            {c.parcela_atual === c.total_parcelas ? 'Encerrar' : 'Avançar Parcela'}
                          </button>
                        )}
                        {confirmDelete === c.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deletar(c.id)} className="text-rose-500 text-xs font-bold hover:text-rose-700">Confirmar</button>
                            <button onClick={() => setConfirmDelete(null)} className="text-slate-400 text-xs hover:text-slate-600">Cancelar</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(c.id)} className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-navy">
                  <td colSpan={3} className="px-5 py-3 text-white font-bold text-sm">TOTAL MENSAL</td>
                  <td className="px-5 py-3 text-gold font-bold text-sm">{fmtBRL(totalMensal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Encerrados */}
      {encerrados.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <button onClick={() => setShowEncerrados(e => !e)}
            className="w-full flex items-center justify-between px-7 py-4 hover:bg-slate-50 transition-colors">
            <p className="font-bold text-slate-500 text-sm">{encerrados.length} cliente(s) encerrado(s)</p>
            {showEncerrados ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </button>
          {showEncerrados && (
            <div className="border-t border-slate-100">
              {encerrados.map(c => (
                <div key={c.id} className="flex items-center justify-between px-7 py-3 border-b border-slate-50 opacity-50">
                  <span className="text-sm font-bold text-slate-600">{c.inquilino_nome}</span>
                  <span className="text-xs text-slate-400">{c.seguradora} · {c.numero_apolice} · {fmtBRL(Number(c.valor_seguro))} · {c.total_parcelas}/{c.total_parcelas}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    {/* Guia de operação — o passo a passo da contratação, do pedido ao encerramento */}
    {guiaAberto && createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-start justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={() => setGuiaAberto(false)}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="bg-navy px-7 py-5 flex items-start justify-between gap-4 sticky top-0">
            <div>
              <h3 className="text-white font-black text-lg">Como funciona esta tela</h3>
              <p className="text-white/50 text-[12px] font-semibold mt-1">
                O caminho de um cliente residencial, do pedido da imobiliária até a saída da carteira.
              </p>
            </div>
            <button onClick={() => setGuiaAberto(false)} className="text-white/40 hover:text-white flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="px-7 py-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {GUIA_PASSOS.map((p, i) => (
              <div key={p.titulo} className="flex gap-4">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-8 h-8 rounded-xl bg-navy text-gold font-bold text-[13px] flex items-center justify-center">
                    {i + 1}
                  </div>
                  {i < GUIA_PASSOS.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-2" />}
                </div>
                <div className="pb-1">
                  <p className="font-bold text-[14px] text-navy">{p.titulo}</p>
                  <p className="text-[13px] text-slate-600 font-semibold leading-relaxed mt-1">{p.texto}</p>
                  {p.atencao && (
                    <div className="flex items-start gap-2 mt-2 bg-orange-50 border border-orange-300 rounded-xl px-3 py-2">
                      <AlertTriangle size={13} className="text-orange-700 flex-shrink-0 mt-0.5" />
                      <p className="text-[12px] font-bold text-orange-800 leading-relaxed">{p.atencao}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div className="bg-areia-clara border border-linha rounded-2xl px-5 py-4">
              <p className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-2">Para lembrar</p>
              <ul className="space-y-1.5">
                {GUIA_LEMBRETES.map(l => (
                  <li key={l} className="flex items-start gap-2 text-[12.5px] text-slate-600 font-semibold leading-relaxed">
                    <span className="text-gold font-bold flex-shrink-0">•</span> {l}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="px-7 py-4 bg-areia-clara border-t border-linha flex justify-end">
            <button
              onClick={() => setGuiaAberto(false)}
              className="px-5 py-2.5 bg-navy hover:bg-navy-light text-gold font-bold text-sm rounded-xl transition-colors"
            >
              Entendi
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Encerramento do seguro — escolher a situação e avisar a imobiliária */}
    {encerramentoModal && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-black text-slate-800 text-lg">Encerrar o seguro</h3>
              <p className="text-slate-500 text-sm mt-1">O cadastro sai da carteira ativa e do portal da imobiliária.</p>
            </div>
            <button onClick={() => setEncerramentoModal(null)} className="text-slate-300 hover:text-slate-500">
              <X size={18} />
            </button>
          </div>

          <div className="bg-navy/5 rounded-xl px-4 py-3 border border-gold/20">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Inquilino</p>
            <p className="font-bold text-slate-800">{encerramentoModal.cliente.inquilino_nome}</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">O que aconteceu</label>
            <div className="grid grid-cols-2 gap-2">
              {SITUACOES_ENCERRAMENTO.map(s => {
                const ativa = encerramentoModal.situacao === s.valor;
                return (
                  <button
                    key={s.valor} type="button"
                    onClick={() => setEncerramentoModal(m => m ? { ...m, situacao: s.valor } : m)}
                    className="text-left px-3 py-2.5 rounded-xl border-2 transition-all"
                    style={{
                      background: ativa ? s.bg : '#fff',
                      borderColor: ativa ? s.cor : '#e2e8f0',
                    }}
                  >
                    <p className="font-bold text-[12px]" style={{ color: ativa ? s.cor : '#334155' }}>{s.rotulo}</p>
                    <p className="text-[10px] font-semibold text-slate-400 leading-tight mt-0.5">{s.ajuda}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observação (opcional)</label>
            <textarea
              rows={2}
              value={encerramentoModal.observacao}
              onChange={e => setEncerramentoModal(m => m ? { ...m, observacao: e.target.value } : m)}
              placeholder="Ex: avisou por telefone que entrega as chaves dia 30."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold outline-none focus:border-gold resize-none"
            />
            <p className="text-[11px] text-slate-400">Se preencher, vai junto no e-mail da imobiliária.</p>
          </div>

          <button
            type="button"
            onClick={() => setEncerramentoModal(m => m ? { ...m, avisar: !m.avisar } : m)}
            className={`w-full flex items-start gap-3 text-left px-4 py-3 rounded-xl border-2 transition-all ${encerramentoModal.avisar ? 'border-gold bg-gold/5' : 'border-slate-200 bg-white'}`}
          >
            <div className={`w-5 h-5 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${encerramentoModal.avisar ? 'bg-gold' : 'bg-slate-200'}`}>
              {encerramentoModal.avisar && <CheckCircle2 size={13} className="text-white" />}
            </div>
            <div>
              <p className="font-bold text-[12px] text-slate-700 flex items-center gap-1.5">
                <Mail size={12} className="text-gold" /> Avisar a imobiliária por e-mail
              </p>
              <p className="text-[11px] font-semibold text-slate-400 leading-tight mt-0.5">
                {parceiros.find(p => p.id === encerramentoModal.cliente.partner_id)?.name.replace('Imobiliária ', '')
                  || 'Nenhuma imobiliária vinculada a este cadastro'}
              </p>
            </div>
          </button>

          {encerramentoErro && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl font-bold text-[12px]">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {encerramentoErro}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={confirmarEncerramento}
              disabled={encerrando}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-navy hover:bg-navy-light disabled:opacity-50 text-gold font-bold text-sm rounded-xl transition-all"
            >
              {encerrando ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {encerrando ? 'Encerrando...' : 'Encerrar'}
            </button>
            <button
              onClick={() => setEncerramentoModal(null)}
              disabled={encerrando}
              className="py-3 px-5 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl disabled:opacity-50"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Registrar Repasse Modal */}
    {/* Modal de configuração de repasse para novos clientes do portal */}
    {repasseSetupModal && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 space-y-5">
          <div>
            <h3 className="font-black text-slate-800 text-lg">Configurar Repasse</h3>
            <p className="text-slate-500 text-sm mt-1">Cliente novo do portal — configure o repasse antes de aprovar.</p>
          </div>
          <div className="bg-navy/5 rounded-xl px-4 py-3 border border-gold/20">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">Inquilino</p>
            <p className="font-bold text-slate-800">{repasseSetupModal.nome}</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Mensal do Seguro (R$)</label>
              <input
                type="text" placeholder="Ex: 182,49"
                value={repasseSetupForm.valor_seguro}
                onChange={e => setRepasseSetupForm(f => ({ ...f, valor_seguro: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-gold"
              />
              <p className="text-xs text-slate-400">Este valor será cobrado mensalmente no repasse da imobiliária.</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dia de Vencimento do Aluguel</label>
              <div className="flex items-center gap-3">
                <input
                  type="number" min="1" max="28" placeholder="Ex: 20"
                  value={repasseSetupForm.dia_vencimento_aluguel}
                  onChange={e => setRepasseSetupForm(f => ({ ...f, dia_vencimento_aluguel: e.target.value }))}
                  className="w-28 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-gold"
                />
                <p className="text-xs text-slate-400 flex-1">O aviso de repasse será enviado automaticamente 10 dias antes deste dia.</p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Número de Parcelas</label>
              <div className="grid grid-cols-3 gap-2">
                {[6, 12, 24].map(n => (
                  <button key={n} type="button"
                    onClick={() => setRepasseSetupForm(f => ({ ...f, total_parcelas: n }))}
                    className={`py-3 rounded-xl font-bold text-sm transition-all ${repasseSetupForm.total_parcelas === n ? 'bg-navy text-gold' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {n}x
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">A 1ª parcela é paga diretamente pela inquilina. As demais entram no repasse mensal.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={confirmarRepasseSetup}
              disabled={!((lerValorBRL(repasseSetupForm.valor_seguro) ?? 0) > 0)}
              className="flex-1 py-3 bg-gold hover:bg-gold-hover disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all">
              ✅ Aprovar e configurar repasse
            </button>
            <button onClick={() => setRepasseSetupModal(null)}
              className="py-3 px-5 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl">
              Cancelar
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {repasseModal && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-slate-800 text-lg">Registrar Repasse</h3>
            <button onClick={() => setRepasseModal(false)}><X size={18} className="text-slate-400" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Mês</label>
              <select value={repasseForm.mes} onChange={e => setRepasseForm(f => ({...f, mes: parseInt(e.target.value)}))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold">
                {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i) =>
                  <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Ano</label>
              <input type="number" value={repasseForm.ano} onChange={e => setRepasseForm(f => ({...f, ano: parseInt(e.target.value)}))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Data do Pagamento</label>
            <input type="date" value={repasseForm.data_pagamento} onChange={e => setRepasseForm(f => ({...f, data_pagamento: e.target.value}))}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Comprovante (PDF ou imagem)</label>
            <input type="file" accept="application/pdf,image/*" onChange={e => setRepasseFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-slate-100 file:font-bold file:text-slate-700" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Observações</label>
            <input value={repasseForm.observacoes} onChange={e => setRepasseForm(f => ({...f, observacoes: e.target.value}))}
              placeholder="Opcional" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setRepasseModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm">Cancelar</button>
            <button onClick={salvarRepasse} disabled={savingRepasse}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {savingRepasse ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {savingRepasse ? 'Salvando...' : 'Salvar Repasse'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Edit Status Modal — rendered via portal to escape stacking context */}
    {editingStatus && createPortal(
      <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-4">
          {/* Header */}
          <div className="flex items-center justify-between px-7 pt-7 pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-black text-slate-800 text-lg">Atualizar Status</h3>
              <p className="text-sm text-slate-500 mt-0.5">{editStatusForm.inquilino_nome || editingStatus.inquilino_nome}</p>
            </div>
            <button onClick={() => setEditingStatus(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} className="text-slate-400" /></button>
          </div>

          <div className="px-7 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Inquilino</label>
                <input
                  value={editStatusForm.inquilino_nome}
                  onChange={e => setEditStatusForm(f => ({...f, inquilino_nome: e.target.value}))}
                  placeholder="Nome do inquilino"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:border-gold" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Etapa no Kanban</label>
                <select value={editStatusForm.kanban_status} onChange={e => setEditStatusForm(f => ({...f, kanban_status: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold">
                  <option value="solicitado">📬 Solicitado</option>
                  <option value="atendimento_iniciado">🔄 F&G em atendimento</option>
                  <option value="aguardando_seguradora">⏳ Aguardando Seguradora</option>
                  <option value="aguardando_cliente">👤 Aguardando o Cliente</option>
                  <option value="aprovado">✅ Aprovado</option>
                  <option value="recusado">❌ Recusado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Situação</label>
                <select value={editStatusForm.status_apolice} onChange={e => setEditStatusForm(f => ({...f, status_apolice: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold">
                  <option value="ativo">🟢 Ativo</option>
                  <option value="pagamento_atrasado">🟡 Pgto. atrasado</option>
                  <option value="em_renovacao">🔵 Em renovação</option>
                  <option value="cancelado">🔴 Cancelado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Vencimento</label>
                <input type="date" value={editStatusForm.vigencia_fim} onChange={e => setEditStatusForm(f => ({...f, vigencia_fim: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
              </div>
            </div>

            {/* Auto-advance hint */}
            {['emitido','aprovado'].includes(editStatusForm.status_residencial) && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 size={13} /> Ao salvar, o card moverá automaticamente para <strong>Aprovado</strong> no kanban
              </div>
            )}

            {/* Seguradora e Apólice */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Seguradora</label>
                <input value={editStatusForm.seguradora} onChange={e => setEditStatusForm(f => ({...f, seguradora: e.target.value}))}
                  placeholder="Ex: Porto Seguro" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Nº Apólice</label>
                <input value={editStatusForm.numero_apolice} onChange={e => setEditStatusForm(f => ({...f, numero_apolice: e.target.value}))}
                  placeholder="Ex: APL-2026-001" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-gold" />
              </div>
            </div>

            {/* Repasse */}
            <div className="bg-amber-50 rounded-2xl p-4 space-y-3 border border-amber-100">
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Repasse Mensal</p>

              {/* Sem esta marcação o cliente não entra na lista de repasses ativos
                  nem no total mensal — os campos abaixo ficariam sem efeito. */}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editStatusForm.is_repasse}
                  onChange={e => setEditStatusForm(f => ({...f, is_repasse: e.target.checked}))}
                  className="mt-0.5 w-4 h-4 accent-gold cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-700 leading-tight">
                  Este seguro é cobrado por repasse da imobiliária
                  <span className="block text-[10px] font-medium text-amber-600 mt-0.5">
                    A 1ª parcela é sempre paga pelo cliente; a cobrança da imobiliária começa na 2ª.
                  </span>
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Valor Mensal (R$)</label>
                  <input
                    type="text" placeholder="Ex: 182,49"
                    value={editStatusForm.valor_seguro}
                    onChange={e => setEditStatusForm(f => ({...f, valor_seguro: e.target.value}))}
                    className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-bold focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Dia Venc. Aluguel</label>
                  <input
                    type="number" min="1" max="28" placeholder="Ex: 20"
                    value={editStatusForm.dia_vencimento_aluguel}
                    onChange={e => setEditStatusForm(f => ({...f, dia_vencimento_aluguel: e.target.value}))}
                    className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-bold focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
              <p className="text-[10px] text-amber-600">Aviso enviado 10 dias antes do vencimento</p>
            </div>

            {/* Recado para a imobiliária — aparece no portal do parceiro */}
            <div className="bg-blue-50 rounded-2xl p-4 space-y-2 border border-blue-100">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Observação para a Imobiliária</p>
              <textarea
                rows={3}
                value={editStatusForm.observacao_imobiliaria}
                onChange={e => setEditStatusForm(f => ({...f, observacao_imobiliaria: e.target.value}))}
                placeholder="Ex: Aguardando o cliente enviar o comprovante de renda para seguir com a cotação."
                className="w-full px-3 py-2.5 border border-blue-200 bg-white rounded-xl text-sm focus:outline-none focus:border-gold resize-y"
              />
              <p className="text-[10px] text-blue-600">👁️ A imobiliária vê este texto no portal. Para anotação interna, use o campo de observações do cadastro.</p>

              {/* Recado que é pergunta: o portal sozinho não avisa ninguém.
                  Marcando aqui, a imobiliária recebe um e-mail com o texto. */}
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${editStatusForm.recado_precisa_retorno ? 'bg-orange-50 border-orange-200' : 'bg-white border-blue-200'} ${!editStatusForm.observacao_imobiliaria.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <input
                  type="checkbox"
                  disabled={!editStatusForm.observacao_imobiliaria.trim()}
                  checked={editStatusForm.recado_precisa_retorno}
                  onChange={e => setEditStatusForm(f => ({ ...f, recado_precisa_retorno: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 shrink-0 accent-orange-500"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-slate-700">Preciso de retorno da imobiliária</span>
                  <span className="block text-[10px] text-slate-500 leading-relaxed">
                    Envia um e-mail com este recado para o parceiro e destaca no portal até você desmarcar.
                  </span>
                </span>
              </label>
              {(editingStatus as any).recado_enviado_em && (
                <p className="text-[10px] text-slate-400">
                  Último aviso enviado em {new Date((editingStatus as any).recado_enviado_em).toLocaleString('pt-BR')}
                </p>
              )}
            </div>

            {/* Apólice Residencial */}
            <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Seguro Residencial</p>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Status</label>
                <select value={editStatusForm.status_residencial} onChange={e => setEditStatusForm(f => ({...f, status_residencial: e.target.value}))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">PDF da Apólice</label>
                {editStatusForm.apolice_residencial_url
                  ? <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      <a href={editStatusForm.apolice_residencial_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 hover:underline flex-1 truncate">PDF enviado — clique para ver</a>
                      <button onClick={() => setEditStatusForm(f => ({...f, apolice_residencial_url: ''}))} className="text-slate-400 hover:text-rose-400"><X size={13} /></button>
                    </div>
                  : <ApoliceUpload
                      clienteId={editingStatus.id}
                      field="apolice_residencial_url"
                      onUploaded={(url) => setEditStatusForm(f => ({...f, apolice_residencial_url: url}))}
                    />
                }
              </div>
            </div>

            {/* Garantia */}
            {temGarantia(editingStatus) && (
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Garantia de Aluguel</p>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Status</label>
                  <select value={editStatusForm.status_garantia} onChange={e => setEditStatusForm(f => ({...f, status_garantia: e.target.value}))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">PDF da Apólice</label>
                  {editStatusForm.apolice_garantia_url
                    ? <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        <a href={editStatusForm.apolice_garantia_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 hover:underline flex-1 truncate">PDF enviado — clique para ver</a>
                        <button onClick={() => setEditStatusForm(f => ({...f, apolice_garantia_url: ''}))} className="text-slate-400 hover:text-rose-400"><X size={13} /></button>
                      </div>
                    : <ApoliceUpload
                        clienteId={editingStatus.id}
                        field="apolice_garantia_url"
                        onUploaded={(url) => setEditStatusForm(f => ({...f, apolice_garantia_url: url}))}
                      />
                  }
                </div>
              </div>
            )}
          </div>

          {/* Atalho para o Registro de Venda, disponível em qualquer etapa.
              Fica separado dos botões abaixo porque sai da tela: alterações
              não salvas neste formulário são descartadas, igual ao Cancelar. */}
          {onGoToSale && (
            <div className="px-7 pt-2">
              <button
                onClick={() => {
                  const nome = editingStatus.inquilino_nome;
                  const telefone = (editingStatus as any).telefone || '';
                  setEditingStatus(null);
                  onGoToSale({ nome, telefone });
                }}
                className="w-full py-2.5 bg-gold hover:bg-gold-hover text-white rounded-xl font-bold text-sm transition-colors"
              >
                → Registro de Venda
              </button>
              <p className="text-[10px] text-slate-400 font-semibold text-center mt-1.5">
                Sai desta tela sem salvar as alterações acima
              </p>
            </div>
          )}

          <div className="flex gap-3 px-7 pb-7 pt-2">
            <button onClick={() => setEditingStatus(null)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm transition-colors">Cancelar</button>
            <button onClick={saveStatus} className="flex-1 py-2.5 bg-navy hover:bg-navy-light text-white rounded-xl font-bold text-sm transition-colors">Salvar</button>
          </div>
        </div>
        </div>
      </div>,
      document.body
    )}
    </div>
  );
}
