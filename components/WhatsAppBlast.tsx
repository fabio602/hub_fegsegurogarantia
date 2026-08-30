import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Square, Trash2, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, Upload, ChevronDown, ChevronUp, Plus, X, Save, FileText, Pencil,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface MsgTemplate { id: string; name: string; body: string; }

interface Contact {
  phone: string;
  name: string;
}

type Status = 'pending' | 'sending' | 'sent' | 'failed';
type ErrorMap = Record<string, string>;

const DEFAULT_TEMPLATE =
  `Olá {{nome}}, tudo bem?\n\nSou o Fábio, especialista em Seguro Garantia da FEG.\n\nVi que sua empresa participa de licitações e quero apresentar como o Seguro Garantia pode facilitar suas participações nos pregões.\n\nPosso te ajudar com uma cotação?`;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Already has country code 55
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Has DDD + number (10 or 11 digits) → prepend 55
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

function parseContacts(raw: string): Contact[] {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split(/[,;|\t]/);
      const phone = normalizePhone(parts[0].trim());
      const name = parts[1]?.trim() ?? '';
      return { phone, name };
    })
    .filter(c => c.phone.length >= 12);
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return phone;
}

const STATUS_CONFIG: Record<Status, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Clock size={14} />, label: 'Aguardando', color: 'text-slate-400' },
  sending: { icon: <Loader2 size={14} className="animate-spin" />, label: 'Enviando...', color: 'text-blue-500' },
  sent: { icon: <CheckCircle2 size={14} />, label: 'Enviado', color: 'text-emerald-500' },
  failed: { icon: <XCircle size={14} />, label: 'Falhou', color: 'text-rose-500' },
};

export default function WhatsAppBlast() {
  const [rawList, setRawList] = useState('');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [minDelay, setMinDelay] = useState(12);
  const [maxDelay, setMaxDelay] = useState(22);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [errors, setErrors] = useState<ErrorMap>({});
  const [sentTimes, setSentTimes] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const abortRef = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Templates — shared via Supabase
  const [savedTemplates, setSavedTemplates] = useState<MsgTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<{ id: string; name: string; body: string } | null>(null);

  useEffect(() => {
    if (!showTemplates) return;
    setLoadingTemplates(true);
    supabase.from('blast_templates').select('*').order('created_at').then(({ data }) => {
      setSavedTemplates((data ?? []).map(r => ({ id: r.id, name: r.name, body: r.body })));
      setLoadingTemplates(false);
    });
  }, [showTemplates]);

  const applyTemplate = (tpl: MsgTemplate) => { setTemplate(tpl.body); setShowTemplates(false); };

  const saveCurrentAsTemplate = async () => {
    if (!newTemplateName.trim() || !template.trim()) return;
    const { data, error } = await supabase.from('blast_templates').insert({ name: newTemplateName.trim(), body: template }).select().single();
    if (!error && data) {
      setSavedTemplates(prev => [...prev, { id: data.id, name: data.name, body: data.body }]);
    }
    setNewTemplateName('');
    setSavingTemplate(false);
  };

  const updateTemplate = async () => {
    if (!editingTemplate || !editingTemplate.name.trim() || !editingTemplate.body.trim()) return;
    await supabase.from('blast_templates').update({ name: editingTemplate.name, body: editingTemplate.body, updated_at: new Date().toISOString() }).eq('id', editingTemplate.id);
    setSavedTemplates(prev => prev.map(t => t.id === editingTemplate.id ? { ...editingTemplate } : t));
    setEditingTemplate(null);
  };

  const deleteTemplate = async (id: string) => {
    await supabase.from('blast_templates').delete().eq('id', id);
    setSavedTemplates(prev => prev.filter(t => t.id !== id));
  };

  const contacts = parseContacts(rawList);
  const sentCount = Object.values(statuses).filter(s => s === 'sent').length;
  const failedCount = Object.values(statuses).filter(s => s === 'failed').length;
  const totalCount = contacts.length;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setRawList(ev.target?.result as string ?? '');
    reader.readAsText(file);
    e.target.value = '';
  };

  const startBlast = async () => {
    if (!contacts.length || !template.trim() || running) return;
    abortRef.current = false;
    setDone(false);
    setRunning(true);
    setStatuses({});
    setErrors({});
    setSentTimes({});
    setCountdown(null);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const supabaseKey = (supabase as any).supabaseKey as string;

    for (let i = 0; i < contacts.length; i++) {
      if (abortRef.current) break;
      const contact = contacts[i];

      setStatuses(prev => ({ ...prev, [contact.phone]: 'sending' }));

      const message = template.replace(/\{\{nome\}\}/gi, contact.name || 'Cliente');

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || supabaseKey}`,
            'apikey': supabaseKey,
          },
          body: JSON.stringify({ phone: contact.phone, message }),
        });
        const json = await res.json();
        const ok = json.success === true;
        setStatuses(prev => ({ ...prev, [contact.phone]: ok ? 'sent' : 'failed' }));
        if (!ok) {
          setErrors(prev => ({ ...prev, [contact.phone]: json.error ?? 'Erro desconhecido' }));
        }
        if (ok) {
          setSentTimes(prev => ({
            ...prev,
            [contact.phone]: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          }));
          // Save to DB
          supabase.from('whatsapp_messages').insert({
            phone: contact.phone,
            name: contact.name || contact.phone,
            message,
            direction: 'outbound',
            status: 'sent',
          }).then(() => {});
          supabase.from('whatsapp_leads').upsert(
            { phone: contact.phone, name: contact.name || contact.phone, source: 'whatsapp', status: 'novo', updated_at: new Date().toISOString() },
            { onConflict: 'phone', ignoreDuplicates: false }
          ).then(() => {});
        }
      } catch (e) {
        setStatuses(prev => ({ ...prev, [contact.phone]: 'failed' }));
        setErrors(prev => ({ ...prev, [contact.phone]: String(e) }));
      }

      // Delay between messages (skip after last)
      if (i < contacts.length - 1 && !abortRef.current) {
        const delay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));
        let remaining = delay;
        setCountdown(remaining);
        countdownRef.current = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(countdownRef.current!);
            setCountdown(null);
          } else {
            setCountdown(remaining);
          }
        }, 1000);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        clearInterval(countdownRef.current!);
        setCountdown(null);
      }
    }

    setRunning(false);
    setDone(true);
  };

  const stopBlast = () => {
    abortRef.current = true;
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(null);
    setRunning(false);
  };

  const reset = () => {
    setStatuses({});
    setErrors({});
    setSentTimes({});
    setDone(false);
    setCountdown(null);
  };

  const previewMessage = (name: string) =>
    template.replace(/\{\{nome\}\}/gi, name || 'Cliente');

  const firstContactName = contacts[0]?.name || 'João';

  return (
    <div className="space-y-6">
      {/* Warning */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-800 font-bold text-xs">Atenção ao limite de disparos</p>
          <p className="text-amber-700 text-xs mt-0.5">
            Evite mais de 100 mensagens por dia pelo mesmo número. O delay automático já reduz o risco, mas números novos ou sem histórico estão mais sujeitos a bloqueio pelo WhatsApp.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ── Left: contact list ───────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800 text-sm">Lista de Contatos</p>
              <p className="text-slate-400 text-[11px] mt-0.5">Um por linha: <span className="font-mono">5511999999999,Nome</span></p>
            </div>
            <div className="flex items-center gap-2">
              {contacts.length > 0 && (
                <span className="text-xs font-bold text-gold bg-amber-50 px-2.5 py-1 rounded-xl border border-gold/20">
                  {contacts.length} contato{contacts.length !== 1 ? 's' : ''}
                </span>
              )}
              <label className="cursor-pointer flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-gold transition-colors border border-slate-200 hover:border-gold/40 px-3 py-1.5 rounded-xl">
                <Upload size={12} />
                CSV
                <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
          <textarea
            value={rawList}
            onChange={e => { setRawList(e.target.value); reset(); }}
            placeholder={`5511999999999,João Silva\n5511888888888,Maria Santos\n5511777777777`}
            className="w-full h-64 p-5 text-sm font-mono text-slate-700 placeholder-slate-300 resize-none focus:outline-none border-b border-slate-100"
          />
          {contacts.length > 0 && (
            <div className="px-5 py-3 max-h-48 overflow-y-auto space-y-1.5">
              {contacts.map(c => {
                const st = statuses[c.phone];
                const cfg = st ? STATUS_CONFIG[st] : null;
                return (
                  <div key={c.phone} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                    <div>
                      <p className="text-xs font-bold text-slate-700">{c.name || '—'}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{formatPhone(c.phone)}</p>
                    </div>
                    <div className="text-right">
                      <div className={`flex items-center gap-1.5 text-[11px] font-bold ${cfg?.color ?? 'text-slate-300'}`}>
                        {cfg?.icon}
                        <span>{cfg?.label ?? ''}</span>
                        {st === 'sent' && sentTimes[c.phone] && (
                          <span className="text-slate-400 font-normal">{sentTimes[c.phone]}</span>
                        )}
                      </div>
                      {st === 'failed' && errors[c.phone] && (
                        <p className="text-[10px] text-rose-400 mt-0.5 max-w-[160px] truncate" title={errors[c.phone]}>
                          {errors[c.phone]}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: message + config ──────────────────── */}
        <div className="space-y-4">
          {/* Message template */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-slate-800 text-sm">Mensagem</p>
                <p className="text-slate-400 text-[11px] mt-0.5">Use <span className="font-mono bg-slate-100 px-1 rounded-xl">{'{{nome}}'}</span> para personalizar</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTemplates(p => !p)}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-gold transition-colors border border-slate-200 rounded-xl px-3 py-1.5"
                >
                  <FileText size={12} /> Modelos {showTemplates ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                <button
                  onClick={() => setShowPreview(p => !p)}
                  className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-gold transition-colors"
                >
                  Preview {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>
            </div>

            {/* Template picker */}
            {showTemplates && (
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 space-y-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Modelos salvos</p>
                {loadingTemplates && <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-slate-400" /></div>}
                <div className="space-y-2">
                  {savedTemplates.map(tpl => (
                    <div key={tpl.id}>
                      {editingTemplate?.id === tpl.id ? (
                        /* ── Edit mode ── */
                        <div className="bg-white border border-gold/40 rounded-xl p-3 space-y-2">
                          <input
                            autoFocus
                            value={editingTemplate.name}
                            onChange={e => setEditingTemplate(et => et ? { ...et, name: e.target.value } : et)}
                            className="w-full text-sm font-bold px-3 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:border-gold"
                            placeholder="Nome do modelo"
                          />
                          <textarea
                            value={editingTemplate.body}
                            onChange={e => setEditingTemplate(et => et ? { ...et, body: e.target.value } : et)}
                            rows={5}
                            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-gold resize-none"
                          />
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setEditingTemplate(null)} className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">Cancelar</button>
                            <button onClick={updateTemplate} className="px-3 py-1.5 text-xs font-bold bg-navy text-white rounded-xl hover:bg-navy-light flex items-center gap-1.5 transition-colors">
                              <Save size={12} /> Salvar alterações
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Normal mode ── */
                        <div className="flex items-center gap-2 group">
                          <button
                            onClick={() => applyTemplate(tpl)}
                            className="flex-1 text-left px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-gold hover:bg-gold/5 transition-all"
                          >
                            <p className="text-sm font-bold text-slate-700">{tpl.name}</p>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{tpl.body.slice(0, 60)}...</p>
                          </button>
                          <button onClick={() => setEditingTemplate({ ...tpl })} className="shrink-0 p-1.5 text-slate-300 hover:text-gold transition-colors opacity-0 group-hover:opacity-100" title="Editar">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => deleteTemplate(tpl.id)} className="shrink-0 p-1.5 text-slate-300 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100" title="Excluir">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Save current as template */}
                {savingTemplate ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={newTemplateName}
                      onChange={e => setNewTemplateName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveCurrentAsTemplate(); if (e.key === 'Escape') setSavingTemplate(false); }}
                      placeholder="Nome do modelo..."
                      className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-gold"
                    />
                    <button onClick={saveCurrentAsTemplate} className="px-3 py-2 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy-light">
                      <Save size={13} />
                    </button>
                    <button onClick={() => setSavingTemplate(false)} className="p-2 text-slate-400 hover:text-slate-600">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSavingTemplate(true)}
                    className="flex items-center gap-1.5 text-xs font-bold text-gold hover:text-gold-hover transition-colors"
                  >
                    <Plus size={12} /> Salvar mensagem atual como modelo
                  </button>
                )}
              </div>
            )}
            <textarea
              value={template}
              onChange={e => setTemplate(e.target.value)}
              rows={7}
              className="w-full p-5 text-sm text-slate-700 placeholder-slate-300 resize-none focus:outline-none"
              placeholder="Digite sua mensagem..."
            />
            {showPreview && (
              <div className="px-5 pb-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Preview — como vai aparecer</p>
                <div className="bg-whatsapp-bolha rounded-2xl rounded-br-none px-4 py-3 text-sm text-slate-800 shadow-sm max-w-[85%] ml-auto" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {previewMessage(firstContactName)}
                </div>
              </div>
            )}
          </div>

          {/* Delay config */}
          <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
            <p className="font-bold text-slate-800 text-sm mb-4">Intervalo entre mensagens</p>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Mínimo', value: minDelay, set: setMinDelay },
                { label: 'Máximo', value: maxDelay, set: setMaxDelay },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block mb-2">{label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={value}
                      onChange={e => set(Number(e.target.value))}
                      className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 focus:outline-none focus:border-gold/50"
                    />
                    <span className="text-slate-400 text-sm font-bold">seg</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-slate-400 text-[11px] mt-3">
              Cada mensagem será enviada com um delay aleatório entre {minDelay}s e {maxDelay}s.
            </p>
          </div>

          {/* Progress / action */}
          <div className="bg-white rounded-2xl border border-slate-100 px-6 py-5">
            {/* Stats */}
            {(running || done) && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Enviados', value: sentCount, color: 'text-emerald-600 bg-emerald-50' },
                  { label: 'Falharam', value: failedCount, color: 'text-rose-600 bg-rose-50' },
                  { label: 'Total', value: totalCount, color: 'text-slate-700 bg-slate-50' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`${color} rounded-2xl px-3 py-3 text-center`}>
                    <p className="text-xl font-black">{value}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Progress bar */}
            {(running || done) && totalCount > 0 && (
              <div className="mb-4">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gold rounded-full transition-all duration-500"
                    style={{ width: `${((sentCount + failedCount) / totalCount) * 100}%` }}
                  />
                </div>
                {countdown != null && (
                  <p className="text-slate-400 text-[11px] mt-2 text-center">
                    Próximo envio em <span className="font-bold text-slate-600">{countdown}s</span>
                  </p>
                )}
              </div>
            )}

            {done && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 mb-4">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                <p className="text-emerald-700 font-bold text-xs">Disparo concluído — {sentCount} de {totalCount} enviados com sucesso.</p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              {!running ? (
                <button
                  onClick={startBlast}
                  disabled={!contacts.length || !template.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-navy hover:bg-navy-light text-white font-bold text-sm py-3.5 rounded-2xl disabled:opacity-30 transition-all active:scale-95"
                >
                  <Send size={14} />
                  {done ? 'Reenviar' : `Disparar para ${contacts.length} contato${contacts.length !== 1 ? 's' : ''}`}
                </button>
              ) : (
                <button
                  onClick={stopBlast}
                  className="flex-1 flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm py-3.5 rounded-2xl transition-all active:scale-95"
                >
                  <Square size={14} fill="currentColor" />
                  Parar disparo
                </button>
              )}
              {(Object.keys(statuses).length > 0 && !running) && (
                <button
                  onClick={reset}
                  className="w-12 h-12 flex items-center justify-center rounded-2xl border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 transition-all"
                  title="Limpar progresso"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
