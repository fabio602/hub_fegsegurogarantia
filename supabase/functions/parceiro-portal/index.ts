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
//                    avisa a F&G por e-mail com os anexos
//
// Regras de comissão em _shared/comissaoParceiro.ts (mesmo arquivo do HUB).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emitirToken, validarToken, type ParceiroDoToken } from "../_shared/tokenParceiro.ts";
import { comissaoDoParceiro, type RegraParceiro } from "../_shared/comissaoParceiro.ts";

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

// ── enviar_demanda ─────────────────────────────────────────────────────────
async function enviarDemanda(supabase: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const c = soDigitos(corpo.cnpj);
  if (!cnpjValido(c)) throw new Erro('CNPJ inválido. Confira os números.');
  const razao = String(corpo.razao_social ?? '').trim().replace(/\s+/g, ' ');
  if (razao.length < 3) throw new Erro('Informe a razão social do tomador.');
  const tel = soDigitos(corpo.telefone);
  if (tel.length < 10 || tel.length > 11) throw new Erro('Telefone do cliente com DDD, 10 ou 11 números.');
  const email = String(corpo.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Erro('E-mail do cliente inválido.');
  const documento = corpo.documento === 'contrato' ? 'contrato' : corpo.documento === 'edital' ? 'edital' : '';
  if (!documento) throw new Erro('Escolha se o anexo é edital ou contrato.');
  const dataRef = String(corpo.data_referencia ?? '');
  if (dataRef && !/^\d{4}-\d{2}-\d{2}$/.test(dataRef)) throw new Erro('Data inválida.');
  const observacao = String(corpo.observacao ?? '').trim().slice(0, 1000);

  const anexosIn = Array.isArray(corpo.anexos) ? corpo.anexos as Array<{ path?: string; nome?: string; tamanho?: number; tipo?: string }> : [];
  if (anexosIn.length === 0) throw new Erro('Anexe o edital ou o contrato.');
  if (anexosIn.length > MAX_ARQUIVOS) throw new Erro(`Envie no máximo ${MAX_ARQUIVOS} arquivos.`);

  // Cada anexo precisa estar na pasta do próprio parceiro e existir no bucket.
  // O link assinado de 7 dias serve para conferir e vai no e-mail.
  const anexos: Array<{ path: string; nome: string; tamanho: number; tipo: string; url: string }> = [];
  for (const a of anexosIn) {
    const path = String(a.path || '');
    if (!path.startsWith(`p${parceiro.id}/`) || path.includes('..')) throw new Erro('Anexo inválido.', 403);
    const { data: s, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7 * 86400);
    if (error || !s?.signedUrl) throw new Erro(`O arquivo "${a.nome || path}" não chegou. Envie de novo.`);
    anexos.push({ path, nome: String(a.nome || path.split('/').pop()), tamanho: Number(a.tamanho) || 0, tipo: String(a.tipo || ''), url: s.signedUrl });
  }

  const cnpjFmt = fmtCnpj(c);
  const tipo = documento === 'edital' ? 'Licitante' : 'Performance';

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
  const obs = [
    `Enviada pelo portal do parceiro em ${agora.br} às ${agora.hora}.`,
    `Documento: ${documento === 'edital' ? 'edital (Licitante)' : 'contrato (Execução)'}.`,
    dataRef ? `${rotuloData} informada pelo parceiro: ${dataBr(dataRef)}.` : '',
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
    obs,
    anexos_demanda: anexos.map(({ path, nome, tamanho, tipo: t }) => ({ path, nome, tamanho, tipo: t })),
  }).select('id').single();
  if (error || !venda) throw new Error(error?.message || 'Falha ao gravar a demanda');

  await avisarFeG({ parceiro, venda: venda.id, razao, cnpjFmt, tel, email, documento, dataRef, rotuloData, observacao, anexos, agora });
  return { id: venda.id };
}

async function avisarFeG(p: {
  parceiro: ParceiroDoToken; venda: number; razao: string; cnpjFmt: string; tel: string; email: string;
  documento: string; dataRef: string; rotuloData: string; observacao: string;
  anexos: Array<{ nome: string; tamanho: number; url: string }>; agora: { br: string; hora: string };
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
      <h1 style="color:#fff;font-size:18px;font-weight:900;margin:0;">Nova demanda de ${esc(p.parceiro.name)}</h1>
      <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">Enviada pelo portal do parceiro em ${p.agora.br} às ${p.agora.hora}</p>
    </div>
    <div style="padding:24px 32px;background:#fff;">
      <table style="width:100%;border-collapse:collapse;">
        ${linha('Tomador', esc(p.razao), true)}
        ${linha('CNPJ', esc(p.cnpjFmt))}
        ${linha('Modalidade', esc(modalidade), true)}
        ${p.dataRef ? linha(p.rotuloData, esc(dataBr(p.dataRef))) : ''}
        ${linha('Telefone do cliente', `<a href="tel:+55${esc(p.tel)}" style="color:#1B263B;">${esc(fmtTelefone(p.tel))}</a>`)}
        ${linha('E-mail do cliente', `<a href="mailto:${esc(p.email)}" style="color:#1B263B;">${esc(p.email)}</a>`)}
        ${p.observacao ? linha('Observação', esc(p.observacao).replace(/\n/g, '<br>')) : ''}
        ${linha('Anexos', listaAnexos)}
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;">Os links dos anexos valem por 7 dias. Depois disso, abra pelo HUB.</p>
      <div style="margin-top:20px;padding:14px 18px;background:#fef9f0;border:1px solid #C69C6D40;border-radius:12px;">
        <p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">A cotação já está no Registro de Vendas como <strong style="color:#1B263B;">Em andamento</strong> (nº ${p.venda}).<br/>
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
        subject: `Nova demanda: ${p.razao} (${p.documento === 'edital' ? 'Licitante' : 'Execução'}) · ${p.parceiro.name}`,
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
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message }, e.status);
    console.error('[parceiro-portal]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
