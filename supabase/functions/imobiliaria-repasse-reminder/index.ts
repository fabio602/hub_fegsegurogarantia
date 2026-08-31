import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { bccResidencial } from '../_shared/copiasResidencial.ts';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC = 'fabio@fegsegurogarantia.com.br';
const FABIO_WPP = '5515998618659';
const ZAPI_INSTANCE = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT = 'F1febfc77e5734fc38a3de6979b7c9bd8S';

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const avisarFabio = async (mensagem: string) => {
  await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
    body: JSON.stringify({ phone: FABIO_WPP, message: mensagem }),
  }).catch(() => {});
};

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const hoje = new Date();
    // Dia de vencimento que cai em 10 dias
    const diaAlvo = new Date(hoje);
    diaAlvo.setDate(diaAlvo.getDate() + 10);
    const diaMes = diaAlvo.getDate();
    const mesAtual = hoje.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    // Busca clientes com vencimento no dia alvo
    const { data: clientes } = await supabase
      .from('imobiliaria_clientes')
      .select('*, partners!inner(name, email, email_2)')
      .eq('dia_vencimento_aluguel', diaMes)
      .eq('is_repasse', true)
      .eq('status_apolice', 'ativo')
      .not('partner_id', 'is', null);

    // Cadastro sem valor mensal não pode entrar no e-mail: a imobiliária
    // receberia uma cobrança de R$ 0,00, que parece erro nosso (e é).
    // Separamos os dois grupos: os que vão no e-mail e os que ficam de fora.
    const comValor = (clientes || []).filter((c: any) => Number(c.valor_seguro || 0) > 0);
    const semValor = (clientes || []).filter((c: any) => !(Number(c.valor_seguro || 0) > 0));

    // O que ficou de fora não pode passar despercebido — avisamos o Fábio.
    if (semValor.length > 0) {
      const lista = semValor
        .map((c: any) => `• ${c.inquilino_nome} (${(c as any).partners?.name || 'sem parceiro'}) — venc. dia ${c.dia_vencimento_aluguel}`)
        .join('\n');
      await avisarFabio(
        `⚠️ *Repasse não enviado — falta o valor do seguro*\n\n` +
        `${semValor.length} cadastro(s) estão marcados como repasse com vencimento dia ${diaMes}, ` +
        `mas com valor mensal zerado. Não mandei e-mail para a imobiliária.\n\n${lista}\n\n` +
        `Preencha o "Valor Mensal (R$)" no hub para que entrem no próximo aviso.`,
      );
    }

    if (comValor.length === 0) {
      return new Response(JSON.stringify({ success: true, enviados: 0, ignorados_sem_valor: semValor.length, msg: `Nenhum repasse com valor para dia ${diaMes}` }), { status: 200 });
    }

    // Agrupa por parceiro
    const porParceiro = new Map<number, { nome: string; email: string; email2?: string; clientes: any[] }>();
    for (const c of comValor) {
      const pid = c.partner_id;
      if (!porParceiro.has(pid)) {
        porParceiro.set(pid, { nome: (c as any).partners.name, email: (c as any).partners.email, email2: (c as any).partners.email_2, clientes: [] });
      }
      porParceiro.get(pid)!.clientes.push(c);
    }

    let enviados = 0;
    for (const [, p] of porParceiro) {
      if (!p.email) continue;
      const total = p.clientes.reduce((s, c) => s + Number(c.valor_seguro || 0), 0);
      const dataVenc = `${String(diaMes).padStart(2,'0')}/${String(diaAlvo.getMonth()+1).padStart(2,'0')}/${diaAlvo.getFullYear()}`;

      const listaHtml = p.clientes.map(c => `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #f0ece4;font-weight:800;color:#1B263B;">${c.inquilino_nome||'—'}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #f0ece4;font-size:12px;color:#78716c;">${c.numero_apolice||'—'}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #f0ece4;text-align:right;font-weight:900;color:#1B263B;">${fmtBRL(Number(c.valor_seguro||0))}</td>
        </tr>`).join('');

      const html = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;border:1px solid #e8e4dc;border-radius:16px;overflow:hidden;">
          <div style="background:#1B263B;padding:24px 32px;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;">
              <tr><td style="background:#C69C6D;border-radius:12px;padding:10px 20px;"><span style="color:#1B263B;font-weight:900;font-size:18px;">F&amp;G</span></td></tr>
            </table>
            <h1 style="color:#fff;font-size:17px;font-weight:900;margin:0;text-align:center;">💳 Aviso de Repasse — ${mesAtual}</h1>
            <p style="color:rgba(255,255,255,.5);font-size:12px;margin:5px 0 0;text-align:center;">Vencimento: ${dataVenc}</p>
          </div>
          <div style="padding:24px 32px;background:#fff;">
            <p style="color:#1B263B;font-size:15px;margin:0 0 16px;">Prezados <strong>${p.nome}</strong>,</p>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">
              Os seguros abaixo vencem o aluguel no dia <strong>${dataVenc}</strong>. Por favor realize o repasse até esta data.
            </p>
            <table style="width:100%;border-collapse:collapse;background:#f8f5f0;border-radius:12px;overflow:hidden;">
              <thead><tr style="background:#1B263B;">
                <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.6);">Inquilino</th>
                <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.6);">Apólice</th>
                <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#C69C6D;">Valor</th>
              </tr></thead>
              <tbody>${listaHtml}</tbody>
              <tfoot><tr style="background:#1B263B;">
                <td colspan="2" style="padding:12px 16px;font-weight:900;font-size:13px;color:#fff;">TOTAL A REPASSAR</td>
                <td style="padding:12px 16px;text-align:right;font-weight:900;font-size:15px;color:#C69C6D;">${fmtBRL(total)}</td>
              </tr></tfoot>
            </table>
            <div style="margin-top:20px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
              <p style="margin:0;font-size:13px;color:#166534;">Chave PIX e dados bancários estão disponíveis no seu portal de parceiros.</p>
            </div>
          </div>
          <div style="background:#f8f5f0;padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
            <p style="margin:0;font-weight:900;color:#1B263B;font-size:12px;">Equipe F&amp;G Seguro Garantia</p>
          </div>
        </div>`;

      const to = [p.email]; if (p.email2) to.push(p.email2);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
          to, bcc: await bccResidencial(BCC),
          subject: `💳 Repasse de seguro — vencimento ${dataVenc} — ${p.nome}`,
          html,
        }),
      });

      // WhatsApp para Fábio
      await avisarFabio(`💳 *Repasse enviado*\n\n*Parceiro:* ${p.nome}\n*Vencimento:* ${dataVenc}\n*${p.clientes.length} cliente(s)* — Total: ${fmtBRL(total)}\n\nO relatório foi enviado por email para a imobiliária.`);

      enviados++;
    }

    return new Response(JSON.stringify({ success: true, enviados, ignorados_sem_valor: semValor.length, dia_alvo: diaMes }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400 });
  }
});
