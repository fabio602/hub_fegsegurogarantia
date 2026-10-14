/**
 * Valor estimado montado a partir da TABELA de itens, para editais que não escrevem o total.
 *
 * Variação comum: o Termo de Referência traz "ITEM | DESCRIÇÃO | UND | QTD | V. UNIT | V. TOTAL",
 * mas a coluna de total vem em branco, ou só existe o valor unitário. Às vezes o unitário é
 * mensal e o cabeçalho diz por quantos meses ("V. UNIT/MÊS", "V. TOTAL (12 MESES)").
 *
 * Só entra quando a regra de rótulos (valor.ts) não achou nada, e só soma uma tabela que:
 *  - fica logo depois de um rótulo de estimativa ("custo estimado", "estimativa do valor"…);
 *  - tem cabeçalho com coluna de valor unitário;
 *  - tem linhas no formato "unidade quantidade R$ unitário [R$ total]".
 * Se o unitário é mensal e o cabeçalho não diz o número de meses, não multiplica por
 * conta própria: devolve só o mensal, e o chamador deixa o campo vazio com um aviso.
 * O resultado é um CÁLCULO, não um número escrito no edital; o chamador avisa isso na tela.
 */
import { Documento, ocorrencias, paginaDe, trecho } from '../documento.ts';
import { arredondar2, parseBRL } from '../numeros.ts';
import type { Evidencia } from '../../editalSchema.ts';

export interface ItemTabela { numero: number; quantidade: number; unitario: number; total: number; temTotal: boolean; pagina: number; inicio: number }

export interface ResultadoTabela {
  itens: ItemTabela[];
  /** Soma das linhas (já com a quantidade), na unidade de tempo da tabela */
  soma: number;
  /** Meses pelos quais o unitário é multiplicado (null = unitário não é mensal) */
  meses: number | null;
  /** Unitário é mensal mas o cabeçalho não diz por quantos meses */
  mensalSemPrazo: boolean;
  /** Valor final (soma × meses), ou null quando falta o prazo */
  valor: number | null;
  evidencia: Evidencia;
}

const RE_ROTULO_ESTIMATIVA =
  /estimativas?\s+d[oe]s?\s+(?:valor|preco|custo)|(?:custo|valor|preco)\s+(?:total\s+)?estimad[oa]|orcamento\s+(?:estimado|de\s+referencia)|pesquisa\s+de\s+precos|planilha\s+(?:de\s+)?(?:custos|precos|orcamentaria)|precos?\s+de\s+referencia/g;

const RE_CABECALHO_UNIT = /(?:v(?:alor|lr|l)?\.?|preco|custo)\s*(?:\w+\s+)?unit/;

/** Unidades de fornecimento que aparecem na coluna UND. */
const UNIDADES =
  'und|unid|unidade|un|mes|meses|mensal|servico|serv|sv|diaria|diarias|km|kg|g|l|lt|litro|litros|ml|cx|caixa|pct|pacote|par|m|m2|m²|m3|m³|metro|metros|hora|horas|h|vb|verba|kit|jogo|rolo|fardo|frasco|galao|resma|dz|duzia|ton|t|gl|global|ano|anual|sc|saco|pc|peca|lata|balde|bloco|cento|milheiro|resma|tubo|unidades';

const NUM = '\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,3})?';
const MOEDA = '\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
const RE_LINHA = new RegExp(`(?:^|[\\s(])(?:${UNIDADES})\\.?\\s+(${NUM})\\s+(?:r\\$\\s*)?(${MOEDA})(?:\\s+(?:r\\$\\s*)?(${MOEDA}))?(?!\\d)`, 'g');

const numBR = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export function extrairValorDaTabela(doc: Documento): ResultadoTabela | null {
  const candidatos: ResultadoTabela[] = [];

  for (const ancora of ocorrencias(doc, RE_ROTULO_ESTIMATIVA)) {
    // Cabeçalho da tabela: até ~700 caracteres depois do rótulo
    const janela = doc.busca.slice(ancora.index, ancora.index + 700);
    const cab = RE_CABECALHO_UNIT.exec(janela);
    if (!cab) continue;
    const iniCab = ancora.index + cab.index;

    // Fim da tabela: próximo item numerado de outra cláusula ("14.2.") ou 20 mil caracteres
    let fim = Math.min(doc.busca.length, iniCab + 20000);
    const prox = /\n\s*\d{1,2}\.\d{1,2}\.\s+[a-z]/.exec(doc.busca.slice(iniCab + 20, fim));
    if (prox) fim = iniCab + 20 + prox.index;

    const itens: ItemTabela[] = [];
    for (const m of ocorrencias(doc, RE_LINHA, iniCab, fim)) {
      const quantidade = numBR(m[1]);
      const unitario = parseBRL(m[2]);
      const totalLinha = m[3] ? parseBRL(m[3]) : null;
      if (unitario == null || quantidade <= 0 || quantidade > 1e7) continue;
      const calculado = arredondar2(quantidade * unitario);
      // Com coluna de total preenchida, ela precisa fechar com qtd × unitário (senão não é essa tabela)
      if (totalLinha != null && Math.abs(totalLinha - calculado) > Math.max(0.05, calculado * 0.001)) {
        // pode ser total de N meses: aceita se for múltiplo inteiro do calculado
        const k = totalLinha / calculado;
        if (!(Math.abs(k - Math.round(k)) < 0.001 && k >= 2 && k <= 60)) continue;
      }
      itens.push({ numero: itens.length + 1, quantidade, unitario, total: totalLinha ?? calculado, temTotal: totalLinha != null, pagina: paginaDe(doc, m.index), inicio: m.index });
    }
    if (!itens.length) continue;

    // Coluna de total preenchida em todas as linhas: soma os totais, sem multiplicar nada.
    // Preenchida só em parte: tabela ambígua, não soma.
    const comTotal = itens.filter(i => i.temTotal).length;
    if (comTotal && comTotal < itens.length) continue;

    // Cabeçalho: do rótulo da coluna unitária até a primeira linha de item
    const primeira = itens[0].inicio;
    const cabecalho = doc.busca.slice(Math.max(ancora.index, iniCab - 120), Math.min(primeira, iniCab + 250));
    const mensal = /\/\s*mes|por\s+mes|mensal/.test(cabecalho);
    const mesesCab = /(\d{1,2})\s*(?:\(\s*[a-z]+\s*\)\s*)?mes(?:es)?\b/.exec(cabecalho);
    let meses: number | null = null;
    let mensalSemPrazo = false;
    if (mensal && !comTotal) {
      const n = mesesCab ? Number(mesesCab[1]) : NaN;
      if (n >= 1 && n <= 60) meses = n; else mensalSemPrazo = true;
    }
    const soma = arredondar2(itens.reduce((s, i) => s + i.total, 0));
    const valor = mensalSemPrazo ? null : arredondar2(soma * (meses ?? 1));
    candidatos.push({
      itens, soma, meses, mensalSemPrazo, valor,
      evidencia: { trecho: trecho(doc, ancora.index, iniCab + 40, 180), pagina: paginaDe(doc, ancora.index) },
    });
  }
  if (!candidatos.length) return null;
  // Mais itens primeiro (a tabela completa, não um resumo de uma linha)
  candidatos.sort((a, b) => b.itens.length - a.itens.length);
  return candidatos[0];
}
