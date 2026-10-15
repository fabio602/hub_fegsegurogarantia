// imobiliaria-rescisao — a imobiliária avisa que o contrato de locação acabou.
//
// Quando o inquilino sai do imóvel, a apólice de garantia locatícia precisa ser
// cancelada junto à Fiantec — e para isso a seguradora exige o termo de distrato
// e a vistoria de saída. Antes disso chegava por WhatsApp solto, sem documento,
// e o corretor só descobria dias depois.
//
// A function grava o carimbo da solicitação e avisa o Fábio por e-mail, com os
// links dos documentos para encaminhar à Fiantec. (O aviso por WhatsApp via
// Z-API foi removido em 15/10/2026: o Z-API foi cancelado.)
//
// Não confundir com o distrato_url do bloco de renovação: aquele é o contrato
// que chega ao fim da vigência e não será renovado. Este é a saída antecipada,
// que pode acontecer em qualquer mês.
//
// Body: { client_id: uuid }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FABIO_EMAIL = 'fabio@fegsegurogarantia.com.br';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Escapa HTML — a observação é texto livre digitado pela imobiliária. */
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

    // A Fiantec não cancela sem os dois documentos. Barramos aqui também, e não
    // só no portal, para o pedido nunca chegar pela metade.
    const distrato = (cliente as any).rescisao_distrato_url;
    const vistoria = (cliente as any).rescisao_vistoria_url;
    if (!distrato || !vistoria) {
      return json({ error: 'Anexe o termo de distrato e a vistoria antes de concluir a rescisão.' }, 400);
    }

    const parceiro = (cliente as any).partners;
    const obs = ((cliente as any).rescisao_obs || '').trim();
    const nome = cliente.inquilino_nome || '—';
    const apolice = cliente.numero_apolice || '—';
    // Endereço completo desde a migração 102; cadastros antigos só têm CEP e número.
    const imovel = (cliente as any).endereco_imovel || [cliente.numero_imovel, cliente.cep].filter(Boolean).join(', ') || '—';
    const agora = new Date().toISOString();

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#7f1d1d;padding:24px 32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">Rescisão solicitada pela imobiliária</h1>
          <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">Informe a Fiantec para cancelar a apólice</p>
        </div>
        <div style="padding:24px 32px;background:#fff;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;width:130px;">Inquilino</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#1B263B;">${esc(nome)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Imobiliária</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(parceiro?.name || '—')}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Apólice</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(apolice)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Imóvel</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(imovel)}</td></tr>
          </table>

          <div style="margin-top:20px;padding:16px 18px;background:#f8f5f0;border:1px solid #e8e4dc;border-radius:12px;">
            <p style="margin:0 0 12px;font-size:10px;font-weight:900;color:#78716c;text-transform:uppercase;letter-spacing:1px;">📎 Documentos anexados</p>
            <p style="margin:0 0 8px;font-size:13px;"><a href="${distrato}" style="color:#C69C6D;font-weight:700;">Termo de distrato</a></p>
            <p style="margin:0;font-size:13px;"><a href="${vistoria}" style="color:#C69C6D;font-weight:700;">Vistoria de saída</a></p>
          </div>

          ${obs ? `
          <div style="margin-top:16px;padding:16px 18px;background:#fff7ed;border:1px solid #fdba74;border-left:4px solid #f97316;border-radius:12px;">
            <p style="margin:0 0 6px;font-size:10px;font-weight:900;color:#c2410c;text-transform:uppercase;letter-spacing:1px;">💬 Observação da imobiliária</p>
            <p style="margin:0;font-size:14px;color:#1e3a5f;line-height:1.6;">${esc(obs)}</p>
          </div>` : ''}

          <div style="margin-top:20px;padding:14px 18px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;">
            <p style="margin:0;font-size:12px;color:#991b1b;line-height:1.6;">
              ⚠️ Próximo passo: encaminhar os documentos à Fiantec e dar baixa na apólice no hub.
            </p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal da Imobiliária — F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    const envio = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to: [FABIO_EMAIL],
        subject: `🔴 Rescisão solicitada — ${nome} (${parceiro?.name || 'imobiliária'})`,
        html,
      }),
    });
    // O e-mail é o único aviso que chega ao Fábio. Se falhar, a rescisão não
    // é carimbada e a imobiliária vê o erro e pode tentar de novo.
    if (!envio.ok) return json({ error: 'Não foi possível avisar a F&G agora. Tente novamente em instantes.' }, 502);

    // Carimbo por último: se algo acima falhar, o pedido continua "não enviado"
    // e a imobiliária ainda vê o botão em vez de achar que já avisou.
    await supabase.from('imobiliaria_clientes')
      .update({ rescisao_solicitada_em: agora })
      .eq('id', client_id);

    return json({ success: true, rescisao_solicitada_em: agora });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
