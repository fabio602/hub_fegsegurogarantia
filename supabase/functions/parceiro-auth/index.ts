// parceiro-auth: login do portal do parceiro (parceiros-login.html).
//
// A senha é comparada aqui, com service role; a anon key não lê a tabela
// partners (migração 128). Devolve os dados do parceiro sem a senha e, desde a
// migração 129, um token assinado que as funções do portal exigem
// (ver _shared/tokenParceiro.ts).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emitirToken } from "../_shared/tokenParceiro.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { usuario, senha } = await req.json();
    if (!usuario || !senha) return json({ success: false, error: 'Usuário e senha são obrigatórios' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: partner, error } = await supabase
      .from('partners')
      .select('id, name, username, password, commission_pct, comissao_faixas, partner_type, email, pix_key, banco_nome, conta_corrente, agencia')
      .eq('username', String(usuario).trim())
      .maybeSingle();

    // TODO: migrar para bcrypt quando as senhas forem hasheadas
    if (error || !partner || partner.password !== senha) {
      return json({ success: false, error: 'Usuário ou senha incorretos' }, 401);
    }

    const token = await emitirToken(supabase, partner);
    const { password: _pw, ...safePartner } = partner;

    return json({ success: true, partner: { ...safePartner, token } });
  } catch (err) {
    console.error('[parceiro-auth]', err instanceof Error ? err.message : String(err));
    return json({ success: false, error: 'Erro interno' }, 500);
  }
});
