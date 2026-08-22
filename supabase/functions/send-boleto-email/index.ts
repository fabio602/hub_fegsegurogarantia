import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { toEmail, toName, parcela, vencimento, boletoUrl, apolice, produto, seguradora } = await req.json();

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY não configurado');

    // Formata a data de vencimento para exibição
    const vencFormatado = vencimento
      ? new Date(vencimento + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '—';

    // Busca o PDF do Storage Supabase para anexar
    let attachment: { filename: string; content: string } | null = null;
    if (boletoUrl) {
      try {
        const pdfRes = await fetch(boletoUrl);
        if (pdfRes.ok) {
          const buffer = await pdfRes.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          attachment = {
            filename: `boleto-parcela-${parcela}.pdf`,
            content: base64,
          };
        }
      } catch (_) { /* PDF indisponível, envia sem anexo */ }
    }

    const nomeCliente = toName ? toName.split(' ')[0] : 'Cliente';
    const whatsappMsg = encodeURIComponent(`Olá, Fábio! Sou ${toName} e tenho uma dúvida sobre o meu seguro.`);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1B263B 0%,#243447 100%);border-radius:20px 20px 0 0;padding:36px 48px;text-align:center;">
            <p style="margin:0 0 4px;font-size:32px;font-weight:900;color:#C69C6D;letter-spacing:3px;">F&amp;G</p>
            <p style="margin:0;font-size:11px;color:#7a9bbf;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Seguro Garantia</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:44px 48px;">

            <!-- Saudação calorosa -->
            <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1B263B;">Olá, ${nomeCliente}! 😊</p>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.75;">
              Espero que esteja tudo bem por aí! Passando rapidinho para te lembrar que a
              <strong style="color:#1B263B;">${parcela}ª parcela</strong> do seu
              <strong style="color:#1B263B;">Seguro de Responsabilidade Civil</strong> vence em
              <strong style="color:#C69C6D;">${vencFormatado}</strong> — e já deixei o boleto
              em anexo para facilitar a sua vida. 📎
            </p>

            <!-- Card destaque -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafbff;border:2px solid #e8edf5;border-left:5px solid #C69C6D;border-radius:12px;margin:0 0 28px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;">📄 Boleto em Anexo</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px dashed #e2e8f0;">
                        <span style="font-size:13px;color:#64748b;">Parcela</span>
                        <span style="float:right;font-size:15px;font-weight:800;color:#1B263B;">${parcela}ª de 5</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <span style="font-size:13px;color:#64748b;">Vencimento</span>
                        <span style="float:right;font-size:15px;font-weight:800;color:#dc2626;">${vencFormatado}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 12px;font-size:15px;color:#475569;line-height:1.75;">
              O pagamento é bem simples: pode usar o <strong>código de barras</strong>,
              o <strong>Pix</strong> ou pagar em qualquer <strong>banco, lotérica ou app</strong>.
              Tudo certinho no boleto em anexo. 👍
            </p>

            <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.75;">
              Se já realizou o pagamento, pode desconsiderar esta mensagem.
              Mas se surgir qualquer dúvida — sobre o boleto, a apólice ou qualquer outra coisa —
              <strong>é só me chamar!</strong> Estou sempre aqui para ajudar. 🤝
            </p>

            <!-- Botão WhatsApp -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 36px;">
              <tr>
                <td style="background:#25D366;border-radius:12px;padding:0;">
                  <a href="https://wa.me/5515998618659?text=${whatsappMsg}"
                     style="display:block;padding:16px 32px;color:#fff;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:0.3px;">
                    💬 Me chame no WhatsApp
                  </a>
                </td>
              </tr>
            </table>

            <!-- Assinatura -->
            <table cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding-top:24px;width:100%;">
              <tr>
                <td>
                  <p style="margin:0 0 4px;font-size:15px;font-weight:800;color:#1B263B;">Fábio Lima</p>
                  <p style="margin:0 0 12px;font-size:13px;color:#64748b;font-weight:600;">F&amp;G Seguro Garantia</p>
                  <p style="margin:0;font-size:13px;color:#94a3b8;line-height:2;">
                    📱 <a href="https://wa.me/5515998618659" style="color:#25D366;text-decoration:none;font-weight:600;">(15) 99861-8659</a><br/>
                    🌐 <a href="https://fegsegurogarantia.com.br" style="color:#C69C6D;text-decoration:none;">fegsegurogarantia.com.br</a><br/>
                    📷 <a href="https://instagram.com/fg_segurogarantia" style="color:#C69C6D;text-decoration:none;">@fg_segurogarantia</a>
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#1B263B;border-radius:0 0 20px 20px;padding:20px 48px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#4a6080;line-height:1.8;">
              F&amp;G Corretora de Seguros · CNPJ 56.123.874/0001-90 · SUSEP 242160653<br/>
              <a href="mailto:fabio@fegsegurogarantia.com.br" style="color:#C69C6D;text-decoration:none;">fabio@fegsegurogarantia.com.br</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const emailPayload: Record<string, unknown> = {
      from: 'F&G Seguro Garantia <fabio@fegsegurogarantia.com.br>',
      to: [toEmail],
      subject: `📄 Seu boleto chegou — ${parcela}ª parcela do Seguro RC | F&G`,
      html,
    };

    if (attachment) {
      emailPayload.attachments = [{
        filename: attachment.filename,
        content: attachment.content,
        content_type: 'application/pdf',
      }];
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(emailPayload),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      throw new Error(`Resend error: ${err}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
