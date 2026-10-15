// imobiliaria-docs-completos — avisa o Fábio quando a imobiliária termina de
// enviar os documentos da garantia locatícia pelo portal.
//
// O portal chama esta function depois de cada upload que deixa o cadastro com
// os três documentos (contrato, termo de vistoria, fotos da vistoria). A
// conferência é feita aqui, no banco, e não confia no portal: só manda e-mail
// se os três estiverem gravados e o aviso ainda não tiver saído.
//
// O carimbo docs_completos_avisado_em (migração 106) é gravado ANTES do envio,
// numa atualização condicional, para dois uploads simultâneos não gerarem dois
// e-mails. Se o Resend falhar, o carimbo é desfeito e o próximo upload tenta de
// novo.
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

const esc = (s: string) => (s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: 'client_id é obrigatório' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const agora = new Date().toISOString();

    // Reserva o aviso: só passa quem tem os três documentos e ainda não foi avisado.
    const { data: reservado, error: errRes } = await supabase
      .from('imobiliaria_clientes')
      .update({ docs_completos_avisado_em: agora })
      .eq('id', client_id)
      .is('docs_completos_avisado_em', null)
      .not('doc_contrato_url', 'is', null)
      .not('doc_termo_vistoria_url', 'is', null)
      .not('doc_fotos_vistoria_url', 'is', null)
      .select('id, inquilino_nome, numero_apolice, numero_imovel, cep, endereco_imovel, doc_contrato_url, doc_termo_vistoria_url, doc_fotos_vistoria_url, partners(name)')
      .maybeSingle();

    if (errRes) throw errRes;
    if (!reservado) return json({ success: true, enviado: false, motivo: 'incompleto ou já avisado' });

    const c: any = reservado;
    const nome = c.inquilino_nome || '—';
    const imob = c.partners?.name || 'imobiliária';
    const imovel = c.endereco_imovel || [c.numero_imovel, c.cep].filter(Boolean).join(', ') || '—';

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">Documentos da garantia recebidos</h1>
          <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">A imobiliária enviou os três documentos pelo portal</p>
        </div>
        <div style="padding:24px 32px;background:#fff;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;width:130px;">Inquilino</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#1B263B;">${esc(nome)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Imobiliária</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(imob)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Apólice</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(c.numero_apolice || '—')}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Imóvel</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(imovel)}</td></tr>
          </table>
          <div style="margin-top:20px;padding:16px 18px;background:#f8f5f0;border:1px solid #e8e4dc;border-radius:12px;">
            <p style="margin:0 0 12px;font-size:10px;font-weight:900;color:#78716c;text-transform:uppercase;letter-spacing:1px;">Documentos</p>
            <p style="margin:0 0 8px;font-size:13px;"><a href="${c.doc_contrato_url}" style="color:#8B6C3E;font-weight:700;">Contrato do aluguel</a></p>
            <p style="margin:0 0 8px;font-size:13px;"><a href="${c.doc_termo_vistoria_url}" style="color:#8B6C3E;font-weight:700;">Termo de vistoria</a></p>
            <p style="margin:0;font-size:13px;"><a href="${c.doc_fotos_vistoria_url}" style="color:#8B6C3E;font-weight:700;">Fotos da vistoria</a></p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal da Imobiliária, F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to: [FABIO_EMAIL],
        subject: `📎 Documentos da garantia recebidos: ${nome} (${imob})`,
        html,
      }),
    });

    if (!res.ok) {
      // Desfaz a reserva para o próximo upload tentar de novo.
      await supabase.from('imobiliaria_clientes')
        .update({ docs_completos_avisado_em: null })
        .eq('id', client_id).eq('docs_completos_avisado_em', agora);
      return json({ error: `Falha no envio do e-mail (${res.status})` }, 502);
    }

    return json({ success: true, enviado: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
