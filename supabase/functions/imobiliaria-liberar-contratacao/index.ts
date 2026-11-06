// imobiliaria-liberar-contratacao: a imobiliária responde, pelo portal, se o
// inquilino segue com a contratação ou desiste.
//
// O aviso ia só por WhatsApp (Z-API, cancelado), então ninguém ficava sabendo.
// Desde 06/11/2026 vai por e-mail para o Fábio, com cópia para a equipe do
// Residencial (lista em residencial_config).
//
// Declinar encerra o cadastro do mesmo jeito que o campo Situação do HUB:
// status_apolice 'desistiu' e status 'encerrado'. Antes o status ficava 'ativo'
// e o cadastro aparecia contraditório na tela.
//
// Body: { client_id, inquilino_nome?, parceiro_nome?, acao: 'autorizar' | 'declinar' }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bccResidencial } from '../_shared/copiasResidencial.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FABIO_EMAIL = 'fabio@fegsegurogarantia.com.br';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[m]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id, inquilino_nome, parceiro_nome, acao } = await req.json();
    if (!client_id) throw new Error('client_id obrigatório');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const isAutorizar = acao !== 'declinar';

    if (isAutorizar) {
      await supabase.from('imobiliaria_clientes')
        .update({ intencao: 'contratar' })
        .eq('id', client_id);
    } else {
      await supabase.from('imobiliaria_clientes')
        .update({ intencao: 'nao_contratar', kanban_status: 'recusado', status_apolice: 'desistiu', status: 'encerrado' })
        .eq('id', client_id);
    }

    const imob = parceiro_nome || 'Imobiliária';
    const nome = inquilino_nome || '—';
    const titulo = isAutorizar ? 'Contratação autorizada' : 'Contratação declinada';
    const texto = isAutorizar
      ? 'A imobiliária autorizou seguir com a contratação. Pode dar sequência no HUB.'
      : 'A imobiliária informou que o inquilino não vai contratar. O cadastro foi encerrado como "Optou Não Contratar" e saiu da pipeline.';
    const cor = isAutorizar ? '#2d6a4f' : '#c2410c';

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;">
          <img src="https://hub.fegsegurogarantia.com/marca/fg-logo-horizontal-bege.png" width="150" height="49" alt="F&amp;G Seguro Garantia" style="display:block;border:0;margin:0 0 14px;" />
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">${titulo}</h1>
          <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">Resposta da imobiliária pelo portal</p>
        </div>
        <div style="padding:24px 32px;background:#fff;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;width:130px;">Inquilino</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#1B263B;">${esc(nome)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Imobiliária</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(imob)}</td></tr>
          </table>
          <div style="margin-top:18px;padding:14px 18px;border-left:4px solid ${cor};background:#f8f5f0;border-radius:0 12px 12px 0;">
            <p style="margin:0;font-size:13px;color:#334155;line-height:1.6;">${texto}</p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal da Imobiliária, F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    // Falha no e-mail não desfaz a resposta da imobiliária: o cadastro já foi
    // atualizado e aparece no HUB de qualquer jeito.
    const copias = (await bccResidencial(FABIO_EMAIL)).filter(e => e !== FABIO_EMAIL);
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to: [FABIO_EMAIL],
        ...(copias.length > 0 ? { bcc: copias } : {}),
        subject: `${isAutorizar ? '✅' : '❌'} ${titulo}: ${nome} (${imob})`,
        html,
      }),
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
