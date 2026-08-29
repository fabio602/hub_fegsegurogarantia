// ============================================================================
// resend-webhook
//
// Recebe os eventos do Resend para a trilha de prospeccao por e-mail.
// Cadastrar no painel do Resend (Webhooks) apontando para:
//   https://<projeto>.supabase.co/functions/v1/resend-webhook
// com os eventos: email.bounced, email.complained, email.delivery_delayed,
// email.delivered e email.clicked.
//
// Segredo: RESEND_WEBHOOK_SECRET (o "signing secret" whsec_... do webhook).
// Deploy com --no-verify-jwt: quem chama e o Resend, nao um usuario logado;
// a autenticidade vem da assinatura svix verificada abaixo.
//
// O que faz:
//   bounce permanente ou reclamacao de spam:
//     - desliga o contato da trilha (email_cadencia.ativo = false) e registra o motivo
//     - adiciona o e-mail em email_blocklist (nunca mais recebe)
//     - move o lead do Kanban para a coluna "Sem e-mail válido"
//     - se a taxa de bounce dos envios automaticos do dia estourar o limite,
//       pausa a automacao e avisa por e-mail
//   delivery_delayed ou bounce transitorio: apenas registra
//   clique: interrompe a trilha e move o lead para "Em contato"
//
// Eventos de e-mails que nao pertencem a trilha (boletos, avisos etc.) sao
// ignorados: o filtro e a existencia do destinatario em email_cadencia.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SVC   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
const FROM_EMAIL     = 'fabio@fegsegurogarantia.com.br';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ─── Verificacao da assinatura (formato svix, usado pelo Resend) ─────────────

async function assinaturaValida(req: Request, corpo: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.error('RESEND_WEBHOOK_SECRET nao configurado; evento rejeitado');
    return false;
  }
  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigs = req.headers.get('svix-signature');
  if (!id || !ts || !sigs) return false;

  // Tolerancia de 5 minutos contra replay.
  const idade = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(idade) || idade > 300) return false;

  const secretB64 = WEBHOOK_SECRET.startsWith('whsec_') ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET;
  const chave = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const algo = { name: 'HMAC', hash: 'SHA-256' } as const;
  const key = await crypto.subtle.importKey('raw', chave, algo, false, ['sign']);
  const assinado = await crypto.subtle.sign(algo, key, new TextEncoder().encode(`${id}.${ts}.${corpo}`));
  const esperada = btoa(String.fromCharCode(...new Uint8Array(assinado)));

  return sigs.split(' ').some((s) => {
    const [, valor] = s.split(',');
    return valor === esperada;
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hojeBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function destinatario(data: Record<string, unknown>): string {
  const to = data?.to;
  const raw = Array.isArray(to) ? to[0] : to;
  return String(raw ?? '').trim().toLowerCase();
}

async function avisarPausa(para: string, motivo: string) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `F&G Seguro Garantia <${FROM_EMAIL}>`,
        to: [para],
        subject: 'Prospeccao PNCP pausada: taxa de bounce alta',
        html: `<div style="font-family:system-ui,sans-serif;color:#1B263B;max-width:520px">
          <h2 style="font-size:18px">A prospeccao automatica foi pausada</h2>
          <p style="font-size:14px;line-height:1.7">${motivo}</p>
          <p style="font-size:14px;line-height:1.7">Nenhum envio automatico novo sera feito ate voce
          despausar na tela Prospeccao Automatica do Hub (ou zerar o campo pausado na configuracao).</p>
        </div>`,
      }),
    });
  } catch (e) {
    console.error('[avisarPausa]', e);
  }
}

/**
 * Protecao de reputacao GLOBAL por dominio remetente (reputacao_envio):
 * soma os envios automaticos do dia de TODAS as origens (PNCP + campanhas de
 * garimpo) e os bounces; quando os bounces atingem
 * max(bounce_min_quantidade, bounce_max_percentual% dos envios), pausa tudo.
 */
async function checarTaxaBounce(supabase: SupabaseClient) {
  const { data: rep } = await supabase.from('reputacao_envio').select('*').limit(1).maybeSingle();
  if (!rep || rep.pausado) return;

  const hoje = hojeBRT();
  const inicio = `${hoje}T00:00:00-03:00`;
  const fim = `${hoje}T23:59:59-03:00`;

  // PNCP: envios e bounces do dia.
  const { data: pncpHoje } = await supabase
    .from('prospeccao_pncp_leads')
    .select('resend_status')
    .eq('resultado', 'enviado')
    .gte('enviado_em', inicio).lte('enviado_em', fim);
  const pncpTotal = pncpHoje?.length ?? 0;
  const pncpBounces = (pncpHoje ?? []).filter((r) =>
    ['bounced_permanent', 'complained'].includes(String(r.resend_status))).length;

  // Garimpo: envios do dia e bounces do dia (estado muda para 'bounce').
  const { count: garimpoTotal } = await supabase
    .from('garimpo_estoque')
    .select('id', { count: 'exact', head: true })
    .gte('enviado_em', inicio).lte('enviado_em', fim);
  const { count: garimpoBounces } = await supabase
    .from('garimpo_estoque')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'bounce')
    .gte('atualizado_em', inicio).lte('atualizado_em', fim);

  const total = pncpTotal + Number(garimpoTotal ?? 0);
  if (!total) return;
  const bounces = pncpBounces + Number(garimpoBounces ?? 0);

  const limite = Math.max(
    Number(rep.bounce_min_quantidade) || 2,
    Math.ceil(total * (Number(rep.bounce_max_percentual) || 5) / 100),
  );

  if (bounces >= limite) {
    const motivo = `${bounces} bounce(s) em ${total} envio(s) automatico(s) em ${hoje}, somando PNCP e campanhas de garimpo ` +
      `(limite: ${limite}, regra: o maior entre ${rep.bounce_min_quantidade} bounces e ${rep.bounce_max_percentual}% dos envios).`;
    const agora = new Date().toISOString();
    await supabase.from('reputacao_envio').update({
      pausado: true, pausado_motivo: motivo, pausado_em: agora, updated_at: agora,
    }).eq('dominio', rep.dominio);
    // Redundancia: a pausa antiga do PNCP tambem e acionada.
    await supabase.from('prospeccao_pncp_config').update({
      pausado: true, pausado_motivo: motivo, pausado_em: agora,
    }).eq('id', 1);
    const { data: cfg } = await supabase.from('prospeccao_pncp_config').select('email_relatorio').eq('id', 1).maybeSingle();
    await avisarPausa(String(cfg?.email_relatorio ?? 'fabio@fegsegurogarantia.com.br'), motivo);
    console.log('[bounce-guard] TODAS as automacoes pausadas:', motivo);
  }

  // Mantem o contador de bounces no log da execucao real mais recente do PNCP.
  const { data: execs } = await supabase
    .from('prospeccao_pncp_execucoes')
    .select('id')
    .eq('dry_run', false)
    .order('executado_em', { ascending: false })
    .limit(1);
  if (execs?.length) {
    await supabase.from('prospeccao_pncp_execucoes').update({ bounces: pncpBounces }).eq('id', execs[0].id);
  }
}

// ─── Acoes por tipo de evento ────────────────────────────────────────────────

async function tratarBloqueio(
  supabase: SupabaseClient,
  email: string,
  status: 'bounced_permanent' | 'complained',
  motivo: string,
) {
  // 1. Blocklist: nunca reenviar.
  await supabase.from('email_blocklist').upsert({
    email,
    motivo,
    origem: status === 'complained' ? 'spam' : 'bounce',
  }, { onConflict: 'email' });

  // 2. Sai da trilha, com o motivo registrado.
  const { data: contatos } = await supabase
    .from('email_cadencia')
    .select('id, prospect_id')
    .eq('email', email);
  await supabase.from('email_cadencia').update({
    ativo: false,
    bounce_status: status,
    bounce_motivo: motivo,
    bounce_em: new Date().toISOString(),
  }).eq('email', email);

  // 3. Kanban: move para "Sem e-mail válido". Pelo vinculo direto quando
  // existir; senao, pelo e-mail (so leads ainda em Novos Leads, para nao
  // mexer em lead que alguem ja trabalhou).
  const prospectIds = (contatos ?? []).map((c) => c.prospect_id).filter(Boolean);
  if (prospectIds.length) {
    await supabase.from('prospects').update({ status: 'Sem e-mail válido' }).in('id', prospectIds);
  }
  await supabase.from('prospects')
    .update({ status: 'Sem e-mail válido' })
    .eq('email', email)
    .eq('status', 'Novos Leads');

  // 4. Espelha nos registros das automacoes (relatorios).
  await supabase.from('prospeccao_pncp_leads')
    .update({ resend_status: status, motivo })
    .eq('email', email)
    .eq('resultado', 'enviado');
  await supabase.from('garimpo_estoque')
    .update({ estado: 'bounce', motivo, atualizado_em: new Date().toISOString() })
    .eq('email', email)
    .eq('estado', 'enviado');

  // 5. Protecao de reputacao (global, por dominio).
  await checarTaxaBounce(supabase);
}

async function tratarClique(supabase: SupabaseClient, email: string) {
  // Interrompe a trilha: o lead respondeu com interesse.
  const { data: contatos } = await supabase
    .from('email_cadencia')
    .select('id, prospect_id')
    .eq('email', email)
    .eq('ativo', true);
  if (contatos?.length) {
    await supabase.from('email_cadencia').update({
      ativo: false,
      bounce_status: 'clicked',
      bounce_motivo: 'Clicou no link do e-mail; trilha interrompida',
      bounce_em: new Date().toISOString(),
    }).in('id', contatos.map((c) => c.id));
  }

  // Kanban: "Em contato". So avanca lead que ainda esta em Novos Leads ou que
  // tinha caido em Sem e-mail válido; status definido a mao e preservado.
  const prospectIds = (contatos ?? []).map((c) => c.prospect_id).filter(Boolean);
  if (prospectIds.length) {
    await supabase.from('prospects')
      .update({ status: 'Em contato' })
      .in('id', prospectIds)
      .in('status', ['Novos Leads', 'Sem e-mail válido']);
  }
  await supabase.from('prospects')
    .update({ status: 'Em contato' })
    .eq('email', email)
    .eq('status', 'Novos Leads');

  await supabase.from('prospeccao_pncp_leads')
    .update({ resend_status: 'clicked' })
    .eq('email', email)
    .eq('resultado', 'enviado');
}

async function registrarStatus(supabase: SupabaseClient, email: string, status: string) {
  await supabase.from('prospeccao_pncp_leads')
    .update({ resend_status: status })
    .eq('email', email)
    .eq('resultado', 'enviado')
    .neq('resend_status', 'clicked');
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'metodo nao permitido' }, 405);

  try {
    const corpo = await req.text();
    if (!(await assinaturaValida(req, corpo))) {
      return json({ error: 'assinatura invalida' }, 401);
    }

    const evento = JSON.parse(corpo) as { type?: string; data?: Record<string, unknown> };
    const tipo = String(evento.type ?? '');
    const email = destinatario(evento.data ?? {});
    if (!email) return json({ ok: true, skipped: 'sem destinatario' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SVC);

    // So interessam e-mails da trilha de prospeccao. O restante (boletos,
    // avisos de repasse etc.) passa direto.
    const { data: naTrilha } = await supabase
      .from('email_cadencia').select('id').eq('email', email).limit(1);
    if (!naTrilha?.length) return json({ ok: true, skipped: 'fora da trilha' });

    switch (tipo) {
      case 'email.bounced': {
        const bounce = (evento.data?.bounce ?? {}) as { type?: string; message?: string; subType?: string };
        const permanente = String(bounce.type ?? 'Permanent').toLowerCase() !== 'transient';
        if (permanente) {
          await tratarBloqueio(supabase, email, 'bounced_permanent',
            `Bounce permanente${bounce.subType ? ` (${bounce.subType})` : ''}: ${bounce.message ?? 'sem detalhe'}`);
        } else {
          await registrarStatus(supabase, email, 'bounced_transient');
        }
        break;
      }
      case 'email.complained':
        await tratarBloqueio(supabase, email, 'complained', 'Destinatario marcou o e-mail como spam');
        break;
      case 'email.delivery_delayed':
        await registrarStatus(supabase, email, 'delivery_delayed');
        break;
      case 'email.delivered':
        await registrarStatus(supabase, email, 'delivered');
        break;
      case 'email.clicked':
        await tratarClique(supabase, email);
        break;
      default:
        return json({ ok: true, skipped: `evento ${tipo} ignorado` });
    }

    console.log(`[resend-webhook] ${tipo} -> ${email}`);
    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resend-webhook]', msg);
    return json({ error: msg }, 500);
  }
});
