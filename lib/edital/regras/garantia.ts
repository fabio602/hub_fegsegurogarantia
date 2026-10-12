/**
 * Garantia de proposta (art. 58 da Lei 14.133/2021): exigência, percentual,
 * base de cálculo, modalidades aceitas, vigência, termo inicial e CNPJ do beneficiário.
 *
 * Estratégia: localizar as "seções de garantia" (janelas de texto que começam numa
 * âncora como "garantia da proposta" e terminam no próximo título ou item de outro
 * capítulo) e procurar cada dado primeiro dentro delas. As armadilhas conhecidas da
 * bateria de regressão — validade da PROPOSTA (art. 59) e prazo de DEVOLUÇÃO da
 * garantia — são rejeitadas explicitamente.
 */
import { Documento, ocorrencias, paginaDe, trecho } from '../documento.ts';
import { parsePercentual, cnpjValido } from '../numeros.ts';
import type { Evidencia } from '../../editalSchema.ts';

/** Âncora forte: fala da garantia de PROPOSTA/PARTICIPAÇÃO (texto dobrado). */
export const RE_ANCORA_PROPOSTA =
  /garantia\s+(?:d[ae]|para)\s+(?:a\s+)?(?:proposta|participacao)|garantia\s+de\s+manutencao\s+da\s+proposta|garantia\s+da\s+proposta/g;

const RE_NEGACAO =
  /nao\s+(?:sera|e)\s+exigid[ao]\s+(?:a\s+)?garantia\s+(?:d[ae]|para)\s+(?:a\s+)?(?:proposta|participacao)|dispensad[ao]\s+(?:a\s+)?(?:apresentacao\s+da\s+)?garantia\s+d[ae]\s+proposta|sem\s+exigencia\s+de\s+garantia\s+de\s+proposta/g;

const RE_EXIGENCIA =
  /sera\s+exigid|e\s+exigid|exige-se|exigir-se-a|deverao\s+(?:apresentar|juntar|prestar|recolher|comprovar|providenciar)|devera\s+(?:ser\s+)?(?:apresentad|prestad|comprovad|recolhid|constituid)|requisito\s+de\s+pre-?\s*habilitacao|como\s+condicao\s+de\s+participacao/;

/** Outra garantia: execução contratual, adicional (art. 59 §5º), do contrato. */
const RE_OUTRA_GARANTIA =
  /garantia\s+(?:de\s+|da\s+)?(?:execucao|contratual|adicional)|garantia\s+do\s+contrato|garantia\s+tecnica|garantia\s+do\s+(?:produto|fabricante)/;

export interface Secao { ini: number; fim: number; ancora: number }

/** Número de item no começo de uma linha ("8.4.1.", "7.11 –", "5.") → capítulo (primeiro nível). */
function capituloDaLinha(s: string): number | null {
  const m = s.match(/^\s*(\d{1,2})(?:\.\d+)*\s*[.)–-]?\s*\S/);
  if (!m) return null;
  // "2026" de data, "14.133" de lei etc. não são itens: capítulo > 40 é descartado
  const n = Number(m[1]);
  return n >= 1 && n <= 40 ? n : null;
}

function ehTitulo(linha: string): boolean {
  const s = linha.trim();
  if (s.length < 6 || s.length > 110) return false;
  const letras = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letras.length < 5) return false;
  const maiusculas = letras.replace(/[^A-ZÀ-Þ]/g, '').length;
  return maiusculas / letras.length > 0.85 && /\s/.test(s);
}

/** Janelas de texto das cláusulas de garantia de proposta. */
export function secoesGarantia(doc: Documento): Secao[] {
  const secoes: Secao[] = [];
  for (const m of ocorrencias(doc, RE_ANCORA_PROPOSTA)) {
    const ini = m.index;
    if (secoes.some(s => ini >= s.ini && ini < s.fim)) continue;

    // Linha da âncora e capítulo de referência (linha numerada mais próxima antes ou logo depois)
    let li = doc.linhas.findIndex((l, i) => l.inicio <= ini && (doc.linhas[i + 1]?.inicio ?? Infinity) > ini);
    if (li < 0) li = 0;
    let capitulo: number | null = null;
    for (let k = li; k >= 0 && ini - doc.linhas[k].inicio < 600; k--) {
      capitulo = capituloDaLinha(doc.linhas[k].texto);
      if (capitulo != null) break;
    }
    if (capitulo == null) {
      for (let k = li + 1; k < doc.linhas.length && doc.linhas[k].inicio - ini < 250; k++) {
        capitulo = capituloDaLinha(doc.linhas[k].texto);
        if (capitulo != null) break;
      }
    }

    let fim = Math.min(doc.texto.length, ini + 2500);
    for (let k = li + 1; k < doc.linhas.length; k++) {
      const l = doc.linhas[k];
      if (l.inicio >= fim) break;
      const dob = doc.busca.slice(l.inicio, l.inicio + l.texto.length);
      const cap = capituloDaLinha(l.texto);
      const outroCapitulo = capitulo != null && cap != null && cap !== capitulo && cap === capitulo + 1;
      const tituloAlheio = ehTitulo(l.texto) && !/garantia/.test(dob);
      const outraGarantia = /^\s*(?:\d+(?:\.\d+)*\s*[.)–-]?\s*)?garantia\s+(?:adicional|de\s+execucao|contratual)/.test(dob);
      if (outroCapitulo || tituloAlheio || outraGarantia) { fim = l.inicio; break; }
    }
    secoes.push({ ini, fim, ancora: ini });
  }
  return secoes;
}

export interface ResultadoGarantia {
  exige: boolean | null;
  exigeEvidencia: Evidencia | null;
  percentual: number | null;
  percentualEvidencia: Evidencia | null;
  baseCalculo: 'global' | 'por_item' | 'por_lote' | 'nao_especificado' | null;
  modalidades: string[] | null;
  vigenciaDias: number | null;
  termoInicial: 'sessao_publica' | 'entrega_proposta' | 'emissao' | null;
  termoTrecho: string | null;
  vigenciaEvidencia: Evidencia | null;
  cnpj: string | null;
  cnpjEvidencia: Evidencia | null;
  cnpjDoCabecalho: boolean;
  /** CNPJ achado só com dígito verificador inválido (erro de digitação/OCR) */
  cnpjInvalido: boolean;
  /** Seção principal (onde está o percentual), usada por outras regras */
  secaoPrincipal: Secao | null;
}

const ev = (doc: Documento, ini: number, fim: number, max = 200): Evidencia => ({
  trecho: trecho(doc, ini, fim, max),
  pagina: paginaDe(doc, ini),
});

// ── Percentual ───────────────────────────────────────────────────────────────

function acharPercentual(doc: Documento) {
  type Cand = { pct: number; ini: number; fim: number; score: number; ancora: number };
  const cands: Cand[] = [];
  for (const m of ocorrencias(doc, /(\d+(?:,\d+)?)\s*%/g)) {
    const pct = parsePercentual(m[0]);
    if (pct == null || pct <= 0 || pct > 5) continue;
    const i = m.index;
    const antes = doc.busca.slice(Math.max(0, i - 350), i);
    // Âncora de proposta mais próxima antes do percentual
    const ancoras = [...antes.matchAll(RE_ANCORA_PROPOSTA)];
    const ultima = ancoras[ancoras.length - 1];
    let ancoraPos: number;
    if (ultima) {
      ancoraPos = i - antes.length + ultima.index!;
    } else if (/art(?:igo|\.|s)?\W{0,3}\s*58\b/.test(antes) && /garantia/.test(antes)) {
      ancoraPos = i - antes.length + antes.search(/art(?:igo|\.|s)?\W{0,3}\s*58\b/);
    } else continue;
    const entre = doc.busca.slice(ancoraPos, i);
    if (RE_OUTRA_GARANTIA.test(entre)) continue;
    if (/multa|inferior|superior|acrescimo|patrimonio|capital|desconto|lance|reajuste|indice|juros|consorcio/.test(entre)) continue;

    const depois = doc.busca.slice(i, i + 160);
    let score = 10 - Math.floor((i - ancoraPos) / 100);
    if (/sera\s+exigid|exigida|correspondente|percentual|valor\s+da\s+garantia|devera\s+ser\s+de|garantia\s+de\s+\d/.test(doc.busca.slice(Math.max(ancoraPos, i - 160), i))) score += 2;
    if (/^\d+(?:,\d+)?\s*%\s*\(\s*[a-z ,]+por\s+cento\s*\)/.test(depois)) score += 2;
    if (/valor\s+(?:total\s+)?(?:estimado|de\s+referencia|da\s+contratacao|global|do\(?s?\)?\s+lote|dos?\s+itens)/.test(depois)) score += 3;
    cands.push({ pct, ini: i, fim: i + m[0].length, score, ancora: ancoraPos });
  }
  cands.sort((a, b) => b.score - a.score || a.ini - b.ini);
  return cands[0] ?? null;
}

// ── Vigência e termo inicial ─────────────────────────────────────────────────

const TERMOS: { re: RegExp; termo: 'sessao_publica' | 'entrega_proposta' | 'emissao' }[] = [
  { re: /emissao\s+d[ao]\s+(?:apolice|garantia|seguro|instrumento|titulo)/, termo: 'emissao' },
  { re: /(?:entrega|apresentacao|protocolo|envio|cadastramento|recebimento)\s+d[ao]s?\s+propostas?/, termo: 'entrega_proposta' },
  { re: /(?:abertura|realizacao)\s+d[ao]s?\s+(?:sessao|licitacao|propostas?|certame|pregao|concorrencia)|data\s+d[ao]\s+(?:sessao|certame|licitacao|abertura)|sessao\s+publica/, termo: 'sessao_publica' },
];

/** Começo da frase/item que contém a posição i (para julgar o contexto). */
function inicioDaFrase(doc: Documento, i: number, limite: number): number {
  let a = i;
  while (a > limite && !/[.;]\s|\n\s*\d+(?:\.\d+)*[.)\s–-]/.test(doc.busca.slice(a - 2, a + 6))) a--;
  return a;
}

function acharVigencia(doc: Documento, secoes: Secao[]) {
  for (const s of secoes) {
    for (const m of ocorrencias(doc, /(\d{1,3})\s*(?:\([a-z\s-]+\)\s*)?dias(?!\s+uteis)/g, s.ini, s.fim)) {
      const i = m.index;
      if (m.index + m[0].length > s.fim) continue;
      const dias = Number(m[1]);
      if (dias < 5 || dias > 730) continue;
      const fraseIni = inicioDaFrase(doc, i, s.ini);
      const frase = doc.busca.slice(fraseIni, Math.min(s.fim, i + 200));
      const antes = doc.busca.slice(Math.max(fraseIni, i - 120), i);
      if (!/validade|vigencia|vigorar|vigente|prazo\s+minimo|prazo\s+de/.test(antes)) continue;
      // Armadilhas: devolução/liberação da garantia e validade da PROPOSTA sem falar da garantia
      if (/devolvid|devolucao|restituid|restituicao|liberad|liberacao|assinatura\s+do\s+contrato|homologacao|recurso/.test(antes)) continue;
      const falaDaGarantia = /garantia|apolice|seguro|fianca|caucao/.test(frase);
      if (/validade\s+d[ao]s?\s+propostas?/.test(antes) && !/garantia|apolice|seguro|fianca|caucao/.test(antes)) continue;
      if (!falaDaGarantia) continue;

      const depois = doc.busca.slice(i, Math.min(doc.busca.length, i + 220));
      let termo: ResultadoGarantia['termoInicial'] = null;
      let termoPos = -1;
      const contagem = depois.search(/contad|a\s+contar|a\s+partir|apos\s+a|da\s+data/);
      if (contagem >= 0 && contagem < 120) {
        for (const t of TERMOS) {
          const tm = t.re.exec(depois.slice(contagem));
          if (tm && tm.index < 100) { termo = t.termo; termoPos = i + contagem + tm.index + tm[0].length; break; }
        }
      }
      const fimTermo = termoPos > 0 ? termoPos : i + m[0].length;
      return {
        dias, termo,
        termoTrecho: termo ? trecho(doc, i, fimTermo, 150) : null,
        evidencia: ev(doc, i, fimTermo),
      };
    }
  }
  return null;
}

// ── CNPJ do beneficiário ─────────────────────────────────────────────────────

const CNPJ_FG = '56.123.874/0001-90';
const RE_CNPJ = /\d{2}\.\d{3}\.\d{3}\s?\/\s?\d{4}\s?-\s?\d{2}/g;
const limparCnpj = (s: string) => s.replace(/\s/g, '');

function cnpjNaSecao(doc: Documento, s: Secao, aceitarInvalido = false) {
  for (const m of doc.texto.slice(s.ini, s.fim).matchAll(RE_CNPJ)) {
    const c = limparCnpj(m[0]);
    if (c === CNPJ_FG || (!aceitarInvalido && !cnpjValido(c))) continue;
    const ini = s.ini + m.index!;
    return { cnpj: c, evidencia: ev(doc, ini, ini + m[0].length) };
  }
  return null;
}

/** CNPJ mais frequente no cabeçalho/rodapé e nas 3 primeiras páginas (órgão licitante). */
export function cnpjDoOrgao(doc: Documento, aceitarInvalido = false) {
  const freq = new Map<string, number>();
  const somar = (txt: string, peso: number) => {
    for (const m of txt.matchAll(RE_CNPJ)) {
      const c = limparCnpj(m[0]);
      if (c !== CNPJ_FG && (aceitarInvalido || cnpjValido(c))) freq.set(c, (freq.get(c) ?? 0) + peso);
    }
  };
  somar(doc.cabecalhos.join('\n'), 2);
  const fimPag3 = doc.linhas.find(l => l.pagina > 3)?.inicio ?? doc.texto.length;
  somar(doc.texto.slice(0, fimPag3), 1);
  const melhor = [...freq].sort((a, b) => b[1] - a[1])[0];
  if (!melhor) return null;
  const naPrimeira = doc.texto.indexOf(melhor[0].slice(0, 10));
  const evidencia: Evidencia = naPrimeira >= 0
    ? ev(doc, naPrimeira, naPrimeira + melhor[0].length)
    : { trecho: (doc.cabecalhos.find(c => limparCnpj(c).includes(melhor[0])) ?? melhor[0]).trim(), pagina: 1 };
  return { cnpj: melhor[0], evidencia };
}

// ── Modalidades e base de cálculo ────────────────────────────────────────────

function acharModalidades(doc: Documento, s: Secao | null): string[] | null {
  if (!s) return null;
  const txt = doc.busca.slice(s.ini, s.fim);
  const lista: string[] = [];
  if (/caucao/.test(txt)) lista.push('caucao');
  if (/seguro[\s-]*garantia/.test(txt)) lista.push('seguro-garantia');
  if (/fianca\s+bancaria/.test(txt)) lista.push('fianca_bancaria');
  if (/titulos?\s+de\s+capitalizacao/.test(txt)) lista.push('titulo_capitalizacao');
  if (lista.length) return lista;
  if (/art(?:igo|\.)?\s*96/.test(txt)) return ['caucao', 'seguro-garantia', 'fianca_bancaria', 'titulo_capitalizacao'];
  return null;
}

function acharBase(doc: Documento, pctFim: number): ResultadoGarantia['baseCalculo'] {
  const depois = doc.busca.slice(pctFim, pctFim + 180);
  if (/\blote\(?s?\)?|\blotes\b|por\s+lote|cada\s+lote/.test(depois)) return 'por_lote';
  if (/dos?\s+itens|por\s+item|cada\s+item/.test(depois)) return 'por_item';
  if (/valor\s+(?:total\s+)?(?:global|estimado|de\s+referencia|da\s+contratacao|orcado)/.test(depois)) return 'global';
  return 'nao_especificado';
}

// ── Orquestração ─────────────────────────────────────────────────────────────

export function extrairGarantia(doc: Documento): ResultadoGarantia {
  const r: ResultadoGarantia = {
    exige: null, exigeEvidencia: null, percentual: null, percentualEvidencia: null,
    baseCalculo: null, modalidades: null, vigenciaDias: null, termoInicial: null, termoTrecho: null,
    vigenciaEvidencia: null, cnpj: null, cnpjEvidencia: null, cnpjDoCabecalho: false, cnpjInvalido: false, secaoPrincipal: null,
  };

  // 1. Negação explícita ("não será exigida garantia de proposta")
  const neg = ocorrencias(doc, RE_NEGACAO)[0];
  if (neg) {
    r.exige = false;
    r.exigeEvidencia = ev(doc, neg.index, neg.index + neg[0].length);
    return r;
  }

  const secoes = secoesGarantia(doc);
  if (!secoes.length) {
    r.exige = false; // nenhuma âncora em todo o edital
    return r;
  }

  // 2. Percentual
  const pct = acharPercentual(doc);
  if (pct) {
    r.percentual = pct.pct;
    r.percentualEvidencia = ev(doc, pct.ancora, pct.fim);
    r.exige = true;
    r.exigeEvidencia = r.percentualEvidencia;
    r.baseCalculo = acharBase(doc, pct.fim);
    r.secaoPrincipal = secoes.find(s => pct.ini >= s.ini && pct.ini < s.fim)
      ?? { ini: pct.ancora, fim: Math.min(doc.texto.length, pct.fim + 2000), ancora: pct.ancora };
  } else {
    // 3. Exigência sem percentual
    for (const s of secoes) {
      const ctx = doc.busca.slice(Math.max(0, s.ini - 250), Math.min(s.fim, s.ini + 350));
      if (RE_EXIGENCIA.test(ctx) && !/perda\s+da\s+garantia|execucao\s+da\s+garantia/.test(doc.busca.slice(Math.max(0, s.ini - 40), s.ini))) {
        r.exige = true;
        r.exigeEvidencia = ev(doc, s.ini, Math.min(s.fim, s.ini + 120));
        r.secaoPrincipal = s;
        break;
      }
    }
    // Só menções soltas (ex.: "perda da garantia de proposta" em sanções) → indeterminado
  }

  // Ordena: seção principal primeiro
  const ordem = r.secaoPrincipal
    ? [r.secaoPrincipal, ...secoes.filter(s => s.ini !== r.secaoPrincipal!.ini)]
    : secoes;

  if (r.exige !== false) {
    r.modalidades = acharModalidades(doc, r.secaoPrincipal);

    const vig = acharVigencia(doc, ordem.slice(0, r.secaoPrincipal ? 1 : ordem.length));
    if (vig) {
      r.vigenciaDias = vig.dias;
      r.termoInicial = vig.termo;
      r.termoTrecho = vig.termoTrecho;
      r.vigenciaEvidencia = vig.evidencia;
    }

    for (const s of ordem.slice(0, 3)) {
      const c = cnpjNaSecao(doc, s);
      if (c) { r.cnpj = c.cnpj; r.cnpjEvidencia = c.evidencia; break; }
    }
  }
  if (!r.cnpj) {
    const c = cnpjDoOrgao(doc);
    if (c) { r.cnpj = c.cnpj; r.cnpjEvidencia = c.evidencia; r.cnpjDoCabecalho = true; }
  }
  // Último recurso: CNPJ com dígito inválido (melhor mostrar e alertar do que esconder)
  if (!r.cnpj) {
    const naSecao = r.exige !== false ? ordem.slice(0, 3).map(s => cnpjNaSecao(doc, s, true)).find(Boolean) : null;
    const c = naSecao ?? cnpjDoOrgao(doc, true);
    if (c) { r.cnpj = c.cnpj; r.cnpjEvidencia = c.evidencia; r.cnpjInvalido = true; r.cnpjDoCabecalho = !naSecao; }
  }
  return r;
}
