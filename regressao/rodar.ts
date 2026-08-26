#!/usr/bin/env -S deno run -A
/**
 * Bateria de regressão do analyze-edital.
 * Uso: deno run -A regressao/rodar.ts [--repeticoes N] [--provedor claude|gemini]
 *                                     [--top-n N] [--vizinhas N]
 *
 * --top-n e --vizinhas ajustam o pré-filtro de páginas só nesta rodada, para
 * varrer cortes mais agressivos e ver onde o acerto começa a cair. Omitidos,
 * a função usa os padrões dela — a mesma coisa que o hub faz em produção.
 *
 * Lê o gabarito.json, chama a Edge Function em produção para cada PDF,
 * compara campo a campo e imprime a tabela de resultados.
 */

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";

// ── Configuração ──────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://hfjvwibucplyhsvnwfor.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmanZ3aWJ1Y3BseWhzdm53Zm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODA4NTIsImV4cCI6MjA4Nzk1Njg1Mn0.jCBS1YnDcKuVzJSVhGiJM0kyafPMZxFi52kszTJCxZQ";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const PDF_DIR = `${DIR}/pdfs`;
const RESULTADOS_DIR = `${DIR}/resultados`;
const GABARITO_PATH = `${DIR}/gabarito.json`;

const CAMPOS_TESTADOS = [
  "valor_global_edital",
  "exige_garantia_proposta",
  "percentual_garantia_proposta",
  "valor_garantia_proposta_calculado",
  "vigencia_garantia_proposta_dias",
  "vigencia_garantia_termo_inicial",
  "orgao_cnpj",
  "data_sessao_publica",
] as const;

type Campo = typeof CAMPOS_TESTADOS[number];
const TOLERANCIA_MONETARIA = 0.01;
const DELAY_ENTRE_CHAMADAS_MS = 4000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normaliza datas para comparação: tanto ISO "YYYY-MM-DDTHH:MM" quanto "DD/MM/YYYY HH:MM" */
function normalizarData(s: string): string {
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]} ${br[4]}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (iso) return `${iso[1]} ${iso[2]}`;
  return s.trim();
}

/** Compara um campo do retorno contra o valor esperado do gabarito. */
function comparar(campo: Campo, esperado: unknown, retornado: unknown): boolean {
  // null esperado: só null ou undefined é acerto
  if (esperado === null) return retornado == null;

  // Monetários: tolerância de R$ 0,01
  if (campo === "valor_global_edital" || campo === "valor_garantia_proposta_calculado") {
    if (typeof esperado === "number" && typeof retornado === "number") {
      return Math.abs(esperado - retornado) <= TOLERANCIA_MONETARIA;
    }
    return false;
  }

  // Datas: normaliza formato
  if (campo === "data_sessao_publica") {
    if (retornado == null) return false;
    return normalizarData(String(esperado)) === normalizarData(String(retornado));
  }

  // Boolean, número, string: igualdade estrita
  return esperado === retornado;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function cor(ok: boolean | null): string {
  if (ok === null) return "\x1b[90m"; // cinza
  return ok ? "\x1b[32m" : "\x1b[31m"; // verde / vermelho
}
const RESET = "\x1b[0m";

// ── Chamada à Edge Function ───────────────────────────────────────────────────

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

async function chamarEdgeFunction(
  b64: string,
  arquivo: string,
  provedor: string,
  topN?: number,
  vizinhas?: number,
): Promise<{
  data: Record<string, unknown>;
  sucesso: boolean;
  erro?: string;
  elapsed_ms: number;
  httpStatus: number;
  retries: number;
}> {
  let tentativa = 0;
  let totalRetries = 0;

  while (true) {
    const inicio = Date.now();
    let httpStatus = 0;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-edital`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          filesData: [{ data: b64, mediaType: "application/pdf", name: arquivo }],
          // Override por requisição: pede um provedor específico SÓ para esta chamada.
          // A variável PROVEDOR_IA do Supabase é global — se a bateria a trocasse,
          // mudaria o provedor para todo mundo no hub no meio do teste.
          _provedor: provedor,
          // Corte do pré-filtro. Só vai no corpo quando --top-n / --vizinhas são
          // passados; sem eles a função usa os padrões dela e nada muda.
          ...(topN !== undefined ? { _prefiltro_top_n: topN } : {}),
          ...(vizinhas !== undefined ? { _prefiltro_vizinhas: vizinhas } : {}),
        }),
        signal: AbortSignal.timeout(300_000), // 5 min
      });
      httpStatus = res.status;
      const elapsed_ms = Date.now() - inicio;
      const json = await res.json();

      // Retry decidido pelo corpo da resposta (retryable: true = 429 ou 5xx da API Anthropic).
      // O HTTP da Edge Function é sempre 200; não usamos httpStatus para isso.
      const retryable = json.retryable === true;
      if (!json.success && retryable && tentativa < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[tentativa];
        console.log(`    ↺ apiStatus:${json.apiStatus ?? "?"} retryable — retry ${tentativa + 1}/${RETRY_DELAYS_MS.length} em ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        tentativa++;
        totalRetries++;
        continue;
      }

      // 400 (retryable: false) ou sucesso: não repete
      if (!json.success) return { data: json.data ?? {}, sucesso: false, erro: json.error, elapsed_ms, httpStatus, retries: totalRetries };
      return { data: json.data ?? {}, sucesso: true, elapsed_ms, httpStatus, retries: totalRetries };

    } catch (e) {
      // Timeout do AbortSignal não é recuperável — não repete (poderia travar 20 min).
      const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (!isTimeout && tentativa < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[tentativa];
        console.log(`    ↺ Erro de rede — retry ${tentativa + 1}/${RETRY_DELAYS_MS.length} em ${delay / 1000}s... (${String(e).slice(0, 80)})`);
        await new Promise((r) => setTimeout(r, delay));
        tentativa++;
        totalRetries++;
        continue;
      }
      const label = isTimeout ? "timeout (não retryable)" : String(e).slice(0, 100);
      return { data: {}, sucesso: false, erro: label, elapsed_ms: Date.now() - inicio, httpStatus, retries: totalRetries };
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, { default: { repeticoes: 3, provedor: "claude" } });
const N = Math.max(1, Number(args.repeticoes));

// --provedor=claude|gemini — o padrão é claude, que é o que roda em produção.
const PROVEDOR = String(args.provedor).trim().toLowerCase();
if (PROVEDOR !== "claude" && PROVEDOR !== "gemini") {
  console.error(`Provedor inválido: "${args.provedor}". Use --provedor=claude ou --provedor=gemini.`);
  Deno.exit(1);
}

// --top-n=N e --vizinhas=N ajustam o corte do pré-filtro só nesta rodada.
// Sem eles, a função usa os próprios padrões — que é o que roda em produção.
function argInteiro(valor: unknown, nome: string, minimo: number): number | undefined {
  if (valor === undefined) return undefined;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo) {
    console.error(`Valor inválido para --${nome}: "${valor}". Use um inteiro >= ${minimo}.`);
    Deno.exit(1);
  }
  return n;
}
const TOP_N = argInteiro(args["top-n"], "top-n", 1);
const VIZINHAS = argInteiro(args["vizinhas"], "vizinhas", 0);

const rotuloPrefiltro = TOP_N === undefined && VIZINHAS === undefined
  ? "padrão"
  : `topN:${TOP_N ?? "padrão"} viz:${VIZINHAS ?? "padrão"}`;

console.log(`\n=== Bateria de Regressão — analyze-edital (${N} repetições por caso | provedor: ${PROVEDOR} | pré-filtro: ${rotuloPrefiltro}) ===\n`);

const gabarito = JSON.parse(await Deno.readTextFile(GABARITO_PATH));
const casos = gabarito.casos as Array<{
  id: string; arquivo: string; orgao: string; esperado: Record<string, unknown>;
}>;

await Deno.mkdir(RESULTADOS_DIR, { recursive: true });
let totalRetriesGlobal = 0; // conta retries de infraestrutura (429/5xx/rede)
const tokensPorCaso: Array<{ caso: string; tokens: number; pagOrig: number; pagEnv: number }> = [];

// Estrutura: resultados[casoId][campo][repeticao] = { ok, retornado }
type Resultado = { ok: boolean; retornado: unknown; modelo: string };
const resultados: Record<string, Record<string, Resultado[]>> = {};

for (const caso of casos as Array<{
  id: string; arquivo: string; orgao: string; esperado: Record<string, unknown>;
  pular?: boolean; motivo_pulo?: string;
}>) {
  if (caso.pular) {
    console.log(`\n⏭ ${caso.id} — PULADO (${caso.motivo_pulo ?? "sem motivo"})`);
    continue;
  }
  console.log(`\n▶ ${caso.id} — ${caso.orgao}`);
  const pdfPath = `${PDF_DIR}/${caso.arquivo}`;

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await Deno.readFile(pdfPath);
  } catch {
    console.error(`  ✗ PDF não encontrado: ${pdfPath}`);
    continue;
  }
  const b64 = encodeBase64(pdfBytes);
  console.log(`  PDF: ${caso.arquivo} (${(pdfBytes.length / 1024).toFixed(0)} KB)`);

  resultados[caso.id] = {};
  for (const c of CAMPOS_TESTADOS) resultados[caso.id][c] = [];

  for (let r = 0; r < N; r++) {
    console.log(`  Execução ${r + 1}/${N}...`);
    const { data, sucesso, erro, elapsed_ms, httpStatus, retries } = await chamarEdgeFunction(b64, caso.arquivo, PROVEDOR, TOP_N, VIZINHAS);

    const modelo = String(data._modelo ?? "desconhecido");
    const retriesSuffix = retries > 0 ? ` | retries:${retries}` : "";
    // Páginas e tokens são o lado do custo: sem eles a bateria só diria se acertou,
    // não se ficou mais barato.
    const pagOrig = Number(data._paginas_originais ?? 0);
    const pagEnv = Number(data._paginas_enviadas ?? 0);
    const tokens = Number(data._tokens_entrada ?? 0);
    if (sucesso && tokens > 0) {
      tokensPorCaso.push({ caso: caso.id, tokens, pagOrig, pagEnv });
    }
    const custoSuffix = sucesso && tokens > 0
      ? ` | ${pagEnv}/${pagOrig}p | ${tokens} tokens`
      : "";
    console.log(`    ${sucesso ? "✓" : "✗"} ${elapsed_ms}ms | modelo:${modelo} | HTTP ${httpStatus}${custoSuffix}${retriesSuffix}`);
    if (!sucesso) console.error(`    Erro: ${erro}`);

    // Grava resultado bruto
    const ts = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
    await Deno.writeTextFile(
      // O provedor entra no nome do arquivo para as duas rodadas (claude e gemini)
      // não se misturarem na pasta de resultados.
      `${RESULTADOS_DIR}/${caso.id}-${PROVEDOR}-${ts}-r${r + 1}.json`,
      JSON.stringify({ caso: caso.id, provedor: PROVEDOR, prefiltro: { topN: TOP_N ?? null, vizinhas: VIZINHAS ?? null }, repeticao: r + 1, elapsed_ms, sucesso, erro, modelo, httpStatus, retries, data }, null, 2)
    );

    totalRetriesGlobal += retries;

    // Compara campo a campo
    for (const campo of CAMPOS_TESTADOS) {
      const esperado = caso.esperado[campo] ?? null;
      const retornado = data[campo] ?? null;
      const ok = comparar(campo, esperado, retornado);
      resultados[caso.id][campo].push({ ok, retornado, modelo });
    }

    if (r < N - 1) {
      console.log(`    aguardando ${DELAY_ENTRE_CHAMADAS_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, DELAY_ENTRE_CHAMADAS_MS));
    }
  }
}

// ── Tabela de resultados ──────────────────────────────────────────────────────

const cabecalhoCampos = CAMPOS_TESTADOS.map((c) => c.replace("vigencia_garantia_", "vig_").replace("valor_garantia_proposta_calculado", "val_calc").replace("valor_global_edital", "val_global").replace("exige_garantia_proposta", "exige_g").replace("percentual_garantia_proposta", "perc%").replace("vigencia_garantia_proposta_dias", "vig_dias").replace("vigencia_garantia_termo_inicial", "vig_term").replace("orgao_cnpj", "cnpj").replace("data_sessao_publica", "data_sp"));

const COL_CASO = 28;
const COL_CAMPO = 9;

console.log("\n\n═══ TABELA DE RESULTADOS ═══\n");
// Cabeçalho
let header = pad("CASO", COL_CASO) + "| MODELO    |";
for (const h of cabecalhoCampos) header += pad(h, COL_CAMPO) + "|";
console.log(header);
console.log("-".repeat(header.length));

// Categorias por campo: ok | erro_sistematico | instavel
type Categoria = "ok" | "erro_sistematico" | "instavel";
type CampoCategoria = { caso: string; campo: string; cat: Categoria; valor: string };

let totalAcertos = 0, totalTestes = 0;
const catList: CampoCategoria[] = [];

for (const caso of casos as Array<{ id: string; pular?: boolean }>) {
  if (caso.pular) {
    const linhaPulo = pad(caso.id, COL_CASO) + "| " + "\x1b[90m" + pad("PULADO", 9) + RESET + " |" + "\x1b[90m" + pad("—", COL_CAMPO * CAMPOS_TESTADOS.length) + RESET + "|";
    console.log(linhaPulo);
    continue;
  }
  if (!resultados[caso.id]) continue;
  const modelos = CAMPOS_TESTADOS.flatMap((c) => resultados[caso.id][c].map((r) => r.modelo));
  const modeloUnico = [...new Set(modelos)].join("/");

  let linha = pad(caso.id, COL_CASO) + `| ${pad(modeloUnico, 9)} |`;
  for (const campo of CAMPOS_TESTADOS) {
    const runs = resultados[caso.id][campo];
    const acertos = runs.filter((r) => r.ok).length;
    // Estabilidade: todos os N valores retornados são idênticos (independente de acerto)
    const valoresUnicos = new Set(runs.map((r) => JSON.stringify(r.retornado)));
    const estavel = valoresUnicos.size === 1;
    const correto = acertos === N;

    let cat: Categoria;
    if (correto && estavel) cat = "ok";
    else if (estavel && !correto) cat = "erro_sistematico";
    else cat = "instavel";

    const valorRepresentativo = runs[0]?.retornado;
    catList.push({ caso: caso.id, campo, cat, valor: JSON.stringify(valorRepresentativo) });

    const placar = `${acertos}/${N}${estavel ? "=" : "~"}`;
    const c = cat === "ok" ? "\x1b[32m" : cat === "instavel" ? "\x1b[33m" : "\x1b[31m";
    linha += c + pad(placar, COL_CAMPO) + RESET + "|";
    totalAcertos += acertos;
    totalTestes += N;
  }
  console.log(linha);
}

console.log("-".repeat(header.length));

const totalCampos = catList.length;
const nOk = catList.filter((x) => x.cat === "ok").length;
const nSist = catList.filter((x) => x.cat === "erro_sistematico").length;
const nInst = catList.filter((x) => x.cat === "instavel").length;
const nEstaveis = catList.filter((x) => x.cat !== "instavel").length;

console.log(`\nPROVEDOR     : ${PROVEDOR}`);
console.log(`PRÉ-FILTRO   : ${rotuloPrefiltro}`);
console.log(`PLACAR TOTAL : ${totalAcertos}/${totalTestes} acertos (${((totalAcertos / totalTestes) * 100).toFixed(1)}%)`);
console.log(`ESTABILIDADE : ${nEstaveis}/${totalCampos} campos estáveis (${((nEstaveis / totalCampos) * 100).toFixed(1)}%)`);
console.log(`RETRIES INFRA: ${totalRetriesGlobal} chamada(s) com retry por 429/5xx/rede${totalRetriesGlobal === 0 ? " — infraestrutura estável" : ""}`);
console.log(`  ok               : ${nOk}  (estável + correto)`);
console.log(`  erro_sistematico : ${nSist}  (estável + errado → problema de prompt)`);
console.log(`  instavel         : ${nInst}  (valores variam entre execuções → problema de variância)`);

if (nSist > 0) {
  console.log("\n🔴 ERROS SISTEMÁTICOS (mesmo valor errado sempre — ajustar prompt):");
  for (const x of catList.filter((x) => x.cat === "erro_sistematico")) {
    console.log(`  • ${x.caso}/${x.campo} → sempre retorna ${x.valor}`);
  }
}
if (nInst > 0) {
  console.log("\n🟡 CAMPOS INSTÁVEIS (valores variam — problema de variância):");
  for (const x of catList.filter((x) => x.cat === "instavel")) {
    console.log(`  • ${x.caso}/${x.campo}`);
  }
}

// ── Custo ─────────────────────────────────────────────────────────────────────
// Média por chamada, não soma: o total depende de quantas repetições rodaram,
// então só a média é comparável entre rodadas com --repeticoes diferentes.
if (tokensPorCaso.length > 0) {
  const somaTokens = tokensPorCaso.reduce((s, x) => s + x.tokens, 0);
  const somaOrig = tokensPorCaso.reduce((s, x) => s + x.pagOrig, 0);
  const somaEnv = tokensPorCaso.reduce((s, x) => s + x.pagEnv, 0);
  const mediaTokens = Math.round(somaTokens / tokensPorCaso.length);
  const reducao = somaOrig > 0 ? (1 - somaEnv / somaOrig) * 100 : 0;

  console.log(`\n💰 CUSTO (${tokensPorCaso.length} chamada(s) bem-sucedida(s))`);
  console.log(`  tokens de entrada  : ${mediaTokens} em média por análise`);
  console.log(`  páginas enviadas   : ${somaEnv}/${somaOrig} (redução de ${reducao.toFixed(0)}%)`);
  console.log("  Compare com a rodada de --top-n diferente: menos tokens com o mesmo placar = economia limpa.");
}

// Legenda
console.log("\nLegenda: N/N= ok  N/N~ instável-correto  0/N= erro_sistematico  cor: \x1b[32mverde\x1b[0m=ok \x1b[33mamarelo\x1b[0m=instavel \x1b[31mvermelho\x1b[0m=erro_sistematico");
console.log(`Resultados brutos em: ${RESULTADOS_DIR}/`);
