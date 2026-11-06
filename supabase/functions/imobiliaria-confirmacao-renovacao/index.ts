// imobiliaria-confirmacao-renovacao: a imobiliária responde, pelo portal, se o
// inquilino renova, não renova, ou envia o distrato.
//
// A resposta de renovação ia só por WhatsApp (Z-API, cancelado), então ninguém
// ficava sabendo; só o distrato chegava por e-mail. Desde 06/11/2026 tudo vai
// por e-mail para o Fábio, com cópia para a equipe do Residencial (lista em
// residencial_config).
//
// Body: { client_id, inquilino_nome, parceiro_nome, confirmacao, vigencia_fim?,
//         distrato_url?, remove_from_portal? }
//   confirmacao: 'vai_renovar' | 'nao_vai_renovar' | 'distrato_enviado'
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bccResidencial } from '../_shared/copiasResidencial.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FABIO_EMAIL = 'fabio@fegsegurogarantia.com.br';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[m]!));
const fmtData = (d: string) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return dd ? `${dd}/${m}/${y}` : ''; };

/** Aviso interno: para o Fábio, com a equipe do Residencial em cópia oculta. */
async function avisar(subject: string, titulo: string, linhas: [string, string][], texto: string, botao?: { url: string; rotulo: string }) {
  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
      <div style="background:#1B263B;padding:24px 32px;">
        <img src="https://hub.fegsegurogarantia.com/marca/fg-logo-horizontal-bege.png" width="150" height="49" alt="F&amp;G Seguro Garantia" style="display:block;border:0;margin:0 0 14px;" />
        <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">${esc(titulo)}</h1>
        <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0;">Resposta da imobiliária pelo portal</p>
      </div>
      <div style="padding:24px 32px;background:#fff;">
        <table style="width:100%;border-collapse:collapse;">
          ${linhas.map(([k, v]) => `<tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;width:130px;">${esc(k)}</td><td style="padding:8px 0;font-size:14px;color:#1B263B;font-weight:700;">${esc(v)}</td></tr>`).join('')}
        </table>
        <p style="margin:18px 0 0;font-size:13px;color:#334155;line-height:1.6;">${esc(texto)}</p>
        ${botao ? `<p style="margin:18px 0 0;"><a href="${esc(botao.url)}" style="background:#1B263B;color:#C69C6D;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">${esc(botao.rotulo)}</a></p>` : ''}
      </div>
      <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
        <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Portal da Imobiliária, F&amp;G Seguro Garantia</p>
      </div>
    </div>`;
  const copias = (await bccResidencial(FABIO_EMAIL)).filter(e => e !== FABIO_EMAIL);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
      to: [FABIO_EMAIL],
      ...(copias.length > 0 ? { bcc: copias } : {}),
      subject,
      html,
    }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id, inquilino_nome, parceiro_nome, confirmacao, vigencia_fim, distrato_url, remove_from_portal } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const nome = inquilino_nome || '—';
    const imob = parceiro_nome || 'Imobiliária';

    if (confirmacao === 'distrato_enviado') {
      await supabase.from('imobiliaria_clientes').update({ distrato_url }).eq('id', client_id);
      await avisar(
        `📄 Distrato recebido: ${nome} (${imob})`,
        'Distrato recebido',
        [['Inquilino', nome], ['Imobiliária', imob]],
        'A imobiliária enviou o distrato pelo portal. Com ele em mãos dá para cancelar a garantia na seguradora.',
        distrato_url ? { url: distrato_url, rotulo: 'Baixar distrato' } : undefined,
      );
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Atualiza confirmação de renovação
    const updateData: Record<string, unknown> = { renovacao_confirmacao: confirmacao };
    if (remove_from_portal) updateData.partner_id = null; // Remove do portal
    await supabase.from('imobiliaria_clientes').update(updateData).eq('id', client_id);

    const vai = confirmacao === 'vai_renovar';
    const acao = vai
      ? 'Entre em contato com o inquilino para dar sequência na renovação.'
      : remove_from_portal
        ? 'O cliente foi removido do portal da imobiliária.'
        : 'Aguarde o envio do distrato pelo portal.';
    const linhas: [string, string][] = [['Inquilino', nome], ['Imobiliária', imob]];
    if (fmtData(vigencia_fim)) linhas.push(['Vencimento', fmtData(vigencia_fim)]);
    linhas.push(['Decisão', vai ? 'Vai renovar' : 'Não vai renovar']);

    await avisar(
      `${vai ? '✅ Vai renovar' : '❌ Não vai renovar'}: ${nome} (${imob})`,
      'Confirmação de renovação',
      linhas,
      acao,
    );

    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
