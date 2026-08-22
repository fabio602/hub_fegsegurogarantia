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

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header F&G -->
        <tr>
          <td style="background:#1B263B;border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:28px;font-weight:900;color:#C69C6D;letter-spacing:2px;">F&amp;G</p>
            <p style="margin:4px 0 0;font-size:12px;color:#8fa3bf;letter-spacing:3px;text-transform:uppercase;">Seguro Garantia</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:40px;">

            <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#1B263B;">
              Olá, ${nomeCliente}! 👋
            </p>

            <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.7;">
              Tudo bem? Passando para deixar o boleto da sua apólice disponível —
              ele está em anexo neste e-mail para facilitar o seu pagamento.
            </p>

            <!-- Destaque do boleto -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:24px;margin:0 0 24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;">Boleto de Seguro</p>
                  ${apolice ? `<p style="margin:0 0 16px;font-size:13px;color:#64748b;">Apólice: <strong>${apolice}</strong>${produto ? ` — ${produto}` : ''}</p>` : ''}
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="font-size:13px;color:#64748b;">Parcela</span>
                        <span style="float:right;font-size:14px;font-weight:800;color:#1B263B;">${parcela}ª parcela</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;">
                        <span style="font-size:13px;color:#64748b;">Vencimento</span>
                        <span style="float:right;font-size:14px;font-weight:800;color:#dc2626;">${vencFormatado}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.7;">
              O pagamento pode ser feito em qualquer banco, lotérica, pelo aplicativo do seu banco
              ou pelo <strong>Pix/código de barras</strong> que está no boleto em anexo. Simples assim! 😊
            </p>

            <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.7;">
              Qualquer dúvida — seja sobre o seguro, a apólice ou o pagamento — pode me chamar
              diretamente. Estou sempre por aqui!
            </p>

            <!-- CTA WhatsApp -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
              <tr>
                <td style="background:#25D366;border-radius:10px;padding:14px 28px;">
                  <a href="https://wa.me/5519999999999?text=Olá+Fábio%2C+tenho+uma+dúvida+sobre+meu+seguro"
                     style="color:#fff;font-weight:800;font-size:14px;text-decoration:none;">
                    💬 Falar no WhatsApp
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
              Obrigado pela confiança e pela parceria!<br/>
              <strong style="color:#1B263B;">Fábio Lima</strong><br/>
              <span style="color:#94a3b8;font-size:13px;">F&amp;G Seguro Garantia · SUSEP 242160653</span>
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">
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
      subject: `📄 Boleto disponível — ${parcela}ª Parcela${seguradora ? ` · ${seguradora}` : ''} | F&G Seguro Garantia`,
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
