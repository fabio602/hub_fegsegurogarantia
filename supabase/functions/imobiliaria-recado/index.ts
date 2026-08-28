// imobiliaria-recado — avisa a imobiliária, por e-mail, de um recado da
// corretora que precisa de resposta.
//
// O recado em si já existia (campo observacao_imobiliaria, migração 022), mas
// era de mão única e silencioso: só aparecia para quem entrasse no portal. Esta
// function é chamada pelo hub quando o corretor marca o recado como
// "preciso de retorno" e manda o e-mail com o texto e o link do portal.
//
// Body: { client_id: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';
const PORTAL = 'https://hub.fegsegurogarantia.com/imobiliaria.html';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Escapa HTML — o recado é texto livre digitado pelo corretor. */
const esc = (s: string) => (s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/\n/g, '<br>');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: 'client_id é obrigatório' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: cliente, error } = await supabase
      .from('imobiliaria_clientes')
      .select('*, partners(name, email, email_2)')
      .eq('id', client_id)
      .single();

    if (error || !cliente) return json({ error: 'Cadastro não encontrado' }, 404);

    const recado = (cliente.observacao_imobiliaria || '').trim();
    if (!recado) return json({ error: 'Este cadastro não tem recado para enviar' }, 400);

    const parceiro = (cliente as any).partners;
    const to: string[] = [];
    if (parceiro?.email) to.push(parceiro.email);
    if (parceiro?.email_2) to.push(parceiro.email_2);

    // Sem e-mail do parceiro não há como avisar — devolvemos erro claro para o
    // hub mostrar, em vez de fingir que enviou.
    if (to.length === 0) {
      return json({ error: `O parceiro ${parceiro?.name || ''} não tem e-mail cadastrado.` }, 400);
    }

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">Precisamos de um retorno seu</h1>
          <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;">Cliente: ${esc(cliente.inquilino_nome || '—')}</p>
        </div>
        <div style="padding:24px 32px;background:#fff;">
          <p style="color:#1B263B;font-size:14px;margin:0 0 16px;">Olá <strong>${esc(parceiro?.name || '')}</strong>,</p>
          <p style="color:#475569;font-size:13px;margin:0 0 18px;line-height:1.6;">
            Deixamos um recado no portal sobre o cadastro de
            <strong>${esc(cliente.inquilino_nome || '—')}</strong> e precisamos da sua resposta para seguir:
          </p>
          <div style="padding:16px 18px;background:#fff7ed;border:1px solid #fdba74;border-left:4px solid #f97316;border-radius:12px;">
            <p style="margin:0 0 6px;font-size:10px;font-weight:900;color:#c2410c;text-transform:uppercase;letter-spacing:1px;">💬 Recado da F&amp;G</p>
            <p style="margin:0;font-size:14px;color:#1e3a5f;line-height:1.6;">${esc(recado)}</p>
          </div>
          <p style="color:#475569;font-size:13px;margin:20px 0 0;line-height:1.6;">
            Pode responder este e-mail ou falar direto com a gente pelo WhatsApp — o que for mais rápido para você.
          </p>
          <div style="margin-top:20px;padding:14px 18px;background:#f8f5f0;border:1px solid #e8e4dc;border-radius:12px;">
            <p style="margin:0;font-size:12px;color:#78716c;line-height:1.6;">
              🔗 Para ver a situação completa do cadastro:<br/>
              <a href="${PORTAL}" style="color:#C69C6D;font-weight:700;">hub.fegsegurogarantia.com/imobiliaria.html</a>
            </p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to,
        bcc: [BCC],
        reply_to: BCC,
        subject: `Precisamos de um retorno — ${cliente.inquilino_nome || 'cadastro'}`,
        html,
      }),
    });

    if (!res.ok) {
      const detalhe = await res.text();
      return json({ error: 'Falha no envio do e-mail', detalhe }, 502);
    }

    // Registra o envio para o hub não reenviar o mesmo recado a cada salvamento.
    await supabase.from('imobiliaria_clientes')
      .update({ recado_enviado_em: new Date().toISOString() })
      .eq('id', client_id);

    return json({ success: true, enviado_para: to });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
