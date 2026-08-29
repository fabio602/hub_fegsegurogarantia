import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Upload, Pause, Play, Loader2, CheckCircle2, Clock, X, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Contato {
  id: string;
  nome_contato: string;
  nome_empresa: string;
  email: string;
  origem: string;
  trilha: string;
  data_inicio: string;
  ativo: boolean;
  email_1_sent: boolean;
  email_2_sent: boolean;
  email_3_sent: boolean;
  email_4_sent: boolean;
  email_5_sent: boolean;
  email_1_sent_at: string | null;
  email_2_sent_at: string | null;
  email_3_sent_at: string | null;
  email_4_sent_at: string | null;
  email_5_sent_at: string | null;
  created_at: string;
}

const EMAIL_DAYS = [1, 3, 7, 14, 21];
const EMAIL_LABELS = ['D+1', 'D+3', 'D+7', 'D+14', 'D+21'];

/** Uma trilha = um conjunto de e-mails. O conteúdo mora no banco (email_trilhas / email_trilha_etapas). */
interface Trilha {
  slug: string;
  nome: string;
  descricao: string | null;
}

const EMPTY_FORM = { nome_contato: '', nome_empresa: '', email: '', cidade: '', trilha: '' };

export default function ProspeccaoEmail() {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [trilhas, setTrilhas] = useState<Trilha[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<
    { nome_contato: string; nome_empresa: string; email: string }[] | null
  >(null);
  const [importTrilha, setImportTrilha] = useState('');
  const [importSaving, setImportSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filtroTrilha, setFiltroTrilha] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: contatosData }, { data: trilhasData }] = await Promise.all([
      supabase.from('email_cadencia').select('*').order('created_at', { ascending: false }),
      supabase.from('email_trilhas').select('slug, nome, descricao').eq('ativo', true).order('ordem'),
    ]);
    setContatos(contatosData ?? []);
    setTrilhas(trilhasData ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Assim que as trilhas chegam, deixa a primeira pré-selecionada nos dois fluxos.
  useEffect(() => {
    const primeira = trilhas[0]?.slug ?? '';
    if (!primeira) return;
    setForm(prev => (prev.trilha ? prev : { ...prev, trilha: primeira }));
    setImportTrilha(prev => prev || primeira);
  }, [trilhas]);

  const nomeTrilha = (slug: string) => trilhas.find(t => t.slug === slug)?.nome ?? slug;

  const handleAdd = async () => {
    if (!form.nome_contato || !form.nome_empresa || !form.email || !form.trilha) return;
    setSaving(true);
    const { data: inserted } = await supabase.from('email_cadencia').insert({
      nome_contato: form.nome_contato.trim(),
      nome_empresa: form.nome_empresa.trim(),
      email: form.email.trim().toLowerCase(),
      // Alimenta o [CIDADE] dos templates da trilha; vazio cai em "sua cidade".
      cidade: form.cidade.trim() || null,
      origem: 'hub',
      trilha: form.trilha,
      data_inicio: new Date().toISOString().split('T')[0],
      ativo: true,
    }).select('id').single();

    // Dispara o Email 1 na hora, sem esperar o cron do dia seguinte.
    //
    // Espera o retorno de propósito: antes isso era fire-and-forget com um
    // recarregar depois de 1,5s, e o envio demora ~4s. A tabela recarregava
    // antes de o `email_1_sent` ser gravado e o D+1 aparecia como relógio
    // mesmo tendo dado certo — parecia que a cadência não tinha começado.
    let erroEnvio: string | null = null;
    if (inserted?.id) {
      try {
        const { data, error } = await supabase.functions.invoke('prospecting-cadence', {
          body: { contact_id: inserted.id },
        });
        if (error) erroEnvio = error.message;
        else if (data && data.success === false) erroEnvio = data.error || 'falha no envio';
      } catch (e: any) {
        erroEnvio = e?.message || String(e);
      }
    }

    // Mantém a trilha escolhida — quem cadastra 10 contatos da mesma trilha não reescolhe 10 vezes.
    setForm({ ...EMPTY_FORM, trilha: form.trilha });
    setShowModal(false);
    setSaving(false);
    await load();

    // O contato entrou na cadência de qualquer jeito; só o primeiro e-mail
    // falhou. Avisar é melhor que deixar um relógio silencioso na tabela.
    if (erroEnvio) alert(`Contato cadastrado, mas o primeiro e-mail não saiu: ${erroEnvio}\n\nO cron das 07:00 tenta de novo amanhã.`);
  };

  const toggleAtivo = async (id: string, current: boolean) => {
    await supabase.from('email_cadencia').update({ ativo: !current }).eq('id', id);
    setContatos(prev => prev.map(c => c.id === id ? { ...c, ativo: !current } : c));
  };

  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (!lines.length) throw new Error('Arquivo vazio');

      // Detecta separador (vírgula ou ponto-e-vírgula)
      const sep = lines[0].includes(';') ? ';' : ',';
      const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));

      const iNome = header.findIndex(h => h.includes('nome_contato') || h === 'nome' || h === 'contato');
      const iEmp  = header.findIndex(h => h.includes('empresa') || h.includes('nome_empresa'));
      const iEmail = header.findIndex(h => h.includes('email'));

      if (iNome < 0 || iEmp < 0 || iEmail < 0)
        throw new Error('CSV precisa ter colunas: nome_contato, nome_empresa, email');

      const preview = lines.slice(1)
        .map(l => l.split(sep))
        .filter(r => r[iEmail]?.includes('@'))
        .map(r => ({
          nome_contato: r[iNome]?.trim() || '',
          nome_empresa: r[iEmp]?.trim() || '',
          email: r[iEmail]?.trim().toLowerCase() || '',
        }));

      setImportPreview(preview);
    } catch (err: any) {
      alert('Erro ao processar CSV: ' + err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.length || !importTrilha) return;
    setImportSaving(true);
    const today = new Date().toISOString().split('T')[0];
    const rows = importPreview.map(r => ({
      ...r,
      origem: 'csv',
      trilha: importTrilha,
      data_inicio: today,
      ativo: true,
    }));
    // Batch in chunks of 50
    for (let i = 0; i < rows.length; i += 50) {
      await supabase.from('email_cadencia').insert(rows.slice(i, i + 50));
    }
    setImportPreview(null);
    setImportSaving(false);
    load();
  };

  const filtered = contatos.filter(c => {
    if (filtroTrilha && c.trilha !== filtroTrilha) return false;
    if (!search) return true;
    const busca = search.toLowerCase();
    return c.nome_contato.toLowerCase().includes(busca)
      || c.nome_empresa.toLowerCase().includes(busca)
      || c.email.toLowerCase().includes(busca);
  });

  const EmailStatus = ({ sent, sentAt, day }: { sent: boolean; sentAt: string | null; day: string }) => (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] font-black text-slate-400 uppercase">{day}</span>
      {sent ? (
        <CheckCircle2 size={14} className="text-emerald-500" title={sentAt ? new Date(sentAt).toLocaleDateString('pt-BR') : 'Enviado'} />
      ) : (
        <Clock size={14} className="text-slate-300" title="Pendente" />
      )}
    </div>
  );

  const progress = (c: Contato) => {
    const sent = [c.email_1_sent, c.email_2_sent, c.email_3_sent, c.email_4_sent, c.email_5_sent].filter(Boolean).length;
    return sent;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl lg:text-3xl font-black text-slate-800 tracking-tight">Prospecção Email</h2>
          <p className="text-slate-500 font-semibold mt-1 text-sm">
            Cadência automática de e-mails — cada contato segue a trilha do produto escolhido
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm rounded-xl transition-all cursor-pointer">
            <Upload size={15} />
            {importing ? 'Processando...' : 'Importar CSV'}
            <input type="file" accept=".csv" className="hidden" onChange={handleCSV} disabled={importing} />
          </label>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#C69C6D] hover:bg-[#b8895a] text-white font-bold text-sm rounded-xl transition-all"
          >
            <Plus size={15} /> Adicionar Contato
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: contatos.length, color: 'bg-[#1B263B] text-white', val: 'text-[#C69C6D]' },
          { label: 'Ativos', value: contatos.filter(c => c.ativo).length, color: 'bg-white border border-slate-100', val: 'text-emerald-600' },
          { label: 'Concluídos', value: contatos.filter(c => progress(c) === 5).length, color: 'bg-white border border-slate-100', val: 'text-slate-800' },
          { label: 'Pausados', value: contatos.filter(c => !c.ativo).length, color: 'bg-white border border-slate-100', val: 'text-amber-600' },
        ].map((s, i) => (
          <div key={i} className={`${s.color} rounded-2xl p-4 shadow-sm`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${s.color.includes('1B263B') ? 'text-white/50' : 'text-slate-400'}`}>{s.label}</p>
            <p className={`text-2xl font-black ${s.val}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Busca + filtro por trilha */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Buscar por nome, empresa ou email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D] bg-white"
        />
        <select
          value={filtroTrilha}
          onChange={e => setFiltroTrilha(e.target.value)}
          className="sm:w-64 px-4 py-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 focus:outline-none focus:border-[#C69C6D] bg-white"
        >
          <option value="">Todas as trilhas</option>
          {trilhas.map(t => (
            <option key={t.slug} value={t.slug}>{t.nome}</option>
          ))}
        </select>
      </div>

      {/* Preview CSV */}
      {importPreview && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-100 flex items-center justify-between bg-amber-50">
            <div>
              <p className="font-black text-slate-800 text-sm">{importPreview.length} contato(s) encontrado(s) no CSV</p>
              <p className="text-xs text-slate-500 mt-0.5">Revise e confirme para importar. Cadência começa hoje.</p>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Trilha do lote</label>
                <select
                  value={importTrilha}
                  onChange={e => setImportTrilha(e.target.value)}
                  className="px-3 py-2 border border-amber-200 rounded-xl text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:border-[#C69C6D]"
                >
                  {trilhas.map(t => (
                    <option key={t.slug} value={t.slug}>{t.nome}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => setImportPreview(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-sm">Cancelar</button>
              <button onClick={confirmImport} disabled={importSaving || !importTrilha}
                className="flex items-center gap-2 px-4 py-2 bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {importSaving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {importSaving ? 'Importando...' : 'Confirmar Importação'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-48">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100">
                <th className="text-left px-4 py-2 text-[10px] font-black uppercase text-slate-400">Nome</th>
                <th className="text-left px-4 py-2 text-[10px] font-black uppercase text-slate-400">Empresa</th>
                <th className="text-left px-4 py-2 text-[10px] font-black uppercase text-slate-400">Email</th>
              </tr></thead>
              <tbody>
                {importPreview.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{r.nome_contato}</td>
                    <td className="px-4 py-2 text-slate-600">{r.nome_empresa}</td>
                    <td className="px-4 py-2 text-slate-500 font-mono text-xs">{r.email}</td>
                  </tr>
                ))}
                {importPreview.length > 10 && (
                  <tr><td colSpan={3} className="px-4 py-2 text-center text-xs text-slate-400">+ {importPreview.length - 10} mais...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="text-[#C69C6D] animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <Mail size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="font-black text-slate-400 text-sm">
            {search ? 'Nenhum resultado para a busca' : 'Nenhum contato na cadência'}
          </p>
          <p className="text-slate-300 text-xs mt-1">Clique em "Adicionar Contato" ou importe um CSV</p>
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="font-black text-slate-700 text-sm">{filtered.length} contato(s)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Contato</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Empresa</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Trilha</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Email</th>
                  <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Início</th>
                  <th className="text-center px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400" colSpan={5}>Status Emails</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const prog = progress(c);
                  const allDone = prog === 5;
                  return (
                    <tr key={c.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors ${!c.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-4">
                        <p className="font-black text-slate-800 text-sm">{c.nome_contato}</p>
                        {allDone && <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Concluído</span>}
                        {!c.ativo && !allDone && <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Pausado</span>}
                      </td>
                      <td className="px-5 py-4 text-sm font-medium text-slate-600">{c.nome_empresa}</td>
                      <td className="px-5 py-4">
                        <span className="inline-block text-[10px] font-black text-[#1B263B] bg-[#C69C6D]/15 px-2.5 py-1 rounded-full whitespace-nowrap">
                          {nomeTrilha(c.trilha)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-slate-500">{c.email}</td>
                      <td className="px-5 py-4 text-xs font-bold text-slate-500">
                        {new Date(c.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      {[
                        { sent: c.email_1_sent, at: c.email_1_sent_at, day: EMAIL_LABELS[0] },
                        { sent: c.email_2_sent, at: c.email_2_sent_at, day: EMAIL_LABELS[1] },
                        { sent: c.email_3_sent, at: c.email_3_sent_at, day: EMAIL_LABELS[2] },
                        { sent: c.email_4_sent, at: c.email_4_sent_at, day: EMAIL_LABELS[3] },
                        { sent: c.email_5_sent, at: c.email_5_sent_at, day: EMAIL_LABELS[4] },
                      ].map((e, i) => (
                        <td key={i} className="px-2 py-4 text-center">
                          <EmailStatus sent={e.sent} sentAt={e.at} day={e.day} />
                        </td>
                      ))}
                      <td className="px-5 py-4">
                        <button
                          onClick={() => toggleAtivo(c.id, c.ativo)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                            c.ativo
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {c.ativo ? <><Pause size={12} /> Pausar</> : <><Play size={12} /> Reativar</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Adicionar */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-800 text-lg">Adicionar Contato</h3>
                <p className="text-sm text-slate-500 mt-0.5">Cadência começa a partir de hoje</p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Trilha</label>
                <select
                  value={form.trilha}
                  onChange={e => setForm(prev => ({ ...prev, trilha: e.target.value }))}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-[#C69C6D] bg-slate-50"
                >
                  {trilhas.map(t => (
                    <option key={t.slug} value={t.slug}>{t.nome}</option>
                  ))}
                </select>
                {trilhas.find(t => t.slug === form.trilha)?.descricao && (
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
                    {trilhas.find(t => t.slug === form.trilha)?.descricao}
                  </p>
                )}
              </div>
              {[
                { label: 'Nome do Contato', key: 'nome_contato', placeholder: 'Ex: João Silva' },
                { label: 'Nome da Empresa', key: 'nome_empresa', placeholder: 'Ex: Construtora ABC Ltda' },
                { label: 'Email', key: 'email', placeholder: 'joao@empresa.com.br', type: 'email' },
                { label: 'Cidade (para o [CIDADE] dos e-mails)', key: 'cidade', placeholder: 'Ex: Sorocaba' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    placeholder={f.placeholder}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D] bg-slate-50"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={handleAdd} disabled={saving || !form.nome_contato || !form.nome_empresa || !form.email || !form.trilha}
                className="flex-1 py-3 bg-[#C69C6D] hover:bg-[#b8895a] disabled:opacity-50 text-white font-black text-sm rounded-xl transition-all flex items-center justify-center gap-2">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {saving ? 'Salvando...' : 'Adicionar à Cadência'}
              </button>
              <button onClick={() => setShowModal(false)} className="py-3 px-5 bg-slate-100 text-slate-600 font-black text-sm rounded-xl">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
