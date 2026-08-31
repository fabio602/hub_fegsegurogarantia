// imobiliaria-encerramento — avisa a imobiliária, por e-mail, que um seguro foi
// encerrado: o inquilino saiu do imóvel, não vai renovar, desistiu ou foi
// reprovado.
//
// Antes esse aviso não existia. O hub dava a baixa em silêncio e a imobiliária
// só descobria quando o cliente sumia da lista do portal, ou quando o repasse
// daquele mês vinha menor sem explicação. Esta function fecha o ciclo: mesma
// linguagem do e-mail de recado, com o motivo e a data do encerramento.
//
// Body: { client_id: string, motivo: string, observacao?: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { bccResidencial } from '../_shared/copiasResidencial.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';
const PORTAL = 'https://hub.fegsegurogarantia.com/imobiliaria.html';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Escapa HTML — motivo e observação são texto que vem da tela. */
const esc = (s: string) => (s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/\n/g, '<br>');

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { client_id, motivo, observacao } = await req.json();
    if (!client_id) return json({ error: 'client_id é obrigatório' }, 400);
    if (!motivo) return json({ error: 'motivo é obrigatório' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: cliente, error } = await supabase
      .from('imobiliaria_clientes')
      .select('*, partners(name, email, email_2)')
      .eq('id', client_id)
      .single();

    if (error || !cliente) return json({ error: 'Cadastro não encontrado' }, 404);

    const parceiro = (cliente as any).partners;
    const to: string[] = [];
    if (parceiro?.email) to.push(parceiro.email);
    if (parceiro?.email_2) to.push(parceiro.email_2);

    if (to.length === 0) {
      return json({ error: `O parceiro ${parceiro?.name || ''} não tem e-mail cadastrado.` }, 400);
    }

    // A imobiliária precisa saber se para de repassar. Só faz sentido falar
    // disso quando havia repasse de verdade, com valor.
    const eraRepasse = cliente.is_repasse === true && Number(cliente.valor_seguro) > 0;
    const blocoRepasse = eraRepasse
      ? `<div style="margin-top:18px;padding:16px 18px;background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:12px;">
           <p style="margin:0 0 6px;font-size:10px;font-weight:900;color:#166534;text-transform:uppercase;letter-spacing:1px;">Repasse mensal</p>
           <p style="margin:0;font-size:13px;color:#14532d;line-height:1.6;">
             A parcela de <strong>${fmtBRL(Number(cliente.valor_seguro))}</strong> deste cliente sai da sua cobrança a partir do próximo relatório.
             Nada precisa ser feito da sua parte.
           </p>
         </div>`
      : '';

    const blocoObs = (observacao || '').trim()
      ? `<div style="margin-top:16px;padding:14px 18px;background:#f8f5f0;border:1px solid #e8e4dc;border-radius:12px;">
           <p style="margin:0 0 6px;font-size:10px;font-weight:900;color:#78716c;text-transform:uppercase;letter-spacing:1px;">Observação</p>
           <p style="margin:0;font-size:13px;color:#1e3a5f;line-height:1.6;">${esc(observacao)}</p>
         </div>`
      : '';

    const apolice = cliente.numero_apolice
      ? `<p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;">Apólice ${esc(String(cliente.numero_apolice))}</p>`
      : '';

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
        <div style="background:#1B263B;padding:24px 32px;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
            <tr><td style="background:#C69C6D;border-radius:12px;padding:8px 18px;"><span style="color:#1B263B;font-weight:900;font-size:16px;">F&amp;G</span></td></tr>
          </table>
          <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;">Seguro encerrado</h1>
          <p style="color:rgba(255,255,255,.5);font-size:12px;margin:4px 0 0;">Cliente: ${esc(cliente.inquilino_nome || '—')}</p>
          ${apolice}
        </div>
        <div style="padding:24px 32px;background:#fff;">
          <p style="color:#1B263B;font-size:14px;margin:0 0 16px;">Olá <strong>${esc(parceiro?.name || '')}</strong>,</p>
          <p style="color:#475569;font-size:13px;margin:0 0 18px;line-height:1.6;">
            Encerramos o seguro de <strong>${esc(cliente.inquilino_nome || '—')}</strong> junto à seguradora.
            O cadastro sai da lista de clientes ativos do portal e passa a aparecer como encerrado.
          </p>
          <div style="padding:16px 18px;background:#faf5ff;border:1px solid #ddd6fe;border-left:4px solid #7c3aed;border-radius:12px;">
            <p style="margin:0 0 6px;font-size:10px;font-weight:900;color:#5b21b6;text-transform:uppercase;letter-spacing:1px;">Motivo</p>
            <p style="margin:0;font-size:14px;color:#1e3a5f;line-height:1.6;">${esc(motivo)}</p>
          </div>
          ${blocoObs}
          ${blocoRepasse}
          <p style="color:#475569;font-size:13px;margin:20px 0 0;line-height:1.6;">
            Se alguma coisa aí não bate com o que vocês têm, é só responder este e-mail que a gente acerta.
          </p>
          <div style="margin-top:20px;padding:14px 18px;background:#f8f5f0;border:1px solid #e8e4dc;border-radius:12px;">
            <p style="margin:0;font-size:12px;color:#78716c;line-height:1.6;">
              Para ver a situação completa do cadastro:<br/>
              <a href="${PORTAL}" style="color:#C69C6D;font-weight:700;">hub.fegsegurogarantia.com/imobiliaria.html</a>
            </p>
          </div>
        </div>
        <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to,
        bcc: await bccResidencial(BCC),
        reply_to: BCC,
        subject: `Seguro encerrado: ${cliente.inquilino_nome || 'cadastro'}`,
        html,
      }),
    });

    if (!res.ok) {
      const detalhe = await res.text();
      return json({ error: 'Falha no envio do e-mail', detalhe }, 502);
    }

    return json({ success: true, enviado_para: to });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
