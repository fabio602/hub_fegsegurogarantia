import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';
const ZAPI_INSTANCE_ID = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT_TOKEN = 'F1febfc77e5734fc38a3de6979b7c9bd8S';
const FABIO = '5515998618659';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const avisarFabio = async (mensagem: string) => {
  await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: FABIO, message: mensagem }),
  }).catch(() => {});
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const hoje = new Date();
    const diaHoje = hoje.getDate();
    // Dia alvo = hoje + 10 (com wrap no mês)
    const diaAlvo = diaHoje + 10 > 28 ? (diaHoje + 10 - 28) : diaHoje + 10;

    // Busca clientes ativos com repasse e dia_vencimento = diaAlvo
    const { data: clientes } = await supabase
      .from('imobiliaria_clientes')
      .select('*, partners!inner(name, email, email_2)')
      .eq('is_repasse', true)
      .eq('status_apolice', 'ativo')
      .eq('dia_vencimento_aluguel', diaAlvo)
      .is('repasse_pago_em', null);

    // Cadastro sem valor mensal não pode entrar no e-mail: a imobiliária
    // receberia uma cobrança de R$ 0,00, que parece erro nosso (e é).
    const comValor = (clientes || []).filter((c: any) => Number(c.valor_seguro || 0) > 0);
    const semValor = (clientes || []).filter((c: any) => !(Number(c.valor_seguro || 0) > 0));

    // O que ficou de fora não pode passar despercebido — avisamos o Fábio.
    if (semValor.length > 0) {
      const lista = semValor
        .map((c: any) => `• ${c.inquilino_nome} (${(c as any).partners?.name || 'sem parceiro'}) — venc. dia ${c.dia_vencimento_aluguel}`)
        .join('\n');
      await avisarFabio(
        `⚠️ *Repasse não enviado — falta o valor do seguro*\n\n` +
        `${semValor.length} cadastro(s) estão marcados como repasse com vencimento dia ${diaAlvo}, ` +
        `mas com valor mensal zerado. Não mandei e-mail para a imobiliária.\n\n${lista}\n\n` +
        `Preencha o "Valor Mensal (R$)" no hub para que entrem no próximo aviso.`,
      );
    }

    if (comValor.length === 0) {
      return new Response(JSON.stringify({ success: true, enviados: 0, ignorados_sem_valor: semValor.length, msg: 'Nenhum repasse com valor para enviar hoje', dia_alvo: diaAlvo }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Agrupa por parceiro
    const porParceiro = new Map<number, { nome: string; email: string; email2?: string; clientes: any[] }>();
    for (const c of comValor) {
      const pid = c.partner_id;
      if (!porParceiro.has(pid)) {
        porParceiro.set(pid, { nome: (c as any).partners.name, email: (c as any).partners.email, email2: (c as any).partners.email_2, clientes: [] });
      }
      porParceiro.get(pid)!.clientes.push(c);
    }

    let enviados = 0;
    for (const [, p] of porParceiro) {
      if (!p.email) continue;
      const total = p.clientes.reduce((s: number, c: any) => s + Number(c.valor_seguro || 0), 0);
      const lista = p.clientes.map((c: any) => `
        <tr style="border-bottom:1px solid #f0ece4;">
          <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1B263B;">${c.inquilino_nome}</td>
          <td style="padding:12px 16px;font-size:13px;color:#94a3b8;">${c.numero_apolice || '—'}</td>
          <td style="padding:12px 16px;font-size:13px;font-weight:900;color:#C69C6D;">${fmtBRL(Number(c.valor_seguro || 0))}</td>
          <td style="padding:12px 16px;font-size:13px;color:#78716c;">Dia ${c.dia_vencimento_aluguel}</td>
        </tr>`).join('');

      const html = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
          <div style="background:#1B263B;padding:24px 32px;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
              <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
            </table>
            <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">Aviso de Repasse — 10 dias</h1>
            <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;">Vencimento dia ${diaAlvo} do mês</p>
          </div>
          <div style="padding:24px 32px;background:#fff;">
            <p style="color:#1B263B;font-size:14px;margin:0 0 16px;">Prezados <strong>${p.nome}</strong>,</p>
            <p style="color:#475569;font-size:13px;margin:0 0 20px;line-height:1.6;">
              O aluguel dos inquílinos abaixo vence em <strong>10 dias (dia ${diaAlvo})</strong>. Por favor organize o repasse do seguro para antes desta data.
            </p>
            <table style="width:100%;border-collapse:collapse;background:#f8f5f0;border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:#1B263B;">
                  <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:900;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px;">Inquílino</th>
                  <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:900;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px;">Apólice</th>
                  <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:900;color:#C69C6D;text-transform:uppercase;letter-spacing:1px;">Valor Seguro</th>
                  <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:900;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px;">Vencimento</th>
                </tr>
              </thead>
              <tbody>${lista}</tbody>
              <tfoot>
                <tr style="background:#1B263B;">
                  <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:900;color:#fff;">TOTAL</td>
                  <td colspan="2" style="padding:12px 16px;font-size:15px;font-weight:900;color:#C69C6D;">${fmtBRL(total)}</td>
                </tr>
              </tfoot>
            </table>
            <div style="margin-top:20px;padding:14px 18px;background:#fef9f0;border:1px solid #C69C6D40;border-radius:12px;">
              <p style="margin:0;font-size:12px;color:#78716c;line-height:1.6;">
                🔗 Após realizar o repasse, acesse o portal para confirmar: <br/>
                <a href="https://hub.fegsegurogarantia.com/imobiliaria.html" style="color:#C69C6D;font-weight:700;">hub.fegsegurogarantia.com/imobiliaria.html</a>
              </p>
            </div>
          </div>
          <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
            <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
          </div>
        </div>`;

      const to = [p.email];
      if (p.email2) to.push(p.email2);

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
          to, bcc: [BCC],
          subject: `⏰ Repasse em 10 dias (dia ${diaAlvo}) — ${p.clientes.length} inquílino(s) — ${fmtBRL(total)}`,
          html,
        }),
      });

      // WhatsApp para Fábio
      await avisarFabio(`⏰ *Aviso de Repasse — 10 dias*\n\n*Parceiro:* ${p.nome}\n*Vencimento:* dia ${diaAlvo}\n*Total:* ${fmtBRL(total)}\n*Inquílinos:* ${p.clientes.map((c: any) => c.inquilino_nome).join(', ')}`);

      enviados++;
    }

    return new Response(JSON.stringify({ success: true, enviados, ignorados_sem_valor: semValor.length, dia_alvo: diaAlvo }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
