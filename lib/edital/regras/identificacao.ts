/**
 * Identificação do certame: órgão, modalidade, número, processo, objeto, portal,
 * critério de julgamento e registro de preços. Tudo vem das primeiras páginas.
 */
import { Documento, ocorrencias, paginaDe, trecho } from '../documento.ts';
import type { Evidencia } from '../../editalSchema.ts';

export interface ResultadoIdentificacao {
  orgao_nome: string | null;
  modalidade: string | null;
  numero_edital: string | null;
  numero_processo: string | null;
  objeto: string | null;
  portal_eletronico: string | null;
  criterio_julgamento: string | null;
  sistema_registro_precos: boolean | null;
  evidencias: Record<string, Evidencia>;
}

/** Fim (posição em doc.texto) das N primeiras páginas. */
function fimDasPaginas(doc: Documento, n: number): number {
  return doc.linhas.find(l => l.pagina > n)?.inicio ?? doc.texto.length;
}

const RE_ORGAO =
  /^\s*((?:prefeitura|camara)\s+municipal\s+d[eoa]s?\s+.+|municipio\s+d[eoa]s?\s+.+|governo\s+do\s+(?:estado|distrito)\s+.+|estado\s+d[eoa]s?\s+(?!minas|bahia|paraiba|sao paulo)\S.+|(?:tribunal|universidade|instituto|fundacao|autarquia|consorcio|servico\s+autonomo|companhia|empresa\s+(?:municipal|estadual|brasileira)|departamento\s+(?:de\s+estradas|nacional|estadual)|superintendencia|agencia)\s+.+)$/;

function limparNome(s: string): string {
  return s
    .replace(/\s*[-–,]?\s*cnpj.*$/i, '')
    .replace(/\s*[-–]\s*[A-Z]{2}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function acharOrgao(doc: Documento): { nome: string; ev: Evidencia } | null {
  // 1º: cabeçalho repetido; 2º: primeiras linhas da página 1
  for (const c of doc.cabecalhos) {
    const d = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (RE_ORGAO.test(d) && !/^\s*estado\s+d/.test(d)) return { nome: limparNome(c), ev: { trecho: c.trim(), pagina: 1 } };
  }
  for (const l of doc.linhas.slice(0, 40)) {
    if (l.pagina > 2) break;
    const d = doc.busca.slice(l.inicio, l.inicio + l.texto.length);
    if (RE_ORGAO.test(d) && !/^\s*estado\s+d/.test(d)) return { nome: limparNome(l.texto), ev: { trecho: l.texto.trim(), pagina: l.pagina } };
  }
  return null;
}

const MODALIDADES: { re: RegExp; nome: string }[] = [
  { re: /pregao\s+eletronico/, nome: 'Pregão Eletrônico' },
  { re: /pregao\s+presencial/, nome: 'Pregão Presencial' },
  { re: /concorrencia\s+(?:publica\s+)?eletronica/, nome: 'Concorrência Eletrônica' },
  { re: /concorrencia\s+presencial/, nome: 'Concorrência Presencial' },
  { re: /concorrencia/, nome: 'Concorrência' },
  { re: /tomada\s+de\s+precos/, nome: 'Tomada de Preços' },
  { re: /dispensa\s+(?:de\s+licitacao\s+)?eletronica/, nome: 'Dispensa Eletrônica' },
  { re: /dialogo\s+competitivo/, nome: 'Diálogo Competitivo' },
  { re: /leilao/, nome: 'Leilão' },
  { re: /pregao/, nome: 'Pregão' },
];

export function extrairIdentificacao(doc: Documento): ResultadoIdentificacao {
  const ev: Record<string, Evidencia> = {};
  const fim2 = fimDasPaginas(doc, 2);
  const fim3 = fimDasPaginas(doc, 3);
  const inicio = doc.busca.slice(0, fim2);
  const marcar = (campo: string, ini: number, fim: number) => {
    ev[campo] = { trecho: trecho(doc, ini, fim, 160), pagina: paginaDe(doc, ini) };
  };

  // Órgão
  const orgao = acharOrgao(doc);
  if (orgao) ev.orgao_nome = orgao.ev;

  // Modalidade (+ número na mesma expressão, ex.: "Pregão Eletrônico nº 013/2026")
  let modalidade: string | null = null;
  let numero: string | null = null;
  let melhorPos = Infinity;
  // MODALIDADES está do mais específico para o mais genérico: "Concorrência Eletrônica"
  // vence "Concorrência" mesmo que o genérico apareça antes no texto.
  for (const m of MODALIDADES) {
    const r = m.re.exec(inicio);
    if (r) { melhorPos = r.index; modalidade = m.nome; break; }
  }
  if (modalidade && /registro\s+de\s+precos|\bsrp\b/.test(inicio)) modalidade += ' - Registro de Preços';
  if (melhorPos < Infinity) marcar('modalidade', melhorPos, melhorPos + 30);

  const reNumero = /(?:pregao|concorrencia|tomada\s+de\s+precos|dispensa|licitacao|edital)(?:\s+(?:eletronic[oa]|presencial|publica|srp|de\s+licitacao))*\s*(?:n[º°o.]*|numero)?\s*[:.]?\s*(\d{1,6}\s*\/\s*\d{4})/g;
  const num = ocorrencias(doc, reNumero, 0, fim2)[0];
  if (num) {
    numero = num[1].replace(/\s/g, '');
    marcar('numero_edital', num.index, num.index + num[0].length);
  }

  // Processo
  let processo: string | null = null;
  const proc = ocorrencias(doc, /processo\s+(?:administrativo|licitatorio)?\s*(?:n[º°o.]*|numero)?\s*[:.]?\s*([0-9][\w./-]*\d)/g, 0, fim2)[0];
  if (proc) {
    processo = doc.texto.slice(proc.index, proc.index + proc[0].length).match(/[0-9][\w./-]*\d\s*$/)?.[0].trim() ?? null;
    marcar('numero_processo', proc.index, proc.index + proc[0].length);
  }

  // Objeto: depois do rótulo "OBJETO", até o fim da frase (máx. ~400 caracteres)
  let objeto: string | null = null;
  const obj = ocorrencias(doc, /(?:^|\n)\s*(?:\d+(?:\.\d+)*\s*[.)–-]?\s*)?(?:do\s+)?objeto(?:\s+da\s+presente\s+licitacao|\s+desta\s+licitacao)?\s*(?:e|sera)?\s*[:\-–]?\s*/g, 0, fim3)
    .concat(ocorrencias(doc, /constitui\s+objeto\s+d[ao]\s+presente\s+(?:licitacao|pregao|edital)\s*:?\s*|o\s+objeto\s+da\s+presente\s+licitacao\s+e\s+(?:a\s+)?/g, 0, fim3))
    .sort((a, b) => a.index - b.index);
  for (const o of obj) {
    const ini = o.index + o[0].length;
    const resto = doc.texto.slice(ini, ini + 600);
    // Pula rótulos de índice ("1. DO OBJETO" seguido de "2. DO ...")
    let texto = resto.split(/\n\s*(?:\d+(?:\.\d+)*\s*[.)–-]\s|[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{6,}:|ÍNDICE|INDICE|VALOR TOTAL|DATA D)/)[0];
    texto = texto.replace(/\s+/g, ' ').trim()
      .replace(/^\d+(?:\.\d+)*\.?\s*/, '')
      .replace(/^(?:constitui|e)\s+objeto\s+d[ao]\s+presente\s+\S+\s*:?\s*/i, '');
    const fimFrase = texto.search(/\.\s|\.$/);
    if (fimFrase > 40) texto = texto.slice(0, fimFrase + 1);
    if (texto.length >= 25) {
      objeto = texto.length > 400 ? texto.slice(0, 397) + '…' : texto;
      marcar('objeto', ini, ini + Math.min(texto.length, 150));
      break;
    }
  }

  // Portal eletrônico
  let portal: string | null = null;
  const reUrl = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:gov|com|org|net)\.br(?:\/[\w\-./]*)?/g;
  const urls = ocorrencias(doc, reUrl, 0, fim3)
    .filter(u => !/@/.test(doc.busca.slice(Math.max(0, u.index - 30), u.index)))
    .map(u => ({ u, ctx: doc.busca.slice(Math.max(0, u.index - 120), u.index) }));
  const preferida = urls.find(x => /local|site|sitio|plataforma|portal|endereco eletronico|realizad/.test(x.ctx) && /compras|licit|bnc|bll|pregao|portal/.test(x.u[0]))
    ?? urls.find(x => /compras|licit|bnc|bll|pregao/.test(x.u[0]));
  if (preferida) {
    portal = doc.texto.slice(preferida.u.index, preferida.u.index + preferida.u[0].length).replace(/[./]+$/, '');
    marcar('portal_eletronico', preferida.u.index, preferida.u.index + preferida.u[0].length);
  }

  // Critério de julgamento
  let criterio: string | null = null;
  const crit = /menor\s+preco\s+(?:global|por\s+item|por\s+lote|por\s+grupo|unitario)|maior\s+desconto|tecnica\s+e\s+preco|melhor\s+tecnica|maior\s+retorno\s+economico|maior\s+lance|menor\s+preco/.exec(inicio);
  if (crit) {
    criterio = doc.texto.slice(crit.index, crit.index + crit[0].length).replace(/\s+/g, ' ');
    criterio = criterio.charAt(0).toUpperCase() + criterio.slice(1).toLowerCase();
    marcar('criterio_julgamento', crit.index, crit.index + crit[0].length);
  }

  return {
    orgao_nome: orgao?.nome ?? null,
    modalidade,
    numero_edital: numero,
    numero_processo: processo,
    objeto,
    portal_eletronico: portal,
    criterio_julgamento: criterio,
    sistema_registro_precos: /registro\s+de\s+precos|\bsrp\b/.test(inicio),
    evidencias: ev,
  };
}
