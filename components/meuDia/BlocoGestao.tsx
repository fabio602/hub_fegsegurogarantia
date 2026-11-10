import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { META_PADRAO } from '../../lib/metaComissao.ts';
import { hojeBrt, primeiroDiaDoMes, ultimoDiaDoMes, diasUteisRestantesNoMes } from '../../supabase/functions/_shared/diasUteis';
import { formatCurrency, parseNumber } from '../../utils/formatters';

/**
 * "Meu dia", bloco de Gestão: comissão do mês contra a meta.
 *
 * Mesma conta da tela Meta de Comissão: soma a comissão das vendas com
 * vendeu = 'Sim' e data dentro do mês; a meta é a do mês em metas_comissao
 * ou a última anterior; sem nenhuma gravada, vale o padrão da tela.
 */
const BlocoGestao: React.FC<{ onAbrir: (view: string) => void }> = ({ onAbrir }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [acumulado, setAcumulado] = useState(0);
  const [vendas, setVendas] = useState(0);
  const [meta, setMeta] = useState(META_PADRAO);
  const [metaGravada, setMetaGravada] = useState(false);
  const hoje = hojeBrt();
  const inicio = primeiroDiaDoMes(hoje);
  const fim = ultimoDiaDoMes(hoje);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [v, m] = await Promise.all([
          supabase.from('sales').select('id, data, comissao').eq('vendeu', 'Sim').gte('data', inicio).lte('data', fim),
          supabase.from('metas_comissao').select('mes, meta_mensal').lte('mes', inicio).order('mes', { ascending: false }).limit(1),
        ]);
        const falha = v.error || m.error;
        if (falha) throw new Error(falha.message);
        if (!vivo) return;
        const linhas = v.data || [];
        setVendas(linhas.length);
        setAcumulado(linhas.reduce((s, l) => s + parseNumber(String(l.comissao || '')), 0));
        const ultima = (m.data || [])[0];
        if (ultima && Number(ultima.meta_mensal) > 0) { setMeta(Number(ultima.meta_mensal)); setMetaGravada(true); }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [inicio, fim]);

  if (carregando) {
    return (
      <div className="flex items-center gap-3 text-slate-500 text-sm font-medium py-6">
        <Loader2 size={18} className="animate-spin" /> Carregando a meta do mês…
      </div>
    );
  }

  if (erro) {
    return (
      <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
        Não consegui carregar a meta do mês: {erro}
      </p>
    );
  }

  const progresso = meta > 0 ? acumulado / meta : 0;
  const pct = Math.round(progresso * 100);
  const falta = Math.max(0, meta - acumulado);
  const restantes = diasUteisRestantesNoMes(hoje);

  return (
    <section aria-label="Meta do mês" className="bg-white border border-linha rounded-xl overflow-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-linha">
        <div className="px-6 py-5">
          <p className="text-sm font-semibold text-slate-600">Comissão no mês</p>
          <p className="text-3xl font-extrabold tracking-tight mt-1.5">{formatCurrency(acumulado)}</p>
          <p className="text-xs text-slate-600 mt-1.5">{vendas} venda{vendas === 1 ? '' : 's'} registrada{vendas === 1 ? '' : 's'}</p>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm font-semibold text-slate-600">Meta do mês</p>
          <p className="text-3xl font-extrabold tracking-tight mt-1.5">{pct}%</p>
          <div role="img" aria-label={`${pct}% da meta atingida`} className="h-1.5 rounded-full bg-areia-escura mt-2.5">
            <div className="h-1.5 rounded-full bg-gold" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm font-semibold text-slate-600">Falta para a meta</p>
          <p className="text-3xl font-extrabold tracking-tight mt-1.5">{formatCurrency(falta)}</p>
          <p className="text-xs text-slate-600 mt-1.5">
            Meta de {formatCurrency(meta)}{metaGravada ? '' : ' (padrão, nenhuma meta gravada)'}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm font-semibold text-slate-600">Dias úteis restantes</p>
          <p className="text-3xl font-extrabold tracking-tight mt-1.5">{restantes}</p>
          <button onClick={() => onAbrir('meta-comissao')} className="text-xs font-bold underline underline-offset-4 hover:text-gold-dark mt-1.5">
            Abrir Meta de Comissão
          </button>
        </div>
      </div>
    </section>
  );
};

export default BlocoGestao;
