/**
 * Modelo de documento usado por todas as regras de extração.
 *
 * Recebe o texto de cada página (como sai do unpdf/OCR) e monta:
 *  - `texto`: as linhas úteis concatenadas, SEM cabeçalho/rodapé repetido;
 *  - `busca`: o mesmo texto em minúsculas e sem acento, com o MESMO comprimento,
 *    para as regras casarem regex simples e devolverem trechos do texto original;
 *  - `linhas`: cada linha com a página de origem, para achar a página de um trecho.
 *
 * Arquivo puro: sem DOM, sem rede, sem dependência. Roda no navegador e no Deno.
 */

export interface Linha {
  /** Texto original da linha */
  texto: string;
  /** Página (1-based) */
  pagina: number;
  /** Posição do início da linha em `Documento.texto` */
  inicio: number;
}

export interface Documento {
  texto: string;
  busca: string;
  linhas: Linha[];
  totalPaginas: number;
  /** Linhas descartadas por serem cabeçalho/rodapé — o CNPJ do órgão costuma estar aqui */
  cabecalhos: string[];
}

/** Minúscula e sem acento, preservando o comprimento (1 caractere → 1 caractere). */
export function dobrar(s: string): string {
  let out = '';
  for (const c of s) {
    const base = c.normalize('NFD')[0] ?? c;
    const low = base.toLowerCase();
    // toLowerCase pode mudar o comprimento em casos raros (ex.: 'İ'); preserva o original nesses casos
    out += low.length === c.length ? low : c;
  }
  return out;
}

/** Assinatura de uma linha para detectar repetição entre páginas (dígitos viram #). */
function assinatura(linha: string): string {
  return dobrar(linha).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

export function montarDocumento(paginas: string[], opcoes: { removerRepetidas?: boolean } = {}): Documento {
  const porPagina = paginas.map(p => (p ?? '').replace(/\r/g, '').split('\n'));
  const remover = opcoes.removerRepetidas ?? true;

  // Linha que aparece em pelo menos 30% das páginas (mínimo 3) é cabeçalho/rodapé.
  // Em apólices isso é desligado: rótulos como "INÍCIO VIGÊNCIA" se repetem em várias vias.
  const contagem = new Map<string, number>();
  for (const linhas of porPagina) {
    const vistas = new Set<string>();
    for (const l of linhas) {
      const a = assinatura(l);
      if (a.length < 4 || vistas.has(a)) continue;
      vistas.add(a);
      contagem.set(a, (contagem.get(a) ?? 0) + 1);
    }
  }
  const limiar = Math.max(3, Math.ceil(paginas.length * 0.3));
  const repetidas = new Set(remover ? [...contagem].filter(([, n]) => n >= limiar).map(([a]) => a) : []);

  const linhas: Linha[] = [];
  const cabecalhos: string[] = [];
  let texto = '';
  porPagina.forEach((ls, i) => {
    for (const l of ls) {
      if (repetidas.has(assinatura(l))) { cabecalhos.push(l); continue; }
      if (!l.trim()) continue;
      linhas.push({ texto: l, pagina: i + 1, inicio: texto.length });
      texto += l + '\n';
    }
  });

  return { texto, busca: dobrar(texto), linhas, totalPaginas: paginas.length, cabecalhos };
}

/** Página onde está a posição `pos` de `doc.texto`. */
export function paginaDe(doc: Documento, pos: number): number {
  let lo = 0, hi = doc.linhas.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (doc.linhas[mid].inicio <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return doc.linhas[ans]?.pagina ?? 1;
}

/** Trecho legível em volta de [ini, fim): uma linha só, no máximo `max` caracteres. */
export function trecho(doc: Documento, ini: number, fim: number, max = 200): string {
  let a = ini, b = fim;
  const t = doc.texto;
  // Ponto só encerra frase quando vem seguido de espaço ("1.393.413,10" não é fim de frase)
  const fimDeFrase = (i: number) => t[i] === ';' || (t[i] === '.' && (i + 1 >= t.length || /\s/.test(t[i + 1])));
  // Expande até o começo da frase/linha e até o fim da frase, sem passar do limite
  while (a > 0 && ini - a < 80 && !(/[:\n]/.test(t[a - 1]) || fimDeFrase(a - 1))) a--;
  while (b < t.length && b - fim < 120 && !fimDeFrase(b)) b++;
  if (b < t.length && fimDeFrase(b)) b++;
  let s = doc.texto.slice(a, b).replace(/\s+/g, ' ').trim();
  if (s.length > max) {
    // Mantém a parte que contém o achado
    const rel = ini - a;
    const start = Math.max(0, Math.min(rel - 40, s.length - max));
    s = (start > 0 ? '…' : '') + s.slice(start, start + max).trim() + (start + max < s.length ? '…' : '');
  }
  return s;
}

/** Todas as ocorrências de `re` (precisa da flag g) em `doc.busca`. */
export function ocorrencias(doc: Documento, re: RegExp, de = 0, ate = doc.busca.length): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  r.lastIndex = de;
  let m: RegExpExecArray | null;
  while ((m = r.exec(doc.busca)) && m.index < ate) {
    out.push(m);
    if (m[0].length === 0) r.lastIndex++;
  }
  return out;
}
