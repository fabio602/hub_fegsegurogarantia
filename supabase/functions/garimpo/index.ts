// ============================================================================
// garimpo
//
// Motor unico das campanhas de garimpo (tabela campanhas_garimpo). Cada
// campanha define fonte, termos, cidades, exclusoes, trilha, limite diario e
// cadencia; este codigo nao sabe nada de "consultores" ou "imobiliarias".
//
// Modelo de tiques (a funcao morre aos 150s): o cron dispara a cada 10 min
// na janela 08:05 as 11:55 BRT e cada tique atende UMA campanha (rodizio por
// ultimo_tique). Fases de um tique, na ordem, ate o orcamento de ~105s:
//
//   1. Colheita: se ha um run do Apify em andamento, verifica o status e
//      ingere os lugares no estoque (dedup por place_id, telefone e e-mail,
//      inclusive contra as outras campanhas).
//   2. Garimpo: se o estoque util esta abaixo do alvo (limite_diario x 14) e
//      ha cidade pendente no ciclo, inicia um run do actor
//      compass/crawler-google-places (US$ 1,50 por 1.000 lugares) para a
//      proxima cidade. O ciclo recomeca pela cadencia da campanha.
//   3. Enriquecimento: para itens novos, aplica as exclusoes (com suporte a
//      "X sem mencao a Y"), visita o site (home e /contato) para extrair
//      e-mail e CNPJ, valida o CNPJ na BrasilAPI (cache compartilhado com o
//      PNCP) e classifica o e-mail (tipos da config do PNCP).
//        com e-mail valido -> 'enriquecido' (aguarda envio)
//        sem e-mail, com telefone -> 'so_whatsapp' (Kanban "Contato por
//          WhatsApp", trabalho manual da Bruna; sem trilha)
//        sem canal, exclusao, CNPJ ausente com exigir_cnpj -> 'descartado'
//   4. Envio diario: ate limite_diario por dia, priorizando e-mail 'direto',
//      depois site proprio, depois mais avaliacoes no Maps. Entra no Kanban
//      (Novos Leads, origem garimpo_<slug>) e na trilha da campanha via
//      prospecting-cadence, com as variaveis [CIDADE] e [SITE].
//   5. Relatorio: no fim do dia (limite atingido ou 11:30 BRT), XLSX com as
//      abas Enviados, So WhatsApp, Sem e-mail valido (so bounce) e
//      Descartados, salvo em garimpo/<slug>/AAAA-MM-DD.xlsx e enviado por
//      e-mail com estoque restante e cidades pendentes no corpo.
//
// Reputacao: antes de enviar, consulta a pausa GLOBAL por dominio
// (reputacao_envio), alimentada pelo webhook do Resend com os bounces de
// todas as automacoes somados (PNCP + campanhas).
//
// Dry run (campanha.dry_run): tudo roda, menos Kanban, trilha e e-mails; a
// selecao do dia sai no relatorio como "Enviados (dry run)" e o estado do
// estoque nao muda, entao o envio real continua possivel depois.
//
// Corpo opcional: { "campanha": "<slug>" } forca o tique numa campanha.
// Segredo necessario: APIFY_TOKEN (Edge Functions > Secrets).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SVC   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const APIFY_TOKEN    = Deno.env.get('APIFY_TOKEN') ?? '';
const FROM_EMAIL     = 'fabio@fegsegurogarantia.com.br';

const APIFY_ACTOR = 'compass~crawler-google-places';
const MAX_LUGARES_POR_BUSCA = 40;

const ORCAMENTO_TAREFA_MS = 105_000;
const HORA_LIMITE_BRT = '11:30';
const LOTE_ENRIQUECIMENTO = 10;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hojeBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function horaBRT(): string {
  return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
}

const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function cleanCnpj(v: string): string {
  return (v || '').replace(/\D/g, '').slice(0, 14);
}

function formatCnpj(digits: string): string {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function normalizarTelefone(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  // Remove o codigo do pais, se veio.
  return d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
}

/** Remove acentos e baixa a caixa, para comparacoes de exclusao. */
function normalizar(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dominioDoSite(site: string): string {
  try {
    return new URL(site.startsWith('http') ? site : `https://${site}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Site proprio = dominio que nao e rede social nem agregador. */
function siteProprio(site: string | null | undefined): boolean {
  const d = dominioDoSite(String(site ?? ''));
  if (!d) return false;
  return !/facebook|instagram|linktr\.ee|linktree|wa\.me|whatsapp|google|blogspot|wordpress\.com|wixsite|negocio\.site|business\.site/.test(d);
}

/** Divisao CNAE nao e usada aqui, mas a classificacao de e-mail e a mesma do PNCP. */
type TipoEmail = 'direto' | 'generico_corporativo' | 'contador';

function classificarEmail(email: string, padroesContador: string[], prefixosGenericos: string[]): TipoEmail {
  const e = (email || '').toLowerCase();
  if (!e.includes('@')) return 'direto';
  const [prefixo, dominio] = e.split('@');
  for (const padrao of (padroesContador ?? [])) {
    const t = padrao.toLowerCase().trim();
    if (t && (prefixo.includes(t) || dominio.includes(t))) return 'contador';
  }
  for (const pref of (prefixosGenericos ?? [])) {
    const t = pref.toLowerCase().trim();
    if (t && prefixo.startsWith(t)) return 'generico_corporativo';
  }
  return 'direto';
}

const ORDEM_TIPO_EMAIL: Record<string, number> = { direto: 0, generico_corporativo: 1, contador: 2 };

// ─── Exclusoes ───────────────────────────────────────────────────────────────
//
// Regra simples: exclui quando o termo aparece no nome/categoria.
// Regra condicional "X sem mencao a Y": exclui quando contem X e NAO contem Y
// em lugar nenhum (nome, categoria ou texto do site, quando ja coletado).

function avaliarExclusoes(
  regras: string[],
  nomeECategoria: string,
  textoSite: string,
): { excluido: boolean; motivo: string } {
  const base = normalizar(nomeECategoria);
  const tudo = base + ' ' + normalizar(textoSite);
  for (const regra of (regras ?? [])) {
    const m = regra.match(/^(.+?)\s+sem\s+men[cç][aã]o\s+a\s+(.+)$/i);
    if (m) {
      const x = normalizar(m[1]);
      const y = normalizar(m[2]);
      if (base.includes(x) && !tudo.includes(y)) {
        return { excluido: true, motivo: `Exclusao: "${m[1]}" sem mencao a "${m[2]}"` };
      }
    } else if (base.includes(normalizar(regra))) {
      return { excluido: true, motivo: `Exclusao: "${regra}"` };
    }
  }
  return { excluido: false, motivo: '' };
}

// ─── Apify ───────────────────────────────────────────────────────────────────

async function iniciarRunApify(termos: string[], cidade: string): Promise<{ runId: string; datasetId: string } | null> {
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchStringsArray: termos,
        locationQuery: `${cidade}, Brasil`,
        maxCrawledPlacesPerSearch: MAX_LUGARES_POR_BUSCA,
        language: 'pt-BR',
        skipClosedPlaces: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error('[apify] iniciar run:', res.status, await res.text());
      return null;
    }
    const body = await res.json();
    return { runId: String(body?.data?.id ?? ''), datasetId: String(body?.data?.defaultDatasetId ?? '') };
  } catch (e) {
    console.error('[apify]', e);
    return null;
  }
}

async function statusRunApify(runId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return 'ERRO';
    const body = await res.json();
    return String(body?.data?.status ?? 'ERRO');
  } catch {
    return 'ERRO';
  }
}

interface LugarApify {
  placeId: string;
  nome: string;
  categoria: string;
  endereco: string;
  cidade: string;
  uf: string;
  telefone: string;
  site: string;
  email: string;
  avaliacoes: number;
  nota: number;
}

async function itensDatasetApify(datasetId: string): Promise<LugarApify[]> {
  const itens: LugarApify[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&format=json&clean=true&limit=500&offset=${offset}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) break;
    const lote = await res.json().catch(() => []) as Record<string, unknown>[];
    if (!Array.isArray(lote) || !lote.length) break;
    for (const raw of lote) {
      const placeId = String(raw.placeId ?? raw.placeID ?? '');
      const nome = String(raw.title ?? '');
      if (!placeId || !nome) continue;
      const emails = Array.isArray(raw.emails) ? raw.emails as string[] : [];
      itens.push({
        placeId,
        nome,
        categoria: String(raw.categoryName ?? ''),
        endereco: String(raw.address ?? ''),
        cidade: String(raw.city ?? ''),
        uf: String(raw.state ?? '').slice(0, 2).toUpperCase(),
        telefone: String(raw.phone ?? raw.phoneUnformatted ?? ''),
        site: String(raw.website ?? ''),
        email: String(emails[0] ?? '').trim().toLowerCase(),
        avaliacoes: Number(raw.reviewsCount ?? 0) || 0,
        nota: Number(raw.totalScore ?? 0) || 0,
      });
    }
    offset += lote.length;
    if (lote.length < 500) break;
  }
  return itens;
}

// ─── Site: e-mail, CNPJ e texto para exclusoes ───────────────────────────────

async function lerPagina(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FGHub/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const tipo = res.headers.get('content-type') ?? '';
    if (!tipo.includes('text/html') && !tipo.includes('text/plain')) return '';
    return (await res.text()).slice(0, 400_000);
  } catch {
    return '';
  }
}

function extrairEmails(html: string, dominioPreferido: string): string {
  const brutos = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  const limpos = [...new Set(brutos.map((e) => e.toLowerCase()))]
    .filter((e) => RE_EMAIL.test(e))
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e))
    .filter((e) => !/sentry|example\.|wixpress|sentry-next|@2x|schema\.org|w3\.org|(^|@)(email|dominio|seudominio|site)\./.test(e));
  if (!limpos.length) return '';
  const doDominio = limpos.find((e) => dominioPreferido && e.endsWith(`@${dominioPreferido}`));
  return doDominio ?? limpos[0];
}

function extrairCnpj(html: string): string {
  const m = html.match(/\b\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}\b/g) ?? [];
  for (const c of m) {
    const d = cleanCnpj(c);
    if (d.length === 14 && d !== '00000000000000') return d;
  }
  return '';
}

async function contatosDoSite(site: string): Promise<{ email: string; cnpj: string; texto: string }> {
  const base = site.startsWith('http') ? site : `https://${site}`;
  const dominio = dominioDoSite(base);
  const home = await lerPagina(base);
  let corpo = home;
  let email = extrairEmails(home, dominio);
  let cnpj = extrairCnpj(home);
  if (!email || !cnpj) {
    const contato = await lerPagina(base.replace(/\/$/, '') + '/contato');
    corpo += ' ' + contato;
    if (!email) email = extrairEmails(contato, dominio);
    if (!cnpj) cnpj = extrairCnpj(contato);
  }
  // Texto sem tags, so para as exclusoes condicionais.
  const texto = corpo.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').slice(0, 100_000);
  return { email, cnpj, texto };
}

// ─── BrasilAPI (cache compartilhado com o PNCP) ──────────────────────────────

async function consultarCnpj(supabase: SupabaseClient, cnpj: string): Promise<{
  razao_social: string; socio: string; situacao: string; cnae_descricao: string;
  cnae_divisao: string; cidade: string; uf: string; telefone: string;
} | null> {
  const { data: cacheado } = await supabase.from('prospeccao_pncp_cnpj_cache')
    .select('razao_social, socio, situacao, cnae_descricao, cnae_divisao, cidade, uf, telefone')
    .eq('cnpj', cnpj).maybeSingle();
  if (cacheado) {
    return {
      razao_social: String(cacheado.razao_social ?? ''),
      socio: String(cacheado.socio ?? ''),
      situacao: String(cacheado.situacao ?? ''),
      cnae_descricao: String(cacheado.cnae_descricao ?? ''),
      cnae_divisao: String(cacheado.cnae_divisao ?? ''),
      cidade: String(cacheado.cidade ?? ''),
      uf: String(cacheado.uf ?? ''),
      telefone: String(cacheado.telefone ?? ''),
    };
  }
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!d) return null;
    const qsa = Array.isArray(d.qsa)
      ? (d.qsa as { nome_socio?: unknown; qualificacao_socio?: unknown }[])
      : [];
    const admin = qsa.find((q) => /adminis/i.test(String(q?.qualificacao_socio ?? '')));
    const dados = {
      razao_social: String(d.razao_social ?? ''),
      socio: String((admin ?? qsa[0])?.nome_socio ?? ''),
      situacao: String(d.descricao_situacao_cadastral ?? ''),
      cnae_descricao: String(d.cnae_fiscal_descricao ?? ''),
      cnae_divisao: String(d.cnae_fiscal ?? '').replace(/\D/g, '').padStart(7, '0').slice(0, 2),
      cidade: String(d.municipio ?? ''),
      uf: String(d.uf ?? ''),
      telefone: String(d.ddd_telefone_1 ?? '').trim(),
    };
    // Compartilha o cache com o PNCP (sem mexer nos campos de e-mail de la).
    await supabase.from('prospeccao_pncp_cnpj_cache').upsert({
      cnpj,
      razao_social: dados.razao_social,
      socio: dados.socio || null,
      situacao: dados.situacao,
      cnae_descricao: dados.cnae_descricao,
      cnae_principal: String(d.cnae_fiscal ?? ''),
      cnae_divisao: String(d.cnae_fiscal ?? '').replace(/\D/g, '').padStart(7, '0').slice(0, 2),
      telefone: String(d.ddd_telefone_1 ?? '').trim() || null,
      cidade: String(d.municipio ?? ''),
      uf: String(d.uf ?? ''),
    }, { onConflict: 'cnpj', ignoreDuplicates: true });
    return dados;
  } catch {
    return null;
  }
}

// ─── Reputacao global ────────────────────────────────────────────────────────

async function reputacaoPausada(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.from('reputacao_envio').select('pausado').limit(1).maybeSingle();
  return data?.pausado === true;
}

// ─── Relatorio ───────────────────────────────────────────────────────────────

interface EstoqueRow {
  id: string;
  nome: string; categoria: string | null; email: string | null; tipo_email: string | null;
  socio: string | null; telefone: string | null; site: string | null; cnpj: string | null;
  razao_social: string | null; cidade: string | null; uf: string | null;
  cnae_descricao: string | null; cnae_divisao: string | null;
  classe: string | null; submercado: string | null; lote_diff: string | null;
  primeira_vista: string | null;
  avaliacoes: number | null; nota: number | null; endereco: string | null;
  estado: string; motivo: string | null; ultimo_resultado: string | null;
  enviado_em: string | null; atualizado_em: string;
}

const CABECALHO = [
  'Nome', 'Categoria', 'E-mail', 'Tipo de e-mail', 'Socio (follow-up)', 'Telefone', 'Site',
  'CNPJ', 'Razao social', 'Classe', 'CNAE', 'Novo na fonte', 'Submercado',
  'Cidade', 'UF', 'Avaliacoes', 'Nota', 'Endereco',
];

function linha(r: EstoqueRow): (string | number)[] {
  return [
    r.nome, r.categoria ?? '', r.email ?? '', r.tipo_email ?? '', r.socio ?? '',
    r.telefone ?? '', r.site ?? '', r.cnpj ? formatCnpj(r.cnpj) : '', r.razao_social ?? '',
    r.classe ?? '', r.cnae_descricao ?? '', r.lote_diff === 'novo' ? 'sim' : '', r.submercado ?? '',
    r.cidade ?? '', r.uf ?? '', r.avaliacoes ?? 0, r.nota ?? 0, r.endereco ?? '',
  ];
}

function montarXlsx(o: {
  enviados: EstoqueRow[]; soWhatsapp: EstoqueRow[]; bounces: EstoqueRow[]; descartados: EstoqueRow[]; dryRun: boolean;
}): string {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [...CABECALHO, 'Data do envio', 'Status'],
    ...o.enviados.map((r) => [...linha(r),
      r.enviado_em ? r.enviado_em.slice(0, 16).replace('T', ' ') : (o.dryRun ? 'dry run (nao enviado)' : ''),
      o.dryRun ? 'dry run' : 'enviado']),
  ]), o.dryRun ? 'Enviados (dry run)' : 'Enviados');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    CABECALHO, ...o.soWhatsapp.map(linha),
  ]), 'So WhatsApp');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [...CABECALHO, 'Motivo'], ...o.bounces.map((r) => [...linha(r), r.motivo ?? 'bounce']),
  ]), 'Sem e-mail valido');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [...CABECALHO, 'Motivo'], ...o.descartados.map((r) => [...linha(r), r.motivo ?? '']),
  ]), 'Descartados');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Campanha {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  dry_run: boolean;
  fonte: string;
  termos_busca: string[];
  cidades: string[];
  palavras_exclusao: string[];
  trilha: string;
  tipo_prospect: string;
  limite_diario: number;
  cadencia_garimpo_dias: number;
  exigir_cnpj: boolean;
  gancho_adesao_texto: string | null;
  fonte_config: Record<string, unknown>;
  garimpo_cursor: number;
  garimpo_ciclo_iniciado: string | null;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  apify_cidade: string | null;
}

// ─── Fase 1: colher run do Apify em andamento ────────────────────────────────

async function colherApify(supabase: SupabaseClient, c: Campanha, execId: string): Promise<number> {
  if (!c.apify_run_id) return 0;
  const status = await statusRunApify(c.apify_run_id);
  if (['READY', 'RUNNING'].includes(status)) return 0;

  let inseridos = 0;
  if (status === 'SUCCEEDED' && c.apify_dataset_id) {
    const itens = await itensDatasetApify(c.apify_dataset_id);

    // Dedup contra todo o estoque (todas as campanhas), por telefone e e-mail
    // normalizados; o place_id e travado pela unique da tabela.
    const { data: existentes } = await supabase.from('garimpo_estoque').select('telefone, email, place_id');
    const fones = new Set<string>();
    const emails = new Set<string>();
    const places = new Set<string>();
    for (const e of (existentes ?? [])) {
      const f = normalizarTelefone(e.telefone as string);
      if (f) fones.add(f);
      if (e.email) emails.add(String(e.email).toLowerCase());
      places.add(String(e.place_id));
    }

    for (const item of itens) {
      if (places.has(item.placeId)) continue;
      const fone = normalizarTelefone(item.telefone);
      if (fone && fones.has(fone)) continue;
      if (item.email && emails.has(item.email)) continue;

      const { error } = await supabase.from('garimpo_estoque').insert({
        campanha_id: c.id,
        place_id: item.placeId,
        nome: item.nome,
        categoria: item.categoria || null,
        endereco: item.endereco || null,
        cidade: item.cidade || c.apify_cidade?.split(',')[0]?.trim() || null,
        uf: item.uf || null,
        telefone: item.telefone || null,
        site: item.site || null,
        email: item.email || null,
        avaliacoes: item.avaliacoes,
        nota: item.nota,
        estado: 'novo',
      });
      if (!error) {
        inseridos++;
        places.add(item.placeId);
        if (fone) fones.add(fone);
        if (item.email) emails.add(item.email);
      }
    }
    console.log(`[garimpo/${c.slug}] run ${c.apify_run_id} colhido: ${itens.length} lugares, ${inseridos} novos no estoque`);
  } else {
    console.error(`[garimpo/${c.slug}] run ${c.apify_run_id} terminou com status ${status}`);
  }

  await supabase.from('campanhas_garimpo').update({
    apify_run_id: null, apify_dataset_id: null, apify_cidade: null, updated_at: new Date().toISOString(),
  }).eq('id', c.id);
  if (inseridos) {
    const { data: ex } = await supabase.from('garimpo_execucoes').select('garimpados').eq('id', execId).single();
    await supabase.from('garimpo_execucoes').update({ garimpados: Number(ex?.garimpados ?? 0) + inseridos }).eq('id', execId);
  }
  return inseridos;
}

// ─── Fase 2: iniciar garimpo se o estoque esta baixo ─────────────────────────

async function talvezGarimpar(supabase: SupabaseClient, c: Campanha, avisos: string[]): Promise<void> {
  if (c.fonte !== 'maps') return;               // 'instagram' preparado, nao implementado
  if (c.apify_run_id) return;                    // ja tem run em andamento
  if (!c.termos_busca.length || !c.cidades.length) return;
  if (!APIFY_TOKEN) {
    avisos.push('APIFY_TOKEN nao configurado em Edge Functions > Secrets; o garimpo nao roda.');
    return;
  }

  const { count } = await supabase.from('garimpo_estoque')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', c.id).in('estado', ['novo', 'enriquecido']);
  const alvo = Number(c.limite_diario) * 14;
  if (Number(count ?? 0) >= alvo) return;

  let cursor = Number(c.garimpo_cursor ?? 0);
  let cicloIniciado = c.garimpo_ciclo_iniciado;

  if (cursor >= c.cidades.length) {
    // Ciclo completo: so recomeca quando a cadencia vence.
    const inicio = cicloIniciado ? Date.parse(cicloIniciado) : 0;
    if (Date.now() - inicio < Number(c.cadencia_garimpo_dias) * 86_400_000) return;
    cursor = 0;
  }
  if (cursor === 0) cicloIniciado = new Date().toISOString();

  const cidade = c.cidades[cursor];
  const run = await iniciarRunApify(c.termos_busca, cidade);
  if (!run) {
    avisos.push(`Falha ao iniciar o garimpo no Apify para ${cidade}.`);
    return;
  }

  await supabase.from('campanhas_garimpo').update({
    apify_run_id: run.runId,
    apify_dataset_id: run.datasetId,
    apify_cidade: cidade,
    garimpo_cursor: cursor + 1,
    garimpo_ciclo_iniciado: cicloIniciado,
    updated_at: new Date().toISOString(),
  }).eq('id', c.id);
  console.log(`[garimpo/${c.slug}] run iniciado para ${cidade} (cursor ${cursor + 1}/${c.cidades.length})`);
}

// ─── Fase 3: enriquecimento ──────────────────────────────────────────────────

async function enriquecer(
  supabase: SupabaseClient,
  c: Campanha,
  execId: string,
  padroesContador: string[],
  prefixosGenericos: string[],
  fimTarefaMs: number,
): Promise<void> {
  const { data: lote } = await supabase.from('garimpo_estoque')
    .select('*')
    .eq('campanha_id', c.id).eq('estado', 'novo')
    .order('avaliacoes', { ascending: false })
    .limit(LOTE_ENRIQUECIMENTO);
  if (!lote?.length) return;

  let consultasBrasil = 0;

  for (const item of lote) {
    if (Date.now() > fimTarefaMs) break;

    const marcar = async (estado: string, extras: Record<string, unknown> = {}) => {
      await supabase.from('garimpo_estoque').update({
        estado,
        atualizado_em: new Date().toISOString(),
        ...(estado === 'descartado' ? { ultima_execucao_id: execId, ultimo_resultado: 'descartado' } : {}),
        ...extras,
      }).eq('id', item.id);
    };

    // Exclusoes que nao dependem do site.
    const nomeCat = `${item.nome} ${item.categoria ?? ''}`;
    const previa = avaliarExclusoes(c.palavras_exclusao, nomeCat, '');
    if (previa.excluido) { await marcar('descartado', { motivo: previa.motivo }); continue; }

    let email = String(item.email ?? '');
    let cnpj = '';
    let textoSite = '';

    if (item.site) {
      const contatos = await contatosDoSite(String(item.site));
      textoSite = contatos.texto;
      if (!email) email = contatos.email;
      cnpj = contatos.cnpj;
    }

    // Exclusoes condicionais agora com o texto do site.
    const total = avaliarExclusoes(c.palavras_exclusao, nomeCat, textoSite);
    if (total.excluido) { await marcar('descartado', { motivo: total.motivo }); continue; }

    // CNPJ: valida e traz razao social e socio administrador.
    let extras: Record<string, unknown> = {};
    if (cnpj) {
      consultasBrasil++;
      if (consultasBrasil > 1) await pausa(1200);
      const dados = await consultarCnpj(supabase, cnpj);
      if (dados) {
        if (dados.situacao && dados.situacao.toUpperCase() !== 'ATIVA') {
          await marcar('descartado', { cnpj, motivo: `Situacao cadastral: ${dados.situacao}` });
          continue;
        }
        extras = { cnpj, razao_social: dados.razao_social || null, socio: dados.socio || null, cnae_descricao: dados.cnae_descricao || null };
      } else {
        extras = { cnpj };
      }
    }

    if (email && RE_EMAIL.test(email)) {
      if (c.exigir_cnpj && !cnpj) {
        await marcar('descartado', { email, motivo: 'Sem CNPJ identificado no site (campanha exige CNPJ)' });
        continue;
      }
      await marcar('enriquecido', {
        ...extras,
        email: email.toLowerCase(),
        tipo_email: classificarEmail(email, padroesContador, prefixosGenericos),
      });
      continue;
    }

    if (normalizarTelefone(item.telefone as string)) {
      await marcar('so_whatsapp', { ...extras, motivo: 'Sem e-mail no site; tem telefone' });
      continue;
    }

    await marcar('descartado', { ...extras, motivo: 'Sem canal de contato (nem e-mail, nem telefone)' });
  }
}


// ─── Fonte CCEE: consumidores livres e especiais ────────────────────────────
//
// O WAF da CCEE so aceita navegador de verdade (bloqueia por fingerprint
// TLS), entao a coleta roda no Apify com o actor apify/web-scraper: um Chrome
// abre o portal de dados abertos e chama a API datastore da propria origem,
// paginando e devolvendo os registros como itens do dataset do run.

const CCEE_PAGE_FUNCTION = `async function pageFunction(context) {
  const cfg = context.customData || {};
  const colher = async (rid, filtros) => {
    const out = [];
    let offset = 0;
    const f = encodeURIComponent(JSON.stringify(filtros));
    while (true) {
      const r = await fetch('/api/3/action/datastore_search?resource_id=' + rid +
        '&limit=10000&offset=' + offset + '&filters=' + f);
      const d = await r.json();
      const recs = (d && d.result && d.result.records) || [];
      for (const x of recs) out.push(x);
      if (recs.length < 10000 || offset > 300000) break;
      offset += 10000;
    }
    return out;
  };

  // Lista atual: classe + status ativo + categoria Consumo (2026 em diante).
  const atual = await colher(cfg.recursoAtual, {
    CLASSE_PERFIL_AGENTE: ['Consumidor Livre', 'Consumidor Especial'],
    STATUS_PERFIL: 'ATIVO',
    CATEGORIA_AGENTE: 'Consumo',
  });
  const porCnpj = new Map();
  for (const x of atual) {
    const cnpj = String(x.CNPJ || '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue;
    const e = porCnpj.get(cnpj);
    if (e) {
      if (String(x.CLASSE_PERFIL_AGENTE) === 'Consumidor Especial') e.classe = 'Consumidor Especial';
      continue;
    }
    porCnpj.set(cnpj, {
      cnpj,
      nome: String(x.NOME_EMPRESARIAL || ''),
      classe: String(x.CLASSE_PERFIL_AGENTE || ''),
      submercado: String(x.SUBMERCADO || ''),
    });
  }

  // Baseline anterior (primeira carga): SO classe, sem status nem categoria.
  // O vocabulario de CATEGORIA_AGENTE mudou entre os anos ('Consumo' zera em
  // 2025) e, para o diff, basta saber que o CNPJ ja constava na CCEE.
  const anteriores = new Set();
  if (cfg.primeiraCarga && cfg.recursoAnterior) {
    const ant = await colher(cfg.recursoAnterior, {
      CLASSE_PERFIL_AGENTE: ['Consumidor Livre', 'Consumidor Especial'],
    });
    for (const x of ant) {
      const cnpj = String(x.CNPJ || '').replace(/\D/g, '');
      if (cnpj.length === 14) anteriores.add(cnpj);
    }
  }

  // Itens em LOTES de 500: imune a limites de quantidade de resultados do
  // actor e mais rapido de colher do outro lado.
  const itens = [];
  const listaAtual = Array.from(porCnpj.values());
  for (let i = 0; i < listaAtual.length; i += 500) {
    itens.push({ tipo: 'atual_lote', lista: listaAtual.slice(i, i + 500) });
  }
  const listaAnterior = Array.from(anteriores);
  for (let i = 0; i < listaAnterior.length; i += 500) {
    itens.push({ tipo: 'anterior_lote', lista: listaAnterior.slice(i, i + 500) });
  }
  return itens;
}`;

async function talvezGarimparCcee(supabase: SupabaseClient, c: Campanha, avisos: string[]): Promise<void> {
  if (c.apify_run_id) return;
  if (!APIFY_TOKEN) {
    avisos.push('APIFY_TOKEN nao configurado em Edge Functions > Secrets; o garimpo nao roda.');
    return;
  }
  const inicio = c.garimpo_ciclo_iniciado ? Date.parse(c.garimpo_ciclo_iniciado) : 0;
  if (Date.now() - inicio < Number(c.cadencia_garimpo_dias) * 86_400_000) return;

  const fc = c.fonte_config ?? {};
  const recursoAtual = String(fc.recurso_atual ?? '');
  if (!recursoAtual) { avisos.push('fonte_config.recurso_atual nao definido na campanha.'); return; }

  try {
    const res = await fetch(`https://api.apify.com/v2/acts/apify~web-scraper/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: 'https://dadosabertos.ccee.org.br/dataset/lista_perfil_v1' }],
        pageFunction: CCEE_PAGE_FUNCTION,
        customData: {
          recursoAtual,
          recursoAnterior: String(fc.recurso_anterior ?? ''),
          primeiraCarga: fc.diff_inicial_feito !== true,
        },
        proxyConfiguration: { useApifyProxy: true },
        maxPagesPerCrawl: 1,
        maxResultsPerCrawl: 999999,
        pageLoadTimeoutSecs: 120,
        pageFunctionTimeoutSecs: 300,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      avisos.push(`Falha ao iniciar o run CCEE no Apify: HTTP ${res.status}`);
      console.error('[ccee] iniciar run:', res.status, await res.text());
      return;
    }
    const body = await res.json();
    await supabase.from('campanhas_garimpo').update({
      apify_run_id: String(body?.data?.id ?? ''),
      apify_dataset_id: String(body?.data?.defaultDatasetId ?? ''),
      apify_cidade: 'lista CCEE',
      garimpo_ciclo_iniciado: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', c.id);
    console.log(`[garimpo/${c.slug}] run CCEE iniciado (${body?.data?.id})`);
  } catch (e) {
    console.error('[ccee]', e);
    avisos.push('Erro de rede ao iniciar o run CCEE no Apify.');
  }
}

async function colherCcee(supabase: SupabaseClient, c: Campanha, execId: string): Promise<void> {
  if (!c.apify_run_id) return;
  const status = await statusRunApify(c.apify_run_id);
  if (['READY', 'RUNNING'].includes(status)) return;

  let inseridos = 0;
  let novosDiff = 0;
  if (status === 'SUCCEEDED' && c.apify_dataset_id) {
    // Itens: {tipo:'atual', cnpj, nome, classe, submercado} e {tipo:'anterior', cnpj}.
    const brutos: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const res = await fetch(
        `https://api.apify.com/v2/datasets/${c.apify_dataset_id}/items?token=${APIFY_TOKEN}&format=json&clean=true&limit=1000&offset=${offset}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) break;
      const lote = await res.json().catch(() => []) as Record<string, unknown>[];
      if (!Array.isArray(lote) || !lote.length) break;
      brutos.push(...lote);
      offset += lote.length;
      if (lote.length < 1000) break;
    }

    // Itens vem em lotes de 500 ({tipo, lista}).
    const atuais: Record<string, unknown>[] = [];
    const anteriores = new Set<string>();
    for (const b of brutos) {
      const lista = Array.isArray(b.lista) ? b.lista : [];
      if (b.tipo === 'atual_lote') for (const x of lista) atuais.push(x as Record<string, unknown>);
      if (b.tipo === 'anterior_lote') for (const x of lista) anteriores.add(String(x));
    }
    const primeiraCarga = (c.fonte_config ?? {}).diff_inicial_feito !== true;

    // Dedup: CNPJs ja no estoque desta campanha e ja conhecidos do Hub.
    const { data: estoqueAtual } = await supabase.from('garimpo_estoque')
      .select('cnpj').eq('campanha_id', c.id).not('cnpj', 'is', null);
    const noEstoque = new Set((estoqueAtual ?? []).map((r) => cleanCnpj(String(r.cnpj))));
    const dedup = await conjuntosDedup(supabase);

    const filaInsert: Record<string, unknown>[] = [];
    for (const b of atuais) {
      const cnpj = cleanCnpj(String(b.cnpj));
      if (cnpj.length !== 14) continue;
      if (noEstoque.has(cnpj) || dedup.cnpjs.has(cnpj)) continue;
      noEstoque.add(cnpj);
      const novo = primeiraCarga ? !anteriores.has(cnpj) : true;
      if (novo) novosDiff++;
      filaInsert.push({
        campanha_id: c.id,
        place_id: `ccee:${cnpj}`,
        nome: String(b.nome ?? ''),
        categoria: 'Agente CCEE',
        cnpj,
        classe: String(b.classe ?? '') || null,
        submercado: String(b.submercado ?? '') || null,
        lote_diff: novo ? 'novo' : 'antigo',
        estado: 'novo',
      });
    }
    for (let i = 0; i < filaInsert.length; i += 500) {
      const { error } = await supabase.from('garimpo_estoque').insert(filaInsert.slice(i, i + 500));
      if (error) console.error('[ccee/estoque]', error.message);
      else inseridos += Math.min(500, filaInsert.length - i);
    }

    // Marca o diff inicial como feito: das proximas vezes, todo CNPJ inedito e novo.
    await supabase.from('campanhas_garimpo').update({
      fonte_config: { ...(c.fonte_config ?? {}), diff_inicial_feito: true },
      updated_at: new Date().toISOString(),
    }).eq('id', c.id);

    console.log(`[garimpo/${c.slug}] lista CCEE colhida: ${brutos.length} itens, ${inseridos} no estoque, ${novosDiff} novos no diff`);
  } else {
    console.error(`[garimpo/${c.slug}] run CCEE ${c.apify_run_id} terminou com status ${status}`);
  }

  await supabase.from('campanhas_garimpo').update({
    apify_run_id: null, apify_dataset_id: null, apify_cidade: null, updated_at: new Date().toISOString(),
  }).eq('id', c.id);
  if (inseridos) {
    const { data: ex } = await supabase.from('garimpo_execucoes').select('garimpados, detalhes').eq('id', execId).single();
    await supabase.from('garimpo_execucoes').update({
      garimpados: Number(ex?.garimpados ?? 0) + inseridos,
      detalhes: { ...(ex?.detalhes ?? {}), novos_diff: novosDiff },
    }).eq('id', execId);
  }
}

/** Prioridade CCEE: novos, depois industria (10-33), atacado e logistica
 *  (46, 49-53), servicos; Consumidor Especial antes de Livre; visto ha menos
 *  tempo primeiro. */
function grupoCnae(divisao: string | null | undefined): number {
  const n = parseInt(String(divisao ?? ''), 10);
  if (n >= 10 && n <= 33) return 0;
  if (n === 46 || (n >= 49 && n <= 53)) return 1;
  return 2;
}

function prioridadeCcee(a: EstoqueRow, b: EstoqueRow): number {
  const na = a.lote_diff === 'novo' ? 0 : 1;
  const nb = b.lote_diff === 'novo' ? 0 : 1;
  if (na !== nb) return na - nb;
  const ga = grupoCnae(a.cnae_divisao);
  const gb = grupoCnae(b.cnae_divisao);
  if (ga !== gb) return ga - gb;
  const ca = a.classe === 'Consumidor Especial' ? 0 : 1;
  const cb = b.classe === 'Consumidor Especial' ? 0 : 1;
  if (ca !== cb) return ca - cb;
  return Date.parse(b.primeira_vista ?? '1970-01-01') - Date.parse(a.primeira_vista ?? '1970-01-01');
}

/** Estagio A da fonte CCEE: cadastro em massa na BrasilAPI (barata) para ter
 *  CNAE, socio, cidade e telefone ANTES de gastar a cota da cadeia de e-mail. */
async function cadastrarCcee(supabase: SupabaseClient, c: Campanha, fimTarefaMs: number): Promise<void> {
  const { data: novosPrimeiro } = await supabase.from('garimpo_estoque')
    .select('id, cnpj, lote_diff').eq('campanha_id', c.id).eq('estado', 'novo')
    .eq('lote_diff', 'novo').order('classe').limit(30);
  let lote = novosPrimeiro ?? [];
  if (lote.length < 30) {
    const { data: antigos } = await supabase.from('garimpo_estoque')
      .select('id, cnpj, lote_diff').eq('campanha_id', c.id).eq('estado', 'novo')
      .neq('lote_diff', 'novo').order('classe').limit(30 - lote.length);
    lote = [...lote, ...(antigos ?? [])];
  }

  let consultas = 0;
  for (const item of lote) {
    if (Date.now() > fimTarefaMs) break;
    const cnpj = cleanCnpj(String(item.cnpj));
    if (cnpj.length !== 14) continue;
    if (consultas > 0) await pausa(1200);
    consultas++;
    const dados = await consultarCnpj(supabase, cnpj);
    if (!dados) continue;  // rede: tenta no proximo tique
    if (dados.situacao && dados.situacao.toUpperCase() !== 'ATIVA') {
      await supabase.from('garimpo_estoque').update({
        estado: 'descartado', motivo: `Situacao cadastral: ${dados.situacao}`,
        atualizado_em: new Date().toISOString(),
      }).eq('id', item.id);
      continue;
    }
    await supabase.from('garimpo_estoque').update({
      estado: 'cadastrado',
      razao_social: dados.razao_social || null,
      socio: dados.socio || null,
      cnae_descricao: dados.cnae_descricao || null,
      cnae_divisao: dados.cnae_divisao || null,
      cidade: dados.cidade || null,
      uf: dados.uf || null,
      telefone: dados.telefone || null,
      atualizado_em: new Date().toISOString(),
    }).eq('id', item.id);
  }
}

// Cadeia de e-mail por CNPJ (mesmas fontes e cache do PNCP):
// CNPJa aberta (5/min) -> cnpj.ws publica (3/min).
interface ProvedorEmail {
  nome: string;
  cooldownMs: number;
  proximaEm: number;
  consultar: (cnpj: string) => Promise<{ ok: boolean; email: string }>;
}

function criarProvedoresEmail(): ProvedorEmail[] {
  return [
    {
      nome: 'cnpja', cooldownMs: 13_000, proximaEm: 0,
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
      nome: 'cnpjws', cooldownMs: 21_000, proximaEm: 0,
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

async function buscarEmailCnpj(
  cnpj: string,
  provedores: ProvedorEmail[],
  fimOrcamentoMs: number,
): Promise<{ consultado: boolean; email: string; fonte: string; semTempo: boolean }> {
  for (let t = 0; t < provedores.length; t++) {
    const prov = [...provedores].sort((a, b) => a.proximaEm - b.proximaEm)[0];
    const espera = Math.max(0, prov.proximaEm - Date.now());
    if (Date.now() + espera > fimOrcamentoMs) return { consultado: false, email: '', fonte: '', semTempo: true };
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

/** Estagio B da fonte CCEE: e-mail pela cadeia, na ordem de prioridade. */
async function enriquecerCcee(
  supabase: SupabaseClient,
  c: Campanha,
  execId: string,
  padroesContador: string[],
  prefixosGenericos: string[],
  fimTarefaMs: number,
): Promise<void> {
  const { data: brutos } = await supabase.from('garimpo_estoque')
    .select('*').eq('campanha_id', c.id).eq('estado', 'cadastrado').limit(120);
  if (!brutos?.length) return;
  const lote = (brutos as EstoqueRow[]).sort(prioridadeCcee);
  const provedores = criarProvedoresEmail();

  for (const item of lote) {
    if (Date.now() > fimTarefaMs) break;
    const cnpj = cleanCnpj(String(item.cnpj));

    const marcar = async (estado: string, extras: Record<string, unknown> = {}) => {
      await supabase.from('garimpo_estoque').update({
        estado,
        atualizado_em: new Date().toISOString(),
        ...(estado === 'descartado' ? { ultima_execucao_id: execId, ultimo_resultado: 'descartado' } : {}),
        ...extras,
      }).eq('id', item.id);
    };

    // Cache do PNCP: e-mail ja consultado?
    const { data: cache } = await supabase.from('prospeccao_pncp_cnpj_cache')
      .select('email, tem_email, email_consultado').eq('cnpj', cnpj).maybeSingle();

    let email = '';
    if (cache?.email_consultado === true) {
      email = String(cache.email ?? '');
    } else {
      const r = await buscarEmailCnpj(cnpj, provedores, fimTarefaMs);
      if (r.semTempo) break;
      if (!r.consultado) continue;  // rede/rate limit: fica para o proximo tique
      email = r.email;
      await supabase.from('prospeccao_pncp_cnpj_cache').upsert({
        cnpj,
        email: email || null,
        tem_email: !!email,
        email_fonte: r.fonte || null,
        email_consultado: true,
      }, { onConflict: 'cnpj' });
    }

    if (email && RE_EMAIL.test(email)) {
      await marcar('enriquecido', { email, tipo_email: classificarEmail(email, padroesContador, prefixosGenericos) });
    } else if (normalizarTelefone(item.telefone)) {
      await marcar('so_whatsapp', { motivo: 'Sem e-mail na Receita; tem telefone' });
    } else {
      await marcar('descartado', { motivo: 'Sem canal de contato (nem e-mail, nem telefone)' });
    }
  }
}

// ─── Fase 4: envio diario ────────────────────────────────────────────────────

async function conjuntosDedup(supabase: SupabaseClient) {
  const [pRes, cRes, parRes, bRes, sRes] = await Promise.all([
    supabase.from('prospects').select('email, phonenumber, cnpj'),
    supabase.from('email_cadencia').select('email'),
    supabase.from('partners').select('email, email_2, cnpj'),
    supabase.from('email_blocklist').select('email'),
    supabase.from('sales').select('cnpj, email').not('cnpj', 'is', null),
  ]);
  const emails = new Set<string>();
  const fones = new Set<string>();
  const cnpjs = new Set<string>();
  for (const r of (pRes.data ?? [])) {
    if (r.email) emails.add(String(r.email).toLowerCase());
    const f = normalizarTelefone(r.phonenumber as string);
    if (f) fones.add(f);
    const d = cleanCnpj(String(r.cnpj ?? ''));
    if (d.length === 14) cnpjs.add(d);
  }
  for (const r of (cRes.data ?? [])) if (r.email) emails.add(String(r.email).toLowerCase());
  for (const r of (parRes.data ?? [])) {
    if (r.email) emails.add(String(r.email).toLowerCase());
    if (r.email_2) emails.add(String(r.email_2).toLowerCase());
    const d = cleanCnpj(String(r.cnpj ?? ''));
    if (d.length === 14) cnpjs.add(d);
  }
  for (const r of (bRes.data ?? [])) if (r.email) emails.add(String(r.email).toLowerCase());
  for (const r of (sRes.data ?? [])) {
    if (r.email) emails.add(String(r.email).toLowerCase());
    const d = cleanCnpj(String(r.cnpj ?? ''));
    if (d.length === 14) cnpjs.add(d);
  }
  return { emails, fones, cnpjs };
}

function prioridade(a: EstoqueRow, b: EstoqueRow): number {
  const ta = ORDEM_TIPO_EMAIL[a.tipo_email ?? 'direto'] ?? 0;
  const tb = ORDEM_TIPO_EMAIL[b.tipo_email ?? 'direto'] ?? 0;
  if (ta !== tb) return ta - tb;
  const sa = siteProprio(a.site) ? 0 : 1;
  const sb = siteProprio(b.site) ? 0 : 1;
  if (sa !== sb) return sa - sb;
  return (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0);
}

async function enviarDia(
  supabase: SupabaseClient,
  c: Campanha,
  execId: string,
  fimTarefaMs: number,
): Promise<void> {
  const pausadoGlobal = await reputacaoPausada(supabase);
  const dedup = await conjuntosDedup(supabase);

  // Quantos ja foram marcados hoje.
  const { data: marcados } = await supabase.from('garimpo_estoque')
    .select('ultimo_resultado').eq('ultima_execucao_id', execId);
  let enviadosHoje = (marcados ?? []).filter((m) => ['enviado', 'dry_run'].includes(String(m.ultimo_resultado))).length;
  let waHoje = (marcados ?? []).filter((m) => m.ultimo_resultado === 'so_whatsapp').length;

  // E-mails: ate o limite diario, na prioridade definida.
  if (!pausadoGlobal && enviadosHoje < Number(c.limite_diario)) {
    const { data: candidatosRaw } = await supabase.from('garimpo_estoque')
      .select('*').eq('campanha_id', c.id).eq('estado', 'enriquecido')
      .is('ultima_execucao_id', null)
      .limit(200);
    // Em dry run os itens ja marcados hoje tem ultima_execucao_id = exec, e os
    // de dias anteriores de dry run tem exec antiga; esses podem ser re-selecionados.
    const { data: antigosDry } = await supabase.from('garimpo_estoque')
      .select('*').eq('campanha_id', c.id).eq('estado', 'enriquecido')
      .not('ultima_execucao_id', 'is', null)
      .neq('ultima_execucao_id', execId)
      .limit(200);
    const ordenar = c.fonte === 'ccee' ? prioridadeCcee : prioridade;
    const candidatos = ([...(candidatosRaw ?? []), ...(antigosDry ?? [])] as EstoqueRow[]).sort(ordenar);

    for (const cand of candidatos) {
      if (Date.now() > fimTarefaMs) break;
      if (enviadosHoje >= Number(c.limite_diario)) break;

      const email = String(cand.email ?? '').toLowerCase();
      const fone = normalizarTelefone(cand.telefone);
      const cnpjD = cleanCnpj(String(cand.cnpj ?? ''));
      if (dedup.emails.has(email) || (fone && dedup.fones.has(fone)) || (cnpjD.length === 14 && dedup.cnpjs.has(cnpjD))) {
        await supabase.from('garimpo_estoque').update({
          estado: 'descartado', motivo: 'Ja e contato do Hub (prospect, cadencia, parceiro ou bloqueio)',
          ultima_execucao_id: execId, ultimo_resultado: 'descartado', atualizado_em: new Date().toISOString(),
        }).eq('id', cand.id);
        continue;
      }

      if (c.dry_run) {
        await supabase.from('garimpo_estoque').update({
          ultima_execucao_id: execId, ultimo_resultado: 'dry_run', atualizado_em: new Date().toISOString(),
        }).eq('id', cand.id);
        enviadosHoje++;
        continue;
      }

      // Reivindica antes de inserir, contra tique concorrente.
      const { data: claim } = await supabase.from('garimpo_estoque')
        .update({ estado: 'enviado', atualizado_em: new Date().toISOString() })
        .eq('id', cand.id).eq('estado', 'enriquecido').select('id');
      if (!claim?.length) continue;

      const cidade = String(cand.cidade ?? '');
      const descricao = c.fonte === 'ccee'
        ? `Agente CCEE (${cand.classe ?? ''}${cand.submercado ? ', submercado ' + cand.submercado : ''})${cand.lote_diff === 'novo' ? ', ADESAO RECENTE' : ''}\nCNAE: ${cand.cnae_descricao ?? ''}`
        : `Garimpo Google Maps (${c.nome})\nCategoria: ${cand.categoria ?? ''}\nAvaliacoes: ${cand.avaliacoes ?? 0} (nota ${cand.nota ?? 0})`;
      const { data: prospect } = await supabase.from('prospects').insert({
        name: cand.socio || cand.nome,
        company: cand.nome,
        cnpj: cnpjD.length === 14 ? formatCnpj(cnpjD) : null,
        email,
        phonenumber: cand.telefone || null,
        website: cand.site || null,
        city: cidade || null,
        state: cand.uf || null,
        status: 'Novos Leads',
        status_entered_at: new Date().toISOString(),
        source: `garimpo_${c.slug}`,
        product_type: c.tipo_prospect,
        segmento: cand.cnae_descricao || cand.categoria || null,
        decisor: cand.socio || null,
        description: descricao,
        tags: ['garimpo', c.slug],
      }).select('id').single();

      const primeiroNome = (cand.socio || '').trim().split(/\s+/)[0] || '';
      const { data: contato } = await supabase.from('email_cadencia').insert({
        nome_contato: primeiroNome ? primeiroNome.charAt(0) + primeiroNome.slice(1).toLowerCase() : cand.nome,
        nome_empresa: cand.nome,
        email,
        origem: `garimpo_${c.slug}`,
        trilha: c.trilha,
        data_inicio: hojeBRT(),
        ativo: true,
        prospect_id: prospect?.id ?? null,
        cidade: cidade || null,
        site: cand.site || null,
        // [GANCHO_ADESAO]: so os leads novos do diff recebem o paragrafo.
        gancho_adesao: (c.fonte === 'ccee' && cand.lote_diff === 'novo' && c.gancho_adesao_texto)
          ? c.gancho_adesao_texto : null,
      }).select('id').single();

      let okEnvio = false;
      if (contato?.id) {
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/prospecting-cadence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SVC}` },
            body: JSON.stringify({ contact_id: contato.id }),
          });
          const resp = await r.json().catch(() => ({}));
          okEnvio = r.ok && resp?.success !== false;
        } catch (e) { console.error('[cadence]', e); }
      }

      await supabase.from('garimpo_estoque').update({
        enviado_em: new Date().toISOString(),
        prospect_id: prospect?.id ?? null,
        contato_id: contato?.id ?? null,
        ultima_execucao_id: execId,
        ultimo_resultado: 'enviado',
        motivo: okEnvio ? null : 'Primeiro e-mail falhou; o cron da cadencia tenta amanha',
      }).eq('id', cand.id);

      dedup.emails.add(email);
      if (fone) dedup.fones.add(fone);
      enviadosHoje++;
    }
  }

  // So WhatsApp: entra no Kanban (sem trilha), com o mesmo teto diario.
  if (waHoje < Number(c.limite_diario)) {
    const { data: whats } = await supabase.from('garimpo_estoque')
      .select('*').eq('campanha_id', c.id).eq('estado', 'so_whatsapp')
      .is('prospect_id', null)
      .is('ultima_execucao_id', null)
      .order('avaliacoes', { ascending: false })
      .limit(Number(c.limite_diario) - waHoje);
    for (const w of ((whats ?? []) as EstoqueRow[])) {
      if (Date.now() > fimTarefaMs) break;
      const fone = normalizarTelefone(w.telefone);
      if (fone && dedup.fones.has(fone)) {
        await supabase.from('garimpo_estoque').update({
          estado: 'descartado', motivo: 'Telefone ja e contato do Hub',
          ultima_execucao_id: execId, ultimo_resultado: 'descartado', atualizado_em: new Date().toISOString(),
        }).eq('id', w.id);
        continue;
      }
      if (c.dry_run) {
        await supabase.from('garimpo_estoque').update({
          ultima_execucao_id: execId, ultimo_resultado: 'so_whatsapp', atualizado_em: new Date().toISOString(),
        }).eq('id', w.id);
        waHoje++;
        continue;
      }
      const { data: prospect } = await supabase.from('prospects').insert({
        name: w.socio || w.nome,
        company: w.nome,
        cnpj: w.cnpj ? formatCnpj(cleanCnpj(w.cnpj)) : null,
        phonenumber: w.telefone || null,
        website: w.site || null,
        city: w.cidade || null,
        state: w.uf || null,
        status: 'Contato por WhatsApp',
        status_entered_at: new Date().toISOString(),
        source: `garimpo_${c.slug}`,
        product_type: c.tipo_prospect,
        segmento: w.cnae_descricao || w.categoria || null,
        decisor: w.socio || null,
        description: `Garimpo Google Maps (${c.nome}), sem e-mail no site: contato por WhatsApp\nCategoria: ${w.categoria ?? ''}\nAvaliacoes: ${w.avaliacoes ?? 0} (nota ${w.nota ?? 0})`,
        tags: ['garimpo', c.slug, 'whatsapp'],
      }).select('id').single();
      await supabase.from('garimpo_estoque').update({
        prospect_id: prospect?.id ?? null,
        ultima_execucao_id: execId,
        ultimo_resultado: 'so_whatsapp',
        atualizado_em: new Date().toISOString(),
      }).eq('id', w.id);
      if (fone) dedup.fones.add(fone);
      waHoje++;
    }
  }
}

// ─── Fase 5: finalizacao e relatorio ─────────────────────────────────────────

async function finalizar(supabase: SupabaseClient, c: Campanha, execId: string, avisos: string[]): Promise<void> {
  const hoje = hojeBRT();

  const { data: doDia } = await supabase.from('garimpo_estoque')
    .select('*').eq('ultima_execucao_id', execId);
  const rows = (doDia ?? []) as EstoqueRow[];
  const enviados = rows.filter((r) => ['enviado', 'dry_run'].includes(String(r.ultimo_resultado))).sort(prioridade);
  const soWhatsapp = rows.filter((r) => r.ultimo_resultado === 'so_whatsapp');
  const descartados = rows.filter((r) => r.ultimo_resultado === 'descartado');

  // Bounces do dia desta campanha (marcados pelo webhook do Resend).
  const { data: bounceRows } = await supabase.from('garimpo_estoque')
    .select('*').eq('campanha_id', c.id).eq('estado', 'bounce')
    .gte('atualizado_em', `${hoje}T00:00:00-03:00`);
  const bounces = (bounceRows ?? []) as EstoqueRow[];

  const { count: novoCount } = await supabase.from('garimpo_estoque')
    .select('id', { count: 'exact', head: true }).eq('campanha_id', c.id).eq('estado', 'novo');
  const { count: prontoCount } = await supabase.from('garimpo_estoque')
    .select('id', { count: 'exact', head: true }).eq('campanha_id', c.id).eq('estado', 'enriquecido');

  const cidadesPendentes = c.cidades.slice(Number(c.garimpo_cursor ?? 0));

  // Fonte CCEE: quantos agentes novos o diff encontrou nos ultimos 7 dias.
  let novosSemana = 0;
  if (c.fonte === 'ccee') {
    const { count } = await supabase.from('garimpo_estoque')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', c.id).eq('lote_diff', 'novo')
      .gte('primeira_vista', new Date(Date.now() - 7 * 86_400_000).toISOString());
    novosSemana = Number(count ?? 0);
  }

  const xlsxB64 = montarXlsx({ enviados, soWhatsapp, bounces, descartados, dryRun: c.dry_run });
  const caminho = `${c.slug}/${hoje}${c.dry_run ? '-dry-run' : ''}.xlsx`;
  const { error: upErr } = await supabase.storage.from('garimpo').upload(
    caminho, base64ParaBytes(xlsxB64),
    { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true },
  );
  if (upErr) avisos.push(`Falha ao salvar o XLSX: ${upErr.message}`);

  const linhaHtml = (rotulo: string, valor: string | number) =>
    `<tr><td style="padding:6px 0;color:#6b7c8f">${rotulo}</td><td style="padding:6px 0;text-align:right;font-weight:600">${valor}</td></tr>`;
  const avisosHtml = avisos.length
    ? `<p style="margin:16px 0 0;color:#b45309;font-size:13px">${avisos.map((a) => `&#9888; ${a}`).join('<br>')}</p>`
    : '';
  const pendentesTxt = cidadesPendentes.length
    ? `${cidadesPendentes.length} (proximas: ${cidadesPendentes.slice(0, 5).join('; ')})`
    : 'nenhuma neste ciclo';

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `F&G Seguro Garantia <${FROM_EMAIL}>`,
        to: [FROM_EMAIL],
        subject: `Garimpo ${c.nome} ${hoje}: ${enviados.length} ${c.dry_run ? 'na lista (dry run)' : 'enviados'}, ${soWhatsapp.length} so WhatsApp`,
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;color:#1B263B;max-width:520px">
            <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#C69C6D;margin:0 0 6px">
              Garimpo automatico${c.dry_run ? ' (dry run)' : ''}
            </p>
            <h2 style="font-size:19px;margin:0 0 18px">${c.nome}: relatorio de ${hoje}</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              ${linhaHtml(c.dry_run ? 'Seriam enviados' : 'Enviados para a trilha', enviados.length)}
              ${linhaHtml('So WhatsApp (para a Bruna)', soWhatsapp.length)}
              ${linhaHtml('Bounces hoje', bounces.length)}
              ${linhaHtml('Descartados hoje', descartados.length)}
              ${linhaHtml('Estoque aguardando enriquecimento', Number(novoCount ?? 0))}
              ${linhaHtml('Estoque pronto para envio', Number(prontoCount ?? 0))}
              ${c.fonte === 'ccee' ? linhaHtml('Agentes novos na semana (diff)', novosSemana) : linhaHtml('Cidades pendentes no ciclo', pendentesTxt)}
            </table>
            ${avisosHtml}
            <p style="font-size:12px;color:#8a97a5;margin-top:20px">
              A planilha completa esta em anexo e no bucket garimpo/${c.slug} do Supabase.
            </p>
          </div>`,
        attachments: [{ filename: `${hoje}.xlsx`, content: xlsxB64 }],
      }),
    });
  } catch (e) {
    console.error('[relatorio]', e);
  }

  await supabase.from('garimpo_execucoes').update({
    fase: 'finalizada',
    enviados: enviados.length,
    so_whatsapp: soWhatsapp.length,
    descartados: descartados.length,
    bounces: bounces.length,
    arquivo_relatorio: upErr ? null : caminho,
    detalhes: { avisos, estoque_novo: Number(novoCount ?? 0), estoque_pronto: Number(prontoCount ?? 0), cidades_pendentes: cidadesPendentes.length, novos_semana: novosSemana },
  }).eq('id', execId);

  console.log(`[garimpo/${c.slug}] dia ${hoje} finalizado: ${enviados.length} enviados, ${soWhatsapp.length} so WhatsApp`);
}

// ─── Orquestracao de um tique ────────────────────────────────────────────────

async function executarTique(body: Record<string, unknown>): Promise<void> {
  const inicioMs = Date.now();
  const fimTarefaMs = inicioMs + ORCAMENTO_TAREFA_MS;

  try {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SVC);
    const hoje = hojeBRT();
    const avisos: string[] = [];

    // Campanha do tique: a pedida no corpo, ou a que espera ha mais tempo.
    let campanha: Campanha | null = null;
    if (typeof body.campanha === 'string' && body.campanha) {
      const { data } = await supabase.from('campanhas_garimpo')
        .select('*').eq('slug', body.campanha).maybeSingle();
      campanha = data as Campanha | null;
    } else {
      const { data } = await supabase.from('campanhas_garimpo')
        .select('*').eq('ativo', true)
        .order('ultimo_tique', { ascending: true, nullsFirst: true })
        .limit(1);
      campanha = (data?.[0] ?? null) as Campanha | null;
    }
    if (!campanha) { console.log('[garimpo] nenhuma campanha ativa'); return; }
    if (!campanha.ativo) { console.log(`[garimpo/${campanha.slug}] campanha desligada`); return; }
    console.log(`[garimpo/${campanha.slug}] tique iniciado (fonte ${campanha.fonte})`);

    await supabase.from('campanhas_garimpo')
      .update({ ultimo_tique: new Date().toISOString() }).eq('id', campanha.id);

    // Listas de classificacao de e-mail (compartilhadas com o PNCP).
    const { data: cfgPncp } = await supabase.from('prospeccao_pncp_config')
      .select('email_padroes_contador, email_prefixos_genericos').eq('id', 1).maybeSingle();
    const padroesContador = (cfgPncp?.email_padroes_contador ?? []) as string[];
    const prefixosGenericos = (cfgPncp?.email_prefixos_genericos ?? []) as string[];

    // Execucao do dia.
    const { data: execs } = await supabase.from('garimpo_execucoes')
      .select('id, fase').eq('campanha_id', campanha.id).eq('data_referencia', hoje)
      .order('executado_em', { ascending: false }).limit(1);
    let execId = execs?.[0]?.id as string | undefined;
    const finalizadaHoje = execs?.[0]?.fase === 'finalizada';
    if (!execId) {
      const { data: novaExec, error } = await supabase.from('garimpo_execucoes')
        .insert({ campanha_id: campanha.id, data_referencia: hoje, dry_run: campanha.dry_run })
        .select('id').single();
      if (error || !novaExec) { console.error('[execucao]', error?.message); return; }
      execId = novaExec.id as string;
    }

    // Fases 1 e 2 rodam mesmo com o dia finalizado: estoque nunca para de encher.
    if (campanha.fonte === 'ccee') {
      await colherCcee(supabase, campanha, execId);
    } else {
      await colherApify(supabase, campanha, execId);
    }
    // Recarrega o cursor/run que a colheita pode ter alterado.
    const { data: recarregada } = await supabase.from('campanhas_garimpo')
      .select('*').eq('id', campanha.id).single();
    campanha = (recarregada ?? campanha) as Campanha;
    console.log(`[garimpo/${campanha.slug}] fase colheita concluida`);
    if (campanha.fonte === 'ccee') {
      await talvezGarimparCcee(supabase, campanha, avisos);
    } else {
      await talvezGarimpar(supabase, campanha, avisos);
    }
    console.log(`[garimpo/${campanha.slug}] fase garimpo concluida (avisos: ${avisos.length})`);

    if (Date.now() < fimTarefaMs) {
      if (campanha.fonte === 'ccee') {
        // Estagio A (BrasilAPI em massa) e estagio B (cadeia de e-mail),
        // cada um dentro do orcamento restante.
        await cadastrarCcee(supabase, campanha, Math.min(fimTarefaMs, Date.now() + 50_000));
        if (Date.now() < fimTarefaMs) {
          await enriquecerCcee(supabase, campanha, execId, padroesContador, prefixosGenericos, fimTarefaMs);
        }
      } else {
        await enriquecer(supabase, campanha, execId, padroesContador, prefixosGenericos, fimTarefaMs);
      }
    }

    console.log(`[garimpo/${campanha.slug}] fase enriquecimento concluida`);
    if (!finalizadaHoje && Date.now() < fimTarefaMs) {
      await enviarDia(supabase, campanha, execId, fimTarefaMs);
    }
    console.log(`[garimpo/${campanha.slug}] fase envio concluida`);

    // Contagens parciais.
    const { count: enriquecidosTotal } = await supabase.from('garimpo_estoque')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanha.id).in('estado', ['enriquecido', 'enviado', 'so_whatsapp']);
    await supabase.from('garimpo_execucoes')
      .update({ enriquecidos: Number(enriquecidosTotal ?? 0) }).eq('id', execId);

    if (!finalizadaHoje) {
      const { data: marcados } = await supabase.from('garimpo_estoque')
        .select('ultimo_resultado').eq('ultima_execucao_id', execId);
      const enviadosHoje = (marcados ?? []).filter((m) => ['enviado', 'dry_run'].includes(String(m.ultimo_resultado))).length;
      if (enviadosHoje >= Number(campanha.limite_diario) || horaBRT() >= HORA_LIMITE_BRT) {
        await finalizar(supabase, campanha, execId, avisos);
      }
    }
  } catch (err) {
    console.error('[garimpo]', err instanceof Error ? err.message : String(err));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  // Modo de diagnostico: tenta iniciar o run CCEE e devolve a resposta crua.
  if (body.modo === 'testar-ccee') {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SVC);
    const { data: c } = await supabase.from('campanhas_garimpo').select('*').eq('slug', 'energia').single();
    if (!c) return json({ success: false, error: 'campanha energia nao encontrada' });
    const fc = (c.fonte_config ?? {}) as Record<string, unknown>;
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/apify~web-scraper/runs?token=${APIFY_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: 'https://dadosabertos.ccee.org.br/dataset/lista_perfil_v1' }],
          pageFunction: CCEE_PAGE_FUNCTION,
          customData: {
            recursoAtual: String(fc.recurso_atual ?? ''),
            recursoAnterior: String(fc.recurso_anterior ?? ''),
            primeiraCarga: fc.diff_inicial_feito !== true,
          },
          proxyConfiguration: { useApifyProxy: true },
          maxPagesPerCrawl: 1,
          maxResultsPerCrawl: 999999,
          pageLoadTimeoutSecs: 120,
          pageFunctionTimeoutSecs: 300,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const texto = await res.text();
      if (res.ok) {
        const d = JSON.parse(texto);
        await supabase.from('campanhas_garimpo').update({
          apify_run_id: String(d?.data?.id ?? ''),
          apify_dataset_id: String(d?.data?.defaultDatasetId ?? ''),
          apify_cidade: 'lista CCEE',
          garimpo_ciclo_iniciado: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', c.id);
      }
      return json({ success: res.ok, http: res.status, resposta: texto.slice(0, 800) });
    } catch (e) {
      return json({ success: false, error: String(e) });
    }
  }

  // Modo manual: garimpa a proxima cidade da campanha AGORA, ignorando o alvo
  // de estoque. Uso pontual (botao da tela / diagnostico); a cadencia e o
  // ciclo continuam valendo para o cron.
  if (body.modo === 'garimpar-cidade' && typeof body.campanha === 'string') {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SVC);
    const { data: c } = await supabase.from('campanhas_garimpo').select('*').eq('slug', body.campanha).single();
    if (!c) return json({ success: false, error: 'campanha nao encontrada' });
    if (c.fonte !== 'maps') return json({ success: false, error: 'modo valido apenas para fonte maps' });
    if (c.apify_run_id) return json({ success: false, error: `ja ha run em andamento (${c.apify_cidade})` });
    const cursor = Number(c.garimpo_cursor ?? 0);
    const cidades = (c.cidades ?? []) as string[];
    if (cursor >= cidades.length) return json({ success: false, error: 'ciclo de cidades completo' });
    const cidade = cidades[cursor];
    const run = await iniciarRunApify((c.termos_busca ?? []) as string[], cidade);
    if (!run) return json({ success: false, error: 'falha ao iniciar o run no Apify' });
    await supabase.from('campanhas_garimpo').update({
      apify_run_id: run.runId,
      apify_dataset_id: run.datasetId,
      apify_cidade: cidade,
      garimpo_cursor: cursor + 1,
      garimpo_ciclo_iniciado: c.garimpo_ciclo_iniciado ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', c.id);
    return json({ success: true, cidade, run: run.runId });
  }

  // Modo status: resumo sincrono das campanhas, para diagnostico.
  if (body.modo === 'status') {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SVC);
    const { data: camps } = await supabase.from('campanhas_garimpo')
      .select('slug, fonte, apify_run_id, apify_cidade, garimpo_cursor, fonte_config');
    const resumo: Record<string, unknown>[] = [];
    for (const c of (camps ?? [])) {
      const { data: est } = await supabase.from('garimpo_estoque')
        .select('estado, cidade, lote_diff')
        .eq('campanha_id', (await supabase.from('campanhas_garimpo').select('id').eq('slug', c.slug).single()).data?.id ?? '');
      const porEstado: Record<string, number> = {};
      const porCidade: Record<string, number> = {};
      let novosDiff = 0;
      for (const r of (est ?? [])) {
        porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
        const cid = String(r.cidade ?? '?');
        porCidade[cid] = (porCidade[cid] ?? 0) + 1;
        if (r.lote_diff === 'novo') novosDiff++;
      }
      resumo.push({
        slug: c.slug, fonte: c.fonte,
        run_ativo: c.apify_run_id ? `${c.apify_run_id} (${c.apify_cidade})` : null,
        cursor: c.garimpo_cursor,
        diff_inicial_feito: (c.fonte_config as Record<string, unknown>)?.diff_inicial_feito ?? null,
        estoque_por_estado: porEstado,
        estoque_por_cidade: porCidade,
        novos_diff_total: novosDiff,
      });
    }
    return json({ success: true, campanhas: resumo });
  }

  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const tarefa = executarTique(body as Record<string, unknown>);
  if (runtime?.waitUntil) {
    runtime.waitUntil(tarefa);
    return json({
      success: true,
      started: true,
      info: 'Tique de garimpo iniciado em background. Acompanhe na tela Garimpo Automatico.',
    }, 202);
  }
  await tarefa;
  return json({ success: true });
});
