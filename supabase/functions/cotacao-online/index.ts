// cotacao-online: cotação de Seguro Garantia pela API da Junto Seguros.
// Passo 1: só testa a autenticação (acao "ping"). Nunca devolve o token.
// Documentação: desenvolvedor.juntoseguros.com, Token de Autenticação v2.0
// (POST /api/v2/authentication com clientId e clientSecret).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function config() {
  const baseUrl = (Deno.env.get('JUNTO_BASE_URL') ?? '').replace(/\/+$/, '')
  const clientId = Deno.env.get('JUNTO_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('JUNTO_CLIENT_SECRET') ?? ''
  const faltando = [
    !baseUrl && 'JUNTO_BASE_URL',
    !clientId && 'JUNTO_CLIENT_ID',
    !clientSecret && 'JUNTO_CLIENT_SECRET',
  ].filter(Boolean)
  return { baseUrl, clientId, clientSecret, faltando }
}

async function autenticar() {
  const { baseUrl, clientId, clientSecret, faltando } = config()
  if (faltando.length) return { ok: false, etapa: 'segredos', faltando }

  const resp = await fetch(`${baseUrl}/api/v2/authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const texto = await resp.text()
  let corpo: Record<string, unknown> = {}
  try { corpo = JSON.parse(texto) } catch { /* resposta não JSON */ }

  if (!resp.ok || typeof corpo.accessToken !== 'string') {
    return {
      ok: false,
      etapa: 'autenticacao',
      status: resp.status,
      // corpo de erro da Junto, sem credenciais
      erro: texto.slice(0, 500),
    }
  }
  return {
    ok: true,
    token: corpo.accessToken as string,
    tokenType: (corpo.tokenType as string) ?? null,
    expiresIn: (corpo.expiresIn as number) ?? null,
    ambiente: baseUrl.includes('-box.') ? 'sandbox' : 'producao',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, erro: 'use POST' }, 405)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* corpo vazio */ }
  const acao = body.acao ?? 'ping'

  try {
    if (acao === 'ping') {
      const auth = await autenticar()
      if (!auth.ok) return json(auth, 502)
      // devolve só os metadados, nunca o token
      return json({
        ok: true,
        ambiente: auth.ambiente,
        tokenType: auth.tokenType,
        expiresIn: auth.expiresIn,
      })
    }
    return json({ ok: false, erro: `acao desconhecida: ${acao}` }, 400)
  } catch (e) {
    console.error('[cotacao-online]', e)
    return json({ ok: false, erro: String(e) }, 500)
  }
})
