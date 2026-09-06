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

interface EnvioSemRegistro { contatoId: string; email: string; ordem: number; erro: string; }

interface ResumoExecucao {
  contatos_elegiveis?: number; enviados?: number; erros?: number; sem_registro?: number;
  abortada?: boolean; detalhes?: Record<string, unknown>;
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
        const erroRegistro = await registrarEnvio(supabase, c.id, primeira.ordem);
        console.log(`[cadencia/${slug}] ✅ E${primeira.ordem} imediato -> ${c.email}`);
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

    const { data: contatos, error: errContatos } = await supabase
      .from('email_cadencia')
      .select('id, nome_contato, nome_empresa, email, trilha, data_inicio, cidade, site, gancho_adesao')
      .eq('ativo', true)
      .gte('data_inicio', limiteInicio)
      .lte('data_inicio', today);

    if (errContatos) return abortar(`Falha ao ler os contatos: ${errContatos.message}`);
    if (!contatos?.length) {
      await registrarExecucao(supabase, { contatos_elegiveis: 0 });
      return json({ success: true, sent: 0, errors: 0 });
    }

    // Envios já feitos, em uma consulta só.
    // Esta leitura e a trava contra reenvio: em erro, abortar e a unica
    // saida segura (lista vazia reenviaria a etapa 1 para todo mundo).
    const { data: envios, error: errEnvios } = await supabase
      .from('email_envios')
      .select('contato_id, ordem, enviado_em')
      .in('contato_id', contatos.map(c => c.id));
    if (errEnvios) return abortar(`Falha ao ler os envios: ${errEnvios.message}`);

    const jaEnviado = new Set((envios ?? []).map(e => `${e.contato_id}:${e.ordem}`));

    // Data do último e-mail de cada contato, para respeitar o intervalo mínimo.
    const ultimoEnvio = new Map<string, string>();
    for (const e of (envios ?? [])) {
      const dia = String(e.enviado_em).slice(0, 10);
      const atual = ultimoEnvio.get(e.contato_id);
      if (!atual || dia > atual) ultimoEnvio.set(e.contato_id, dia);
    }

    let totalSent = 0, totalErrors = 0;
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

      const { assunto, html } = montarEmail(
        trilha, pendente, etapas.length, c.nome_contato, c.nome_empresa,
        String((c as any).cidade ?? ''), String((c as any).site ?? ''),
        String((c as any).gancho_adesao ?? ''),
      );
      const ok = await sendEmail(c.email, assunto, html);
      if (ok) {
        const erroRegistro = await registrarEnvio(supabase, c.id, pendente.ordem);
        console.log(`[cadencia/${slug}] ✅ E${pendente.ordem} -> ${c.email}`);
        totalSent++;
        if (erroRegistro) semRegistro.push({ contatoId: c.id, email: c.email, ordem: pendente.ordem, erro: erroRegistro });
      } else totalErrors++;

      await new Promise(r => setTimeout(r, 500));
    }

    await avisarEnvioSemRegistro(semRegistro);
    await registrarExecucao(supabase, {
      contatos_elegiveis: contatos.length, enviados: totalSent, erros: totalErrors, sem_registro: semRegistro.length,
      detalhes: semRegistro.length ? { sem_registro: semRegistro } : undefined,
    });
    return json({ success: true, sent: totalSent, errors: totalErrors, sem_registro: semRegistro.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[prospecting-cadence]', msg);
    return json({ success: false, error: msg }, 500);
  }
});
