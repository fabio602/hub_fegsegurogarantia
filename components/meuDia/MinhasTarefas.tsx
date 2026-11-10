import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hojeSaoPaulo, rotuloDia } from '../../lib/contatoLead.ts';

/**
 * "Meu dia", tarefas próprias (tabela meu_dia_tarefas, migração 141).
 *
 * Cada pessoa cria e conclui as suas. Aparecem as de hoje, as atrasadas ainda
 * abertas e as concluídas hoje. O gestor, ao abrir o dia de outra pessoa, vê
 * as tarefas dela sem poder alterar (`somenteLeitura`).
 */
interface Tarefa { id: string; titulo: string; dia: string; concluida_em: string | null; created_at: string }

interface MinhasTarefasProps {
  email: string;
  somenteLeitura: boolean;
}

const diaSP = (ts: string): string => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const MinhasTarefas: React.FC<MinhasTarefasProps> = ({ email, somenteLeitura }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [titulo, setTitulo] = useState('');
  const hoje = hojeSaoPaulo();
  const [dia, setDia] = useState(hoje);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      setErro(null);
      const { data, error } = await supabase.from('meu_dia_tarefas')
        .select('id, titulo, dia, concluida_em, created_at')
        .eq('user_email', email)
        .order('dia', { ascending: true })
        .order('created_at', { ascending: true });
      if (!vivo) return;
      if (error) setErro(error.message);
      else setTarefas((data || []) as Tarefa[]);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [email]);

  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    const texto = titulo.trim();
    if (!texto || salvando) return;
    setSalvando(true);
    setErro(null);
    const { data, error } = await supabase.from('meu_dia_tarefas')
      .insert({ user_email: email, titulo: texto.slice(0, 300), dia: dia || hoje })
      .select('id, titulo, dia, concluida_em, created_at')
      .single();
    setSalvando(false);
    if (error || !data) { setErro(error?.message || 'Não consegui salvar a tarefa.'); return; }
    setTarefas(t => [...t, data as Tarefa]);
    setTitulo('');
    setDia(hoje);
  };

  const alternar = async (t: Tarefa) => {
    const concluida_em = t.concluida_em ? null : new Date().toISOString();
    setTarefas(lista => lista.map(x => (x.id === t.id ? { ...x, concluida_em } : x)));
    const { error } = await supabase.from('meu_dia_tarefas').update({ concluida_em }).eq('id', t.id);
    if (error) {
      setErro(error.message);
      setTarefas(lista => lista.map(x => (x.id === t.id ? { ...x, concluida_em: t.concluida_em } : x)));
    }
  };

  const apagar = async (t: Tarefa) => {
    const antes = tarefas;
    setTarefas(lista => lista.filter(x => x.id !== t.id));
    const { error } = await supabase.from('meu_dia_tarefas').delete().eq('id', t.id);
    if (error) { setErro(error.message); setTarefas(antes); }
  };

  // De hoje e atrasadas ainda abertas, mais as que foram concluídas hoje.
  const visiveis = tarefas.filter(t => (t.concluida_em ? diaSP(t.concluida_em) === hoje : t.dia <= hoje));
  const futuras = tarefas.filter(t => !t.concluida_em && t.dia > hoje);
  const abertas = visiveis.filter(t => !t.concluida_em).length;

  // Dia de outra pessoa sem nenhuma tarefa: não ocupa espaço.
  if (somenteLeitura && !carregando && visiveis.length === 0 && futuras.length === 0) return null;

  return (
    <section aria-label="Minhas tarefas" className="bg-white border border-linha rounded-xl p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-extrabold">{somenteLeitura ? 'Tarefas próprias' : 'Minhas tarefas'}</h2>
        <p className="text-sm text-slate-600">
          {carregando ? '' : abertas ? `${abertas} aberta${abertas === 1 ? '' : 's'} para hoje` : 'Nenhuma aberta para hoje'}
          {futuras.length ? ` · ${futuras.length} agendada${futuras.length === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {!somenteLeitura && (
        <form onSubmit={adicionar} className="flex flex-wrap items-end gap-3 mt-4">
          <label className="flex-1 min-w-[240px] text-xs font-semibold text-slate-600">
            Nova tarefa
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={300}
              placeholder="Ex.: ligar para o contador do cliente às 15h"
              className="mt-1 w-full px-3.5 py-2.5 border border-linha rounded-lg text-sm font-medium text-navy outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Para o dia
            <input
              type="date"
              value={dia}
              min={hoje}
              onChange={(e) => setDia(e.target.value)}
              className="mt-1 block px-3 py-2.5 border border-linha rounded-lg text-sm font-semibold text-navy outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            />
          </label>
          <button
            type="submit"
            disabled={!titulo.trim() || salvando}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-navy text-white text-sm font-bold rounded-lg hover:bg-navy-light disabled:opacity-50 transition-colors"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
            Adicionar
          </button>
        </form>
      )}

      {erro && (
        <p role="alert" className="mt-3 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5">
          {erro}
        </p>
      )}

      {visiveis.length > 0 && (
        <ul className="mt-4 border-t border-linha">
          {visiveis.map(t => {
            const feita = !!t.concluida_em;
            const atrasada = !feita && t.dia < hoje;
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5 border-b border-linha">
                <button
                  type="button"
                  onClick={() => alternar(t)}
                  disabled={somenteLeitura}
                  aria-pressed={feita}
                  aria-label={feita ? `Reabrir: ${t.titulo}` : `Concluir: ${t.titulo}`}
                  className={`inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg border transition-colors disabled:cursor-default ${
                    feita ? 'bg-navy border-navy text-white' : 'bg-white border-slate-300 text-transparent hover:border-navy'
                  }`}
                >
                  <Check size={16} aria-hidden="true" />
                </button>
                <p className={`flex-1 min-w-0 text-base ${feita ? 'line-through text-slate-500' : 'font-semibold'}`}>{t.titulo}</p>
                {atrasada && <span className="text-xs font-bold px-2 py-1 rounded-md bg-amber-100 text-amber-900 whitespace-nowrap">Desde {rotuloDia(t.dia)}</span>}
                {!somenteLeitura && (
                  <button
                    type="button"
                    onClick={() => apagar(t)}
                    aria-label={`Apagar: ${t.titulo}`}
                    title="Apagar"
                    className="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {futuras.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          Agendadas: {futuras.slice(0, 4).map(t => `${t.titulo} (${rotuloDia(t.dia)})`).join(' · ')}{futuras.length > 4 ? ` e mais ${futuras.length - 4}` : ''}
        </p>
      )}
    </section>
  );
};

export default MinhasTarefas;
