import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cobrança automática de boletos do seguro garantia.
 *
 * Roda uma vez por dia e dispara UM único aviso por boleto:
 *   D-3 → WhatsApp, 3 dias antes do vencimento.
 *
 * ── Por que só antes do vencimento ───────────────────────────────────────
 *
 * Antes existiam também um aviso no dia (D0) e um de "venceu ontem" (D+1).
 * Os dois foram removidos de propósito: cobrar quem já pagou é constrangedor,
 * e evitar isso exigiria manter a marca `pago` de cada parcela em dia — um
 * trabalho manual diário que não se sustenta.
 *
 * A inadimplência não some por isso: as seguradoras mandam o relatório de
 * atraso todo mês, e essa cobrança é feita pontualmente, caso a caso.
 *
 * Consequência prática: o aviso D-3 é um lembrete, não uma cobrança. Ele sai
 * três dias ANTES do vencimento, quando ninguém está devendo nada — por isso
 * não consulta `pago` nem `pagamento_status` para decidir se envia.
 *
 * ── Duas fontes de vencimento ────────────────────────────────────────────
 *
 * 1. Tabela `boletos` (PARCELAS) — a fonte preferida. Cada parcela tem seu
 *    próprio vencimento e sua própria marca de envio, então uma venda em 6x
 *    recebe 6 lembretes, um por parcela.
 *
 * 2. Campo `sales.vencimento_boleto` (LEGADO) — usado apenas para vendas que
 *    NÃO têm nenhuma parcela cadastrada. É o comportamento antigo, mantido
 *    para não deixar de avisar as vendas à vista já registradas assim.
 *
 * Uma venda nunca é avisada pelos dois caminhos: se existe pelo menos uma
 * parcela com vencimento para aquela venda, o campo `vencimento_boleto` é
 * ignorado (ele costuma repetir o vencimento da parcela 1).
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ZAPI_INSTANCE    = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN       = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT      = 'F1febfc77e5734fc38a3de6979b7c9bd8S';

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

/** "parcela 2 de 6" — vazio quando a venda não é parcelada. */
function labelParcela(parcela: number | null, total: number | null): string {
  if (!parcela || !total || total <= 1) return '';
  return ` (parcela ${parcela} de ${total})`;
}

/** Um lembrete a disparar — vindo de uma parcela ou do campo legado. */
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
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    const today    = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const d3ISO    = new Date(today.getTime() + 3 * 86400000).toISOString().split('T')[0];

    // ── Vendas que têm parcelas cadastradas ──────────────────────────────
    // Precisamos disso duas vezes: para saber o total de parcelas de cada
    // venda ("parcela 2 de 6") e para excluir essas vendas do caminho legado.
    const { data: todasParcelas } = await supabase
      .from('boletos')
      .select('id, sale_id, parcela, vencimento, valor, pago, cobranca_d3_sent')
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
     * do caminho legado e ninguém seria avisado.
     */
    const vendasComParcelas = new Set(
      (todasParcelas ?? []).filter(b => b.vencimento).map(b => b.sale_id)
    );

    // ── Auto-atualiza pagamento_status (nunca toca em 'Pago' ou 'Em dia') ─
    //
    // Isto é só o painel do hub: mostra de relance o que já venceu. Não
    // manda ninguém enviar mensagem — o lembrete D-3 acontece antes disso.
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
    //
    // Sem filtro por `pago`: faltando três dias para vencer, o lembrete cabe
    // tenha o cliente pago ou não. É o que dispensa a marcação manual.
    const parcelasDoDia = (todasParcelas ?? []).filter(b => b.vencimento === d3ISO);

    const saleIdsParcelas = [...new Set(parcelasDoDia.map(b => b.sale_id))];
    const vendasPorId = new Map<number, any>();
    if (saleIdsParcelas.length) {
      const { data: vendas } = await supabase.from('sales')
        .select('id, nome, decisor, telefone, vendeu')
        .in('id', saleIdsParcelas);
      for (const v of vendas ?? []) vendasPorId.set(v.id, v);
    }

    const alvos: Alvo[] = [];

    for (const b of parcelasDoDia) {
      const s = vendasPorId.get(b.sale_id);
      if (!s) continue;
      if (s.vendeu !== 'Sim') continue;
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
      });
    }

    // Caminho legado: só vendas SEM nenhuma parcela cadastrada.
    const { data: legado } = await supabase.from('sales')
      .select('id, nome, decisor, telefone, premio, vencimento_boleto, cobranca_d3_sent')
      .eq('vendeu', 'Sim')
      .eq('vencimento_boleto', d3ISO);

    const legadoFlags = new Map<number, any>();
    for (const s of legado ?? []) {
      if (vendasComParcelas.has(s.id)) continue;   // já coberta pelas parcelas
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
      });
    }

    // ── Já enviado? ──────────────────────────────────────────────────────
    // A marca é definitiva: o lembrete de uma parcela sai uma vez só, mesmo
    // que a função rode várias vezes no mesmo dia.
    const jaEnviado = (a: Alvo): boolean => {
      if (a.origem === 'parcela') {
        return Boolean(parcelasDoDia.find(x => x.id === a.boletoId)?.cobranca_d3_sent);
      }
      return Boolean(legadoFlags.get(a.saleId)?.cobranca_d3_sent);
    };
    const marcarEnviado = async (a: Alvo) => {
      if (a.origem === 'parcela') {
        await supabase.from('boletos').update({ cobranca_d3_sent: true }).eq('id', a.boletoId!);
      } else {
        await supabase.from('sales').update({ cobranca_d3_sent: true }).eq('id', a.saleId);
      }
    };

    let sent = 0, errors = 0;

    // ── D-3: o único aviso ───────────────────────────────────────────────
    for (const a of alvos) {
      if (jaEnviado(a)) continue;
      const phone = cleanPhone(a.telefone); if (!phone) continue;
      const p = a.nome.split(' ')[0];
      const ref = labelParcela(a.parcela, a.totalParcelas);
      // O número da apólice saiu da mensagem: vinha de `sales.numero_boleto`,
      // um campo que na prática nunca era preenchido — o cliente recebia
      // "sobre sua apólice —". O nome, a data e o valor já identificam o
      // boleto sem depender de um cadastro manual.
      const msg =
        `Oi ${p}! Aqui é a F&G Seguro Garantia.\n\n` +
        `Passando para avisar: seu boleto${ref} vence em 3 dias, no dia ${fmtDate(a.vencimento)}.` +
        (a.valor ? ` Valor: ${a.valor}.` : '') + `\n\n` +
        `Se já realizou o pagamento, é só desconsiderar. Qualquer apoio, conte comigo. 😊`;
      if (await sendZAPI(phone, msg)) { await marcarEnviado(a); sent++; }
      else errors++;
      await new Promise(r => setTimeout(r, 1000));
    }

    const porParcela = alvos.filter(a => a.origem === 'parcela').length;
    console.log(`[garantia-cobranca] alvos:${alvos.length} (parcelas:${porParcela} legado:${alvos.length - porParcela}) enviados:${sent} erros:${errors}`);
    return new Response(JSON.stringify({
      success: true,
      alvos: { total: alvos.length, parcelas: porParcela, legado: alvos.length - porParcela },
      sent,
      errors,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[garantia-cobranca]', msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
