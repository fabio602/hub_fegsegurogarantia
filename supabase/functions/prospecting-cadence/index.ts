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
  const { data: t } = await supabase
    .from('email_trilhas')
    .select('slug, nome, eyebrow, rodape')
    .eq('slug', slug)
    .maybeSingle();
  if (!t) return null;

  const { data: etapas } = await supabase
    .from('email_trilha_etapas')
    .select('ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link, html_completo')
    .eq('trilha', slug)
    .eq('ativo', true)
    .order('ordem');

  return { trilha: t as Trilha, etapas: (etapas ?? []) as Etapa[] };
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `F&G Seguro Garantia <${FROM_EMAIL}>`, to: [to], bcc: [BCC_EMAIL], subject, html }),
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
 */
async function registrarEnvio(supabase: SupabaseClient, contatoId: string, ordem: number) {
  const agora = new Date().toISOString();
  await supabase.from('email_envios')
    .upsert({ contato_id: contatoId, ordem, enviado_em: agora }, { onConflict: 'contato_id,ordem' });

  if (ordem >= 1 && ordem <= 5) {
    await supabase.from('email_cadencia').update({
      [`email_${ordem}_sent`]: true,
      [`email_${ordem}_sent_at`]: agora,
    }).eq('id', contatoId);
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
      const ordem   = body.ordem ? Number(body.ordem) : null;
      const alvo    = ordem ? etapas.filter(e => e.ordem === ordem) : etapas;
      if (!alvo.length) return json({ success: false, error: `Etapa ${ordem} não existe ou está inativa` }, 404);

      const montados = alvo.map(e => ({
        ordem: e.ordem,
        dia: e.dia,
        ...montarEmail(trilha, e, etapas.length, nome, empresa, cidadePrev, sitePrev, ganchoPrev),
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

    // ── MODO IMEDIATO: dispara a primeira etapa agora, para um contato recém-criado.
    if (body.contact_id) {
      const { data: c } = await supabase
        .from('email_cadencia')
        .select('id, nome_contato, nome_empresa, email, email_1_sent, trilha, cidade, site, gancho_adesao')
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
      const { assunto, html } = montarEmail(
        trilha, primeira, etapas.length, c.nome_contato, c.nome_empresa,
        String((c as any).cidade ?? ''), String((c as any).site ?? ''),
        String((c as any).gancho_adesao ?? ''),
      );
      const ok = await sendEmail(c.email, assunto, html);
      if (ok) {
        await registrarEnvio(supabase, c.id, primeira.ordem);
        console.log(`[cadencia/${slug}] ✅ E${primeira.ordem} imediato -> ${c.email}`);
      }
      return json({ success: ok, email: c.email, trilha: slug });
    }

    // ── MODO CRON: um e-mail por contato por execução.
    // Para cada contato ativo, procura a primeira etapa ainda não enviada cujo
    // dia já venceu. O limite de um envio por rodada é proposital: se o cron
    // falhar por três dias, ninguém recebe três e-mails de uma vez.
    const today = todayBRT();

    // Todas as trilhas ativas, carregadas de uma vez.
    const { data: trilhasRaw } = await supabase
      .from('email_trilhas')
      .select('slug, nome, eyebrow, rodape')
      .eq('ativo', true);

    const { data: etapasRaw } = await supabase
      .from('email_trilha_etapas')
      .select('trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link, html_completo')
      .eq('ativo', true)
      .order('ordem');

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

    if (!trilhas.size) return json({ success: true, sent: 0, errors: 0, info: 'nenhuma trilha ativa' });

    // Só interessam contatos cuja cadência ainda pode ter etapa pendente.
    const limiteInicio = new Date(Date.parse(today + 'T00:00:00Z') - maiorDia * 86400000)
      .toISOString().split('T')[0];

    const { data: contatos, error: errContatos } = await supabase
      .from('email_cadencia')
      .select('id, nome_contato, nome_empresa, email, trilha, data_inicio, cidade, site, gancho_adesao')
      .eq('ativo', true)
      .gte('data_inicio', limiteInicio)
      .lte('data_inicio', today);

    if (errContatos) return json({ success: false, error: errContatos.message }, 500);
    if (!contatos?.length) return json({ success: true, sent: 0, errors: 0 });

    // Envios já feitos, em uma consulta só.
    const { data: envios } = await supabase
      .from('email_envios')
      .select('contato_id, ordem, enviado_em')
      .in('contato_id', contatos.map(c => c.id));

    const jaEnviado = new Set((envios ?? []).map(e => `${e.contato_id}:${e.ordem}`));

    // Data do último e-mail de cada contato, para respeitar o intervalo mínimo.
    const ultimoEnvio = new Map<string, string>();
    for (const e of (envios ?? [])) {
      const dia = String(e.enviado_em).slice(0, 10);
      const atual = ultimoEnvio.get(e.contato_id);
      if (!atual || dia > atual) ultimoEnvio.set(e.contato_id, dia);
    }

    let totalSent = 0, totalErrors = 0;

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

      const { assunto, html } = montarEmail(
        trilha, pendente, etapas.length, c.nome_contato, c.nome_empresa,
        String((c as any).cidade ?? ''), String((c as any).site ?? ''),
        String((c as any).gancho_adesao ?? ''),
      );
      const ok = await sendEmail(c.email, assunto, html);
      if (ok) {
        await registrarEnvio(supabase, c.id, pendente.ordem);
        console.log(`[cadencia/${slug}] ✅ E${pendente.ordem} -> ${c.email}`);
        totalSent++;
      } else totalErrors++;

      await new Promise(r => setTimeout(r, 500));
    }

    return json({ success: true, sent: totalSent, errors: totalErrors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[prospecting-cadence]', msg);
    return json({ success: false, error: msg }, 500);
  }
});
