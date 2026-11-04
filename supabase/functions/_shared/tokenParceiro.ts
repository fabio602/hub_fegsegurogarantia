// Token de sessão do portal do parceiro.
//
// O portal não usa o Supabase Auth: o parceiro entra com usuário e senha da
// tabela partners pela Edge Function parceiro-auth. Até a migração 129 a
// "sessão" era só o JSON do parceiro no localStorage, que qualquer pessoa
// conseguia forjar, e por isso o portal não podia ler nada do banco.
//
// Agora o parceiro-auth devolve um token assinado com HMAC-SHA256 e as
// funções do portal só respondem com ele. O token leva o id do parceiro, a
// validade e uma impressão da senha atual: trocar a senha derruba as sessões
// abertas em outros aparelhos.
//
// Formato: base64url(payload JSON) + "." + base64url(assinatura).
// A chave fica em public.parceiro_portal_segredo, que só a service role lê.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VALIDADE_DIAS = 30;
const enc = new TextEncoder();

let chaveCache: CryptoKey | null = null;
let segredoCache: string | null = null;

async function segredo(supabase: SupabaseClient): Promise<string> {
  if (segredoCache) return segredoCache;
  const { data, error } = await supabase
    .from('parceiro_portal_segredo').select('token_secret').eq('id', 1).single();
  if (error || !data?.token_secret) throw new Error('Chave do portal indisponível');
  segredoCache = data.token_secret as string;
  return segredoCache;
}

async function chave(supabase: SupabaseClient): Promise<CryptoKey> {
  if (chaveCache) return chaveCache;
  chaveCache = await crypto.subtle.importKey(
    'raw', enc.encode(await segredo(supabase)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  return chaveCache;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Impressão curta da senha, misturada com a chave para não ser um hash da senha. */
async function impressaoSenha(supabase: SupabaseClient, senha: string): Promise<string> {
  const dig = await crypto.subtle.digest('SHA-256', enc.encode((await segredo(supabase)) + '|' + (senha || '')));
  return b64url(new Uint8Array(dig)).slice(0, 16);
}

export async function emitirToken(
  supabase: SupabaseClient,
  parceiro: { id: number; password: string | null },
): Promise<string> {
  const payload = {
    p: parceiro.id,
    v: await impressaoSenha(supabase, parceiro.password || ''),
    e: Math.floor(Date.now() / 1000) + VALIDADE_DIAS * 86400,
  };
  const corpo = b64url(enc.encode(JSON.stringify(payload)));
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', await chave(supabase), enc.encode(corpo)));
  return `${corpo}.${b64url(assinatura)}`;
}

export interface ParceiroDoToken {
  id: number;
  name: string;
  username: string | null;
  password: string | null;
  email: string | null;
  commission_pct: number | null;
  comissao_faixas: unknown;
  partner_type: string | null;
}

/**
 * Confere o token e devolve o parceiro, ou null se o token for inválido,
 * vencido ou de uma senha que já foi trocada.
 */
export async function validarToken(supabase: SupabaseClient, token: unknown): Promise<ParceiroDoToken | null> {
  if (typeof token !== 'string' || token.length > 600) return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC', await chave(supabase), deB64url(assinatura) as unknown as BufferSource, enc.encode(corpo),
    );
  } catch { return null; }
  if (!ok) return null;

  let payload: { p?: number; v?: string; e?: number };
  try { payload = JSON.parse(new TextDecoder().decode(deB64url(corpo))); } catch { return null; }
  if (!payload.p || !payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;

  const { data: parceiro } = await supabase
    .from('partners')
    .select('id, name, username, password, email, commission_pct, comissao_faixas, partner_type')
    .eq('id', payload.p)
    .maybeSingle();
  if (!parceiro) return null;

  if (payload.v !== await impressaoSenha(supabase, parceiro.password || '')) return null;
  return parceiro as ParceiroDoToken;
}
