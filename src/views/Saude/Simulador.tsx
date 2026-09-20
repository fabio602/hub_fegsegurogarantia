import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Printer, MessageCircle, AlertTriangle, Users, Send, Info } from 'lucide-react';
import { supabase } from '../../../lib/supabase.ts';
import { useToast } from '../../../components/Toast.tsx';
import { formatCurrency } from '../../../utils/formatters.ts';
import {
  PLANOS, LIMITE_VIDAS, totalVidas, lerIdades, descreverComposicao,
  type Adicional, type Composicao, type Cotacao, type Faixa, type PlanoId,
} from './precos.ts';
import {
  COPARTICIPACAO, CARENCIAS, AVISO_APH, EMAIL_FAVORITA,
  acomodacaoDoPlano, textoOrcamento, textoPedidoFavorita,
} from './copy.ts';

/**
 * Simulador do corretor.
 *
 * Uma tela só, de propósito: o simulador do site é guiado em passos porque
 * fala com quem não conhece o produto, este aqui fala com quem vende e
 * precisa de velocidade. Entra a composição em cima, sai a proposta embaixo,
 * pronta para imprimir em PDF ou colar no WhatsApp.
 *
 * O cálculo não acontece aqui. Cada plano é uma chamada RPC a
 * `unimed_calcular_cotacao`, que é a única fonte de verdade de preço.
 */

const HOJE = () => new Date().toISOString().slice(0, 10);

function diasAFrente(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function dataBR(iso: string): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const Simulador: React.FC = () => {
  const { toast } = useToast();

  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [adicionais, setAdicionais] = useState<Adicional[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [empresa, setEmpresa] = useState('');
  const [cidade, setCidade] = useState('');
  const [validade, setValidade] = useState(diasAFrente(7));

  const [idadesTexto, setIdadesTexto] = useState('');
  const [composicao, setComposicao] = useState<Composicao>({});
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [destaque, setDestaque] = useState<PlanoId>('max_a');

  const [cotacoes, setCotacoes] = useState<Record<string, Cotacao>>({});
  const [calculando, setCalculando] = useState(false);
  const [erroCalculo, setErroCalculo] = useState<string | null>(null);

  const vidas = totalVidas(composicao);
  const acimaDoLimite = vidas > LIMITE_VIDAS;

  /* Carga inicial: faixas e adicionais vêm do banco, nunca do código, para a
     tela não descolar da tabela vigente. */
  useEffect(() => {
    (async () => {
      const [fx, ad] = await Promise.all([
        supabase.from('unimed_precos')
          .select('faixa, faixa_ordem, idade_min, idade_max')
          .eq('tabela', '2_a_29_vidas').eq('plano', 'facil')
          .order('faixa_ordem'),
        supabase.from('unimed_adicionais')
          .select('codigo, nome, valor, padrao, descricao').order('codigo'),
      ]);
      if (fx.error) toast('Não consegui carregar as faixas etárias', 'error');
      if (ad.error) toast('Não consegui carregar os adicionais', 'error');
      const listaFaixas = (fx.data ?? []) as Faixa[];
      const listaAdicionais = (ad.data ?? []).map(a => ({ ...a, valor: Number(a.valor) })) as Adicional[];
      setFaixas(listaFaixas);
      setAdicionais(listaAdicionais);
      setSelecionados(listaAdicionais.filter(a => a.padrao).map(a => a.codigo));
      setCarregando(false);
    })();
  }, [toast]);

  /* Recalcula com atraso curto: o corretor ainda está digitando idades e não
     faz sentido bater no banco a cada tecla. */
  const calcular = useCallback(async () => {
    if (vidas < 1 || acimaDoLimite) { setCotacoes({}); setErroCalculo(null); return; }
    setCalculando(true);
    setErroCalculo(null);
    const respostas = await Promise.all(PLANOS.map(p =>
      supabase.rpc('unimed_calcular_cotacao', {
        p_plano: p.id, p_composicao: composicao, p_adicionais: selecionados,
      })
    ));
    const erro = respostas.find(r => r.error);
    if (erro?.error) {
      /* Sem cálculo local de reserva: valor divergente em proposta é pior
         que a tela dizendo que não calculou. */
      setCotacoes({});
      setErroCalculo(erro.error.message);
    } else {
      const mapa: Record<string, Cotacao> = {};
      respostas.forEach((r, i) => { mapa[PLANOS[i].id] = r.data as Cotacao; });
      setCotacoes(mapa);
    }
    setCalculando(false);
  }, [composicao, selecionados, vidas, acimaDoLimite]);

  useEffect(() => {
    const t = setTimeout(calcular, 350);
    return () => clearTimeout(t);
  }, [calcular]);

  const distribuirIdades = () => {
    if (!idadesTexto.trim()) return;
    const { composicao: nova, lidas, invalidas } = lerIdades(idadesTexto, faixas);
    setComposicao(nova);
    if (invalidas.length) {
      toast(`${lidas} idade(s) lida(s). Ignorei: ${invalidas.join(', ')}`, 'error');
    } else {
      toast(`${lidas} vida(s) distribuída(s) por faixa`, 'success');
    }
  };

  const mudarFaixa = (faixa: string, delta: number) => {
    setComposicao(prev => {
      const n = Math.max(0, (prev[faixa] ?? 0) + delta);
      const novo = { ...prev };
      if (n === 0) delete novo[faixa]; else novo[faixa] = n;
      return novo;
    });
  };

  const limpar = () => {
    setComposicao({}); setIdadesTexto(''); setCotacoes({}); setErroCalculo(null);
  };

  const alternarAdicional = (codigo: string) => {
    setSelecionados(prev => prev.includes(codigo) ? prev.filter(c => c !== codigo) : [...prev, codigo]);
  };

  const porPessoa = (c: Cotacao | undefined) => (c && c.vidas ? c.total_mensal / c.vidas : 0);

  /* O comparativo é ferramenta de venda: mostrar quanto cada plano custa a
     mais que o mais barato ajuda o cliente a decidir sem fazer conta. */
  const maisBarato = useMemo(() => {
    const totais = PLANOS.map(p => cotacoes[p.id]?.total_mensal).filter(Boolean) as number[];
    return totais.length ? Math.min(...totais) : 0;
  }, [cotacoes]);

  const acomodacao = acomodacaoDoPlano(destaque);
  const tabelaEmUso = cotacoes[destaque]?.tabela;
  const aphMarcado = selecionados.includes('aph');

  const resumoWhatsapp = useMemo(() => {
    if (Object.keys(cotacoes).length !== 3) return '';
    const totais = {
      facil: cotacoes.facil.total_mensal,
      max_a: cotacoes.max_a.total_mensal,
      max_b: cotacoes.max_b.total_mensal,
    };
    return textoOrcamento({
      empresa, composicao, faixas, vidas, totais, destaque, validade: dataBR(validade),
    });
  }, [cotacoes, empresa, composicao, faixas, vidas, destaque, validade]);

  const copiarPedidoFavorita = async () => {
    const texto = textoPedidoFavorita({
      empresa, plano: destaque, inicio: dataBR(validade), vidas,
    });
    try {
      await navigator.clipboard.writeText(texto);
      toast(`Pedido copiado. Enviar para ${EMAIL_FAVORITA}`, 'success');
    } catch {
      toast('Não consegui copiar o pedido', 'error');
    }
  };

  const copiarWhatsapp = async () => {
    try {
      await navigator.clipboard.writeText(resumoWhatsapp);
      toast('Resumo copiado, é só colar no WhatsApp', 'success');
    } catch {
      toast('Não consegui copiar. Selecione o texto da proposta e copie na mão.', 'error');
    }
  };

  if (carregando) {
    return <div className="p-6 text-navy/60">Carregando a tabela vigente...</div>;
  }

  const temResultado = vidas >= 1 && !acimaDoLimite && Object.keys(cotacoes).length === 3;

  return (
    <div className="space-y-6">

      {/* ENTRADA. Some na impressão: o cliente recebe só a proposta. */}
      <section className="print:hidden bg-white border border-linha rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 text-navy">
          <Calculator size={18} className="text-gold-dark" />
          <h2 className="font-semibold">Montar a cotação</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-navy/50">Empresa</span>
            <input value={empresa} onChange={e => setEmpresa(e.target.value)}
              placeholder="Metalúrgica Boituva"
              className="mt-1 w-full border border-linha rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold" />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-navy/50">Cidade</span>
            <input value={cidade} onChange={e => setCidade(e.target.value)}
              placeholder="Boituva"
              className="mt-1 w-full border border-linha rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold" />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-navy/50">Proposta válida até</span>
            <input type="date" value={validade} min={HOJE()} onChange={e => setValidade(e.target.value)}
              className="mt-1 w-full border border-linha rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold" />
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <label className="flex-1 block">
            <span className="text-xs uppercase tracking-wider text-navy/50">
              Idades, separadas por vírgula ou espaço
            </span>
            <input value={idadesTexto} onChange={e => setIdadesTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') distribuirIdades(); }}
              placeholder="38, 35, 9, 6, 52"
              className="mt-1 w-full border border-linha rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold" />
          </label>
          <button onClick={distribuirIdades}
            className="bg-navy text-white px-4 py-2 rounded-lg hover:bg-navy-light transition-colors">
            Distribuir por faixa
          </button>
          <button onClick={limpar}
            className="border border-linha px-4 py-2 rounded-lg text-navy/70 hover:bg-areia transition-colors">
            Limpar
          </button>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-navy/50 mb-2">
            Vidas por faixa etária, dá para ajustar na mão
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {faixas.map(f => {
              const n = composicao[f.faixa] ?? 0;
              return (
                <div key={f.faixa}
                  className={n > 0
                    ? 'border border-gold rounded-lg px-3 py-2 bg-areia-clara'
                    : 'border border-linha rounded-lg px-3 py-2'}>
                  <div className="text-xs text-navy/60">{f.faixa}</div>
                  <div className="flex items-center justify-between mt-1">
                    <button onClick={() => mudarFaixa(f.faixa, -1)} disabled={n === 0}
                      aria-label={`Menos uma vida na faixa ${f.faixa}`}
                      className="w-7 h-7 rounded border border-linha text-navy disabled:opacity-30">-</button>
                    <span className="font-semibold text-navy tabular-nums">{n}</span>
                    <button onClick={() => mudarFaixa(f.faixa, 1)}
                      aria-label={`Mais uma vida na faixa ${f.faixa}`}
                      className="w-7 h-7 rounded border border-linha text-navy">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-navy/50 mb-2">Adicionais</p>
          <div className="flex flex-wrap gap-2">
            {adicionais.map(a => {
              const ativo = selecionados.includes(a.codigo);
              return (
                <button key={a.codigo} onClick={() => alternarAdicional(a.codigo)}
                  title={a.descricao ?? undefined}
                  className={ativo
                    ? 'border border-gold bg-areia-clara text-navy rounded-full px-3 py-1 text-sm'
                    : 'border border-linha text-navy/60 rounded-full px-3 py-1 text-sm'}>
                  {a.nome} · {formatCurrency(a.valor)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {acimaDoLimite && (
        <div className="print:hidden flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-navy">
            <p className="font-semibold">{vidas} vidas: acima do limite desta tabela.</p>
            <p className="text-navy/70 mt-1">
              A partir de 30 vidas a Unimed Sorocaba exige consulta de reserva de mercado
              e carta de nomeação. Peça a cotação à Favorita Brasil em vez de simular aqui.
            </p>
          </div>
        </div>
      )}

      {erroCalculo && (
        <div className="print:hidden flex gap-3 bg-rose-50 border border-rose-200 rounded-xl p-4">
          <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="text-sm text-navy">
            <p className="font-semibold">Não consegui calcular.</p>
            <p className="text-navy/70 mt-1">{erroCalculo}</p>
          </div>
        </div>
      )}

      {calculando && !temResultado && (
        <p className="print:hidden text-navy/50 text-sm">Calculando...</p>
      )}

      {temResultado && (
        <>
          {aphMarcado && (
            <div className="print:hidden flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-navy/80">{AVISO_APH}</p>
            </div>
          )}

          {vidas === 1 && (
            <div className="print:hidden flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-navy/80">
                Com 1 vida vale a tabela individual, que é mais cara por pessoa. Incluir
                uma segunda vida, um dependente por exemplo, já muda para a tabela de 2 a 29
                e derruba o valor por pessoa. Vale simular com duas e comparar.
              </p>
            </div>
          )}

          {tabelaEmUso && (
            <p className="print:hidden flex items-center gap-2 text-xs text-navy/50">
              <Info size={13} />
              Tabela aplicada: {tabelaEmUso === '1_vida' ? '1 vida' : '2 a 29 vidas'}
            </p>
          )}

          <div className="print:hidden flex flex-wrap gap-2 justify-end">
            <button onClick={copiarPedidoFavorita}
              className="flex items-center gap-2 border border-linha px-4 py-2 rounded-lg text-navy hover:bg-areia transition-colors">
              <Send size={16} /> Copiar pedido para a Favorita
            </button>
            <button onClick={copiarWhatsapp}
              className="flex items-center gap-2 border border-linha px-4 py-2 rounded-lg text-navy hover:bg-areia transition-colors">
              <MessageCircle size={16} /> Copiar resumo para WhatsApp
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-2 bg-gold text-navy-dark font-semibold px-4 py-2 rounded-lg hover:bg-gold-hover transition-colors">
              <Printer size={16} /> Imprimir ou salvar em PDF
            </button>
          </div>

          {/* PROPOSTA. É isto que o cliente recebe. */}
          <section className="bg-white border border-linha rounded-xl p-6 md:p-8 space-y-7">
            <header className="flex flex-wrap justify-between gap-4 border-b border-linha pb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gold-dark">Proposta de plano de saúde</p>
                <h2 className="text-2xl font-bold text-navy mt-1">{empresa || 'Sua empresa'}</h2>
                <p className="text-navy/60 text-sm mt-1">
                  Unimed Sorocaba, plano empresarial{cidade ? ` · atendimento em ${cidade}` : ''}
                </p>
              </div>
              <div className="text-sm text-navy/60 text-right">
                <p>Emitida em {dataBR(HOJE())}</p>
                <p>Válida até <span className="font-semibold text-navy">{dataBR(validade)}</span></p>
              </div>
            </header>

            <div className="flex items-center gap-2 text-navy">
              <Users size={16} className="text-gold-dark" />
              <p className="text-sm">
                <span className="font-semibold">{vidas} {vidas === 1 ? 'vida' : 'vidas'}</span>
                {' · '}{descreverComposicao(composicao, faixas)}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PLANOS.map(p => {
                const c = cotacoes[p.id];
                const eDestaque = p.id === destaque;
                return (
                  <button key={p.id} onClick={() => setDestaque(p.id)}
                    className={eDestaque
                      ? 'text-left border-2 border-gold rounded-xl p-5 bg-areia-clara'
                      : 'text-left border border-linha rounded-xl p-5 hover:border-gold-dark transition-colors'}>
                    <p className="font-semibold text-navy">{p.nome}</p>
                    <p className="text-xs text-navy/60 mt-0.5">{p.acomodacao}</p>
                    <p className="text-2xl font-bold text-navy mt-3 tabular-nums">
                      {formatCurrency(c.total_mensal)}
                    </p>
                    <p className="text-xs text-navy/60">por mês, {vidas} {vidas === 1 ? 'vida' : 'vidas'}</p>
                    <p className="text-sm text-gold-dark font-semibold mt-2 tabular-nums">
                      {formatCurrency(porPessoa(c))} por pessoa
                    </p>
                    {c.total_mensal > maisBarato && (
                      <p className="text-xs text-navy/50 tabular-nums">
                        {formatCurrency(c.total_mensal - maisBarato)} a mais que o Fácil
                      </p>
                    )}
                    <p className="text-xs text-navy/60 mt-3 leading-relaxed">{p.rede}</p>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
              <div className="border border-linha rounded-xl p-4">
                <p className="text-xs uppercase tracking-wider text-gold-dark mb-2">Já começa valendo</p>
                <ul className="space-y-1 text-navy/80">
                  {CARENCIAS.map(c => (
                    <li key={c.prazo}>
                      <strong className="text-navy">{c.prazo}:</strong> {c.o_que.toLowerCase()}.
                    </li>
                  ))}
                  <li>Urgência e emergência com cobertura em todo o país.</li>
                  <li>Quem vem de outro plano pode entrar por portabilidade, com carência zero.</li>
                </ul>
              </div>
              <div className="border border-linha rounded-xl p-4">
                <p className="text-xs uppercase tracking-wider text-gold-dark mb-2">
                  Quanto custa usar, em {acomodacao}
                </p>
                <ul className="space-y-1 text-navy/80">
                  {COPARTICIPACAO.map(c => (
                    <li key={c.item}>
                      {c.item}: <strong className="text-navy tabular-nums">{formatCurrency(c[acomodacao])}</strong>
                    </li>
                  ))}
                  <li>Internação sem coparticipação, exceto psiquiátrica a partir do 31º dia.</li>
                </ul>
                <p className="text-navy/60 mt-2">Só paga quem usou, na fatura seguinte.</p>
              </div>
            </div>

            <div className="bg-areia rounded-xl p-4 text-sm text-navy">
              <p className="font-semibold">Como seguir</p>
              <p className="text-navy/70 mt-1">
                Me confirme o plano escolhido e eu envio a lista de documentos. Cada beneficiário
                recebe a proposta por e-mail e WhatsApp, faz a entrevista médica por videochamada,
                e o plano entra em vigor no dia 1, 10 ou 20.
              </p>
              <p className="mt-3 font-semibold">Fábio Lima · F&amp;G Saúde · (15) 99740-2635</p>
            </div>

            <p className="text-[11px] leading-relaxed text-navy/50 border-t border-linha pt-4">
              Valores calculados sobre a tabela vigente da Unimed de Sorocaba Cooperativa de Trabalho
              Médico, CNPJ 45.399.961/0001-59, registro ANS 34829-5, e válidos como estimativa. O valor
              definitivo é o da proposta emitida pela operadora, após análise. Coberturas, carências,
              coparticipação e rede credenciada seguem o contrato e as condições gerais registradas na
              ANS. A F&amp;G Seguro Garantia, CNPJ 56.123.874/0001-90, registro SUSEP 242160653, atua como
              corretora: a contratação, a administração e a cobertura do plano são de responsabilidade
              da operadora.
            </p>
          </section>
        </>
      )}

      {!temResultado && !acimaDoLimite && !erroCalculo && !calculando && (
        <p className="print:hidden text-navy/50 text-sm">
          Digite as idades das pessoas que entram no plano para ver a proposta.
        </p>
      )}
    </div>
  );
};

export default Simulador;
