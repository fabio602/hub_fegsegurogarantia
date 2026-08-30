import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, ChevronDown, Paperclip, FileText, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getAnalysisContext, applyAnalysisUpdate } from '../lib/analysisContext';

const CAMPOS_MARKER = 'CAMPOS_ATUALIZADOS:';

// Display messages (UI)
interface Message {
  role: 'user' | 'assistant';
  content: string;
  fileName?: string; // badge for attached PDF
}

// API messages (Anthropic format)
type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ApiContentBlock[];
}

const VIEW_CONTEXT: Record<string, string> = {
  home: 'Dashboard principal do Hub',
  goals: 'Seção de Registro de Vendas (Seguro Garantia)',
  seg_auto_goals: 'Seção de Registro de Vendas (Seguro Auto)',
  seg_vida_goals: 'Seção de Registro de Vendas (Seguro de Vida)',
  resp_civil_goals: 'Seção de Registro de Vendas (Resp. Civil)',
  financeiro_goals: 'Seção de Gestão Financeira',
  'seg-licitante': 'Cotação de Seguro Licitante (bid bond) — análise de editais',
  'seg-contrato': 'Cotação de Seguro de Contrato (performance bond) — análise de contratos',
  carteira: 'Carteira de Clientes',
  prospeccao: 'Prospecção de novos clientes',
  pnpc: 'PNCP — Portal Nacional de Contratações Públicas',
  'metas-mensais': 'Metas Mensais',
  'metas-anuais': 'Metas Anuais',
};

const QUICK_CHIPS = [
  'O que é seguro-garantia de proposta?',
  'Como calcular a IS de um contrato?',
  'Qual o prazo mínimo de vigência?',
  'Art. 59 §4º da Lei 14.133/2021',
];

const toBase64 = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(f);
  });

export default function ChatWidget({ activeView }: { activeView?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUnread(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const baseContext = activeView ? VIEW_CONTEXT[activeView] ?? '' : '';
  const analysisCtx = getAnalysisContext();
  const context = analysisCtx.result
    ? `${baseContext}\n\nDADOS ATUAIS DA ANÁLISE (${analysisCtx.type === 'contrato' ? 'Seguro de Contrato' : 'Seguro Licitante'}):\n${JSON.stringify(analysisCtx.result, null, 2)}\n\nSe solicitado corrigir ou atualizar campos, responda normalmente e inclua ao final (linha separada):\n${CAMPOS_MARKER} {"campo": "novo_valor"}`
    : baseContext;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { alert('Apenas arquivos PDF são aceitos.'); return; }
    if (f.size > 30 * 1024 * 1024) { alert('Arquivo deve ter no máximo 30MB.'); return; }
    setAttachedFile(f);
    e.target.value = '';
  };

  const send = async (text: string) => {
    const userText = text.trim();
    if (!userText && !attachedFile) return;
    if (loading) return;

    // Build display message
    const displayMsg: Message = {
      role: 'user',
      content: userText,
      fileName: attachedFile?.name,
    };

    // Build API message
    let apiMsg: ApiMessage;
    if (attachedFile) {
      const base64 = await toBase64(attachedFile);
      const isImage = attachedFile.type.startsWith('image/');
      const blocks: ApiContentBlock[] = [
        isImage
          ? { type: 'image', source: { type: 'base64', media_type: attachedFile.type, data: base64 } } as any
          : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      ];
      if (userText) blocks.push({ type: 'text', text: userText });
      apiMsg = { role: 'user', content: blocks };
    } else {
      apiMsg = { role: 'user', content: userText };
    }

    const newDisplayMessages = [...messages, displayMsg];
    const newApiMessages = [...apiMessages, apiMsg];

    setMessages(newDisplayMessages);
    setApiMessages(newApiMessages);
    setInput('');
    setAttachedFile(null);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/chat-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ messages: newApiMessages, context }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao responder');

      let displayText = json.text as string;
      let appliedUpdate = false;

      // Detect and apply field updates suggested by the AI
      const markerIdx = displayText.indexOf(CAMPOS_MARKER);
      if (markerIdx !== -1) {
        const jsonStr = displayText.slice(markerIdx + CAMPOS_MARKER.length).trim();
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          try {
            const updates = JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1));
            applyAnalysisUpdate(updates);
            appliedUpdate = true;
          } catch { /* ignore parse error */ }
        }
        // Remove the marker line from displayed text
        displayText = displayText.slice(0, markerIdx).trim();
        if (appliedUpdate) displayText += '\n\n✅ *Campos atualizados automaticamente.*';
      }

      const assistantDisplay: Message = { role: 'assistant', content: displayText };
      const assistantApi: ApiMessage = { role: 'assistant', content: displayText };
      setMessages(prev => [...prev, assistantDisplay]);
      setApiMessages(prev => [...prev, assistantApi]);
      if (!open) setUnread(true);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Não foi possível obter resposta. Tente novamente.' }]);
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setMessages([]);
    setApiMessages([]);
    setAttachedFile(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const canSend = (input.trim().length > 0 || !!attachedFile) && !loading;

  return (
    <>
      {/* Chat panel */}
      <div
        className={`fixed bottom-24 right-6 z-50 flex flex-col bg-white rounded-[2rem] shadow-2xl border border-slate-100 transition-all duration-300 origin-bottom-right ${
          open
            ? 'w-[380px] h-[580px] opacity-100 scale-100 pointer-events-auto'
            : 'w-0 h-0 opacity-0 scale-75 pointer-events-none'
        }`}
        style={{ maxHeight: 'calc(100vh - 120px)' }}
      >
        {open && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-navy flex items-center justify-center">
                  <MessageCircle size={15} className="text-gold" />
                </div>
                <div>
                  <p className="font-bold text-slate-800 text-sm leading-none">Assistente FEG</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {context || 'Seguro Garantia · IA'}
                  </p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <ChevronDown size={18} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="text-center pt-4">
                    <div className="w-12 h-12 rounded-2xl bg-navy flex items-center justify-center mx-auto mb-3">
                      <MessageCircle size={20} className="text-gold" />
                    </div>
                    <p className="font-bold text-slate-800 text-sm">Olá! Como posso ajudar?</p>
                    <p className="text-slate-400 text-xs mt-1">
                      Tire dúvidas ou envie um PDF para análise.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {QUICK_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => send(chip)}
                        className="w-full text-left text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-amber-50 hover:text-gold-dark border border-slate-200 hover:border-gold/40 px-4 py-2.5 rounded-xl transition-all"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {/* File badge */}
                    {msg.fileName && (
                      <div className="flex items-center gap-1.5 bg-navy/10 border border-navy/15 px-3 py-1.5 rounded-xl">
                        <FileText size={12} className="text-gold shrink-0" />
                        <span className="text-[11px] font-bold text-slate-700 truncate max-w-[180px]">{msg.fileName}</span>
                      </div>
                    )}
                    {/* Text bubble */}
                    {msg.content && (
                      <div
                        className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-navy text-white rounded-br-md'
                            : 'bg-slate-100 text-slate-800 rounded-bl-md'
                        }`}
                        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      >
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="px-4 pb-4 pt-2 shrink-0 border-t border-slate-100 space-y-2">
              {/* File preview */}
              {attachedFile && (
                <div className="flex items-center gap-2 bg-amber-50 border border-gold/30 rounded-xl px-3 py-2">
                  <FileText size={14} className="text-gold shrink-0" />
                  <span className="flex-1 text-xs font-bold text-slate-700 truncate">{attachedFile.name}</span>
                  <button onClick={() => setAttachedFile(null)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Textarea + buttons */}
              <div className="flex items-end gap-2 bg-slate-50 rounded-2xl border border-slate-200 px-3 py-2.5 focus-within:border-gold/50 focus-within:bg-white transition-all">
                {/* Attach button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-gold hover:bg-slate-100 transition-all"
                  title="Anexar PDF"
                >
                  <Paperclip size={15} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={attachedFile ? 'Adicione uma instrução (opcional)...' : 'Digite sua dúvida... (Enter para enviar)'}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
                  style={{ maxHeight: '80px' }}
                />

                <button
                  onClick={() => send(input)}
                  disabled={!canSend}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-navy text-gold disabled:opacity-30 hover:bg-navy-light transition-all"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>

              {messages.length > 0 && (
                <button
                  onClick={clearAll}
                  className="w-full text-center text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Limpar conversa
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* FAB button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-navy shadow-xl flex items-center justify-center hover:bg-navy-light transition-all active:scale-95"
        title="Chat com IA"
      >
        {open ? (
          <X size={22} className="text-gold" />
        ) : (
          <>
            <MessageCircle size={22} className="text-gold" />
            {unread && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" />
            )}
          </>
        )}
      </button>
    </>
  );
}
