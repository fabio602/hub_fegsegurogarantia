#!/usr/bin/env -S deno run -A --node-modules-dir=none
/**
 * Bateria de regressão da leitura de edital POR REGRAS (lib/edital) — sem IA, sem rede.
 *
 * Uso:
 *   ~/.deno/bin/deno run -A --node-modules-dir=none regressao/rodar-local.ts [--caso <id>] [--json]
 *
 * Lê os PDFs de regressao/pdfs com o mesmo unpdf usado no navegador, roda
 * extrairEdital e compara campo a campo com o gabarito.json (os mesmos campos e a
 * mesma tolerância do rodar.ts). --json imprime o resultado completo de cada caso.
 * Diferente do rodar.ts, o caso de Curvelo (396 páginas) roda: não há limite de tokens.
 *
 * Depois dos editais, roda as minutas de regressao/minutas contra o gabarito-minutas.json
 * (lib/minuta) e, quando o caso aponta o edital de origem, o Double Check minuta × edital.
 */
import { extractText } from "npm:unpdf";
import { extrairEdital } from "../lib/edital/index.ts";
import { extrairMinuta } from "../lib/minuta/extrairMinuta.ts";
import { conferirMinuta } from "../lib/minuta/conferirMinuta.ts";
import type { EditalData } from "../lib/editalSchema.ts";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const args = Deno.args;
const soCaso = args.includes("--caso") ? args[args.indexOf("--caso") + 1] : null;
const json = args.includes("--json");

const CAMPOS = [
  "valor_global_edital",
  "exige_garantia_proposta",
  "percentual_garantia_proposta",
  "valor_garantia_proposta_calculado",
  "vigencia_garantia_proposta_dias",
  "vigencia_garantia_termo_inicial",
  "orgao_cnpj",
  "data_sessao_publica",
] as const;
type Campo = typeof CAMPOS[number];

function normalizarData(s: string): string {
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]} ${br[4]}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (iso) return `${iso[1]} ${iso[2]}`;
  return s.trim();
}

function comparar(campo: Campo, esperado: unknown, obtido: unknown): boolean {
  if (esperado === null) return obtido == null;
  if (campo === "valor_global_edital" || campo === "valor_garantia_proposta_calculado") {
    return typeof obtido === "number" && Math.abs((esperado as number) - obtido) <= 0.01;
  }
  if (campo === "data_sessao_publica") {
    return obtido != null && normalizarData(String(esperado)) === normalizarData(String(obtido));
  }
  return esperado === obtido;
}

interface Caso { id: string; arquivo: string; esperado: Record<Campo, unknown> }
const gabarito = JSON.parse(await Deno.readTextFile(`${DIR}/gabarito.json`)) as { casos: Caso[] };

let acertos = 0, total = 0;
const editais = new Map<string, EditalData>();
const porCampo = new Map<Campo, { ok: number; n: number }>(CAMPOS.map(c => [c, { ok: 0, n: 0 }]));

for (const caso of gabarito.casos) {
  if (soCaso && caso.id !== soCaso) continue;
  const bytes = await Deno.readFile(`${DIR}/pdfs/${caso.arquivo}`);
  const t0 = performance.now();
  const { text } = await extractText(bytes, { mergePages: false }) as { text: string[] };
  const dados = extrairEdital(text);
  const ms = Math.round(performance.now() - t0);
  editais.set(caso.id, dados);

  console.log(`\n■ ${caso.id}  (${text.length} págs, ${ms} ms)`);
  for (const c of CAMPOS) {
    const esp = caso.esperado[c];
    const obt = (dados as Record<string, unknown>)[c];
    const ok = comparar(c, esp, obt);
    total++; if (ok) acertos++;
    const pc = porCampo.get(c)!; pc.n++; if (ok) pc.ok++;
    const ev = dados._evidencias?.[c];
    console.log(`  ${ok ? "✓" : "✗"} ${c.padEnd(34)} esperado=${JSON.stringify(esp)}  obtido=${JSON.stringify(obt ?? null)}${!ok && ev ? `\n      ↳ p.${ev.pagina}: ${ev.trecho}` : ""}`);
  }
  if (json) console.log(JSON.stringify({ ...dados, _evidencias: undefined }, null, 2));
}

// ── Minutas ────────────────────────────────────────────────────────────────
interface CasoMinuta { arquivo: string; edital_caso?: string; esperado: Record<string, unknown> }
const gabMin = JSON.parse(await Deno.readTextFile(`${DIR}/gabarito-minutas.json`)) as { casos: CasoMinuta[] };
let minOk = 0, minTotal = 0;
if (!soCaso) {
  console.log("\n════ Minutas");
  for (const caso of gabMin.casos) {
    let bytes: Uint8Array;
    try { bytes = await Deno.readFile(`${DIR}/minutas/${caso.arquivo}`); } catch { console.log(`  (sem PDF: ${caso.arquivo})`); continue; }
    const { text } = await extractText(bytes, { mergePages: false }) as { text: string[] };
    const m = extrairMinuta(text);
    const erros: string[] = [];
    for (const [k, esp] of Object.entries(caso.esperado)) {
      const obt = (m as unknown as Record<string, unknown>)[k];
      const ok = typeof esp === "number" ? typeof obt === "number" && Math.abs(esp - obt) <= 0.01 : esp === obt;
      minTotal++; if (ok) minOk++; else erros.push(`${k}: esperado=${JSON.stringify(esp)} obtido=${JSON.stringify(obt)}`);
    }
    console.log(`  ${erros.length ? "✗" : "✓"} ${caso.arquivo}${erros.map(e => `\n      ${e}`).join("")}`);
    const ed = caso.edital_caso ? editais.get(caso.edital_caso) : undefined;
    if (ed) {
      const r = conferirMinuta(m, ed);
      console.log(`      Double Check × ${caso.edital_caso}: ${r.veredicto} — ${r.resumo}`);
      for (const i of r.itens) console.log(`        [${i.status}] ${i.campo}: ${i.encontrado}${i.observacao ? ` (${i.observacao})` : ""}`);
    }
  }
  acertos += minOk; total += minTotal;
}

console.log(`\n══ Placar: ${acertos}/${total} campos corretos${minTotal ? ` (editais ${acertos - minOk}/${total - minTotal}, minutas ${minOk}/${minTotal})` : ""}`);
for (const [c, { ok, n }] of porCampo) if (n) console.log(`   ${c.padEnd(34)} ${ok}/${n}`);
if (acertos < total) Deno.exitCode = 1;
