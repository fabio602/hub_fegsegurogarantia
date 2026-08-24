#!/usr/bin/env -S deno run -A
/**
 * Inspeciona o pré-filtro de páginas nos PDFs de regressão.
 * NÃO chama API nenhuma — apenas extrai texto e simula a seleção.
 * Uso: deno run -A regressao/inspecionar-prefiltro.ts
 */

import { extractText } from "npm:unpdf";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const PDF_DIR = `${DIR}/pdfs`;

const PESO10 = ['garantia de proposta','seguro-garantia','seguro garantia','caucao','fianca bancaria','apolice','art. 58','artigo 58'];
const PESO5  = ['modalidade de garantia','garantia de participacao','percentual da garantia','1% (um por cento)','valor estimado da contratacao','valor global'];
const PESO3T = ['lote','por lote','valor total do lote'];
const MOEDA  = /r\$\s*[\d.]+,\d{2}/gi;
const TOP_N  = 12;

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
const P10N = PESO10.map(norm);
const P5N  = PESO5.map(norm);
const P3N  = PESO3T.map(norm);

function scorePagina(t: string): number {
  let s = 0;
  for (const x of P10N) if (t.includes(x)) s += 10;
  for (const x of P5N)  if (t.includes(x)) s += 5;
  for (const x of P3N)  s += 3 * (t.split(x).length - 1);
  s += 3 * (t.match(MOEDA)?.length ?? 0);
  return s;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

const pdfs = [...Deno.readDirSync(PDF_DIR)]
  .filter(e => e.isFile && e.name.endsWith('.pdf'))
  .map(e => e.name)
  .sort();

console.log('\n=== Inspeção do pré-filtro de páginas ===\n');
console.log(pad('Arquivo', 55) + '| Total | Selecionadas | Redução | Motivo');
console.log('-'.repeat(105));

for (const nome of pdfs) {
  const path = `${PDF_DIR}/${nome}`;
  const pdfBytes = await Deno.readFile(path);

  let pageTexts: string[];
  try {
    const { text } = await extractText(pdfBytes, { mergePages: false }) as { text: string | string[] };
    pageTexts = Array.isArray(text) ? text : [text as string];
  } catch (e) {
    console.log(pad(nome, 55) + `| ERRO ao extrair texto: ${String(e).slice(0, 60)}`);
    continue;
  }

  const totalPags = pageTexts.length;
  const totalChars = pageTexts.reduce((s, t) => s + t.length, 0);
  const charsPerPage = totalPags > 0 ? totalChars / totalPags : 0;

  if (charsPerPage < 50) {
    console.log(pad(nome, 55) + `| ${String(totalPags).padStart(5)} | —            | —       | texto_vazio (${charsPerPage.toFixed(0)} chars/pág)`);
    continue;
  }

  // Pontua cada página com pesos
  const scores = pageTexts.map(t => scorePagina(norm(t)));

  // Top-N + vizinhas ±1 + 3 primeiras páginas
  const ranked = scores.map((s, i) => ({ i, s })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const topIdx = new Set(ranked.slice(0, TOP_N).map(x => x.i));
  const sel = new Set<number>();
  for (let i = 0; i < Math.min(3, totalPags); i++) sel.add(i);
  for (const i of topIdx) {
    if (i > 0) sel.add(i - 1);
    sel.add(i);
    if (i < totalPags - 1) sel.add(i + 1);
  }
  if (sel.size < 5) for (let i = 0; i < Math.min(15, totalPags); i++) sel.add(i);

  const indices = [...sel].sort((a, b) => a - b);
  const reducao = 1 - indices.length / totalPags;
  const pagsSel = indices.map(i => i + 1);
  const motivo = 'ok';
  const enviadas = String(indices.length);
  const reducaoStr = `${(reducao * 100).toFixed(0)}%`;

  console.log(pad(nome, 55) + `| ${String(totalPags).padStart(5)} | ${pad(enviadas, 12)} | ${pad(reducaoStr, 7)} | ${motivo}`);

  // Detalhe das páginas selecionadas com scores
  const LIMITE = 30;
  const pagStr = pagsSel.length <= LIMITE
    ? pagsSel.join(', ')
    : `${pagsSel.slice(0, LIMITE).join(', ')} ... (+${pagsSel.length - LIMITE})`;
  console.log(' '.repeat(56) + `  Páginas: [${pagStr}]`);

  // Páginas com maior pontuação
  const topPags = scores
    .map((s, i) => ({ pag: i + 1, score: s }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (topPags.length > 0) {
    const topStr = topPags.map(x => `p.${x.pag}(${x.score})`).join(' ');
    console.log(' '.repeat(56) + `  Top hits: ${topStr}`);
  }
  console.log();
}
