#!/usr/bin/env -S deno run --allow-read --allow-net --node-modules-dir=none
/**
 * Diagnóstico: imprime o texto bruto que o unpdf extrai de um PDF,
 * focado nas regiões de cobertura e parcelamento.
 *
 * Uso:
 *   ~/.deno/bin/deno run --allow-read --allow-net --node-modules-dir=none \
 *     regressao/ver-texto.ts <arquivo.pdf>
 *
 * Exemplo:
 *   ~/.deno/bin/deno run --allow-read --allow-net --node-modules-dir=none \
 *     regressao/ver-texto.ts regressao/minutas/allseg-9180.pdf
 */

import { extractText } from "npm:unpdf";

const path = Deno.args[0];
if (!path) { console.error("Uso: ver-texto.ts <arquivo.pdf>"); Deno.exit(1); }

const bytes = await Deno.readFile(path);
const { text } = await extractText(bytes, { mergePages: false }) as { text: string | string[] };
const pages = Array.isArray(text) ? text : [text as string];
const txt = pages.join("\n<<<QUEBRA DE PÁGINA>>>\n");

// Termos que delimitam as seções que nos interessam
const TERMOS = [
  "COBERTURAS CONTRATADAS",
  "IMPORTÂNCIA SEGURADA",
  "DEMONSTRATIVO",
  "PRÊMIO",
  "PARCEL",
  "LMG",
];

console.log(`\n=== TEXTO COMPLETO (${txt.length} chars, ${pages.length} páginas) ===\n`);

// Imprime janelas de 40 linhas em torno de cada termo encontrado
const linhas = txt.split("\n");
const impressas = new Set<number>();
for (let i = 0; i < linhas.length; i++) {
  const linha = linhas[i];
  if (TERMOS.some(t => linha.toUpperCase().includes(t))) {
    const ini = Math.max(0, i - 5);
    const fim = Math.min(linhas.length - 1, i + 35);
    if (!impressas.has(ini)) {
      console.log(`\n--- linhas ${ini + 1}–${fim + 1} (termo '${TERMOS.find(t => linha.toUpperCase().includes(t))}' na linha ${i + 1}) ---`);
      for (let j = ini; j <= fim; j++) {
        console.log(`${String(j + 1).padStart(4)}: ${JSON.stringify(linhas[j])}`);
        impressas.add(j);
      }
    }
  }
}

console.log("\n=== FIM DO DIAGNÓSTICO ===");
