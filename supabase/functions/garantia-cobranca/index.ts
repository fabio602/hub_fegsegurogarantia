import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cobrança automática de boletos do seguro garantia.
 *
 * Roda uma vez por dia e dispara três avisos:
 *   D-3  → WhatsApp, 3 dias antes do vencimento
 *   D0   → WhatsApp, no dia do vencimento
 *   D+1  → WhatsApp + e-mail, no dia seguinte ao vencimento
 *
 * ── Duas fontes de vencimento ────────────────────────────────────────────
 *
 * 1. Tabela `boletos` (PARCELAS) — a fonte preferida. Cada parcela tem seu
 *    próprio vencimento, seu próprio `pago` e suas próprias marcas de envio,
 *    então uma venda em 6x recebe 6 ciclos de cobrança, e a parcela que o
 *    cliente já pagou para de ser cobrada.
 *
 * 2. Campo `sales.vencimento_boleto` (LEGADO) — usado apenas para vendas que
 *    NÃO têm nenhuma parcela cadastrada. É o comportamento antigo, mantido
 *    para não deixar de cobrar as vendas à vista já registradas assim.
 *
 * Uma venda nunca é cobrada pelos dois caminhos: se existe pelo menos uma
 * linha em `boletos` para aquela venda, o campo `vencimento_boleto` é
 * ignorado (ele costuma repetir o vencimento da parcela 1).
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')!;
const ZAPI_INSTANCE    = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN       = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT      = 'F1febfc77e5734fc38a3de6979b7c9bd8S';
const BCC_EMAIL        = 'fabio@fegsegurogarantia.com.br';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtBRL(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function cleanPhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}
/**
 * Só 'Pago' bloqueia a cobrança de parcelas.
 *
 * 'Em dia' significa "sem atraso até agora", não "quitado" — numa venda em 6x
 * ela continua verdadeira com 5 parcelas ainda por vencer. Se 'Em dia' também
 * bloqueasse, as parcelas seguintes nunca seriam cobradas.
 *
 * No caminho legado (venda à vista, sem parcelas) as duas continuam
 * bloqueando, como sempre foi.
 */
function isQuitado(status: string | null): boolean {
  return status === 'Pago';
}
function isPagoLegado(status: string | null): boolean {
  return status === 'Pago' || status === 'Em dia';
}

async function sendZAPI(phone: string, msg: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify({ phone, message: msg }),
    });
    return r.ok;
  } catch { return false; }
}
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: 'F&G Seguro Garantia <noreply@fegsegurogarantia.com.br>', to: [to], bcc: [BCC_EMAIL], subject, html }),
    });
    return r.ok;
  } catch { return false; }
}

/** "parcela 2 de 6" — vazio quando a venda não é parcelada. */
function labelParcela(parcela: number | null, total: number | null): string {
  if (!parcela || !total || total <= 1) return '';
  return ` (parcela ${parcela} de ${total})`;
}

function emailD1(nome: string, apolice: string, dataVenc: string, parcelaTxt: string, valorTxt: string): string {
  const p = (nome || 'cliente').split(' ')[0];
  const linhaParcela = parcelaTxt
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 4px">Refer&ecirc;ncia:<strong>${parcelaTxt}</strong></p>`
    : '';
  const linhaValor = valorTxt
    ? `<p style="color:#64748b;font-size:13px;margin:0 0 4px">Valor: <strong>${valorTxt}</strong></p>`
    : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:32px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:#1B263B;border-radius:16px 16px 0 0;padding:32px;text-align:center">
  <div style="display:inline-block;background:#C69C6D;border-radius:12px;padding:10px 22px;margin-bottom:10px">
    <span style="color:#1B263B;font-size:22px;font-weight:900;letter-spacing:-0.5px">F&amp;G</span>
  </div>
  <div style="color:#C69C6D;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-top:4px">Seguro Garantia</div>
</td></tr>
<tr><td style="background:#C69C6D;padding:14px 32px;text-align:center">
  <span style="color:#1B263B;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px">Lembrete de Vencimento</span>
</td></tr>
<tr><td style="background:#ffffff;padding:40px">
  <p style="color:#1B263B;font-size:18px;font-weight:900;margin:0 0 8px">Ol&aacute;, ${p}!</p>
  <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 20px">Tudo bem? Aqui &eacute; a equipe da <strong>F&amp;G Seguro Garantia</strong>.</p>
  <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 24px">Passando para lembrar que o boleto${parcelaTxt} da sua ap&oacute;lice <strong style="color:#1B263B">${apolice}</strong> venceu em <strong style="color:#C69C6D">${dataVenc}</strong>. Se j&aacute; realizou o pagamento, pode desconsiderar este aviso!</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;border-radius:12px;border-left:4px solid #C69C6D;margin-bottom:28px"><tr><td style="padding:20px 24px">
    <p style="color:#1B263B;font-size:14px;font-weight:700;margin:0 0 6px">Ap&oacute;lice</p>
    <p style="color:#C69C6D;font-size:22px;font-weight:900;margin:0 0 10px">${apolice}</p>
    ${linhaParcela}
    ${linhaValor}
    <p style="color:#64748b;font-size:13px;margin:0">Vencimento: <strong>${dataVenc}</strong></p>
  </td></tr></table>
  <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 24px">Caso precise de segunda via ou tenha alguma d&uacute;vida, &eacute; s&oacute; nos chamar &mdash; estamos aqui para ajudar.</p>
  <p style="color:#1B263B;font-size:15px;font-weight:700;margin:0">Conte sempre com a F&amp;G! &#128591;</p>
</td></tr>
<tr><td style="background:#1B263B;padding:28px 40px">
  <p style="color:#C69C6D;font-size:15px;font-weight:900;margin:0 0 4px">F&aacute;bio Lima</p>
  <p style="color:#94a3b8;font-size:13px;margin:0 0 16px">F&amp;G Seguro Garantia</p>
  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px">&#128241; (15) 99861-8659 &nbsp;|&nbsp; &#127758; fegsegurogarantia.com.br</p>
  <p style="color:#94a3b8;font-size:12px;margin:0">&#128247; @fg_segurogarantia</p>
</td></tr>
<tr><td style="background:#0f172a;border-radius:0 0 16px 16px;padding:16px;text-align:center">
  <p style="color:#475569;font-size:11px;margin:0">Lembrete autom&aacute;tico da F&amp;G Seguro Garantia. N&atilde;o responda diretamente a este e-mail.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Uma cobrança a disparar — vinda de uma parcela ou do campo legado. */
interface Alvo {
  origem: 'parcela' | 'legado';
  boletoId: number | null;   // id em `boletos` (null no legado)
  saleId: number;
  parcela: number | null;
  totalParcelas: number | null;
  vencimento: string | null;
  valor: string | null;      // já formatado em BRL, ou '' se não houver
  nome: string;
  telefone: string | null;
  email: string | null;
  apolice: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    const today    = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const d3ISO    = new Date(today.getTime() + 3 * 86400000).toISOString().split('T')[0];
    const d1ISO    = new Date(today.getTime() - 1 * 86400000).toISOString().split('T')[0];

    // ── Vendas que têm parcelas cadastradas ──────────────────────────────
    // Precisamos disso duas vezes: para saber o total de parcelas de cada
    // venda ("parcela 2 de 6") e para excluir essas vendas do caminho legado.
    const { data: todasParcelas } = await supabase
      .from('boletos')
      .select('id, sale_id, parcela, vencimento, valor, pago, cobranca_d3_sent, cobranca_d0_sent, cobranca_d1_sent')
      .limit(20000);   // o padrão do PostgREST é 1000 — cortaria parcelas silenciosamente

    const totalPorVenda = new Map<number, number>();
    // Conta só as parcelas com data: linha sem vencimento é anexo de boleto,
    // não parcela — se entrasse na conta, viraria "parcela 2 de 7".
    for (const b of (todasParcelas ?? []).filter(b => b.vencimento)) {
      totalPorVenda.set(b.sale_id, (totalPorVenda.get(b.sale_id) ?? 0) + 1);
    }

    /**
     * Vendas que o caminho das parcelas realmente cobre.
     *
     * Só entram as que têm parcela COM vencimento preenchido. Boa parte das
     * linhas antigas em `boletos` é só o anexo do boleto criado junto com a
     * venda, sem data — se elas contassem como "tem parcelas", a venda sairia
     * do caminho legado e ninguém seria cobrado.
     */
    const vendasComParcelas = new Set(
      (todasParcelas ?? []).filter(b => b.vencimento).map(b => b.sale_id)
    );

    // ── Auto-atualiza pagamento_status (nunca toca em 'Pago' ou 'Em dia') ─
    // Caminho legado: continua olhando `vencimento_boleto`.
    await supabase.from('sales')
      .update({ pagamento_status: 'Vencido' })
      .not('pagamento_status', 'in', '("Pago","Em dia")')
      .lt('vencimento_boleto', todayISO)
      .not('vencimento_boleto', 'is', null);
    await supabase.from('sales')
      .update({ pagamento_status: 'A vencer' })
      .not('pagamento_status', 'in', '("Pago","Em dia","Vencido")')
      .gte('vencimento_boleto', todayISO)
      .lte('vencimento_boleto', d3ISO)
      .not('vencimento_boleto', 'is', null);

    // Vendas parceladas: 'Vencido' quando existe QUALQUER parcela em aberto
    // com vencimento no passado. Aqui 'Em dia' pode virar 'Vencido' — é
    // justamente o caso de quem estava em dia e deixou uma parcela passar.
    const vencidasPorParcela = [...new Set(
      (todasParcelas ?? [])
        .filter(b => !b.pago && b.vencimento && b.vencimento < todayISO)
        .map(b => b.sale_id)
    )];
    if (vencidasPorParcela.length) {
      await supabase.from('sales')
        .update({ pagamento_status: 'Vencido' })
        .in('id', vencidasPorParcela)
        .neq('pagamento_status', 'Pago');
    }

    // ── Monta a lista de alvos ───────────────────────────────────────────
    const datas = [d3ISO, todayISO, d1ISO];

    const parcelasDoDia = (todasParcelas ?? []).filter(
      b => !b.pago && b.vencimento && datas.includes(b.vencimento)
    );

    const saleIdsParcelas = [...new Set(parcelasDoDia.map(b => b.sale_id))];
    const vendasPorId = new Map<number, any>();
    if (saleIdsParcelas.length) {
      const { data: vendas } = await supabase.from('sales')
        .select('id, nome, decisor, telefone, email, numero_boleto, pagamento_status, vendeu')
        .in('id', saleIdsParcelas);
      for (const v of vendas ?? []) vendasPorId.set(v.id, v);
    }

    const alvos: Alvo[] = [];

    for (const b of parcelasDoDia) {
      const s = vendasPorId.get(b.sale_id);
      if (!s) continue;
      if (s.vendeu !== 'Sim') continue;
      if (isQuitado(s.pagamento_status)) { console.log(`[parcela] venda #${s.id} quitada — skip`); continue; }
      alvos.push({
        origem: 'parcela',
        boletoId: b.id,
        saleId: s.id,
        parcela: b.parcela,
        totalParcelas: totalPorVenda.get(b.sale_id) ?? null,
        vencimento: b.vencimento,
        valor: fmtBRL(b.valor),
        nome: s.decisor || s.nome || 'cliente',
        telefone: s.telefone,
        email: s.email,
        apolice: s.numero_boleto || '—',
      });
    }

    // Caminho legado: só vendas SEM nenhuma parcela cadastrada.
    const { data: legado } = await supabase.from('sales')
      .select('id, nome, decisor, telefone, email, premio, vencimento_boleto, numero_boleto, pagamento_status, cobranca_d3_sent, cobranca_d0_sent, cobranca_d1_sent')
      .eq('vendeu', 'Sim')
      .in('vencimento_boleto', datas)
      .not('vencimento_boleto', 'is', null);

    const legadoFlags = new Map<number, any>();
    for (const s of legado ?? []) {
      if (vendasComParcelas.has(s.id)) continue;   // já coberta pelas parcelas
      if (isPagoLegado(s.pagamento_status)) { console.log(`[legado] venda #${s.id} paga — skip`); continue; }
      legadoFlags.set(s.id, s);
      alvos.push({
        origem: 'legado',
        boletoId: null,
        saleId: s.id,
        parcela: null,
        totalParcelas: null,
        vencimento: s.vencimento_boleto,
        valor: fmtBRL(s.premio),
        nome: s.decisor || s.nome || 'cliente',
        telefone: s.telefone,
        email: s.email,
        apolice: s.numero_boleto || '—',
      });
    }

    // ── Já enviado? ──────────────────────────────────────────────────────
    const jaEnviado = (a: Alvo, campo: 'cobranca_d3_sent' | 'cobranca_d0_sent' | 'cobranca_d1_sent'): boolean => {
      if (a.origem === 'parcela') {
        const b = parcelasDoDia.find(x => x.id === a.boletoId);
        return Boolean(b?.[campo]);
      }
      return Boolean(legadoFlags.get(a.saleId)?.[campo]);
    };
    const marcarEnviado = async (a: Alvo, campo: 'cobranca_d3_sent' | 'cobranca_d0_sent' | 'cobranca_d1_sent') => {
      if (a.origem === 'parcela') {
        await supabase.from('boletos').update({ [campo]: true }).eq('id', a.boletoId!);
      } else {
        await supabase.from('sales').update({ [campo]: true }).eq('id', a.saleId);
      }
    };

    let sent_d3 = 0, sent_d0 = 0, sent_d1 = 0, errors = 0;

    // ── D-3 ──────────────────────────────────────────────────────────────
    for (const a of alvos.filter(x => x.vencimento === d3ISO)) {
      if (jaEnviado(a, 'cobranca_d3_sent')) continue;
      const phone = cleanPhone(a.telefone); if (!phone) continue;
      const p = a.nome.split(' ')[0];
      const ref = labelParcela(a.parcela, a.totalParcelas);
      const msg =
        `Oi ${p}! Aqui é a F&G Seguro Garantia.\n\n` +
        `Hoje vim trazer algumas informações sobre sua apólice ${a.apolice}. ` +
        `Seu boleto${ref} vence em 3 dias, no dia ${fmtDate(a.vencimento)}.` +
        (a.valor ? ` Valor: ${a.valor}.` : '') + `\n\n` +
        `Se precisar de qualquer apoio, conte comigo. 😊`;
      if (await sendZAPI(phone, msg)) { await marcarEnviado(a, 'cobranca_d3_sent'); sent_d3++; }
      else errors++;
      await new Promise(r => setTimeout(r, 1000));
    }

    // ── D0 ───────────────────────────────────────────────────────────────
    for (const a of alvos.filter(x => x.vencimento === todayISO)) {
      if (jaEnviado(a, 'cobranca_d0_sent')) continue;
      const phone = cleanPhone(a.telefone); if (!phone) continue;
      const p = a.nome.split(' ')[0];
      const ref = labelParcela(a.parcela, a.totalParcelas);
      const msg =
        `Oi ${p}! Aqui é a F&G Seguro Garantia.\n\n` +
        `Seu boleto${ref} da apólice ${a.apolice} vence hoje, ${fmtDate(a.vencimento)}.` +
        (a.valor ? ` Valor: ${a.valor}.` : '') + `\n\n` +
        `Se já está tudo certo, ótimo! Qualquer dúvida estamos aqui. 😊`;
      if (await sendZAPI(phone, msg)) { await marcarEnviado(a, 'cobranca_d0_sent'); sent_d0++; }
      else errors++;
      await new Promise(r => setTimeout(r, 1000));
    }

    // ── D+1 ──────────────────────────────────────────────────────────────
    for (const a of alvos.filter(x => x.vencimento === d1ISO)) {
      if (jaEnviado(a, 'cobranca_d1_sent')) continue;
      const phone = cleanPhone(a.telefone);
      const data  = fmtDate(a.vencimento);
      const ref   = labelParcela(a.parcela, a.totalParcelas);
      let wppOk = false, emailOk = false;
      if (phone) {
        const p = a.nome.split(' ')[0];
        const msg =
          `Oi ${p}! Aqui é a F&G Seguro Garantia.\n\n` +
          `O boleto${ref} da sua apólice ${a.apolice} venceu ontem, ${data}.` +
          (a.valor ? ` Valor: ${a.valor}.` : '') + `\n\n` +
          `Se já realizou o pagamento, ótimo! Caso precise de algum apoio, estamos à disposição. 🙏`;
        wppOk = await sendZAPI(phone, msg);
        await new Promise(r => setTimeout(r, 1000));
      }
      if (a.email) {
        const assunto = ref
          ? `Lembrete — Boleto${ref} da apólice ${a.apolice}`
          : `Lembrete — Boleto da apólice ${a.apolice}`;
        emailOk = await sendEmail(a.email, assunto, emailD1(a.nome, a.apolice, data, ref, a.valor || ''));
      }
      if (wppOk || emailOk) {
        await marcarEnviado(a, 'cobranca_d1_sent');
        sent_d1++;
        console.log(`[D+1] OK: ${a.nome}${ref} wpp=${wppOk} email=${emailOk}`);
      } else errors++;
    }

    const porParcela = alvos.filter(a => a.origem === 'parcela').length;
    console.log(`[garantia-cobranca] alvos:${alvos.length} (parcelas:${porParcela} legado:${alvos.length - porParcela}) D-3:${sent_d3} D0:${sent_d0} D+1:${sent_d1} erros:${errors}`);
    return new Response(JSON.stringify({
      success: true,
      alvos: { total: alvos.length, parcelas: porParcela, legado: alvos.length - porParcela },
      sent: { d3: sent_d3, d0: sent_d0, d1: sent_d1 },
      errors,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[garantia-cobranca]', msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
