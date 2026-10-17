import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SVC    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL      = 'fabio@fegsegurogarantia.com.br';
const BCC_EMAIL       = 'fabio@fegsegurogarantia.com.br';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// ─────────────────────────────────────────────────────────────────────────────
// O CONTEÚDO NÃO MORA MAIS AQUI.
//
// Assunto, título, corpo e botão de cada e-mail ficam nas tabelas
// `email_trilhas` e `email_trilha_etapas` (migração 025). Esta função só sabe
// duas coisas: como é o molde visual da F&G e quando cada e-mail deve sair.
//
// Criar uma modalidade nova = inserir linhas no banco. Sem deploy.
// ─────────────────────────────────────────────────────────────────────────────

/** Atalhos de estilo usados no corpo das etapas, expandidos no envio. */
const P  = 'margin:0 0 20px 0;color:#4A4A4A;font-size:14px;line-height:1.85;font-family:Arial,sans-serif;';
const PF = 'margin:0 0 32px 0;color:#4A4A4A;font-size:14px;line-height:1.85;font-family:Arial,sans-serif;';

const WHATSAPP = 'https://wa.me/5515998618659';

/** Nunca mandar dois e-mails para o mesmo contato com menos dias que isso entre eles. */
const INTERVALO_MINIMO_DIAS = 2;

/**
 * Teto diário de envios usado quando a reputacao_envio não responde ou não
 * traz a coluna. O valor de verdade mora no banco (migração 111) para poder
 * mudar sem deploy; esta constante é só o chão seguro.
 */
const LIMITE_DIARIO_PADRAO = 50;

interface Trilha {
  slug: string;
  nome: string;
  eyebrow: string;
  rodape: string;
}

interface Etapa {
  ordem: number;
  dia: number;
  assunto: string;
  tagline: string | null;
  titulo: string | null;
  corpo_html: string | null;
  cta_texto: string | null;
  cta_link: string | null;
  html_completo: string | null;
}

/**
 * Molde visual da F&G — cabeçalho navy, faixa dourada, corpo branco,
 * assinatura (nome, cargo e a linha "Corretora especialista em Seguro
 * Garantia") e rodapé. É o único lugar do sistema que desenha o e-mail:
 * mexer aqui muda todas as trilhas de uma vez, e nenhuma modalidade
 * consegue destoar visualmente das outras.
 */
function molde(o: {
  eyebrow: string;
  badge: string;
  tagline: string;
  titulo: string;
  corpo: string;
  cta: string | null;
  ctaLink: string;
  rodape: string;
}): string {
  const botao = o.cta
    ? `<table cellpadding="0" cellspacing="0"><tr><td style="background-color:#1B263B;padding:14px 36px;border-radius:2px;"><a href="${o.ctaLink}" style="color:#C69C6D;font-size:12px;font-weight:bold;text-decoration:none;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">${o.cta}</a></td></tr></table>`
    : '';

  const faixaTagline = o.tagline
    ? `<div style="display:inline-block;border-top:1px solid #C69C6D;border-bottom:1px solid #C69C6D;padding:12px 0;margin-bottom:20px;"><span style="color:#C69C6D;font-size:9px;letter-spacing:5px;text-transform:uppercase;font-family:Arial,sans-serif;">${o.tagline}</span></div>`
    : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>F&G Seguro Garantia</title></head><body style="margin:0;padding:0;background-color:#EDEAE4;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EDEAE4;padding:40px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;"><tr><td style="background-color:#C69C6D;height:5px;border-radius:4px 4px 0 0;"></td></tr><tr><td style="background-color:#1B263B;padding:36px 48px 28px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><div style="color:#C69C6D;font-size:10px;letter-spacing:4px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:6px;">${o.eyebrow}</div><div style="color:#FFFFFF;font-size:24px;font-weight:bold;letter-spacing:1px;font-family:Georgia,serif;">F&amp;G Seguro Garantia</div></td><td align="right" style="vertical-align:middle;"><div style="border:1px solid #C69C6D;padding:6px 14px;border-radius:2px;"><span style="color:#C69C6D;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">${o.badge}</span></div></td></tr></table></td></tr><tr><td style="background-color:#243347;padding:48px 48px 40px;text-align:center;">${faixaTagline}<div style="color:#FFFFFF;font-size:28px;font-weight:bold;font-family:Georgia,serif;line-height:1.35;">${o.titulo}</div></td></tr><tr><td style="background-color:#C69C6D;height:1px;"></td></tr><tr><td style="background-color:#FFFFFF;padding:44px 48px;"><p style="margin:0 0 20px 0;color:#1B263B;font-size:16px;line-height:1.75;font-family:Georgia,serif;">Olá, <strong>[NOME_CONTATO]</strong>!</p>${o.corpo}${botao}</td></tr><tr><td style="background-color:#C69C6D;height:1px;"></td></tr><tr><td style="background-color:#1B263B;padding:28px 48px;"><div style="color:#FFFFFF;font-size:15px;font-weight:bold;font-family:Georgia,serif;margin-bottom:4px;">Fábio Lima</div><div style="color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;margin-bottom:8px;">Fundador, F&amp;G Seguro Garantia</div><div style="color:#8FA8C0;font-size:11px;font-family:Arial,sans-serif;margin-bottom:14px;">Corretora especialista em Seguro Garantia</div><a href="tel:+5515998618659" style="color:#8FA8C0;font-size:12px;text-decoration:none;font-family:Arial,sans-serif;display:block;margin-bottom:6px;">📱 (15) 99861-8659</a><a href="https://fegsegurogarantia.com.br" style="color:#8FA8C0;font-size:12px;text-decoration:none;font-family:Arial,sans-serif;display:block;">🌐 fegsegurogarantia.com.br</a></td></tr><tr><td style="background-color:#141E2E;padding:16px 48px;border-radius:0 0 4px 4px;"><p style="margin:0;color:#3D5166;font-size:10px;line-height:1.7;font-family:Arial,sans-serif;text-align:center;">${o.rodape} &nbsp;·&nbsp; <a href="mailto:fabio@fegsegurogarantia.com.br?subject=Descadastrar" style="color:#3D5166;text-decoration:underline;">Descadastrar</a></p></td></tr><tr><td style="background-color:#C69C6D;height:3px;border-radius:0 0 4px 4px;"></td></tr></table></td></tr></table></body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTE A/B: VERSÃO SIMPLES ("cara de e-mail pessoal")
//
// O molde acima tem visual de newsletter (faixas, selo 01/05, título grande,
// botão). Em prospecção fria isso tende a ir para a aba Promoções e a ser
// lido como marketing. A versão simples usa o MESMO texto da etapa, sem
// banner, título nem botão: só parágrafos, um link de WhatsApp em texto e a
// assinatura em texto.
//
// Quem entra no teste: contatos da trilha `garantia` vindos da prospecção
// automática do PNCP (origem `pncp_auto`) criados a partir de AB_INICIO. A
// variante é fixa por contato (último dígito hexadecimal do id: ímpar =
// simples, par = molde), então a pessoa recebe a trilha inteira numa só
// versão. Para medir, compare as respostas recebidas por variante; a regra
// do id permite reconstruir a divisão sem coluna nova no banco.
// ─────────────────────────────────────────────────────────────────────────────

const AB_INICIO = '2026-10-16';
const AB_TRILHA = 'garantia';
const AB_ORIGEM = 'pncp_auto';

type Variante = 'molde' | 'simples';

/** Variante do contato no teste A/B. Fora do teste, sempre 'molde'. */
function varianteDoContato(c: { id: string; trilha?: string | null; origem?: string | null; created_at?: string | null }): Variante {
  if (String(c.trilha ?? 'garantia') !== AB_TRILHA) return 'molde';
  if (c.origem !== AB_ORIGEM) return 'molde';
  const criado = c.created_at
    ? new Date(c.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    : '';
  if (!criado || criado < AB_INICIO) return 'molde';
  const ultimo = parseInt(String(c.id).replace(/-/g, '').slice(-1), 16);
  return Number.isNaN(ultimo) || ultimo % 2 === 0 ? 'molde' : 'simples';
}

const PS = 'margin:0 0 14px 0;color:#222222;font-size:14px;line-height:1.6;font-family:Arial,sans-serif;';

/**
 * Converte o corpo da etapa (feito para o molde) em HTML simples: parágrafos
 * sem cor de marca e tabelas viradas em parágrafos de texto.
 */
function simplificarCorpo(corpo: string): string {
  return corpo
    // Tabela (ex.: comparativo da etapa 4): cada célula vira um parágrafo.
    .replace(/<table[\s\S]*?<\/table>/gi, (tabela) => {
      const celulas = [...tabela.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((m) => m[1]
          .replace(/<\/p>\s*<p[^>]*>/gi, '<br>')
          .replace(/<\/?p[^>]*>/gi, '')
          .trim())
        .filter(Boolean);
      return celulas.map((t) => `<p style="${PS}">${t}</p>`).join('');
    })
    .replace(/<p[^>]*>/gi, `<p style="${PS}">`)
    .replace(/<strong[^>]*>/gi, '<strong>');
}

/** Monta a versão simples. Mesmo conteúdo do molde, sem visual de newsletter. */
function moldeSimples(o: { corpo: string; cta: string | null; ctaLink: string }): string {
  const linhaWhats = o.cta
    ? `<p style="${PS}">Se preferir, me chama no WhatsApp: <a href="${o.ctaLink}" style="color:#1a56b0;">(15) 99861-8659</a></p>`
    : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:16px;background-color:#FFFFFF;">`
    + `<div style="max-width:600px;">`
    + `<p style="${PS}">Olá, [NOME_CONTATO]!</p>`
    + simplificarCorpo(o.corpo)
    + linhaWhats
    + `<p style="margin:20px 0 0 0;color:#222222;font-size:14px;line-height:1.5;font-family:Arial,sans-serif;">Fábio Lima<br>F&amp;G Seguro Garantia<br>(15) 99861-8659 · fegsegurogarantia.com.br</p>`
    + `<p style="margin:24px 0 0 0;color:#888888;font-size:11px;line-height:1.5;font-family:Arial,sans-serif;">Se não quiser mais receber estes e-mails, é só responder com a palavra <a href="mailto:fabio@fegsegurogarantia.com.br?subject=Descadastrar" style="color:#888888;">descadastrar</a>.</p>`
    + `</div></body></html>`;
}

/**
 * Versão em texto simples do e-mail, enviada junto com o HTML. Filtros de
 * spam desconfiam de mensagem só em HTML, e alguns leitores mostram o texto.
 */
function htmlParaTexto(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    // Links lado a lado no HTML (telefone e site na assinatura) viram linhas.
    .replace(/<\/a>\s*<a /gi, '</a>\n<a ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n\n')
    .replace(/<a [^>]*href="(?:tel:|mailto:)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, txt: string) => {
      const t = txt.replace(/<[^>]+>/g, '').trim();
      return t && href.includes(t.replace(/^https?:\/\//, '')) ? t : `${t} (${href})`;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Dois dígitos: 1 -> "01". */
function dd(n: number): string {
  return String(n).padStart(2, '0');
}

/** Troca os placeholders de contato. Vale para assunto e para HTML.
 *  Contato sem cidade cadastrada recebe "sua cidade", para frases como
 *  "regiao de [CIDADE]" nao sairem truncadas. */
function personalizar(texto: string, nome: string, empresa: string, cidade = '', site = ''): string {
  return texto
    .replaceAll('[NOME_CONTATO]', nome)
    .replaceAll('[NOME_EMPRESA]', empresa)
    .replaceAll('[CIDADE]', cidade.trim() || 'sua cidade')
    .replaceAll('[SITE]', site);
}

/**
 * Monta o e-mail final de uma etapa.
 * `total` é a quantidade de etapas ativas da trilha — vira o "02 / 05" do canto.
 */
function montarEmail(
  trilha: Trilha,
  etapa: Etapa,
  total: number,
  nome: string,
  empresa: string,
  cidade = '',
  site = '',
  gancho = '',
  variante: Variante = 'molde',
): { assunto: string; html: string } {
  const assunto = personalizar(etapa.assunto, nome, empresa, cidade, site).replaceAll('[GANCHO_ADESAO]', '');

  // [GANCHO_ADESAO]: paragrafo condicional. Contato com gancho gravado (lead
  // que acabou de aderir, por exemplo) ganha o paragrafo; os demais, nada.
  // Placeholders dentro do gancho ([NOME_EMPRESA]...) sao resolvidos depois,
  // pelo personalizar do HTML final.
  const ganchoHtml = gancho && gancho.trim() ? `<p style="${P}">${gancho.trim()}</p>` : '';

  // Escape hatch: se a etapa trouxer HTML completo, ele manda — o molde é ignorado.
  if (etapa.html_completo && etapa.html_completo.trim()) {
    return { assunto, html: personalizar(etapa.html_completo.replaceAll('[GANCHO_ADESAO]', ganchoHtml), nome, empresa, cidade, site) };
  }

  const corpo = (etapa.corpo_html ?? '')
    .replaceAll('[GANCHO_ADESAO]', ganchoHtml)
    .replaceAll('{{PF}}', PF)
    .replaceAll('{{P}}', P);

  if (variante === 'simples') {
    const simples = moldeSimples({ corpo, cta: etapa.cta_texto, ctaLink: etapa.cta_link || WHATSAPP });
    return { assunto, html: personalizar(simples, nome, empresa, cidade, site) };
  }

  const html = molde({
    eyebrow: trilha.eyebrow,
    badge:   `${dd(etapa.ordem)} / ${dd(total)}`,
    tagline: etapa.tagline ?? '',
    titulo:  etapa.titulo ?? '',
    corpo,
    cta:     etapa.cta_texto,
    ctaLink: etapa.cta_link || WHATSAPP,
    rodape:  trilha.rodape,
  });

  return { assunto, html: personalizar(html, nome, empresa, cidade, site) };
}

/** Carrega uma trilha e suas etapas ativas, em ordem. */
async function carregarTrilha(
  supabase: SupabaseClient,
  slug: string,
): Promise<{ trilha: Trilha; etapas: Etapa[] } | null> {
  const { data: t, error: tErr } = await supabase
    .from('email_trilhas')
    .select('slug, nome, eyebrow, rodape')
    .eq('slug', slug)
    .maybeSingle();
  // Erro de leitura nao pode virar "trilha nao encontrada": o chamador
  // trataria como cadastro faltando e o contato seria pulado sem registro.
  if (tErr) throw new Error(`Falha ao ler a trilha "${slug}": ${tErr.message}`);
  if (!t) return null;

  const { data: etapas, error: eErr } = await supabase
    .from('email_trilha_etapas')
    .select('ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link, html_completo')
    .eq('trilha', slug)
    .eq('ativo', true)
    .order('ordem');
  if (eErr) throw new Error(`Falha ao ler as etapas da trilha "${slug}": ${eErr.message}`);

  return { trilha: t as Trilha, etapas: (etapas ?? []) as Etapa[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// E-MAIL DA LICITAÇÃO: o 1º contato dos leads do PNCP, enviado à mão.
//
// Os leads da prospecção automática do PNCP não recebem mais o E1 genérico no
// instante em que entram. O Fábio abre a prévia no card do Kanban, confere os
// dados daquela licitação, ajusta destinatário e texto e envia. Esse envio
// CONTA como o E1 da trilha `garantia` (ordem 1 em email_envios), e a trilha
// segue sozinha a partir do E2 (dia 3), pelo cron de sempre.
//
// O conteúdo mora na trilha `licitacao` (migração 109), que nasceu com
// ativo = false justamente para o cron não varrê-la: quem dispara é a tela,
// pelos modos `licitacao_preview` e `licitacao_enviar`.
// ─────────────────────────────────────────────────────────────────────────────

/** Placeholders próprios da trilha `licitacao`, lidos das colunas do prospect. */
const CHAVES_LICITACAO = [
  'ORGAO', 'OBJETO', 'OBJETO_CURTO', 'VALOR', 'NUMERO_LICITACAO', 'DATA_HOMOLOGACAO',
] as const;

function escaparHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA'. Sem new Date(): o fuso viraria o dia. */
function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * timestamptz -> 'DD/MM/AAAA' em BRT. O enviado_em é gravado em UTC, e um
 * envio das 21h59 de São Paulo cai no dia seguinte em UTC: formatar a string
 * crua mostraria a data errada para quem está no Brasil.
 */
function dataBrDeTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return dataBr(String(ts).slice(0, 10));
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Dia e mês de hoje em BRT, para a linha gravada na observação do lead. */
function diaMesBRT(): string {
  const [ano, mes, dia] = todayBRT().split('-');
  return `${dia}/${mes}`;
}

/** 'DD/MM/AAAA HH:MM' em BRT — o formato do histórico de observações do Kanban. */
function timestampObservacao(): string {
  const agora = new Date();
  const d = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const h = agora.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  });
  return `${d} ${h}`;
}

/**
 * Objeto encurtado para o assunto: até `max` caracteres, cortando na última
 * palavra inteira. Objeto do PNCP costuma ter 300 caracteres e não cabe na
 * linha de assunto de nenhum cliente de e-mail.
 */
function objetoCurto(objeto: string, max = 60): string {
  const limpo = objeto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= max) return limpo;
  const corte = limpo.slice(0, max);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return (ultimoEspaco > max * 0.5 ? corte.slice(0, ultimoEspaco) : corte).replace(/[\s,;.:-]+$/, '');
}

/** Dados da licitação de um lead, já formatados para texto. */
function dadosLicitacao(p: Record<string, unknown>): Record<string, string> {
  const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  // O objeto entra no meio da frase ("para [OBJETO], no valor de ..."), e o
  // objeto do PNCP quase sempre termina em ponto. Sem tirar, sai ".,".
  const objeto = texto(p.objeto_contrato).replace(/[\s.;,:]+$/, '');
  const valorNum = Number(p.valor_contrato ?? 0);
  return {
    ORGAO:            texto(p.orgao_licitante),
    OBJETO:           objeto,
    OBJETO_CURTO:     objetoCurto(objeto),
    // Valor ausente ou zerado conta como vazio: a decisão é não escrever
    // "R$ 0,00" para um cliente.
    VALOR:            Number.isFinite(valorNum) && valorNum > 0 ? brl(valorNum) : '',
    NUMERO_LICITACAO: texto(p.numero_licitacao),
    DATA_HOMOLOGACAO: dataBr(texto(p.data_homologacao)),
  };
}

/**
 * Troca os placeholders da licitação.
 *
 * `{{? ... }}` marca um trecho condicional: se algum placeholder dentro dele
 * estiver vazio, o trecho inteiro cai. É o que impede a frase de sair com
 * "no valor de R$ 0,00" ou com [VALOR] cru. Placeholder vazio que esteja
 * FORA de um trecho condicional sai como vazio, nunca cru.
 *
 * `html` liga o escape: órgão e objeto vêm do PNCP em texto livre e trazem
 * "&" e "<" com frequência.
 */
function resolverLicitacao(texto: string, dados: Record<string, string>, html: boolean): string {
  const vazio = (chave: string) => !(dados[chave] ?? '').trim();
  const trechoTemVazio = (trecho: string) =>
    CHAVES_LICITACAO.some((k) => trecho.includes(`[${k}]`) && vazio(k));

  let saida = texto.replace(/\{\{\?([\s\S]*?)\}\}/g, (_m, dentro: string) =>
    trechoTemVazio(dentro) ? '' : dentro);

  for (const k of CHAVES_LICITACAO) {
    const valor = dados[k] ?? '';
    saida = saida.replaceAll(`[${k}]`, html ? escaparHtml(valor) : valor);
  }
  return saida;
}

/**
 * Corpo editado na tela chega como texto puro, um parágrafo por linha em
 * branco. Vira HTML escapado nos mesmos parágrafos do molde.
 */
function textoParaHtml(texto: string): string {
  const paragrafos = texto.replace(/\r\n/g, '\n').split(/\n\s*\n/)
    .map((p) => p.trim()).filter(Boolean);
  if (!paragrafos.length) return '';
  return paragrafos
    .map((p, i) => {
      const estilo = i === paragrafos.length - 1 ? '{{PF}}' : '{{P}}';
      return `<p style="${estilo}">${escaparHtml(p).replaceAll('\n', '<br>')}</p>`;
    })
    .join('\n');
}

/**
 * Caminho de volta: o corpo em HTML vira texto puro para a textarea da tela,
 * um parágrafo por linha em branco. O que o Fábio editar ali volta por
 * textoParaHtml, que escapa de novo.
 */
function corpoParaTexto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    // O &amp; sai por último, senão "&amp;lt;" viraria "<".
    .replaceAll('&amp;', '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Listas de classificação de e-mail da prospecção, para os avisos da prévia. */
interface ConfigAvisos {
  contador: string[];
  genericos: string[];
  gratuitos: string[];
}

async function carregarConfigAvisos(supabase: SupabaseClient): Promise<ConfigAvisos> {
  const { data } = await supabase.from('prospeccao_pncp_config')
    .select('email_padroes_contador, email_prefixos_genericos, email_provedores_gratuitos')
    .eq('id', 1).maybeSingle();
  return {
    contador:  (data?.email_padroes_contador ?? []) as string[],
    genericos: (data?.email_prefixos_genericos ?? []) as string[],
    gratuitos: (data?.email_provedores_gratuitos ?? []) as string[],
  };
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Avisos mostrados acima do botão Enviar. Não bloqueiam: a decisão de mandar
 * para a caixa do contador ou para um gmail é do Fábio, caso a caso. A mesma
 * classificação que a prospecção usa no relatório diário.
 */
function avisosDoEnvio(
  email: string,
  dados: Record<string, string>,
  cfg: ConfigAvisos,
): string[] {
  const avisos: string[] = [];
  const e = email.toLowerCase().trim();
  const [prefixo, dominio] = e.includes('@') ? e.split('@') : ['', ''];

  if (cfg.contador.some((t) => {
    const p = t.toLowerCase().trim();
    return p && (prefixo.includes(p) || dominio.includes(p));
  })) {
    avisos.push('Parece e-mail de contabilidade: quem lê pode não ser quem decide na empresa.');
  } else if (cfg.genericos.some((t) => {
    const p = t.toLowerCase().trim();
    return p && prefixo.startsWith(p);
  })) {
    avisos.push('Parece caixa de setor (fiscal, jurídico), não de uma pessoa.');
  } else if (cfg.gratuitos.some((t) => {
    const p = t.toLowerCase().trim();
    // Domínio exato: 'includes' faria gmail.com casar com naoegmail.com.br.
    return p && dominio === p;
  })) {
    avisos.push('E-mail de provedor gratuito (gmail, hotmail e afins), não o domínio da empresa.');
  }

  const faltando: string[] = [];
  if (!dados.NUMERO_LICITACAO) faltando.push('número da licitação');
  if (!dados.ORGAO)            faltando.push('órgão');
  if (!dados.OBJETO)           faltando.push('objeto');
  if (!dados.VALOR)            faltando.push('valor');
  if (faltando.length) {
    avisos.push(`Sem ${faltando.join(', ')} no cadastro do lead: a frase sai sem essa parte.`);
  }
  return avisos;
}

/** Primeiro nome, para o "Olá, Fulano!" não virar o nome completo em caixa alta. */
function primeiroNome(nome: string): string {
  const limpo = (nome || '').trim().split(/\s+/)[0] ?? '';
  if (!limpo) return '';
  return limpo.length > 2 && limpo === limpo.toUpperCase()
    ? limpo.charAt(0) + limpo.slice(1).toLowerCase()
    : limpo;
}

interface MontagemLicitacao {
  assunto: string;
  html: string;
  corpoTexto: string;
  para: string;
  nomeContato: string;
  avisos: string[];
  variante: Variante;
  prospect: Record<string, unknown>;
  contato: Record<string, unknown> | null;
}

/**
 * Monta o e-mail da licitação de um lead. Usada pelos dois modos, para a
 * prévia mostrar exatamente o que o envio manda.
 *
 * O `contato` pode não existir ainda (lead manual antigo, sem linha em
 * email_cadencia): a montagem funciona, e quem cria a linha é o envio.
 */
async function montarEmailLicitacao(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ erro: string; status: number } | MontagemLicitacao> {
  const prospectId = String(body.prospect_id ?? '').trim();
  if (!prospectId) return { erro: 'prospect_id é obrigatório', status: 400 };

  const { data: p, error: pErr } = await supabase.from('prospects')
    .select('id, name, company, email, decisor, source, description, orgao_licitante, objeto_contrato, valor_contrato, numero_licitacao, data_homologacao')
    .eq('id', prospectId).maybeSingle();
  if (pErr) return { erro: `Falha ao ler o lead: ${pErr.message}`, status: 500 };
  if (!p)   return { erro: 'Lead não encontrado', status: 404 };

  const carregada = await carregarTrilha(supabase, 'licitacao');
  if (!carregada) return { erro: 'Trilha "licitacao" não encontrada. Rode a migração 109.', status: 404 };
  const { trilha, etapas } = carregada;
  const etapa = etapas.find((e) => e.ordem === 1);
  if (!etapa) return { erro: 'A trilha "licitacao" não tem a etapa 1 ativa', status: 400 };

  const { data: contato } = await supabase.from('email_cadencia')
    .select('id, nome_contato, nome_empresa, email, trilha, origem, created_at, ativo, data_inicio')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle();

  const para = String(
    body.email ?? contato?.email ?? p.email ?? '',
  ).trim();
  const nomeContato = String(
    body.nome_contato ?? contato?.nome_contato ?? primeiroNome(String(p.decisor ?? p.name ?? '')) ?? '',
  ).trim();
  const nomeEmpresa = String(contato?.nome_empresa ?? p.company ?? p.name ?? '').trim();

  const dados = dadosLicitacao(p as Record<string, unknown>);

  // Assunto e corpo vindos da tela já estão editados; sem eles, valem os da
  // etapa, com os placeholders da licitação resolvidos.
  //
  // O texto editado também passa pelo resolvedor: se o Fábio digitar
  // [VALOR] ou {{? ... }} à mão, funciona igual, e nada sai cru. A ordem é
  // escapar primeiro e resolver depois — os colchetes e as chaves atravessam
  // o escape intactos, e assim o valor é escapado uma vez só.
  const assunto = resolverLicitacao(
    body.assunto !== undefined && String(body.assunto).trim()
      ? String(body.assunto)
      : etapa.assunto,
    dados, false);

  const corpo = resolverLicitacao(
    body.corpo !== undefined && String(body.corpo).trim()
      ? textoParaHtml(String(body.corpo))
      : (etapa.corpo_html ?? ''),
    dados, true);

  // Este e-mail sai no molde navy/dourado, como os demais da casa. A variante
  // simples do teste A/B continua valendo só para o que o cron manda (E2 em
  // diante): aqui o texto é conferido e ajustado à mão, lead por lead.
  const variante: Variante = body.variante === 'simples' ? 'simples' : 'molde';

  const montado = montarEmail(
    trilha,
    { ...etapa, assunto, corpo_html: corpo },
    etapas.length,
    nomeContato || nomeEmpresa,
    nomeEmpresa,
    '', '', '',
    variante,
  );

  const cfg = await carregarConfigAvisos(supabase);
  const avisos = avisosDoEnvio(para, dados, cfg);
  // Quem já está no braço "simples" do A/B recebeu o aviso: o E1 vai no molde
  // e os seguintes, não. Visível na prévia para a decisão ser consciente.
  if (variante === 'molde' && varianteDoContato({
    id: String(contato?.id ?? ''),
    trilha: String(contato?.trilha ?? 'garantia'),
    origem: String(contato?.origem ?? ''),
    created_at: contato?.created_at ? String(contato.created_at) : null,
  }) === 'simples') {
    avisos.push('Este lead está no braço "versão simples" do teste A/B: os e-mails seguintes da trilha sairão sem o layout de newsletter.');
  }

  return {
    ...montado,
    // Texto puro do corpo, com os dados já trocados: é o que a tela abre na
    // textarea para o Fábio ajustar.
    corpoTexto: corpoParaTexto(personalizar(corpo, nomeContato || nomeEmpresa, nomeEmpresa)),
    para,
    nomeContato,
    avisos,
    variante,
    prospect: p as Record<string, unknown>,
    contato: (contato ?? null) as Record<string, unknown> | null,
  };
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `F&G Seguro Garantia <${FROM_EMAIL}>`, to: [to], bcc: [BCC_EMAIL], subject, html,
        // Versão em texto junto com o HTML: filtros de spam desconfiam de e-mail só em HTML.
        text: htmlParaTexto(html),
        // Descadastro no cabeçalho: o Gmail e outros mostram o "cancelar inscrição" nativo.
        headers: { 'List-Unsubscribe': `<mailto:${FROM_EMAIL}?subject=Descadastrar>` },
      }),
    });
    if (!r.ok) console.error('Resend:', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error(e); return false; }
}

function todayBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Diferença em dias inteiros entre duas datas 'YYYY-MM-DD'. */
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000);
}

/**
 * Registra o envio. Grava sempre em `email_envios` (sem limite de etapas) e,
 * enquanto a ordem for de 1 a 5, também nas colunas antigas email_N_sent —
 * assim as telas que ainda leem essas colunas continuam funcionando.
 *
 * Devolve null quando gravou, ou a mensagem de erro. O e-mail JA SAIU quando
 * isto roda: se a gravacao falhar, o cron acha a etapa pendente no dia
 * seguinte e reenvia. Por isso tenta duas vezes e o chamador avisa o Fabio.
 */
async function registrarEnvio(supabase: SupabaseClient, contatoId: string, ordem: number): Promise<string | null> {
  const agora = new Date().toISOString();
  const gravar = async (): Promise<string | null> => {
    const { error: e1 } = await supabase.from('email_envios')
      .upsert({ contato_id: contatoId, ordem, enviado_em: agora }, { onConflict: 'contato_id,ordem' });
    if (e1) return `email_envios: ${e1.message}`;
    if (ordem >= 1 && ordem <= 5) {
      const { error: e2 } = await supabase.from('email_cadencia').update({
        [`email_${ordem}_sent`]: true,
        [`email_${ordem}_sent_at`]: agora,
      }).eq('id', contatoId);
      if (e2) return `email_cadencia: ${e2.message}`;
    }
    return null;
  };
  let erro = await gravar();
  if (erro) {
    await new Promise(r => setTimeout(r, 1000));
    erro = await gravar();
  }
  if (erro) console.error(`[cadencia] E${ordem} enviado para o contato ${contatoId} mas NAO registrado: ${erro}`);
  return erro;
}

/**
 * Envios ja feitos, lidos em lotes.
 *
 * Antes era um `.in('contato_id', [...])` com o id de TODO contato elegivel.
 * Com 718 contatos isso virava uma query string de ~27 KB, acima do limite de
 * URL do PostgREST, que respondia 400 — e o `abortar()` derrubava a rodada.
 * O cron abortou assim todo dia util de 05/10 a 16/10/2026, 12 dias, sem
 * mandar nenhum e-mail e sem ninguem notar, porque a falha so aparecia na
 * tabela de execucoes.
 *
 * 100 ids por lote dao ~4 KB de query string, com folga larga. Erro em
 * qualquer lote estoura para o chamador: lista parcial faria o cron achar que
 * a etapa nunca foi enviada e reenviar.
 */
const LOTE_LEITURA_ENVIOS = 100;

async function lerEnviosEmLotes(
  supabase: SupabaseClient,
  contatoIds: string[],
): Promise<{ contato_id: string; ordem: number; enviado_em: string }[]> {
  const todos: { contato_id: string; ordem: number; enviado_em: string }[] = [];
  for (let i = 0; i < contatoIds.length; i += LOTE_LEITURA_ENVIOS) {
    const lote = contatoIds.slice(i, i + LOTE_LEITURA_ENVIOS);
    const { data, error } = await supabase
      .from('email_envios')
      .select('contato_id, ordem, enviado_em')
      .in('contato_id', lote);
    if (error) throw new Error(`lote ${i / LOTE_LEITURA_ENVIOS + 1}: ${error.message}`);
    todos.push(...(data ?? []) as typeof todos);
  }
  return todos;
}

/** Instante do inicio do dia de hoje em BRT, em ISO, para contar o que ja saiu. */
function inicioDoDiaBRT(): string {
  const [ano, mes, dia] = todayBRT().split('-').map(Number);
  // BRT e UTC-3 o ano todo desde 2019 (nao ha mais horario de verao).
  return new Date(Date.UTC(ano, mes - 1, dia, 3, 0, 0)).toISOString();
}

interface EnvioSemRegistro { contatoId: string; email: string; ordem: number; erro: string; }

interface ResumoExecucao {
  contatos_elegiveis?: number; enviados?: number; erros?: number; sem_registro?: number;
  abortada?: boolean; detalhes?: Record<string, unknown>;
}

/** Quantos e-mails a cadencia ja gravou hoje, para o teto valer entre rodadas. */
async function envioHojeContados(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('email_envios')
    .select('contato_id', { count: 'exact', head: true })
    .gte('enviado_em', inicioDoDiaBRT());
  if (error) throw new Error(`Falha ao contar os envios de hoje: ${error.message}`);
  return count ?? 0;
}

/**
 * Registro da rodada do cron em email_cadencia_execucoes (migracao 068).
 * Antes os contadores morriam na resposta HTTP, que o cron descarta.
 */
async function registrarExecucao(supabase: SupabaseClient, r: ResumoExecucao): Promise<void> {
  const { error } = await supabase.from('email_cadencia_execucoes').insert({
    contatos_elegiveis: r.contatos_elegiveis ?? 0,
    enviados: r.enviados ?? 0,
    erros: r.erros ?? 0,
    sem_registro: r.sem_registro ?? 0,
    abortada: r.abortada ?? false,
    detalhes: r.detalhes ?? null,
  });
  if (error) console.error('[cadencia] falha ao registrar a execucao:', error.message);
}

/**
 * E-mail curto para o Fabio quando um envio saiu mas nao foi registrado.
 * A cadencia nao tem tabela de execucao; sem este aviso o caso ficaria
 * invisivel e o contato receberia a mesma etapa de novo amanha.
 */
async function avisarEnvioSemRegistro(casos: EnvioSemRegistro[]): Promise<void> {
  if (!casos.length) return;
  const linhas = casos.map(c =>
    `<li><b>${c.email}</b> (contato ${c.contatoId}), etapa ${c.ordem}: ${c.erro}</li>`).join('');
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#1B263B;max-width:560px">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#C69C6D;margin:0 0 6px">Trilhas de e-mail</p>
      <h2 style="font-size:18px;margin:0 0 14px">${casos.length} e-mail(s) enviados sem registro</h2>
      <p style="font-size:14px;line-height:1.6">O Resend aceitou o envio, mas a gravacao em <code>email_envios</code> falhou duas vezes.
      Sem o registro, o cron de amanha vai considerar a etapa pendente e reenviar o mesmo e-mail.
      Para evitar a duplicata, insira a linha em <code>email_envios</code> (contato_id, ordem, enviado_em) ou desative o contato.</p>
      <ul style="font-size:13px;line-height:1.7">${linhas}</ul>
    </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `F&G Seguro Garantia <${FROM_EMAIL}>`,
        to: [FROM_EMAIL],
        subject: `Cadencia: ${casos.length} e-mail(s) enviados sem registro`,
        html,
      }),
    });
    if (!r.ok) console.error('[cadencia] aviso de envio sem registro falhou:', r.status, await r.text());
  } catch (e) {
    console.error('[cadencia] aviso de envio sem registro falhou:', e);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

    // ── MODO PREVIEW: devolve o HTML montado sem enviar nada.
    // Usado pela tela de trilhas do hub para mostrar o e-mail antes de salvar.
    if (body.modo === 'preview' || body.modo === 'teste') {
      const slug = String(body.trilha ?? 'garantia');
      const carregada = await carregarTrilha(supabase, slug);
      if (!carregada) return json({ success: false, error: `Trilha "${slug}" não encontrada` }, 404);

      const { trilha, etapas } = carregada;
      if (!etapas.length) return json({ success: false, error: `Trilha "${slug}" não tem etapas ativas` }, 400);

      const nome    = String(body.nome_contato ?? 'Fábio');
      const empresa = String(body.nome_empresa ?? 'Empresa Exemplo');
      const cidadePrev = String(body.cidade ?? '');
      const sitePrev   = String(body.site ?? '');
      const ganchoPrev = String(body.gancho_adesao ?? '');
      // Prévia/teste da versão simples do A/B: { variante: 'simples' }.
      const variantePrev: Variante = body.variante === 'simples' ? 'simples' : 'molde';
      const ordem   = body.ordem ? Number(body.ordem) : null;
      const alvo    = ordem ? etapas.filter(e => e.ordem === ordem) : etapas;
      if (!alvo.length) return json({ success: false, error: `Etapa ${ordem} não existe ou está inativa` }, 404);

      const montados = alvo.map(e => ({
        ordem: e.ordem,
        dia: e.dia,
        ...montarEmail(trilha, e, etapas.length, nome, empresa, cidadePrev, sitePrev, ganchoPrev, variantePrev),
      }));

      if (body.modo === 'preview') {
        return json({ success: true, trilha: trilha.slug, total: etapas.length, emails: montados });
      }

      // MODO TESTE: envia de verdade, mas para um endereço escolhido.
      const para = String(body.email ?? BCC_EMAIL);
      let enviados = 0;
      for (const m of montados) {
        const ok = await sendEmail(para, `[TESTE ${m.ordem}] ${m.assunto}`, m.html);
        if (ok) enviados++;
        await new Promise(r => setTimeout(r, 500));
      }
      return json({ success: true, trilha: trilha.slug, enviados, para });
    }

    // ── MODO PRÉVIA DA LICITAÇÃO: monta e devolve, sem enviar nada.
    // Nada sai desta função sem o clique em Enviar na tela.
    if (body.modo === 'licitacao_preview') {
      const m = await montarEmailLicitacao(supabase, body);
      if ('erro' in m) return json({ success: false, error: m.erro }, m.status);
      return json({
        success: true,
        assunto: m.assunto,
        html: m.html,
        corpo_texto: m.corpoTexto,
        para: m.para,
        nome_contato: m.nomeContato,
        avisos: m.avisos,
        variante: m.variante,
      });
    }

    // ── MODO ENVIO DA LICITAÇÃO: envia e abre a trilha `garantia` no E1.
    //
    // A ordem importa. Primeiro as recusas (formato, blocklist, trilha já
    // iniciada), depois o envio, e só com o envio aceito as gravações. Se a
    // ordem fosse outra, um erro no meio deixaria o contato marcado como
    // contatado sem que o e-mail tenha saído, e o E2 sairia no lugar do E1.
    if (body.modo === 'licitacao_enviar') {
      const para = String(body.email ?? '').trim();
      if (!RE_EMAIL.test(para)) {
        return json({ success: false, error: `E-mail com formato inválido: ${para || '(vazio)'}` }, 422);
      }

      // Blocklist: endereço que já deu bounce ou reclamou de spam não recebe
      // de novo, nem por envio manual. Comparação em memória e sem distinção
      // de caixa — a tabela é pequena e `ilike` trataria o "_" do endereço
      // como curinga.
      const { data: bloqueados, error: bErr } = await supabase
        .from('email_blocklist').select('email, motivo');
      if (bErr) return json({ success: false, error: `Falha ao ler a blocklist: ${bErr.message}` }, 500);
      const bloqueio = (bloqueados ?? []).find(
        (b) => String(b.email ?? '').trim().toLowerCase() === para.toLowerCase());
      if (bloqueio) {
        const motivo = String(bloqueio.motivo ?? '').trim();
        return json({
          success: false,
          error: `${para} está na lista de bloqueio${motivo ? `: ${motivo}` : ''}. Não enviei.`,
        }, 422);
      }

      const m = await montarEmailLicitacao(supabase, body);
      if ('erro' in m) return json({ success: false, error: m.erro }, m.status);

      const prospectId  = String(m.prospect.id);
      const emailAntigo = String(m.prospect.email ?? '').trim();
      const nomeContato = m.nomeContato || String(m.prospect.company ?? '').trim();
      const nomeEmpresa = String(m.contato?.nome_empresa ?? m.prospect.company ?? m.prospect.name ?? '').trim();
      const hoje = todayBRT();

      // Lead manual antigo não tem linha na cadência: cria agora, já na
      // trilha `garantia`, que é a que segue do E2 em diante. ativo = false
      // até o envio dar certo, para o cron não achar a etapa 1 pendente caso
      // o Resend recuse.
      let contatoId = m.contato ? String(m.contato.id) : '';
      if (!contatoId) {
        const { data: novo, error: cErr } = await supabase.from('email_cadencia').insert({
          nome_contato: nomeContato || nomeEmpresa,
          nome_empresa: nomeEmpresa,
          email: para,
          origem: 'pncp_auto',
          trilha: 'garantia',
          data_inicio: hoje,
          ativo: false,
          prospect_id: prospectId,
        }).select('id').single();
        if (cErr || !novo) {
          return json({ success: false, error: `Falha ao criar o contato na trilha: ${cErr?.message ?? 'insert sem retorno'}` }, 500);
        }
        contatoId = String(novo.id);
      }

      // Trava contra o segundo clique e contra duas abas abertas no mesmo
      // lead: a ordem 1 em email_envios é o registro de que a trilha começou.
      const { data: jaEnviado, error: eErr } = await supabase.from('email_envios')
        .select('enviado_em').eq('contato_id', contatoId).eq('ordem', 1).maybeSingle();
      if (eErr) return json({ success: false, error: `Falha ao checar os envios: ${eErr.message}` }, 500);
      if (jaEnviado) {
        return json({
          success: false,
          error: `Trilha já iniciada em ${dataBrDeTimestamp(String(jaEnviado.enviado_em))}. O primeiro e-mail deste lead já saiu.`,
          trilha_iniciada_em: jaEnviado.enviado_em,
        }, 409);
      }

      const ok = await sendEmail(para, m.assunto, m.html);
      if (!ok) {
        return json({ success: false, error: 'O Resend recusou o envio. Nada foi gravado; tente de novo.' }, 502);
      }

      // Daqui para baixo o e-mail JÁ SAIU. Cada falha de gravação é relatada,
      // mas nenhuma pode virar success:false: a tela mostraria erro e o Fábio
      // clicaria outra vez, enviando o mesmo e-mail duas vezes.
      const problemas: string[] = [];

      const { error: upCadErr } = await supabase.from('email_cadencia').update({
        email: para,
        nome_contato: nomeContato || nomeEmpresa,
        ativo: true,
        data_inicio: hoje,
      }).eq('id', contatoId);
      if (upCadErr) problemas.push(`email_cadencia: ${upCadErr.message}`);

      const erroRegistro = await registrarEnvio(supabase, contatoId, 1);
      if (erroRegistro) {
        problemas.push(erroRegistro);
        await avisarEnvioSemRegistro([{ contatoId, email: para, ordem: 1, erro: erroRegistro }]);
      }

      const trocouEmail = !!emailAntigo && emailAntigo.toLowerCase() !== para.toLowerCase();
      const campos: Record<string, unknown> = {};
      if (emailAntigo.toLowerCase() !== para.toLowerCase()) campos.email = para;

      // A linha fica no histórico de observações do lead, no formato que o
      // Kanban lê ([DD/MM/AAAA HH:MM] texto).
      const linhas = [`E-mail da licitação enviado em ${diaMesBRT()} para ${para}`];
      if (trocouEmail) linhas.push(`E-mail anterior: ${emailAntigo}`);
      const nota = `[${timestampObservacao()}] ${linhas.join('\n')}`;
      const descricaoAtual = String(m.prospect.description ?? '').trim();
      campos.description = descricaoAtual ? `${descricaoAtual}\n${nota}` : nota;

      const { error: upProsErr } = await supabase.from('prospects')
        .update(campos).eq('id', prospectId);
      if (upProsErr) problemas.push(`prospects: ${upProsErr.message}`);

      console.log(`[cadencia/licitacao] ✅ E1 manual -> ${para} (lead ${prospectId})`);

      return json({
        success: true,
        para,
        contato_id: contatoId,
        data_inicio: hoje,
        email_trocado: trocouEmail ? emailAntigo : null,
        problemas: problemas.length ? problemas : undefined,
      });
    }

    // ── MODO IMEDIATO: dispara a primeira etapa agora, para um contato recém-criado.
    if (body.contact_id) {
      const { data: c } = await supabase
        .from('email_cadencia')
        .select('id, nome_contato, nome_empresa, email, email_1_sent, trilha, cidade, site, gancho_adesao, origem, created_at')
        .eq('id', body.contact_id)
        .single();

      if (!c) return json({ success: false, error: 'Contato não encontrado' }, 404);
      if (c.email_1_sent) return json({ success: true, skipped: 'email_1_ja_enviado' });

      const slug = String((c as any).trilha ?? 'garantia');
      const carregada = await carregarTrilha(supabase, slug);
      if (!carregada || !carregada.etapas.length) {
        return json({ success: false, error: `Trilha "${slug}" sem etapas ativas` }, 400);
      }

      const { trilha, etapas } = carregada;
      const primeira = etapas[0];
      const variante = varianteDoContato(c as any);
      const { assunto, html } = montarEmail(
        trilha, primeira, etapas.length, c.nome_contato, c.nome_empresa,
        String((c as any).cidade ?? ''), String((c as any).site ?? ''),
        String((c as any).gancho_adesao ?? ''), variante,
      );
      const ok = await sendEmail(c.email, assunto, html);
      if (ok) {
        const erroRegistro = await registrarEnvio(supabase, c.id, primeira.ordem);
        console.log(`[cadencia/${slug}] ✅ E${primeira.ordem} imediato (${variante}) -> ${c.email}`);
        if (erroRegistro) {
          // O e-mail saiu: responder success:false faria o chamador marcar
          // falha de envio e a etapa 1 sairia de novo amanha.
          await avisarEnvioSemRegistro([{ contatoId: c.id, email: c.email, ordem: primeira.ordem, erro: erroRegistro }]);
          return json({ success: true, email: c.email, trilha: slug, registro_falhou: erroRegistro });
        }
      }
      return json({ success: ok, email: c.email, trilha: slug });
    }

    // ── MODO CRON: um e-mail por contato por execução.
    // Para cada contato ativo, procura a primeira etapa ainda não enviada cujo
    // dia já venceu. O limite de um envio por rodada é proposital: se o cron
    // falhar por três dias, ninguém recebe três e-mails de uma vez.
    const today = todayBRT();

    // Teto diário de volume, lido da reputacao_envio na trava de pausa abaixo.
    // Sem ele a rodada manda uma etapa para CADA contato com etapa vencida —
    // hoje 723 de uma vez, 6x o pico histórico do domínio.
    let limiteDiario = LIMITE_DIARIO_PADRAO;

    // Sábado e domingo não sai prospecção: chega para acumular, ninguém na
    // construtora lê, e caixa sem engajamento piora a reputação do domínio.
    // As etapas não se perdem — a trilha compara o dia devido com a data de
    // entrada do contato, então na segunda a etapa vencida sai normalmente.
    // Vale só para o cron; envio manual pelo hub segue livre.
    {
      const diaSemana = new Date().toLocaleDateString('en-US', {
        timeZone: 'America/Sao_Paulo', weekday: 'short',
      });
      if (diaSemana === 'Sat' || diaSemana === 'Sun') {
        console.log(`[cadencia] ${diaSemana}: fim de semana, nenhum envio`);
        await registrarExecucao(supabase, {
          abortada: true, detalhes: { fim_de_semana: true, dia: diaSemana },
        });
        return json({ success: true, fim_de_semana: true, enviados: 0 });
      }
    }

    // Pausa GLOBAL de reputação do domínio. Vale só para o cron: prospecção
    // fria automática precisa parar quando o domínio está em risco.
    //
    // Antes esta função não consultava a trava, e a pausa ficava pela metade —
    // segurava lead novo em prospeccao-pncp e garimpo, mas os e-mails 2 a 5 das
    // trilhas seguiam saindo e continuavam acumulando bounce. O modo imediato e
    // o preview seguem livres de propósito: ali é decisão de uma pessoa, não
    // automação rodando sozinha.
    {
      const { data: rep } = await supabase
        .from('reputacao_envio')
        .select('pausado, pausado_motivo, limite_diario_envios').limit(1).maybeSingle();
      limiteDiario = Number(rep?.limite_diario_envios ?? LIMITE_DIARIO_PADRAO);
      if (rep?.pausado) {
        const motivo = String(rep.pausado_motivo ?? 'sem motivo registrado');
        console.log(`[cadencia] pausada pela reputacao global do dominio: ${motivo}`);
        await registrarExecucao(supabase, {
          abortada: true,
          detalhes: { pausado_por_reputacao: true, motivo },
        });
        return json({ success: true, pausado: true, motivo, enviados: 0 });
      }
    }

    // Todas as trilhas ativas, carregadas de uma vez.
    // Qualquer erro de leitura aborta a rodada com 500. Tratar como lista
    // vazia responderia "0 enviados, 0 erros" com a trilha quebrada.
    const { data: trilhasRaw, error: errTrilhas } = await supabase
      .from('email_trilhas')
      .select('slug, nome, eyebrow, rodape')
      .eq('ativo', true);
    // Aborto registrado na tabela de execucoes antes do 500.
    const abortar = async (erro: string) => {
      await registrarExecucao(supabase, { abortada: true, detalhes: { erro } });
      return json({ success: false, error: erro }, 500);
    };
    if (errTrilhas) return abortar(`Falha ao ler as trilhas: ${errTrilhas.message}`);

    const { data: etapasRaw, error: errEtapas } = await supabase
      .from('email_trilha_etapas')
      .select('trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link, html_completo')
      .eq('ativo', true)
      .order('ordem');
    if (errEtapas) return abortar(`Falha ao ler as etapas: ${errEtapas.message}`);

    const trilhas = new Map<string, Trilha>();
    for (const t of (trilhasRaw ?? [])) trilhas.set(t.slug, t as Trilha);

    const etapasPorTrilha = new Map<string, Etapa[]>();
    let maiorDia = 0;
    for (const e of (etapasRaw ?? [])) {
      const lista = etapasPorTrilha.get((e as any).trilha) ?? [];
      lista.push(e as Etapa);
      etapasPorTrilha.set((e as any).trilha, lista);
      if (e.dia > maiorDia) maiorDia = e.dia;
    }

    if (!trilhas.size) {
      await registrarExecucao(supabase, { detalhes: { info: 'nenhuma trilha ativa' } });
      return json({ success: true, sent: 0, errors: 0, info: 'nenhuma trilha ativa' });
    }

    // Só interessam contatos cuja cadência ainda pode ter etapa pendente.
    const limiteInicio = new Date(Date.parse(today + 'T00:00:00Z') - maiorDia * 86400000)
      .toISOString().split('T')[0];

    // Ordem de atendimento: contato que entrou mais recentemente primeiro.
    // Com fila acumulada o teto diário não dá para todos, e quem entrou ontem
    // ainda lembra da empresa; quem entrou há três semanas esfriou. Se a ordem
    // fosse a natural (mais antigo primeiro), o lead quente esperaria a fila
    // inteira de leads frios.
    const { data: contatos, error: errContatos } = await supabase
      .from('email_cadencia')
      .select('id, nome_contato, nome_empresa, email, trilha, data_inicio, cidade, site, gancho_adesao, origem, created_at')
      .eq('ativo', true)
      .gte('data_inicio', limiteInicio)
      .lte('data_inicio', today)
      .order('data_inicio', { ascending: false })
      .order('id', { ascending: true }); // desempate estável

    if (errContatos) return abortar(`Falha ao ler os contatos: ${errContatos.message}`);
    if (!contatos?.length) {
      await registrarExecucao(supabase, { contatos_elegiveis: 0 });
      return json({ success: true, sent: 0, errors: 0 });
    }

    // Envios já feitos, lidos em lotes de 100 ids.
    // Esta leitura e a trava contra reenvio: em erro, abortar e a unica
    // saida segura (lista vazia reenviaria a etapa 1 para todo mundo).
    let envios: { contato_id: string; ordem: number; enviado_em: string }[];
    try {
      envios = await lerEnviosEmLotes(supabase, contatos.map(c => c.id));
    } catch (e) {
      return abortar(`Falha ao ler os envios: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Quanto do teto de hoje ainda sobra. Conta o que já está gravado para o
    // teto valer mesmo se o cron rodar duas vezes no mesmo dia.
    let jaEnviadosHoje: number;
    try {
      jaEnviadosHoje = await envioHojeContados(supabase);
    } catch (e) {
      return abortar(e instanceof Error ? e.message : String(e));
    }
    const saldoDoDia = Math.max(0, limiteDiario - jaEnviadosHoje);
    if (saldoDoDia === 0) {
      console.log(`[cadencia] teto diário de ${limiteDiario} já atingido hoje (${jaEnviadosHoje} enviados)`);
      await registrarExecucao(supabase, {
        contatos_elegiveis: contatos.length,
        detalhes: { teto_diario: limiteDiario, ja_enviados_hoje: jaEnviadosHoje, atingido: true },
      });
      return json({ success: true, sent: 0, teto_diario: limiteDiario, ja_enviados_hoje: jaEnviadosHoje });
    }

    const jaEnviado = new Set((envios ?? []).map(e => `${e.contato_id}:${e.ordem}`));

    // Data do último e-mail de cada contato, para respeitar o intervalo mínimo.
    const ultimoEnvio = new Map<string, string>();
    for (const e of (envios ?? [])) {
      const dia = String(e.enviado_em).slice(0, 10);
      const atual = ultimoEnvio.get(e.contato_id);
      if (!atual || dia > atual) ultimoEnvio.set(e.contato_id, dia);
    }

    let totalSent = 0, totalErrors = 0, totalSimples = 0, naoCouberamNoTeto = 0;
    const semRegistro: EnvioSemRegistro[] = [];

    for (const c of contatos) {
      const slug = String((c as any).trilha ?? 'garantia');
      const trilha = trilhas.get(slug);
      const etapas = etapasPorTrilha.get(slug);
      if (!trilha || !etapas?.length) continue;

      // Intervalo mínimo entre dois e-mails do mesmo contato. O menor intervalo
      // natural da cadência é 2 dias (D+1 -> D+3), então isso nunca atrasa quem
      // está em dia; só impede que um contato atrasado receba a trilha inteira
      // em dias seguidos caso o cron tenha ficado parado.
      const ultimo = ultimoEnvio.get(c.id);
      if (ultimo && diasEntre(ultimo, today) < INTERVALO_MINIMO_DIAS) continue;

      const decorridos = diasEntre(c.data_inicio, today);
      const pendente = etapas.find(e => e.dia <= decorridos && !jaEnviado.has(`${c.id}:${e.ordem}`));
      if (!pendente) continue;

      const variante = varianteDoContato(c as any);
      // Teto do dia. Fica aqui, depois de achar a etapa pendente, para o
      // contato sem nada a enviar não consumir vaga da fila.
      if (totalSent >= saldoDoDia) {
        naoCouberamNoTeto++;
        continue;
      }

      const { assunto, html } = montarEmail(
        trilha, pendente, etapas.length, c.nome_contato, c.nome_empresa,
        String((c as any).cidade ?? ''), String((c as any).site ?? ''),
        String((c as any).gancho_adesao ?? ''), variante,
      );
      const ok = await sendEmail(c.email, assunto, html);
      if (ok) {
        const erroRegistro = await registrarEnvio(supabase, c.id, pendente.ordem);
        console.log(`[cadencia/${slug}] ✅ E${pendente.ordem} (${variante}) -> ${c.email}`);
        totalSent++;
        if (variante === 'simples') totalSimples++;
        if (erroRegistro) semRegistro.push({ contatoId: c.id, email: c.email, ordem: pendente.ordem, erro: erroRegistro });
      } else totalErrors++;

      await new Promise(r => setTimeout(r, 500));
    }

    await avisarEnvioSemRegistro(semRegistro);
    await registrarExecucao(supabase, {
      contatos_elegiveis: contatos.length, enviados: totalSent, erros: totalErrors, sem_registro: semRegistro.length,
      detalhes: {
        teto_diario: limiteDiario,
        ja_enviados_hoje: jaEnviadosHoje,
        ...(naoCouberamNoTeto ? { nao_couberam_no_teto: naoCouberamNoTeto } : {}),
        ...(semRegistro.length ? { sem_registro: semRegistro } : {}),
        ...(totalSimples ? { ab_simples_enviados: totalSimples } : {}),
      },
    });
    return json({
      success: true, sent: totalSent, errors: totalErrors, sem_registro: semRegistro.length,
      teto_diario: limiteDiario, nao_couberam_no_teto: naoCouberamNoTeto,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[prospecting-cadence]', msg);
    return json({ success: false, error: msg }, 500);
  }
});
