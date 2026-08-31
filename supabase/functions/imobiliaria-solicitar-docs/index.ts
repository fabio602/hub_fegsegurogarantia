import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { bccResidencial } from '../_shared/copiasResidencial.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { parceiro_email, parceiro_nome, inquilino_nome, portal_link, docs_faltando } = await req.json();
    if (!parceiro_email) throw new Error('parceiro_email obrigatório');

    const docsList = (docs_faltando || ['Contrato de Locação', 'Termo de Vistoria', 'Fotos da Vistoria'])
      .map((d: string) => `<li style="padding:6px 0;border-bottom:1px solid #f0ece4;font-size:13px;color:#1B263B;">📎 <strong>${d}</strong></li>`)
      .join('');

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:28px 32px;text-align:center;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 14px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:10px 20px;">
              <span style="color:#1B263B;font-weight:900;font-size:18px;">F&amp;G</span>
            </td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">📋 Documentos Necessários</h1>
          <p style="color:rgba(255,255,255,.5);font-size:12px;margin:5px 0 0;">Garantia Locaícia</p>
        </div>
        <div style="padding:28px 32px;background:#fff;">
          <p style="color:#1B263B;font-size:15px;margin:0 0 14px;">Prezados <strong>${parceiro_nome}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">
            Para darmos sequência à emissão da garantia locaícia do inquílino 
            <strong style="color:#1B263B;">${inquilino_nome}</strong>, 
            precisamos dos seguintes documentos:
          </p>
          <div style="background:#f8f5f0;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
            <ul style="list-style:none;padding:0;margin:0;">${docsList}</ul>
          </div>
          <p style="color:#475569;font-size:14px;margin:0 0 20px;">
            Acesse o portal e envie os documentos diretamente pela aba <strong>Minhas Solicitações</strong>:
          </p>
          <div style="text-align:center;">
            <a href="${portal_link || 'https://hub.fegsegurogarantia.com/imobiliaria.html'}" 
               style="display:inline-block;background:#1B263B;color:#C69C6D;font-weight:900;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none;">
              🔗 Acessar Portal e Enviar Documentos
            </a>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:20px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Equipe F&amp;G Seguro Garantia</p>
          <p style="margin:4px 0 0;font-size:11px;"><a href="https://fegsegurogarantia.com.br" style="color:#C69C6D;text-decoration:none;">fegsegurogarantia.com.br</a></p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to: [parceiro_email],
        bcc: await bccResidencial(BCC),
        subject: `📋 Documentos necessários: ${inquilino_nome} — F&G Seguro Garantia`,
        html,
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
