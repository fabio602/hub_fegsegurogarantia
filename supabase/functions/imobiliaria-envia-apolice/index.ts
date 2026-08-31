import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { bccResidencial } from '../_shared/copiasResidencial.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const fmtData = (d: string) => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return dd ? `${dd}/${m}/${y}` : d; };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id } = await req.json();
    if (!client_id) throw new Error('client_id obrigatório');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: c } = await supabase
      .from('imobiliaria_clientes')
      .select('*, partners!inner(name, email, email_2)')
      .eq('id', client_id)
      .single();

    if (!c) throw new Error('Cliente não encontrado');
    const partner = (c as any).partners;
    if (!partner?.email) throw new Error('Parceiro sem email cadastrado');
    if (!c.apolice_residencial_url) throw new Error('Apólice não encontrada');

    // Baixa o PDF em chunks
    const pdfRes = await fetch(c.apolice_residencial_url);
    if (!pdfRes.ok) throw new Error('Não foi possível baixar a apólice');
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    const pdfB64 = toBase64(pdfBytes);

    const to = [partner.email];
    if (partner.email_2) to.push(partner.email_2);

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;text-align:center;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:10px 20px;"><span style="color:#1B263B;font-weight:900;font-size:18px;">F&amp;G</span></td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">📤 Apólice Emitida</h1>
          <p style="color:rgba(255,255,255,.5);font-size:12px;margin:5px 0 0;">Seguro Residencial</p>
        </div>
        <div style="padding:28px 32px;background:#fff;">
          <p style="color:#1B263B;font-size:15px;margin:0 0 16px;">Prezados <strong>${partner.name}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">A apólice do inquílino abaixo foi emitida com sucesso. Segue o documento em anexo.</p>
          <div style="background:#f8f5f0;border:2px solid #C69C6D;border-radius:14px;padding:20px;margin:0 0 20px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Dados da Apólice</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">👤 <strong>Inquílino:</strong> ${c.inquilino_nome || '—'}</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">📝 <strong>Nº Apólice:</strong> ${c.numero_apolice || '—'}</p>
            <p style="margin:0 0 6px;font-size:14px;color:#1B263B;">🏢 <strong>Seguradora:</strong> ${c.seguradora && c.seguradora !== 'Importado' ? c.seguradora : '—'}</p>
            <p style="margin:0;font-size:14px;color:#1B263B;">📅 <strong>Vigência:</strong> ${fmtData(c.data_inicio)} a ${fmtData(c.vigencia_fim)}</p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:18px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to, bcc: await bccResidencial(BCC),
        subject: `📤 Apólice emitida: ${c.inquilino_nome} — ${partner.name}`,
        html,
        attachments: [{
          filename: `Apolice_${(c.inquilino_nome||'').replace(/\s/g,'_')}_${c.numero_apolice||'residencial'}.pdf`,
          content: pdfB64,
        }],
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
