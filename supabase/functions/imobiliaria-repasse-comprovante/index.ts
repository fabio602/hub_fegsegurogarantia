// imobiliaria-repasse-comprovante: a imobiliária anexa, no portal
// (public/imobiliaria.html, aba Fatura Mensal), o comprovante do PIX de cada
// repasse. Migração 147.
//
// O portal nunca lê a tabela imobiliaria_repasse_pagamentos nem o bucket
// repasse-comprovantes (privado): manda o token do login para esta function
// (_shared/tokenParceiro.ts), que usa a service role.
//
// Ações (POST JSON):
//   { acao: 'listar', token }
//       pagamentos da imobiliária (enviado, recusado, pago), com link assinado
//       de 1 hora para ver o comprovante. O portal não fica sabendo se a F&G já
//       repassou à seguradora: 'recebido' e 'pago_seguradora' viram 'pago'.
//   { acao: 'preparar', token, client_id, nome, tamanho }
//       confere se o cliente é desta imobiliária e tem parcela em aberto, e
//       devolve a URL de upload assinada.
//   { acao: 'enviar', token, client_id, path, nome }
//       confere se o arquivo chegou e grava pelo RPC repasse_registrar_comprovante
//       (retrato da parcela; reenvio antes da conferência troca o arquivo).
//
// A baixa NÃO acontece aqui. Decisão do Fábio (28/11/2026): todo repasse espera
// o clique dele em "Confirmar recebimento" no HUB.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validarToken, type ParceiroDoToken } from '../_shared/tokenParceiro.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BUCKET = 'repasse-comprovantes';
const MAX_BYTES = 10 * 1024 * 1024;
const EXTENSOES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Erro extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const extensao = (nome: string) => (nome.split('.').pop() || '').toLowerCase();

/** Cadastro do cliente, só se for desta imobiliária e tiver parcela em aberto. */
async function cadastroEmAberto(sb: SupabaseClient, parceiroId: number, clientId: unknown) {
  if (typeof clientId !== 'string' || !UUID.test(clientId)) throw new Erro('Cliente inválido.');
  const { data: c, error } = await sb.from('imobiliaria_clientes')
    .select('id, partner_id, is_repasse, valor_seguro, parcela_atual, proximo_vencimento')
    .eq('id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c || Number(c.partner_id) !== Number(parceiroId)) throw new Erro('Cliente não encontrado.', 404);
  if (c.is_repasse !== true || !(Number(c.valor_seguro) > 0) || !(Number(c.parcela_atual) >= 1)) {
    throw new Erro('Este cliente não tem parcela de repasse em aberto.');
  }
  return c;
}

/** Pagamento "vivo" (não recusado) da parcela em aberto, se houver. */
async function pagamentoDaParcela(sb: SupabaseClient, c: { id: string; parcela_atual: number; proximo_vencimento: string | null }) {
  let q = sb.from('imobiliaria_repasse_pagamentos')
    .select('id, status, comprovante_path')
    .eq('client_id', c.id).eq('parcela', c.parcela_atual).neq('status', 'recusado');
  q = c.proximo_vencimento ? q.eq('vencimento', c.proximo_vencimento) : q.is('vencimento', null);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ── listar ───────────────────────────────────────────────────────────────────
async function listar(sb: SupabaseClient, parceiroId: number) {
  const { data, error } = await sb.from('imobiliaria_repasse_pagamentos')
    .select('id, client_id, inquilino_nome, numero_apolice, seguradora, parcela, total_parcelas, vencimento, valor_esperado, status, comprovante_path, comprovante_enviado_em, recebido_em, recusa_motivo, recusado_em')
    .eq('partner_id', parceiroId)
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);
  const linhas = data ?? [];

  const paths = linhas.map((l) => l.comprovante_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: assinadas } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const a of assinadas ?? []) if (a.path && a.signedUrl) urls.set(a.path, a.signedUrl);
  }

  return {
    pagamentos: linhas.map((l) => ({
      id: l.id,
      client_id: l.client_id,
      inquilino_nome: l.inquilino_nome,
      numero_apolice: l.numero_apolice,
      seguradora: l.seguradora,
      parcela: l.parcela,
      total_parcelas: l.total_parcelas,
      vencimento: l.vencimento,
      valor: l.valor_esperado,
      situacao: l.status === 'enviado' ? 'enviado' : l.status === 'recusado' ? 'recusado' : 'pago',
      enviado_em: l.comprovante_enviado_em,
      pago_em: l.recebido_em,
      recusado_em: l.recusado_em,
      recusa_motivo: l.status === 'recusado' ? l.recusa_motivo : null,
      comprovante_url: l.comprovante_path ? (urls.get(l.comprovante_path) ?? null) : null,
    })),
  };
}

// ── preparar ─────────────────────────────────────────────────────────────────
async function preparar(sb: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const c = await cadastroEmAberto(sb, parceiro.id, corpo.client_id);

  const nome = String(corpo.nome || '');
  const ext = extensao(nome);
  if (!EXTENSOES[ext]) throw new Erro('Envie o comprovante em PDF ou imagem (JPG, PNG).');
  const tamanho = Number(corpo.tamanho) || 0;
  if (tamanho <= 0) throw new Erro('O arquivo está vazio.');
  if (tamanho > MAX_BYTES) throw new Erro('O arquivo passa de 10 MB.');

  const atual = await pagamentoDaParcela(sb, c);
  if (atual && atual.status !== 'enviado') throw new Erro('Esta parcela já foi confirmada pela F&G.');

  const path = `${parceiro.id}/${c.id}/p${c.parcela_atual}-${Date.now()}.${ext}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message || 'Falha ao preparar o envio');
  return { bucket: BUCKET, path, token: data.token, tipo: EXTENSOES[ext] };
}

// ── enviar ───────────────────────────────────────────────────────────────────
async function enviar(sb: SupabaseClient, parceiro: ParceiroDoToken, corpo: Record<string, unknown>) {
  const c = await cadastroEmAberto(sb, parceiro.id, corpo.client_id);

  const pasta = `${parceiro.id}/${c.id}`;
  const path = String(corpo.path || '');
  const arquivo = path.slice(pasta.length + 1);
  if (!path.startsWith(pasta + '/') || !/^p\d+-\d+\.[a-z]+$/.test(arquivo) || !EXTENSOES[extensao(arquivo)]) {
    throw new Erro('Arquivo inválido.');
  }

  // O upload vai direto do navegador para o storage: confere se chegou mesmo.
  const { data: achados, error: errLista } = await sb.storage.from(BUCKET).list(pasta, { search: arquivo, limit: 5 });
  if (errLista) throw new Error(errLista.message);
  const obj = (achados ?? []).find((o) => o.name === arquivo);
  if (!obj) throw new Erro('O arquivo não chegou. Tente anexar de novo.');
  if (Number(obj.metadata?.size ?? 0) > MAX_BYTES) {
    await sb.storage.from(BUCKET).remove([path]);
    throw new Erro('O arquivo passa de 10 MB.');
  }

  const anterior = await pagamentoDaParcela(sb, c);

  const { data: id, error } = await sb.rpc('repasse_registrar_comprovante', {
    p_client_id: c.id,
    p_partner_id: parceiro.id,
    p_path: path,
    p_nome: String(corpo.nome || arquivo).slice(0, 200),
  });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]);
    // P0001 = raise exception da própria função, com texto feito para a tela.
    if (error.code === 'P0001') throw new Erro(error.message);
    throw new Error(error.message);
  }

  // Reenvio: o comprovante trocado sai do bucket.
  if (anterior?.comprovante_path && anterior.comprovante_path !== path) {
    await sb.storage.from(BUCKET).remove([anterior.comprovante_path]);
  }

  return { id };
}

// ── roteador ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ success: false, error: 'Método não permitido' }, 405);
  try {
    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const parceiro = await validarToken(sb, corpo.token);
    if (!parceiro) return json({ success: false, error: 'Sessão expirada. Entre de novo.', sessao_expirada: true }, 401);
    if (parceiro.partner_type !== 'imobiliaria') return json({ success: false, error: 'Acesso restrito.' }, 403);

    switch (corpo.acao) {
      case 'listar': return json({ success: true, ...(await listar(sb, parceiro.id)) });
      case 'preparar': return json({ success: true, ...(await preparar(sb, parceiro, corpo)) });
      case 'enviar': return json({ success: true, ...(await enviar(sb, parceiro, corpo)) });
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message }, e.status);
    console.error('[imobiliaria-repasse-comprovante]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
