// imobiliaria-repasse-atraso: lembra a imobiliária dos repasses que passaram do
// vencimento sem comprovante no portal. Pedido do Fábio em 28/11/2026.
//
// Roda todo dia pelo cron imobiliaria-repasse-atraso-daily (migração 148). Um
// e-mail por imobiliária, com todos os atrasados dela. Quem entra e de quanto
// em quanto tempo está em regras.ts. Parcela com comprovante já enviado (em
// conferência) não é cobrada.
//
// Body: {}                 envia
//       { previa: true }   só devolve quem receberia, sem enviar nem carimbar

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bccResidencial } from '../_shared/copiasResidencial.ts';
import { quemAvisar, type ClienteAtraso } from './regras.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';
const HUB_URL = 'https://hub.fegsegurogarantia.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

type Linha = ClienteAtraso & { dias_atraso: number; partners: { name: string; email: string | null; email_2: string | null } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const corpo = await req.json().catch(() => ({})) as { previa?: boolean };
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const hoje = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const { data: clientes, error } = await sb.from('imobiliaria_clientes')
      .select('id, partner_id, inquilino_nome, numero_apolice, valor_seguro, parcela_atual, total_parcelas, proximo_vencimento, repasse_atraso_avisado_em, partners!inner(name, email, email_2)')
      .eq('is_repasse', true)
      .eq('status_apolice', 'ativo')
      .lt('proximo_vencimento', hoje);
    if (error) throw new Error(error.message);

    const { data: enviados, error: errPag } = await sb.from('imobiliaria_repasse_pagamentos')
      .select('client_id, parcela').eq('status', 'enviado');
    if (errPag) throw new Error(errPag.message);
    const emConferencia = new Set((enviados ?? []).map((p) => `${p.client_id}|${p.parcela}`));

    const atrasados = quemAvisar((clientes ?? []) as unknown as Linha[], emConferencia, hoje);

    const porParceiro = new Map<number, Linha[]>();
    for (const c of atrasados) {
      if (!porParceiro.has(c.partner_id)) porParceiro.set(c.partner_id, []);
      porParceiro.get(c.partner_id)!.push(c);
    }

    const resumo = [...porParceiro.values()].map((lista) => ({
      imobiliaria: lista[0].partners.name,
      email: lista[0].partners.email,
      clientes: lista.map((c) => ({ inquilino: c.inquilino_nome, valor: Number(c.valor_seguro), vencimento: c.proximo_vencimento, dias_atraso: c.dias_atraso })),
    }));
    if (corpo.previa) return json({ success: true, previa: true, hoje, avisos: resumo });
    if (!RESEND_KEY) throw new Error('RESEND_API_KEY não configurada');

    let enviadosOk = 0;
    for (const lista of porParceiro.values()) {
      const p = lista[0].partners;
      if (!p.email) continue;
      lista.sort((a, b) => String(a.proximo_vencimento).localeCompare(String(b.proximo_vencimento)));
      const total = lista.reduce((s, c) => s + Number(c.valor_seguro || 0), 0);
      const linhas = lista.map((c) => `
        <tr style="border-bottom:1px solid #f0ece4;">
          <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1B263B;">${esc(c.inquilino_nome)}</td>
          <td style="padding:12px 16px;font-size:13px;color:#5B6472;">${c.parcela_atual} de ${c.total_parcelas ?? '?'}</td>
          <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1B263B;">${brl(c.valor_seguro)}</td>
          <td style="padding:12px 16px;font-size:13px;color:#9a1239;font-weight:700;">${dataBR(c.proximo_vencimento)} · ${c.dias_atraso} ${c.dias_atraso === 1 ? 'dia' : 'dias'}</td>
        </tr>`).join('');
      const th = 'padding:10px 16px;text-align:left;font-size:12px;font-weight:700;color:rgba(255,255,255,.8);';

      const html = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
          <div style="background:#1B263B;padding:24px 32px;">
            <img src="${HUB_URL}/marca/fg-logo-horizontal-bege.png" width="150" height="49" alt="F&amp;G Seguro Garantia" style="display:block;border:0;margin:0 0 12px;" />
            <h1 style="color:#fff;font-size:17px;font-weight:700;margin:0;">Repasse do seguro em atraso</h1>
            <p style="color:rgba(255,255,255,.7);font-size:12px;margin:4px 0 0;">Ainda não recebemos o comprovante destas parcelas</p>
          </div>
          <div style="padding:24px 32px;background:#fff;">
            <p style="color:#1B263B;font-size:14px;margin:0 0 16px;">Prezados <strong>${esc(p.name)}</strong>,</p>
            <p style="color:#475569;font-size:13px;margin:0 0 20px;line-height:1.6;">
              O repasse do seguro dos inquilinos abaixo passou do vencimento e ainda não temos o comprovante.
              Se o PIX já foi feito, basta anexar o comprovante no portal, em <strong>Fatura Mensal</strong>, e desconsiderar este aviso.
            </p>
            <table style="width:100%;border-collapse:collapse;background:#f8f5f0;border-radius:12px;overflow:hidden;">
              <thead><tr style="background:#1B263B;">
                <th style="${th}">Inquilino</th><th style="${th}">Parcela</th><th style="${th}">Valor</th><th style="${th}">Venceu em</th>
              </tr></thead>
              <tbody>${linhas}</tbody>
              <tfoot><tr style="background:#1B263B;">
                <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;color:#fff;">Total em atraso</td>
                <td colspan="2" style="padding:12px 16px;font-size:15px;font-weight:700;color:#C69C6D;">${brl(total)}</td>
              </tr></tfoot>
            </table>
            <div style="margin-top:20px;padding:14px 18px;background:#f8f5f0;border:1px solid #e8e4dc;border-radius:12px;">
              <p style="margin:0;font-size:13px;color:#1B263B;line-height:1.6;">
                Para anexar o comprovante, acesse o portal:<br/>
                <a href="${HUB_URL}/imobiliaria.html" style="color:#7A5D33;font-weight:700;">hub.fegsegurogarantia.com/imobiliaria.html</a>
              </p>
            </div>
          </div>
          <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
            <p style="margin:0;font-weight:700;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
          </div>
        </div>`;

      const to = [p.email];
      if (p.email_2) to.push(p.email_2);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
          to, bcc: await bccResidencial(BCC),
          subject: `Repasse em atraso: ${lista.length} ${lista.length === 1 ? 'inquilino' : 'inquilinos'} · ${brl(total)}`,
          html,
        }),
      });
      if (!res.ok) { console.error('[imobiliaria-repasse-atraso]', p.name, res.status, await res.text()); continue; }

      // Só carimba quem de fato foi avisado.
      await sb.from('imobiliaria_clientes').update({ repasse_atraso_avisado_em: hoje }).in('id', lista.map((c) => c.id));
      enviadosOk++;
    }

    return json({ success: true, hoje, enviados: enviadosOk, avisos: resumo });
  } catch (e) {
    console.error('[imobiliaria-repasse-atraso]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
