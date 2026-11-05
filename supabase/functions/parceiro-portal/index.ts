// parceiro-portal: tudo o que o portal do parceiro (public/parceiros.html) lê
// ou grava passa por aqui, com service role, depois de conferir o token do
// login (_shared/tokenParceiro.ts). A anon key não lê sales, boletos, repasses
// nem partners, então o portal não fala direto com o banco.
//
// Ações (POST JSON { acao, token, ... }):
//   dados            vendas e demandas do parceiro, boletos, repasses e a
//                    comissão de cada negócio já calculada pela regra dele
//   alterar_senha    { atual, nova } devolve token novo (o antigo cai)
//   cnpj             { cnpj } razão social e situação na Receita
//   preparar_upload  { arquivos: [{ nome, tamanho, tipo }] } URLs assinadas
//                    para o navegador subir os arquivos no bucket privado
//   enviar_demanda   cria a cotação "Em andamento" no Registro de Vendas e
//                    avisa a F&G por e-mail com os anexos. Com cotacao_id de
//                    uma cotação da Junto que não passou, leva junto os dados
//                    e o motivo da recusa.
//   cotar_licitante  cota o Seguro Garantia Licitante direto na Junto
//                    Seguros (API da F&G). Não emite nada.
//   solicitar_emissao  gera a minuta na Junto, lança no Registro de Vendas e
//                    avisa a F&G, que aprova e emite pelo HUB.
//
// Regras de comissão em _shared/comissaoParceiro.ts (mesmo arquivo do HUB).
// Cliente da Junto em _shared/junto.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emitirToken, validarToken, type ParceiroDoToken } from "../_shared/tokenParceiro.ts";
import { comissaoDoParceiro, type RegraParceiro } from "../_shared/comissaoParceiro.ts";
import * as junto from "../_shared/junto.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;

const BUCKET = 'parceiro-demandas';
const AVISO_PARA = ['fabio@fegsegurogarantia.com.br'];
const HUB_URL = 'https://hub.fegsegurogarantia.com';

const MAX_ARQUIVOS = 5;
const MAX_BYTES = 30 * 1024 * 1024;           // por arquivo, igual ao limite do bucket
const MAX_ANEXO_EMAIL = 20 * 1024 * 1024;     // acima disso o e-mail leva só os links
const EXTENSOES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

class Erro extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const soma = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

function fmtTelefone(d: string): string {
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return d;
}

/** Data e hora de agora em Brasília. */
function agoraBrasilia() {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { iso: `${v('year')}-${v('month')}-${v('day')}`, br: `${v('day')}/${v('month')}/${v('year')}`, hora: `${v('hour')}:${v('minute')}` };
}

const dataBr = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');

function nomeSeguro(nome: string): string {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (base || 'arquivo').slice(-90);
}

function extensao(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome || '');
  return m ? m[1].toLowerCase() : '';
}

// ── dados ──────────────────────────────────────────────────────────────────
async function dados(supabase: SupabaseClient, parceiro: ParceiroDoToken) {
  const { data: vendas, error } = await supabase
    .from('sales')
    .select('id, data, created_at, nome, cnpj, tipo, product_type, premio, comissao, apolice_url, vendeu, segurado, orgaoLicitante, is, dataPregao, anexos_demanda')
    .eq('parceiro', parceiro.name)
    .order('data', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);

  const lista = vendas || [];
  const ids = lista.filter((v) => v.vendeu === 'Sim').map((v) => v.id);
  const boletosPorVenda: Record<string, unknown[]> = {};
  if (ids.length) {
    const { data: bol } = await supabase
      .from('boletos').select('sale_id, parcela, vencimento, url, valor, pago')
      .in('sale_id', ids).order('parcela');
    (bol || []).forEach((b) => { (boletosPorVenda[b.sale_id] ||= []).push(b); });
  }

  const { data: repasses } = await supabase
    .from('repasses')
    .select('id, periodo_mes, periodo_ano, valor_total, data_pagamento, comprovante_url, status')
    .eq('partner_id', parceiro.id)
    .order('periodo_ano', { ascending: false })
    .order('periodo_mes', { ascending: false });

  // Situação da cotação feita na Junto pelo portal, quando a venda veio de lá.
  const cotacaoPorVenda: Record<string, string> = {};
  const idsLista = lista.map((v) => v.id);
  if (idsLista.length) {
    const { data: cot } = await supabase
      .from('cotacoes_portal').select('sale_id, status')
      .eq('partner_id', parceiro.id).in('sale_id', idsLista);
    (cot || []).forEach((c) => { if (c.sale_id) cotacaoPorVenda[c.sale_id] = c.status; });
  }

  const regra = parceiro as unknown as RegraParceiro;
  return {
    parceiro: {
      id: parceiro.id,
      name: parceiro.name,
      partner_type: parceiro.partner_type,
      commission_pct: parceiro.commission_pct,
      comissao_faixas: parceiro.comissao_faixas,
    },
    vendas: lista.map((v) => ({
      ...v,
      // O parceiro vê o nome do arquivo que mandou; o caminho no bucket fica no servidor.
      anexos_demanda: Array.isArray(v.anexos_demanda)
        ? v.anexos_demanda.map((a: { nome?: string }) => ({ nome: a.nome }))
        : null,
      _boletos: boletosPorVenda[v.id] || [],
      _comissao_parceiro: comissaoDoParceiro(v.comissao, regra),
      _cotacao_junto: cotacaoPorVenda[v.id] || null,
    })),
    repasses: repasses || [],
  };
}

// ── alterar_senha ──────────────────────────────────────────────────────────
async function alterarSenha(supabase: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const atual = String(corpo.atual ?? '');
  const nova = String(corpo.nova ?? '');
  if (atual !== (parceiro.password || '')) throw new Erro('Senha atual incorreta.');
  if (nova.length < 6) throw new Erro('A nova senha deve ter pelo menos 6 caracteres.');
  if (nova === atual) throw new Erro('A nova senha precisa ser diferente da atual.');

  const { error } = await supabase.from('partners').update({ password: nova }).eq('id', parceiro.id);
  if (error) throw new Error(error.message);
  return { token: await emitirToken(supabase, { id: parceiro.id, password: nova }) };
}

// ── cnpj ───────────────────────────────────────────────────────────────────
interface DadosCnpj { razao_social: string; nome_fantasia: string; situacao: string; municipio: string; uf: string; fonte: string }

async function consultarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const fontes: Array<() => Promise<DadosCnpj | null>> = [
    async () => {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return { razao_social: '', nome_fantasia: '', situacao: 'NAO_ENCONTRADO', municipio: '', uf: '', fonte: 'brasilapi' };
      if (!r.ok) return null;
      const d = await r.json();
      return {
        razao_social: d.razao_social || '', nome_fantasia: d.nome_fantasia || '',
        situacao: d.descricao_situacao_cadastral || '', municipio: d.municipio || '', uf: d.uf || '', fonte: 'brasilapi',
      };
    },
    async () => {
      const r = await fetch(`https://open.cnpja.com/office/${cnpj}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json();
      return {
        razao_social: d.company?.name || '', nome_fantasia: d.alias || '',
        situacao: d.status?.text || '', municipio: d.address?.city || '', uf: d.address?.state || '', fonte: 'cnpja',
      };
    },
    async () => {
      const r = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json();
      return {
        razao_social: d.razao_social || '', nome_fantasia: d.estabelecimento?.nome_fantasia || '',
        situacao: d.estabelecimento?.situacao_cadastral || '', municipio: d.estabelecimento?.cidade?.nome || '',
        uf: d.estabelecimento?.estado?.sigla || '', fonte: 'cnpjws',
      };
    },
  ];
  for (const f of fontes) {
    try {
      const r = await f();
      if (r && (r.razao_social || r.situacao === 'NAO_ENCONTRADO')) return r;
    } catch (e) { console.warn('[cnpj]', String(e)); }
  }
  return null;
}

async function cnpj(corpo: Record<string, unknown>) {
  const c = soDigitos(corpo.cnpj);
  if (!cnpjValido(c)) throw new Erro('CNPJ inválido. Confira os números.');
  const d = await consultarCnpj(c);
  if (!d) return { encontrado: false, consulta_indisponivel: true, cnpj: fmtCnpj(c) };
  if (d.situacao === 'NAO_ENCONTRADO') return { encontrado: false, cnpj: fmtCnpj(c) };
  return { encontrado: true, cnpj: fmtCnpj(c), ...d };
}

// ── preparar_upload ────────────────────────────────────────────────────────
async function prepararUpload(supabase: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const arquivos = Array.isArray(corpo.arquivos) ? corpo.arquivos as Array<{ nome?: string; tamanho?: number }> : [];
  if (arquivos.length === 0) throw new Erro('Anexe o edital ou o contrato.');
  if (arquivos.length > MAX_ARQUIVOS) throw new Erro(`Envie no máximo ${MAX_ARQUIVOS} arquivos.`);

  const { iso } = agoraBrasilia();
  const lote = crypto.randomUUID();
  const saida = [];
  for (const a of arquivos) {
    const nome = String(a.nome || '');
    const ext = extensao(nome);
    if (!EXTENSOES[ext]) throw new Erro(`"${nome}" não é PDF, Word ou ZIP.`);
    const tamanho = Number(a.tamanho) || 0;
    if (tamanho <= 0) throw new Erro(`"${nome}" está vazio.`);
    if (tamanho > MAX_BYTES) throw new Erro(`"${nome}" passa de 30 MB.`);

    const path = `p${parceiro.id}/${iso.slice(0, 7)}/${lote}/${nomeSeguro(nome)}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message || 'Falha ao preparar o envio');
    saida.push({ nome, path, token: data.token, tipo: EXTENSOES[ext], tamanho });
  }
  return { arquivos: saida };
}

// ── anexos ─────────────────────────────────────────────────────────────────
type Anexo = { path: string; nome: string; tamanho: number; tipo: string; url: string };

/**
 * Cada anexo precisa estar na pasta do próprio parceiro e existir no bucket.
 * O link assinado de 7 dias serve para conferir e vai no e-mail.
 */
async function conferirAnexos(supabase: SupabaseClient, parceiro: ParceiroDoToken, entrada: unknown): Promise<Anexo[]> {
  const anexosIn = Array.isArray(entrada) ? entrada as Array<{ path?: string; nome?: string; tamanho?: number; tipo?: string }> : [];
  if (anexosIn.length === 0) throw new Erro('Anexe o edital ou o contrato.');
  if (anexosIn.length > MAX_ARQUIVOS) throw new Erro(`Envie no máximo ${MAX_ARQUIVOS} arquivos.`);
  const anexos: Anexo[] = [];
  for (const a of anexosIn) {
    const path = String(a.path || '');
    if (!path.startsWith(`p${parceiro.id}/`) || path.includes('..')) throw new Erro('Anexo inválido.', 403);
    const { data: s, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7 * 86400);
    if (error || !s?.signedUrl) throw new Erro(`O arquivo "${a.nome || path}" não chegou. Envie de novo.`);
    anexos.push({ path, nome: String(a.nome || path.split('/').pop()), tamanho: Number(a.tamanho) || 0, tipo: String(a.tipo || ''), url: s.signedUrl });
  }
  return anexos;
}

const semUrl = (anexos: Anexo[]) => anexos.map(({ path, nome, tamanho, tipo }) => ({ path, nome, tamanho, tipo }));

function lerContato(corpo: Record<string, unknown>) {
  const tel = soDigitos(corpo.telefone);
  if (tel.length < 10 || tel.length > 11) throw new Erro('Telefone do cliente com DDD, 10 ou 11 números.');
  const email = String(corpo.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Erro('E-mail do cliente inválido.');
  return { tel, email };
}

const brl = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? '' :
  'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function somaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ── enviar_demanda ─────────────────────────────────────────────────────────
async function enviarDemanda(supabase: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const c = soDigitos(corpo.cnpj);
  if (!cnpjValido(c)) throw new Erro('CNPJ inválido. Confira os números.');
  const razao = String(corpo.razao_social ?? '').trim().replace(/\s+/g, ' ');
  if (razao.length < 3) throw new Erro('Informe a razão social do tomador.');
  const { tel, email } = lerContato(corpo);
  const documento = corpo.documento === 'contrato' ? 'contrato' : corpo.documento === 'edital' ? 'edital' : '';
  if (!documento) throw new Erro('Escolha se o anexo é edital ou contrato.');
  const dataRef = String(corpo.data_referencia ?? '');
  if (dataRef && !/^\d{4}-\d{2}-\d{2}$/.test(dataRef)) throw new Erro('Data inválida.');
  const observacao = String(corpo.observacao ?? '').trim().slice(0, 1000);

  const anexos = await conferirAnexos(supabase, parceiro, corpo.anexos);

  const cnpjFmt = fmtCnpj(c);
  const tipo = documento === 'edital' ? 'Licitante' : 'Performance';

  // Demanda que veio de uma cotação na Junto que não passou (ou que o parceiro
  // preferiu mandar para a F&G): os dados do órgão, valor e vigência saem da
  // tabela, não do navegador.
  let cot: Record<string, any> | null = null;
  if (corpo.cotacao_id != null && corpo.cotacao_id !== '') {
    const { data } = await supabase.from('cotacoes_portal').select('*')
      .eq('id', Number(corpo.cotacao_id)).eq('partner_id', parceiro.id).maybeSingle();
    if (data && !data.sale_id && ['recusada', 'cotada'].includes(data.status) && soDigitos(data.tomador_cnpj) === c) cot = data;
  }

  // Clique duplo ou reenvio depois de falha de rede: a mesma demanda (mesmo
  // tomador, mesmo tipo e os mesmos arquivos) nos últimos 10 minutos não vira
  // duas cotações. Dois editais diferentes do mesmo cliente passam, porque os
  // arquivos são outros.
  const dezMin = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const assinaturaArquivos = (lista: Array<{ nome?: string }>) =>
    lista.map((a) => String(a.nome || '').trim().toLowerCase()).sort().join('|');
  const minhaAssinatura = assinaturaArquivos(anexos);
  const { data: recentes } = await supabase
    .from('sales').select('id, anexos_demanda')
    .eq('parceiro', parceiro.name).eq('cnpj', cnpjFmt).eq('tipo', tipo)
    .not('anexos_demanda', 'is', null).gte('created_at', dezMin)
    .order('id', { ascending: false }).limit(10);
  const repetida = (recentes || []).find((r) =>
    Array.isArray(r.anexos_demanda) && assinaturaArquivos(r.anexos_demanda) === minhaAssinatura);
  if (repetida) return { id: repetida.id, repetida: true };

  // Freio contra uso indevido de um token vazado.
  const umaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('sales').select('id', { count: 'exact', head: true })
    .eq('parceiro', parceiro.name).not('anexos_demanda', 'is', null).gte('created_at', umaHora);
  if ((count || 0) >= 20) throw new Erro('Muitos envios em pouco tempo. Fale com a F&G.', 429);

  const agora = agoraBrasilia();
  const rotuloData = documento === 'edital' ? 'Data da sessão' : 'Data da assinatura';
  const linhaJunto = cot
    ? (cot.status === 'recusada'
      ? `Cotação automática na Junto não passou: ${cot.motivo_recusa || ''}${cot.erro ? ` (Junto: ${cot.erro})` : ''}.`
      : `Cotação automática na Junto: prêmio ${brl(cot.premio)}. O parceiro preferiu mandar para a F&G cotar.`)
    : '';
  const obs = [
    `Enviada pelo portal do parceiro em ${agora.br} às ${agora.hora}.`,
    `Documento: ${documento === 'edital' ? 'edital (Licitante)' : 'contrato (Execução)'}.`,
    dataRef ? `${rotuloData} informada pelo parceiro: ${dataBr(dataRef)}.` : '',
    cot ? `Órgão: ${cot.segurado_nome ? `${cot.segurado_nome} ` : ''}(${fmtCnpj(soDigitos(cot.segurado_cnpj))}). Garantia ${brl(cot.valor_garantia)}, vigência de ${dataBr(cot.inicio_vigencia)} por ${cot.dias} dias.` : '',
    linhaJunto,
    observacao ? `Observação do parceiro: ${observacao}` : '',
  ].filter(Boolean).join('\n');

  const { data: venda, error } = await supabase.from('sales').insert({
    data: agora.iso,
    nome: razao,
    cnpj: cnpjFmt,
    telefone: fmtTelefone(tel),
    email,
    tipo,
    product_type: 'Seguro Garantia',
    vendeu: 'Em andamento',
    origem: 'Indicação',
    parceiro: parceiro.name,
    dataPregao: documento === 'edital' && dataRef ? dataRef : null,
    ...(cot ? {
      is: brl(cot.valor_garantia),
      orgaoLicitante: cot.segurado_nome || null,
      vigencia_inicio: cot.inicio_vigencia,
      vigencia_fim: somaDias(cot.inicio_vigencia, cot.dias),
    } : {}),
    obs,
    anexos_demanda: semUrl(anexos),
  }).select('id').single();
  if (error || !venda) throw new Error(error?.message || 'Falha ao gravar a demanda');

  if (cot) {
    await supabase.from('cotacoes_portal')
      .update({ sale_id: venda.id, updated_at: new Date().toISOString() }).eq('id', cot.id);
  }

  const extras: Array<[string, string, boolean?]> = cot ? [
    ['Órgão (segurado)', `${cot.segurado_nome ? `${esc(cot.segurado_nome)}<br>` : ''}<span style="color:#94a3b8;font-size:12px;">${esc(fmtCnpj(soDigitos(cot.segurado_cnpj)))}</span>`],
    ['Garantia', `${esc(brl(cot.valor_garantia))} · ${esc(dataBr(cot.inicio_vigencia))} por ${esc(cot.dias)} dias`],
    ['Junto', esc(linhaJunto), true],
  ] : [];

  await avisarFeG({ parceiro, venda: venda.id, razao, cnpjFmt, tel, email, documento, dataRef, rotuloData, observacao, anexos, agora, extras });
  return { id: venda.id };
}

async function avisarFeG(p: {
  parceiro: ParceiroDoToken; venda: number; razao: string; cnpjFmt: string; tel: string; email: string;
  documento: string; dataRef: string; rotuloData: string; observacao: string;
  anexos: Array<{ nome: string; tamanho: number; url: string }>; agora: { br: string; hora: string };
  extras?: Array<[string, string, boolean?]>;
  titulo?: string; assunto?: string; rodape?: string;
}) {
  const modalidade = p.documento === 'edital' ? 'Licitante (edital)' : 'Execução (contrato)';
  const linha = (rotulo: string, valor: string, destaque = false) => `
    <tr>
      <td style="padding:9px 0;font-size:12px;color:#94a3b8;width:150px;vertical-align:top;">${rotulo}</td>
      <td style="padding:9px 0;font-size:14px;color:#1B263B;${destaque ? 'font-weight:700;' : ''}">${valor}</td>
    </tr>`;
  const mb = (b: number) => {
    if (!(b > 0)) return '';
    if (b >= 1024 * 1024) return ` (${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB)`;
    return ` (${Math.max(1, Math.round(b / 1024))} KB)`;
  };
  const listaAnexos = p.anexos.map((a) =>
    `<div style="margin:4px 0;"><a href="${esc(a.url)}" style="color:#8B6C3E;font-weight:700;">${esc(a.nome)}</a><span style="color:#94a3b8;font-size:12px;">${mb(a.tamanho)}</span></div>`,
  ).join('');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
    <div style="background:#1B263B;padding:24px 32px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr></table>
      <h1 style="color:#fff;font-size:18px;font-weight:900;margin:0;">${esc(p.titulo || `Nova demanda de ${p.parceiro.name}`)}</h1>
      <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">Enviada pelo portal do parceiro em ${p.agora.br} às ${p.agora.hora}</p>
    </div>
    <div style="padding:24px 32px;background:#fff;">
      <table style="width:100%;border-collapse:collapse;">
        ${linha('Tomador', esc(p.razao), true)}
        ${linha('CNPJ', esc(p.cnpjFmt))}
        ${linha('Modalidade', esc(modalidade), true)}
        ${p.dataRef ? linha(p.rotuloData, esc(dataBr(p.dataRef))) : ''}
        ${(p.extras || []).map(([r, v, d]) => linha(r, v, !!d)).join('')}
        ${linha('Telefone do cliente', `<a href="tel:+55${esc(p.tel)}" style="color:#1B263B;">${esc(fmtTelefone(p.tel))}</a>`)}
        ${linha('E-mail do cliente', `<a href="mailto:${esc(p.email)}" style="color:#1B263B;">${esc(p.email)}</a>`)}
        ${p.observacao ? linha('Observação', esc(p.observacao).replace(/\n/g, '<br>')) : ''}
        ${linha('Anexos', listaAnexos)}
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;">Os links dos anexos valem por 7 dias. Depois disso, abra pelo HUB.</p>
      <div style="margin-top:20px;padding:14px 18px;background:#fef9f0;border:1px solid #C69C6D40;border-radius:12px;">
        <p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">${p.rodape || `A cotação já está no Registro de Vendas como <strong style="color:#1B263B;">Em andamento</strong> (nº ${p.venda}).`}<br/>
        <a href="${HUB_URL}" style="color:#8B6C3E;font-weight:700;">Abrir o HUB</a></p>
      </div>
    </div>
    <div style="background:#f8f5f0;padding:14px 32px;border-top:1px solid #e8e4dc;text-align:center;">
      <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal do Parceiro · F&amp;G Seguro Garantia</p>
    </div>
  </div>`;

  const total = p.anexos.reduce((s, a) => s + (a.tamanho || 0), 0);
  const anexar = total > 0 && total <= MAX_ANEXO_EMAIL;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to: AVISO_PARA,
        ...(p.parceiro.email ? { reply_to: p.parceiro.email } : {}),
        subject: p.assunto || `Nova demanda: ${p.razao} (${p.documento === 'edital' ? 'Licitante' : 'Execução'}) · ${p.parceiro.name}`,
        html,
        ...(anexar ? { attachments: p.anexos.map((a) => ({ filename: a.nome, path: a.url })) } : {}),
      }),
    });
    if (!r.ok) console.error('[resend]', r.status, await r.text());
  } catch (e) {
    // O e-mail não pode derrubar a demanda: ela já está gravada e aparece no HUB.
    console.error('[resend]', String(e));
  }
}

// ── cotar_licitante ────────────────────────────────────────────────────────
//
// Cota o Licitante na Junto com a chave da F&G. Tudo o que impede a cotação
// automática (tomador sem cadastro, ligado a outro corretor, sem limite, órgão
// sem cadastro, recusa da Junto) volta como ok:false com a explicação para o
// parceiro e o id da tentativa, que ele usa para mandar a demanda manual sem
// digitar nada de novo.

type Recusa = { motivo: string; mensagem: string; detalhe: string };

const MENSAGENS: Record<string, string> = {
  tomador_nao_cadastrado: 'Este tomador ainda não tem cadastro na Junto Seguros pela F&G. Envie para a F&G: a gente faz o cadastro e cota para você.',
  tomador_outro_corretor: 'Este tomador está ligado a outro corretor na Junto Seguros. Envie para a F&G, que a gente resolve e cota para você.',
  tomador_restrito: 'A Junto não liberou a cotação automática para este tomador. Envie para a F&G cotar.',
  sem_modalidade: 'Este tomador ainda não tem a modalidade Licitante aprovada na Junto. Envie para a F&G cotar.',
  sem_limite: 'O limite deste tomador na Junto não cobre esse valor de garantia. Envie para a F&G, que a gente busca a melhor saída.',
  segurado_nao_cadastrado: 'O órgão (segurado) ainda não tem cadastro ativo na Junto. Envie para a F&G, que a gente cadastra e cota.',
  cotacao_recusada: 'A Junto não fechou a cotação automática com esses dados. Envie para a F&G cotar.',
  junto_indisponivel: 'A Junto não respondeu agora. Tente de novo em alguns minutos ou envie para a F&G cotar.',
};

// O mesmo motivo, curto, como a F&G lê no Registro de Vendas e no e-mail.
const MOTIVO_FG: Record<string, string> = {
  tomador_nao_cadastrado: 'tomador sem cadastro na Junto pela F&G',
  tomador_outro_corretor: 'tomador ligado a outro corretor na Junto',
  tomador_restrito: 'a Junto não liberou o tomador',
  sem_modalidade: 'tomador sem a modalidade Licitante na Junto',
  sem_limite: 'limite do tomador na Junto não cobre o valor',
  segurado_nao_cadastrado: 'órgão sem cadastro ativo na Junto',
  cotacao_recusada: 'a Junto recusou a cotação',
  junto_indisponivel: 'a Junto não respondeu na hora da cotação',
};

function recusa(motivo: string, detalhe = ''): Recusa {
  return { motivo, mensagem: MENSAGENS[motivo] || MENSAGENS.cotacao_recusada, detalhe: detalhe.slice(0, 400) };
}

function recusaDoErro(e: unknown, etapa: 'tomador' | 'segurado' | 'cotacao'): Recusa {
  if (!(e instanceof junto.ErroJunto)) return recusa('junto_indisponivel', e instanceof Error ? e.message : String(e));
  const msg = e.message || '';
  if (e.status === 0 || e.status >= 500 || e.status === 429) return recusa('junto_indisponivel', `${e.status} ${msg}`);
  if (etapa === 'tomador') {
    if (/corretor|nomea|vincul/i.test(msg)) return recusa('tomador_outro_corretor', msg);
    if (e.codigo === '1013' || /n[ãa]o localizad|n[ãa]o existe|n[ãa]o encontrad/i.test(msg)) return recusa('tomador_nao_cadastrado', msg);
    return recusa('tomador_restrito', msg);
  }
  if (etapa === 'segurado') return recusa('segurado_nao_cadastrado', msg);
  if (/corretor|nomea|vincul/i.test(msg)) return recusa('tomador_outro_corretor', msg);
  if (/limite/i.test(msg)) return recusa('sem_limite', msg);
  return recusa('cotacao_recusada', msg);
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

type OpcaoParcela = { parcelas: number; valor: number | null; total: number | null; primeiro_vencimento: string | null };

/**
 * Opções de parcelamento. Formato visto em 05/11/2026:
 * installmentOptions: [{ numberOfInstallments, totalPremium, dueDateFirstInstallment,
 *   installments: [{ number, value, iof, dueDate }] }]
 */
function lerParcelas(cot: junto.CotacaoJunto): OpcaoParcela[] {
  const lista = Array.isArray(cot.installmentOptions) ? cot.installmentOptions as Array<Record<string, unknown>> : [];
  const saida: OpcaoParcela[] = [];
  for (const o of lista) {
    if (!o || typeof o !== 'object') continue;
    const itens = Array.isArray(o.installments) ? o.installments as Array<Record<string, unknown>> : [];
    const n = num(o.numberOfInstallments) ?? (itens.length || null);
    if (!n || n <= 0) continue;
    const total = num(o.totalPremium);
    const valor = num(itens[0]?.value) ?? (total != null ? Math.round((total / n) * 100) / 100 : null);
    const venc = String(o.dueDateFirstInstallment ?? itens[0]?.dueDate ?? '').slice(0, 10);
    saida.push({ parcelas: n, valor, total, primeiro_vencimento: /^\d{4}-\d{2}-\d{2}$/.test(venc) ? venc : null });
  }
  return saida.sort((a, b) => a.parcelas - b.parcelas);
}

async function cotarLicitante(supabase: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const tomadorCnpj = soDigitos(corpo.tomador_cnpj);
  if (!cnpjValido(tomadorCnpj)) throw new Erro('CNPJ do tomador inválido. Confira os números.');
  const seguradoCnpj = soDigitos(corpo.segurado_cnpj);
  if (!cnpjValido(seguradoCnpj)) throw new Erro('CNPJ do órgão inválido. Confira os números.');
  if (seguradoCnpj === tomadorCnpj) throw new Erro('O CNPJ do órgão precisa ser diferente do tomador.');

  const valor = Math.round(Number(corpo.valor) * 100) / 100;
  if (!(valor > 0)) throw new Erro('Informe o valor da garantia.');
  if (valor > 100_000_000) throw new Erro('Valor da garantia muito alto para a cotação automática. Envie para a F&G.');

  const inicio = String(corpo.inicio ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new Erro('Informe a data de início da vigência.');
  const hoje = agoraBrasilia().iso;
  if (inicio < hoje) throw new Erro('O início da vigência não pode ser antes de hoje.');
  if (inicio > somaDias(hoje, 365)) throw new Erro('O início da vigência passa de um ano. Confira a data.');

  const dias = Math.trunc(Number(corpo.dias));
  if (!(dias >= 1 && dias <= 730)) throw new Erro('Vigência em dias entre 1 e 730.');

  // Freio: até 30 tentativas por hora por parceiro.
  const umaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from('cotacoes_portal')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', parceiro.id).gte('created_at', umaHora);
  if ((count || 0) >= 30) throw new Erro('Muitas cotações em pouco tempo. Aguarde alguns minutos.', 429);

  const tentativa = {
    partner_id: parceiro.id,
    tomador_cnpj: fmtCnpj(tomadorCnpj),
    tomador_nome: String(corpo.razao_social ?? '').trim().slice(0, 200) || null,
    segurado_cnpj: fmtCnpj(seguradoCnpj),
    segurado_nome: String(corpo.segurado_nome ?? '').trim().slice(0, 200) || null,
    valor_garantia: valor,
    inicio_vigencia: inicio,
    dias,
  };

  // Tomador, limite e órgão em paralelo; a ordem de leitura decide o motivo.
  const [rTom, rLim, rSeg] = await Promise.allSettled([
    junto.tomador(tomadorCnpj),
    junto.limites(tomadorCnpj),
    junto.segurados(seguradoCnpj),
  ]);

  // Nome oficial da Junto quando ela devolveu; senão, o que veio da Receita.
  if (rTom.status === 'fulfilled' && rTom.value?.name) tentativa.tomador_nome = String(rTom.value.name);
  const segJunto = rSeg.status === 'fulfilled' ? junto.seguradoAtivo(rSeg.value) : null;
  if (segJunto?.segurado.name) tentativa.segurado_nome = String(segJunto.segurado.name);

  const gravarRecusa = async (r: Recusa) => {
    console.warn('[cotar_licitante] recusa', r.motivo, r.detalhe);
    const { data } = await supabase.from('cotacoes_portal').insert({
      ...tentativa, status: 'recusada', motivo_recusa: MOTIVO_FG[r.motivo] || r.motivo, erro: r.detalhe || null,
    }).select('id').single();
    return { ok: false, motivo: r.motivo, mensagem: r.mensagem, cotacao_id: data?.id ?? null };
  };

  if (rTom.status === 'rejected') return gravarRecusa(recusaDoErro(rTom.reason, 'tomador'));
  if (rLim.status === 'rejected') return gravarRecusa(recusaDoErro(rLim.reason, 'tomador'));
  const lim = junto.limiteLicitante(rLim.value);
  if (!lim) return gravarRecusa(recusa('sem_modalidade'));
  if (lim.disponivel < valor) return gravarRecusa(recusa('sem_limite', `disponível ${lim.disponivel}, pedido ${valor}`));

  if (rSeg.status === 'rejected') {
    const r = recusaDoErro(rSeg.reason, 'segurado');
    return gravarRecusa(r.motivo === 'junto_indisponivel' ? r : recusa('segurado_nao_cadastrado', r.detalhe));
  }
  const seg = junto.seguradoAtivo(rSeg.value);
  if (!seg) return gravarRecusa(recusa('segurado_nao_cadastrado', 'nenhum segurado ativo com endereço'));

  const nomeTomador = String(rTom.value?.name || tentativa.tomador_nome || '').trim();
  const nomeSegurado = String(seg.segurado.name || tentativa.segurado_nome || '').trim();
  const dadosCot = { tomadorCnpj, valor, inicio, dias };

  // Recotar (valor ou vigência mudou) abre sempre uma cotação nova na Junto: o
  // PUT de lá guarda a taxa da cotação anterior e erra o prêmio (ver junto.ts).
  let cot: junto.CotacaoJunto;
  try {
    cot = await junto.criarCotacaoLicitante(dadosCot);
  } catch (e) {
    return gravarRecusa(recusaDoErro(e, 'cotacao'));
  }
  if (!cot || !cot.id) return gravarRecusa(recusa('cotacao_recusada', 'resposta sem id'));

  const premio = num(cot.totalPremiumValue) ?? num(cot.netPremiumValue);
  const comissaoFg = num(cot.pricing?.comissionValue);
  const regra = parceiro as unknown as RegraParceiro;
  const suaComissao = comissaoDoParceiro(comissaoFg ?? 0, regra);
  const parcelas = lerParcelas(cot);

  const linha = {
    ...tentativa,
    tomador_nome: nomeTomador || null,
    segurado_nome: nomeSegurado || null,
    segurado_id: seg.segurado.id,
    segurado_endereco_id: seg.enderecoId,
    cotacao_externa_id: cot.id,
    status: 'cotada',
    premio,
    comissao_fg: comissaoFg,
    comissao_parceiro: suaComissao.valor,
    comissao_parceiro_pct: suaComissao.pct,
    resposta: cot,
    updated_at: new Date().toISOString(),
  };

  const { data: nova, error: erroNova } = await supabase.from('cotacoes_portal').insert(linha).select('id').single();
  if (erroNova || !nova) throw new Error(erroNova?.message || 'Falha ao gravar a cotação');
  const idLinha: number = nova.id;

  // A cotação que o parceiro estava vendo antes desta deixa de valer.
  if (corpo.cotacao_id != null && corpo.cotacao_id !== '') {
    await supabase.from('cotacoes_portal')
      .update({ status: 'cancelada', erro: `Substituída pela cotação ${idLinha} do portal.`, updated_at: new Date().toISOString() })
      .eq('id', Number(corpo.cotacao_id)).eq('partner_id', parceiro.id).eq('status', 'cotada').is('sale_id', null);
  }

  return {
    ok: true,
    cotacao: {
      id: idLinha,
      seguradora: 'Junto Seguros',
      tomador: { nome: nomeTomador, cnpj: fmtCnpj(tomadorCnpj) },
      segurado: { nome: nomeSegurado, cnpj: fmtCnpj(seguradoCnpj) },
      valor,
      inicio,
      fim: somaDias(inicio, dias),
      dias,
      premio,
      parcelas,
      parcelas_max: num(cot.numberOfMaxInstallments),
      comissao_fg: comissaoFg,
      comissao_parceiro: suaComissao,
    },
  };
}

// ── solicitar_emissao ──────────────────────────────────────────────────────
//
// O parceiro aceitou a cotação. Aqui a minuta é gerada na Junto (não emite),
// a cotação entra no Registro de Vendas e a F&G recebe o pedido. A emissão só
// sai pelo HUB, quando alguém da F&G aprova.

async function solicitarEmissao(supabase: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const id = Number(corpo.cotacao_id);
  if (!(id > 0)) throw new Erro('Cotação não encontrada. Cote de novo.');
  const { data: cot } = await supabase.from('cotacoes_portal').select('*')
    .eq('id', id).eq('partner_id', parceiro.id).maybeSingle();
  if (!cot) throw new Erro('Cotação não encontrada. Cote de novo.', 404);
  if (cot.status === 'emissao_solicitada' && cot.sale_id) return { id: cot.sale_id, repetida: true };
  if (cot.sale_id) throw new Erro('Esta cotação já foi enviada para a F&G.');
  if (cot.status !== 'cotada' || !cot.cotacao_externa_id) throw new Erro('Esta cotação não pode mais ser emitida. Cote de novo.');

  const hoje = agoraBrasilia().iso;
  if (cot.inicio_vigencia < hoje) throw new Erro('O início da vigência já passou. Cote de novo com a data certa.');
  const idadeHoras = (Date.now() - new Date(cot.updated_at || cot.created_at).getTime()) / 3_600_000;
  if (idadeHoras > 72) throw new Erro('Esta cotação tem mais de 3 dias. Cote de novo para atualizar o prêmio.');

  const { tel, email } = lerContato(corpo);
  const edital = String(corpo.edital ?? '').trim().replace(/\s+/g, ' ');
  if (edital.length < 3 || edital.length > 120) throw new Erro('Informe o número do edital ou do processo.');
  const dataPregao = String(corpo.data_pregao ?? '');
  if (dataPregao && !/^\d{4}-\d{2}-\d{2}$/.test(dataPregao)) throw new Erro('Data da sessão inválida.');
  const observacao = String(corpo.observacao ?? '').trim().slice(0, 1000);
  const anexos = await conferirAnexos(supabase, parceiro, corpo.anexos);

  // Clique duplo: só uma chamada consegue passar a cotação de "cotada" para
  // "emissao_solicitada". A outra recebe o pedido que já existe.
  const { data: pega } = await supabase.from('cotacoes_portal')
    .update({ status: 'emissao_solicitada', updated_at: new Date().toISOString() })
    .eq('id', cot.id).eq('status', 'cotada').is('sale_id', null)
    .select('id');
  if (!pega || pega.length === 0) {
    const { data: atual } = await supabase.from('cotacoes_portal').select('sale_id').eq('id', cot.id).maybeSingle();
    if (atual?.sale_id) return { id: atual.sale_id, repetida: true };
    throw new Erro('Este pedido já está sendo enviado. Aguarde um instante.', 409);
  }
  try {
    return await registrarPedido(supabase, parceiro, cot, { tel, email, edital, dataPregao, observacao, anexos });
  } catch (e) {
    // Nada foi lançado no Registro de Vendas: devolve a cotação para "cotada".
    await supabase.from('cotacoes_portal')
      .update({ status: 'cotada', updated_at: cot.updated_at }).eq('id', cot.id).is('sale_id', null);
    throw e;
  }
}

async function registrarPedido(
  supabase: SupabaseClient, parceiro: ParceiroDoToken, cot: Record<string, any>,
  p: { tel: string; email: string; edital: string; dataPregao: string; observacao: string; anexos: Anexo[] },
) {
  const { tel, email, edital, dataPregao, observacao, anexos } = p;

  // Minuta na Junto. Apólice e boleto vão para a F&G e para o cliente.
  const contatos = [...new Set([...AVISO_PARA, email])];
  let minutaUrl: string | null = null;
  let pendencias: boolean | null = null;
  let erroMinuta = '';
  try {
    const m = await junto.gerarMinuta(Number(cot.cotacao_externa_id), {
      seguradoCnpj: soDigitos(cot.segurado_cnpj),
      seguradoId: Number(cot.segurado_id),
      enderecoId: Number(cot.segurado_endereco_id),
      edital,
      contatos,
    });
    minutaUrl = typeof m?.draftUrl === 'string' ? m.draftUrl : null;
    pendencias = typeof m?.hasHangs === 'boolean' ? m.hasHangs : null;
  } catch (e) {
    erroMinuta = e instanceof Error ? e.message : String(e);
    console.error('[solicitar_emissao] minuta', erroMinuta, e instanceof junto.ErroJunto ? e.bruto : '');
  }

  const agora = agoraBrasilia();
  const fim = somaDias(cot.inicio_vigencia, cot.dias);
  const obs = [
    `Pedido de emissão pelo portal do parceiro em ${agora.br} às ${agora.hora}.`,
    `Cotação automática na Junto nº ${cot.cotacao_externa_id}: prêmio ${brl(cot.premio)}, comissão ${brl(cot.comissao_fg)}.`,
    `Órgão: ${cot.segurado_nome || ''} (${cot.segurado_cnpj}). Edital/processo: ${edital}.`,
    minutaUrl ? 'Minuta gerada na Junto.' : `Minuta não gerada na Junto${erroMinuta ? `: ${erroMinuta}` : ''}.`,
    pendencias ? 'A Junto pediu documentos antes de emitir (pendências na minuta).' : '',
    'Emissão aguardando aprovação da F&G no HUB.',
    'O portal mostrou ao parceiro, antes do pedido, que a Licitante só é cancelada em caso de suspensão do pregão (não por arrependimento).',
    observacao ? `Observação do parceiro: ${observacao}` : '',
  ].filter(Boolean).join('\n');

  const { data: venda, error } = await supabase.from('sales').insert({
    data: agora.iso,
    nome: cot.tomador_nome || cot.tomador_cnpj,
    cnpj: cot.tomador_cnpj,
    telefone: fmtTelefone(tel),
    email,
    tipo: 'Licitante',
    product_type: 'Seguro Garantia',
    vendeu: 'Em andamento',
    origem: 'Indicação',
    parceiro: parceiro.name,
    seguradora: 'Junto Seguros',
    premio: brl(cot.premio),
    comissao: brl(cot.comissao_fg),
    is: brl(cot.valor_garantia),
    orgaoLicitante: cot.segurado_nome || null,
    vigencia_inicio: cot.inicio_vigencia,
    vigencia_fim: fim,
    dataPregao: dataPregao || null,
    obs,
    anexos_demanda: semUrl(anexos),
  }).select('id').single();
  if (error || !venda) throw new Error(error?.message || 'Falha ao gravar o pedido');

  await supabase.from('cotacoes_portal').update({
    status: 'emissao_solicitada',
    sale_id: venda.id,
    edital,
    minuta_url: minutaUrl,
    minuta_pendencias: pendencias,
    erro: erroMinuta || null,
    updated_at: new Date().toISOString(),
  }).eq('id', cot.id);

  const minutaHtml = minutaUrl
    ? `<a href="${esc(minutaUrl)}" style="color:#8B6C3E;font-weight:700;">Abrir a minuta</a>${pendencias ? '<br><span style="color:#b45309;font-size:12px;">A Junto pediu documentos antes de emitir.</span>' : ''}`
    : `<span style="color:#be123c;">Não gerada${erroMinuta ? `: ${esc(erroMinuta)}` : ''}</span>`;

  await avisarFeG({
    parceiro, venda: venda.id, razao: cot.tomador_nome || cot.tomador_cnpj, cnpjFmt: cot.tomador_cnpj,
    tel, email, documento: 'edital', dataRef: dataPregao, rotuloData: 'Data da sessão', observacao, anexos, agora,
    titulo: `Pedido de emissão de ${parceiro.name}`,
    assunto: `Pedido de emissão: ${cot.tomador_nome || cot.tomador_cnpj} (Licitante Junto) · ${parceiro.name}`,
    extras: [
      ['Órgão (segurado)', `${esc(cot.segurado_nome || '')}<br><span style="color:#94a3b8;font-size:12px;">${esc(cot.segurado_cnpj)}</span>`],
      ['Edital ou processo', esc(edital)],
      ['Garantia', `${esc(brl(cot.valor_garantia))} · ${esc(dataBr(cot.inicio_vigencia))} a ${esc(dataBr(fim))} (${esc(cot.dias)} dias)`],
      ['Prêmio Junto', esc(brl(cot.premio)), true],
      ['Comissão F&G', esc(brl(cot.comissao_fg))],
      [`Comissão do parceiro`, `${esc(brl(cot.comissao_parceiro))} (${esc(String(cot.comissao_parceiro_pct ?? '').replace('.', ','))}%)`],
      ['Minuta', minutaHtml],
      ['Cotação na Junto', `nº ${esc(cot.cotacao_externa_id)}`],
    ],
    rodape: `O pedido está no Registro de Vendas como <strong style="color:#1B263B;">Em andamento</strong> (nº ${venda.id}). <strong style="color:#1B263B;">A emissão só sai quando a F&amp;G aprovar no HUB.</strong>`,
  });

  return { id: venda.id, minuta: !!minutaUrl, pendencias: !!pendencias };
}

// ── roteador ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Método não permitido' }, 405);

  try {
    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const parceiro = await validarToken(supabase, corpo.token);
    if (!parceiro) return json({ success: false, error: 'Sessão expirada. Entre de novo.', sessao_expirada: true }, 401);
    if (parceiro.partner_type === 'imobiliaria') return json({ success: false, error: 'Acesso restrito.' }, 403);

    switch (corpo.acao) {
      case 'dados': return json({ success: true, ...(await dados(supabase, parceiro)) });
      case 'alterar_senha': return json({ success: true, ...(await alterarSenha(supabase, parceiro, corpo)) });
      case 'cnpj': return json({ success: true, ...(await cnpj(corpo)) });
      case 'preparar_upload': return json({ success: true, ...(await prepararUpload(supabase, parceiro, corpo)) });
      case 'enviar_demanda': return json({ success: true, ...(await enviarDemanda(supabase, parceiro, corpo)) });
      case 'cotar_licitante': return json({ success: true, ...(await cotarLicitante(supabase, parceiro, corpo)) });
      case 'solicitar_emissao': return json({ success: true, ...(await solicitarEmissao(supabase, parceiro, corpo)) });
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message }, e.status);
    console.error('[parceiro-portal]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
