import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FABIO_EMAIL = 'fabio@fegsegurogarantia.com.br';
const HUB_URL = 'https://fegsegurogarantia.com.br'; // ajuste se o hub tiver URL diferente

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Data de hoje e daqui a 7 dias (BRT)
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const todayYmd = brt.toISOString().slice(0, 10);
    const in7 = new Date(brt);
    in7.setDate(in7.getDate() + 7);
    const in7Ymd = in7.toISOString().slice(0, 10);
    const in3 = new Date(brt);
    in3.setDate(in3.getDate() + 3);
    const in3Ymd = in3.toISOString().slice(0, 10);

    // Busca boletos RC em aberto vencendo em 3 ou 7 dias
    const { data: boletos, error } = await supabase
      .from('rc_boletos')
      .select('id, parcela, vencimento, valor, rc_client_id')
      .eq('pago', false)
      .in('vencimento', [in7Ymd, in3Ymd]);

    if (error) throw error;
    if (!boletos || boletos.length === 0) {
      return new Response(JSON.stringify({ ok: true, enviados: 0, msg: 'Nenhum boleto a vencer em 3 ou 7 dias.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Busca dados dos clientes
    const clientIds = [...new Set(boletos.map((b: any) => b.rc_client_id))];
    const { data: clients } = await supabase
      .from('rc_clients')
      .select('id, nome, nome_contato, email, apolice, seguradora, tipo_rc')
      .in('id', clientIds);

    const clientMap: Record<number, any> = {};
    (clients || []).forEach((c: any) => { clientMap[c.id] = c; });

    // Monta lista de itens para o email
    const items = boletos.map((b: any) => {
      const c = clientMap[b.rc_client_id] || {};
      const venc = b.vencimento ? new Date(b.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
      const diasRestantes = b.vencimento === in3Ymd ? 3 : 7;
      const valor = b.valor ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(b.valor) : null;
      return { ...b, cliente: c, vencFormatado: venc, diasRestantes, valor };
    });

    // Agrupa urgentes (3 dias) e normais (7 dias)
    const urgentes = items.filter((i: any) => i.diasRestantes === 3);
    const normais = items.filter((i: any) => i.diasRestantes === 7);

    const linhaItem = (item: any) => `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:12px 16px;">
          <span style="display:inline-block;background:${item.diasRestantes === 3 ? '#fef2f2' : '#fefce8'};color:${item.diasRestantes === 3 ? '#dc2626' : '#b45309'};font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;margin-right:8px;">${item.diasRestantes === 3 ? '⚡ 3 dias' : '⏰ 7 dias'}</span>
          <strong style="color:#1B263B;">${item.cliente.nome || '—'}</strong>
          ${item.cliente.nome_contato ? `<span style="color:#94a3b8;font-size:12px;"> · ${item.cliente.nome_contato}</span>` : ''}
        </td>
        <td style="padding:12px 16px;text-align:center;font-weight:700;color:#1B263B;">Parcela ${item.parcela}</td>
        <td style="padding:12px 16px;text-align:center;color:#dc2626;font-weight:700;">${item.vencFormatado}</td>
        <td style="padding:12px 16px;text-align:center;color:#475569;">${item.valor || '—'}</td>
        <td style="padding:12px 16px;text-align:center;">
          <span style="font-size:11px;color:#94a3b8;">${item.cliente.seguradora || ''}</span>
        </td>
      </tr>`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:#1B263B;border-radius:16px 16px 0 0;padding:28px 36px;">
      <p style="margin:0;font-size:22px;font-weight:900;color:#C69C6D;">F&amp;G · Lembrete RC</p>
      <p style="margin:4px 0 0;font-size:12px;color:#7a9bbf;letter-spacing:2px;text-transform:uppercase;">Boletos a vencer — Responsabilidade Civil</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#fff;padding:32px 36px;">

      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1B263B;">Fábio, atenção! 👋</p>
      <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.7;">
        Os boletos abaixo vencem nos próximos dias. Por favor, <strong>faça o upload no hub e envie para cada cliente</strong> antes do vencimento.
      </p>

      <!-- Tabela -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:0 0 24px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Cliente</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Parcela</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Vencimento</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Valor</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;">Seguradora</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(linhaItem).join('')}
        </tbody>
      </table>

      <!-- Checklist -->
      <div style="background:#f8fafc;border-left:4px solid #C69C6D;border-radius:0 10px 10px 0;padding:16px 20px;margin:0 0 28px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">Para cada cliente acima:</p>
        <p style="margin:0;font-size:14px;color:#475569;line-height:2;">
          1️⃣ Baixe o PDF no portal da seguradora<br/>
          2️⃣ Acesse o hub → RC → Cliente → Parcelas<br/>
          3️⃣ Faça upload e clique em 📧 E-mail
        </p>
      </div>

      <!-- CTA -->
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#1B263B;border-radius:10px;padding:0;">
            <a href="${HUB_URL}" style="display:block;padding:14px 28px;color:#C69C6D;font-weight:800;font-size:14px;text-decoration:none;">
              🚀 Acessar Hub RC
            </a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1B263B;border-radius:0 0 16px 16px;padding:16px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#4a6080;">F&amp;G Seguro Garantia · Lembrete automático diário</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    const totalDias = urgentes.length > 0 ? `⚡ ${urgentes.length} vencem em 3 dias` : '';
    const subjectParts = [];
    if (urgentes.length > 0) subjectParts.push(`⚡ ${urgentes.length} boleto(s) vencem em 3 dias`);
    if (normais.length > 0) subjectParts.push(`⏰ ${normais.length} em 7 dias`);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <fabio@fegsegurogarantia.com.br>',
        to: [FABIO_EMAIL],
        subject: `🔔 RC — ${subjectParts.join(' · ')} | Gerar e enviar boletos`,
        html,
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    return new Response(JSON.stringify({ ok: true, enviados: 1, boletos: items.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
