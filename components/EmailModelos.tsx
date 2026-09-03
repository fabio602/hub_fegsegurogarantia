/**
 * Editor dos modelos do Follow-up de E-mail.
 *
 * Mesma divisão das trilhas de prospecção: o molde visual da F&G (cartão
 * branco, logo, cores, rodapé) mora na Edge Function `email-followup`, num
 * lugar só, para nenhum e-mail sair com cara diferente. O que muda de e-mail
 * para e-mail (assunto, título, corpo, botão) mora aqui, no banco.
 *
 * Mudar um texto = editar e salvar. Não precisa mexer em código nem publicar.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Eye, X, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import ModalPortal from './ModalPortal.tsx';

interface Modelo {
  chave: string;
  nome: string;
  descricao: string | null;
  assunto: string;
  titulo: string | null;
  corpo_html: string;
  cta_texto: string | null;
  cta_link: string | null;
  ativo: boolean;
  ordem: number;
}

/** O que a função troca no texto, por modelo. A dica é o que aparece na tela. */
const VARIAVEIS: Record<string, { nome: string; dica: string }[]> = {
  renewal: [
    { nome: '[NOME]', dica: 'nome de quem recebe' },
    { nome: '[PRODUTO]', dica: 'produto da apólice' },
    { nome: '[VENCIMENTO]', dica: 'data, em dd/mm/aaaa' },
    { nome: '[DIAS]', dica: 'já vem escrito: "12 dias"' },
    { nome: '[EMOJI]', dica: 'semáforo do prazo' },
    { nome: '[SEGURADORA]', dica: 'entre parênteses; some se não houver' },
    { nome: '[PRODUTO_URL]', dica: 'o produto, para usar dentro do link' },
  ],
  prospect_intro: [
    { nome: '[NOME]', dica: 'nome de quem recebe' },
    { nome: '[EMPRESA]', dica: 'empresa; vira "sua empresa" se vazio' },
  ],
  prospect_followup: [
    { nome: '[NOME]', dica: 'nome de quem recebe' },
    { nome: '[EMPRESA]', dica: 'empresa; vira "sua empresa" se vazio' },
  ],
};

/** Dados de exemplo da prévia. Nunca sai daqui: a prévia não envia nada. */
function payloadExemplo(chave: string) {
  if (chave === 'renewal') {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return {
      type: 'renewal',
      toName: 'João Silva',
      produto: 'Seguro Garantia',
      vencimento: d.toISOString().slice(0, 10),
      daysLeft: 15,
      seguradora: 'Junto Seguros',
      preview: true,
    };
  }
  return {
    type: 'prospect',
    toName: 'João Silva',
    company: 'Construtora Exemplo Ltda',
    template: chave === 'prospect_intro' ? 'intro' : 'followup',
    preview: true,
  };
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-gold text-slate-800 bg-slate-50';

// Fica FORA do componente de propósito: declarado dentro, o React recria o tipo
// a cada render, desmonta o input e o campo perde o foco a cada tecla.
const Campo = ({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">{label}</label>
    {children}
    {dica && <p className="text-[10px] text-slate-400 mt-1 leading-snug">{dica}</p>}
  </div>
);

export default function EmailModelos() {
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [chaveAtual, setChaveAtual] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);

  const notificar = (tipo: 'ok' | 'erro', texto: string) => {
    setAviso({ tipo, texto });
    setTimeout(() => setAviso(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('email_modelos').select('*').order('ordem');
    setLoading(false);
    if (error) return notificar('erro', 'Erro ao carregar os modelos: ' + error.message);
    const lista = (data ?? []) as Modelo[];
    setModelos(lista);
    setChaveAtual(prev => prev ?? lista[0]?.chave ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const modelo = modelos.find(m => m.chave === chaveAtual) ?? null;

  const alterar = (campo: keyof Modelo, valor: any) => {
    setModelos(prev => prev.map(m => m.chave === chaveAtual ? { ...m, [campo]: valor } : m));
  };

  const salvar = async (): Promise<boolean> => {
    if (!modelo) return false;
    if (!modelo.assunto.trim()) { notificar('erro', 'O assunto não pode ficar vazio.'); return false; }
    if (!modelo.corpo_html.trim()) { notificar('erro', 'O corpo não pode ficar vazio.'); return false; }

    setSalvando(true);
    const { error } = await supabase.from('email_modelos').update({
      assunto: modelo.assunto.trim(),
      titulo: modelo.titulo?.trim() || null,
      corpo_html: modelo.corpo_html.trim(),
      cta_texto: modelo.cta_texto?.trim() || null,
      cta_link: modelo.cta_link?.trim() || null,
      ativo: modelo.ativo,
      updated_at: new Date().toISOString(),
    }).eq('chave', modelo.chave);
    setSalvando(false);
    if (error) { notificar('erro', 'Erro ao salvar: ' + error.message); return false; }
    notificar('ok', `"${modelo.nome}" salvo. O próximo envio já sai com o texto novo.`);
    return true;
  };

  /** Salva e pede o e-mail montado à própria função: é o que o cliente receberia. */
  const visualizar = async () => {
    if (!modelo) return;
    setCarregandoPreview(true);
    const salvou = await salvar();
    if (!salvou) { setCarregandoPreview(false); return; }
    const { data, error } = await supabase.functions.invoke('email-followup', { body: payloadExemplo(modelo.chave) });
    setCarregandoPreview(false);
    if (error || !data?.success || !data?.html) return notificar('erro', data?.error || 'Não consegui montar a prévia.');
    setPreview({ subject: data.subject, html: data.html });
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={22} className="text-gold animate-spin" /></div>;
  }

  if (!modelos.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
        <FileText size={28} className="text-slate-300 mx-auto mb-3" />
        <p className="font-bold text-slate-500 text-sm">Nenhum modelo cadastrado</p>
        <p className="text-xs text-slate-400 mt-1">Aplique a migração 043 no banco para liberar a edição por aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {aviso && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold ${
          aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}>
          {aviso.tipo === 'ok' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {aviso.texto}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
        {/* Lista */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Modelos</p>
          </div>
          <div className="divide-y divide-slate-50">
            {modelos.map(m => {
              const sel = m.chave === chaveAtual;
              return (
                <button
                  key={m.chave}
                  onClick={() => setChaveAtual(m.chave)}
                  className={sel ? 'w-full text-left px-4 py-2.5 bg-navy' : 'w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors'}
                >
                  <p className={sel ? 'font-bold text-xs text-white leading-tight' : 'font-bold text-xs text-slate-800 leading-tight'}>{m.nome}</p>
                  <p className={sel ? 'text-[10px] mt-0.5 text-gold font-semibold' : 'text-[10px] mt-0.5 text-slate-400 font-semibold'}>
                    {m.chave === 'renewal' ? 'aba Vencimentos' : 'aba Prospectos'}{!m.ativo && ' · desativado'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        {!modelo ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
            <FileText size={28} className="text-slate-300 mx-auto mb-3" />
            <p className="font-bold text-slate-400 text-sm">Escolha um modelo à esquerda</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-bold text-slate-800 text-sm">{modelo.nome}</h3>
                {modelo.descricao && <p className="text-[11px] text-slate-400 mt-0.5">{modelo.descricao}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={visualizar}
                  disabled={carregandoPreview || salvando}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs disabled:opacity-40 hover:border-gold hover:text-navy transition-colors"
                >
                  {carregandoPreview ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Prévia
                </button>
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-gold font-bold text-xs disabled:opacity-40 hover:bg-navy-light transition-colors"
                >
                  {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar
                </button>
              </div>
            </div>

            {/* Variáveis */}
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                Trocadas na hora do envio
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {(VARIAVEIS[modelo.chave] ?? []).map(v => (
                  <span key={v.nome} className="text-[11px] text-slate-500">
                    <code className="font-mono font-bold text-gold-dark">{v.nome}</code> {v.dica}
                  </span>
                ))}
              </div>
            </div>

            <Campo label="Assunto">
              <input className={inputCls} value={modelo.assunto} onChange={e => alterar('assunto', e.target.value)} />
            </Campo>

            <Campo label="Título" dica="Linha grande no topo do cartão. Deixe vazio para não mostrar título.">
              <input className={inputCls} value={modelo.titulo ?? ''} onChange={e => alterar('titulo', e.target.value)} />
            </Campo>

            <Campo
              label="Corpo"
              dica='Cada parágrafo entre <p> e </p>. Para a faixa dourada use <div class="highlight">, para a azul <div class="info">.'
            >
              <textarea
                className={inputCls + ' font-mono leading-relaxed resize-y'}
                rows={14}
                value={modelo.corpo_html}
                onChange={e => alterar('corpo_html', e.target.value)}
              />
            </Campo>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Campo label="Texto do botão" dica="Vazio esconde o botão.">
                <input className={inputCls} value={modelo.cta_texto ?? ''} onChange={e => alterar('cta_texto', e.target.value)} />
              </Campo>
              <Campo label="Link do botão">
                <input className={inputCls} value={modelo.cta_link ?? ''} onChange={e => alterar('cta_link', e.target.value)} />
              </Campo>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer pt-1">
              <input type="checkbox" checked={modelo.ativo} onChange={e => alterar('ativo', e.target.checked)} className="w-4 h-4 accent-gold" />
              Modelo ativo
              <span className="font-semibold text-slate-400">(desativado, o envio volta ao texto original do sistema)</span>
            </label>
          </div>
        )}
      </div>

      {/* Prévia */}
      {preview && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 backdrop-blur-sm p-4 animate-in fade-in duration-150"
            onClick={() => setPreview(null)}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-xl animate-in zoom-in-95 duration-150"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Eye size={13} className="text-gold shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Prévia com dados de exemplo</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    Assunto: <span className="font-bold text-slate-700">{preview.subject}</span>
                  </p>
                </div>
                <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-navy transition-colors shrink-0" title="Fechar">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-auto bg-slate-50">
                {/* sandbox vazio: o HTML do e-mail é renderizado sem executar script algum */}
                <iframe title="Prévia do e-mail" sandbox="" srcDoc={preview.html} className="w-full h-[56vh] border-0 bg-white" />
              </div>

              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-400">Nada foi enviado. Os nomes acima são só exemplo.</p>
                <button
                  onClick={() => setPreview(null)}
                  className="text-xs font-bold px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:border-slate-300 transition-colors shrink-0"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
