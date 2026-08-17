import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, RefreshCw, User, Loader2, Plus, X, CheckCircle2, Tag, FileText, Paperclip, Image, Trash2, Pencil, Mic, Volume2, AlertCircle, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

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
}

const STATUS_COLORS: Record<string, string> = {
  'novo': 'bg-emerald-500',
  'em atendimento': 'bg-blue-500',
  'cotação enviada': 'bg-amber-500',
  'fechado': 'bg-slate-400',
};

const STATUS_LABELS: Record<string, string> = {
  'novo': 'Novo',
  'em atendimento': 'Em atendimento',
  'cotação enviada': 'Cotação enviada',
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('whatsapp_leads')
      .select('*')
      .order('updated_at', { ascending: false });
    setLeads(data ?? []);
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (phone: string) => {
    setLoadingMessages(true);
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: true });
    setMessages(data ?? []);
    setLoadingMessages(false);
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    if (selectedPhone) loadMessages(selectedPhone);
    else setMessages([]);
  }, [selectedPhone, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateStatus = async (phone: string, status: string) => {
    await supabase
      .from('whatsapp_leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('phone', phone);
    setLeads(prev => prev.map(l => l.phone === phone ? { ...l, status } : l));
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && !pendingFiles.length) || !selectedPhone || sending) return;
    setSending(true);
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
      for (const pf of pendingFiles) {
        const caption = pendingFiles.indexOf(pf) === pendingFiles.length - 1 ? newMessage.trim() : '';
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST', headers,
          body: JSON.stringify({ phone: selectedPhone, file: pf.base64, fileName: pf.name, fileType: pf.type, message: caption }),
        });
        const resData = await res.json();
        const isAudio = pf.type.startsWith('audio/');
        const dbMsg = isAudio ? `[Áudio: ${pf.name}]` : pf.type.startsWith('image/') ? `[Imagem: ${pf.name}]` : `[Arquivo: ${pf.name}]`;
        await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone, name: selectedLead?.name ?? selectedPhone,
          message: caption ? `${dbMsg} — ${caption}` : dbMsg, direction: 'outbound', status: 'sent',
          zapi_id: resData?.zapiId ?? null,
        });
      }

      // Send text-only if no files
      if (!pendingFiles.length && newMessage.trim()) {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST', headers,
          body: JSON.stringify({ phone: selectedPhone, message: newMessage.trim() }),
        });
        const resData = await res.json();
        await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone, name: selectedLead?.name ?? selectedPhone,
          message: newMessage.trim(), direction: 'outbound', status: 'sent',
          zapi_id: resData?.zapiId ?? null,
        });
      }

      // Human took over → silence the bot
      await supabase
        .from('whatsapp_leads')
        .update({ status: 'em atendimento', updated_at: new Date().toISOString() })
        .eq('phone', selectedPhone);
      setLeads(prev => prev.map(l => l.phone === selectedPhone ? { ...l, status: 'em atendimento' } : l));
      setNewMessage('');
      setPendingFiles([]);
      loadMessages(selectedPhone);
    } catch (e) {
      console.error('Erro ao enviar:', e);
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
      className="flex rounded-[2rem] overflow-hidden shadow-lg border border-slate-200 bg-white"
      style={{ height: 'calc(100vh - 160px)', minHeight: '500px' }}
    >
      {/* ── Left panel: contacts ──────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-white/10 flex flex-col bg-[#1B263B]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={15} className="text-[#C69C6D]" />
            <span className="font-black text-white text-sm">Inbox WhatsApp</span>
          </div>
          <button onClick={loadLeads} className="text-slate-400 hover:text-[#C69C6D] transition-colors" title="Atualizar">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 bg-white/8 rounded-xl px-3 py-2 border border-white/10 focus-within:border-[#C69C6D]/40">
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
              <Loader2 size={18} className="text-[#C69C6D] animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-14 px-6">
              <MessageSquare size={28} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 text-xs font-bold">Nenhum contato ainda</p>
              <p className="text-slate-600 text-[11px] mt-1">As mensagens recebidas aparecerão aqui</p>
            </div>
          ) : (
            leads.filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.phone.includes(search)).map(lead => (
              <div
                key={lead.phone}
                className={`border-b border-white/5 transition-all ${
                  selectedPhone === lead.phone
                    ? 'bg-[#C69C6D]/15 border-l-2 border-l-[#C69C6D]'
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
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#1B263B] ${STATUS_COLORS[lead.status] ?? 'bg-slate-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-white font-bold text-xs truncate">{lead.name}</span>
                        <span className="text-slate-500 text-[10px] shrink-0">{formatTime(lead.updated_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <span className="text-slate-500 text-[10px] truncate">{lead.phone}</span>
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full shrink-0 ${
                          lead.status === 'novo' ? 'bg-emerald-500/20 text-emerald-400' :
                          lead.status === 'em atendimento' ? 'bg-blue-500/20 text-blue-400' :
                          lead.status === 'cotação enviada' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>{STATUS_LABELS[lead.status] ?? lead.status}</span>
                      </div>
                    </div>
                  </div>
                </button>
                <div className="px-4 pb-2.5 flex gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openCrmModal(lead); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[#C69C6D]/15 hover:bg-[#C69C6D]/30 text-[#C69C6D] text-[10px] font-black transition-colors"
                    title="Adicionar ao CRM"
                  >
                    <Plus size={11} /> Adicionar ao CRM
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingConv(lead.phone); }}
                    className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/25 text-red-400 transition-colors"
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
      <div className="flex-1 flex flex-col min-w-0 bg-[#F8F4ED]">
        {!selectedPhone ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
              <MessageSquare size={26} className="text-slate-300" />
            </div>
            <p className="font-black text-slate-400 text-sm">Selecione um contato</p>
            <p className="text-slate-300 text-xs mt-1">para ver a conversa e enviar mensagens</p>
          </div>
        ) : (
          <>
            {/* Contact header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#1B263B] flex items-center justify-center">
                  <User size={15} className="text-[#C69C6D]" />
                </div>
                <div>
                  <p className="font-black text-slate-800 text-sm leading-none">{selectedLead?.name}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{selectedPhone}</p>
                </div>
              </div>

              <select
                value={selectedLead?.status ?? 'novo'}
                onChange={e => updateStatus(selectedPhone, e.target.value)}
                className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:border-[#C69C6D]/50 cursor-pointer"
              >
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {loadingMessages ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={18} className="text-[#C69C6D] animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-slate-400 text-xs font-bold">Nenhuma mensagem ainda</p>
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`flex group ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    {/* Edit/delete actions for outbound */}
                    {msg.direction === 'outbound' && (
                      <div className="flex items-center gap-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {editingMsg?.id !== msg.id && (
                          <>
                            <button onClick={() => setEditingMsg({ id: msg.id, zapi_id: msg.zapi_id, text: msg.message })} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Editar">
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => setDeletingMsgId(msg.id)} className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Excluir">
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <div className={`max-w-[72%] rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.direction === 'inbound'
                        ? 'bg-white text-slate-800 rounded-bl-md'
                        : 'bg-[#1B263B] text-white rounded-br-md'
                    }`}>
                      {editingMsg?.id === msg.id ? (
                        /* Inline edit */
                        <div className="p-2 space-y-2 min-w-[200px]">
                          <textarea
                            autoFocus
                            value={editingMsg.text}
                            onChange={e => setEditingMsg(em => em ? { ...em, text: e.target.value } : em)}
                            rows={3}
                            className="w-full bg-white/10 text-white text-sm p-2 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-white/30 placeholder-white/40"
                          />
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingMsg(null)} className="text-white/50 hover:text-white text-xs px-2 py-1 transition-colors">Cancelar</button>
                            <button onClick={saveEditedMessage} className="bg-[#C69C6D] text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-[#b8895a] transition-colors">Salvar</button>
                          </div>
                        </div>
                      ) : deletingMsgId === msg.id ? (
                        /* Delete confirm */
                        <div className="px-4 py-3 space-y-2">
                          <p className="text-xs text-white/70">Excluir para todos?</p>
                          <div className="flex gap-2">
                            <button onClick={() => setDeletingMsgId(null)} className="text-white/50 hover:text-white text-xs transition-colors">Não</button>
                            <button onClick={() => deleteMessage(msg)} className="text-red-400 hover:text-red-300 text-xs font-bold transition-colors">Excluir</button>
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
                          <p className={`text-[10px] mt-1 text-right ${msg.direction === 'inbound' ? 'text-slate-400' : 'text-white/40'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
                    <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#C69C6D]/10 border border-[#C69C6D]/30 rounded-xl max-w-[180px]">
                      {pf.type.startsWith('image/') ? (
                        <Image size={12} className="text-[#C69C6D] shrink-0" />
                      ) : (
                        <FileText size={12} className="text-[#C69C6D] shrink-0" />
                      )}
                      <span className="text-[11px] font-bold text-slate-700 truncate flex-1">{pf.name}</span>
                      <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="shrink-0 text-slate-400 hover:text-slate-600">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2.5 focus-within:border-[#C69C6D]/50 focus-within:bg-white transition-all">
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
                  className="shrink-0 text-slate-400 hover:text-[#C69C6D] transition-colors"
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
                  disabled={(!newMessage.trim() && !pendingFiles.length) || sending}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-[#1B263B] text-[#C69C6D] disabled:opacity-30 hover:bg-[#243447] transition-all"
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
        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-[#1B263B]">
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Plus size={16} className="text-[#C69C6D]" /> Adicionar ao CRM
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
              <p className="font-black text-slate-800">Adicionado ao CRM!</p>
              <p className="text-xs text-slate-500">O lead foi criado em <strong>Novos Leads</strong>.</p>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dados do contato</p>
                <p className="text-sm font-bold text-slate-800">{crmModalLead.name}</p>
                <p className="text-xs text-slate-500">{crmModalLead.phone}</p>
                <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md w-fit">Origem: WhatsApp</p>
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                  <Tag size={13} className="text-[#C69C6D]" /> Foco do Atendimento
                </label>
                <select
                  value={crmProductType}
                  onChange={e => setCrmProductType(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[#C69C6D]/20 focus:border-[#C69C6D] cursor-pointer"
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
                  className="w-full py-2.5 bg-[#C69C6D] hover:bg-[#b8895a] text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg"
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
                  className="flex-1 py-2.5 bg-[#1B263B] hover:bg-[#243347] text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
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
        <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-xs p-7 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <Trash2 size={20} className="text-red-500" />
          </div>
          <div>
            <p className="font-black text-slate-800">Excluir conversa?</p>
            <p className="text-sm text-slate-500 mt-1">Todas as mensagens serão apagadas do hub. A conversa no WhatsApp não é afetada.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setDeletingConv(null)} className="flex-1 py-2.5 font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors text-sm">Cancelar</button>
            <button onClick={() => deleteConversation(deletingConv)} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl transition-colors text-sm">Excluir</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
