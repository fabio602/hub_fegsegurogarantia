import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Loader2, Save, Trash2, Eye, Send, X, Mail,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2, GripVertical,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Editor das trilhas de e-mail da prospecção.
 *
 * A ideia: o molde visual da F&G (cabeçalho navy, faixa dourada, assinatura,
 * rodapé) mora na Edge Function `prospecting-cadence` — um lugar só, para
 * nenhuma modalidade sair com cara diferente. O que muda de e-mail para
 * e-mail (assunto, título, corpo, botão) mora aqui, no banco.
 *
 * Criar uma modalidade nova = criar uma trilha e escrever as etapas.
 * Não precisa mexer em código nem publicar nada.
 */

interface Trilha {
  slug: string;
  nome: string;
  descricao: string | null;
  eyebrow: string;
  rodape: string;
  ativo: boolean;
  ordem: number;
}

interface Etapa {
  id: string;
  trilha: string;
  ordem: number;
  dia: number;
  assunto: string;
  tagline: string | null;
  titulo: string | null;
  corpo_html: string | null;
  cta_texto: string | null;
  cta_link: string;
  html_completo: string | null;
  ativo: boolean;
}

const WHATSAPP_PADRAO = 'https://wa.me/5515998618659';
const DIAS_SUGERIDOS = [1, 3, 7, 14, 21, 30, 45, 60];

/** Transforma "Risco de Engenharia" em "risco-de-engenharia". */
const inputCls = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#C69C6D] bg-slate-50';

// Fica FORA do componente de propósito: se for declarado dentro, o React cria um
// tipo novo a cada render, desmonta o input e o campo perde o foco a cada tecla
// (dava a impressão de estar "digitando letra por letra").
const Campo = ({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">{label}</label>
    {children}
    {dica && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{dica}</p>}
  </div>
);

function gerarSlug(nome: string): string {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function EmailTrilhas() {
  const [trilhas, setTrilhas] = useState<Trilha[]>([]);
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [slugAtual, setSlugAtual] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [arrastandoId, setArrastandoId] = useState<string | null>(null);
  const [sobreId, setSobreId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ assunto: string; html: string } | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState<string | null>(null);
  const [enviandoTeste, setEnviandoTeste] = useState(false);

  const [novaTrilha, setNovaTrilha] = useState<{ nome: string; descricao: string; eyebrow: string; rodape: string } | null>(null);

  const notificar = (tipo: 'ok' | 'erro', texto: string) => {
    setAviso({ tipo, texto });
    setTimeout(() => setAviso(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: e }] = await Promise.all([
      supabase.from('email_trilhas').select('*').order('ordem'),
      supabase.from('email_trilha_etapas').select('*').order('trilha').order('ordem'),
    ]);
    setTrilhas(t ?? []);
    setEtapas(e ?? []);
    setSlugAtual(prev => prev ?? (t?.[0]?.slug ?? null));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const trilha = trilhas.find(t => t.slug === slugAtual) ?? null;
  const etapasDaTrilha = etapas.filter(e => e.trilha === slugAtual).sort((a, b) => a.ordem - b.ordem);

  // ─── Trilha ────────────────────────────────────────────────────────────────

  const alterarTrilha = (campo: keyof Trilha, valor: any) => {
    if (!slugAtual) return;
    setTrilhas(prev => prev.map(t => t.slug === slugAtual ? { ...t, [campo]: valor } : t));
  };

  const salvarTrilha = async () => {
    if (!trilha) return;
    setSalvando(true);
    const { error } = await supabase.from('email_trilhas').update({
      nome: trilha.nome.trim(),
      descricao: trilha.descricao?.trim() || null,
      eyebrow: trilha.eyebrow.trim(),
      rodape: trilha.rodape.trim(),
      ativo: trilha.ativo,
      ordem: trilha.ordem,
    }).eq('slug', trilha.slug);
    setSalvando(false);
    notificar(error ? 'erro' : 'ok', error ? 'Erro ao salvar: ' + error.message : 'Trilha salva.');
  };

  const criarTrilha = async () => {
    if (!novaTrilha?.nome.trim()) return;
    const slug = gerarSlug(novaTrilha.nome);
    if (!slug) return notificar('erro', 'Nome inválido — use letras e números.');
    if (trilhas.some(t => t.slug === slug)) return notificar('erro', `Já existe uma trilha com o código "${slug}".`);

    setSalvando(true);
    const { error } = await supabase.from('email_trilhas').insert({
      slug,
      nome: novaTrilha.nome.trim(),
      descricao: novaTrilha.descricao.trim() || null,
      eyebrow: novaTrilha.eyebrow.trim() || 'Corretora Especializada',
      rodape: novaTrilha.rodape.trim() || 'Você recebe este e-mail por ter demonstrado interesse em nossos seguros',
      ativo: false, // nasce desligada: você escreve as etapas com calma antes de liberar
      ordem: (trilhas.at(-1)?.ordem ?? 0) + 1,
    });
    setSalvando(false);
    if (error) return notificar('erro', 'Erro ao criar: ' + error.message);
    setNovaTrilha(null);
    setSlugAtual(slug);
    await load();
    notificar('ok', 'Trilha criada — desligada até você escrever as etapas.');
  };

  const excluirTrilha = async () => {
    if (!trilha) return;
    const emUso = await supabase.from('email_cadencia').select('id', { count: 'exact', head: true }).eq('trilha', trilha.slug);
    if ((emUso.count ?? 0) > 0)
      return notificar('erro', `Não dá para excluir: ${emUso.count} contato(s) estão nesta trilha. Desative-a em vez disso.`);
    if (!confirm(`Excluir a trilha "${trilha.nome}" e todas as suas etapas? Não tem volta.`)) return;

    setSalvando(true);
    await supabase.from('email_trilha_etapas').delete().eq('trilha', trilha.slug);
    const { error } = await supabase.from('email_trilhas').delete().eq('slug', trilha.slug);
    setSalvando(false);
    if (error) return notificar('erro', 'Erro ao excluir: ' + error.message);
    setSlugAtual(null);
    await load();
    notificar('ok', 'Trilha excluída.');
  };

  // ─── Etapas ────────────────────────────────────────────────────────────────

  const alterarEtapa = (id: string, campo: keyof Etapa, valor: any) => {
    setEtapas(prev => prev.map(e => e.id === id ? { ...e, [campo]: valor } : e));
  };

  const salvarEtapa = async (etapa: Etapa) => {
    setSalvando(true);
    const { error } = await supabase.from('email_trilha_etapas').update({
      ordem: etapa.ordem,
      dia: etapa.dia,
      assunto: etapa.assunto.trim(),
      tagline: etapa.tagline?.trim() || null,
      titulo: etapa.titulo?.trim() || null,
      corpo_html: etapa.corpo_html?.trim() || null,
      cta_texto: etapa.cta_texto?.trim() || null,
      cta_link: etapa.cta_link?.trim() || WHATSAPP_PADRAO,
      html_completo: etapa.html_completo?.trim() || null,
      ativo: etapa.ativo,
    }).eq('id', etapa.id);
    setSalvando(false);
    if (error) { notificar('erro', 'Erro ao salvar: ' + error.message); return false; }
    notificar('ok', `E-mail ${etapa.ordem} salvo.`);
    return true;
  };

  const criarEtapa = async () => {
    if (!trilha) return;
    const proximaOrdem = (etapasDaTrilha.at(-1)?.ordem ?? 0) + 1;
    const proximoDia = DIAS_SUGERIDOS[proximaOrdem - 1] ?? ((etapasDaTrilha.at(-1)?.dia ?? 0) + 7);
    setSalvando(true);
    const { data, error } = await supabase.from('email_trilha_etapas').insert({
      trilha: trilha.slug,
      ordem: proximaOrdem,
      dia: proximoDia,
      assunto: `E-mail ${proximaOrdem} para a [NOME_EMPRESA]`,
      titulo: 'Título do e-mail',
      corpo_html: '<p style="{{P}}">Olá [NOME_CONTATO], escreva aqui o texto do e-mail.</p>\n<p style="{{PF}}">Último parágrafo, antes do botão.</p>',
      cta_texto: 'Falar com um especialista',
      cta_link: WHATSAPP_PADRAO,
      ativo: true,
    }).select().single();
    setSalvando(false);
    if (error) return notificar('erro', 'Erro ao criar etapa: ' + error.message);
    setEtapas(prev => [...prev, data as Etapa]);
    setAbertas(prev => ({ ...prev, [data.id]: true }));
  };

  const excluirEtapa = async (etapa: Etapa) => {
    if (!confirm(`Excluir o e-mail ${etapa.ordem} desta trilha?`)) return;
    setSalvando(true);
    const { error } = await supabase.from('email_trilha_etapas').delete().eq('id', etapa.id);
    setSalvando(false);
    if (error) return notificar('erro', 'Erro ao excluir: ' + error.message);
    setEtapas(prev => prev.filter(e => e.id !== etapa.id));
    notificar('ok', 'E-mail excluído.');
  };

  // ─── Reordenar arrastando ──────────────────────────────────────────────────
  //
  // Arrastar um e-mail move a POSIÇÃO dele na trilha. Os dias (D+) não viajam
  // junto com o e-mail: eles ficam presos às posições, na ordem crescente que
  // já estava lá. Ou seja, quem for parar no 2º lugar dispara no dia do 2º
  // lugar. É o que faz sentido para uma cadência — se o dia viajasse junto,
  // a trilha passaria a mandar D+18 antes de D+7.

  const soltarEm = async (destinoId: string) => {
    const origemId = arrastandoId;
    setArrastandoId(null);
    setSobreId(null);
    if (!origemId || origemId === destinoId) return;

    const lista = [...etapasDaTrilha];
    const de = lista.findIndex(e => e.id === origemId);
    const para = lista.findIndex(e => e.id === destinoId);
    if (de < 0 || para < 0) return;

    const diasPorPosicao = lista.map(e => e.dia); // já vem ordenado por ordem
    const [movida] = lista.splice(de, 1);
    lista.splice(para, 0, movida);

    const novas = lista.map((e, i) => ({ ...e, ordem: i + 1, dia: diasPorPosicao[i] ?? e.dia }));
    const antigas = new Map<string, Etapa>(etapasDaTrilha.map(e => [e.id, e] as [string, Etapa]));
    const mudaram = novas.filter(n => {
      const a = antigas.get(n.id)!;
      return a.ordem !== n.ordem || a.dia !== n.dia;
    });
    if (!mudaram.length) return;

    // Atualiza a tela na hora, antes de ir ao banco: arrastar tem que parecer instantâneo.
    setEtapas(prev => prev.map(e => novas.find(n => n.id === e.id) ?? e));

    setSalvando(true);
    // Duas passadas de propósito. Se gravasse direto, duas etapas ficariam com a
    // mesma ordem no meio do caminho; a faixa dos 1000 é um estacionamento
    // temporário onde ninguém colide com a numeração antiga.
    for (const e of mudaram)
      await supabase.from('email_trilha_etapas').update({ ordem: 1000 + e.ordem }).eq('id', e.id);

    let erro: { message: string } | null = null;
    for (const e of mudaram) {
      const { error } = await supabase.from('email_trilha_etapas')
        .update({ ordem: e.ordem, dia: e.dia }).eq('id', e.id);
      if (error) erro = error;
    }
    setSalvando(false);

    if (erro) {
      notificar('erro', 'Erro ao reordenar: ' + erro.message);
      await load(); // desfaz o otimismo: volta ao que o banco realmente tem
    } else {
      notificar('ok', 'Nova ordem salva.');
    }
  };

  // ─── Preview e teste ───────────────────────────────────────────────────────

  /** Salva a etapa e pede o HTML montado à Edge Function — o mesmo que o contato receberia. */
  const visualizar = async (etapa: Etapa) => {
    setCarregandoPreview(etapa.id);
    const salvou = await salvarEtapa(etapa);
    if (!salvou) { setCarregandoPreview(null); return; }
    const { data, error } = await supabase.functions.invoke('prospecting-cadence', {
      body: { modo: 'preview', trilha: etapa.trilha, ordem: etapa.ordem },
    });
    setCarregandoPreview(null);
    if (error || !data?.success) return notificar('erro', data?.error || 'Não consegui montar o preview.');
    const email = data.emails?.[0];
    if (!email) return notificar('erro', 'A função não devolveu nenhum e-mail.');
    setPreview({ assunto: email.assunto, html: email.html });
  };

  /** Envia a trilha inteira para o próprio usuário, com [TESTE n] no assunto. */
  const enviarTeste = async () => {
    if (!trilha) return;
    if (!confirm(`Enviar os ${etapasDaTrilha.filter(e => e.ativo).length} e-mails desta trilha para o seu próprio e-mail?`)) return;
    setEnviandoTeste(true);
    const { data, error } = await supabase.functions.invoke('prospecting-cadence', {
      body: { modo: 'teste', trilha: trilha.slug },
    });
    setEnviandoTeste(false);
    if (error || !data?.success) return notificar('erro', data?.error || 'Erro ao enviar o teste.');
    notificar('ok', `${data.enviados ?? etapasDaTrilha.length} e-mail(s) de teste enviados para a sua caixa.`);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={24} className="text-[#C69C6D] animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl lg:text-3xl font-black text-slate-800 tracking-tight">Trilhas de E-mail</h2>
          <p className="text-slate-500 font-semibold mt-1 text-sm">
            Cada trilha é uma sequência de e-mails de um produto. O visual da F&amp;G é aplicado automaticamente.
          </p>
        </div>
        <button
          onClick={() => setNovaTrilha({ nome: '', descricao: '', eyebrow: 'Corretora Especializada', rodape: 'Você recebe este e-mail por ter demonstrado interesse em nossos seguros' })}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#C69C6D] hover:bg-[#b8895a] text-white font-bold text-sm rounded-xl transition-all"
        >
          <Plus size={15} /> Nova Trilha
        </button>
      </div>

      {/* Aviso */}
      {aviso && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold ${
          aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {aviso.tipo === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {aviso.texto}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
        {/* Lista de trilhas */}
        <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Trilhas</p>
          </div>
          <div className="divide-y divide-slate-50">
            {trilhas.map(t => {
              const qtd = etapas.filter(e => e.trilha === t.slug && e.ativo).length;
              const sel = t.slug === slugAtual;
              return (
                <button
                  key={t.slug}
                  onClick={() => setSlugAtual(t.slug)}
                  className={`w-full text-left px-4 py-3 transition-colors ${sel ? 'bg-[#1B263B]' : 'hover:bg-slate-50'}`}
                >
                  <p className={`font-black text-sm leading-tight ${sel ? 'text-white' : 'text-slate-800'}`}>{t.nome}</p>
                  <p className={`text-[11px] mt-0.5 font-semibold ${sel ? 'text-[#C69C6D]' : 'text-slate-400'}`}>
                    {qtd} e-mail{qtd === 1 ? '' : 's'}{!t.ativo && ' · desativada'}
                  </p>
                </button>
              );
            })}
            {!trilhas.length && (
              <p className="px-4 py-6 text-center text-xs font-bold text-slate-300">Nenhuma trilha ainda</p>
            )}
          </div>
        </div>

        {/* Editor */}
        {!trilha ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center">
            <Mail size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="font-black text-slate-400 text-sm">Escolha uma trilha à esquerda</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Dados da trilha */}
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-black text-slate-800">Identificação</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">código: {trilha.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={trilha.ativo} onChange={e => alterarTrilha('ativo', e.target.checked)} className="w-4 h-4 accent-[#C69C6D]" />
                    Ativa
                  </label>
                  <button onClick={salvarTrilha} disabled={salvando}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl font-bold text-sm disabled:opacity-50">
                    <Save size={14} /> Salvar
                  </button>
                  <button onClick={excluirTrilha} disabled={salvando}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-xl" title="Excluir trilha">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo label="Nome">
                  <input className={inputCls} value={trilha.nome} onChange={e => alterarTrilha('nome', e.target.value)} />
                </Campo>
                <Campo label="Descrição" dica="Só aparece no hub, para você lembrar a quem essa trilha se destina.">
                  <input className={inputCls} value={trilha.descricao ?? ''} onChange={e => alterarTrilha('descricao', e.target.value)} />
                </Campo>
                <Campo label="Chapéu do e-mail" dica='Texto pequeno acima do logo. Ex: "Seguro Garantia".'>
                  <input className={inputCls} value={trilha.eyebrow} onChange={e => alterarTrilha('eyebrow', e.target.value)} />
                </Campo>
                <Campo label="Rodapé" dica="Frase de justificativa de envio, no pé de todos os e-mails da trilha.">
                  <input className={inputCls} value={trilha.rodape} onChange={e => alterarTrilha('rodape', e.target.value)} />
                </Campo>
              </div>
            </div>

            {/* Etapas */}
            <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-black text-slate-800">Sequência de e-mails</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Use <code className="font-mono text-[#C69C6D]">[NOME_CONTATO]</code> e <code className="font-mono text-[#C69C6D]">[NOME_EMPRESA]</code> em qualquer campo.
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Arraste pela alça <GripVertical size={12} className="inline text-slate-300 -mt-0.5" /> para mudar a posição. Os dias ficam presos às posições, então a cadência continua crescente.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={enviarTeste} disabled={enviandoTeste || !etapasDaTrilha.length}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm disabled:opacity-50">
                    {enviandoTeste ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Enviar teste para mim
                  </button>
                  <button onClick={criarEtapa} disabled={salvando}
                    className="flex items-center gap-2 px-4 py-2 bg-[#C69C6D] hover:bg-[#b8895a] text-white rounded-xl font-bold text-sm disabled:opacity-50">
                    <Plus size={14} /> Novo e-mail
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {etapasDaTrilha.map(etapa => {
                  const aberta = !!abertas[etapa.id];
                  const arrastando = arrastandoId === etapa.id;
                  const alvo = sobreId === etapa.id && !arrastando;
                  return (
                    <div key={etapa.id}
                      draggable
                      onDragStart={ev => { setArrastandoId(etapa.id); ev.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setArrastandoId(null); setSobreId(null); }}
                      onDragOver={ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; setSobreId(etapa.id); }}
                      onDragLeave={() => setSobreId(prev => prev === etapa.id ? null : prev)}
                      onDrop={ev => { ev.preventDefault(); soltarEm(etapa.id); }}
                      className={`transition-all ${arrastando ? 'opacity-40' : ''} ${alvo ? 'ring-2 ring-[#C69C6D]/40 ring-inset bg-[#C69C6D]/5' : ''}`}
                    >
                      <div className="w-full flex items-center gap-2 px-4 py-4 hover:bg-slate-50/60">
                        <GripVertical
                          size={16}
                          className="text-slate-300 hover:text-[#C69C6D] shrink-0 cursor-grab active:cursor-grabbing"
                        />
                        <button
                          onClick={() => setAbertas(prev => ({ ...prev, [etapa.id]: !aberta }))}
                          className="flex items-center gap-3 text-left flex-1 min-w-0"
                        >
                          {aberta ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                          <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-full shrink-0">
                            {etapa.ordem}º
                          </span>
                          <span className="text-[10px] font-black text-[#C69C6D] bg-[#C69C6D]/10 px-2 py-1 rounded-full shrink-0">
                            D+{etapa.dia}
                          </span>
                          <span className="font-bold text-slate-700 text-sm truncate flex-1">{etapa.assunto}</span>
                          {!etapa.ativo && <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">Desativado</span>}
                        </button>
                      </div>

                      {aberta && (
                        <div className="px-6 pb-6 space-y-4 bg-slate-50/40">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <Campo label="Ordem" dica="Ou arraste o e-mail pela alça, ali em cima.">
                              <input type="number" min={1} className={inputCls} value={etapa.ordem}
                                onChange={e => alterarEtapa(etapa.id, 'ordem', Number(e.target.value))} />
                            </Campo>
                            <Campo label="Dia (D+)">
                              <input type="number" min={0} className={inputCls} value={etapa.dia}
                                onChange={e => alterarEtapa(etapa.id, 'dia', Number(e.target.value))} />
                            </Campo>
                            <div className="col-span-2 flex items-end pb-1">
                              <label className="flex items-center gap-2 text-sm font-bold text-slate-600 cursor-pointer">
                                <input type="checkbox" checked={etapa.ativo} className="w-4 h-4 accent-[#C69C6D]"
                                  onChange={e => alterarEtapa(etapa.id, 'ativo', e.target.checked)} />
                                E-mail ativo na cadência
                              </label>
                            </div>
                          </div>

                          <Campo label="Assunto">
                            <input className={inputCls} value={etapa.assunto}
                              onChange={e => alterarEtapa(etapa.id, 'assunto', e.target.value)} />
                          </Campo>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Campo label="Tagline" dica="Linha fina em maiúsculas entre filetes dourados. Deixe vazio para não mostrar.">
                              <input className={inputCls} value={etapa.tagline ?? ''}
                                onChange={e => alterarEtapa(etapa.id, 'tagline', e.target.value)} />
                            </Campo>
                            <Campo label="Título">
                              <input className={inputCls} value={etapa.titulo ?? ''}
                                onChange={e => alterarEtapa(etapa.id, 'titulo', e.target.value)} />
                            </Campo>
                          </div>

                          <Campo
                            label="Corpo"
                            dica='Escreva cada parágrafo assim: <p style="{{P}}">texto do parágrafo</p> — e troque {{P}} por {{PF}} no último, que tem espaço maior antes do botão.'
                          >
                            <textarea rows={10} className={`${inputCls} font-mono text-xs leading-relaxed`}
                              value={etapa.corpo_html ?? ''}
                              onChange={e => alterarEtapa(etapa.id, 'corpo_html', e.target.value)} />
                          </Campo>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Campo label="Texto do botão" dica="Vazio = e-mail sem botão.">
                              <input className={inputCls} value={etapa.cta_texto ?? ''}
                                onChange={e => alterarEtapa(etapa.id, 'cta_texto', e.target.value)} />
                            </Campo>
                            <Campo label="Link do botão" dica="Vazio = WhatsApp da F&G.">
                              <input className={inputCls} value={etapa.cta_link ?? ''}
                                onChange={e => alterarEtapa(etapa.id, 'cta_link', e.target.value)} />
                            </Campo>
                          </div>

                          <div className="flex gap-2 flex-wrap pt-1">
                            <button onClick={() => salvarEtapa(etapa)} disabled={salvando}
                              className="flex items-center gap-2 px-4 py-2 bg-[#1B263B] hover:bg-[#243447] text-white rounded-xl font-bold text-sm disabled:opacity-50">
                              <Save size={14} /> Salvar
                            </button>
                            <button onClick={() => visualizar(etapa)} disabled={carregandoPreview === etapa.id}
                              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm disabled:opacity-50">
                              {carregandoPreview === etapa.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                              Salvar e visualizar
                            </button>
                            <button onClick={() => excluirEtapa(etapa)} disabled={salvando}
                              className="ml-auto p-2 text-red-500 hover:bg-red-50 rounded-xl" title="Excluir e-mail">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!etapasDaTrilha.length && (
                  <p className="px-6 py-10 text-center text-xs font-bold text-slate-300">
                    Nenhum e-mail nesta trilha. Clique em "Novo e-mail".
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal nova trilha */}
      {novaTrilha && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-800 text-lg">Nova Trilha</h3>
                <p className="text-sm text-slate-500 mt-0.5">Ela nasce desativada — ligue quando os e-mails estiverem prontos.</p>
              </div>
              <button onClick={() => setNovaTrilha(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <Campo label="Nome" dica={novaTrilha.nome ? `código: ${gerarSlug(novaTrilha.nome)}` : 'Ex: Seguro Garantia Judicial'}>
                <input autoFocus className={inputCls} value={novaTrilha.nome}
                  onChange={e => setNovaTrilha({ ...novaTrilha, nome: e.target.value })} />
              </Campo>
              <Campo label="Descrição">
                <input className={inputCls} value={novaTrilha.descricao}
                  onChange={e => setNovaTrilha({ ...novaTrilha, descricao: e.target.value })} />
              </Campo>
              <Campo label="Chapéu do e-mail">
                <input className={inputCls} value={novaTrilha.eyebrow}
                  onChange={e => setNovaTrilha({ ...novaTrilha, eyebrow: e.target.value })} />
              </Campo>
              <Campo label="Rodapé">
                <input className={inputCls} value={novaTrilha.rodape}
                  onChange={e => setNovaTrilha({ ...novaTrilha, rodape: e.target.value })} />
              </Campo>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={criarTrilha} disabled={salvando || !novaTrilha.nome.trim()}
                className="flex-1 py-3 bg-[#C69C6D] hover:bg-[#b8895a] disabled:opacity-50 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2">
                {salvando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Criar
              </button>
              <button onClick={() => setNovaTrilha(null)} className="py-3 px-5 bg-slate-100 text-slate-600 font-black text-sm rounded-xl">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[1.5rem] shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Assunto</p>
                <p className="font-bold text-slate-800 text-sm truncate">{preview.assunto}</p>
              </div>
              <button onClick={() => setPreview(null)} className="p-2 hover:bg-slate-100 rounded-xl shrink-0">
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <iframe
              title="Pré-visualização do e-mail"
              srcDoc={preview.html}
              sandbox=""
              className="flex-1 w-full border-0 bg-[#EDEAE4]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
