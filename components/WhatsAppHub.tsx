import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, RefreshCw, User, Loader2, Plus, X, CheckCircle2, Tag, FileText, Paperclip, Image, Trash2, Pencil, Mic, Volume2, AlertCircle, Search, ChevronRight, ChevronDown, Smile, Reply, Check, CheckCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { WhatsAppClientCard } from './WhatsAppClientCard.tsx';

const PRODUCT_TYPES = ['Seguro Garantia', 'Judicial Depósito Recursal', 'Energia', 'Seguro de crédito'] as const;

interface Lead {
  id: string;
  phone: string;
  name: string;
  status: string;
  updated_at: string;
}

interface Message {
  id: string;
  phone: string;
  name: string;
  message: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
  zapi_id?: string | null;
  audio_url?: string | null;
  /** Endereço do arquivo: bucket whatsapp-midia no enviado, Z-API no recebido. */
  media_url?: string | null;
  /** 'image' | 'video' | 'document' | 'audio' | 'sticker' */
  media_type?: string | null;
  media_name?: string | null;
  /** zapi_id da mensagem citada, mais o retrato dela para a bolha da citação
   *  continuar legível quando a original é antiga e não veio no lote. */
  responde_a?: string | null;
  responde_a_texto?: string | null;
  responde_a_de?: string | null;
  /** Emoji da reação. Só existem dois lados na conversa, então duas colunas. */
  reacao_nossa?: string | null;
  reacao_deles?: string | null;
  /** 'sent' | 'delivered' | 'read' | 'played' nas enviadas, 'received' nas
   *  recebidas. Vem do MessageStatusCallback da Z-API. */
  status?: string | null;
  /** Bolha otimista: já está na tela mas ainda não voltou do banco. */
  pendente?: boolean;
  /** O envio deu erro. A bolha fica na tela marcada, sem sumir. */
  falhou?: boolean;
}

/** Um risco = enviada, dois riscos = entregue, dois riscos azuis = lida.
 *  Só existe nas nossas: no WhatsApp a mensagem recebida não tem visto. */
function Visto({ msg }: { msg: Message }) {
  if (msg.direction !== 'outbound' || msg.pendente || msg.falhou) return null;
  const s = msg.status ?? 'sent';
  if (s === 'read' || s === 'played') return <CheckCheck size={13} className="inline ml-1 -mt-0.5 text-blue-400" />;
  if (s === 'delivered') return <CheckCheck size={13} className="inline ml-1 -mt-0.5 opacity-70" />;
  return <Check size={13} className="inline ml-1 -mt-0.5 opacity-70" />;
}

/** Emojis do seletor, agrupados como no WhatsApp. Lista curada em vez de
 *  biblioteca inteira: pesa nada no bundle e cobre o uso do atendimento. */
const EMOJIS: { grupo: string; lista: string[] }[] = [
  {
    grupo: 'Rostos',
    lista: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😗', '😋', '😜', '🤪', '🤗', '🤔', '🤨', '😐', '😑', '🙄', '😏', '😴', '😌', '😔', '😕', '🙁', '😟', '😞', '😢', '😭', '😤', '😠', '😡', '🥺', '😳', '🤯', '😬', '😰', '🤝', '🙏'],
  },
  {
    grupo: 'Gestos',
    lista: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤙', '👊', '✊', '👏', '🙌', '👐', '💪', '🫡', '👋', '☝️', '👉', '👈', '👇', '☑️', '✅', '❌', '⚠️', '❗', '❓', '💯', '🔥', '⭐', '✨', '🎉', '🎊', '🚀'],
  },
  {
    grupo: 'Trabalho',
    lista: ['📄', '📃', '📑', '📋', '📁', '📂', '🗂️', '📊', '📈', '📉', '💰', '💵', '💳', '🧾', '🏦', '🏢', '🏗️', '⚖️', '🔒', '🔑', '📌', '📎', '✏️', '🖊️', '📝', '📅', '🗓️', '⏰', '⏳', '📞', '📱', '💻', '📧', '📤', '📥', '🔍'],
  },
  {
    grupo: 'Símbolos',
    lista: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💔', '💬', '💭', '👀', '🤲', '🎯', '🏆', '🥇', '💡', '☀️', '🌙', '☕', '🍀', '🎁', '📢', '🔔', '➡️', '⬅️', '⬆️', '⬇️', '🔄', '🆗', '🆕', '🔝'],
  },
];

/** As seis reações rápidas do WhatsApp. Para qualquer outro emoji a pessoa
 *  usa o seletor completo, mas 99% das reações do atendimento são estas. */
const REACOES_RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Quantas mensagens carregamos de cara ao abrir uma conversa.
 *  Antes vinha a conversa inteira (a maior tem quase 900 mensagens),
 *  então abrir um contato antigo travava a tela. */
const MENSAGENS_POR_PAGINA = 80;

/** Texto que o banco guarda quando a mídia veio sem legenda. Serve para a
 *  lista de contatos e a busca, mas não deve virar legenda na bolha. */
const ROTULOS_MIDIA = ['[Imagem]', '[Vídeo]', '[Figurinha]', '[Áudio]'];

/** A legenda de verdade da mídia, ou vazio se a mensagem for só o rótulo. */
function legendaDaMidia(msg: Message): string {
  const t = (msg.message ?? '').trim();
  if (!t) return '';
  if (ROTULOS_MIDIA.includes(t)) return '';
  if (/^\[(Documento|Imagem|Vídeo|Arquivo|Áudio|PDF):[^\]]*\]$/.test(t)) return '';
  // Enviado com legenda fica "[Imagem: foto.jpg] - legenda".
  const comLegenda = t.match(/^\[[^\]]+\]\s-\s([\s\S]+)$/);
  if (comLegenda) return comLegenda[1];
  return t;
}

/** Etiqueta do separador de dia: Hoje, Ontem ou a data por extenso. */
function rotuloDoDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mesmoDia(d, hoje)) return 'Hoje';
  if (mesmoDia(d, ontem)) return 'Ontem';
  const esteAno = d.getFullYear() === hoje.getFullYear();
  return d.toLocaleDateString('pt-BR', esteAno
    ? { day: '2-digit', month: 'long' }
    : { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Compara duas listas de leads pelos campos que a tela mostra.
 *  Se nada mudou devolvemos o array antigo, e assim o refresh de 10 em 10
 *  segundos deixa de re-renderizar a conversa aberta sem necessidade. */
function mesmaLista(a: Lead[], b: Lead[]) {
  if (a.length !== b.length) return false;
  return a.every((l, i) =>
    l.phone === b[i].phone && l.name === b[i].name &&
    l.status === b[i].status && l.updated_at === b[i].updated_at
  );
}

const STATUS_COLORS: Record<string, string> = {
  'novo': 'bg-emerald-500',
  'em atendimento': 'bg-blue-500',
  'cotação enviada': 'bg-amber-500',
  'seguro de proposta': 'bg-gold',
  'fechado': 'bg-slate-400',
};

const STATUS_LABELS: Record<string, string> = {
  'novo': 'Novo',
  'em atendimento': 'Em atendimento',
  'cotação enviada': 'Cotação enviada',
  'seguro de proposta': 'Seguro de Proposta',
  'fechado': 'Fechado',
};

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  if (diffMin < 2880) return 'ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function WhatsAppHub({ onGoToSale }: { onGoToSale?: (data: { nome: string; telefone: string }) => void } = {}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState('');
  const [matchingPhones, setMatchingPhones] = useState<Set<string> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiBoxRef = useRef<HTMLDivElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const messagesRef = useRef<Message[]>([]);
  /** Telefone aberto, para o refresh da lista (que roda calado, fora do
   *  render) saber qual conversa não deve ganhar bolinha de não lida. */
  const selectedPhoneRef = useRef<string | null>(null);
  const convOpenedAtRef = useRef<string>('');
  /** Altura da lista antes de emendar mensagens antigas no topo. */
  const alturaAntesRef = useRef<number | null>(null);
  /** O canal de Realtime está mesmo conectado? Define se precisamos poll. */
  const realtimeOkRef = useRef(false);
  /** Mesma ideia, mas para o canal da lista lateral de conversas. */
  const realtimeLeadsOkRef = useRef(false);

  /** 'composing' | 'recording' quando o contato está digitando ou gravando. */
  const [presenca, setPresenca] = useState<string | null>(null);
  /** A Z-API nem sempre manda o "parou de digitar", então o estado expira
   *  sozinho. Sem isso o "digitando..." ficaria preso no cabeçalho. */
  const presencaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca dentro da conversa aberta
  const [buscaConversa, setBuscaConversa] = useState('');
  const [mostrarBuscaConversa, setMostrarBuscaConversa] = useState(false);
  const [achadosConversa, setAchadosConversa] = useState<Message[] | null>(null);
  const [buscandoConversa, setBuscandoConversa] = useState(false);
  const buscaConversaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mensagem que a busca trouxe para a tela. Ganha um anel por alguns
   *  segundos, para o olho achar onde ela caiu no meio do histórico. */
  const [destacadoId, setDestacadoId] = useState<string | null>(null);
  /** Quando preenchido, o efeito de scroll rola até essa mensagem em vez de
   *  cair no fim da conversa. */
  const pularParaIdRef = useRef<string | null>(null);

  // Paginação para trás
  const [temMaisAntigas, setTemMaisAntigas] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);

  // Seletor de emoji
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  const [grupoEmoji, setGrupoEmoji] = useState(0);

  /** Imagem aberta em tela cheia ao clicar na bolha. */
  const [midiaAberta, setMidiaAberta] = useState<{ url: string; tipo: string } | null>(null);

  /** Quantas recebidas chegaram depois da última vez que a conversa foi
   *  aberta, por telefone. Vem da função whatsapp_nao_lidas() do banco. */
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});

  /** Verdadeiro quando a pessoa subiu no histórico. Mostra o botão de voltar
   *  ao fim, como o do WhatsApp. */
  const [longeDoFim, setLongeDoFim] = useState(false);

  // Pending file attachments
  const [pendingFiles, setPendingFiles] = useState<{ name: string; type: string; base64: string }[]>([]);

  // CRM Modal state
  const [crmModalLead, setCrmModalLead] = useState<Lead | null>(null);
  const [crmProductType, setCrmProductType] = useState<string>('Seguro Garantia');
  const [crmSaving, setCrmSaving] = useState(false);
  const [crmSuccess, setCrmSuccess] = useState(false);

  // Message edit/delete state
  const [editingMsg, setEditingMsg] = useState<{ id: string; zapi_id?: string | null; text: string } | null>(null);
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);

  /** Mensagem que estamos citando na próxima resposta. Fica na tarja acima do
   *  campo de texto até enviar ou cancelar, igual ao WhatsApp. */
  const [respondendo, setRespondendo] = useState<Message | null>(null);
  /** Id da mensagem com a barrinha de emojis de reação aberta. */
  const [reagindoId, setReagindoId] = useState<string | null>(null);

  // Gravação de voz
  const [gravando, setGravando] = useState(false);
  const [segundosGravacao, setSegundosGravacao] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const cronometroRef = useRef<number | null>(null);
  /** Marcado antes do stop quando a pessoa desiste. O onstop é o mesmo nos dois
   *  caminhos, então precisa saber se manda ou joga fora. */
  const descartarAudioRef = useRef(false);

  // Delete conversation
  const [deletingConv, setDeletingConv] = useState<string | null>(null);

  const selectedLead = leads.find(l => l.phone === selectedPhone);

  /** `comSpinner` só na primeira carga e no botão de atualizar. O refresh
   *  automático roda calado, senão a lista de contatos pisca de 10 em 10s. */
  const loadLeads = useCallback(async (comSpinner = false) => {
    if (comSpinner) setLoading(true);
    const { data } = await supabase
      .from('whatsapp_leads')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) setLeads(prev => (mesmaLista(prev, data) ? prev : data));

    // Uma consulta só devolve o contador de todas as conversas. Contar no
    // cliente exigiria baixar o histórico inteiro a cada 10 segundos.
    const { data: contagem } = await supabase.rpc('whatsapp_nao_lidas');
    if (contagem) {
      const mapa: Record<string, number> = {};
      for (const linha of contagem as { phone: string; nao_lidas: number }[]) {
        mapa[linha.phone] = Number(linha.nao_lidas);
      }
      // A conversa aberta nunca mostra bolinha: quem está lendo já leu.
      if (selectedPhoneRef.current) delete mapa[selectedPhoneRef.current];
      setNaoLidas(prev => {
        const iguais = Object.keys(mapa).length === Object.keys(prev).length
          && Object.keys(mapa).every(k => prev[k] === mapa[k]);
        return iguais ? prev : mapa;
      });
    }
    setLoading(false);
  }, []);

  /** Zera o contador da conversa: guarda o instante da abertura no banco e
   *  some com a bolinha na hora, sem esperar o próximo refresh. */
  const marcarComoLida = useCallback(async (phone: string) => {
    setNaoLidas(prev => {
      if (!prev[phone]) return prev;
      const copia = { ...prev };
      delete copia[phone];
      return copia;
    });
    await supabase
      .from('whatsapp_leads')
      .update({ lido_em: new Date().toISOString() })
      .eq('phone', phone);
  }, []);

  /** Traz só a última página de mensagens, da mais nova para a mais antiga,
   *  e devolve invertido para exibir na ordem certa. */
  const loadMessages = useCallback(async (phone: string, comSpinner = true) => {
    if (comSpinner) setLoadingMessages(true);
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(MENSAGENS_POR_PAGINA + 1);
    if (data) {
      const temMais = data.length > MENSAGENS_POR_PAGINA;
      setTemMaisAntigas(temMais);
      setMessages((temMais ? data.slice(0, MENSAGENS_POR_PAGINA) : data).reverse() as Message[]);
    }
    setLoadingMessages(false);
  }, []);

  /** Botão "carregar mensagens anteriores": busca o lote seguinte para trás
   *  e emenda no topo, preservando a posição do scroll. */
  const carregarAntigas = useCallback(async () => {
    const atual = messagesRef.current;
    if (!selectedPhone || carregandoAntigas || atual.length === 0) return;
    setCarregandoAntigas(true);
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', selectedPhone)
      .lt('created_at', atual[0].created_at)
      .order('created_at', { ascending: false })
      .limit(MENSAGENS_POR_PAGINA + 1);
    if (data) {
      const temMais = data.length > MENSAGENS_POR_PAGINA;
      setTemMaisAntigas(temMais);
      const lote = (temMais ? data.slice(0, MENSAGENS_POR_PAGINA) : data).reverse() as Message[];
      // Guarda a altura de antes para o scroll não pular ao inserir acima.
      alturaAntesRef.current = listaRef.current?.scrollHeight ?? 0;
      setMessages(prev => [...lote, ...prev]);
    }
    setCarregandoAntigas(false);
  }, [selectedPhone, carregandoAntigas]);

  useEffect(() => {
    loadLeads(true);

    // A lista de conversas escuta o Realtime para reordenar no instante em que
    // a mensagem chega. Sem isso a conversa nova só aparecia no próximo poll,
    // ou seja, com até 10 segundos de atraso.
    let agendado: ReturnType<typeof setTimeout> | null = null;
    // Uma mensagem recebida dispara dois eventos quase juntos (a mensagem e o
    // updated_at do lead). O debounce curto junta os dois numa recarga só.
    const recarregar = () => {
      if (agendado) return;
      agendado = setTimeout(() => { agendado = null; loadLeads(false); }, 300);
    };

    const canal = supabase
      .channel('leads:lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_leads' }, recarregar)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, recarregar)
      .subscribe(status => { realtimeLeadsOkRef.current = status === 'SUBSCRIBED'; });

    // Rede de segurança: se o Realtime cair, o poll volta a ser o único jeito
    // de a lista se atualizar, então ele nunca é removido, só desacelerado.
    let tick = 0;
    const poll = setInterval(() => {
      tick++;
      if (realtimeLeadsOkRef.current && tick % 6 !== 0) return;
      loadLeads(false);
    }, 10000);

    return () => {
      if (agendado) clearTimeout(agendado);
      clearInterval(poll);
      supabase.removeChannel(canal);
    };
  }, [loadLeads]);

  // Carrega a conversa e assina o Realtime ao selecionar um contato
  useEffect(() => {
    selectedPhoneRef.current = selectedPhone;
    if (!selectedPhone) { setMessages([]); return; }

    realtimeOkRef.current = false;
    setPresenca(null);
    setBuscaConversa('');
    setMostrarBuscaConversa(false);
    setAchadosConversa(null);
    loadMessages(selectedPhone);
    marcarComoLida(selectedPhone);

    // Realtime: só acrescenta a mensagem nova, sem substituir a lista.
    const channel = supabase
      .channel(`messages:${selectedPhone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `phone=eq.${selectedPhone}`,
      }, (payload) => {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          return [...prev, payload.new as Message];
        });
        // Chegou com a conversa aberta, então já nasce lida.
        if (payload.new.direction === 'inbound') marcarComoLida(selectedPhone);
      })
      // Reação e edição mexem numa linha que já existe, sem criar mensagem
      // nova. Sem escutar UPDATE, a reação do cliente só apareceria depois de
      // recarregar a conversa, porque o poll só busca created_at mais recente.
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `phone=eq.${selectedPhone}`,
      }, (payload) => {
        setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...(payload.new as Message) } : m));
      })
      // "Digitando..." mora em outra tabela, porque é estado do contato e não
      // de mensagem nenhuma. Só faz sentido por Realtime: quando aparecesse no
      // poll de 3 em 3 segundos já teria passado.
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_presenca',
        filter: `phone=eq.${selectedPhone}`,
      }, (payload) => {
        const estado = (payload.new as { estado?: string } | null)?.estado ?? null;
        if (presencaTimeoutRef.current) clearTimeout(presencaTimeoutRef.current);
        if (estado === 'composing' || estado === 'recording') {
          setPresenca(estado);
          // Expira sozinho: a Z-API nem sempre manda o aviso de que parou.
          presencaTimeoutRef.current = setTimeout(() => setPresenca(null), 12000);
        } else {
          setPresenca(null);
        }
      })
      .subscribe((status) => {
        // Se o canal conectou, o poll de segurança fica quase parado.
        realtimeOkRef.current = status === 'SUBSCRIBED';
      });

    return () => {
      realtimeOkRef.current = false;
      if (presencaTimeoutRef.current) clearTimeout(presencaTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [selectedPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Rola para o fim quando chega mensagem nova. Quando o lote veio de
  // "carregar anteriores", devolve o scroll ao ponto onde a pessoa estava.
  useLayoutEffect(() => {
    const el = listaRef.current;
    // A busca trocou a janela de mensagens: rola até a que ela achou, em vez
    // de cair no fim, senão o resultado do clique nunca fica visível.
    if (pularParaIdRef.current) {
      const alvo = document.getElementById(`msg-${pularParaIdRef.current}`);
      pularParaIdRef.current = null;
      if (alvo) {
        alvo.scrollIntoView({ block: 'center', behavior: 'instant' });
        setLongeDoFim(true);
        return;
      }
    }
    if (el && alturaAntesRef.current !== null) {
      el.scrollTop = el.scrollHeight - alturaAntesRef.current;
      alturaAntesRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    setLongeDoFim(false);
  }, [messages]);

  /** Só mostra o botão quando faltam mais de 300px para o fim, para ele não
   *  ficar piscando a cada rolagem pequena. */
  const aoRolar = useCallback(() => {
    const el = listaRef.current;
    if (!el) return;
    setLongeDoFim(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
  }, []);

  const irParaOFim = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setLongeDoFim(false);
  }, []);

  // Record when conversation was opened
  useEffect(() => {
    if (selectedPhone) convOpenedAtRef.current = new Date().toISOString();
  }, [selectedPhone]);

  // Rede de segurança: se o Realtime estiver de pé, consulta só a cada 15s.
  // Se cair, volta a consultar de 3 em 3 segundos.
  useEffect(() => {
    if (!selectedPhone) return;
    let tick = 0;
    const poll = setInterval(async () => {
      tick++;
      if (realtimeOkRef.current && tick % 5 !== 0) return;
      const prev = messagesRef.current;
      const ultimaReal = [...prev].reverse().find(m => !m.pendente);
      const since = ultimaReal ? ultimaReal.created_at : convOpenedAtRef.current;
      if (!since) return;
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('phone', selectedPhone)
        .gt('created_at', since)
        .order('created_at', { ascending: true });
      if (data && data.length > 0) {
        const existingIds = new Set(prev.map(m => m.id));
        const fresh = data.filter((m: Message) => !existingIds.has(m.id));
        if (fresh.length > 0) setMessages(p => [...p, ...fresh]);
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [selectedPhone]);

  // Busca dentro do texto das mensagens, com debounce.
  // Só a partir de 3 letras: com 1 ou 2 a varredura devolve quase tudo e
  // custa caro sem ajudar a achar nada.
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    const termo = search.trim();
    if (termo.length < 3) { setMatchingPhones(null); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('phone')
        .ilike('message', `%${termo}%`)
        .limit(500);
      if (data) setMatchingPhones(new Set(data.map((r: any) => r.phone)));
    }, 350);
  }, [search]);

  // Busca dentro da conversa aberta. Mesma regra das 3 letras da busca lateral.
  useEffect(() => {
    if (buscaConversaTimeoutRef.current) clearTimeout(buscaConversaTimeoutRef.current);
    const termo = buscaConversa.trim();
    if (!selectedPhone || termo.length < 3) { setAchadosConversa(null); setBuscandoConversa(false); return; }
    setBuscandoConversa(true);
    buscaConversaTimeoutRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('phone', selectedPhone)
        .ilike('message', `%${termo}%`)
        .order('created_at', { ascending: false })
        .limit(30);
      setAchadosConversa((data ?? []) as Message[]);
      setBuscandoConversa(false);
    }, 350);
  }, [buscaConversa, selectedPhone]);

  /** Traz a mensagem achada e o que estava em volta dela. Não dá para só rolar
   *  até lá: a conversa carrega por página, e a mensagem antiga costuma não
   *  estar na tela ainda. */
  const pularParaMensagem = useCallback(async (alvo: Message) => {
    if (!selectedPhone) return;
    setBuscandoConversa(true);
    const [antes, depois] = await Promise.all([
      supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('phone', selectedPhone)
        .lte('created_at', alvo.created_at)
        .order('created_at', { ascending: false })
        .limit(26),
      supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('phone', selectedPhone)
        .gt('created_at', alvo.created_at)
        .order('created_at', { ascending: true })
        .limit(25),
    ]);
    const anteriores = ((antes.data ?? []) as Message[]).reverse();
    const janela = [...anteriores, ...((depois.data ?? []) as Message[])];
    // Sobrou lote no topo? Então o botão de carregar anteriores continua valendo.
    setTemMaisAntigas(anteriores.length >= 26);
    pularParaIdRef.current = alvo.id;
    setMessages(janela);
    setDestacadoId(alvo.id);
    setBuscandoConversa(false);
    setMostrarBuscaConversa(false);
    setBuscaConversa('');
    setAchadosConversa(null);
    setTimeout(() => setDestacadoId(id => (id === alvo.id ? null : id)), 2500);
  }, [selectedPhone]);

  const updateStatus = async (phone: string, status: string) => {
    await supabase
      .from('whatsapp_leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('phone', phone);
    setLeads(prev => prev.map(l => l.phone === phone ? { ...l, status } : l));
  };

  const sendMessage = () => {
    if ((!newMessage.trim() && !pendingFiles.length) || !selectedPhone) return;
    // Anexo continua um de cada vez (o upload é pesado); texto pode emendar.
    if (pendingFiles.length && sending) return;

    const phone = selectedPhone;
    const msgText = newMessage.trim();
    const files = [...pendingFiles];
    // Guarda a citação antes de limpar a tarja, senão o envio assíncrono já
    // encontra o estado zerado e a resposta sai solta.
    const citada = respondendo;
    setNewMessage('');
    setPendingFiles([]);
    setRespondendo(null);
    // Só o envio com anexo trava o botão. Texto pode ser mandado em sequência,
    // porque cada mensagem já aparece na hora com a própria bolha.
    if (files.length) setSending(true);

    // Bolha otimista: aparece na hora, como no WhatsApp Web. Só depois
    // trocamos pelo registro que voltou do banco. Antes a bolha só surgia
    // depois da sessão + Edge Function + insert, e dava a sensação de travado.
    const idTemp = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (!files.length && msgText) {
      setMessages(prev => [...prev, {
        id: idTemp,
        phone,
        name: selectedLead?.name ?? phone,
        message: msgText,
        direction: 'outbound',
        created_at: new Date().toISOString(),
        responde_a: citada?.zapi_id ?? null,
        responde_a_texto: citada?.message ?? null,
        responde_a_de: citada?.direction ?? null,
        pendente: true,
      }]);
    }

    void enviar(phone, msgText, files, idTemp, citada);
  };

  /** Sobe o arquivo enviado para o bucket whatsapp-midia e devolve o endereço
   *  público. Se der erro, devolve null: a mensagem vai do mesmo jeito, só
   *  fica sem a prévia. */
  const subirMidia = async (pf: { name: string; type: string; base64: string }) => {
    try {
      // O leitor entrega data URL ("data:image/png;base64,..."), o atob quer só
      // o miolo. Aceita as duas formas para não depender de quem chamou.
      const puro = pf.base64.includes(',') ? pf.base64.split(',')[1] : pf.base64;
      const bin = atob(puro);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = pf.name.includes('.') ? pf.name.split('.').pop() : 'bin';
      const caminho = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('whatsapp-midia')
        .upload(caminho, bytes, { contentType: pf.type || 'application/octet-stream' });
      if (error) return null;
      const { data } = supabase.storage.from('whatsapp-midia').getPublicUrl(caminho);
      const tipo = pf.type.startsWith('image/') ? 'image'
        : pf.type.startsWith('video/') ? 'video'
        : pf.type.startsWith('audio/') ? 'audio'
        : 'document';
      return { url: data.publicUrl, tipo };
    } catch {
      return null;
    }
  };

  const enviar = async (
    selectedPhone: string,
    msgText: string,
    files: { name: string; type: string; base64: string }[],
    idTemp: string,
    citada?: Message | null,
  ) => {
    // Colunas da citação, iguais no envio para a Z-API e no insert do banco.
    const citacao = citada?.zapi_id
      ? { responde_a: citada.zapi_id, responde_a_texto: citada.message, responde_a_de: citada.direction }
      : {};
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || supabaseKey}`,
        'apikey': supabaseKey,
      };

      // Send files sequentially
      for (const pf of files) {
        const caption = files.indexOf(pf) === files.length - 1 ? msgText : '';
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST', headers,
          body: JSON.stringify({ phone: selectedPhone, file: pf.base64, fileName: pf.name, fileType: pf.type, message: caption }),
        });
        const resData = await res.json();
        const isAudio = pf.type.startsWith('audio/');
        // Áudio gravado no hub tem nome gerado (audio-1712...webm), que não
        // diz nada. Fica só "[Áudio]", igual ao que o webhook grava no recebido.
        const dbMsg = isAudio ? '[Áudio]' : pf.type.startsWith('image/') ? `[Imagem: ${pf.name}]` : `[Arquivo: ${pf.name}]`;
        // Guarda uma cópia no bucket para a bolha mostrar o arquivo depois.
        // Antes o base64 ia para a Z-API e não sobrava nada na conversa.
        const midia = await subirMidia(pf);
        const { data: inserted } = await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone, name: selectedLead?.name ?? selectedPhone,
          message: caption ? `${dbMsg} - ${caption}` : dbMsg, direction: 'outbound', status: 'sent',
          zapi_id: resData?.zapiId ?? null,
          media_url: midia?.url ?? null,
          media_type: midia?.tipo ?? null,
          media_name: pf.name,
        }).select().single();
        // Realtime will pick it up automatically, but add locally if needed
        if (inserted) setMessages(prev => prev.some(m => m.id === inserted.id) ? prev : [...prev, inserted as Message]);
      }

      // Send text-only if no files
      if (!files.length && msgText) {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST', headers,
          // replyTo faz a Z-API entregar a mensagem como resposta citada.
          body: JSON.stringify({ phone: selectedPhone, message: msgText, replyTo: citada?.zapi_id ?? undefined }),
        });
        const resData = await res.json();
        const { data: inserted } = await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone, name: selectedLead?.name ?? selectedPhone,
          message: msgText, direction: 'outbound', status: 'sent',
          zapi_id: resData?.zapiId ?? null,
          ...citacao,
        }).select().single();
        if (inserted) {
          // Troca a bolha otimista pelo registro real, sem duplicar caso o
          // Realtime já tenha entregado a mesma mensagem antes de nós.
          setMessages(prev => {
            const semTemp = prev.filter(m => m.id !== idTemp);
            return semTemp.some(m => m.id === inserted.id)
              ? semTemp
              : [...semTemp, inserted as Message];
          });
        } else {
          setMessages(prev => prev.map(m => m.id === idTemp ? { ...m, pendente: false } : m));
        }
      }

      // Silence the bot
      await supabase.from('whatsapp_leads').update({ status: 'em atendimento', updated_at: new Date().toISOString() }).eq('phone', selectedPhone);
      setLeads(prev => prev.map(l => l.phone === selectedPhone ? { ...l, status: 'em atendimento' } : l));
    } catch (e) {
      console.error('Erro ao enviar:', e);
      // A bolha fica na tela marcada como falha, para não perder o texto.
      setMessages(prev => prev.map(m => m.id === idTemp ? { ...m, pendente: false, falhou: true } : m));
    } finally {
      setSending(false);
    }
  };

  const openCrmModal = (lead: Lead) => {
    setCrmModalLead(lead);
    setCrmProductType('Seguro Garantia');
    setCrmSuccess(false);
  };

  const saveToCrm = async () => {
    if (!crmModalLead || crmSaving) return;
    setCrmSaving(true);
    try {
      const { error } = await supabase.from('prospects').insert([{
        name: crmModalLead.name,
        company: crmModalLead.name,
        phonenumber: crmModalLead.phone,
        status: 'Novos Leads',
        source: 'WhatsApp',
        product_type: crmProductType,
      }]);
      if (error) throw error;
      setCrmSuccess(true);
      setTimeout(() => setCrmModalLead(null), 1500);
    } catch (err) {
      console.error('Erro ao salvar no CRM:', err);
      alert('Erro ao salvar no CRM. Tente novamente.');
    } finally {
      setCrmSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    // O `?? []` deixava o TypeScript inferir unknown[] em vez de File[].
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;
    const oversized = files.filter(f => f.size > 10 * 1024 * 1024);
    if (oversized.length) { alert(`Arquivo(s) muito grande(s): ${oversized.map(f => f.name).join(', ')}. Máximo 10 MB cada.`); return; }
    const readers = files.map(file => new Promise<{ name: string; type: string; base64: string }>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, base64: reader.result as string });
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(results => setPendingFiles(prev => [...prev, ...results]));
    e.target.value = '';
  };

  const getSupabaseHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const supabaseKey = (supabase as any).supabaseKey as string;
    return { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token || supabaseKey}`, 'apikey': supabaseKey }, supabaseUrl };
  };

  const deleteConversation = async (phone: string) => {
    await supabase.from('whatsapp_messages').delete().eq('phone', phone);
    await supabase.from('whatsapp_leads').delete().eq('phone', phone);
    setLeads(prev => prev.filter(l => l.phone !== phone));
    if (selectedPhone === phone) { setSelectedPhone(null); setMessages([]); }
    setDeletingConv(null);
  };

  const saveEditedMessage = async () => {
    if (!editingMsg || !editingMsg.text.trim()) return;
    const { headers, supabaseUrl } = await getSupabaseHeaders();
    // Update in DB
    await supabase.from('whatsapp_messages').update({ message: editingMsg.text }).eq('id', editingMsg.id);
    // Try Z-API edit if we have the message ID
    if (editingMsg.zapi_id && selectedPhone) {
      await fetch(`${supabaseUrl}/functions/v1/whatsapp-message-actions`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'edit', phone: selectedPhone, zapiId: editingMsg.zapi_id, newMessage: editingMsg.text }),
      });
    }
    setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, message: editingMsg.text } : m));
    setEditingMsg(null);
  };

  const deleteMessage = async (msg: Message) => {
    const { headers, supabaseUrl } = await getSupabaseHeaders();
    await supabase.from('whatsapp_messages').delete().eq('id', msg.id);
    if (msg.zapi_id && selectedPhone) {
      await fetch(`${supabaseUrl}/functions/v1/whatsapp-message-actions`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'delete', phone: selectedPhone, zapiId: msg.zapi_id }),
      });
    }
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    setDeletingMsgId(null);
  };

  /** Reage com emoji. Tocar de novo no mesmo emoji tira a reação, igual ao
   *  WhatsApp. A bolha muda na hora e só depois a Z-API confirma. */
  const reagir = async (msg: Message, emoji: string) => {
    setReagindoId(null);
    if (!selectedPhone || !msg.zapi_id) return;
    const novo = msg.reacao_nossa === emoji ? null : emoji;

    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reacao_nossa: novo } : m));
    await supabase.from('whatsapp_messages').update({ reacao_nossa: novo }).eq('id', msg.id);

    const { headers, supabaseUrl } = await getSupabaseHeaders();
    await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: 'POST', headers,
      // Emoji vazio cai no endpoint de remover reação lá na Edge Function.
      body: JSON.stringify({ phone: selectedPhone, reactionMessageId: msg.zapi_id, reaction: novo ?? '' }),
    });
  };

  /** Formatos que o MediaRecorder pode aceitar, em ordem de preferência. O
   *  WhatsApp nasceu com ogg/opus, mas o Chrome só grava webm/opus. A Edge
   *  Function tenta o endpoint de voz primeiro e cai no de áudio comum se a
   *  Z-API recusar o contêiner. */
  const FORMATOS_AUDIO = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

  /** Extensão que combina com o contêiner gravado. O nome do arquivo é o que
   *  o subirMidia usa para montar o caminho no bucket. */
  const extensaoDoMime = (mime: string) =>
    mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';

  const encerrarGravacao = () => {
    if (cronometroRef.current) { clearInterval(cronometroRef.current); cronometroRef.current = null; }
    gravadorRef.current?.stream.getTracks().forEach(t => t.stop());
    gravadorRef.current = null;
    pedacosRef.current = [];
    setGravando(false);
    setSegundosGravacao(0);
  };

  const iniciarGravacao = async () => {
    if (!selectedPhone || gravando) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = FORMATOS_AUDIO.find(f => MediaRecorder.isTypeSupported(f)) ?? '';
      const gravador = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      pedacosRef.current = [];
      descartarAudioRef.current = false;

      gravador.ondataavailable = e => { if (e.data.size) pedacosRef.current.push(e.data); };
      gravador.onstop = () => {
        const pedacos = pedacosRef.current;
        const descartar = descartarAudioRef.current;
        const tipo = gravador.mimeType || mime || 'audio/webm';
        encerrarGravacao();
        if (descartar) return;
        const blob = new Blob(pedacos, { type: tipo });
        // Toque sem querer no botão gera um arquivo minúsculo e inaudível.
        if (blob.size < 1200) return;
        void enviarAudio(blob, tipo, selectedPhone);
      };

      gravador.start();
      gravadorRef.current = gravador;
      setGravando(true);
      setSegundosGravacao(0);
      cronometroRef.current = window.setInterval(() => setSegundosGravacao(s => s + 1), 1000);
    } catch (e) {
      console.error('Erro ao acessar o microfone:', e);
      alert('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
    }
  };

  const pararGravacao = () => {
    if (!gravadorRef.current) return;
    descartarAudioRef.current = false;
    gravadorRef.current.stop();
  };

  const cancelarGravacao = () => {
    if (!gravadorRef.current) return;
    // Precisa marcar antes do stop porque o onstop é o mesmo nos dois caminhos.
    descartarAudioRef.current = true;
    gravadorRef.current.stop();
  };

  /** Manda o áudio gravado pelo mesmo caminho dos anexos. Vai direto ao
   *  enviar() em vez de passar pelo pendingFiles, que é estado assíncrono e
   *  chegaria vazio no clique seguinte. */
  const enviarAudio = async (blob: Blob, tipo: string, phone: string) => {
    const base64 = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    const arquivo = {
      name: `audio-${Date.now()}.${extensaoDoMime(tipo)}`,
      type: tipo,
      base64,
    };
    setSending(true);
    await enviar(phone, '', [arquivo], `temp-${Date.now()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /** Insere o emoji na posição do cursor, e não no fim do texto, para dar
   *  para escrever "bom dia 😀 tudo bem" sem ter que reposicionar na mão. */
  const inserirEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setNewMessage(prev => prev + emoji);
      return;
    }
    const ini = el.selectionStart ?? newMessage.length;
    const fim = el.selectionEnd ?? newMessage.length;
    const texto = newMessage.slice(0, ini) + emoji + newMessage.slice(fim);
    setNewMessage(texto);
    // O cursor precisa voltar depois do render, senão o React o joga pro fim.
    requestAnimationFrame(() => {
      el.focus();
      const pos = ini + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Fecha o seletor de emoji ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!mostrarEmojis) return;
    const clique = (e: MouseEvent) => {
      const alvo = e.target as Node;
      // O próprio botão fica de fora, senão ele fecharia e reabriria no clique.
      if (emojiBoxRef.current?.contains(alvo) || emojiBtnRef.current?.contains(alvo)) return;
      setMostrarEmojis(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMostrarEmojis(false);
    };

    document.addEventListener('mousedown', clique);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', clique);
      document.removeEventListener('keydown', tecla);
    };
  }, [mostrarEmojis]);

  // Fecha a barrinha de reação ao clicar em qualquer outro lugar ou no Esc.
  // O clique no próprio emoji já é tratado antes, dentro de reagir().
  useEffect(() => {
    if (!reagindoId) return;
    const fechar = () => setReagindoId(null);
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setReagindoId(null); };
    // Em captura e no clique (não no mousedown) para o onClick do emoji rodar primeiro.
    document.addEventListener('click', fechar);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('click', fechar);
      document.removeEventListener('keydown', tecla);
    };
  }, [reagindoId]);

  // Esc cancela a resposta citada.
  useEffect(() => {
    if (!respondendo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setRespondendo(null); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [respondendo]);

  // Esc descarta a gravação. Sair da conversa ou da tela também descarta, para
  // o microfone não continuar aberto depois que a pessoa foi para outro lugar.
  useEffect(() => {
    if (!gravando) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelarGravacao(); };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      if (gravadorRef.current) { descartarAudioRef.current = true; gravadorRef.current.stop(); }
    };
  }, [gravando, selectedPhone]);

  // Esc fecha a imagem em tela cheia.
  useEffect(() => {
    if (!midiaAberta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setMidiaAberta(null); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [midiaAberta]);

  return (
    <>
    <div
      className="flex rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white"
      style={{ height: 'calc(100vh - 160px)', minHeight: '500px' }}
    >
      {/* ── Left panel: contacts — oculto no mobile quando chat está aberto ── */}
      <div className={`w-80 flex-shrink-0 border-r border-white/10 flex flex-col bg-navy ${selectedPhone ? 'hidden lg:flex' : 'flex w-full lg:w-80'}`}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={15} className="text-gold" />
            <span className="font-bold text-white text-sm">Inbox WhatsApp</span>
          </div>
          <button onClick={() => loadLeads(true)} className="text-slate-400 hover:text-gold transition-colors" title="Atualizar">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 bg-white/8 rounded-xl px-3 py-2 border border-white/10 focus-within:border-gold/40">
            <Search size={13} className="text-slate-500 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar contato..."
              className="flex-1 bg-transparent text-white text-xs placeholder-slate-500 focus:outline-none"
            />
            {search && <button onClick={() => setSearch('')} className="text-slate-500 hover:text-white transition-colors"><X size={11} /></button>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="text-gold animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-14 px-6">
              <MessageSquare size={28} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 text-xs font-bold">Nenhum contato ainda</p>
              <p className="text-slate-600 text-[11px] mt-1">As mensagens recebidas aparecerão aqui</p>
            </div>
          ) : (
            leads.filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.phone.includes(search) || matchingPhones?.has(l.phone)).map(lead => (
              <div
                key={lead.phone}
                className={`border-b border-white/5 transition-all ${
                  selectedPhone === lead.phone
                    ? 'bg-gold/15 border-l-2 border-l-gold'
                    : 'hover:bg-white/5 border-l-2 border-l-transparent'
                }`}
              >
                <button
                  onClick={() => setSelectedPhone(lead.phone)}
                  className="w-full px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                        <User size={15} className="text-slate-400" />
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-navy ${STATUS_COLORS[lead.status] ?? 'bg-slate-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs truncate ${naoLidas[lead.phone] ? 'text-white font-extrabold' : 'text-white font-bold'}`}>{lead.name}</span>
                        <span className={`text-[10px] shrink-0 ${naoLidas[lead.phone] ? 'text-whatsapp font-bold' : 'text-slate-500'}`}>{formatTime(lead.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <span className="text-slate-500 text-[10px] truncate">{lead.phone}</span>
                        {naoLidas[lead.phone] > 0 && (
                          <span className="shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-whatsapp text-navy text-[10px] font-extrabold flex items-center justify-center">
                            {naoLidas[lead.phone] > 99 ? '99+' : naoLidas[lead.phone]}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-xl shrink-0 ${
                          lead.status === 'novo' ? 'bg-emerald-500/20 text-emerald-400' :
                          lead.status === 'em atendimento' ? 'bg-blue-500/20 text-blue-400' :
                          lead.status === 'cotação enviada' ? 'bg-amber-500/20 text-amber-400' :
                          lead.status === 'seguro de proposta' ? 'bg-gold/20 text-gold-hover' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>{STATUS_LABELS[lead.status] ?? lead.status}</span>
                      </div>
                    </div>
                  </div>
                </button>
                <div className="px-4 pb-2.5 flex gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openCrmModal(lead); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-gold/15 hover:bg-gold/30 text-gold text-[10px] font-bold transition-colors"
                    title="Adicionar ao CRM"
                  >
                    <Plus size={11} /> Adicionar ao CRM
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingConv(lead.phone); }}
                    className="px-2 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 transition-colors"
                    title="Excluir conversa"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: conversation ─────────────────────────── */}
      {/* Painel direito — full width no mobile quando chat aberto */}
      <div className={`flex-1 flex flex-col min-w-0 bg-areia-clara ${selectedPhone ? 'flex' : 'hidden lg:flex'}`}>
        {!selectedPhone ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
              <MessageSquare size={26} className="text-slate-300" />
            </div>
            <p className="font-bold text-slate-400 text-sm">Selecione um contato</p>
            <p className="text-slate-300 text-xs mt-1">para ver a conversa e enviar mensagens</p>
          </div>
        ) : (
          <>
            {/* Contact header — botão ← voltar só no mobile */}
            <div className="px-4 lg:px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                {/* Botão voltar — só aparece em telas pequenas */}
                <button
                  onClick={() => setSelectedPhone(null)}
                  className="lg:hidden p-2 -ml-1 text-slate-500 hover:text-navy hover:bg-slate-100 rounded-xl transition-all"
                  title="Voltar à lista"
                >
                  <ChevronRight size={18} className="rotate-180" />
                </button>
                <div className="w-9 h-9 rounded-full bg-navy flex items-center justify-center shrink-0">
                  <User size={14} className="text-gold" />
                </div>
                <div>
                  <p className="font-bold text-slate-800 text-sm leading-none">{selectedLead?.name}</p>
                  {presenca ? (
                    <p className="text-whatsapp text-xs font-bold mt-0.5 animate-in fade-in duration-200">
                      {presenca === 'recording' ? 'gravando áudio...' : 'digitando...'}
                    </p>
                  ) : (
                    <p className="text-slate-400 text-xs mt-0.5">{selectedPhone}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Busca dentro da conversa */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setMostrarBuscaConversa(v => !v);
                      if (mostrarBuscaConversa) { setBuscaConversa(''); setAchadosConversa(null); }
                    }}
                    className={`p-2 rounded-xl transition-all ${mostrarBuscaConversa ? 'bg-navy text-gold' : 'text-slate-500 hover:text-navy hover:bg-slate-100'}`}
                    title="Buscar nesta conversa"
                  >
                    <Search size={15} />
                  </button>
                  {mostrarBuscaConversa && (
                    <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="p-2 border-b border-slate-100 flex items-center gap-2">
                        <Search size={13} className="text-slate-400 shrink-0 ml-1" />
                        <input
                          autoFocus
                          value={buscaConversa}
                          onChange={e => setBuscaConversa(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') { setMostrarBuscaConversa(false); setBuscaConversa(''); setAchadosConversa(null); } }}
                          placeholder="Buscar nesta conversa..."
                          className="flex-1 text-xs py-1.5 focus:outline-none placeholder-slate-400"
                        />
                        {buscandoConversa && <Loader2 size={13} className="text-gold animate-spin shrink-0 mr-1" />}
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {buscaConversa.trim().length > 0 && buscaConversa.trim().length < 3 ? (
                          <p className="text-[11px] text-slate-400 text-center py-4">Digite ao menos 3 letras</p>
                        ) : achadosConversa && achadosConversa.length === 0 ? (
                          <p className="text-[11px] text-slate-400 text-center py-4">Nada encontrado</p>
                        ) : (
                          (achadosConversa ?? []).map(a => (
                            <button
                              key={a.id}
                              onClick={() => pularParaMensagem(a)}
                              className="w-full text-left px-3 py-2 hover:bg-areia-clara border-b border-slate-50 last:border-0 transition-colors"
                            >
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                                {a.direction === 'outbound' ? 'Você' : (selectedLead?.name ?? 'Cliente')} · {new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} {new Date(a.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <p className="text-xs text-slate-700 line-clamp-2 mt-0.5">{a.message}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <select
                  value={selectedLead?.status ?? 'novo'}
                  onChange={e => updateStatus(selectedPhone, e.target.value)}
                  className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-gold/50 cursor-pointer"
                >
                  {Object.entries(STATUS_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Client info card */}
            <WhatsAppClientCard phone={selectedLead?.phone ?? ''} leadName={selectedLead?.name ?? ''} />

            {/* Messages area */}
            <div className="flex-1 relative min-h-0">
            <div ref={listaRef} onScroll={aoRolar} className="absolute inset-0 overflow-y-auto px-5 py-4 space-y-2.5">
              {!loadingMessages && temMaisAntigas && (
                <div className="flex justify-center pb-2">
                  <button
                    onClick={carregarAntigas}
                    disabled={carregandoAntigas}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-navy bg-white border border-slate-200 rounded-xl px-3 py-1.5 transition-colors disabled:opacity-50"
                  >
                    {carregandoAntigas && <Loader2 size={11} className="animate-spin" />}
                    {carregandoAntigas ? 'Carregando...' : 'Carregar mensagens anteriores'}
                  </button>
                </div>
              )}
              {loadingMessages ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={18} className="text-gold animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-slate-400 text-xs font-bold">Nenhuma mensagem ainda</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <React.Fragment key={msg.id}>
                  {/* Separador de dia, igual ao do WhatsApp */}
                  {(i === 0 || new Date(messages[i - 1].created_at).toDateString() !== new Date(msg.created_at).toDateString()) && (
                    <div className="flex justify-center py-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-1 shadow-sm">
                        {rotuloDoDia(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <div id={`msg-${msg.id}`} className={`flex group items-center ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    {/* Ações da mensagem. Ficam antes da bolha nas enviadas e
                        depois nas recebidas, para nunca cobrirem o texto. */}
                    {msg.direction === 'outbound' && !msg.pendente && !msg.falhou && editingMsg?.id !== msg.id && (
                      <div className="flex items-center gap-1 mr-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <div className="relative">
                          <button onClick={() => setReagindoId(reagindoId === msg.id ? null : msg.id)} className="p-1 rounded-xl text-slate-400 hover:text-gold-dark hover:bg-slate-100 transition-colors" title="Reagir">
                            <Smile size={12} />
                          </button>
                          {reagindoId === msg.id && (
                            <div className="absolute bottom-full right-0 mb-1 z-20 flex gap-0.5 bg-white border border-slate-200 rounded-2xl shadow-xl px-1.5 py-1 animate-in fade-in zoom-in-95 duration-150">
                              {REACOES_RAPIDAS.map(e => (
                                <button key={e} onClick={() => reagir(msg, e)} className={`w-7 h-7 rounded-full text-base leading-none hover:bg-slate-100 transition-colors ${msg.reacao_nossa === e ? 'bg-gold/20' : ''}`}>{e}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button onClick={() => { setRespondendo(msg); textareaRef.current?.focus(); }} className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Responder">
                          <Reply size={12} />
                        </button>
                        <button onClick={() => setEditingMsg({ id: msg.id, zapi_id: msg.zapi_id, text: msg.message })} className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Editar">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => setDeletingMsgId(msg.id)} className="p-1 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors" title="Excluir">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    <div className={`flex flex-col max-w-[72%] ${msg.direction === 'inbound' ? 'items-start' : 'items-end'}`}>
                    <div className={`rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.direction === 'inbound'
                        ? 'bg-white text-slate-800 rounded-bl-md'
                        : 'bg-navy text-white rounded-br-md'
                    } ${msg.pendente ? 'opacity-60' : ''} ${msg.falhou ? 'ring-1 ring-rose-400' : ''} ${destacadoId === msg.id ? 'ring-2 ring-gold' : ''}`}>
                      {/* Tarja da citação, dentro da bolha como no WhatsApp */}
                      {msg.responde_a && editingMsg?.id !== msg.id && deletingMsgId !== msg.id && (
                        <div className={`mx-1.5 mt-1.5 mb-0.5 px-2.5 py-1.5 rounded-xl border-l-[3px] ${
                          msg.direction === 'inbound'
                            ? 'bg-areia border-gold-dark'
                            : 'bg-white/10 border-gold'
                        }`}>
                          <p className={`text-[10px] font-bold ${msg.direction === 'inbound' ? 'text-gold-dark' : 'text-gold'}`}>
                            {msg.responde_a_de === 'outbound' ? 'Você' : (selectedLead?.name ?? 'Cliente')}
                          </p>
                          <p className={`text-[11px] truncate ${msg.direction === 'inbound' ? 'text-slate-500' : 'text-white/60'}`}>
                            {msg.responde_a_texto ?? 'Mensagem'}
                          </p>
                        </div>
                      )}
                      {editingMsg?.id === msg.id ? (
                        /* Inline edit */
                        <div className="p-2 space-y-2 min-w-[200px]">
                          <textarea
                            autoFocus
                            value={editingMsg.text}
                            onChange={e => setEditingMsg(em => em ? { ...em, text: e.target.value } : em)}
                            rows={3}
                            className="w-full bg-white/10 text-white text-sm p-2 rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-white/30 placeholder-white/40"
                          />
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingMsg(null)} className="text-white/50 hover:text-white text-xs px-2 py-1 transition-colors">Cancelar</button>
                            <button onClick={saveEditedMessage} className="bg-gold text-white text-xs px-3 py-1 rounded-xl font-bold hover:bg-gold-hover transition-colors">Salvar</button>
                          </div>
                        </div>
                      ) : deletingMsgId === msg.id ? (
                        /* Delete confirm */
                        <div className="px-4 py-3 space-y-2">
                          <p className="text-xs text-white/70">Excluir para todos?</p>
                          <div className="flex gap-2">
                            <button onClick={() => setDeletingMsgId(null)} className="text-white/50 hover:text-white text-xs transition-colors">Não</button>
                            <button onClick={() => deleteMessage(msg)} className="text-rose-400 hover:text-rose-300 text-xs font-bold transition-colors">Excluir</button>
                          </div>
                        </div>
                      ) : (msg.audio_url || msg.media_type === 'audio') ? (
                        /* Audio player */
                        <div className="px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <Volume2 size={13} className={msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/60'} />
                            <span className="text-[11px] font-bold opacity-60">Áudio</span>
                          </div>
                          <audio controls src={msg.audio_url ?? msg.media_url ?? undefined} className="max-w-[220px]" style={{ height: '32px' }} />
                          <p className={`text-[10px] mt-1 text-right ${msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/40'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            <Visto msg={msg} />
                          </p>
                        </div>
                      ) : msg.media_url ? (
                        /* Imagem, vídeo, figurinha ou documento */
                        <div className="p-1.5">
                          {msg.media_type === 'image' || msg.media_type === 'sticker' ? (
                            <img
                              src={msg.media_url}
                              alt={msg.media_name ?? 'imagem'}
                              loading="lazy"
                              onClick={() => setMidiaAberta({ url: msg.media_url!, tipo: msg.media_type! })}
                              className="rounded-xl max-w-[260px] max-h-[300px] object-cover cursor-zoom-in block"
                            />
                          ) : msg.media_type === 'video' ? (
                            <video
                              src={msg.media_url}
                              controls
                              preload="metadata"
                              className="rounded-xl max-w-[260px] max-h-[300px] block"
                            />
                          ) : (
                            <a
                              href={msg.media_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl max-w-[240px] transition-colors ${
                                msg.direction === 'inbound' ? 'bg-areia hover:bg-areia-escura' : 'bg-white/10 hover:bg-white/20'
                              }`}
                            >
                              <FileText size={18} className={msg.direction === 'inbound' ? 'text-gold-dark shrink-0' : 'text-gold shrink-0'} />
                              <span className="text-xs font-bold truncate">{msg.media_name ?? 'Documento'}</span>
                            </a>
                          )}
                          {legendaDaMidia(msg) && (
                            <p className="px-2 pt-1.5" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {legendaDaMidia(msg)}
                            </p>
                          )}
                          <p className={`text-[10px] mt-0.5 px-2 pb-0.5 text-right ${msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/40'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            <Visto msg={msg} />
                          </p>
                        </div>
                      ) : (
                        /* Normal message */
                        <div className="px-4 py-2.5">
                          <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.message}</p>
                          <p className={`text-[10px] mt-1 text-right ${
                            msg.falhou ? 'text-rose-300 font-bold'
                            : msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/40'
                          }`}>
                            {msg.falhou
                              ? 'não enviada'
                              : msg.pendente
                                ? 'enviando...'
                                : new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            <Visto msg={msg} />
                          </p>
                        </div>
                      )}
                    </div>
                    {/* Chip das reações, encostado na base da bolha */}
                    {(msg.reacao_nossa || msg.reacao_deles) && (
                      <div className="-mt-1.5 mx-2 flex gap-0.5 bg-white border border-slate-200 rounded-full px-1.5 py-0.5 shadow-sm text-[11px] leading-none z-10">
                        {msg.reacao_deles && <span>{msg.reacao_deles}</span>}
                        {msg.reacao_nossa && (
                          <button onClick={() => reagir(msg, msg.reacao_nossa!)} title="Remover reação">{msg.reacao_nossa}</button>
                        )}
                      </div>
                    )}
                    </div>
                    {/* Recebidas: ações do outro lado da bolha */}
                    {msg.direction === 'inbound' && (
                      <div className="flex items-center gap-1 ml-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <div className="relative">
                          <button onClick={() => setReagindoId(reagindoId === msg.id ? null : msg.id)} className="p-1 rounded-xl text-slate-400 hover:text-gold-dark hover:bg-slate-100 transition-colors" title="Reagir">
                            <Smile size={12} />
                          </button>
                          {reagindoId === msg.id && (
                            <div className="absolute bottom-full left-0 mb-1 z-20 flex gap-0.5 bg-white border border-slate-200 rounded-2xl shadow-xl px-1.5 py-1 animate-in fade-in zoom-in-95 duration-150">
                              {REACOES_RAPIDAS.map(e => (
                                <button key={e} onClick={() => reagir(msg, e)} className={`w-7 h-7 rounded-full text-base leading-none hover:bg-slate-100 transition-colors ${msg.reacao_nossa === e ? 'bg-gold/20' : ''}`}>{e}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button onClick={() => { setRespondendo(msg); textareaRef.current?.focus(); }} className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Responder">
                          <Reply size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  </React.Fragment>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Voltar para a última mensagem */}
            {longeDoFim && (
              <button
                onClick={irParaOFim}
                title="Ir para a última mensagem"
                className="absolute bottom-4 right-5 w-9 h-9 rounded-full bg-white border border-slate-200 shadow-lg text-slate-500 hover:text-navy flex items-center justify-center transition-colors animate-in fade-in zoom-in-95 duration-150"
              >
                <ChevronDown size={18} />
              </button>
            )}
            </div>

            {/* Input area */}
            <div className="px-4 pb-4 pt-2 border-t border-slate-200 bg-white shrink-0">
              {/* Mensagem que está sendo respondida */}
              {respondendo && (
                <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-areia border-l-[3px] border-gold-dark rounded-xl animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-gold-dark">
                      {respondendo.direction === 'outbound' ? 'Você' : (selectedLead?.name ?? 'Cliente')}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{respondendo.message}</p>
                  </div>
                  <button onClick={() => setRespondendo(null)} className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors" title="Cancelar resposta">
                    <X size={13} />
                  </button>
                </div>
              )}
              {/* File preview strip */}
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pendingFiles.map((pf, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gold/10 border border-gold/30 rounded-xl max-w-[180px]">
                      {pf.type.startsWith('image/') ? (
                        <Image size={12} className="text-gold shrink-0" />
                      ) : (
                        <FileText size={12} className="text-gold shrink-0" />
                      )}
                      <span className="text-[11px] font-bold text-slate-700 truncate flex-1">{pf.name}</span>
                      <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="shrink-0 text-slate-400 hover:text-slate-600">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Seletor de emoji */}
              {mostrarEmojis && (
                <div
                  ref={emojiBoxRef}
                  className="mb-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
                >
                  <div className="flex border-b border-slate-100">
                    {EMOJIS.map((g, i) => (
                      <button
                        key={g.grupo}
                        type="button"
                        onClick={() => setGrupoEmoji(i)}
                        className={`flex-1 px-2 py-2 text-[11px] font-bold transition-colors ${
                          i === grupoEmoji
                            ? 'text-navy border-b-2 border-gold bg-areia-clara'
                            : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        {g.grupo}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-10 gap-0.5 p-2 max-h-44 overflow-y-auto">
                    {EMOJIS[grupoEmoji].lista.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => inserirEmoji(emoji)}
                        className="text-lg leading-none p-1 rounded-lg hover:bg-areia transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {gravando ? (
                /* Barra de gravação. Ocupa o lugar do campo de texto, como no
                   WhatsApp, para não dar para digitar e gravar ao mesmo tempo. */
                <div className="flex items-center gap-3 bg-slate-50 rounded-2xl border border-rose-200 px-3 py-2.5 animate-in fade-in duration-150">
                  <button
                    type="button"
                    onClick={cancelarGravacao}
                    className="shrink-0 text-slate-400 hover:text-rose-500 transition-colors"
                    title="Descartar gravação"
                  >
                    <Trash2 size={16} />
                  </button>
                  <span className="shrink-0 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <span className="text-sm font-bold text-slate-700 tabular-nums">
                    {String(Math.floor(segundosGravacao / 60)).padStart(2, '0')}:{String(segundosGravacao % 60).padStart(2, '0')}
                  </span>
                  <span className="flex-1 text-[11px] text-slate-400">Gravando... solte para enviar</span>
                  <button
                    type="button"
                    onClick={pararGravacao}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-navy text-gold hover:bg-navy-light transition-all"
                    title="Enviar áudio"
                  >
                    <Send size={14} />
                  </button>
                </div>
              ) : (
              <div className="flex items-end gap-2 bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2.5 focus-within:border-gold/50 focus-within:bg-white transition-all">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 text-slate-400 hover:text-gold transition-colors"
                  title="Anexar arquivo"
                >
                  <Paperclip size={16} />
                </button>
                <button
                  ref={emojiBtnRef}
                  type="button"
                  onClick={() => setMostrarEmojis(v => !v)}
                  className={`shrink-0 transition-colors ${mostrarEmojis ? 'text-gold' : 'text-slate-400 hover:text-gold'}`}
                  title="Emoji"
                >
                  <Smile size={16} />
                </button>
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={pendingFiles.length ? 'Legenda (opcional)...' : 'Escreva uma mensagem... (Enter para enviar)'}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
                  style={{ maxHeight: '100px' }}
                />
                {/* Campo vazio mostra o microfone; com texto ou anexo vira o
                    botão de enviar, igual ao WhatsApp. */}
                {(newMessage.trim() || pendingFiles.length) ? (
                  <button
                    onClick={sendMessage}
                    disabled={sending && !!pendingFiles.length}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-navy text-gold disabled:opacity-30 hover:bg-navy-light transition-all"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={iniciarGravacao}
                    disabled={sending}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-navy text-gold disabled:opacity-30 hover:bg-navy-light transition-all"
                    title="Gravar áudio"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
                  </button>
                )}
              </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>

    {/* ── Imagem em tela cheia ── */}

    {midiaAberta && (
      <div
        onClick={() => setMidiaAberta(null)}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/85 backdrop-blur-sm p-6 animate-in fade-in duration-150"
      >
        <img
          src={midiaAberta.url}
          alt="imagem"
          onClick={e => e.stopPropagation()}
          className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
        />
        <a
          href={midiaAberta.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-bold text-white/70 hover:text-white bg-white/10 px-3 py-1.5 rounded-xl transition-colors"
        >
          Abrir original
        </a>
        <button
          onClick={() => setMidiaAberta(null)}
          className="absolute top-5 right-5 text-white/70 hover:text-white transition-colors"
        >
          <X size={22} />
        </button>
      </div>
    )}

    {/* ── CRM Modal ── */}

    {crmModalLead && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-navy">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus size={16} className="text-gold" /> Adicionar ao CRM
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">{crmModalLead.name} · {crmModalLead.phone}</p>
            </div>
            <button onClick={() => setCrmModalLead(null)} className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {crmSuccess ? (
            <div className="p-10 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={40} className="text-emerald-500" />
              <p className="font-bold text-slate-800">Adicionado ao CRM!</p>
              <p className="text-xs text-slate-500">O lead foi criado em <strong>Novos Leads</strong>.</p>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dados do contato</p>
                <p className="text-sm font-bold text-slate-800">{crmModalLead.name}</p>
                <p className="text-xs text-slate-500">{crmModalLead.phone}</p>
                <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-xl w-fit">Origem: WhatsApp</p>
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                  <Tag size={13} className="text-gold" /> Foco do Atendimento
                </label>
                <select
                  value={crmProductType}
                  onChange={e => setCrmProductType(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-gold/20 focus:border-gold cursor-pointer"
                >
                  {PRODUCT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                </select>
              </div>

              <p className="text-[11px] text-slate-400 text-center">O lead será criado na coluna <strong>Novos Leads</strong>.</p>
            </div>
          )}

          {!crmSuccess && (
            <div className="px-6 pb-6 space-y-2.5">
              {onGoToSale && (
                <button
                  onClick={() => {
                    if (!crmModalLead) return;
                    setCrmModalLead(null);
                    onGoToSale({ nome: crmModalLead.name, telefone: crmModalLead.phone });
                  }}
                  className="w-full py-2.5 bg-gold hover:bg-gold-hover text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg"
                >
                  <FileText size={15} /> Ir para Registro de Venda
                </button>
              )}
              <div className="flex gap-3">
                <button onClick={() => setCrmModalLead(null)} className="flex-1 py-2.5 font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors text-sm">
                  Cancelar
                </button>
                <button
                  onClick={saveToCrm}
                  disabled={crmSaving}
                  className="flex-1 py-2.5 bg-navy hover:bg-navy-light text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                  {crmSaving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {crmSaving ? 'Salvando...' : 'Criar no CRM'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    {/* ── Delete conversation modal ── */}
    {deletingConv && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-7 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
            <Trash2 size={20} className="text-rose-500" />
          </div>
          <div>
            <p className="font-bold text-slate-800">Excluir conversa?</p>
            <p className="text-sm text-slate-500 mt-1">Todas as mensagens serão apagadas do hub. A conversa no WhatsApp não é afetada.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setDeletingConv(null)} className="flex-1 py-2.5 font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors text-sm">Cancelar</button>
            <button onClick={() => deleteConversation(deletingConv)} className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl transition-colors text-sm">Excluir</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
