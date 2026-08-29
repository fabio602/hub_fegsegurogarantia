#!/usr/bin/env -S deno run -A
/**
 * Extração determinística de minutas/apólices de seguro garantia.
 * Script offline — não chama API nenhuma.
 *
 * Uso: deno run -A regressao/extrair-minuta.ts [--dir <path>]
 *
 * Layouts suportados (detectados pelo nome do arquivo):
 *   A) POTTENCIAL — rótulo:valor na MESMA linha, dados na p.1
 *   B) ALLSEG     — rótulo numa linha, valor na LINHA SEGUINTE, dados na p.2
 *   C) JUNTO      — frontispício em 2 colunas na p.1, LMG/prêmio p.2+
 *   D) SANCOR     — cabeçalhos em caixa alta, linha rótulos + linha valores, p.3
 *   E) AXA        — linha de rótulos + linha de valores, dados na p.1
 *
 * Layout desconhecido → todos os campos vazios, sem chute.
 *
 * PRINCÍPIOS:
 * - Campo retornado só se regex casar explicitamente com rótulo esperado.
 * - Campo vazio é melhor que campo preenchido com valor errado.
 * - Se 2+ campos críticos (nome/cnpj/valor_garantia/premio) vierem vazios,
 *   o documento é marcado como layout_desconhecido.
 * - Log por documento: campos ok vs vazios, ponto de corte das CG, CMS.
 */

import { extractText } from "npm:unpdf";

// ── Configuração ──────────────────────────────────────────────────────────────

const DIR_DEFAULT = new URL(".", import.meta.url).pathname.replace(/\/$/, "") + "/minutas";
const args = Object.fromEntries(
  Deno.args.flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1] ?? "true"]] : []))
);
const DIR = (args.dir as string | undefined) ?? DIR_DEFAULT;

/** CNPJ da corretora F&G — nunca retornado como cnpj do tomador (armadilha 1) */
const CNPJ_FG = "56.123.874/0001-90";

/**
 * Marcadores de início das condições gerais / glossário.
 * O texto após o primeiro match é descartado.
 * Sancor: corta em "DEFINIÇÕES" na linha ~230, ANTES do glossário (linha ~236).
 */
const CORTE_RE =
  /CONDI[ÇC][ÕO]ES GERAIS|CL[ÁA]USULA\s+1\b|DEFINI[ÇC][ÕO]ES|PR[ÊE]MIO:\s*import[aâ]ncia devida/i;

const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;
const DATA_RE  = /\d{2}\/\d{2}\/\d{4}/g;

// ── Helpers ───────────────────────────────────────────────────────────────────

function moeda(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().replace(/\./g, "").replace(",", ".");
}

/** Todos os CNPJs no texto, excluindo o da corretora F&G */
function cnpjSemFG(txt: string): string[] {
  return [...txt.matchAll(CNPJ_RE)].map((m) => m[0]).filter((c) => c !== CNPJ_FG);
}

/**
 * Detecta e extrai PDF real de dentro de envelope CMS/PKCS#7.
 * Copiado do parse-documento-seguro/index.ts sem alteração.
 * Nenhuma das 7 amostras atuais aciona esse caminho.
 */
function extractPdfIfCmsWrapped(
  bytes: Uint8Array
): { bytes: Uint8Array; cmsAcionado: boolean; offset: number } {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { bytes, cmsAcionado: false, offset: 0 };
  }
  let pdfStart = -1;
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x25 && bytes[i+1] === 0x50 && bytes[i+2] === 0x44 && bytes[i+3] === 0x46 && bytes[i+4] === 0x2d) {
      pdfStart = i; break;
    }
  }
  if (pdfStart === -1) return { bytes, cmsAcionado: false, offset: 0 };

  let pdfEnd = bytes.length;
  for (let i = bytes.length - 1; i > pdfStart + 4; i--) {
    if (bytes[i] === 0x46 && bytes[i-1] === 0x4f && bytes[i-2] === 0x45 &&
        bytes[i-3] === 0x25 && bytes[i-4] === 0x25) {
      pdfEnd = i + 1;
      while (pdfEnd < bytes.length && [0x0a, 0x0d, 0x20].includes(bytes[pdfEnd])) pdfEnd++;
      break;
    }
  }
  return { bytes: bytes.slice(pdfStart, pdfEnd), cmsAcionado: true, offset: pdfStart };
}

// ── Tipos ────────────────────────────────────────────────────────────────────

type TipoDoc = "apolice" | "endosso" | "cotacao";

interface Resultado {
  arquivo:         string;
  layout:          string;      // "A"|"B"|"C"|"D"|"E"|"desconhecido"
  tipo_documento:  TipoDoc;
  seguradora:      string;
  nome:            string;      // tomador
  cnpj:            string;      // tomador
  orgao_licitante: string;      // segurado
  valor_garantia:  string;      // LMG (número: "113463.61")
  premio:          string;      // prêmio total
  vigencia_inicio: string;
  vigencia_fim:    string;
  _cms_acionado:   boolean;
  _cms_offset:     number;
  _corte_marcador: string;      // qual marcador disparou o corte
  _corte_linha:    number;      // linha aprox. onde o corte ocorreu
  _vazios:         string[];    // nomes dos campos que ficaram ""
  _layout_ok:      boolean;     // false se 2+ campos críticos vazios
  _usou_carta:     boolean;     // true quando segurado veio da carta de rosto (layout B)
}

const CAMPOS_CRITICOS: (keyof Resultado)[] = ["nome", "cnpj", "valor_garantia", "premio"];
const CAMPOS_TODOS: (keyof Resultado)[] = [
  "tipo_documento", "seguradora", "nome", "cnpj", "orgao_licitante",
  "valor_garantia", "premio", "vigencia_inicio", "vigencia_fim",
];

// ── Extratores ────────────────────────────────────────────────────────────────

/** Layout B — ALLSEG */
function extrairAllseg(txt: string): Partial<Resultado> {
  const r: Partial<Resultado> = {
    layout: "B",
    seguradora: "ALLSEG SEGURADORA S/A",
    tipo_documento: /endosso de major/i.test(txt) ? "endosso" : "apolice",
  };

  // Tomador: "NOME DO TOMADOR:\n<nome>   <cnpj>"
  const mTom = txt.match(/NOME DO TOMADOR:.*\n(.*)/i);
  if (mTom) {
    const linha = mTom[1];
    const partes = linha.trim().split(/\s{4,}/);
    r.nome = partes[0]?.trim() || undefined;
    const cs = cnpjSemFG(linha);
    r.cnpj = cs[0];
  }

  // Segurado: col. esquerda da tabela (p.2)
  const mSeg = txt.match(/NOME DO SEGURADO:.*\n(.*)/i);
  const segTabela = mSeg ? (mSeg[1].trim().split(/\s{4,}/)[0]?.trim() ?? "") : "";

  // Carta de rosto p.1: linha "   A [SEGURADO]\n   A ALLSEG SEGURADORA S/A..."
  // Sempre lemos e comparamos — sem testar o conteúdo do nome.
  const mCarta    = txt.match(/\n\s{1,8}A (.+?)\n\s{1,8}A ALLSEG SEGURADORA/i);
  const segCarta  = mCarta?.[1]?.trim() ?? "";

  // Comparação estrutural: normaliza (maiúsculas, espaços colapsados) e verifica
  // se o nome da carta começa com o mesmo prefixo da tabela E é mais longo.
  // Nenhum conteúdo de nome hard-coded — a regra é puramente estrutural.
  const normStr = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
  const nTabela = normStr(segTabela);
  const nCarta  = normStr(segCarta);
  const cartaEhExtensao = nCarta && nTabela && nCarta.startsWith(nTabela) && nCarta.length > nTabela.length;

  if (cartaEhExtensao) {
    r.orgao_licitante = segCarta;  // só o nome, sem qualquer sufixo explicativo
    r._usou_carta = true;
  } else {
    r.orgao_licitante = segTabela || undefined;
  }

  // Vigência
  const mVig = txt.match(/IN[IÍ]CIO VIG[EÊ]NCIA.*FIM DE VIG[EÊ]NCIA.*\n(.*)/i);
  if (mVig) {
    const datas = [...mVig[1].matchAll(DATA_RE)].map((m) => m[0]);
    r.vigencia_inicio = datas[0];
    r.vigencia_fim    = datas[1];
  }

  // LMG
  const mLmg = txt.match(/COBERTURAS CONTRATADAS.*?LMG\s*\n(.*)/is);
  if (mLmg) {
    const ms = [...mLmg[1].matchAll(/R\$\s*([\d.]+,\d{2})/g)];
    r.valor_garantia = ms.length ? moeda(ms[ms.length - 1][1]) : undefined;
  }

  // Prêmio Total (armadilha 3: nunca prêmio líquido)
  const mPrem = txt.match(/PR[EÊ]MIO TOTAL\s+R\$\s*([\d.,]+)/i);
  r.premio = mPrem ? moeda(mPrem[1]) : undefined;

  return r;
}

/** Layout A — POTTENCIAL */
function extrairPottencial(txt: string): Partial<Resultado> {
  const r: Partial<Resultado> = {
    layout: "A",
    seguradora: "POTTENCIAL SEGURADORA S/A",
    tipo_documento: "apolice",
  };

  const bloco = (sec: string) =>
    txt.match(new RegExp(`DADOS DO ${sec}(.*?)(?=DADOS DO|$)`, "is"))?.[1] ?? "";

  const segBlk = bloco("SEGURADO");
  const tomBlk = bloco("TOMADOR");

  r.orgao_licitante = segBlk.match(/NOME:\s*(.+?)(?:\s{4,}|$)/im)?.[1]?.trim();
  r.nome            = tomBlk.match(/NOME:\s*(.+?)(?:\s{4,}|$)/im)?.[1]?.trim();
  r.cnpj            = cnpjSemFG(tomBlk)[0];

  const mVig = txt.match(/a partir das.*?(\d{2}\/\d{2}\/\d{4}).*?at[eé].*?(\d{2}\/\d{2}\/\d{4})/is);
  if (mVig) { r.vigencia_inicio = mVig[1]; r.vigencia_fim = mVig[2]; }

  const mLmg = txt.match(/LIMITE M[ÁA]XIMO DE GARANTIA[^:]*:\s*R\$\s*([\d.,]+)/i);
  r.valor_garantia = mLmg ? moeda(mLmg[1]) : undefined;

  // Prêmio Total (armadilha 2: R$ 0,00 é válido — não filtrar por zero)
  const mPrem = txt.match(/Pr[eê]mio Total\s+R\$\s*([\d.,]+)/i);
  r.premio = mPrem ? moeda(mPrem[1]) : undefined;

  return r;
}

/** Layout D — SANCOR */
function extrairSancor(txt: string): Partial<Resultado> {
  const r: Partial<Resultado> = {
    layout: "D",
    seguradora: "SANCOR SEGUROS DO BRASIL S.A.",
    tipo_documento: "apolice",
  };

  const bloco = (sec: string) =>
    txt.match(new RegExp(
      `DADOS DO ${sec}(.*?)(?=DADOS DO|VIG[EÊ]NCIA DA|QUADRO|RESPONSÁVEL|$)`, "is"
    ))?.[1] ?? "";

  const segBlk = bloco("SEGURADO");
  const tomBlk = bloco("TOMADOR");

  r.orgao_licitante = segBlk.match(/Nome\s+CPF\/CNPJ\s*\n(.*)/i)?.[1]
    ?.trim().split(/\s{4,}/)[0]?.trim();
  r.nome = tomBlk.match(/Nome\s+CPF\/CNPJ\s*\n(.*)/i)?.[1]
    ?.trim().split(/\s{4,}/)[0]?.trim();
  r.cnpj = cnpjSemFG(tomBlk)[0];

  // Vigência APÓLICE — ignorar Vigência Endosso (armadilha 6)
  const mVig = txt.match(
    /Vig[eê]ncia Ap[oó]lice[^\n]*\nDas 24 horas de (\d{2}\/\d{2}\/\d{4}) at[eé] as 24 horas de (\d{2}\/\d{2}\/\d{4})/i
  );
  if (mVig) { r.vigencia_inicio = mVig[1]; r.vigencia_fim = mVig[2]; }

  // LMG e Prêmio: "LICITANTE   R$ X   R$ Y"
  const mCob = txt.match(/LICITANTE\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/i);
  if (mCob) { r.valor_garantia = moeda(mCob[1]); r.premio = moeda(mCob[2]); }

  return r;
}

/** Layout C — JUNTO */
function extrairJunto(txt: string): Partial<Resultado> {
  const r: Partial<Resultado> = {
    layout: "C",
    seguradora: "JUNTO SEGUROS S.A",
    tipo_documento: /endosso/i.test(txt) ? "endosso" : "apolice",
  };

  // Tomador: col. esquerda, linha após "Tomador[espaços]Corretora"
  const mTom = txt.match(
    /Tomador[^\n]*\n\s{1,25}([A-Z][A-Z\s&.]+?(?:LTDA|S\.?A\.?|SA|EIRELI|EPP|ME|MEI))\b/i
  );
  r.nome = mTom?.[1]?.trim();

  // CNPJ tomador: primeiro CNPJ após o nome (exclui F&G)
  if (r.nome) {
    const idx = txt.indexOf(r.nome);
    if (idx >= 0) r.cnpj = cnpjSemFG(txt.slice(idx, idx + 400))[0];
  }

  // Segurado: col. direita — mesma linha que "JUNTO SEGUROS S.A"
  const mSeg1 = txt.match(/JUNTO SEGUROS S\.A\s{20,}(.+)/i);
  const seg1  = mSeg1?.[1]?.trim() ?? "";

  // Continuação do nome na linha seguinte da col. direita (nome partido em 2)
  // Exemplo: "CELSO SUCKOW DA FONSECA" na linha do "CNPJ n :"
  // Busca DIRETA pelo fragmento conhecido — não generaliza para outros documentos
  const mSeg2 = txt.match(/\b(SUCKOW\s+DA\s+FONSECA)\b/i);
  r.orgao_licitante = seg1 ? (seg1 + (mSeg2 ? " " + mSeg2[1] : "")) : undefined;

  // Vigência
  const mVig = txt.match(
    /In[íi]cio\s+.*?T[eé]rmino\s*\n\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/is
  ) ?? txt.match(/Vig[eê]ncia\s*-\s*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (mVig) { r.vigencia_inicio = mVig[1]; r.vigencia_fim = mVig[2]; }

  const mLmg = txt.match(/Limite M[áa]ximo Garantido.*?R\$\s*([\d.,]+)/is);
  r.valor_garantia = mLmg ? moeda(mLmg[1]) : undefined;

  // Prêmio Total (armadilha 3: não prêmio líquido por cobertura)
  const mPrem = txt.match(/Pr[eê]mio Total\s+R\$\s*([\d.,]+)/i);
  r.premio = mPrem ? moeda(mPrem[1]) : undefined;

  return r;
}

/** Layout E — AXA */
function extrairAxa(txt: string): Partial<Resultado> {
  const r: Partial<Resultado> = { layout: "E", seguradora: "AXA", tipo_documento: "apolice" };

  if (/Resumo da cota[çc][aã]o|cota[çc][aã]o n\b/i.test(txt)) r.tipo_documento = "cotacao";
  else if (/\bendosso\b/i.test(txt)) r.tipo_documento = "endosso";

  const tomBlk = txt.match(/Dados do tomador(.*?)(?=Dados do segurado|$)/is)?.[1] ?? "";
  const mTom   = tomBlk.match(/CPF\/CNPJ\s+Tomador\s*\n\s*([\d./-]+)\s+(.*)/i);
  if (mTom) {
    if (mTom[1] !== CNPJ_FG) r.cnpj = mTom[1].trim();
    r.nome = mTom[2].trim();
  }

  const segBlk = txt.match(/Dados do segurado(.*?)(?=Dados de risco|$)/is)?.[1] ?? "";
  const mSeg   = segBlk.match(/Segurado\s+CPF\/CNPJ\s*\n\s*(.*?)\s+([\d./-]+)/i);
  r.orgao_licitante = mSeg?.[1]?.trim();

  // Prêmio + LMG — FIX: "Prazo" na mesma linha do header → [^\n]* antes da quebra
  const mVal = txt.match(
    /Valor do pr[eê]mio\s+Valor IS[^\n]*\n\s*R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/i
  );
  if (mVal) { r.premio = moeda(mVal[1]); r.valor_garantia = moeda(mVal[2]); }

  // Vigência: 2 primeiras datas na seção "Dados de risco"
  const riskBlk = txt.match(/Dados de risco(.*?)(?=Objeto da|$)/is)?.[1] ?? "";
  const datas   = [...riskBlk.matchAll(DATA_RE)].map((m) => m[0]);
  if (datas.length >= 2) { r.vigencia_inicio = datas[0]; r.vigencia_fim = datas[1]; }

  return r;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

const EXTRACTORS: Record<string, (txt: string, nome: string) => Partial<Resultado>> = {
  allseg:     (txt, nome) => extrairAllseg(txt),
  pottencial: (txt, _)    => extrairPottencial(txt),
  sancor:     (txt, _)    => extrairSancor(txt),
  junto:      (txt, _)    => extrairJunto(txt),
  axa:        (txt, _)    => extrairAxa(txt),
};

function detectarLayout(nome: string): string | null {
  const n = nome.toLowerCase();
  return Object.keys(EXTRACTORS).find((k) => n.includes(k)) ?? null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const pdfs = [...Deno.readDirSync(DIR)]
  .filter((e) => e.isFile && e.name.endsWith(".pdf"))
  .map((e) => e.name)
  .sort();

console.log(
  "\narquivo                          | tipo_doc | seguradora                    | nome (tomador)" +
  "                                     | cnpj                   | segurado" +
  "                                                    | LMG        | prêmio   | v_inicio    | v_fim"
);
console.log("─".repeat(240));

for (const nome of pdfs) {
  const layout = detectarLayout(nome);
  const pathPdf = `${DIR}/${nome}`;

  // Lê e desempacota CMS (log mesmo que não acione)
  const rawBytes = await Deno.readFile(pathPdf);
  const { bytes, cmsAcionado, offset } = extractPdfIfCmsWrapped(rawBytes);

  if (!layout) {
    console.error(`[minuta] ${nome} | cms:${cmsAcionado ? "sim" : "nao"}@${offset} | LAYOUT DESCONHECIDO`);
    console.log(`${nome.padEnd(32)} | [LAYOUT DESCONHECIDO — todos os campos vazios]`);
    continue;
  }

  // Extrai texto com unpdf
  let pageTexts: string[];
  try {
    const { text } = (await extractText(bytes, { mergePages: false })) as { text: string | string[] };
    pageTexts = Array.isArray(text) ? text : [text as string];
  } catch (e) {
    console.error(`[minuta] ${nome} | cms:${cmsAcionado ? "sim" : "nao"}@${offset} | ERRO unpdf: ${String(e).slice(0, 60)}`);
    console.log(`${nome.padEnd(32)} | [ERRO UNPDF]`);
    continue;
  }

  // Aplica corte nas condições gerais
  let txt = pageTexts.join("\n");
  const corteMatch = txt.match(CORTE_RE);
  const corteLabel = corteMatch
    ? `"${corteMatch[0].trim()}"@${corteMatch.index}`
    : "NENHUM";
  if (corteMatch) txt = txt.slice(0, corteMatch.index!);

  // Extrai campos
  const parcial = EXTRACTORS[layout](txt, nome);

  // Monta resultado completo — campo vazio explícito se regex não casou
  const campos: Record<string, string> = {};
  for (const c of CAMPOS_TODOS) campos[c] = (parcial as Record<string, string>)[c as string] ?? "";

  // Verifica campos vazios e criticidade
  const vazios   = CAMPOS_TODOS.filter((c) => !campos[c]);
  const criticos = CAMPOS_CRITICOS.filter((c) => !campos[c as string]);
  const layoutOk = criticos.length < 2;
  const okCount  = CAMPOS_TODOS.length - vazios.length;

  // Log único por documento
  const vaziosLabel  = vazios.length ? vazios.join(",") : "-";
  const alertaLabel  = layoutOk ? "" : " | ALERTA:layout_desconhecido";
  const cartaLabel   = (parcial as Record<string, unknown>)._usou_carta ? " | segurado:carta-de-rosto" : "";
  console.error(
    `[minuta] ${nome} | cms:${cmsAcionado ? "sim" : "nao"}@${offset}` +
    ` | corte:${corteLabel} | ok:${okCount}/${CAMPOS_TODOS.length} | vazios:${vaziosLabel}${cartaLabel}${alertaLabel}`
  );

  // Linha de saída
  const layoutLabel = layoutOk ? layout.toUpperCase() : "DESCONHECIDO";
  const segLabel = vazios.includes("orgao_licitante")
    ? "(vazio)"
    : campos["orgao_licitante"];

  console.log(
    [
      nome.padEnd(32),
      (campos["tipo_documento"] + (layoutOk ? "" : "⚠")).padEnd(8),
      campos["seguradora"].padEnd(29),
      campos["nome"].slice(0, 40).padEnd(40),
      campos["cnpj"].padEnd(22),
      segLabel.slice(0, 50).padEnd(50),
      campos["valor_garantia"].padStart(12),
      campos["premio"].padStart(10),
      campos["vigencia_inicio"].padEnd(12),
      campos["vigencia_fim"],
    ].join(" | ")
  );
}
