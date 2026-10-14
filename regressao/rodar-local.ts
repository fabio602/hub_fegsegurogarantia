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
import { extrairEdital, finalizarEdital } from "../lib/edital/index.ts";
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
  "data_limite_propostas",
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
  if (campo === "data_sessao_publica" || campo === "data_limite_propostas") {
    return obtido != null && normalizarData(String(esperado)) === normalizarData(String(obtido));
  }
  return esperado === obtido;
}

interface Caso { id: string; arquivo: string; esperado: Record<Campo, unknown>; esperado_lotes?: { numero: number; valor: number }[] }
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
    // Campo fora do "esperado" não é conferido nesse caso (o gabarito cresce campo a campo)
    if (!(c in caso.esperado)) continue;
    const esp = caso.esperado[c];
    const obt = (dados as Record<string, unknown>)[c];
    const ok = comparar(c, esp, obt);
    total++; if (ok) acertos++;
    const pc = porCampo.get(c)!; pc.n++; if (ok) pc.ok++;
    const ev = dados._evidencias?.[c];
    console.log(`  ${ok ? "✓" : "✗"} ${c.padEnd(34)} esperado=${JSON.stringify(esp)}  obtido=${JSON.stringify(obt ?? null)}${!ok && ev ? `\n      ↳ p.${ev.pagina}: ${ev.trecho}` : ""}`);
  }
  if (caso.esperado_lotes) {
    const obtidos = (dados.lotes ?? []).map(l => ({ numero: l.numero, valor: l.valor }));
    const ok = JSON.stringify(obtidos) === JSON.stringify(caso.esperado_lotes);
    total++; if (ok) acertos++;
    console.log(`  ${ok ? "✓" : "✗"} ${"lotes".padEnd(34)} esperado=${JSON.stringify(caso.esperado_lotes.map(l => l.valor))}  obtido=${JSON.stringify(obtidos.map(l => l.valor))}`);
  }
  if (json) console.log(JSON.stringify({ ...dados, _evidencias: undefined }, null, 2));
}

// ── Minutas ────────────────────────────────────────────────────────────────
interface Conferencia { _nota?: string; lotes_selecionados: number[] | null; veredicto: string; itens: Record<string, string> }
interface CasoMinuta { arquivo: string; edital_caso?: string; esperado: Record<string, unknown>; conferencias?: Conferencia[] }

/** Confere um Double Check contra o esperado; devolve a lista de diferenças. */
function checarConferencia(r: ReturnType<typeof conferirMinuta>, esp: { veredicto: string; itens: Record<string, string> }): string[] {
  const erros: string[] = [];
  if (r.veredicto !== esp.veredicto) erros.push(`veredicto: esperado=${esp.veredicto} obtido=${r.veredicto}`);
  for (const [campo, status] of Object.entries(esp.itens)) {
    const item = r.itens.find(i => i.campo === campo);
    if (item?.status !== status) erros.push(`${campo}: esperado=${status} obtido=${item?.status ?? "(ausente)"}${item?.observacao ? ` — ${item.observacao}` : ""}`);
  }
  return erros;
}
let confOk = 0, confTotal = 0;
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
      for (const conf of caso.conferencias ?? []) {
        const edSel = finalizarEdital({ ...ed, lotes_selecionados: conf.lotes_selecionados });
        const r = conferirMinuta(m, edSel);
        const erros = checarConferencia(r, conf);
        confTotal++; if (!erros.length) confOk++;
        console.log(`      ${erros.length ? "✗" : "✓"} Double Check × ${caso.edital_caso} (lotes ${conf.lotes_selecionados?.join(",") ?? "todos"}): ${r.veredicto}${erros.map(e => `\n          ${e}`).join("")}`);
        if (json) for (const i of r.itens) console.log(`          [${i.status}] ${i.campo}: ${i.encontrado}${i.observacao ? ` (${i.observacao})` : ""}`);
      }

      // Casos adulterados: a mesma minuta com um erro plantado de propósito.
      // Cada um prova que a regra correspondente pega o problema.
      if (caso.arquivo === "allseg-9180.pdf") {
        const sel1 = finalizarEdital({ ...ed, lotes_selecionados: [1] });
        const sinteticos: { nome: string; minuta: typeof m; edital?: EditalData; veredicto: string; itens: Record<string, string> }[] = [
          { nome: "CNPJ do segurado com dígito errado", minuta: { ...m, segurado_cnpj: "13.677.687/0001-47", cnpjs: ["08.588.004/0001-44", "13.677.687/0001-47"] },
            veredicto: "NAO EMITIR", itens: { "Segurado": "divergencia", "CNPJs da minuta": "divergencia" } },
          { nome: "CNPJ do tomador com dígito errado", minuta: { ...m, tomador_cnpj: "08.588.004/0001-45" },
            veredicto: "NAO EMITIR", itens: { "Segurado": "ok", "CNPJs da minuta": "divergencia" } },
          { nome: "início às 24h do dia da sessão (só vale no dia seguinte)", minuta: { ...m, vigencia_inicio: "28/08/2026" },
            veredicto: "NAO EMITIR", itens: { "Início da cobertura": "divergencia" } },
          { nome: "início 00:00 do dia da sessão (vale 11h30 antes)", minuta: { ...m, vigencia_inicio: "28/08/2026", vigencia_inicio_24h: false },
            veredicto: "PODE EMITIR", itens: { "Início da cobertura": "ok" } },
          { nome: "data impossível (31/02)", minuta: { ...m, vigencia_fim: "31/02/2027" },
            veredicto: "NAO EMITIR", itens: { "Início da cobertura": "divergencia", "Prazo da vigência": "divergencia" } },
          { nome: "lote 2 marcado, minuta do lote 1 (acima do exigido)", minuta: m, edital: finalizarEdital({ ...ed, lotes_selecionados: [2] }),
            veredicto: "PODE EMITIR", itens: { "Valor da garantia": "atencao_favoravel" } },
          { nome: "valor que não bate com nenhum lote", minuta: { ...m, valor_garantia: 1000 },
            veredicto: "NAO EMITIR", itens: { "Valor da garantia": "divergencia" } },
          { nome: "edital errado no objeto", minuta: { ...m, edital_refs: ["021/2026"] }, edital: sel1,
            veredicto: "NAO EMITIR", itens: { "Edital no objeto": "divergencia" } },
          { nome: "minuta de contrato no lugar de licitante", minuta: { ...m, modalidade: "contrato", modalidade_texto: "EXECUTANTE" }, edital: sel1,
            veredicto: "NAO EMITIR", itens: { "Modalidade": "divergencia" } },
          { nome: "fim antes do mínimo (vigência exigida de 120 dias)", minuta: m,
            edital: finalizarEdital({ ...sel1, vigencia_garantia_proposta_dias: 120, vigencia_garantia_termo_inicial: "sessao_publica", _editados: ["vigencia_garantia_proposta_dias", "vigencia_garantia_termo_inicial"] }),
            veredicto: "NAO EMITIR", itens: { "Prazo da vigência": "divergencia" } },
        ];
        for (const t of sinteticos) {
          const r = conferirMinuta(t.minuta, t.edital ?? sel1);
          const erros = checarConferencia(r, t);
          confTotal++; if (!erros.length) confOk++;
          console.log(`      ${erros.length ? "✗" : "✓"} adulterado: ${t.nome} → ${r.veredicto}${erros.map(e => `\n          ${e}`).join("")}`);
        }
      }
    }
  }
  acertos += minOk + confOk; total += minTotal + confTotal;
}

console.log(`\n══ Placar: ${acertos}/${total} verificações corretas${minTotal ? ` (editais ${acertos - minOk - confOk}/${total - minTotal - confTotal}, minutas ${minOk}/${minTotal}, Double Check ${confOk}/${confTotal})` : ""}`);
for (const [c, { ok, n }] of porCampo) if (n) console.log(`   ${c.padEnd(34)} ${ok}/${n}`);
if (acertos < total) Deno.exitCode = 1;
