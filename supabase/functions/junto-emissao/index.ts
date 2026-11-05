// junto-emissao: o lado do HUB das cotações de Licitante que o parceiro fez
// na Junto pelo portal (tabela cotacoes_portal, migração 131).
//
// Só usuário logado no HUB com e-mail @fegsegurogarantia.com.br.
//
// Ações (POST JSON { acao, cotacao_id, ... }):
//   consultar   situação da cotação na Junto (minuta, pendências, emitida?)
//   emitir      EMITE a apólice. Irreversível. Exige confirmacao igual ao
//               número da cotação na Junto, que o HUB só manda depois que
//               alguém da F&G aprova aquele documento na tela. Com a apólice
//               emitida, baixa apólice e boleto, guarda no bucket apolices e
//               fecha a venda no Registro de Vendas.
//   cancelar    a F&G decidiu não emitir por aqui (a venda continua no
//               Registro de Vendas para cotar de outro jeito)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as junto from "../_shared/junto.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DOMINIO_FG = '@fegsegurogarantia.com.br';
const BUCKET_APOLICES = 'apolices';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

class Erro extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const agora = () => new Date().toISOString();

function dataBrasilia() {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} às ${v('hour')}:${v('minute')}`;
}

const brl = (n: unknown) => {
  const x = Number(n);
  return Number.isFinite(x) ? 'R$ ' + x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
};

/** O que o HUB precisa saber da cotação na Junto, sem o resto do JSON. */
function resumo(d: junto.DetalheCotacaoJunto | null) {
  if (!d) return null;
  const parcelas = Array.isArray((d as Record<string, unknown>).installments)
    ? ((d as Record<string, unknown>).installments as Array<Record<string, unknown>>)
    : [];
  return {
    emitida: d.isIssued === true,
    situacao: d.issueStatus?.quoteStatusDescription ?? null,
    situacao_id: d.issueStatus?.quoteStatusId ?? null,
    numero_apolice: d.policyNumber || null,
    documento: d.documentNumber || null,
    premio: d.totalPremiumValue ?? null,
    minuta_url: d.draftUrl || null,
    pendencias: d.hasHangs === true,
    apolice_url: d.documentUrl || null,
    boleto_url: d.billUrl || null,
    parcelas: parcelas.map((p) => ({
      parcela: Number(p.installment ?? p.number) || null,
      valor: Number(p.value) || null,
      vencimento: String(p.dueDate ?? '').slice(0, 10) || null,
    })),
  };
}

async function carregar(supabase: SupabaseClient, id: unknown) {
  const n = Number(id);
  if (!(n > 0)) throw new Erro('Cotação não informada.');
  const { data } = await supabase.from('cotacoes_portal').select('*').eq('id', n).maybeSingle();
  if (!data) throw new Erro('Cotação não encontrada.', 404);
  if (!data.cotacao_externa_id) throw new Erro('Esta tentativa não chegou a virar cotação na Junto.');
  return data as Record<string, any>;
}

// ── consultar ──────────────────────────────────────────────────────────────
async function consultar(supabase: SupabaseClient, corpo: Record<string, unknown>) {
  const cot = await carregar(supabase, corpo.cotacao_id);
  const d = resumo(await junto.detalheCotacao(Number(cot.cotacao_externa_id)));
  // A minuta da Junto pode ter mudado (refeita na plataforma): guarda a atual.
  if (d && (d.minuta_url !== cot.minuta_url || d.pendencias !== cot.minuta_pendencias)) {
    await supabase.from('cotacoes_portal').update({
      minuta_url: d.minuta_url ?? cot.minuta_url, minuta_pendencias: d.pendencias, updated_at: agora(),
    }).eq('id', cot.id);
  }
  return { cotacao: { id: cot.id, status: cot.status }, junto: d };
}

// ── emitir ─────────────────────────────────────────────────────────────────

/** Baixa um PDF da Junto e guarda no bucket público de apólices; devolve a URL pública. */
async function guardarPdf(supabase: SupabaseClient, url: string, caminho: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.warn('[guardarPdf]', caminho, r.status); return null; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
      console.warn('[guardarPdf] não é PDF', caminho, bytes.length);
      return null;
    }
    const { error } = await supabase.storage.from(BUCKET_APOLICES)
      .upload(caminho, bytes, { contentType: 'application/pdf', upsert: true });
    if (error) { console.warn('[guardarPdf]', caminho, error.message); return null; }
    return supabase.storage.from(BUCKET_APOLICES).getPublicUrl(caminho).data.publicUrl;
  } catch (e) {
    console.warn('[guardarPdf]', caminho, String(e));
    return null;
  }
}

async function fecharVenda(supabase: SupabaseClient, cot: Record<string, any>, d: NonNullable<ReturnType<typeof resumo>>, quem: string) {
  const saleId = Number(cot.sale_id);
  let apoliceUrl: string | null = null;
  let boletoUrl: string | null = null;
  if (saleId) {
    apoliceUrl = d.apolice_url ? (await guardarPdf(supabase, d.apolice_url, `${saleId}/apolice.pdf`)) ?? d.apolice_url : null;
    boletoUrl = d.boleto_url ? (await guardarPdf(supabase, d.boleto_url, `${saleId}/boletos/parcela-1.pdf`)) ?? d.boleto_url : null;
  }

  await supabase.from('cotacoes_portal').update({
    status: 'emitida',
    numero_apolice: d.numero_apolice,
    emitida_em: agora(),
    emitida_por: quem,
    erro: null,
    updated_at: agora(),
  }).eq('id', cot.id);

  if (!saleId) return { apolice_url: apoliceUrl, boleto_url: boletoUrl };

  const { data: venda } = await supabase.from('sales').select('obs').eq('id', saleId).maybeSingle();
  const primeira = d.parcelas.find((p) => p.vencimento) || null;
  const linha = `Apólice ${d.numero_apolice || ''} emitida na Junto pelo HUB em ${dataBrasilia()} (${quem}).`;
  await supabase.from('sales').update({
    vendeu: 'Sim',
    seguradora: 'Junto Seguros',
    ...(d.premio != null ? { premio: brl(d.premio) } : {}),
    ...(apoliceUrl ? { apolice_url: apoliceUrl } : {}),
    ...(boletoUrl ? { boleto_url: boletoUrl } : {}),
    ...(primeira?.vencimento ? { vencimento_boleto: primeira.vencimento } : {}),
    obs: [venda?.obs, linha].filter(Boolean).join('\n'),
  }).eq('id', saleId);

  // Uma linha por parcela em boletos (é o que a cobrança do HUB lê). A Junto
  // devolve um link de boleto só, que vai em todas as parcelas (boletos.url é
  // obrigatório). Sem boleto, a F&G lança pelo HUB como hoje.
  const { count } = await supabase.from('boletos').select('id', { count: 'exact', head: true }).eq('sale_id', saleId);
  if (!count && boletoUrl && d.parcelas.length) {
    const { error } = await supabase.from('boletos').insert(d.parcelas.map((p, i) => ({
      sale_id: saleId,
      parcela: p.parcela || i + 1,
      vencimento: p.vencimento,
      url: boletoUrl,
      valor: p.valor,
      pago: false,
    })));
    if (error) console.warn('[boletos]', error.message);
  }
  return { apolice_url: apoliceUrl, boleto_url: boletoUrl };
}

async function emitir(supabase: SupabaseClient, corpo: Record<string, unknown>, quem: string) {
  const cot = await carregar(supabase, corpo.cotacao_id);
  const ext = Number(cot.cotacao_externa_id);

  // Prova de que a pessoa aprovou ESTE documento na tela do HUB.
  if (String(corpo.confirmacao ?? '') !== String(ext)) {
    throw new Erro('Confirmação não confere com a cotação. Abra o pedido de novo e confirme.', 409);
  }
  if (cot.status === 'emitida') return { status: 'emitida', ja_emitida: true, numero_apolice: cot.numero_apolice };
  if (!['emissao_solicitada', 'em_analise'].includes(cot.status)) {
    throw new Erro(`Esta cotação está "${cot.status}" e não pode ser emitida.`);
  }

  // Trava contra dois cliques ou duas pessoas ao mesmo tempo.
  const { data: pega } = await supabase.from('cotacoes_portal')
    .update({ status: 'emitindo', updated_at: agora() })
    .eq('id', cot.id).in('status', ['emissao_solicitada', 'em_analise']).select('id');
  if (!pega || pega.length === 0) throw new Erro('Esta emissão já está sendo feita. Atualize a tela em instantes.', 409);

  const voltar = async (status: string, erro: string) => {
    await supabase.from('cotacoes_portal').update({ status, erro: erro.slice(0, 500), updated_at: agora() }).eq('id', cot.id);
  };

  try {
    // Antes de emitir: já foi emitida na plataforma? A Junto pediu documentos?
    const antes = resumo(await junto.detalheCotacao(ext));
    if (antes?.emitida) {
      const arquivos = await fecharVenda(supabase, cot, antes, quem);
      return { status: 'emitida', ja_emitida: true, numero_apolice: antes.numero_apolice, ...arquivos };
    }
    if (antes?.pendencias) {
      await voltar(cot.status, 'A Junto pediu documentos antes de emitir (pendências na minuta).');
      throw new Erro('A Junto pediu documentos antes de emitir. Anexe pela plataforma da Junto e tente de novo.');
    }
    if (!antes?.minuta_url && !cot.minuta_url) {
      await voltar(cot.status, 'Minuta não gerada.');
      throw new Erro('A minuta ainda não foi gerada na Junto. Gere a minuta antes de emitir.');
    }

    let codigo: string | null = null;
    let mensagem = '';
    try {
      await junto.emitir(ext, '');
    } catch (e) {
      if (!(e instanceof junto.ErroJunto)) throw e;
      codigo = e.codigo;
      mensagem = e.message;
      // 80063 em análise e 80065 em processamento não são falha: a Junto segurou.
      if (codigo !== '80063' && codigo !== '80065' && codigo !== '80064') {
        await voltar(cot.status, `Junto recusou a emissão: ${mensagem}`);
        throw new Erro(`A Junto não emitiu: ${mensagem}`, 422);
      }
    }

    const depois = resumo(await junto.detalheCotacao(ext));
    if (depois?.emitida) {
      const arquivos = await fecharVenda(supabase, cot, depois, quem);
      return { status: 'emitida', numero_apolice: depois.numero_apolice, ...arquivos };
    }

    // Não emitiu na hora: em análise na Junto ou ainda processando.
    const situacao = depois?.situacao || (codigo === '80063' ? 'Em análise' : 'Em processamento');
    await supabase.from('cotacoes_portal').update({
      status: 'em_analise', erro: `Junto: ${situacao}${mensagem ? ` (${mensagem})` : ''}`.slice(0, 500), updated_at: agora(),
    }).eq('id', cot.id);
    if (cot.sale_id) {
      const { data: venda } = await supabase.from('sales').select('obs').eq('id', cot.sale_id).maybeSingle();
      await supabase.from('sales').update({
        obs: [venda?.obs, `Emissão pedida na Junto pelo HUB em ${dataBrasilia()} (${quem}): ${situacao}.`].filter(Boolean).join('\n'),
      }).eq('id', cot.sale_id);
    }
    return { status: 'em_analise', situacao };
  } catch (e) {
    // Qualquer falha antes de saber o resultado devolve a cotação para a fila.
    const { data: atual } = await supabase.from('cotacoes_portal').select('status').eq('id', cot.id).maybeSingle();
    if (atual?.status === 'emitindo') await voltar(cot.status, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ── cancelar ───────────────────────────────────────────────────────────────
async function cancelar(supabase: SupabaseClient, corpo: Record<string, unknown>, quem: string) {
  const cot = await carregar(supabase, corpo.cotacao_id);
  if (cot.status === 'emitida' || cot.status === 'emitindo') throw new Erro('Esta cotação já foi emitida ou está sendo emitida.');
  const motivo = String(corpo.motivo ?? '').trim().slice(0, 300);
  await supabase.from('cotacoes_portal').update({
    status: 'cancelada', erro: `Não emitida pela F&G (${quem})${motivo ? `: ${motivo}` : ''}.`, updated_at: agora(),
  }).eq('id', cot.id);
  return { status: 'cancelada' };
}

// ── roteador ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Método não permitido' }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await supabase.auth.getUser(jwt);
    const email = (u?.user?.email || '').toLowerCase();
    if (!email) return json({ success: false, error: 'Entre no HUB de novo.' }, 401);
    if (!email.endsWith(DOMINIO_FG)) return json({ success: false, error: 'Só a equipe da F&G pode emitir.' }, 403);

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (corpo.acao) {
      case 'consultar': return json({ success: true, ...(await consultar(supabase, corpo)) });
      case 'emitir': return json({ success: true, ...(await emitir(supabase, corpo, email)) });
      case 'cancelar': return json({ success: true, ...(await cancelar(supabase, corpo, email)) });
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message }, e.status);
    if (e instanceof junto.ErroJunto) return json({ success: false, error: `Junto: ${e.message}` }, 502);
    console.error('[junto-emissao]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
