import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;

// Cópia oculta sempre para o Fábio: sem isso não há como saber que o
// relatório saiu, nem conferir o que o parceiro recebeu.
const BCC = 'fabio@fegsegurogarantia.com.br';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MOCK_CLIENTES = [
  { inquilino_nome: 'Maria da Silva', numero_apolice: 'APL-2024-001', valor_seguro: 120.00, parcela_atual: 3, total_parcelas: 12, proximo_vencimento: '2026-10-05' },
  { inquilino_nome: 'João Carlos Oliveira', numero_apolice: 'APL-2024-002', valor_seguro: 95.50, parcela_atual: 7, total_parcelas: 12, proximo_vencimento: '2026-10-12' },
  { inquilino_nome: 'Ana Paula Ferreira', numero_apolice: 'APL-2024-003', valor_seguro: 148.00, parcela_atual: 1, total_parcelas: 12, proximo_vencimento: '2026-10-20' },
];

// Geometria da página (A4 retrato)
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_L = 40;
const MARGIN_R = 555;
const CONTENT_W = MARGIN_R - MARGIN_L;
const ROW_H = 18;
const FOOTER_RESERVE = 60;

const COLS = { inquilino: MARGIN_L, apolice: 205, valor: 290, parcela: 375, vencimento: 435 };

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function monthYear(): string {
  return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

/** '2026-10-01' -> '01/10/2026' */
function fmtData(iso: string | null): string {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

/** Converte bytes em base64 sem estourar a call stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function generatePDF(clientes: any[], competencia: string, parceiroNome: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const navy = rgb(0.106, 0.149, 0.231);
  const gold = rgb(0.776, 0.612, 0.427);
  const white = rgb(1, 1, 1);
  const gray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.95, 0.95, 0.95);

  let page: any;
  let y = 0;
  let rowIndex = 0;

  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN_L, y: y - 16, width: CONTENT_W, height: 20, color: navy });
    page.drawText('Inquilino', { x: COLS.inquilino + 4, y: y - 12, size: 8, font: fontBold, color: white });
    page.drawText('Nº Apólice', { x: COLS.apolice + 4, y: y - 12, size: 8, font: fontBold, color: white });
    page.drawText('Valor', { x: COLS.valor + 4, y: y - 12, size: 8, font: fontBold, color: white });
    page.drawText('Parcela', { x: COLS.parcela + 4, y: y - 12, size: 8, font: fontBold, color: white });
    page.drawText('Vencimento', { x: COLS.vencimento + 4, y: y - 12, size: 8, font: fontBold, color: white });
    y -= 20;
  };

  const addPage = (first: boolean) => {
    page = doc.addPage([PAGE_W, PAGE_H]);

    if (first) {
      page.drawRectangle({ x: 0, y: PAGE_H - 80, width: PAGE_W, height: 80, color: navy });
      page.drawText('F&G Seguro Garantia', { x: MARGIN_L, y: PAGE_H - 35, size: 16, font: fontBold, color: white });
      page.drawText(`Relatório de Repasse — ${parceiroNome}`, { x: MARGIN_L, y: PAGE_H - 55, size: 10, font, color: gold });
      page.drawText(`Competência: ${competencia}`, { x: MARGIN_L, y: PAGE_H - 72, size: 9, font, color: rgb(0.8, 0.8, 0.8) });
      page.drawText(`Gerado em: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, { x: 430, y: PAGE_H - 55, size: 9, font, color: rgb(0.8, 0.8, 0.8) });

      y = PAGE_H - 110;

      // Sem data fixa: cada repasse vence no dia do respectivo aluguel,
      // e a coluna "Vencimento" já diz qual é.
      page.drawRectangle({ x: MARGIN_L, y: y - 30, width: CONTENT_W, height: 36, color: lightGray });
      page.drawText('Pagamento via PIX até o vencimento de cada parcela:', { x: MARGIN_L + 10, y: y - 10, size: 9, font, color: gray });
      page.drawText('Chave PIX (CNPJ): 56.123.874/0001-90 — F&G Seguro Garantia', { x: MARGIN_L + 10, y: y - 22, size: 10, font: fontBold, color: navy });

      y -= 55;
    } else {
      page.drawRectangle({ x: 0, y: PAGE_H - 46, width: PAGE_W, height: 46, color: navy });
      page.drawText('F&G Seguro Garantia', { x: MARGIN_L, y: PAGE_H - 26, size: 11, font: fontBold, color: white });
      page.drawText(`Relatório de Repasse — ${parceiroNome} — ${competencia}`, { x: MARGIN_L, y: PAGE_H - 39, size: 8, font, color: gold });
      y = PAGE_H - 70;
    }

    drawTableHeader();
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < FOOTER_RESERVE) addPage(false);
  };

  addPage(true);

  let total = 0;
  const trunc = (s: string | null, max: number) => {
    const v = (s ?? '').trim();
    if (!v) return '—';
    return v.length > max ? v.slice(0, max) + '…' : v;
  };

  for (const c of clientes) {
    ensureSpace(ROW_H);

    if (rowIndex % 2 === 0) {
      page.drawRectangle({ x: MARGIN_L, y: y - 14, width: CONTENT_W, height: 18, color: lightGray });
    }
    const rowY = y - 10;
    page.drawText(trunc(c.inquilino_nome, 26), { x: COLS.inquilino + 4, y: rowY, size: 8, font, color: navy });
    page.drawText(trunc(c.numero_apolice, 13), { x: COLS.apolice + 4, y: rowY, size: 8, font, color: navy });
    page.drawText(fmtBRL(Number(c.valor_seguro)), { x: COLS.valor + 4, y: rowY, size: 8, font, color: navy });
    page.drawText(`${c.parcela_atual ?? '-'}/${c.total_parcelas ?? '-'}`, { x: COLS.parcela + 4, y: rowY, size: 8, font, color: navy });
    page.drawText(fmtData(c.proximo_vencimento), { x: COLS.vencimento + 4, y: rowY, size: 8, font, color: navy });

    total += Number(c.valor_seguro);
    rowIndex++;
    y -= ROW_H;
  }

  ensureSpace(32);
  y -= 6;
  page.drawRectangle({ x: MARGIN_L, y: y - 16, width: CONTENT_W, height: 20, color: gold });
  page.drawText('TOTAL A REPASSAR', { x: COLS.inquilino + 4, y: y - 12, size: 9, font: fontBold, color: white });
  page.drawText(`${clientes.length} inquilino(s)`, { x: COLS.apolice + 4, y: y - 12, size: 9, font: fontBold, color: white });
  page.drawText(fmtBRL(total), { x: COLS.valor + 4, y: y - 12, size: 9, font: fontBold, color: white });

  const pages = doc.getPages();
  pages.forEach((p: any, i: number) => {
    p.drawLine({ start: { x: MARGIN_L, y: 46 }, end: { x: MARGIN_R, y: 46 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    p.drawText('F&G Seguro Garantia · fabio@fegsegurogarantia.com.br', { x: MARGIN_L, y: 32, size: 8, font, color: gray });
    p.drawText(`Página ${i + 1} de ${pages.length}`, { x: MARGIN_R - 70, y: 32, size: 8, font, color: gray });
  });

  return await doc.save();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // A função dispara e-mail para o parceiro. Sem esta guarda, qualquer GET na
  // URL (abrir no navegador, preview de link, crawler) manda o relatório.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Use POST para gerar e enviar o relatório.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const testMode = !!body.test_mode;
    const partnerId: number | null = body.partner_id ?? null;
    const override: string | null = body.to ?? null; // força destinatário (teste/prévia)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const competencia = monthYear();

    // ---- Modo teste: dados fictícios, destinatário obrigatório ----
    if (testMode) {
      if (!override) throw new Error('Em test_mode informe "to".');
      const pdf = await generatePDF(MOCK_CLIENTES, competencia, 'Imobiliária Exemplo');
      await enviar(override, null, MOCK_CLIENTES, competencia, 'Imobiliária Exemplo', pdf, true);
      return json({ success: true, test_mode: true, clientes: MOCK_CLIENTES.length, recipient: override });
    }

    // ---- Repasses realmente em aberto ----
    // Mesmos critérios de imobiliaria-repasse-aviso. Sem eles a consulta
    // devolve a carteira residencial inteira, que não é repasse.
    let q = supabase
      .from('imobiliaria_clientes')
      .select('*, partners!inner(id, name, email, email_2)')
      .eq('is_repasse', true)
      .eq('status_apolice', 'ativo')
      .is('repasse_pago_em', null)
      .order('proximo_vencimento');

    if (partnerId) q = q.eq('partner_id', partnerId);

    const { data, error } = await q;
    if (error) throw error;

    // Valor zerado vira cobrança de R$ 0,00 — fica de fora e é reportado.
    const comValor = (data || []).filter((c: any) => Number(c.valor_seguro || 0) > 0);
    const semValor = (data || []).filter((c: any) => !(Number(c.valor_seguro || 0) > 0));

    if (comValor.length === 0) {
      return json({ success: true, enviados: 0, ignorados_sem_valor: semValor.length, message: 'Nenhum repasse em aberto para enviar.' });
    }

    // Um e-mail por parceiro. Nunca mandar dados de um parceiro para outro.
    const porParceiro = new Map<number, { nome: string; email: string; email2?: string; clientes: any[] }>();
    for (const c of comValor) {
      const p = (c as any).partners;
      if (!porParceiro.has(p.id)) {
        porParceiro.set(p.id, { nome: p.name, email: p.email, email2: p.email_2, clientes: [] });
      }
      porParceiro.get(p.id)!.clientes.push(c);
    }

    const enviados: any[] = [];
    const semEmail: string[] = [];

    for (const [, p] of porParceiro) {
      const destino = override || p.email;
      if (!destino) { semEmail.push(p.nome); continue; }

      const pdf = await generatePDF(p.clientes, competencia, p.nome);
      const extras = override ? null : (p.email2 || null);
      const total = await enviar(destino, extras, p.clientes, competencia, p.nome, pdf, false);
      enviados.push({ parceiro: p.nome, destinatario: destino, clientes: p.clientes.length, total });
    }

    return json({ success: true, enviados, sem_email: semEmail, ignorados_sem_valor: semValor.length });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[imobiliaria-report]', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function enviar(
  destino: string,
  email2: string | null,
  clientes: any[],
  competencia: string,
  parceiroNome: string,
  pdfBytes: Uint8Array,
  testMode: boolean,
): Promise<number> {
  const total = clientes.reduce((s: number, c: any) => s + Number(c.valor_seguro || 0), 0);
  const vencs = clientes.map((c: any) => c.proximo_vencimento).filter(Boolean).sort();
  const faixa = vencs.length
    ? (vencs[0] === vencs[vencs.length - 1] ? fmtData(vencs[0]) : `${fmtData(vencs[0])} a ${fmtData(vencs[vencs.length - 1])}`)
    : '—';

  const to = [destino];
  if (email2) to.push(email2);

  const emailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #1B263B; padding: 24px; border-radius: 8px 8px 0 0;">
    <h2 style="color: #C69C6D; margin: 0;">F&G Seguro Garantia</h2>
    <p style="color: #fff; margin: 4px 0 0;">Relatório de Repasse — ${competencia}${testMode ? ' (TESTE)' : ''}</p>
  </div>
  <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
    <p>Prezada equipe <strong>${parceiroNome}</strong>,</p>
    <p>Segue em anexo o relatório com os repasses de seguro atualmente em aberto.</p>
    <p style="background: #f0f4ff; padding: 16px; border-radius: 8px; border-left: 4px solid #1B263B;">
      <strong>Total a repassar: ${fmtBRL(total)}</strong><br/>
      <strong>${clientes.length} inquilino(s)</strong><br/>
      <strong>Vencimentos: ${faixa}</strong><br/>
      <strong>PIX (CNPJ): 56.123.874/0001-90</strong><br/>
      Favorecido: F&amp;G Seguro Garantia
    </p>
    <p>Cada parcela deve ser repassada até o vencimento indicado no anexo. Você também recebe um aviso individual 10 dias antes de cada vencimento.</p>
    <p>Atenciosamente,<br/><strong>Fábio</strong><br/>F&amp;G Seguro Garantia</p>
    ${testMode ? '<p style="color:#999;font-size:12px;">* Email de teste — dados fictícios</p>' : ''}
  </div>
</div>`;

  const slug = `${parceiroNome.replace(/[^\p{L}\p{N}]+/gu, '_')}_${competencia.replace(/\s+/g, '_')}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'Fábio — F&G Seguro Garantia <fabio@fegsegurogarantia.com.br>',
      to,
      bcc: [BCC],
      subject: `${testMode ? '[TESTE] ' : ''}Relatório de Repasse — ${competencia} | F&G Seguro Garantia`,
      html: emailHtml,
      attachments: [{
        filename: `Repasse_${slug}${testMode ? '_TESTE' : ''}.pdf`,
        content: bytesToBase64(pdfBytes),
      }],
    }),
  });

  if (!emailRes.ok) throw new Error(`Resend error: ${emailRes.status} — ${await emailRes.text()}`);
  return total;
}
