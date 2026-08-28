// imobiliaria-nova-cotacao — a imobiliária pediu um seguro pelo portal.
//
// Grava o cadastro em imobiliaria_clientes, espelha em residential_clients (para
// a solicitação aparecer também na esteira residencial) e avisa a corretora.
//
// O aviso sai por dois canais de propósito: WhatsApp para agir na hora e e-mail
// para ficar registrado e ser encaminhável.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FABIO_EMAIL = 'fabio@fegsegurogarantia.com.br';
const ZAPI_INSTANCE_ID = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT_TOKEN = 'F1febfc77e5734fc38a3de6979b7c9bd8S';
const ALERT_PHONES = ['5515997402635', '5515998618659'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Escapa HTML — os dados vêm de formulário livre do portal. */
const esc = (s: string) => (s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

async function sendWhatsApp(phone: string, message: string) {
  try {
    await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone, message }),
    });
  } catch (e) { console.error(`Erro ao enviar para ${phone}:`, String(e)); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const dados = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Cadastro na esteira da imobiliária
    const { data: inserted, error } = await supabase
      .from('imobiliaria_clientes').insert(dados).select().single();
    if (error) throw error;

    // 2. Nome do parceiro
    let imobiliariaNome = 'Imobiliária';
    if (dados.partner_id) {
      const { data: partner } = await supabase.from('partners').select('name').eq('id', dados.partner_id).single();
      if (partner) imobiliariaNome = partner.name;
    }

    // 3. Espelho na esteira residencial
    const produtoMap: Record<string, string> = {
      garantia: 'Apenas Garantia Locaícia',
      residencial: 'Apenas Seguro Residencial',
      residencial_garantia: 'Garantia Locaícia & Seguro Residencial',
    };
    await supabase.from('residential_clients').insert({
      nome: dados.inquilino_nome,
      cpf: dados.cpf || null,
      email: dados.email_inquilino || null,
      telefone: dados.telefone || null,
      telefone_2: dados.telefone2 || null,
      produto: produtoMap[dados.tipo_seguro] || 'Apenas Seguro Residencial',
      cep_imovel: dados.cep || null,
      numero_imovel: dados.numero_imovel || null,
      tipo_imovel: dados.tipo_imovel || null,
      valor_imovel: dados.valor_imovel?.toString() || null,
      valor_aluguel: dados.valor_aluguel?.toString() || null,
      data_primeiro_pag_aluguel: dados.data_primeiro_pag_aluguel || null,
      valor_iptu_condominio: dados.valor_iptu?.toString() || null,
      estado_civil: dados.estado_civil || null,
      situacao: 'Lead (site)',
      parceiro_nome: imobiliariaNome,
      origem_publica: false,
    });

    // 4. Avisos
    const tipoLabel = produtoMap[dados.tipo_seguro] || 'Seguro Residencial';
    const intencaoLabel = dados.intencao === 'contratar' ? '✅ Pronto para contratar' : '📋 Apenas verificar aprovação';
    const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const aluguel = dados.valor_aluguel ? fmtBRL(Number(dados.valor_aluguel)) : '—';

    const msg = `🏠 *Nova Solicitação de Cotação*\n\n*Parceiro:* ${imobiliariaNome}\n*Inquílino:* ${dados.inquilino_nome || '—'}\n*Tipo:* ${tipoLabel}\n*Aluguel:* ${aluguel}\n*Telefone:* ${dados.telefone || '—'}\n*Intenção:* ${intencaoLabel}\n\nAcesse o hub → hub.fegsegurogarantia.com`;

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">Nova solicitação de seguro</h1>
          <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;">Enviada pelo portal da imobiliária</p>
        </div>
        <div style="padding:24px 32px;background:#fff;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;width:130px;">Imobiliária</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#1B263B;">${esc(imobiliariaNome)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Inquilino</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#1B263B;">${esc(dados.inquilino_nome || '—')}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Produto</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(tipoLabel)}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Aluguel</td><td style="padding:8px 0;font-size:14px;font-weight:900;color:#C69C6D;">${aluguel}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Telefone</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(dados.telefone || '—')}</td></tr>
            <tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">Intenção</td><td style="padding:8px 0;font-size:14px;color:#1B263B;">${esc(intencaoLabel)}</td></tr>
          </table>
          <div style="margin-top:20px;padding:14px 18px;background:#fef9f0;border:1px solid #C69C6D40;border-radius:12px;">
            <p style="margin:0;font-size:12px;color:#78716c;line-height:1.6;">
              🔗 Abra a solicitação no hub:<br/>
              <a href="https://hub.fegsegurogarantia.com" style="color:#C69C6D;font-weight:700;">hub.fegsegurogarantia.com</a>
            </p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal da Imobiliária — F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    // O aviso não pode derrubar o cadastro: se WhatsApp ou e-mail falharem, a
    // solicitação já está salva e aparece no hub de qualquer jeito.
    await Promise.all([
      ...ALERT_PHONES.map((p) => sendWhatsApp(p, msg)),
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
          to: [FABIO_EMAIL],
          subject: `🏠 Nova solicitação — ${dados.inquilino_nome || 'sem nome'} (${imobiliariaNome})`,
          html,
        }),
      }).catch((e) => console.error('[resend]', String(e))),
    ]);

    return new Response(JSON.stringify({ success: true, id: inserted.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[imobiliaria-nova-cotacao]', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
