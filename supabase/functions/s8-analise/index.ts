// s8-analise: análise de crédito da garantia locatícia na S8 Garante, feita
// pela imobiliária no portal (public/imobiliaria.html). Migração 142.
//
// A chave da API é da F&G (secret S8_API_KEY) e nunca sai daqui. O portal só
// fala com esta function, mandando o token do login (_shared/tokenParceiro.ts).
//
// Ações (POST JSON):
//   { acao: 'criar', token, dados }   envia a análise para a S8 (POST /analises)
//   { acao: 'listar', token }         análises da imobiliária, com status atualizado
//   { acao: 'sincronizar' }           usado pelo cron s8-analises-sync: atualiza
//                                     o status das análises abertas, sem token
//
// Regras da API S8 seguidas aqui (página /desenvolvedores, v1):
//   - todo POST leva Idempotency-Key (gravada na linha antes do envio; em falha
//     de rede, a repetição usa a mesma chave e não duplica a análise);
//   - 30 requisições por minuto por chave: o portal e o cron consultam no
//     máximo poucas análises por chamada;
//   - 409 de CPF já analisado nos últimos 30 dias: o portal pede confirmação e
//     reenvia com confirmar_reenvio e uma chave nova;
//   - 422: extrato bancário obrigatório (aluguel acima do teto automático).
//
// O status que a S8 devolve vai cru para a tela (s8_status) junto com a
// leitura da F&G. A S8 não documenta a lista de status; a regra usada é:
// analysis_completed_at preenchido e status sem "rejeit/reprov/negad/recus"
// = aprovada. em_negociacao é marcado pelo Fábio no painel da S8 depois da
// aprovação.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validarToken } from '../_shared/tokenParceiro.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const S8_KEY = Deno.env.get('S8_API_KEY') ?? '';
// Plano Prata (10%). ID lido das análises da conta em 11/11/2026; pode ser
// trocado pelo secret S8_PLAN_ID sem novo deploy.
const S8_PLAN_ID = Deno.env.get('S8_PLAN_ID') ?? '9354b380-b708-47b5-a79c-54276d40e975';
const S8_BASE = 'https://www.s8garante.com/api/v1';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FABIO_EMAIL = 'fabio@fegsegurogarantia.com.br';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Erro extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}

const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const txt = (s: unknown, max = 200) => String(s ?? '').trim().slice(0, max);
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function cpfOk(c: string) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function cnpjOk(c: string) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const s = pesos.reduce((a, p, i) => a + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

const REJEITADA = /rejeit|reprov|negad|recus|cancel/i;

/** Leitura da F&G a partir do status cru da S8. */
function situacao(r: { status: string; analysis_completed_at: string | null }) {
  if (r.status === 'enviando') return 'enviando';
  if (REJEITADA.test(r.status)) return 'nao_aprovada';
  if (/contrato_ativo|locacao_autorizada|ativ/i.test(r.status)) return 'contrato_ativo';
  if (r.analysis_completed_at) return 'aprovada';
  return 'em_analise';
}

async function s8(path: string, init: RequestInit = {}) {
  if (!S8_KEY) throw new Erro('Integração indisponível no momento. Fale com a F&G.', 503);
  const r = await fetch(S8_BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${S8_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let body: any = null;
  try { body = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, body };
}

async function email(assunto: string, html: string) {
  if (!RESEND_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>',
        to: [FABIO_EMAIL], subject: assunto, html,
      }),
    });
  } catch (e) { console.error('[s8-analise] e-mail', e instanceof Error ? e.message : e); }
}

// ── criar ─────────────────────────────────────────────────────────────────
const CUSTOS = ['aluguel', 'condominio', 'agua', 'energia', 'iptu', 'taxa_lixo', 'seguro_incendio', 'gas'];

function arquivos(lista: unknown, max: number, rotulo: string) {
  if (!Array.isArray(lista)) return [];
  if (lista.length > max) throw new Erro(`No máximo ${max} arquivo(s) em ${rotulo}.`);
  return lista.map((a: any) => {
    const filename = txt(a?.filename, 120).replace(/[*#°]/g, '');
    const content_base64 = String(a?.content_base64 ?? '');
    if (!filename || !content_base64) throw new Erro(`Arquivo inválido em ${rotulo}.`);
    return { filename, content_base64, content_type: txt(a?.content_type, 80) || 'application/octet-stream' };
  });
}

async function criar(sb: SupabaseClient, parceiro: { id: number; name: string }, d: any) {
  if (!d || typeof d !== 'object') throw new Erro('Dados da análise ausentes.');
  if (d.lgpd !== true) throw new Erro('É preciso confirmar a autorização do locatário para a consulta.');

  const locs = Array.isArray(d.locatarios) ? d.locatarios.slice(0, 4) : [];
  if (!locs.length) throw new Erro('Informe pelo menos um locatário.');
  const locatarios = locs.map((l: any, i: number) => {
    const n = i + 1;
    const name = txt(l?.name, 150);
    const document = so(l?.document);
    const phone = so(l?.phone).replace(/^55(?=\d{10,11}$)/, '');
    if (name.split(/\s+/).length < 2) throw new Erro(`Locatário ${n}: informe o nome completo.`);
    if (!(document.length === 11 ? cpfOk(document) : cnpjOk(document))) throw new Erro(`Locatário ${n}: CPF ou CNPJ inválido.`);
    if (phone.length !== 10 && phone.length !== 11) throw new Erro(`Locatário ${n}: telefone com DDD, 10 ou 11 dígitos.`);
    const out: Record<string, unknown> = { name, document, phone };
    const em = txt(l?.email, 150);
    if (em) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new Erro(`Locatário ${n}: e-mail inválido.`);
      out.email = em;
    }
    const renda = Number(l?.monthly_income);
    if (renda > 0) out.monthly_income = Math.round(renda * 100) / 100;
    if (document.length === 14) {
      const reps = (Array.isArray(l?.legal_representatives) ? l.legal_representatives : [])
        .map((r: any) => ({ name: txt(r?.name, 150), document: so(r?.document) }))
        .filter((r: any) => r.name || r.document);
      if (!reps.length) throw new Erro(`Locatário ${n}: CNPJ exige o representante legal (nome e CPF).`);
      for (const r of reps) if (!r.name || !cpfOk(r.document)) throw new Erro(`Locatário ${n}: representante legal com nome ou CPF inválido.`);
      out.legal_representatives = reps;
    }
    return out;
  });

  const property_type = d.property_type === 'Comercial' ? 'Comercial' : 'Residencial';
  const business_type = txt(d.business_type, 120);
  if (property_type === 'Comercial' && !business_type) throw new Erro('Imóvel comercial: informe o ramo de atividade.');

  const e = d.property_address ?? {};
  const property_address: Record<string, string> = {
    address: txt(e.address, 150), number: txt(e.number, 20), district: txt(e.district, 80),
    city: txt(e.city, 80), state: txt(e.state, 2).toUpperCase(),
  };
  for (const [k, rot] of [['address', 'rua'], ['number', 'número'], ['district', 'bairro'], ['city', 'cidade'], ['state', 'UF']])
    if (!property_address[k]) throw new Erro(`Endereço do imóvel: informe ${rot}.`);
  if (txt(e.complement, 80)) property_address.complement = txt(e.complement, 80);
  const cep = so(e.cep);
  if (cep.length === 8) property_address.cep = `${cep.slice(0, 5)}-${cep.slice(5)}`;

  const rental_costs: Record<string, number> = {};
  for (const k of CUSTOS) {
    const v = Number(d.rental_costs?.[k]);
    if (v > 0) rental_costs[k] = Math.round(v * 100) / 100;
  }
  if (!rental_costs.aluguel) throw new Erro('Informe o valor do aluguel.');
  const custoTotal = Object.values(rental_costs).reduce((a, b) => a + b, 0);

  const obsUser = txt(d.observations, 800);
  const payloadS8: Record<string, unknown> = {
    locatarios, property_type, property_address, plan_id: S8_PLAN_ID, rental_costs,
    observations: `Enviado pelo portal F&G. Imobiliária: ${parceiro.name}.${obsUser ? ' ' + obsUser : ''}`,
  };
  if (property_type === 'Comercial') payloadS8.business_type = business_type;
  if (d.confirmar_reenvio === true) payloadS8.confirmar_reenvio = true;
  const documents = arquivos(d.documents, 8, 'documentos');
  const bank_statements = arquivos(d.bank_statements, 6, 'extrato bancário');
  if (documents.length) payloadS8.documents = documents;
  if (bank_statements.length) payloadS8.bank_statements = bank_statements;

  const p0 = locatarios[0] as any;
  const imovel = `${property_address.address}, ${property_address.number}${property_address.complement ? ' ' + property_address.complement : ''}, ${property_address.district}, ${property_address.city}/${property_address.state}`;
  // payload guardado sem o conteúdo dos arquivos
  const payloadGuardado = { ...payloadS8, documents: documents.map(a => a.filename), bank_statements: bank_statements.map(a => a.filename) };

  const { data: linha, error } = await sb.from('s8_analises').insert({
    partner_id: parceiro.id, plan_id: S8_PLAN_ID, status: 'enviando',
    inquilino_nome: p0.name, inquilino_documento: p0.document, inquilino_telefone: p0.phone,
    inquilino_email: p0.email ?? null, imovel_resumo: imovel,
    aluguel: rental_costs.aluguel, custo_total: custoTotal, payload: payloadGuardado,
    lgpd_aceite_em: new Date().toISOString(),
  }).select('id, idempotency_key').single();
  if (error) throw error;

  let resp: { status: number; body: any } | null = null;
  for (let tentativa = 0; tentativa < 2 && !resp; tentativa++) {
    try {
      resp = await s8('/analises', {
        method: 'POST', body: JSON.stringify(payloadS8),
        headers: { 'Idempotency-Key': linha.idempotency_key },
      });
      if (resp.status >= 500 || resp.status === 503) { if (tentativa === 0) resp = null; }
    } catch (e) {
      console.error('[s8-analise] rede', e instanceof Error ? e.message : e);
      if (tentativa === 1) {
        await sb.from('s8_analises').update({ erro: 'falha de conexão', updated_at: new Date().toISOString() }).eq('id', linha.id);
        throw new Erro('A S8 não respondeu. Tente de novo em instantes; o envio não será duplicado.', 502);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  const { status, body } = resp!;

  if (status === 201 || status === 200) {
    const a = body?.data ?? {};
    await sb.from('s8_analises').update({
      s8_id: a.id ?? null, contract_number: a.contract_number ?? null,
      guarantee_value: a.guarantee_value ?? null, status: a.status ?? 'enviada',
      aviso: body?.warning ?? null, erro: body?.document_errors ? JSON.stringify(body.document_errors).slice(0, 1000) : null,
      status_consultado_em: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', linha.id);

    await email(`Nova análise de garantia pelo portal: ${p0.name} (${parceiro.name})`, `
      <p>A <b>${esc(parceiro.name)}</b> enviou uma análise de garantia locatícia pelo portal.</p>
      <p><b>Locatário:</b> ${esc(p0.name)}<br><b>Imóvel:</b> ${esc(imovel)}<br>
      <b>Aluguel:</b> ${brl(rental_costs.aluguel)} &nbsp; <b>Custo total mensal:</b> ${brl(custoTotal)}<br>
      <b>Contrato S8:</b> ${esc(a.contract_number ?? '')} &nbsp; <b>Valor da garantia:</b> ${brl(a.guarantee_value)}<br>
      <b>Status na S8:</b> ${esc(a.status ?? '')}</p>
      <p>Você recebe outro e-mail quando a S8 der a decisão.</p>`);
    return { id: linha.id };
  }

  // Nada foi criado na S8: a linha sai do banco.
  await sb.from('s8_analises').delete().eq('id', linha.id);
  const msg = String(body?.error ?? '');
  if (status === 409 && !/idempot/i.test(msg)) {
    throw new Erro(msg || 'Este CPF/CNPJ já teve análise nos últimos 30 dias.', 409, { precisa_confirmar: true });
  }
  if (status === 422) {
    throw new Erro(msg || 'Para este valor de aluguel a S8 exige o extrato bancário do locatário.', 422, {
      precisa_extrato: true, detalhes: body?.bank_statement_errors ?? null,
    });
  }
  if (status === 429) throw new Erro('Muitos envios em sequência. Aguarde um minuto e tente de novo.', 429);
  if (status === 401 || status === 403) {
    console.error('[s8-analise] chave S8 recusada', status, msg);
    throw new Erro('Integração indisponível no momento. Fale com a F&G.', 503);
  }
  throw new Erro(msg || `A S8 recusou o envio (código ${status}).`, 400);
}

// ── atualização de status ─────────────────────────────────────────────────
function precisaAtualizar(r: any, minAberta: number) {
  if (!r.s8_id) return false;
  const idade = Date.now() - new Date(r.status_consultado_em ?? 0).getTime();
  if (!r.analysis_completed_at) return idade > minAberta;
  const dias = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
  return dias < 30 && idade > 30 * 60 * 1000;
}

async function atualizar(sb: SupabaseClient, r: any) {
  const { status, body } = await s8(`/analises/${r.s8_id}`);
  if (status !== 200) {
    await sb.from('s8_analises').update({ status_consultado_em: new Date().toISOString() }).eq('id', r.id);
    return r;
  }
  const a = body?.data ?? {};
  const novo = {
    status: a.status ?? r.status,
    guarantee_value: a.guarantee_value ?? r.guarantee_value,
    contract_number: a.contract_number ?? r.contract_number,
    analysis_completed_at: a.analysis_completed_at ?? null,
    status_consultado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await sb.from('s8_analises').update(novo).eq('id', r.id);
  const atual = { ...r, ...novo };

  if (atual.analysis_completed_at && !r.decisao_avisada_em) {
    const { data: reservado } = await sb.from('s8_analises')
      .update({ decisao_avisada_em: new Date().toISOString() })
      .eq('id', r.id).is('decisao_avisada_em', null).select('id').maybeSingle();
    if (reservado) {
      const sit = situacao(atual) === 'nao_aprovada' ? 'NÃO APROVADA' : 'APROVADA';
      const { data: p } = await sb.from('partners').select('name').eq('id', r.partner_id).maybeSingle();
      await email(`Análise ${sit}: ${r.inquilino_nome} (${p?.name ?? 'imobiliária'})`, `
        <p>A S8 deu a decisão da análise enviada pelo portal.</p>
        <p><b>Resultado:</b> ${sit} (status na S8: ${esc(atual.status)})<br>
        <b>Locatário:</b> ${esc(r.inquilino_nome)}<br><b>Imobiliária:</b> ${esc(p?.name ?? '')}<br>
        <b>Imóvel:</b> ${esc(r.imovel_resumo)}<br><b>Contrato S8:</b> ${esc(atual.contract_number ?? '')}<br>
        <b>Valor da garantia:</b> ${brl(atual.guarantee_value)}</p>`);
      atual.decisao_avisada_em = new Date().toISOString();
    }
  }
  return atual;
}

function paraTela(r: any) {
  return {
    id: r.id, contract_number: r.contract_number, inquilino_nome: r.inquilino_nome,
    imovel_resumo: r.imovel_resumo, aluguel: r.aluguel, custo_total: r.custo_total,
    guarantee_value: r.guarantee_value, s8_status: r.status, situacao: situacao(r),
    analysis_completed_at: r.analysis_completed_at, created_at: r.created_at,
  };
}

const COLS = 'id, partner_id, s8_id, contract_number, status, guarantee_value, inquilino_nome, imovel_resumo, aluguel, custo_total, analysis_completed_at, status_consultado_em, decisao_avisada_em, created_at';

async function listar(sb: SupabaseClient, parceiroId: number) {
  const { data, error } = await sb.from('s8_analises').select(COLS)
    .eq('partner_id', parceiroId).neq('status', 'enviando')
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  const linhas = data ?? [];
  let consultas = 0;
  for (let i = 0; i < linhas.length && consultas < 4; i++) {
    if (precisaAtualizar(linhas[i], 12000)) {
      consultas++;
      try { linhas[i] = await atualizar(sb, linhas[i]); } catch (e) { console.error('[s8-analise] status', e instanceof Error ? e.message : e); }
    }
  }
  return { analises: linhas.map(paraTela) };
}

async function sincronizar(sb: SupabaseClient) {
  const { data } = await sb.from('s8_analises').select(COLS)
    .not('s8_id', 'is', null)
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('status_consultado_em', { ascending: true, nullsFirst: true }).limit(40);
  let n = 0;
  for (const r of data ?? []) {
    if (n >= 8) break;
    if (precisaAtualizar(r, 60000)) { n++; try { await atualizar(sb, r); } catch { /* segue */ } }
  }
  return { atualizadas: n };
}

// ── roteador ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ success: false, error: 'Método não permitido' }, 405);
  try {
    const corpo = await req.json().catch(() => ({})) as Record<string, any>;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (corpo.acao === 'sincronizar') return json({ success: true, ...(await sincronizar(sb)) });

    const parceiro = await validarToken(sb, corpo.token);
    if (!parceiro) return json({ success: false, error: 'Sessão expirada. Entre de novo.', sessao_expirada: true }, 401);
    if (parceiro.partner_type !== 'imobiliaria') return json({ success: false, error: 'Acesso restrito.' }, 403);

    switch (corpo.acao) {
      case 'criar': return json({ success: true, ...(await criar(sb, parceiro, corpo.dados)) });
      case 'listar': return json({ success: true, ...(await listar(sb, parceiro.id)) });
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message, ...e.extra }, e.status);
    console.error('[s8-analise]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
