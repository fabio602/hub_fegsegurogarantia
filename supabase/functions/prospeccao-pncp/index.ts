// ============================================================================
// prospeccao-pncp
//
// Prospeccao automatica de vencedores de licitacao no PNCP, em lotes.
//
// Restricoes de producao que moldaram o desenho:
//   - A Edge Function deste projeto e encerrada aos 150s (WallClockTime), e a
//     requisicao HTTP tem idle timeout de 150s. Cada invocacao responde 202 na
//     hora, trabalha em background (EdgeRuntime.waitUntil) e para aos ~130s.
//   - A BrasilAPI nao retorna e-mail (a Receita tirou o campo dos dados
//     abertos). O e-mail vem da CNPJa aberta (5/min) com fallback cnpj.ws
//     (3/min): 13s a 21s por CNPJ.
//   - O PNCP responde em ~10s por pagina para o IP da AWS; a coleta usa
//     paginas de 500 e lotes paralelos.
//
// Por isso o dia e uma EXECUCAO com fila persistente (prospeccao_pncp_fila):
//   - O primeiro tique do cron (07:00 BRT) coleta o dia anterior no PNCP,
//     filtra por valor/UF/modalidade, deduplica e enfileira por valor
//     decrescente.
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

const PNCP_API = 'https://pncp.gov.br/api/consulta/v1/contratos';
const BRASILAPI_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1';
const PNCP_PAGE_SIZE = 500;    // 100 da HTTP 500 no PNCP; 200 e 500 funcionam
const PNCP_PARALELAS = 6;

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
  fila_validade_dias: number;
}

interface Contrato {
  cnpj: string;            // 14 digitos
  razaoPncp: string;
  orgao: string;
  objeto: string;
  valor: number;
  numeroLicitacao: string;
  municipio: string;
  uf: string;
  processo: string;
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

async function fetchComRetry(url: string, tentativas = 3): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body) return body as Record<string, unknown>;
      }
    } catch { /* tenta de novo */ }
    if (i < tentativas - 1) await pausa(1000 * (i + 1));
  }
  return null;
}

async function coletarPncp(dataRef: string, inicioMs: number): Promise<{
  contratos: Contrato[]; paginasLidas: number; paginasFalhas: number; incompleto: boolean;
}> {
  const dataParam = dataRef.replaceAll('-', '');
  const contratos: Contrato[] = [];
  let paginasLidas = 0;
  let paginasFalhas = 0;
  let incompleto = false;

  const urlPagina = (p: number) =>
    `${PNCP_API}?dataInicial=${dataParam}&dataFinal=${dataParam}&pagina=${p}&tamanhoPagina=${PNCP_PAGE_SIZE}`;

  const primeira = await fetchComRetry(urlPagina(1));
  if (!primeira) return { contratos, paginasLidas, paginasFalhas: 1, incompleto: true };

  const totalPaginas = Math.max(1, Number(primeira.totalPaginas) || 1);

  const processa = (body: Record<string, unknown>) => {
    paginasLidas++;
    for (const raw of ((body.data as Record<string, unknown>[]) ?? [])) {
      const cnpj = cleanCnpj(String(raw.niFornecedor ?? ''));
      if (cnpj.length !== 14 || raw.tipoPessoa === 'PF') continue;
      const orgaoEnt = raw.orgaoEntidade as Record<string, unknown> | undefined;
      const unidade = raw.unidadeOrgao as Record<string, unknown> | undefined;
      contratos.push({
        cnpj,
        razaoPncp: String(raw.nomeRazaoSocialFornecedor ?? ''),
        orgao: String(orgaoEnt?.razaoSocial ?? ''),
        objeto: String(raw.objetoContrato ?? ''),
        valor: Number(raw.valorGlobal ?? raw.valorInicial ?? 0) || 0,
        numeroLicitacao: String(raw.numeroContratoEmpenho ?? raw.numeroControlePNCP ?? ''),
        municipio: String(unidade?.municipioNome ?? ''),
        uf: String(unidade?.ufSigla ?? ''),
        processo: String(raw.processo ?? ''),
      });
    }
  };

  processa(primeira);

  // Demais paginas em lotes paralelos, por causa da latencia alta do PNCP.
  const pendentes: number[] = [];
  for (let p = 2; p <= totalPaginas; p++) pendentes.push(p);

  for (let i = 0; i < pendentes.length; i += PNCP_PARALELAS) {
    if (Date.now() - inicioMs > ORCAMENTO_COLETA_MS) { incompleto = true; break; }
    const lote = pendentes.slice(i, i + PNCP_PARALELAS);
    const results = await Promise.all(lote.map((p) => fetchComRetry(urlPagina(p))));
    for (const body of results) {
      if (!body) { paginasFalhas++; continue; }
      processa(body);
    }
  }

  return { contratos, paginasLidas, paginasFalhas, incompleto: incompleto || paginasFalhas > 0 };
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
// 'generico_corporativo': caixa setorial (fiscal@, juridico@, dl-...).
// 'direto': os demais. O XLSX ordena com 'direto' primeiro.
type TipoEmail = 'direto' | 'generico_corporativo' | 'contador';

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
  return 'direto';
}

const ORDEM_TIPO_EMAIL: Record<string, number> = { direto: 0, generico_corporativo: 1, contador: 2 };

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

async function criarExecucao(
  supabase: SupabaseClient,
  config: Config,
  dataRef: string,
  dryRun: boolean,
  inicioMs: number,
  avisos: string[],
): Promise<string | null> {
  const coleta = await coletarPncp(dataRef, inicioMs);
  if (coleta.incompleto) {
    avisos.push(`Coleta PNCP incompleta (${coleta.paginasLidas} paginas lidas, ${coleta.paginasFalhas} falharam).`);
  }

  // Filtros de valor, UF e modalidade + melhor contrato por CNPJ.
  const porCnpj = new Map<string, Contrato>();
  for (const c of coleta.contratos) {
    if (c.valor < Number(config.valor_minimo)) continue;
    if (config.ufs.length && !config.ufs.includes(c.uf)) continue;
    if (RE_DISPENSA_INEXIG.test(c.processo) && c.valor < Number(config.dispensa_inexig_valor_minimo)) continue;
    const atual = porCnpj.get(c.cnpj);
    if (!atual || c.valor > atual.valor) porCnpj.set(c.cnpj, c);
  }
  const candidatos = [...porCnpj.values()].sort((a, b) => b.valor - a.valor);

  // Sobras de execucoes anteriores: pendentes que a janela nao alcancou.
  // Os ainda validos (data do contrato dentro da validade) migram para a
  // frente da fila de hoje; os vencidos sao encerrados.
  const validadeDias = Number(config.fila_validade_dias ?? 3);
  const dataLimite = new Date(Date.parse(dataRef + 'T12:00:00Z') - validadeDias * 86_400_000)
    .toISOString().slice(0, 10);

  const { data: pendentesAntigos } = await supabase.from('prospeccao_pncp_fila')
    .select('id, cnpj, contrato, data_referencia')
    .eq('estado', 'pendente');

  let sobrasExpiradas = 0;
  const sobrasPorCnpj = new Map<string, { contrato: Contrato; data_referencia: string }>();
  for (const row of (pendentesAntigos ?? [])) {
    const dref = String(row.data_referencia ?? dataRef);
    if (dref < dataLimite) { sobrasExpiradas++; continue; }
    const contrato = row.contrato as Contrato;
    const atual = sobrasPorCnpj.get(String(row.cnpj));
    if (!atual || contrato.valor > atual.contrato.valor) {
      sobrasPorCnpj.set(String(row.cnpj), { contrato, data_referencia: dref });
    }
  }

  // Deduplicacao: quem ja esta no Hub ou ja foi descartado por perfil.
  const [pData, sData, lData, fData] = await Promise.all([
    selectTudo((de, ate) => supabase.from('prospects').select('cnpj').not('cnpj', 'is', null).range(de, ate)),
    selectTudo((de, ate) => supabase.from('sales').select('cnpj').not('cnpj', 'is', null).range(de, ate)),
    selectTudo((de, ate) => supabase.from('leads_seguro_garantia').select('cnpj').not('cnpj', 'is', null).range(de, ate)),
    selectTudo((de, ate) => supabase.from('prospeccao_pncp_leads').select('cnpj').eq('resultado', 'fora_do_perfil').range(de, ate)),
  ]);
  const pRes = { data: pData }, sRes = { data: sData }, lRes = { data: lData }, fRes = { data: fData };
  const conhecidos = new Set<string>();
  for (const r of [...(pRes.data ?? []), ...(sRes.data ?? []), ...(lRes.data ?? [])]) {
    const d = cleanCnpj(String((r as { cnpj: string }).cnpj));
    if (d.length === 14) conhecidos.add(d);
  }
  for (const r of (fRes.data ?? [])) conhecidos.add(String((r as { cnpj: string }).cnpj));

  // CNPJs cujo e-mail ja foi consultado e nao existe: pular para sempre.
  const semEmailDefinitivo = new Set<string>();
  {
    const cnpjs = [...new Set([...candidatos.map((c) => c.cnpj), ...sobrasPorCnpj.keys()])]
      .filter((c) => !conhecidos.has(c));
    for (let i = 0; i < cnpjs.length; i += 200) {
      const { data } = await supabase.from('prospeccao_pncp_cnpj_cache')
        .select('cnpj').eq('email_consultado', true).eq('tem_email', false)
        .in('cnpj', cnpjs.slice(i, i + 200));
      for (const r of (data ?? [])) semEmailDefinitivo.add(String((r as { cnpj: string }).cnpj));
    }
  }

  const novos = candidatos.filter((c) => !conhecidos.has(c.cnpj) && !semEmailDefinitivo.has(c.cnpj));

  // Sobra some quando o CNPJ reaparece na coleta de hoje (o contrato novo
  // manda, com validade renovada) ou quando os filtros de dedup o pegam.
  const cnpjsHoje = new Set(novos.map((c) => c.cnpj));
  const sobras = [...sobrasPorCnpj.entries()]
    .filter(([cnpj]) => !cnpjsHoje.has(cnpj) && !conhecidos.has(cnpj) && !semEmailDefinitivo.has(cnpj))
    .map(([, v]) => v)
    .sort((a, b) => b.contrato.valor - a.contrato.valor);

  const { data: exec, error: execErr } = await supabase
    .from('prospeccao_pncp_execucoes')
    .insert({
      data_referencia: dataRef,
      dry_run: dryRun,
      fase: 'processando',
      coletados: candidatos.length,
      detalhes: {
        paginas_pncp: coleta.paginasLidas,
        paginas_falhas: coleta.paginasFalhas,
        contratos_brutos: coleta.contratos.length,
        candidatos_novos: novos.length,
        sobras_aproveitadas: sobras.length,
        sobras_expiradas: sobrasExpiradas,
        avisos,
      },
    })
    .select('id').single();
  if (execErr || !exec) {
    console.error('[execucao]', execErr?.message);
    return null;
  }
  const execId = exec.id as string;

  // Encerra os pendentes antigos: os validos acabaram de migrar para a fila
  // nova e os vencidos nao serao mais processados.
  {
    const idsAntigos = (pendentesAntigos ?? []).map((r) => String(r.id));
    for (let i = 0; i < idsAntigos.length; i += 200) {
      await supabase.from('prospeccao_pncp_fila')
        .update({ estado: 'descartado', atualizado_em: new Date().toISOString() })
        .in('id', idsAntigos.slice(i, i + 200))
        .eq('estado', 'pendente');
    }
  }

  // Enfileira: sobras primeiro (pedido do Fabio), depois os novos do dia,
  // cada grupo por valor decrescente. A data_referencia da sobra e a do
  // contrato original, para a validade continuar contando do dia certo.
  const filaRows = [
    ...sobras.map((s2, i) => ({
      execucao_id: execId,
      ordem: i + 1,
      cnpj: s2.contrato.cnpj,
      contrato: s2.contrato,
      data_referencia: s2.data_referencia,
    })),
    ...novos.map((c, i) => ({
      execucao_id: execId,
      ordem: sobras.length + i + 1,
      cnpj: c.cnpj,
      contrato: c,
      data_referencia: dataRef,
    })),
  ];
  for (let i = 0; i < filaRows.length; i += 500) {
    const { error } = await supabase.from('prospeccao_pncp_fila').insert(filaRows.slice(i, i + 500));
    if (error) console.error('[fila]', error.message);
  }

  console.log(`[prospeccao-pncp] execucao ${execId} criada: ${candidatos.length} candidatos, ${sobras.length} sobras aproveitadas, ${sobrasExpiradas} expiradas, ${filaRows.length} na fila`);
  return execId;
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
    .select('enriquecidos').eq('id', execId).single();
  let consultasBrasilTotal = Number(execRow?.enriquecidos ?? 0);

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

      const ids = await enviarLead(supabase, config, contrato, empresa);
      if (!ids) { continue; }
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
    await supabase.from('prospeccao_pncp_execucoes').update({
      enriquecidos: consultasBrasilTotal,
      enviados: conta('enviado') + conta('dry_run'),
      sem_email: conta('sem_email'),
      fora_do_perfil: conta('fora_do_perfil'),
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

/** Insere no Kanban e na trilha e dispara o primeiro e-mail. */
async function enviarLead(
  supabase: SupabaseClient,
  config: Config,
  contrato: Contrato,
  empresa: Empresa,
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
    description: `Venceu licitacao: ${contrato.orgao}\nObjeto: ${contrato.objeto}\nValor: ${brl(contrato.valor)}\nNumero: ${contrato.numeroLicitacao}`,
    tags: ['pncp', 'auto'],
    cnae_principal: empresa.cnae_principal,
    cnae_divisao: empresa.cnae_divisao,
    orgao_licitante: contrato.orgao,
    objeto_contrato: contrato.objeto,
    valor_contrato: contrato.valor,
    numero_licitacao: contrato.numeroLicitacao,
  }).select('id').single();
  if (pErr || !prospect) { console.error('[prospect]', pErr?.message); return null; }

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
  if (cErr || !contato) { console.error('[cadencia]', cErr?.message); return null; }

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
      const criado = await criarExecucao(supabase, config, dataRef, dryRun, inicioMs, avisos);
      if (!criado) return;
      execId = criado;
    }

    if (Date.now() < fimTarefaMs) {
      await processarFila(supabase, config, execId, dryRun, fimTarefaMs, avisos);
    }

    // Finaliza quando a fila esvazia, o limite fecha ou o horario passa.
    const { count: pendentes } = await supabase.from('prospeccao_pncp_fila')
      .select('id', { count: 'exact', head: true })
      .eq('execucao_id', execId).eq('estado', 'pendente');
    const { count: enviadosCount } = await supabase.from('prospeccao_pncp_leads')
      .select('id', { count: 'exact', head: true })
      .eq('execucao_id', execId).in('resultado', ['enviado', 'dry_run']);

    const deveFinalizar =
      Number(pendentes ?? 0) === 0 ||
      Number(enviadosCount ?? 0) >= Number(config.limite_diario) ||
      horaBRT() >= HORA_LIMITE_BRT;

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
