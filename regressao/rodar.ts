#!/usr/bin/env -S deno run -A
/**
 * Bateria de regressão do analyze-edital.
 * Uso: deno run -A regressao/rodar.ts [--repeticoes N]
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

async function chamarEdgeFunction(b64: string, arquivo: string): Promise<{
  data: Record<string, unknown>;
  sucesso: boolean;
  erro?: string;
  elapsed_ms: number;
}> {
  const inicio = Date.now();
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
      }),
      signal: AbortSignal.timeout(300_000), // 5 min
    });
    const elapsed_ms = Date.now() - inicio;
    const json = await res.json();
    if (!json.success) return { data: json.data ?? {}, sucesso: false, erro: json.error, elapsed_ms };
    return { data: json.data ?? {}, sucesso: true, elapsed_ms };
  } catch (e) {
    return { data: {}, sucesso: false, erro: String(e), elapsed_ms: Date.now() - inicio };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, { default: { repeticoes: 3 } });
const N = Math.max(1, Number(args.repeticoes));

console.log(`\n=== Bateria de Regressão — analyze-edital (${N} repetições por caso) ===\n`);

const gabarito = JSON.parse(await Deno.readTextFile(GABARITO_PATH));
const casos = gabarito.casos as Array<{
  id: string; arquivo: string; orgao: string; esperado: Record<string, unknown>;
}>;

await Deno.mkdir(RESULTADOS_DIR, { recursive: true });

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
    const { data, sucesso, erro, elapsed_ms } = await chamarEdgeFunction(b64, caso.arquivo);

    const modelo = String(data._modelo ?? "desconhecido");
    console.log(`    ${sucesso ? "✓" : "✗"} ${elapsed_ms}ms | modelo:${modelo}`);
    if (!sucesso) console.error(`    Erro: ${erro}`);

    // Grava resultado bruto
    const ts = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
    await Deno.writeTextFile(
      `${RESULTADOS_DIR}/${caso.id}-${ts}-r${r + 1}.json`,
      JSON.stringify({ caso: caso.id, repeticao: r + 1, elapsed_ms, sucesso, erro, modelo, data }, null, 2)
    );

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

console.log(`\nPLACAR TOTAL : ${totalAcertos}/${totalTestes} acertos (${((totalAcertos / totalTestes) * 100).toFixed(1)}%)`);
console.log(`ESTABILIDADE : ${nEstaveis}/${totalCampos} campos estáveis (${((nEstaveis / totalCampos) * 100).toFixed(1)}%)`);
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

// Legenda
console.log("\nLegenda: N/N= ok  N/N~ instável-correto  0/N= erro_sistematico  cor: \x1b[32mverde\x1b[0m=ok \x1b[33mamarelo\x1b[0m=instavel \x1b[31mvermelho\x1b[0m=erro_sistematico");
console.log(`Resultados brutos em: ${RESULTADOS_DIR}/`);
