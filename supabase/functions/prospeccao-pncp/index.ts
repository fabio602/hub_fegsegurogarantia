// ============================================================================
// prospeccao-pncp
//
// Prospeccao automatica de vencedores de licitacao no PNCP, em lotes.
//
// O GATILHO E A HOMOLOGACAO, NAO O CONTRATO ASSINADO.
// O contrato assinado aparece no PNCP semanas depois da homologacao, e a
// garantia ja foi contratada antes dele existir: chegar por ali e chegar
// tarde. A funcao acompanha /contratacoes/atualizacao, que traz tudo que
// mudou no dia ja com valorTotalHomologado, e trata valor homologado > 0
// como o sinal de que a licitacao terminou e tem vencedor.
//
// Quem entra e decidido pelo OBJETO da licitacao (config.termos_objeto) e
// pelo valor, nao pelo CNAE do vencedor. Uma construtora que ganha limpeza
// urbana interessa pelo contrato, nao pelo ramo declarado na Receita.
//
// Restricoes de producao que moldaram o desenho:
//   - A Edge Function deste projeto e encerrada aos 150s (WallClockTime), e a
//     requisicao HTTP tem idle timeout de 150s. Cada invocacao responde 202 na
//     hora, trabalha em background (EdgeRuntime.waitUntil) e para aos ~130s.
//   - A BrasilAPI nao retorna e-mail (a Receita tirou o campo dos dados
//     abertos). O e-mail vem da CNPJa aberta (5/min) com fallback cnpj.ws
//     (3/min): 13s a 21s por CNPJ.
//   - A API de consulta do PNCP aceita no maximo 50 registros por pagina
//     (100 e 500 respondem "Tamanho de pagina invalido"). Um dia util passa
//     de 150 paginas somando as modalidades, o que nao cabe num tique: a
//     varredura e retomavel, com cursor por modalidade em detalhes.varredura.
//
// Por isso o dia e uma EXECUCAO com fila persistente (prospeccao_pncp_fila):
//   - A coleta roda em todo tique ate terminar, em tres passos: varre as
//     atualizacoes do dia e grava as homologadas em pncp_monitor; descobre
//     quem venceu (itens -> resultados); deduplica e enfileira.
//   - Os tiques seguintes (a cada 10 min, ate 11:50 BRT) consomem a fila:
//     cadastro e CNAE pela BrasilAPI (com cache permanente por CNPJ), filtro
//     de perfil por divisao CNAE, e-mail pela cadeia CNPJa/cnpj.ws, e os
//     aprovados entram no Kanban (Novos Leads, origem pncp_auto) e na trilha
//     de e-mail existente via prospecting-cadence. Nada de template novo.
//   - Quando a fila esvazia, o limite diario fecha ou da 11:30 BRT, o tique
//     finaliza: gera o XLSX (Enviados / Sem e-mail valido / Fora do perfil),
//     salva no bucket prospeccao-pncp e envia o relatorio por e-mail.
//
// Em dry run (config.dry_run ou body { "dry_run": true }): tudo roda, menos
// inserir no Kanban, entrar na trilha e enviar e-mail a leads.
// Corpo opcional: { "dry_run": true, "data": "AAAA-MM-DD" }.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SVC   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL     = 'fabio@fegsegurogarantia.com.br';

// Consulta: varredura por data. Itens/resultados: quem venceu cada item.
const PNCP_CONSULTA = 'https://pncp.gov.br/api/consulta/v1';
const PNCP_ITENS    = 'https://pncp.gov.br/api/pncp/v1';
const BRASILAPI_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1';
// Teto real da API de consulta: 100 e 500 devolvem "Tamanho de pagina invalido".
const PNCP_PAGE_SIZE = 50;
// 6 em paralelo derrubava quase tudo (162 falhas em 165 paginas em 10/09/2026)
// enquanto a MESMA consulta, feita uma de cada vez, respondia normalmente. O
// PNCP estrangula requisicao concorrente: menos paralelismo rende mais pagina.
const PNCP_PARALELAS = 3;

// Modalidades varridas. Sao onde moram obra e servico continuado, que e o que
// exige garantia. Ficam de fora leilao (13) e as modalidades de credenciamento,
// que nao geram contrato com garantia.
const MODALIDADES: { id: number; nome: string }[] = [
  { id: 4, nome: 'Concorrencia - Eletronica' },
  { id: 5, nome: 'Concorrencia - Presencial' },
  { id: 6, nome: 'Pregao - Eletronico' },
  { id: 7, nome: 'Pregao - Presencial' },
  { id: 8, nome: 'Dispensa de Licitacao' },
  { id: 9, nome: 'Inexigibilidade' },
];
const MODALIDADES_DISPENSA = new Set([8, 9]);

// Itens sondados por licitacao, do maior valor para o menor. Licitacao de
// registro de precos passa de 100 itens; sondar todos estouraria o tique sem
// mudar o resultado, porque o lead que interessa esta nos itens grandes.
const MAX_ITENS_POR_LICITACAO = 10;

// Teto real da funcao: 150s. O orcamento para de INICIAR trabalho bem antes,
// porque um item que comeca no limite ainda gasta ate ~20s de timeouts de
// rede, e os contadores e a finalizacao precisam caber depois dele.
const ORCAMENTO_TAREFA_MS = 105_000;
const ORCAMENTO_COLETA_MS = 90_000;
// Depois deste horario (BRT) o tique finaliza o dia mesmo com fila pendente.
const HORA_LIMITE_BRT = '11:30';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ─── Helpers de dominio ──────────────────────────────────────────────────────

function cleanCnpj(ni: string): string {
  return (ni || '').replace(/\D/g, '').slice(0, 14);
}

function formatCnpj(digits: string): string {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

const RE_DISPENSA_INEXIG = /\b(inexigibilidade|inexig|inex\b|dispensa|disp\.\s*\d)/i;

const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Divisao CNAE: os 2 primeiros digitos do codigo de 7 digitos. */
function cnaeDivisao(codigo: string | number | null | undefined): string {
  const s = String(codigo ?? '').replace(/\D/g, '').padStart(7, '0');
  return s === '0000000' ? '' : s.slice(0, 2);
}

function primeiroNome(nomeCompleto: string): string {
  const p = (nomeCompleto || '').trim().split(/\s+/)[0] || '';
  if (!p) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function hojeBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function horaBRT(): string {
  return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Sabado ou domingo no fuso de Brasilia.
 *
 * E-mail de prospeccao no fim de semana chega para acumular: ninguem na
 * construtora le, e caixa sem engajamento piora a reputacao do dominio. A
 * COLETA continua rodando — senao as homologacoes publicadas no fim de semana
 * seriam perdidas, porque cada tique olha so o dia anterior.
 */
function fimDeSemanaBRT(): boolean {
  const dia = new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
  return dia === 'Sat' || dia === 'Sun';
}

function diaAnteriorBRT(): string {
  const hoje = hojeBRT();
  const d = new Date(Date.parse(hoje + 'T12:00:00Z') - 86_400_000);
  return d.toISOString().slice(0, 10);
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Config {
  ativo: boolean;
  dry_run: boolean;
  pausado: boolean;
  ufs: string[];
  valor_minimo: number;
  dispensa_inexig_valor_minimo: number;
  cnae_divisoes_incluir: string[];
  cnae_divisoes_excluir: string[];
  limite_diario: number;
  max_consultas_brasilapi: number;
  pausa_entre_consultas_ms: number;
  trilha: string;
  email_relatorio: string;
  email_padroes_contador: string[];
  email_prefixos_genericos: string[];
  email_provedores_gratuitos: string[];
  fila_validade_dias: number;
  termos_objeto: string[];
  valor_prioritario: number;
  dispensa_valor_prioritario: number;
  monitor_validade_dias: number;
  incluir_srp: boolean;
}

interface Contrato {
  cnpj: string;            // 14 digitos: o VENCEDOR da licitacao
  razaoPncp: string;
  orgao: string;
  objeto: string;
  valor: number;           // valor homologado do vencedor
  numeroLicitacao: string;
  municipio: string;
  uf: string;
  processo: string;
  // Campos do monitoramento por homologacao (ausentes nas sobras antigas).
  numeroControlePncp?: string;
  dataHomologacao?: string;
  modalidade?: string;
  termos?: string[];
  porte?: string;
  materialOuServico?: string;
  prioritario?: boolean;
}

/** Uma licitacao homologada, antes de sabermos quem venceu. */
interface Homologada {
  numeroControlePncp: string;
  orgaoCnpj: string;
  orgaoNome: string;
  ano: number;
  sequencial: number;
  uf: string;
  municipio: string;
  modalidadeId: number;
  modalidadeNome: string;
  objeto: string;
  termos: string[];
  valorHomologado: number;
  valorEstimado: number;
  dataHomologacao: string;
  processo: string;
  prioritario: boolean;
  srp: boolean;
}

/** Um vencedor de item, ja com o valor que ele levou. */
interface Vencedor {
  cnpj: string;
  nome: string;
  valor: number;
  porte: string;
  materialOuServico: string;
}

interface Empresa {
  razao_social: string;
  nome_fantasia: string;
  telefone: string;
  cidade: string;
  uf: string;
  cnae_principal: string;
  cnae_descricao: string;
  cnae_divisao: string;
  cnaes_secundarios: { codigo: string; divisao: string }[];
  socio: string;
  situacao: string;
  // Preenchidos pela cadeia de e-mail, nao pela BrasilAPI.
  email: string;
  email_fonte: string;
  email_consultado: boolean;
}

// ─── Coleta no PNCP ──────────────────────────────────────────────────────────

const CABECALHO_PNCP = { 'Accept': 'application/json', 'User-Agent': 'FEG-Hub/1.0' };

// A latencia do PNCP varia MUITO: a mesma consulta responde em 2s ou passa de
// 25s. 12s foi calibrado durante a instabilidade noturna de 09/09/2026 e ficou
// apertado demais para o horario comercial, quando o portal esta sob carga.
// Como a varredura agora e retomavel E nao bloqueia mais o resto do pipeline,
// vale esperar mais por pagina em vez de descartar pagina boa por impaciencia.
const PNCP_TIMEOUT_MS = 25_000;

/**
 * 'vazio' e resposta boa sem registros; 'falha' e rede/timeout/5xx.
 * A diferenca importa: 'vazio' encerra a modalidade, 'falha' precisa ser
 * tentada de novo no proximo tique em vez de dar o dia por varrido.
 */
type Resposta = { estado: 'ok'; body: unknown } | { estado: 'vazio' } | { estado: 'falha' };

async function fetchJson(url: string, tentativas = 2, fimMs?: number): Promise<Resposta> {
  for (let i = 0; i < tentativas; i++) {
    if (fimMs && Date.now() > fimMs) return { estado: 'falha' };
    try {
      const res = await fetch(url, { headers: CABECALHO_PNCP, signal: AbortSignal.timeout(PNCP_TIMEOUT_MS) });
      // 204 = consulta valida sem registros (pagina alem do fim, dia sem nada).
      if (res.status === 204) return { estado: 'vazio' };
      // 429 pede recuo maior que o retry normal.
      if (res.status === 429) { await pausa(2000 * (i + 1)); continue; }
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body !== null) return { estado: 'ok', body };
        return { estado: 'vazio' };
      }
      // 4xx que nao seja 429 e parametro errado: repetir nao melhora.
      if (res.status >= 400 && res.status < 500) return { estado: 'vazio' };
    } catch { /* timeout ou rede: tenta de novo */ }
    if (i < tentativas - 1) await pausa(800);
  }
  return { estado: 'falha' };
}

/** Objeto paginado ({data, totalPaginas}). */
async function fetchPagina(
  url: string, fimMs?: number,
): Promise<{ estado: 'ok'; body: Record<string, unknown> } | { estado: 'vazio' } | { estado: 'falha' }> {
  const r = await fetchJson(url, 2, fimMs);
  if (r.estado !== 'ok') return r;
  return r.body && typeof r.body === 'object' && !Array.isArray(r.body)
    ? { estado: 'ok', body: r.body as Record<string, unknown> }
    : { estado: 'vazio' };
}

/** Endpoints de itens/resultados devolvem array na raiz. */
async function fetchLista(url: string, fimMs?: number): Promise<Record<string, unknown>[]> {
  const r = await fetchJson(url, 2, fimMs);
  return r.estado === 'ok' && Array.isArray(r.body) ? r.body as Record<string, unknown>[] : [];
}

/** Normaliza para casar termo sem depender de acento nem de caixa. */
function normalizar(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function termosQueCasam(objeto: string, termos: string[]): string[] {
  const alvo = normalizar(objeto);
  const achados: string[] = [];
  for (const t of termos) {
    const n = normalizar(t).trim();
    if (n && alvo.includes(n)) achados.push(t);
  }
  return achados;
}

/**
 * Le uma pagina de /contratacoes/atualizacao e devolve so as licitacoes que
 * interessam: homologadas, no perfil de valor, na UF e com o objeto batendo
 * em algum termo. O corte e feito aqui para nao carregar 7 mil registros/dia
 * na memoria do tique.
 */
function filtrarPagina(
  body: Record<string, unknown>,
  config: Config,
  modalidade: { id: number; nome: string },
): Homologada[] {
  const achadas: Homologada[] = [];
  for (const raw of ((body.data as Record<string, unknown>[]) ?? [])) {
    // Sem valor homologado a licitacao ainda nao terminou: nao interessa hoje,
    // e volta a aparecer na varredura do dia em que for homologada.
    const valorHomologado = Number(raw.valorTotalHomologado ?? 0) || 0;
    if (valorHomologado <= 0) continue;

    const unidade = raw.unidadeOrgao as Record<string, unknown> | undefined;
    const uf = String(unidade?.ufSigla ?? '');
    if (config.ufs.length && !config.ufs.includes(uf)) continue;

    const dispensa = MODALIDADES_DISPENSA.has(modalidade.id);
    const piso = dispensa
      ? Number(config.dispensa_inexig_valor_minimo)
      : Number(config.valor_minimo);
    if (valorHomologado < piso) continue;

    const objeto = String(raw.objetoCompra ?? '');
    const termos = termosQueCasam(objeto, config.termos_objeto ?? []);
    if (!termos.length) continue;

    const orgaoEnt = raw.orgaoEntidade as Record<string, unknown> | undefined;
    const orgaoCnpj = cleanCnpj(String(orgaoEnt?.cnpj ?? ''));
    const ano = Number(raw.anoCompra ?? 0) || 0;
    const sequencial = Number(raw.sequencialCompra ?? 0) || 0;
    if (orgaoCnpj.length !== 14 || !ano || !sequencial) continue;

    const tetoPrioritario = dispensa
      ? Number(config.dispensa_valor_prioritario)
      : Number(config.valor_prioritario);

    achadas.push({
      numeroControlePncp: String(raw.numeroControlePNCP ?? `${orgaoCnpj}-1-${sequencial}/${ano}`),
      orgaoCnpj,
      orgaoNome: String(orgaoEnt?.razaoSocial ?? ''),
      ano,
      sequencial,
      uf,
      municipio: String(unidade?.municipioNome ?? ''),
      modalidadeId: modalidade.id,
      modalidadeNome: String(raw.modalidadeNome ?? modalidade.nome),
      objeto,
      termos,
      valorHomologado,
      valorEstimado: Number(raw.valorTotalEstimado ?? 0) || 0,
      dataHomologacao: String(raw.dataAtualizacao ?? raw.dataAtualizacaoGlobal ?? '').slice(0, 10),
      processo: String(raw.processo ?? ''),
      prioritario: valorHomologado >= tetoPrioritario,
      srp: raw.srp === true,
    });
  }
  return achadas;
}

/**
 * Varre /contratacoes/atualizacao do dia, modalidade a modalidade.
 *
 * A varredura e RETOMAVEL: `cursor` guarda a ultima pagina concluida de cada
 * modalidade e volta atualizado. Um dia inteiro passa de 150 paginas e nao
 * cabe no orcamento de um tique so, entao o tique seguinte continua de onde
 * este parou em vez de recomecar.
 */
async function varrerAtualizacoes(
  dataRef: string,
  config: Config,
  cursor: Record<string, number>,
  inicioMs: number,
): Promise<{
  achadas: Homologada[];
  cursor: Record<string, number>;
  completa: boolean;
  paginasLidas: number;
  paginasFalhas: number;
}> {
  const dataParam = dataRef.replaceAll('-', '');
  const achadas: Homologada[] = [];
  const novoCursor = { ...cursor };
  let paginasLidas = 0;
  let paginasFalhas = 0;
  let completa = true;

  const url = (mod: number, p: number) =>
    `${PNCP_CONSULTA}/contratacoes/atualizacao?dataInicial=${dataParam}&dataFinal=${dataParam}` +
    `&codigoModalidadeContratacao=${mod}&pagina=${p}&tamanhoPagina=${PNCP_PAGE_SIZE}`;

  const fimMs = inicioMs + ORCAMENTO_COLETA_MS;

  for (const modalidade of MODALIDADES) {
    const chave = String(modalidade.id);
    // -1 marca modalidade ja concluida em tique anterior.
    if (novoCursor[chave] === -1) continue;
    if (Date.now() > fimMs) { completa = false; break; }

    const feitas = Number(novoCursor[chave] ?? 0);
    const primeira = await fetchPagina(url(modalidade.id, feitas + 1), fimMs);

    if (primeira.estado === 'falha') {
      // Rede ou timeout. O cursor NAO anda e a modalidade NAO e dada por
      // concluida: quem falhou aqui e retentado no proximo tique. Marcar -1
      // nesta situacao fazia a varredura pular a modalidade inteira do dia.
      paginasFalhas++;
      completa = false;
      continue;
    }
    if (primeira.estado === 'vazio') { novoCursor[chave] = -1; continue; }

    paginasLidas++;
    achadas.push(...filtrarPagina(primeira.body, config, modalidade));
    novoCursor[chave] = feitas + 1;

    const totalPaginas = Math.max(1, Number(primeira.body.totalPaginas) || 1);
    if (novoCursor[chave] >= totalPaginas) { novoCursor[chave] = -1; continue; }

    let interrompida = false;
    for (let p = feitas + 2; p <= totalPaginas; p += PNCP_PARALELAS) {
      if (Date.now() > fimMs) { interrompida = true; break; }
      const lote: number[] = [];
      for (let k = p; k < p + PNCP_PARALELAS && k <= totalPaginas; k++) lote.push(k);
      const respostas = await Promise.all(lote.map((k) => fetchPagina(url(modalidade.id, k), fimMs)));

      // O cursor so avanca ate a ultima pagina lida SEM buraco. Se a terceira
      // do lote falhou, o cursor para na segunda e o proximo tique retoma da
      // terceira: nenhuma pagina e pulada em silencio.
      let ultimaBoa = novoCursor[chave];
      let houveBuraco = false;
      for (let i = 0; i < respostas.length; i++) {
        const r = respostas[i];
        if (r.estado === 'ok') {
          paginasLidas++;
          achadas.push(...filtrarPagina(r.body, config, modalidade));
          if (!houveBuraco) ultimaBoa = lote[i];
        } else if (r.estado === 'vazio') {
          if (!houveBuraco) ultimaBoa = lote[i];
        } else {
          paginasFalhas++;
          houveBuraco = true;
        }
      }
      novoCursor[chave] = ultimaBoa;
      if (houveBuraco) { interrompida = true; break; }
    }

    if (interrompida) { completa = false; continue; }
    novoCursor[chave] = -1;
  }

  // Completa de verdade so quando toda modalidade chegou ao fim.
  if (completa) completa = MODALIDADES.every((m) => novoCursor[String(m.id)] === -1);

  return { achadas, cursor: novoCursor, completa, paginasLidas, paginasFalhas };
}

/**
 * Descobre quem venceu uma licitacao homologada.
 *
 * Le os itens, fica com os que tem resultado, e sonda do maior para o menor.
 * Varios itens podem ter vencedores diferentes: cada CNPJ vira um lead, com o
 * valor somado do que ele levou.
 */
async function resolverVencedores(h: Homologada, fimMs: number): Promise<Vencedor[]> {
  const base = `${PNCP_ITENS}/orgaos/${h.orgaoCnpj}/compras/${h.ano}/${h.sequencial}`;
  const itens = await fetchLista(`${base}/itens?pagina=1&tamanhoPagina=${PNCP_PAGE_SIZE}`, fimMs);
  if (!itens.length) return [];

  const comResultado = itens
    .filter((it) => it.temResultado === true)
    .sort((a, b) => (Number(b.valorTotal ?? 0) || 0) - (Number(a.valorTotal ?? 0) || 0))
    .slice(0, MAX_ITENS_POR_LICITACAO);

  const porCnpj = new Map<string, Vencedor>();
  for (const item of comResultado) {
    if (Date.now() > fimMs) break;
    const numeroItem = Number(item.numeroItem ?? 0) || 0;
    if (!numeroItem) continue;

    const resultados = await fetchLista(`${base}/itens/${numeroItem}/resultados`, fimMs);
    for (const r of resultados) {
      // Resultado cancelado nao e venda: a licitacao voltou atras.
      if (r.dataCancelamento) continue;
      if (r.tipoPessoa === 'PF') continue;
      const cnpj = cleanCnpj(String(r.niFornecedor ?? ''));
      if (cnpj.length !== 14) continue;

      const valor = Number(r.valorTotalHomologado ?? 0) || 0;
      const atual = porCnpj.get(cnpj);
      if (atual) {
        atual.valor += valor;
      } else {
        porCnpj.set(cnpj, {
          cnpj,
          nome: String(r.nomeRazaoSocialFornecedor ?? ''),
          valor,
          porte: String(r.porteFornecedorNome ?? ''),
          materialOuServico: String(item.materialOuServicoNome ?? ''),
        });
      }
    }
  }

  return [...porCnpj.values()].sort((a, b) => b.valor - a.valor);
}

// ─── Cadastro na BrasilAPI (sem e-mail; a Receita retirou o campo de la) ─────

function parseBrasilApi(d: Record<string, unknown>): Empresa {
  const secundarios = Array.isArray(d.cnaes_secundarios)
    ? (d.cnaes_secundarios as { codigo?: unknown }[]).map((c) => {
        const codigo = String(c?.codigo ?? '');
        return { codigo, divisao: cnaeDivisao(codigo) };
      })
    : [];
  // Prefere o socio ADMINISTRADOR (pela qualificacao); na falta, o primeiro
  // do QSA. E o nome que a Bruna usa no follow-up por telefone.
  const qsa = Array.isArray(d.qsa)
    ? (d.qsa as { nome_socio?: unknown; qualificacao_socio?: unknown }[])
    : [];
  const admin = qsa.find((q) => /adminis/i.test(String(q?.qualificacao_socio ?? '')));
  const socioEscolhido = String((admin ?? qsa[0])?.nome_socio ?? '');
  return {
    razao_social: String(d.razao_social ?? ''),
    nome_fantasia: String(d.nome_fantasia ?? ''),
    telefone: String(d.ddd_telefone_1 ?? '').trim(),
    cidade: String(d.municipio ?? ''),
    uf: String(d.uf ?? ''),
    cnae_principal: String(d.cnae_fiscal ?? ''),
    cnae_descricao: String(d.cnae_fiscal_descricao ?? ''),
    cnae_divisao: cnaeDivisao(d.cnae_fiscal as string),
    cnaes_secundarios: secundarios,
    socio: socioEscolhido,
    situacao: String(d.descricao_situacao_cadastral ?? ''),
    email: '',
    email_fonte: '',
    email_consultado: false,
  };
}

async function consultarBrasilApi(cnpj: string): Promise<Empresa | null> {
  try {
    const res = await fetch(`${BRASILAPI_CNPJ}/${cnpj}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return null;
    return parseBrasilApi(body as Record<string, unknown>);
  } catch {
    return null;
  }
}

// ─── Cadeia de e-mail: CNPJa aberta (5/min) -> cnpj.ws publica (3/min) ───────

interface ProvedorEmail {
  nome: string;
  cooldownMs: number;
  proximaEm: number;
  consultar: (cnpj: string) => Promise<{ ok: boolean; email: string }>;
}

function criarProvedoresEmail(): ProvedorEmail[] {
  return [
    {
      nome: 'cnpja',
      cooldownMs: 13_000,
      proximaEm: 0,
      consultar: async (cnpj) => {
        const res = await fetch(`https://open.cnpja.com/office/${cnpj}`, { signal: AbortSignal.timeout(15_000) });
        if (res.status === 429) throw new Error('rate limit');
        if (!res.ok) return { ok: false, email: '' };
        const d = await res.json().catch(() => null) as { emails?: { address?: string }[] } | null;
        if (!d) return { ok: false, email: '' };
        return { ok: true, email: String(d.emails?.[0]?.address ?? '').trim().toLowerCase() };
      },
    },
    {
      nome: 'cnpjws',
      cooldownMs: 21_000,
      proximaEm: 0,
      consultar: async (cnpj) => {
        const res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, { signal: AbortSignal.timeout(15_000) });
        if (res.status === 429) throw new Error('rate limit');
        if (!res.ok) return { ok: false, email: '' };
        const d = await res.json().catch(() => null) as { estabelecimento?: { email?: string } } | null;
        if (!d) return { ok: false, email: '' };
        return { ok: true, email: String(d.estabelecimento?.email ?? '').trim().toLowerCase() };
      },
    },
  ];
}

/**
 * consultado=false: nenhum provedor respondeu (fica para o proximo tique).
 * semTempo=true: o orcamento do tique acabou.
 */
async function buscarEmail(
  cnpj: string,
  provedores: ProvedorEmail[],
  fimOrcamentoMs: number,
): Promise<{ consultado: boolean; email: string; fonte: string; semTempo: boolean }> {
  for (let tentativa = 0; tentativa < provedores.length; tentativa++) {
    const prov = [...provedores].sort((a, b) => a.proximaEm - b.proximaEm)[0];
    const espera = Math.max(0, prov.proximaEm - Date.now());
    if (Date.now() + espera > fimOrcamentoMs) {
      return { consultado: false, email: '', fonte: '', semTempo: true };
    }
    if (espera > 0) await pausa(espera);
    prov.proximaEm = Date.now() + prov.cooldownMs;
    try {
      const r = await prov.consultar(cnpj);
      if (r.ok) return { consultado: true, email: r.email, fonte: prov.nome, semTempo: false };
    } catch {
      prov.proximaEm = Date.now() + 60_000;
    }
  }
  return { consultado: false, email: '', fonte: '', semTempo: false };
}

// ─── Filtro de perfil por CNAE ───────────────────────────────────────────────

function avaliaCnae(e: Empresa, incluir: string[], excluir: string[]): { ok: boolean; motivo: string } {
  if (excluir.includes(e.cnae_divisao)) {
    return { ok: false, motivo: `Divisao CNAE ${e.cnae_divisao} esta na lista de exclusao (${e.cnae_descricao})` };
  }
  // Lista de inclusao vazia = sem restricao de ramo. O filtro passa a ser o
  // objeto da licitacao, nao o CNAE do vencedor. Antes, lista vazia reprovava
  // todo mundo e marcava o CNPJ como fora_do_perfil para sempre.
  if (!incluir.length) return { ok: true, motivo: '' };
  const divisoes = new Set([e.cnae_divisao, ...e.cnaes_secundarios.map((c) => c.divisao)]);
  for (const d of divisoes) {
    if (incluir.includes(d)) return { ok: true, motivo: '' };
  }
  return { ok: false, motivo: `Nenhuma divisao CNAE (${[...divisoes].filter(Boolean).join(', ')}) esta na lista de inclusao` };
}

// ─── Classificacao do e-mail (so marcacao; nada e bloqueado por isso) ────────
//
// 'contador': o e-mail aparenta ser do escritorio de contabilidade, nao da
// empresa (prefixo ou dominio com termos contabeis).
// 'generico_corporativo': caixa de setor (contato@, comercial@, diretoria@...).
// 'provedor_gratuito': gmail, hotmail e afins — costuma ser a caixa que o socio
//   de fato le, e mede melhor que caixa de setor.
// 'direto': os demais, tipicamente nome de pessoa no dominio da empresa.
// O XLSX ordena com 'direto' primeiro.
//
// Medido em 60 envios reais de 10 e 11/09/2026: caixa de setor devolveu 18,8%,
// contador 14,3%, provedor gratuito 6,7% e 'direto' nenhum. A amostra e pequena
// (intervalos de confianca se sobrepoem), por isso isto ROTULA e nao bloqueia:
// serve para a decisao de filtrar ou nao ser tomada com volume maior.
type TipoEmail = 'direto' | 'generico_corporativo' | 'contador' | 'provedor_gratuito';

function classificarEmail(email: string, config: Config): TipoEmail {
  const e = (email || '').toLowerCase();
  if (!e.includes('@')) return 'direto';
  const [prefixo, dominio] = e.split('@');

  for (const padrao of (config.email_padroes_contador ?? [])) {
    const t = padrao.toLowerCase().trim();
    if (t && (prefixo.includes(t) || dominio.includes(t))) return 'contador';
  }
  for (const pref of (config.email_prefixos_genericos ?? [])) {
    const t = pref.toLowerCase().trim();
    if (t && prefixo.startsWith(t)) return 'generico_corporativo';
  }
  // Comparacao exata de dominio: 'includes' faria "gmail.com" casar com
  // "naoegmail.com.br" e rotularia empresa como provedor gratuito.
  for (const prov of (config.email_provedores_gratuitos ?? [])) {
    const t = prov.toLowerCase().trim();
    if (t && dominio === t) return 'provedor_gratuito';
  }
  return 'direto';
}

const ORDEM_TIPO_EMAIL: Record<string, number> = {
  direto: 0, provedor_gratuito: 1, generico_corporativo: 2, contador: 3,
};

// ─── Relatorio XLSX (montado a partir das linhas de prospeccao_pncp_leads) ───

interface LeadRow {
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  cnae_principal: string | null;
  cnae_divisao: string | null;
  cnae_descricao: string | null;
  orgao: string | null;
  objeto: string | null;
  valor: number | null;
  numero_licitacao: string | null;
  resultado: string;
  motivo: string | null;
  enviado_em: string | null;
  resend_status: string | null;
  tipo_email: string | null;
  socio: string | null;
}

const CABECALHO_BASE = [
  'Razao social', 'Nome fantasia', 'CNPJ', 'E-mail', 'Tipo de e-mail', 'Socio (follow-up)', 'Telefone', 'Cidade', 'UF',
  'CNAE principal', 'Divisao CNAE', 'Descricao CNAE',
  'Orgao', 'Objeto', 'Valor', 'Numero da licitacao',
];

function linhaBase(l: LeadRow): (string | number)[] {
  return [
    l.razao_social ?? '', l.nome_fantasia ?? '', formatCnpj(l.cnpj),
    l.email ?? '', l.tipo_email ?? '', l.socio ?? '',
    l.telefone ?? '', l.cidade ?? '', l.uf ?? '',
    l.cnae_principal ?? '', l.cnae_divisao ?? '', l.cnae_descricao ?? '',
    l.orgao ?? '', l.objeto ?? '', l.valor ?? 0, l.numero_licitacao ?? '',
  ];
}

/** 'direto' primeiro, depois generico, depois contador; valor maior primeiro dentro de cada grupo. */
function ordenarPorTipoEmail(rows: LeadRow[]): LeadRow[] {
  return [...rows].sort((a, b) => {
    const ta = ORDEM_TIPO_EMAIL[a.tipo_email ?? 'direto'] ?? 0;
    const tb = ORDEM_TIPO_EMAIL[b.tipo_email ?? 'direto'] ?? 0;
    if (ta !== tb) return ta - tb;
    return (b.valor ?? 0) - (a.valor ?? 0);
  });
}

function montarXlsx(rows: LeadRow[], dryRun: boolean): string {
  const enviados = ordenarPorTipoEmail(rows.filter((l) => l.resultado === 'enviado' || l.resultado === 'dry_run'));
  const semEmail = rows.filter((l) => l.resultado === 'sem_email');
  const foraPerfil = rows.filter((l) => l.resultado === 'fora_do_perfil');

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [...CABECALHO_BASE, 'Data do envio', 'Status do Resend'],
    ...enviados.map((l) => [
      ...linhaBase(l),
      l.enviado_em ? l.enviado_em.slice(0, 16).replace('T', ' ') : (dryRun ? 'dry run (nao enviado)' : ''),
      l.resend_status ?? (dryRun ? 'dry run' : ''),
    ]),
  ]), dryRun ? 'Enviados (dry run)' : 'Enviados');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [...CABECALHO_BASE, 'Motivo da falha'],
    ...semEmail.map((l) => [...linhaBase(l), l.motivo ?? '']),
  ]), 'Sem e-mail valido');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [...CABECALHO_BASE, 'Motivo'],
    ...foraPerfil.map((l) => [...linhaBase(l), l.motivo ?? '']),
  ]), 'Fora do perfil');

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function enviarRelatorio(o: {
  para: string;
  dataRef: string;
  dryRun: boolean;
  coletados: number;
  enriquecidos: number;
  enviados: number;
  semEmail: number;
  foraPerfil: number;
  avisos: string[];
  anexoBase64: string;
}): Promise<boolean> {
  const linha = (rotulo: string, valor: string | number) =>
    `<tr><td style="padding:6px 0;color:#6b7c8f">${rotulo}</td><td style="padding:6px 0;text-align:right;font-weight:600">${valor}</td></tr>`;

  const avisosHtml = o.avisos.length
    ? `<p style="margin:16px 0 0;color:#b45309;font-size:13px">${o.avisos.map((a) => `&#9888; ${a}`).join('<br>')}</p>`
    : '';

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#1B263B;max-width:520px">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#C69C6D;margin:0 0 6px">
        Prospeccao automatica PNCP${o.dryRun ? ' (dry run)' : ''}
      </p>
      <h2 style="font-size:19px;margin:0 0 18px">Relatorio de ${o.dataRef}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${linha('Contratos coletados (apos filtros de valor/UF)', o.coletados)}
        ${linha('CNPJs consultados na BrasilAPI', o.enriquecidos)}
        ${linha(o.dryRun ? 'Seriam enviados' : 'Enviados para a trilha', o.enviados)}
        ${linha('Sem e-mail valido', o.semEmail)}
        ${linha('Fora do perfil (CNAE)', o.foraPerfil)}
        ${linha('Bounces ate agora', 0)}
      </table>
      ${avisosHtml}
      <p style="font-size:12px;color:#8a97a5;margin-top:20px">
        A planilha completa esta em anexo e tambem no bucket prospeccao-pncp do Supabase.
      </p>
    </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `F&G Seguro Garantia <${FROM_EMAIL}>`,
        to: [o.para],
        subject: `Prospeccao PNCP ${o.dataRef}: ${o.enviados} ${o.dryRun ? 'na lista (dry run)' : 'enviados'}, ${o.semEmail} sem e-mail`,
        html,
        attachments: [{ filename: `${o.dataRef}.xlsx`, content: o.anexoBase64 }],
      }),
    });
    if (!r.ok) console.error('[relatorio] Resend:', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('[relatorio]', e);
    return false;
  }
}

// O PostgREST limita cada resposta a 1.000 linhas: varreduras inteiras paginam.
// deno-lint-ignore no-explicit-any
async function selectTudo(consulta: (de: number, ate: number) => any): Promise<Record<string, unknown>[]> {
  const tudo: Record<string, unknown>[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) { console.error('[selectTudo]', error.message); break; }
    const lote = (data ?? []) as Record<string, unknown>[];
    tudo.push(...lote);
    if (lote.length < 1000) break;
  }
  return tudo;
}

// ─── Fase 1: coleta e enfileiramento ─────────────────────────────────────────

/** Cria a execucao do dia, sem coletar nada ainda. */
async function abrirExecucao(
  supabase: SupabaseClient,
  dataRef: string,
  dryRun: boolean,
): Promise<string | null> {
  const { data: exec, error } = await supabase
    .from('prospeccao_pncp_execucoes')
    .insert({
      data_referencia: dataRef,
      dry_run: dryRun,
      fase: 'processando',
      coletados: 0,
      detalhes: { varredura: {}, varredura_completa: false, avisos: [] },
    })
    .select('id').single();
  if (error || !exec) { console.error('[execucao]', error?.message); return null; }
  return exec.id as string;
}

/**
 * Fase 1, retomavel: varre as homologacoes do dia, descobre os vencedores e
 * enfileira os que passam na deduplicacao.
 *
 * Roda em todo tique enquanto houver o que fazer. O estado mora em duas
 * tabelas, nao na memoria: `pncp_monitor` guarda a licitacao homologada e o
 * vencedor ja resolvido, e o cursor da varredura fica em detalhes.varredura.
 */
async function coletarHomologacoes(
  supabase: SupabaseClient,
  config: Config,
  execId: string,
  dataRef: string,
  inicioMs: number,
  avisos: string[],
): Promise<void> {
  const { data: execRow } = await supabase.from('prospeccao_pncp_execucoes')
    .select('detalhes, coletados').eq('id', execId).single();
  const detalhes = (execRow?.detalhes ?? {}) as Record<string, unknown>;

  // ── Passo 1: varredura das atualizacoes do dia ────────────────────────────
  if (detalhes.varredura_completa !== true) {
    const cursor = (detalhes.varredura ?? {}) as Record<string, number>;
    const v = await varrerAtualizacoes(dataRef, config, cursor, inicioMs);

    if (v.achadas.length) {
      // Upsert por numero_controle_pncp: a mesma licitacao reaparece na
      // varredura de varios dias (cada atualizacao no PNCP), e nao pode virar
      // lead duas vezes.
      const linhas = v.achadas.map((h) => ({
        numero_controle_pncp: h.numeroControlePncp,
        orgao_cnpj: h.orgaoCnpj,
        orgao_nome: h.orgaoNome,
        ano: h.ano,
        sequencial: h.sequencial,
        uf: h.uf,
        municipio: h.municipio,
        modalidade_id: h.modalidadeId,
        modalidade_nome: h.modalidadeNome,
        objeto: h.objeto,
        termos: h.termos,
        valor_estimado: h.valorEstimado,
        valor_homologado: h.valorHomologado,
        homologado: true,
        homologado_em: h.dataHomologacao || dataRef,
        prioritario: h.prioritario,
        situacao: h.processo,
        srp: h.srp,
      }));
      for (let i = 0; i < linhas.length; i += 200) {
        const { error } = await supabase.from('pncp_monitor')
          .upsert(linhas.slice(i, i + 200), { onConflict: 'numero_controle_pncp', ignoreDuplicates: true });
        if (error) console.error('[monitor]', error.message);
      }
    }

    detalhes.varredura = v.cursor;
    detalhes.varredura_completa = v.completa;
    detalhes.paginas_lidas = Number(detalhes.paginas_lidas ?? 0) + v.paginasLidas;
    detalhes.paginas_falhas = Number(detalhes.paginas_falhas ?? 0) + v.paginasFalhas;
    detalhes.homologadas = Number(detalhes.homologadas ?? 0) + v.achadas.length;

    await supabase.from('prospeccao_pncp_execucoes')
      .update({ detalhes, coletados: Number(detalhes.homologadas ?? 0) }).eq('id', execId);

    console.log(`[prospeccao-pncp] varredura ${v.completa ? 'concluida' : 'parcial'}: ${v.paginasLidas} paginas, ${v.achadas.length} homologadas no perfil`);
    // NAO retorna aqui. A varredura ALIMENTA o estoque de pncp_monitor; os
    // passos 2 e 3 CONSOMEM esse estoque. Sao independentes.
    //
    // A versao anterior parava aqui quando a varredura nao fechava o dia, e o
    // PNCP derruba quase toda requisicao de manha (162 falhas em 165 paginas
    // em 10/09/2026): a varredura nunca fechava, entao nada era enfileirado e
    // a prospeccao passou dois dias sem enviar nenhum e-mail, com 631
    // licitacoes paradas e 30 vencedores ja identificados esperando.
  }

  // ── Passo 2: quem venceu cada licitacao ───────────────────────────────────
  const fimVencedoresMs = inicioMs + ORCAMENTO_COLETA_MS;
  const validade = new Date(Date.parse(dataRef + 'T12:00:00Z') - Number(config.monitor_validade_dias ?? 90) * 86_400_000)
    .toISOString().slice(0, 10);

  // Registro de precos homologado nao vira contrato assinado, so uma ata que
  // a prefeitura pode ou nao usar. Fica gravado no monitor, mas nao consome
  // sondagem nem lugar na fila enquanto config.incluir_srp for falso.
  let qSemVencedor = supabase.from('pncp_monitor')
    .select('*')
    .eq('homologado', true)
    .is('vencedor_cnpj', null)
    .is('descartado_em', null)
    .gte('homologado_em', validade);
  if (!config.incluir_srp) qSemVencedor = qSemVencedor.eq('srp', false);

  const { data: semVencedor } = await qSemVencedor
    .order('prioritario', { ascending: false })
    .order('valor_homologado', { ascending: false })
    .limit(120);

  const novosVencedores: { linha: Record<string, unknown>; vencedores: Vencedor[] }[] = [];
  for (const linha of (semVencedor ?? [])) {
    if (Date.now() > fimVencedoresMs) break;
    const h: Homologada = {
      numeroControlePncp: String(linha.numero_controle_pncp),
      orgaoCnpj: String(linha.orgao_cnpj),
      orgaoNome: String(linha.orgao_nome ?? ''),
      ano: Number(linha.ano),
      sequencial: Number(linha.sequencial),
      uf: String(linha.uf ?? ''),
      municipio: String(linha.municipio ?? ''),
      modalidadeId: Number(linha.modalidade_id ?? 0),
      modalidadeNome: String(linha.modalidade_nome ?? ''),
      objeto: String(linha.objeto ?? ''),
      termos: (linha.termos as string[]) ?? [],
      valorHomologado: Number(linha.valor_homologado ?? 0),
      valorEstimado: Number(linha.valor_estimado ?? 0),
      dataHomologacao: String(linha.homologado_em ?? ''),
      processo: String(linha.situacao ?? ''),
      prioritario: linha.prioritario === true,
      srp: linha.srp === true,
    };

    const vencedores = await resolverVencedores(h, fimVencedoresMs);
    if (!vencedores.length) {
      // Homologada sem resultado publicado: o orgao ainda nao subiu o vencedor.
      // Fica para o proximo tique ate a validade expirar.
      await supabase.from('pncp_monitor')
        .update({ checado_em: new Date().toISOString(), checagens: Number(linha.checagens ?? 0) + 1 })
        .eq('id', linha.id);
      continue;
    }

    const principal = vencedores[0];
    await supabase.from('pncp_monitor').update({
      vencedor_cnpj: principal.cnpj,
      vencedor_nome: principal.nome,
      vencedor_porte: principal.porte,
      material_ou_servico: principal.materialOuServico,
      checado_em: new Date().toISOString(),
      checagens: Number(linha.checagens ?? 0) + 1,
    }).eq('id', linha.id);

    novosVencedores.push({ linha: linha as Record<string, unknown>, vencedores });
  }

  // Expira o que nunca publicou resultado dentro da validade.
  const { count: expirados } = await supabase.from('pncp_monitor')
    .update({ descartado_em: new Date().toISOString(), descartado_motivo: 'Sem resultado publicado dentro da validade' }, { count: 'exact' })
    .eq('homologado', true).is('vencedor_cnpj', null).is('descartado_em', null)
    .lt('homologado_em', validade);
  if (expirados) avisos.push(`${expirados} licitacao(oes) descartada(s) por nao publicarem o vencedor dentro de ${config.monitor_validade_dias ?? 90} dias.`);

  // ── Passo 3: deduplicacao e fila ──────────────────────────────────────────
  let qProntos = supabase.from('pncp_monitor')
    .select('*')
    .eq('homologado', true)
    .eq('enfileirado', false)
    .not('vencedor_cnpj', 'is', null)
    .is('descartado_em', null);
  if (!config.incluir_srp) qProntos = qProntos.eq('srp', false);

  const { data: prontos } = await qProntos
    .order('prioritario', { ascending: false })
    .order('valor_homologado', { ascending: false })
    .limit(500);

  if (!prontos?.length) return;

  const [pData, sData, lData, fData] = await Promise.all([
    selectTudo((de, ate) => supabase.from('prospects').select('cnpj').not('cnpj', 'is', null).range(de, ate)),
    selectTudo((de, ate) => supabase.from('sales').select('cnpj').not('cnpj', 'is', null).range(de, ate)),
    selectTudo((de, ate) => supabase.from('leads_seguro_garantia').select('cnpj').not('cnpj', 'is', null).range(de, ate)),
    selectTudo((de, ate) => supabase.from('prospeccao_pncp_leads').select('cnpj').eq('resultado', 'fora_do_perfil').range(de, ate)),
  ]);
  const conhecidos = new Set<string>();
  for (const r of [...(pData ?? []), ...(sData ?? []), ...(lData ?? [])]) {
    const d = cleanCnpj(String((r as { cnpj: string }).cnpj));
    if (d.length === 14) conhecidos.add(d);
  }
  for (const r of (fData ?? [])) conhecidos.add(String((r as { cnpj: string }).cnpj));

  // CNPJs cujo e-mail ja foi consultado e nao existe: pular para sempre.
  const semEmailDefinitivo = new Set<string>();
  {
    const cnpjsProntos: string[] = prontos.map((p) => String((p as { vencedor_cnpj: string }).vencedor_cnpj));
    const cnpjs = [...new Set(cnpjsProntos)].filter((c) => !conhecidos.has(c));
    for (let i = 0; i < cnpjs.length; i += 200) {
      const { data } = await supabase.from('prospeccao_pncp_cnpj_cache')
        .select('cnpj').eq('email_consultado', true).eq('tem_email', false)
        .in('cnpj', cnpjs.slice(i, i + 200));
      for (const r of (data ?? [])) semEmailDefinitivo.add(String((r as { cnpj: string }).cnpj));
    }
  }

  // Ja na fila desta execucao: o tique anterior pode ter enfileirado o CNPJ.
  const { data: naFila } = await supabase.from('prospeccao_pncp_fila')
    .select('cnpj').eq('execucao_id', execId);
  const jaEnfileirados = new Set((naFila ?? []).map((r) => String((r as { cnpj: string }).cnpj)));

  const filaRows: Record<string, unknown>[] = [];
  const marcarEnfileirado: number[] = [];
  const vistos = new Set<string>();
  let ordem = jaEnfileirados.size;

  for (const p of prontos) {
    marcarEnfileirado.push(Number(p.id));
    const cnpj = String(p.vencedor_cnpj ?? '');
    if (cnpj.length !== 14) continue;
    if (conhecidos.has(cnpj) || semEmailDefinitivo.has(cnpj) || jaEnfileirados.has(cnpj) || vistos.has(cnpj)) continue;
    vistos.add(cnpj);

    const contrato: Contrato = {
      cnpj,
      razaoPncp: String(p.vencedor_nome ?? ''),
      orgao: String(p.orgao_nome ?? ''),
      objeto: String(p.objeto ?? ''),
      valor: Number(p.valor_homologado ?? 0),
      numeroLicitacao: String(p.numero_controle_pncp ?? ''),
      municipio: String(p.municipio ?? ''),
      uf: String(p.uf ?? ''),
      processo: String(p.situacao ?? ''),
      numeroControlePncp: String(p.numero_controle_pncp ?? ''),
      dataHomologacao: String(p.homologado_em ?? ''),
      modalidade: String(p.modalidade_nome ?? ''),
      termos: (p.termos as string[]) ?? [],
      porte: String(p.vencedor_porte ?? ''),
      materialOuServico: String(p.material_ou_servico ?? ''),
      prioritario: p.prioritario === true,
    };

    filaRows.push({
      execucao_id: execId,
      ordem: ++ordem,
      cnpj,
      contrato,
      data_referencia: dataRef,
    });
  }

  for (let i = 0; i < filaRows.length; i += 500) {
    const { error } = await supabase.from('prospeccao_pncp_fila').insert(filaRows.slice(i, i + 500));
    if (error) console.error('[fila]', error.message);
  }
  for (let i = 0; i < marcarEnfileirado.length; i += 200) {
    await supabase.from('pncp_monitor').update({ enfileirado: true })
      .in('id', marcarEnfileirado.slice(i, i + 200));
  }

  console.log(`[prospeccao-pncp] ${novosVencedores.length} vencedores resolvidos, ${filaRows.length} novos na fila (de ${prontos.length} prontos)`);
}
// ─── Fase 2: consumo da fila ─────────────────────────────────────────────────

async function processarFila(
  supabase: SupabaseClient,
  config: Config,
  execId: string,
  dryRun: boolean,
  fimTarefaMs: number,
  avisos: string[],
): Promise<void> {
  const provedores = criarProvedoresEmail();

  // Contadores acumulados da execucao.
  const { data: execRow } = await supabase.from('prospeccao_pncp_execucoes')
    .select('enriquecidos, erros, detalhes').eq('id', execId).single();
  let consultasBrasilTotal = Number(execRow?.enriquecidos ?? 0);
  let erros = Number(execRow?.erros ?? 0);

  // Falhas de envio agrupadas por motivo, para o relatorio nao repetir a
  // mesma linha dezenas de vezes quando a causa e uma so (ex.: constraint).
  const falhasEnvio = new Map<string, string[]>();

  const { count: enviadosCount } = await supabase.from('prospeccao_pncp_leads')
    .select('id', { count: 'exact', head: true })
    .eq('execucao_id', execId)
    .in('resultado', ['enviado', 'dry_run']);
  let enviados = Number(enviadosCount ?? 0);

  const bloq = await selectTudo((de, ate) => supabase.from('email_blocklist').select('email').range(de, ate));
  const emailsBloqueados = new Set((bloq ?? []).map((r) => String((r as { email: string }).email).toLowerCase()));

  let consultasBrasilRun = 0;

  // Item devolvido a fila por falha transitoria (rede, rate limit) nao e
  // retentado no mesmo tique, senao viraria um loop gastando o orcamento.
  const puladosNesteTique = new Set<string>();

  try {
  while (Date.now() < fimTarefaMs && enviados < Number(config.limite_diario)) {
    const { data: loteBruto } = await supabase.from('prospeccao_pncp_fila')
      .select('id, cnpj, contrato')
      .eq('execucao_id', execId)
      .eq('estado', 'pendente')
      .order('ordem')
      .limit(15 + puladosNesteTique.size);
    const lote = (loteBruto ?? []).filter((i) => !puladosNesteTique.has(String(i.id)));
    if (!lote.length) break;

    let semTempo = false;

    for (const item of lote) {
      if (Date.now() > fimTarefaMs || enviados >= Number(config.limite_diario)) break;

      // Reivindica o item: se outro tique ja pegou, pula. Evita envio duplo
      // quando o disparo manual coincide com o cron.
      const { data: claim } = await supabase.from('prospeccao_pncp_fila')
        .update({ estado: 'avaliado', atualizado_em: new Date().toISOString() })
        .eq('id', item.id).eq('estado', 'pendente')
        .select('id');
      if (!claim?.length) continue;

      const devolver = async () => {
        puladosNesteTique.add(String(item.id));
        await supabase.from('prospeccao_pncp_fila')
          .update({ estado: 'pendente' }).eq('id', item.id);
      };
      const descartar = async () => {
        await supabase.from('prospeccao_pncp_fila')
          .update({ estado: 'descartado' }).eq('id', item.id);
      };

      const contrato = item.contrato as Contrato;

      // Cadastro: cache ou BrasilAPI.
      const { data: cacheRow } = await supabase.from('prospeccao_pncp_cnpj_cache')
        .select('*').eq('cnpj', contrato.cnpj).maybeSingle();

      let empresa: Empresa;
      if (cacheRow) {
        if (cacheRow.email_consultado === true && cacheRow.tem_email !== true) { await descartar(); continue; }
        empresa = {
          razao_social: String(cacheRow.razao_social ?? ''),
          nome_fantasia: String(cacheRow.nome_fantasia ?? ''),
          telefone: String(cacheRow.telefone ?? ''),
          cidade: String(cacheRow.cidade ?? ''),
          uf: String(cacheRow.uf ?? ''),
          cnae_principal: String(cacheRow.cnae_principal ?? ''),
          cnae_descricao: String(cacheRow.cnae_descricao ?? ''),
          cnae_divisao: String(cacheRow.cnae_divisao ?? ''),
          cnaes_secundarios: (cacheRow.cnaes_secundarios as Empresa['cnaes_secundarios']) ?? [],
          socio: String(cacheRow.socio ?? ''),
          situacao: String(cacheRow.situacao ?? ''),
          email: String(cacheRow.email ?? ''),
          email_fonte: String(cacheRow.email_fonte ?? ''),
          email_consultado: cacheRow.email_consultado === true,
        };
      } else {
        if (consultasBrasilTotal >= Number(config.max_consultas_brasilapi)) {
          avisos.push(`Teto de ${config.max_consultas_brasilapi} consultas a BrasilAPI atingido.`);
          await devolver();
          semTempo = true;
          break;
        }
        if (consultasBrasilRun > 0) await pausa(Number(config.pausa_entre_consultas_ms) || 1500);
        consultasBrasilRun++;
        consultasBrasilTotal++;
        const consultada = await consultarBrasilApi(contrato.cnpj);
        if (!consultada) { await devolver(); continue; }
        empresa = consultada;
        await salvarCache(supabase, contrato.cnpj, empresa);
      }

      // Empresa baixada ou suspensa nao interessa nem para o relatorio.
      if (empresa.situacao && empresa.situacao.toUpperCase() !== 'ATIVA') { await descartar(); continue; }

      // Filtro de perfil (CNAE) antes do e-mail: fora do perfil nao gasta
      // consulta de e-mail e vai para a aba propria do relatorio.
      const perfil = avaliaCnae(empresa, config.cnae_divisoes_incluir, config.cnae_divisoes_excluir);
      if (!perfil.ok) {
        await inserirLead(supabase, execId, config, contrato, empresa, 'fora_do_perfil', perfil.motivo, null, null, null);
        continue;
      }

      // E-mail: cache ou cadeia CNPJa -> cnpj.ws.
      if (!empresa.email_consultado) {
        const r = await buscarEmail(contrato.cnpj, provedores, fimTarefaMs);
        if (r.semTempo) { await devolver(); semTempo = true; break; }
        if (!r.consultado) { await devolver(); continue; }
        empresa.email = r.email;
        empresa.email_fonte = r.fonte;
        empresa.email_consultado = true;
        await salvarCache(supabase, contrato.cnpj, empresa);
      }

      if (!empresa.email) {
        await inserirLead(supabase, execId, config, contrato, empresa, 'sem_email',
          'Sem e-mail cadastrado na Receita (CNPJa/cnpj.ws)', null, null, null);
        continue;
      }
      if (!RE_EMAIL.test(empresa.email)) {
        await inserirLead(supabase, execId, config, contrato, empresa, 'sem_email',
          `E-mail com formato invalido: ${empresa.email}`, null, null, null);
        continue;
      }
      if (emailsBloqueados.has(empresa.email)) {
        await inserirLead(supabase, execId, config, contrato, empresa, 'sem_email',
          'E-mail na lista de bloqueio (bounce ou spam anterior)', null, null, null);
        continue;
      }

      // Aprovado. Em dry run, so registra o que seria feito.
      if (dryRun) {
        await inserirLead(supabase, execId, config, contrato, empresa, 'dry_run', 'Dry run: seria enviado', null, null, null);
        enviados++;
        continue;
      }

      const falha = { motivo: '' };
      const ids = await enviarLead(supabase, config, contrato, empresa, falha);
      if (!ids) {
        // O prospect ja foi desfeito em enviarLead; o item volta a pendente
        // e vira sobra amanha (barato: cadastro e e-mail ja estao no cache).
        // Se a causa for permanente, expira pela validade da fila.
        erros++;
        const motivo = falha.motivo || 'erro desconhecido';
        falhasEnvio.set(motivo, [...(falhasEnvio.get(motivo) ?? []), formatCnpj(contrato.cnpj)]);
        console.error(`[envio] ${contrato.cnpj}: ${motivo}`);
        await devolver();
        continue;
      }
      await inserirLead(supabase, execId, config, contrato, empresa, 'enviado',
        ids.okEnvio ? '' : 'Primeiro e-mail falhou; o cron da cadencia tenta amanha',
        ids.prospectId, ids.contatoId, ids.okEnvio ? 'enviado' : 'falha_envio_1');
      enviados++;
    }

    if (semTempo) break;
  }
  } finally {
    // Atualiza contadores acumulados da execucao, mesmo se algo estourar.
    const { data: contagens } = await supabase.from('prospeccao_pncp_leads')
      .select('resultado').eq('execucao_id', execId);
    const conta = (r: string) => (contagens ?? []).filter((x) => x.resultado === r).length;

    for (const [motivo, cnpjs] of falhasEnvio) {
      const lista = cnpjs.slice(0, 5).join(', ') + (cnpjs.length > 5 ? ` e mais ${cnpjs.length - 5}` : '');
      avisos.push(`${cnpjs.length} lead(s) nao entraram na trilha e foram removidos do Kanban (${motivo}): ${lista}. Voltam como sobra amanha.`);
    }

    // Os avisos deste tique ficam persistidos na execucao: so o tique que
    // finaliza o dia chega ao relatorio, e este pode nao ser ele.
    const detalhes = (execRow?.detalhes ?? {}) as Record<string, unknown>;
    const avisosAntigos = Array.isArray(detalhes.avisos) ? (detalhes.avisos as string[]) : [];
    const avisosPersistidos = [...new Set([...avisosAntigos, ...avisos])];

    await supabase.from('prospeccao_pncp_execucoes').update({
      enriquecidos: consultasBrasilTotal,
      enviados: conta('enviado') + conta('dry_run'),
      sem_email: conta('sem_email'),
      fora_do_perfil: conta('fora_do_perfil'),
      erros,
      detalhes: { ...detalhes, avisos: avisosPersistidos },
    }).eq('id', execId);
  }
}

async function salvarCache(supabase: SupabaseClient, cnpj: string, e: Empresa) {
  await supabase.from('prospeccao_pncp_cnpj_cache').upsert({
    cnpj,
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    telefone: e.telefone || null,
    cidade: e.cidade,
    uf: e.uf,
    cnae_principal: e.cnae_principal,
    cnae_descricao: e.cnae_descricao,
    cnae_divisao: e.cnae_divisao,
    cnaes_secundarios: e.cnaes_secundarios,
    socio: e.socio || null,
    situacao: e.situacao,
    email: e.email || null,
    tem_email: !!e.email,
    email_fonte: e.email_fonte || null,
    email_consultado: e.email_consultado,
  }, { onConflict: 'cnpj' });
}

async function inserirLead(
  supabase: SupabaseClient,
  execId: string,
  config: Config,
  contrato: Contrato,
  empresa: Empresa,
  resultado: 'enviado' | 'sem_email' | 'fora_do_perfil' | 'dry_run',
  motivo: string,
  prospectId: string | null,
  contatoId: string | null,
  resendStatus: string | null = null,
) {
  const { error } = await supabase.from('prospeccao_pncp_leads').insert({
    execucao_id: execId,
    tipo_email: empresa.email ? classificarEmail(empresa.email, config) : null,
    socio: empresa.socio || null,
    cnpj: contrato.cnpj,
    razao_social: empresa.razao_social || contrato.razaoPncp,
    nome_fantasia: empresa.nome_fantasia || null,
    email: empresa.email || null,
    telefone: empresa.telefone || null,
    cidade: empresa.cidade || contrato.municipio,
    uf: empresa.uf || contrato.uf,
    cnae_principal: empresa.cnae_principal || null,
    cnae_descricao: empresa.cnae_descricao || null,
    cnae_divisao: empresa.cnae_divisao || null,
    orgao: contrato.orgao,
    objeto: contrato.objeto,
    valor: contrato.valor,
    numero_licitacao: contrato.numeroLicitacao,
    resultado,
    motivo: motivo || null,
    enviado_em: resultado === 'enviado' ? new Date().toISOString() : null,
    resend_status: resendStatus,
    prospect_id: prospectId,
    contato_id: contatoId,
  });
  if (error) console.error('[lead]', error.message);
}

/**
 * Insere no Kanban e na trilha e dispara o primeiro e-mail.
 * Em falha retorna null e preenche falha.motivo; o prospect recem-criado e
 * apagado para o CNPJ nao ficar como "conhecido" na dedup do dia seguinte.
 */
async function enviarLead(
  supabase: SupabaseClient,
  config: Config,
  contrato: Contrato,
  empresa: Empresa,
  falha: { motivo: string },
): Promise<{ prospectId: string; contatoId: string; okEnvio: boolean } | null> {
  const { data: prospect, error: pErr } = await supabase.from('prospects').insert({
    name: empresa.socio || empresa.razao_social,
    company: empresa.nome_fantasia || empresa.razao_social,
    cnpj: formatCnpj(contrato.cnpj),
    email: empresa.email,
    phonenumber: empresa.telefone || null,
    city: empresa.cidade || contrato.municipio,
    state: empresa.uf || contrato.uf,
    status: 'Novos Leads',
    status_entered_at: new Date().toISOString(),
    source: 'pncp_auto',
    product_type: 'Seguro Garantia',
    segmento: empresa.cnae_descricao || null,
    decisor: empresa.socio || null,
    // A data de homologacao e o que a Bruna precisa na ligacao: mostra se o
    // contrato ainda esta por assinar (garantia por contratar) ou se ja passou.
    description: [
      `Venceu licitacao: ${contrato.orgao}`,
      `Objeto: ${contrato.objeto}`,
      `Valor homologado: ${brl(contrato.valor)}`,
      contrato.dataHomologacao ? `Homologada em: ${contrato.dataHomologacao}` : '',
      contrato.modalidade ? `Modalidade: ${contrato.modalidade}` : '',
      contrato.porte ? `Porte do vencedor: ${contrato.porte}` : '',
      `Numero: ${contrato.numeroLicitacao}`,
    ].filter(Boolean).join('\n'),
    tags: ['pncp', 'auto', ...(contrato.prioritario ? ['prioritario'] : [])],
    cnae_principal: empresa.cnae_principal,
    cnae_divisao: empresa.cnae_divisao,
    orgao_licitante: contrato.orgao,
    objeto_contrato: contrato.objeto,
    valor_contrato: contrato.valor,
    numero_licitacao: contrato.numeroLicitacao,
  }).select('id').single();
  if (pErr || !prospect) {
    falha.motivo = `Kanban: ${pErr?.message ?? 'insert sem retorno'}`;
    console.error('[prospect]', falha.motivo);
    return null;
  }

  const { data: contato, error: cErr } = await supabase.from('email_cadencia').insert({
    nome_contato: primeiroNome(empresa.socio) || empresa.nome_fantasia || empresa.razao_social,
    nome_empresa: empresa.nome_fantasia || empresa.razao_social,
    email: empresa.email,
    origem: 'pncp_auto',
    trilha: config.trilha,
    data_inicio: hojeBRT(),
    ativo: true,
    prospect_id: prospect.id,
  }).select('id').single();
  if (cErr || !contato) {
    falha.motivo = `trilha de e-mail: ${cErr?.message ?? 'insert sem retorno'}`;
    console.error('[cadencia]', falha.motivo);
    const { error: dErr } = await supabase.from('prospects').delete().eq('id', prospect.id);
    if (dErr) console.error('[prospect] falha ao desfazer', prospect.id, dErr.message);
    return null;
  }

  // Primeiro e-mail agora, pela funcao que ja existe. Templates e cadencia
  // continuam morando la; o pregao nao e citado em nenhum e-mail.
  let okEnvio = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/prospecting-cadence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SVC}` },
      body: JSON.stringify({ contact_id: contato.id }),
    });
    const resp = await r.json().catch(() => ({}));
    okEnvio = r.ok && resp?.success !== false;
  } catch (e) {
    console.error('[cadence]', e);
  }

  return { prospectId: prospect.id as string, contatoId: contato.id as string, okEnvio };
}

// ─── Fase 3: finalizacao (XLSX + relatorio) ──────────────────────────────────

async function finalizar(
  supabase: SupabaseClient,
  config: Config,
  execId: string,
  dataRef: string,
  dryRun: boolean,
  avisos: string[],
): Promise<void> {
  const { data: exec } = await supabase.from('prospeccao_pncp_execucoes')
    .select('*').eq('id', execId).single();
  if (!exec || exec.fase === 'finalizada') return;

  const { data: rows } = await supabase.from('prospeccao_pncp_leads')
    .select('*').eq('execucao_id', execId).order('valor', { ascending: false });
  const leads = (rows ?? []) as LeadRow[];

  const semEmail = leads.filter((l) => l.resultado === 'sem_email').length;
  const foraPerfil = leads.filter((l) => l.resultado === 'fora_do_perfil').length;
  const enviados = leads.filter((l) => l.resultado === 'enviado' || l.resultado === 'dry_run').length;

  const avisosAntigos: string[] = Array.isArray(exec.detalhes?.avisos) ? exec.detalhes.avisos : [];
  const todosAvisos = [...new Set([...avisosAntigos, ...avisos])];

  const xlsxB64 = montarXlsx(leads, dryRun);
  const caminho = `${dataRef}${dryRun ? '-dry-run' : ''}.xlsx`;
  const { error: upErr } = await supabase.storage.from('prospeccao-pncp').upload(
    caminho,
    base64ParaBytes(xlsxB64),
    { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true },
  );
  if (upErr) todosAvisos.push(`Falha ao salvar o XLSX no Storage: ${upErr.message}`);

  await enviarRelatorio({
    para: config.email_relatorio,
    dataRef, dryRun,
    coletados: Number(exec.coletados ?? 0),
    enriquecidos: Number(exec.enriquecidos ?? 0),
    enviados, semEmail, foraPerfil,
    avisos: todosAvisos,
    anexoBase64: xlsxB64,
  });

  await supabase.from('prospeccao_pncp_execucoes').update({
    fase: 'finalizada',
    enviados,
    sem_email: semEmail,
    fora_do_perfil: foraPerfil,
    arquivo_relatorio: upErr ? null : caminho,
    detalhes: { ...(exec.detalhes ?? {}), avisos: todosAvisos, finalizada_em: new Date().toISOString() },
  }).eq('id', execId);

  console.log(`[prospeccao-pncp] execucao ${execId} finalizada: ${enviados} enviados, ${semEmail} sem e-mail, ${foraPerfil} fora do perfil`);
}

// ─── Orquestracao de um tique ────────────────────────────────────────────────

async function executarTique(body: Record<string, unknown>): Promise<void> {
  const inicioMs = Date.now();
  const fimTarefaMs = inicioMs + ORCAMENTO_TAREFA_MS;

  try {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SVC);

    const { data: cfg, error: cfgErr } = await supabase
      .from('prospeccao_pncp_config').select('*').eq('id', 1).single();
    if (cfgErr || !cfg) { console.error('[config]', cfgErr?.message); return; }
    const config = cfg as Config;

    if (!config.ativo) { console.log('[prospeccao-pncp] desligada'); return; }
    if (config.pausado) { console.log('[prospeccao-pncp] pausada por reputacao'); return; }

    // Pausa GLOBAL por dominio (bounces de todas as automacoes somados).
    const { data: rep } = await supabase.from('reputacao_envio').select('pausado').limit(1).maybeSingle();
    if (rep?.pausado) { console.log('[prospeccao-pncp] pausada pela reputacao global do dominio'); return; }

    const manual = body.dry_run === true;
    const dryRun = config.dry_run || manual;
    const dataRef = typeof body.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data)
      ? body.data
      : diaAnteriorBRT();

    const avisos: string[] = [];

    // Execucao do dia (mesma data e mesmo modo).
    const { data: execs } = await supabase.from('prospeccao_pncp_execucoes')
      .select('id, fase')
      .eq('data_referencia', dataRef)
      .eq('dry_run', dryRun)
      .order('executado_em', { ascending: false })
      .limit(1);
    let execId = execs?.[0]?.id as string | undefined;
    const fase = execs?.[0]?.fase as string | undefined;

    if (execId && fase === 'finalizada') {
      // Dia fechado. O botao manual pode reabrir com uma execucao nova de dry
      // run; o cron nao reprocessa.
      if (!manual) { console.log(`[prospeccao-pncp] ${dataRef} ja finalizada`); return; }
      execId = undefined;
    }

    if (!execId) {
      const criado = await abrirExecucao(supabase, dataRef, dryRun);
      if (!criado) return;
      execId = criado;
    }

    // A coleta e retomavel e roda em todo tique: a varredura de um dia passa
    // de 150 paginas e nao cabe num tique so. Quando ja terminou, sai barato.
    await coletarHomologacoes(supabase, config, execId, dataRef, inicioMs, avisos);

    // Fim de semana: COLETA sim, ENVIO nao. O lead fica em pncp_monitor e sai
    // na segunda, com a fila ordenada por prioritario e valor como sempre.
    // Coletar no sabado e domingo e necessario porque cada tique olha so o dia
    // anterior: pular o fim de semana perderia essas homologacoes para sempre.
    const fimDeSemana = fimDeSemanaBRT();

    if (Date.now() < fimTarefaMs && !fimDeSemana) {
      await processarFila(supabase, config, execId, dryRun, fimTarefaMs, avisos);
    }
    if (fimDeSemana) {
      avisos.push('Fim de semana: coleta feita, envio nao. Os leads saem na segunda.');
      console.log('[prospeccao-pncp] fim de semana: coletou e nao enviou');
    }

    // A varredura incompleta segura a finalizacao: fila vazia agora nao quer
    // dizer dia terminado, so que a coleta ainda nao chegou nos leads.
    const { data: execAtual } = await supabase.from('prospeccao_pncp_execucoes')
      .select('detalhes').eq('id', execId).single();
    const varreduraCompleta =
      ((execAtual?.detalhes ?? {}) as Record<string, unknown>).varredura_completa === true;

    // Finaliza quando a fila esvazia, o limite fecha ou o horario passa.
    const { count: pendentes } = await supabase.from('prospeccao_pncp_fila')
      .select('id', { count: 'exact', head: true })
      .eq('execucao_id', execId).eq('estado', 'pendente');
    const { count: enviadosCount } = await supabase.from('prospeccao_pncp_leads')
      .select('id', { count: 'exact', head: true })
      .eq('execucao_id', execId).in('resultado', ['enviado', 'dry_run']);

    // A hora limite existe para o cron fechar o dia antes do meio-dia. Num
    // disparo manual ela nao se aplica: rodar as 21h nao pode significar
    // "finalize imediatamente", senao o teste fecha antes de coletar nada.
    const estourouHorario = !manual && horaBRT() >= HORA_LIMITE_BRT;

    const deveFinalizar =
      (varreduraCompleta && Number(pendentes ?? 0) === 0) ||
      Number(enviadosCount ?? 0) >= Number(config.limite_diario) ||
      estourouHorario;

    // Alarme de silencio: dia fechado, sem nenhum envio, mas com licitacao
    // pronta esperando. E o sintoma de pipeline travado, nao de dia fraco —
    // exatamente o que passou despercebido por dois dias em 10 e 11/09/2026.
    // No fim de semana zero envio e o comportamento correto, nao sintoma.
    if (deveFinalizar && !dryRun && !fimDeSemana && Number(enviadosCount ?? 0) === 0) {
      const { count: prontas } = await supabase.from('pncp_monitor')
        .select('id', { count: 'exact', head: true })
        .eq('homologado', true).is('descartado_em', null)
        .not('vencedor_cnpj', 'is', null);
      if (Number(prontas ?? 0) > 0) {
        avisos.push(
          `ATENCAO: o dia fechou sem enviar nenhum e-mail, mas ha ${prontas} licitacao(oes) ` +
          `com vencedor ja identificado esperando. Isso indica pipeline travado, nao falta de lead.`,
        );
        console.error(`[prospeccao-pncp] ALARME: 0 enviados com ${prontas} prontas`);
      }
    }

    if (deveFinalizar) {
      await finalizar(supabase, config, execId, dataRef, dryRun, avisos);
    } else {
      console.log(`[prospeccao-pncp] tique concluido: ${pendentes} pendentes, ${enviadosCount} enviados`);
    }
  } catch (err) {
    console.error('[prospeccao-pncp]', err instanceof Error ? err.message : String(err));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // Cada tique trabalha em background e responde na hora: a requisicao nao
  // pode ficar 150s aberta e o pg_cron so espera 5s.
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const tarefa = executarTique(body as Record<string, unknown>);
  if (runtime?.waitUntil) {
    runtime.waitUntil(tarefa);
    return json({
      success: true,
      started: true,
      info: 'Tique iniciado em background. Acompanhe na tela Prospeccao Automatica ou aguarde o relatorio por e-mail.',
    }, 202);
  }
  await tarefa;
  return json({ success: true });
});
