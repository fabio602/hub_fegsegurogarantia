// Ficha de garantia judicial (depósito recursal trabalhista), formulário
// público em judicial.fegsegurogarantia.com.
//
// Deploy: supabase functions deploy ficha-judicial --no-verify-jwt
//
// O formulário é aberto (sem login), então a function é a única porta: o site
// nunca lê nem grava no banco com a anon key (migrações 144 e 145). Tudo o que
// o navegador valida é validado de novo aqui (regras.ts).
//
// Ações (POST, JSON):
//
//   preparar  Confere a ficha inteira e a lista de arquivos. Não grava nada.
//             Devolve o `lote` e uma URL de upload assinada por documento, no
//             bucket privado fichas-judiciais.
//
//   enviar    Confere tudo de novo, confirma que os arquivos do lote chegaram,
//             grava a ficha (protocolo GJ-AAMMDD-NNNN), manda a confirmação
//             para o cliente e o aviso para o Fábio. Repetir o envio do mesmo
//             lote devolve o mesmo protocolo, sem duplicar.
//
// Travas contra abuso, sem serviço pago: campo isca (`site`), limite de lotes
// e de fichas por origem (hash do IP, nunca o IP), tipos e tamanho de arquivo
// limitados também no bucket.
//
// Segredos: RESEND_API_KEY (o mesmo dos lembretes do HUB).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Erro, lerFicha, lerArquivos, nomeSeguro, type Ficha,
  fmtCnpj, fmtCpf, fmtCep, fmtTelefone, fmtBRL, dataBr,
  ROTULO_PAPEL, ROTULO_CAUCAO, ROTULO_EXITO, ROTULO_CATEGORIA, RE_CAMINHO, RE_UUID,
} from "./regras.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;

const BUCKET = 'fichas-judiciais';
const AVISO_PARA = ['fabio@fegsegurogarantia.com.br'];
const REMETENTE = 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>';
const CONTATO_EMAIL = 'Fabio@fegsegurogarantia.com.br';
const CONTATO_WHATSAPP = '(15) 99861-8659';
const HUB_URL = 'https://hub.fegsegurogarantia.com';
const LOGO_URL = 'https://hub.fegsegurogarantia.com/marca/fg-logo-horizontal-bege.png';

const MAX_LOTES_MES = 8;      // lotes de upload por origem, por mês
const MAX_FICHAS_DIA = 10;    // fichas gravadas por origem em 24 h
const MAX_ANEXO_EMAIL = 20 * 1024 * 1024; // acima disso o e-mail interno leva só os links

const ORIGENS = ['https://judicial.fegsegurogarantia.com', 'https://hub.fegsegurogarantia.com', 'http://localhost:3000', 'http://localhost:8080'];

function cors(req: Request): Record<string, string> {
  const origem = req.headers.get('origin') || '';
  return {
    ...(ORIGENS.includes(origem) ? { 'Access-Control-Allow-Origin': origem } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const comQuebras = (s: unknown) => esc(s).replace(/\n/g, '<br>');

/** Data e hora de agora em Brasília. */
function agoraBrasilia() {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { iso: `${v('year')}-${v('month')}-${v('day')}`, br: `${v('day')}/${v('month')}/${v('year')}`, hora: `${v('hour')}:${v('minute')}` };
}

/** Hash da origem (IP + segredo do projeto). Serve só para limitar repetição; não dá para voltar ao IP. */
async function hashOrigem(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'sem-ip';
  const bytes = new TextEncoder().encode(`${ip}|${SUPABASE_SERVICE_KEY}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function conferirEntrada(corpo: Record<string, unknown>) {
  // Campo isca: fica escondido no formulário. Gente não preenche; robô preenche.
  if (String(corpo.site ?? '').trim()) throw new Erro('Não foi possível enviar. Tente de novo.', 400);
  if (corpo.aceite !== true) throw new Erro('Marque a autorização de uso dos dados para continuar.', 400, 'aceite');
}

// ── preparar ─────────────────────────────────────────────────────────────────
async function preparar(supabase: SupabaseClient, req: Request, corpo: Record<string, unknown>) {
  conferirEntrada(corpo);
  const agora = agoraBrasilia();
  lerFicha(corpo, agora.iso); // se a ficha tem erro, o cliente descobre antes de subir arquivo
  const arquivos = lerArquivos(corpo.arquivos);

  const origem = (await hashOrigem(req)).slice(0, 12);
  const pasta = `${agora.iso.slice(0, 7)}/${origem}`;
  const { data: lotes, error: errLista } = await supabase.storage.from(BUCKET).list(pasta, { limit: 100 });
  if (errLista) throw new Error(`Falha ao listar ${pasta}: ${errLista.message}`);
  if ((lotes?.length ?? 0) >= MAX_LOTES_MES) {
    throw new Erro(`Muitos envios seguidos a partir desta conexão. Fale com a gente: ${CONTATO_EMAIL} ou WhatsApp ${CONTATO_WHATSAPP}.`, 429);
  }

  const lote = crypto.randomUUID();
  const saida = [];
  for (const a of arquivos) {
    const path = `${pasta}/${lote}/${a.categoria}-${nomeSeguro(a.nome)}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message || 'Falha ao preparar o envio');
    saida.push({ categoria: a.categoria, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, path, token: data.token });
  }
  return { lote, bucket: BUCKET, arquivos: saida };
}

// ── enviar ───────────────────────────────────────────────────────────────────
type Anexo = { path: string; nome: string; tamanho: number; tipo: string; categoria: string };

/** Só aceita arquivos do próprio lote, e só os que chegaram de verdade ao bucket. */
async function conferirAnexos(supabase: SupabaseClient, lote: string, entrada: unknown): Promise<Anexo[]> {
  const lista = Array.isArray(entrada) ? entrada as Array<Record<string, unknown>> : [];
  if (lista.length === 0 || lista.length > 3) throw new Erro('Anexe a sentença ou decisão recorrida.', 400, 'sentenca');

  const anexos: Anexo[] = [];
  let pasta = '';
  for (const a of lista) {
    const path = String(a.path ?? '');
    const partes = path.split('/');
    if (!RE_CAMINHO.test(path) || partes[2] !== lote) throw new Erro('Anexo inválido.', 403);
    const estaPasta = partes.slice(0, 3).join('/');
    if (pasta && pasta !== estaPasta) throw new Erro('Anexo inválido.', 403);
    pasta = estaPasta;
    const categoria = partes[3].split('-')[0];
    if (anexos.some((x) => x.categoria === categoria)) throw new Erro('Envie um arquivo por documento.', 400);
    anexos.push({ path, nome: String(a.nome || partes[3]).slice(0, 200), tamanho: 0, tipo: '', categoria });
  }
  if (!anexos.some((x) => x.categoria === 'sentenca')) throw new Erro('Anexe a sentença ou decisão recorrida.', 400, 'sentenca');

  // Tamanho e tipo vêm do que está guardado no bucket, não do que o navegador declarou.
  const { data: guardados, error } = await supabase.storage.from(BUCKET).list(pasta, { limit: 20 });
  if (error) throw new Error(`Falha ao listar ${pasta}: ${error.message}`);
  for (const a of anexos) {
    const obj = (guardados || []).find((o) => `${pasta}/${o.name}` === a.path);
    if (!obj) throw new Erro(`O arquivo "${a.nome}" não chegou. Envie de novo.`, 400, a.categoria);
    const meta = (obj.metadata || {}) as { size?: number; mimetype?: string };
    a.tamanho = Number(meta.size) || 0;
    a.tipo = String(meta.mimetype || '');
  }
  return anexos;
}

async function enviar(supabase: SupabaseClient, req: Request, corpo: Record<string, unknown>) {
  conferirEntrada(corpo);
  const agora = agoraBrasilia();
  const ficha = lerFicha(corpo, agora.iso);

  const lote = String(corpo.lote ?? '');
  if (!RE_UUID.test(lote)) throw new Erro('Envio inválido. Recarregue a página e tente de novo.', 400);

  // Mesmo lote enviado duas vezes (clique duplo, rede caiu na volta): devolve o mesmo protocolo.
  const { data: jaExiste, error: errBusca } = await supabase.from('fichas_judiciais')
    .select('protocolo, valor_garantia, contato_email').eq('token_envio', lote).maybeSingle();
  if (errBusca) throw new Error(errBusca.message);
  if (jaExiste) return { protocolo: jaExiste.protocolo, valor_garantia: Number(jaExiste.valor_garantia), email: jaExiste.contato_email, repetido: true };

  const origem = await hashOrigem(req);
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: errConta } = await supabase.from('fichas_judiciais')
    .select('id', { count: 'exact', head: true }).eq('origem_hash', origem).gte('created_at', desde);
  if (errConta) throw new Error(errConta.message);
  if ((count ?? 0) >= MAX_FICHAS_DIA) {
    throw new Erro(`Muitas fichas enviadas a partir desta conexão hoje. Fale com a gente: ${CONTATO_EMAIL} ou WhatsApp ${CONTATO_WHATSAPP}.`, 429);
  }

  const anexos = await conferirAnexos(supabase, lote, corpo.anexos);

  const { data: nova, error: errGrava } = await supabase.from('fichas_judiciais').insert({
    ...ficha,
    anexos,
    anexos_concluidos_em: new Date().toISOString(),
    lgpd_aceite_em: new Date().toISOString(),
    token_envio: lote,
    origem_hash: origem,
  }).select('id, protocolo').single();
  if (errGrava || !nova) throw new Error(errGrava?.message || 'Falha ao gravar a ficha');

  // A ficha já está gravada. E-mail que falhar não derruba o envio: fica registrado
  // (email_cliente_em / email_interno_em nulos) e a ficha aparece no HUB de todo jeito.
  const links = await Promise.all(anexos.map(async (a) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 7 * 86400);
    return { ...a, url: data?.signedUrl || '' };
  }));
  const [okCliente, okInterno] = await Promise.all([
    emailCliente(ficha, nova.protocolo, anexos),
    emailInterno(ficha, nova.protocolo, links, agora),
  ]);
  const marca = new Date().toISOString();
  const { error: errMarca } = await supabase.from('fichas_judiciais').update({
    ...(okCliente ? { email_cliente_em: marca } : {}),
    ...(okInterno ? { email_interno_em: marca } : {}),
  }).eq('id', nova.id);
  if (errMarca) console.error('[ficha-judicial] marca de e-mail', errMarca.message);

  return { protocolo: nova.protocolo, valor_garantia: ficha.valor_garantia, email: ficha.contato_email, email_enviado: okCliente };
}

// ── e-mails ──────────────────────────────────────────────────────────────────
async function resend(corpo: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: REMETENTE, ...corpo }),
    });
    if (!r.ok) console.error('[resend]', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('[resend]', String(e));
    return false;
  }
}

/** Todos os campos da ficha, na ordem em que foram preenchidos. Vai nos dois e-mails. */
function linhasDaFicha(f: Ficha): Array<[string, Array<[string, string]>]> {
  const doc = f.reclamante_documento.length === 11 ? fmtCpf(f.reclamante_documento) : fmtCnpj(f.reclamante_documento);
  return [
    ['Contato', [
      ['Nome', `${esc(f.contato_nome)} (${esc(ROTULO_PAPEL[f.contato_papel])})`],
      ['E-mail', esc(f.contato_email)],
      ['Celular', esc(fmtTelefone(f.contato_telefone))],
    ]],
    ['Empresa (reclamada)', [
      ['Razão social', esc(f.tomador_razao_social)],
      ['CNPJ', esc(fmtCnpj(f.tomador_cnpj))],
      ['Endereço', esc(`${f.tomador_endereco}, ${f.tomador_cidade}/${f.tomador_uf}, CEP ${fmtCep(f.tomador_cep)}`)],
    ]],
    ['Processo', [
      ['Número', esc(f.processo_numero)],
      ['Vara', esc(f.processo_juizo)],
      ['Valor da causa', `R$ ${fmtBRL(f.valor_causa)}`],
      ['Distribuição', dataBr(f.data_distribuicao)],
      ['Recurso', esc(f.recurso)],
      ['Tipo de garantia', esc(ROTULO_CAUCAO[f.tipo_caucao])],
    ]],
    ['Reclamante', [
      ['Nome', esc(f.reclamante_nome)],
      ['CPF ou CNPJ', esc(doc)],
      ['Endereço', f.reclamante_endereco ? esc(f.reclamante_endereco) : 'Não informado'],
    ]],
    ['Parecer do advogado', [
      ['Objeto do processo', comQuebras(f.objeto)],
      ['Histórico', comQuebras(f.historico)],
      ['Linha de defesa', comQuebras(f.linha_defesa)],
      ['Probabilidade de êxito', esc(ROTULO_EXITO[f.probabilidade_exito])],
      ['Advogado', `${esc(f.advogado_nome)}, OAB ${esc(f.advogado_oab_uf)} ${esc(f.advogado_oab)}`],
    ]],
    ['Valor', [
      ['Valor informado', `R$ ${fmtBRL(f.valor_base)}`],
      ['Com acréscimo de 30%', `R$ ${fmtBRL(f.valor_garantia)}`],
      ['Data base', dataBr(f.data_base)],
      ['Índice de reajuste', esc(f.indice_reajuste)],
      ['Objetivo da garantia', comQuebras(f.objetivo)],
      ['Segurado', f.segurado ? esc(f.segurado) : 'A confirmar'],
      ...(f.observacoes ? [['Observações', comQuebras(f.observacoes)] as [string, string]] : []),
    ]],
  ];
}

function tabelaDaFicha(f: Ficha): string {
  return linhasDaFicha(f).map(([titulo, linhas]) => `
    <tr><td colspan="2" style="padding:18px 0 6px;font-size:13px;font-weight:700;color:#7A5D33;border-bottom:1px solid #E8E4DC;">${titulo}</td></tr>
    ${linhas.map(([rotulo, valor]) => `
    <tr>
      <td style="padding:8px 12px 8px 0;font-size:12.5px;color:#5B6472;width:160px;vertical-align:top;">${rotulo}</td>
      <td style="padding:8px 0;font-size:14px;color:#1B263B;line-height:1.5;">${valor}</td>
    </tr>`).join('')}`).join('');
}

const moldura = (miolo: string, rodape: string) => `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #E8E4DC;border-radius:14px;overflow:hidden;background:#fff;">
    <div style="background:#1B263B;padding:24px 32px;">
      <img src="${LOGO_URL}" alt="F&amp;G Seguro Garantia" width="160" style="display:block;border:0;width:160px;height:auto;">
    </div>
    <div style="padding:28px 32px;">${miolo}</div>
    <div style="background:#F5F1EA;padding:14px 32px;border-top:1px solid #E8E4DC;font-size:12px;line-height:1.5;color:#5B6472;">${rodape}</div>
  </div>`;

function emailCliente(f: Ficha, protocolo: string, anexos: Anexo[]): Promise<boolean> {
  const primeiro = f.contato_nome.split(' ')[0];
  const docs = anexos.map((a) => ROTULO_CATEGORIA[a.categoria].split(' ')[0].toLowerCase()).join(', ');
  const resumo = (rotulo: string, valor: string) => `
    <tr><td style="padding:6px 0;font-size:13.5px;color:#5B6472;">${rotulo}</td>
    <td style="padding:6px 0;font-size:14px;color:#1B263B;font-weight:700;text-align:right;">${valor}</td></tr>`;
  const miolo = `
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#1B263B;">Recebemos a sua ficha</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#333D4D;">Olá, ${esc(primeiro)}. Sua ficha de garantia judicial chegou e já está com a nossa equipe. Vamos tratar do seu pedido.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#F5F1EA;border-radius:10px;border-collapse:separate;padding:12px 20px;">
      ${resumo('Protocolo', esc(protocolo))}
      ${resumo('Empresa', esc(f.tomador_razao_social))}
      ${resumo('Processo', esc(f.processo_numero))}
      ${resumo('Recurso', esc(f.recurso))}
      ${resumo('Valor da garantia a cotar', `R$ ${fmtBRL(f.valor_garantia)}`)}
      ${resumo('Documentos recebidos', `${anexos.length} (${esc(docs)})`)}
    </table>
    <h2 style="margin:24px 0 8px;font-size:15.5px;color:#1B263B;">O que acontece agora</h2>
    <ol style="margin:0;padding-left:20px;font-size:14.5px;line-height:1.6;color:#333D4D;">
      <li>Conferimos os dados e os documentos que você enviou.</li>
      <li>Se faltar alguma informação, falamos com você por este e-mail ou pelo celular informado.</li>
      <li>Damos atenção imediata ao seu pedido e retornamos o mais breve possível.</li>
    </ol>
    <p style="margin:20px 0 0;font-size:14.5px;line-height:1.6;color:#333D4D;">Para falar com a gente, responda este e-mail ou chame no WhatsApp ${CONTATO_WHATSAPP}, informando o protocolo.</p>
    <p style="margin:16px 0 0;font-size:14.5px;line-height:1.6;color:#333D4D;">Fábio Lima<br>F&amp;G Seguro Garantia</p>
    <h2 style="margin:28px 0 0;font-size:15.5px;color:#1B263B;">Cópia do que você preencheu</h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${tabelaDaFicha(f)}</table>`;
  return resend({
    to: [f.contato_email],
    reply_to: CONTATO_EMAIL,
    subject: `Recebemos sua ficha de garantia judicial (protocolo ${protocolo})`,
    html: moldura(miolo, 'F&amp;G Corretora de Seguros · CNPJ 56.123.874/0001-90 · SUSEP 242160653<br>Av. Cristal, 107, Água Branca, Boituva/SP'),
  });
}

function emailInterno(f: Ficha, protocolo: string, anexos: Array<Anexo & { url: string }>, agora: { br: string; hora: string }): Promise<boolean> {
  const mb = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
  const lista = anexos.map((a) =>
    `<div style="margin:4px 0;font-size:14px;">${esc(ROTULO_CATEGORIA[a.categoria])}: <a href="${esc(a.url)}" style="color:#7A5D33;font-weight:700;">${esc(a.nome)}</a> <span style="color:#5B6472;font-size:12px;">(${mb(a.tamanho)})</span></div>`).join('');
  const miolo = `
    <h1 style="margin:0 0 6px;font-size:20px;line-height:1.25;color:#1B263B;">Nova ficha de garantia judicial</h1>
    <p style="margin:0 0 16px;font-size:13px;color:#5B6472;">Protocolo <strong style="color:#1B263B;">${esc(protocolo)}</strong>, enviada pelo site em ${agora.br} às ${agora.hora}.</p>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#1B263B;"><strong>${esc(f.tomador_razao_social)}</strong>, garantia a cotar de <strong>R$ ${fmtBRL(f.valor_garantia)}</strong> (${esc(f.recurso)}).</p>
    <p style="margin:0 0 4px;font-size:14px;color:#333D4D;">Contato: ${esc(f.contato_nome)}, <a href="mailto:${esc(f.contato_email)}" style="color:#1B263B;">${esc(f.contato_email)}</a>, <a href="tel:+55${esc(f.contato_telefone)}" style="color:#1B263B;">${esc(fmtTelefone(f.contato_telefone))}</a></p>
    <h2 style="margin:22px 0 6px;font-size:15px;color:#1B263B;">Documentos</h2>
    ${lista}
    <p style="margin:8px 0 0;font-size:12px;color:#5B6472;">Os links valem por 7 dias. Depois disso, abra pelo HUB.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${tabelaDaFicha(f)}</table>
    <p style="margin:22px 0 0;font-size:14px;"><a href="${HUB_URL}" style="color:#7A5D33;font-weight:700;">Abrir o HUB</a></p>`;
  const total = anexos.reduce((s, a) => s + (a.tamanho || 0), 0);
  const anexar = total > 0 && total <= MAX_ANEXO_EMAIL && anexos.every((a) => a.url);
  return resend({
    to: AVISO_PARA,
    reply_to: f.contato_email,
    subject: `Nova ficha judicial: ${f.tomador_razao_social} · R$ ${fmtBRL(f.valor_garantia)} · ${protocolo}`,
    html: moldura(miolo, 'Ficha de Garantia Judicial · judicial.fegsegurogarantia.com'),
    ...(anexar ? { attachments: anexos.map((a) => ({ filename: `${a.categoria}-${a.nome}`, path: a.url })) } : {}),
  });
}

// ── roteador ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cabecalhos = cors(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cabecalhos, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });
  if (req.method !== 'POST') return json({ success: false, error: 'Método não permitido' }, 405);

  try {
    const bruto = await req.text();
    if (bruto.length > 100_000) return json({ success: false, error: 'Envio grande demais.' }, 413);
    let corpo: Record<string, unknown> = {};
    try { corpo = JSON.parse(bruto || '{}'); } catch { return json({ success: false, error: 'Envio inválido.' }, 400); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json({ success: false, error: 'Envio inválido.' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    switch (corpo.acao) {
      case 'preparar': return json({ success: true, ...(await preparar(supabase, req, corpo)) });
      case 'enviar': return json({ success: true, ...(await enviar(supabase, req, corpo)) });
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message, campo: e.campo || undefined }, e.status);
    console.error('[ficha-judicial]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
