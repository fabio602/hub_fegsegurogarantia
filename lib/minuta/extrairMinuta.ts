/**
 * Leitura de minuta/apólice de seguro garantia por regras — sem IA, sem rede.
 *
 * Em vez de um extrator por seguradora (o antigo regressao/extrair-minuta.ts dependia
 * do nome do arquivo e do espaçamento do texto), aqui as regras são genéricas:
 *  - tabela de coberturas: cabeçalho com 2+ rótulos ("IMPORTÂNCIA SEGURADA  PRÊMIO")
 *    e a linha de valores logo abaixo, casados pela ordem;
 *  - rótulo seguido de valor ("Prêmio Total R$ 210,18", "LMG: R$ 22.000,00");
 *  - segurado e tomador achados pelo tipo do nome (órgão público x empresa) e o CNPJ
 *    mais próximo desse nome;
 *  - vigência = par de datas próximas com palavra de vigência por perto.
 * Só olha a parte da frente do documento (antes das condições gerais/contratuais).
 */
import { montarDocumento, ocorrencias, paginaDe, trecho, type Documento } from '../edital/documento.ts';
import { parseBRL } from '../edital/numeros.ts';
import type { Evidencia } from '../editalSchema.ts';

export interface MinutaExtraida {
  seguradora: string | null;
  tipo_documento: 'apolice' | 'endosso' | 'cotacao' | 'minuta';
  numero: string | null;
  tomador: string | null;
  tomador_cnpj: string | null;
  segurado: string | null;
  segurado_cnpj: string | null;
  /** Todos os CNPJs da frente do documento (sem corretora e seguradora) */
  cnpjs: string[];
  valor_garantia: number | null;
  premio: number | null;
  vigencia_inicio: string | null; // DD/MM/YYYY
  vigencia_fim: string | null;
  /**
   * Convenção de horário do início: true = "às 24h" / "23:59h" da data inicial (a cobertura
   * começa na virada para o dia seguinte); false = "a partir das 00:00h"; null = não informa.
   */
  vigencia_inicio_24h: boolean | null;
  modalidade: 'licitante' | 'contrato' | null;
  modalidade_texto: string | null;
  /** Números de edital/pregão citados no objeto ("013/2026") */
  edital_refs: string[];
  /** Só na modalidade contrato: número do contrato garantido ("040/2026", "072/2026/AGEVAP") */
  numero_contrato: string | null;
  /** Só quando a apólice DESCREVE o objeto ("que tem por objeto a prestação de…"); remissão pura fica null */
  objeto_contrato: string | null;
  /** Valor do contrato principal, só quando escrito com rótulo ("valor do contrato R$ …") */
  valor_contrato: number | null;
  evidencias: Record<string, Evidencia>;
}

const CNPJ_FG = '56.123.874/0001-90';
const RE_CNPJ = /\d{2}\.\d{3}\.\d{3}\s?\/\s?\d{4}\s?-\s?\d{2}/g;
const limpaCnpj = (s: string) => s.replace(/\s/g, '');
const RE_DINHEIRO = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,3}(?:\.\d{3})+,\d{2}/g;

const SEGURADORAS: { re: RegExp; nome: string }[] = [
  { re: /pottencial/g, nome: 'Pottencial Seguradora S/A' },
  { re: /allseg/g, nome: 'Allseg Seguradora S/A' },
  { re: /junto\s+seguros/g, nome: 'Junto Seguros S.A.' },
  { re: /sancor/g, nome: 'Sancor Seguros do Brasil S.A.' },
  { re: /\baxa\b/g, nome: 'AXA Seguros S.A.' },
  { re: /tokio\s+marine/g, nome: 'Tokio Marine Seguradora S.A.' },
  { re: /fairfax/g, nome: 'Fairfax Brasil Seguros Corporativos S.A.' },
  { re: /\bbmg\s+seguros/g, nome: 'BMG Seguros S.A.' },
  { re: /excelsior/g, nome: 'Excelsior Seguros S.A.' },
  { re: /zurich/g, nome: 'Zurich Minas Brasil Seguros S.A.' },
  { re: /berkley/g, nome: 'Berkley International do Brasil Seguros S.A.' },
  { re: /swiss\s+re/g, nome: 'Swiss Re Corporate Solutions Brasil Seguros S.A.' },
  { re: /\bchubb\b/g, nome: 'Chubb Seguros Brasil S.A.' },
  { re: /mapfre/g, nome: 'Mapfre Seguros Gerais S.A.' },
  { re: /porto\s+seguro/g, nome: 'Porto Seguro Companhia de Seguros Gerais' },
  { re: /sompo/g, nome: 'Sompo Seguros S.A.' },
  { re: /austral\s+seguradora/g, nome: 'Austral Seguradora S.A.' },
  { re: /\bessor\b/g, nome: 'Essor Seguros S.A.' },
  { re: /\bavla\b/g, nome: 'Avla Seguros Brasil S.A.' },
  { re: /\bezze\b/g, nome: 'Ezze Seguros S.A.' },
  { re: /\bkovr\b/g, nome: 'Kovr Seguradora S.A.' },
  { re: /\bargo\s+seguros/g, nome: 'Argo Seguros Brasil S.A.' },
  { re: /yelum|liberty\s+seguros/g, nome: 'Yelum Seguradora S.A.' },
  { re: /infinite\s+seguradora/g, nome: 'Infinite Seguradora S.A.' },
  { re: /newe\s+seguros/g, nome: 'Newe Seguros S.A.' },
  { re: /too\s+seguros/g, nome: 'Too Seguros S.A.' },
  { re: /sombrero/g, nome: 'Sombrero Seguros S.A.' },
];

/** Nome de órgão/entidade pública ou associação (candidato a segurado). */
const RE_ORGAO = /\b(municipio|prefeitura|secretaria|camara|fundo|fundacao|instituto|universidade|centro\s+federal|tribunal|trt|tre|trf|governo|estado\s+d[eoa]|associacao|consorcio|autarquia|servico\s+autonomo|companhia|ministerio|departamento|agencia|superintendencia|uniao|comando|exercito|marinha|aeronautica|policia|hospital|empresa\s+(?:municipal|estadual|publica|brasileira)|conselho|assembleia|defensoria|procuradoria)\b/;
/** Sufixo de empresa (candidato a tomador). */
const RE_EMPRESA = /\b(ltda|eireli|s\/a|s\.a\.?|\bsa\b|me|epp|slu|mei)\s*\.?$/;
const RE_ROTULO = /^(nome|cpf|cnpj|endereco|cep|bairro|cidade|uf|complemento|telefone|e-?mail|sede|numero|nome fantasia|registro|corretor|corretora)\b|:\s*$/;

function linhaDe(doc: Documento, pos: number): number {
  let lo = 0, hi = doc.linhas.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (doc.linhas[mid].inicio <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const buscaLinha = (doc: Documento, i: number) => {
  const l = doc.linhas[i];
  return doc.busca.slice(l.inicio, l.inicio + l.texto.length);
};

/** Tira prefixos de rótulo e CNPJ colado: "CPF OU CNPJ:MUNICIPIO DE JAPI" → "MUNICIPIO DE JAPI". */
function limparNome(s: string): string {
  return s
    .replace(RE_CNPJ, ' ')
    // "SERVICOS DE LIMPEZA LTDA CPF/CNPJ 40.631…" → o rótulo vem DEPOIS do nome
    .replace(/\s+(?:cpf\s*(?:ou|\/)\s*cnpj|cnpj)\s*(?:n[ºªo°]*)?\s*:?\s*$/i, '')
    // "Tomador ZK CONSERVACAO E" / "Segurado OURO BRANCO CAMARA": rótulo sem dois-pontos
    .replace(/^\s*(?:Tomador|Segurado)\s+(?=[A-ZÀ-Þ]{2})/, '')
    .replace(/^.*?(?:cpf\s*(?:ou|\/)\s*cnpj|cnpj)\s*(?:n[ºªo°]*)?\s*:?/i, '')
    .replace(/^\s*(?:nome(?:\s+do\s+(?:segurado|tomador))?|segurado|tomador|ao\s+segurado)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Nome { nome: string; linha: number }

export function extrairMinuta(paginas: string[]): MinutaExtraida {
  const doc = montarDocumento(paginas, { removerRepetidas: false });
  const ev: Record<string, Evidencia> = {};
  const marcar = (campo: string, ini: number, fim: number) => {
    ev[campo] = { trecho: trecho(doc, ini, fim, 160), pagina: paginaDe(doc, ini) };
  };

  // Frente do documento: até as condições gerais/contratuais (que trazem exemplos e cláusulas)
  let corte = doc.texto.length;
  for (const m of ocorrencias(doc, /^\s*condicoes\s+(?:gerais|contratuais)|^\s*1\.\s*definicoes/gm)) {
    if (m.index >= 1500) { corte = m.index; break; }
  }
  const frente = doc.busca.slice(0, corte);
  const ultimaLinha = linhaDe(doc, corte);

  // ── Seguradora ────────────────────────────────────────────────────────────
  let seguradora: string | null = null, melhor = 0;
  for (const s of SEGURADORAS) {
    const n = (doc.busca.match(s.re) ?? []).length;
    if (n > melhor) { melhor = n; seguradora = s.nome; }
  }
  const reSeg = seguradora ? SEGURADORAS.find(s => s.nome === seguradora)!.re : null;

  // ── Tipo e número ─────────────────────────────────────────────────────────
  const topo = frente.slice(0, 800);
  const tipo_documento: MinutaExtraida['tipo_documento'] =
    /resumo\s+da\s+cotacao|cotacao\s+n\b/.test(topo) ? 'cotacao'
      : /\bminuta\b/.test(topo) ? 'minuta'
      : /endosso\s+de\s+(?:majoracao|alteracao|prorrogacao)|presente\s+endosso/.test(frente) ? 'endosso'
      : 'apolice';
  let numero: string | null = null;
  const num = ocorrencias(doc, /(?:apolice(?:\s+(?:de\s+)?seguro\s+garantia)?|cotacao|minuta)\s*(?:n[º°o.]*|numero)\s*:?\s*([0-9][0-9.\-/]{5,}[0-9])/g, 0, corte)[0]
    ?? ocorrencias(doc, /cotacao\s+n\.?\s*([a-z]{0,4}\d{6,})/g, 0, corte)[0];
  if (num) numero = doc.texto.slice(num.index, num.index + num[0].length).match(/[A-Z]{0,4}[0-9][0-9.\-/]*[0-9]\s*$/i)?.[0].trim() ?? null;

  // ── CNPJs da frente (sem corretora e sem seguradora) ─────────────────────
  type Cnpj = { cnpj: string; pos: number; linha: number };
  const cnpjs: Cnpj[] = [];
  for (const m of doc.texto.slice(0, corte).matchAll(RE_CNPJ)) {
    const c = limpaCnpj(m[0]);
    if (c === CNPJ_FG) continue;
    const linha = linhaDe(doc, m.index!);
    const ctx = doc.busca.slice(Math.max(0, m.index! - 120), m.index! + 40);
    const daSeguradora = (reSeg && new RegExp(reSeg.source).test(buscaLinha(doc, linha)))
      || /dados\s+da\s+seguradora|seguradora\s*\n?\s*\S*\s*\n?\s*cnpj|seguros\s+s\.?\s*a\.?\s*[-–]?\s*cnpj/.test(ctx)
      || (reSeg != null && new RegExp(reSeg.source).test(doc.busca.slice(Math.max(0, m.index! - 80), m.index!)));
    if (daSeguradora) continue;
    cnpjs.push({ cnpj: c, pos: m.index!, linha });
  }

  const cnpjPerto = (linha: number, excluir: string | null): Cnpj | null => {
    let best: Cnpj | null = null, dist = Infinity;
    for (const c of cnpjs) {
      if (c.cnpj === excluir) continue;
      const d = Math.abs(c.linha - linha) + (c.linha < linha ? 0.5 : 0);
      if (d <= 4 && d < dist) { dist = d; best = c; }
    }
    return best;
  };

  // ── Nomes candidatos ──────────────────────────────────────────────────────
  const orgaos: Nome[] = [], empresas: Nome[] = [];
  for (let i = 0; i <= ultimaLinha && i < doc.linhas.length; i++) {
    const nome = limparNome(doc.linhas[i].texto);
    if (nome.length < 4 || nome.length > 140 || /\d{3,}/.test(nome.replace(/\d{2}ª/g, ''))) continue;
    const dob = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (RE_ROTULO.test(dob) || /corretor|seguradora|seguros\s+s|susep/.test(dob)) continue;
    if (reSeg && new RegExp(reSeg.source).test(dob)) continue;
    // Linha precisa ser "nome": maioria de letras maiúsculas
    const letras = nome.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letras.length < 4 || letras.replace(/[^A-ZÀ-Þ]/g, '').length / letras.length < 0.7) continue;
    // Nome quebrado em duas linhas: junta a continuação (maiúsculas, sem rótulo nem número)
    let completo = nome;
    // "MUNICIPAL CPF/CNPJ 23.964.950/0001-31": a continuação vem antes do rótulo do CNPJ
    const prox = limparNome(doc.linhas[i + 1]?.texto ?? '').trim();
    const proxDob = prox.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (prox && i + 1 <= ultimaLinha && !/\d/.test(prox) && prox.length < 80 && prox === prox.toUpperCase()
        && /[A-Z]{3}/.test(prox) && !RE_ROTULO.test(proxDob) && !RE_ORGAO.test(proxDob) && !RE_EMPRESA.test(proxDob)
        && !/seguradora|seguros|corretor|dados|apolice|modalidade|objeto|cobertura/.test(proxDob)) {
      completo = `${nome} ${prox}`;
    }
    // Nome quebrado com o sufixo só na 2ª linha ("…DE PRODUTOS" / "HOSPITALARES LTDA"):
    // junta a linha anterior quando ela é só nome em maiúsculas, sem rótulo nem número
    if (RE_EMPRESA.test(dob) && i > 0) {
      const ant = limparNome(doc.linhas[i - 1].texto);
      const antDob = ant.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (ant.length >= 3 && ant.length < 100 && !/\d/.test(ant) && !/:/.test(ant) && ant === ant.toUpperCase()
          && /[A-Z]{2}/.test(ant) && !RE_ROTULO.test(antDob) && !RE_ORGAO.test(antDob) && !RE_EMPRESA.test(antDob)
          && !/seguradora|seguros|corretor|dados|apolice|modalidade|objeto|cobertura|garantia|tomador|segurado/.test(antDob)) {
        completo = `${ant} ${completo}`;
      }
    }
    if (RE_EMPRESA.test(dob)) empresas.push({ nome: completo, linha: i });
    else if (RE_ORGAO.test(dob)) orgaos.push({ nome: completo.replace(/^A\s+(?=\S)/, ''), linha: i });
    else if (/^a\s/.test(dob) && RE_ORGAO.test(dob.slice(2))) orgaos.push({ nome: completo.slice(2), linha: i });
  }

  // Rótulo "segurado"/"tomador" no começo da linha, para desempatar
  const rotulos = (re: RegExp) => doc.linhas.slice(0, ultimaLinha + 1)
    .map((_, i) => i).filter(i => re.test(buscaLinha(doc, i)));
  const rotSeg = rotulos(/^\s*(?:dados\s+do\s+segurado|nome\s+do\s+segurado|ao\s+segurado|segurado\b)/);
  const rotTom = rotulos(/^\s*(?:dados\s+do\s+tomador|nome\s+do\s+tomador|tomador\b)/);
  // Prefere o nome que tem um CNPJ por perto (a ficha da parte), depois o mais perto do rótulo
  const pertoDe = (lista: Nome[], rot: number[]) => lista
    .map(n => ({ n, c: cnpjPerto(n.linha, null) ? 0 : 1, d: Math.min(...rot.map(r => Math.abs(r - n.linha)), 99) }))
    .sort((a, b) => a.c - b.c || a.d - b.d || a.n.linha - b.n.linha)[0]?.n ?? null;

  const seg = pertoDe(orgaos, rotSeg);
  const tom = pertoDe(empresas, rotTom);

  let segurado_cnpj = seg ? cnpjPerto(seg.linha, null)?.cnpj ?? null : null;
  let tomador_cnpj = tom ? cnpjPerto(tom.linha, segurado_cnpj)?.cnpj ?? null : null;
  if (!segurado_cnpj && rotSeg.length) {
    const c = cnpjs.find(x => x.linha > rotSeg[0] && x.linha - rotSeg[0] <= 6 && x.cnpj !== tomador_cnpj);
    segurado_cnpj = c?.cnpj ?? null;
  }
  if (!tomador_cnpj && rotTom.length) {
    const c = cnpjs.find(x => x.linha > rotTom[0] && x.linha - rotTom[0] <= 6 && x.cnpj !== segurado_cnpj);
    tomador_cnpj = c?.cnpj ?? null;
  }
  if (seg) ev.segurado = { trecho: doc.linhas[seg.linha].texto.trim(), pagina: doc.linhas[seg.linha].pagina };
  if (tom) ev.tomador = { trecho: doc.linhas[tom.linha].texto.trim(), pagina: doc.linhas[tom.linha].pagina };

  // ── Valores: importância segurada (LMG) e prêmio ─────────────────────────
  const RE_IS = /limite\s+maximo\s+de\s+garantia|limite\s+maximo\s+garantido|\(?\bl\.?\s?m\.?\s?g\.?\b\)?|importancia\s+segurada|valor\s+is\b|valor\s+da\s+garantia|valor\s+garantido|limite\s+maximo\s+de\s+indenizacao|\blmi\b/g;
  const RE_PREMIO = /premio\s+total|valor\s+do\s+premio|premio\s+liquido|\bpremio\b/g;
  const votosIS = new Map<number, { peso: number; pos: number }>();
  const votosPremio = new Map<number, { peso: number; pos: number }>();
  const votar = (mapa: typeof votosIS, valor: number | null, peso: number, pos: number) => {
    if (valor == null) return;
    const v = mapa.get(valor);
    if (v) v.peso += peso; else mapa.set(valor, { peso, pos });
  };
  const pesoIS = (rot: string) => /lmi|indenizacao/.test(rot) ? 1 : 3;
  const pesoPremio = (rot: string) => /total|valor\s+do/.test(rot) ? 3 : /liquido/.test(rot) ? 1 : 2;

  // Tabela: cabeçalho com 2+ rótulos e linha de valores com a mesma quantidade
  for (let i = 0; i < ultimaLinha && i < doc.linhas.length - 1; i++) {
    const dob = buscaLinha(doc, i);
    if (/despesa|contencao|salvamento/.test(dob)) continue;
    type Col = { tipo: 'is' | 'premio'; pos: number; rot: string };
    const cols: Col[] = [
      ...[...dob.matchAll(RE_IS)].map(m => ({ tipo: 'is' as const, pos: m.index!, rot: m[0] })),
      ...[...dob.matchAll(RE_PREMIO)].map(m => ({ tipo: 'premio' as const, pos: m.index!, rot: m[0] })),
    ].sort((a, b) => a.pos - b.pos)
      // "premio" dentro de "valor do premio" já foi contado
      .filter((c, k, arr) => k === 0 || c.pos >= arr[k - 1].pos + arr[k - 1].rot.length);
    if (cols.length < 2) continue;
    let lida = false;
    for (let k = i + 1; k <= i + 3 && k < doc.linhas.length; k++) {
      const vals = [...doc.linhas[k].texto.matchAll(RE_DINHEIRO)];
      if (vals.length < cols.length) continue;
      cols.forEach((c, j) => {
        const v = parseBRL(vals[j][0]);
        const pos = doc.linhas[k].inicio + vals[j].index!;
        if (c.tipo === 'is') votar(votosIS, v, pesoIS(c.rot), pos); else votar(votosPremio, v, pesoPremio(c.rot), pos);
      });
      lida = true;
      break;
    }
    // Linha da tabela quebrada (AXA): nome da cobertura em várias linhas e cada valor numa
    // linha. Junta os valores das linhas seguintes, na ordem, até completar as colunas.
    // Para em outro cabeçalho ou em despesa de salvamento/contenção.
    if (!lida && cols.length === 2 && cols[0].tipo === 'is' && cols[1].tipo === 'premio') {
      const juntos: { v: number | null; pos: number }[] = [];
      for (let k = i + 1; k <= i + 8 && k < doc.linhas.length && juntos.length < 2; k++) {
        const b = buscaLinha(doc, k);
        if (/despesa|contencao|salvamento/.test(b) || RE_IS.test(b) || new RegExp(RE_PREMIO.source).test(b)) break;
        RE_IS.lastIndex = 0;
        for (const v of doc.linhas[k].texto.matchAll(RE_DINHEIRO)) {
          if (juntos.length < 2) juntos.push({ v: parseBRL(v[0]), pos: doc.linhas[k].inicio + v.index! });
        }
      }
      RE_IS.lastIndex = 0;
      if (juntos.length === 2) {
        votar(votosIS, juntos[0].v, pesoIS(cols[0].rot), juntos[0].pos);
        votar(votosPremio, juntos[1].v, pesoPremio(cols[1].rot), juntos[1].pos);
      }
    }
  }
  // Rótulo seguido de valor (mesma linha ou a seguinte, até 60 caracteres)
  const rotuloValor = (re: RegExp, mapa: typeof votosIS, peso: (r: string) => number) => {
    for (const m of ocorrencias(doc, re, 0, corte)) {
      const ini = m.index + m[0].length;
      const janela = doc.texto.slice(ini, ini + 60);
      const v = new RegExp(RE_DINHEIRO.source).exec(janela);
      if (!v) continue;
      const entre = doc.busca.slice(ini, ini + v.index);
      if (/despesa|contencao|salvamento|parcela|\bpremio\b|limite|importancia|lmg|lmi|acrescimo|majoracao|reducao|diferenca/.test(entre)) continue;
      const linhaRot = buscaLinha(doc, linhaDe(doc, m.index));
      if (/despesa|contencao|salvamento/.test(linhaRot)) continue;
      // Cabeçalho de tabela (2+ rótulos na linha) já foi lido pela regra da tabela
      const linhaTxt = doc.linhas[linhaDe(doc, m.index)].texto;
      const ehCabecalho = !new RegExp(RE_DINHEIRO.source).test(linhaTxt)
        && [...linhaRot.matchAll(RE_IS)].length + [...linhaRot.matchAll(RE_PREMIO)].length >= 2;
      if (ehCabecalho) continue;
      votar(mapa, parseBRL(v[0]), peso(m[0]), ini + v.index);
    }
  };
  rotuloValor(RE_IS, votosIS, pesoIS);
  rotuloValor(RE_PREMIO, votosPremio, pesoPremio);

  const vencedor = (mapa: typeof votosIS) => [...mapa].sort((a, b) => b[1].peso - a[1].peso || a[1].pos - b[1].pos)[0];
  const is = vencedor(votosIS);
  const pr = vencedor(votosPremio);
  if (is) marcar('valor_garantia', is[1].pos, is[1].pos + 12);
  if (pr) marcar('custo_seguro', pr[1].pos, pr[1].pos + 12);

  // ── Vigência ──────────────────────────────────────────────────────────────
  const datas = [...doc.texto.slice(0, corte).matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)]
    .map(m => ({ s: m[0], t: Date.UTC(+m[3], +m[2] - 1, +m[1]), pos: m.index! }));
  let vig: { a: typeof datas[number]; b: typeof datas[number]; score: number } | null = null;
  for (let i = 0; i < datas.length; i++) {
    for (let j = i + 1; j <= i + 2 && j < datas.length; j++) {
      const a = datas[i], b = datas[j];
      if (b.pos - a.pos > 120) break;
      const dias = (b.t - a.t) / 86_400_000;
      if (dias < 7 || dias > 3700) continue;
      const entre = doc.busca.slice(a.pos, b.pos);
      if (/valida\s+ate|criad|emissao|vencimento|parcela/.test(entre)) continue;
      const antes = doc.busca.slice(Math.max(0, a.pos - 160), a.pos);
      const ctx = antes + entre;
      let score = 0;
      if (/vigencia/.test(ctx)) score += 2;
      if (/inicio|termino|final|a\s+partir|das\s+\d{2}|ate\s+as/.test(ctx)) score += 1;
      if (/trabalhista|previdenciaria|adicional/.test(antes.slice(-80))) score -= 2;
      if (score > 0 && (!vig || score > vig.score)) vig = { a, b, score };
    }
  }
  if (vig) marcar('vigencia', vig.a.pos, vig.b.pos + 10);
  // Convenção de horário (a frente tem prioridade; as condições gerais costumam repetir a regra)
  const conv = (txt: string): boolean | null =>
    /a\s+partir\s+das\s+0?0\s*[:h]\s*00|das\s+0?0\s*[:h]\s*00\s*h?\s+d[eo]/.test(txt) ? false
      : /(?:das|a\s+partir\s+das|as)\s+24\s*h|24\s*horas\s+d[aeo]|vinte\s+e\s+quatro\s+horas\)?\s+das|23\s*:\s*59\s*h?s?\s+das\s+datas|as\s+24\s*hs?\s+das\s+datas/.test(txt) ? true
      : null;
  const vigencia_inicio_24h = conv(frente) ?? conv(doc.busca.slice(corte));

  // ── Modalidade ────────────────────────────────────────────────────────────
  const lic = /licitante|garantia\s+de\s+proposta|participacao\s+em\s+licitacao|bid\s+bond/.exec(frente);
  const con = /executante|construtor|fornecedor|prestador\s+de\s+servicos|prestacao\s+de\s+servicos|performance|execucao\s+(?:contratual|dos\s+servicos)|contrato\s+principal\s+n/.exec(frente);
  let modalidade: MinutaExtraida['modalidade'] = null;
  let modalidade_texto: string | null = null;
  // "recusa ... em assinar o contrato principal" é texto da modalidade licitante
  const licitanteForte = lic || /recusa[r]?\s+(?:do\s+tomador\s+adjudicatario\s+)?(?:em\s+|a\s+)?assinar\s+o\s+contrato/.test(frente);
  if (licitanteForte && (!con || (lic && lic.index <= con.index) || !lic)) {
    modalidade = 'licitante';
    const m = lic ?? /recusa[r]?\s+[^.]{0,60}assinar\s+o\s+contrato/.exec(frente)!;
    modalidade_texto = doc.texto.slice(m.index, m.index + m[0].length);
    marcar('modalidade', m.index, m.index + m[0].length);
  } else if (con) {
    modalidade = 'contrato';
    modalidade_texto = doc.texto.slice(con.index, con.index + con[0].length);
    marcar('modalidade', con.index, con.index + con[0].length);
  }

  // ── Edital citado no objeto ───────────────────────────────────────────────
  const edital_refs: string[] = [];
  for (const m of ocorrencias(doc, /(?:edital|pregao(?:\s+eletronico)?|concorrencia(?:\s+eletronica)?|tomada\s+de\s+precos|licitacao|dispensa)\s*(?:n[º°o.]*\s*)?[:.]?\s*(\d{1,6}\s*\/\s*\d{4})/g, 0, corte)) {
    const r = m[1].replace(/\s/g, '');
    if (!edital_refs.includes(r)) edital_refs.push(r);
    if (!ev.edital_ref) marcar('edital_ref', m.index, m.index + m[0].length);
  }

  // ── Dados do contrato (só modalidade contrato) ───────────────────────────
  let numero_contrato: string | null = null;
  let objeto_contrato: string | null = null;
  let valor_contrato: number | null = null;
  if (modalidade === 'contrato') {
    // "Contrato n.° Contrato Administrativo nº 040/2026", "Contrato Principal n.º 072/2026/AGEVAP".
    // O número tem de vir logo depois, sem edital/pregão/processo no meio (esses são a licitação).
    for (const m of ocorrencias(doc, /\bcontrato\b/g, 0, corte)) {
      const ini = m.index + m[0].length;
      const janela = doc.busca.slice(ini, ini + 70);
      const n = /(\d{1,6}\s*\/\s*\d{4}(?:\/[a-z]{2,10})?)/.exec(janela);
      if (!n) continue;
      const entre = janela.slice(0, n.index);
      if (!/^\s*(?:principal\s+|administrativo\s+)?n\s*[.º°o]*/.test(entre)) continue;
      if (/edital|pregao|concorrencia|processo|licitat|apostilamento|tomada|dispensa|\.\s/.test(entre)) continue;
      numero_contrato = doc.texto.slice(ini + n.index, ini + n.index + n[0].length).replace(/\s/g, '');
      marcar('numero_contrato', m.index, ini + n.index + n[0].length);
      break;
    }
    // Objeto só quando DESCRITO ("que tem por objeto a prestação de…"); remissão não conta
    const ob = /(?:que\s+tem\s+(?:por|como)\s+objeto|tendo\s+(?:por|como)\s+objeto|cujo\s+objeto\s+(?:e|sera)|com\s+o\s+objeto\s+de)\s*:?\s*/.exec(frente);
    if (ob) {
      const ini = ob.index + ob[0].length;
      const resto = frente.slice(ini, ini + 500);
      const fim = /,\s*(?:oriund|descrit|conforme|firmad|celebrad)|\.\s|;|\n\s*\n/.exec(resto);
      const bruto = doc.texto.slice(ini, ini + (fim ? fim.index : resto.length)).replace(/\s+/g, ' ').trim();
      if (bruto.length >= 10 && fim) {
        objeto_contrato = bruto.charAt(0).toUpperCase() + bruto.slice(1);
        marcar('objeto_contrato', ini, ini + bruto.length);
      }
    }
    // Valor só com rótulo explícito; nunca deduzido da importância segurada
    const vc = /valor\s+(?:global\s+|total\s+|inicial\s+)?do\s+contrato(?:\s+principal)?\s*(?:e\s+de|:)?\s*(?:de\s+)?/.exec(frente);
    if (vc) {
      const ini = vc.index + vc[0].length;
      const v = new RegExp('^(?:' + RE_DINHEIRO.source + ')').exec(doc.texto.slice(ini, ini + 30));
      if (v) { valor_contrato = parseBRL(v[0]); marcar('valor_contrato', ini, ini + v[0].length); }
    }
  }

  return {
    seguradora,
    tipo_documento,
    numero,
    tomador: tom?.nome ?? null,
    tomador_cnpj,
    segurado: seg?.nome ?? null,
    segurado_cnpj,
    cnpjs: [...new Set(cnpjs.map(c => c.cnpj))],
    valor_garantia: is?.[0] ?? null,
    premio: pr?.[0] ?? null,
    vigencia_inicio: vig?.a.s ?? null,
    vigencia_fim: vig?.b.s ?? null,
    vigencia_inicio_24h,
    modalidade,
    modalidade_texto,
    edital_refs,
    numero_contrato,
    objeto_contrato,
    valor_contrato,
    evidencias: ev,
  };
}
