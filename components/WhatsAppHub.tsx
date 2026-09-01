import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, RefreshCw, User, Loader2, Plus, X, CheckCircle2, Tag, FileText, Paperclip, Image, Trash2, Pencil, Mic, Volume2, AlertCircle, Search, ChevronRight } from 'lucide-react';
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
  /** Bolha otimista: já está na tela mas ainda não voltou do banco. */
  pendente?: boolean;
  /** O envio deu erro. A bolha fica na tela marcada, sem sumir. */
  falhou?: boolean;
}

/** Quantas mensagens carregamos de cara ao abrir uma conversa.
 *  Antes vinha a conversa inteira (a maior tem quase 900 mensagens),
 *  então abrir um contato antigo travava a tela. */
const MENSAGENS_POR_PAGINA = 80;

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
  const messagesRef = useRef<Message[]>([]);
  const convOpenedAtRef = useRef<string>('');
  /** Altura da lista antes de emendar mensagens antigas no topo. */
  const alturaAntesRef = useRef<number | null>(null);
  /** O canal de Realtime está mesmo conectado? Define se precisamos poll. */
  const realtimeOkRef = useRef(false);

  // Paginação para trás
  const [temMaisAntigas, setTemMaisAntigas] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);

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
    setLoading(false);
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
    // Atualiza a lista de contatos sem spinner, só para pegar conversa nova.
    const poll = setInterval(() => loadLeads(false), 10000);
    return () => clearInterval(poll);
  }, [loadLeads]);

  // Carrega a conversa e assina o Realtime ao selecionar um contato
  useEffect(() => {
    if (!selectedPhone) { setMessages([]); return; }

    realtimeOkRef.current = false;
    loadMessages(selectedPhone);

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
      })
      .subscribe((status) => {
        // Se o canal conectou, o poll de segurança fica quase parado.
        realtimeOkRef.current = status === 'SUBSCRIBED';
      });

    return () => {
      realtimeOkRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [selectedPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Rola para o fim quando chega mensagem nova. Quando o lote veio de
  // "carregar anteriores", devolve o scroll ao ponto onde a pessoa estava.
  useLayoutEffect(() => {
    const el = listaRef.current;
    if (el && alturaAntesRef.current !== null) {
      el.scrollTop = el.scrollHeight - alturaAntesRef.current;
      alturaAntesRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages]);

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
    setNewMessage('');
    setPendingFiles([]);
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
        pendente: true,
      }]);
    }

    void enviar(phone, msgText, files, idTemp);
  };

  const enviar = async (
    selectedPhone: string,
    msgText: string,
    files: { name: string; type: string; base64: string }[],
    idTemp: string,
  ) => {
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
        const dbMsg = isAudio ? `[Áudio: ${pf.name}]` : pf.type.startsWith('image/') ? `[Imagem: ${pf.name}]` : `[Arquivo: ${pf.name}]`;
        const { data: inserted } = await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone, name: selectedLead?.name ?? selectedPhone,
          message: caption ? `${dbMsg} - ${caption}` : dbMsg, direction: 'outbound', status: 'sent',
          zapi_id: resData?.zapiId ?? null,
        }).select().single();
        // Realtime will pick it up automatically — but add locally if needed
        if (inserted) setMessages(prev => prev.some(m => m.id === inserted.id) ? prev : [...prev, inserted as Message]);
      }

      // Send text-only if no files
      if (!files.length && msgText) {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST', headers,
          body: JSON.stringify({ phone: selectedPhone, message: msgText }),
        });
        const resData = await res.json();
        const { data: inserted } = await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone, name: selectedLead?.name ?? selectedPhone,
          message: msgText, direction: 'outbound', status: 'sent',
          zapi_id: resData?.zapiId ?? null,
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
    const files = Array.from(e.target.files ?? []);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
                        <span className="text-white font-bold text-xs truncate">{lead.name}</span>
                        <span className="text-slate-500 text-[10px] shrink-0">{formatTime(lead.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <span className="text-slate-500 text-[10px] truncate">{lead.phone}</span>
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
                  <p className="text-slate-400 text-xs mt-0.5">{selectedPhone}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
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
            <div ref={listaRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
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
                messages.map(msg => (
                  <div key={msg.id} className={`flex group ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    {/* Edit/delete actions for outbound (não em bolha otimista) */}
                    {msg.direction === 'outbound' && !msg.pendente && !msg.falhou && (
                      <div className="flex items-center gap-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {editingMsg?.id !== msg.id && (
                          <>
                            <button onClick={() => setEditingMsg({ id: msg.id, zapi_id: msg.zapi_id, text: msg.message })} className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Editar">
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => setDeletingMsgId(msg.id)} className="p-1 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors" title="Excluir">
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <div className={`max-w-[72%] rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.direction === 'inbound'
                        ? 'bg-white text-slate-800 rounded-bl-md'
                        : 'bg-navy text-white rounded-br-md'
                    } ${msg.pendente ? 'opacity-60' : ''} ${msg.falhou ? 'ring-1 ring-rose-400' : ''}`}>
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
                      ) : msg.audio_url ? (
                        /* Audio player */
                        <div className="px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <Volume2 size={13} className={msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/60'} />
                            <span className="text-[11px] font-bold opacity-60">Áudio</span>
                          </div>
                          <audio controls src={msg.audio_url} className="max-w-[220px]" style={{ height: '32px' }} />
                          <p className={`text-[10px] mt-1 text-right ${msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/40'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="px-4 pb-4 pt-2 border-t border-slate-200 bg-white shrink-0">
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
                <textarea
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={pendingFiles.length ? 'Legenda (opcional)...' : 'Escreva uma mensagem... (Enter para enviar)'}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
                  style={{ maxHeight: '100px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={(!newMessage.trim() && !pendingFiles.length) || (sending && !!pendingFiles.length)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-navy text-gold disabled:opacity-30 hover:bg-navy-light transition-all"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

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
