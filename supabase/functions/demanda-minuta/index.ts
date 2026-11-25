// demanda-minuta: o lado do HUB da validação da minuta com o parceiro do
// portal (tabela demanda_minutas, migração 146).
//
// Só usuário logado no HUB com e-mail @fegsegurogarantia.com.br.
//
// Ações (POST JSON { acao, ... }):
//   enviar   { sale_id, arquivo: { path, nome, tamanho }, observacao }
//            A equipe já subiu o arquivo no bucket privado demanda-minutas,
//            na pasta v<sale_id>/. Aqui a rodada é gravada (versão seguinte;
//            a rodada que ainda esperava resposta vira "substituida") e o
//            parceiro é avisado por e-mail, com a minuta em anexo e o link
//            do portal, onde ele aprova ou pede ajuste.
//
// A resposta do parceiro entra pela parceiro-portal (ação responder_minuta).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BUCKET_MINUTAS, PORTAL_URL, agoraBrasiliaTexto, enviarEmail, esc, linhaEmail, molduraEmail,
} from "../_shared/minutaParceiro.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const DOMINIO_FG = '@fegsegurogarantia.com.br';
const MAX_ANEXO_EMAIL = 20 * 1024 * 1024;
const EXTENSOES = ['pdf', 'doc', 'docx'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

class Erro extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

async function enviar(supabase: SupabaseClient, corpo: Record<string, unknown>, emailEquipe: string) {
  const saleId = Number(corpo.sale_id);
  if (!(saleId > 0)) throw new Erro('Venda não informada.');

  const arq = (corpo.arquivo || {}) as { path?: string; nome?: string; tamanho?: number };
  const path = String(arq.path || '');
  const nome = String(arq.nome || path.split('/').pop() || '').trim().slice(0, 200);
  if (!path.startsWith(`v${saleId}/`) || path.includes('..')) throw new Erro('Arquivo da minuta inválido.');
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();
  if (!EXTENSOES.includes(ext)) throw new Erro('A minuta precisa ser PDF ou Word.');
  const observacao = String(corpo.observacao ?? '').trim().slice(0, 1000);

  const { data: venda } = await supabase.from('sales')
    .select('id, nome, cnpj, tipo, parceiro, vendeu').eq('id', saleId).maybeSingle();
  if (!venda) throw new Erro('Venda não encontrada.', 404);
  if (!venda.parceiro) throw new Erro('Esta venda não tem parceiro. A minuta só volta pelo portal para demanda de parceiro.');

  // O portal casa pelo nome exato do cadastro (ver CLAUDE.md).
  const { data: parceiros } = await supabase.from('partners')
    .select('id, name, email, partner_type').eq('name', venda.parceiro);
  const parceiro = (parceiros || []).find((p) => p.partner_type !== 'imobiliaria');
  if (!parceiro) throw new Erro(`Não achei o parceiro "${venda.parceiro}" no cadastro. Confira o nome na venda.`);

  // O arquivo tem de estar no bucket antes de a rodada existir.
  const { data: link, error: eLink } = await supabase.storage.from(BUCKET_MINUTAS).createSignedUrl(path, 7 * 86400);
  if (eLink || !link?.signedUrl) throw new Erro('O arquivo da minuta não chegou. Envie de novo.');

  const { data: anteriores } = await supabase.from('demanda_minutas')
    .select('id, versao, status, arquivo_path').eq('sale_id', saleId).order('versao', { ascending: false });
  const lista = anteriores || [];
  // Clique duplo: o mesmo arquivo já é a rodada que está esperando o parceiro.
  const igual = lista.find((r) => r.status === 'aguardando' && r.arquivo_path === path);
  if (igual) return { id: igual.id, versao: igual.versao, repetida: true, email_enviado: false, parceiro_email: parceiro.email || null };

  const agoraIso = new Date().toISOString();
  await supabase.from('demanda_minutas')
    .update({ status: 'substituida' })
    .eq('sale_id', saleId).eq('status', 'aguardando');

  const versao = (lista[0]?.versao || 0) + 1;
  const { data: rodada, error } = await supabase.from('demanda_minutas').insert({
    sale_id: saleId,
    partner_id: parceiro.id,
    versao,
    arquivo_path: path,
    arquivo_nome: nome,
    arquivo_tamanho: Number(arq.tamanho) > 0 ? Math.round(Number(arq.tamanho)) : null,
    observacao_fg: observacao || null,
    enviada_por: emailEquipe,
    enviada_em: agoraIso,
  }).select('id, versao').single();
  if (error || !rodada) throw new Error(error?.message || 'Falha ao gravar a minuta');

  let emailEnviado = false;
  if (parceiro.email) {
    const html = molduraEmail({
      titulo: versao > 1 ? `Minuta ajustada para validar (versão ${versao})` : 'Minuta pronta para validar',
      subtitulo: `Enviada pela F&G em ${agoraBrasiliaTexto()}`,
      linhas: [
        linhaEmail('Tomador', esc(venda.nome), true),
        venda.cnpj ? linhaEmail('CNPJ', esc(venda.cnpj)) : '',
        linhaEmail('Modalidade', esc(venda.tipo === 'Licitante' ? 'Licitante (edital)' : venda.tipo === 'Performance' ? 'Execução (contrato)' : (venda.tipo || 'Seguro Garantia')), true),
        linhaEmail('Minuta', `<a href="${esc(link.signedUrl)}" style="color:#8B6C3E;font-weight:700;">${esc(nome)}</a>`),
        observacao ? linhaEmail('Observação da F&amp;G', esc(observacao).replace(/\n/g, '<br>')) : '',
      ].join(''),
      aviso: 'Confira a minuta e responda pelo portal: <strong style="color:#1B263B;">Aprovar</strong> ou <strong style="color:#1B263B;">Pedir ajuste</strong>. A apólice só é emitida depois da sua aprovação. O link da minuta neste e-mail vale por 7 dias; no portal ela fica sempre disponível.',
      botao: { texto: 'Abrir o portal e responder', url: PORTAL_URL },
    });
    const anexar = Number(arq.tamanho) > 0 && Number(arq.tamanho) <= MAX_ANEXO_EMAIL;
    emailEnviado = await enviarEmail(RESEND_KEY, {
      to: [parceiro.email],
      reply_to: emailEquipe,
      subject: `Minuta para validar: ${venda.nome}${versao > 1 ? ` (versão ${versao})` : ''}`,
      html,
      ...(anexar ? { attachments: [{ filename: nome, path: link.signedUrl }] } : {}),
    });
  }

  return { id: rodada.id, versao: rodada.versao, email_enviado: emailEnviado, parceiro_email: parceiro.email || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Método não permitido' }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await supabase.auth.getUser(jwt);
    const email = (u?.user?.email || '').toLowerCase();
    if (!email) return json({ success: false, error: 'Entre no HUB de novo.' }, 401);
    if (!email.endsWith(DOMINIO_FG)) return json({ success: false, error: 'Só a equipe da F&G pode enviar a minuta.' }, 403);

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (corpo.acao) {
      case 'enviar': return json({ success: true, ...(await enviar(supabase, corpo, email)) });
      default: return json({ success: false, error: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof Erro) return json({ success: false, error: e.message }, e.status);
    console.error('[demanda-minuta]', e instanceof Error ? e.message : String(e));
    return json({ success: false, error: 'Erro interno. Tente de novo em instantes.' }, 500);
  }
});
