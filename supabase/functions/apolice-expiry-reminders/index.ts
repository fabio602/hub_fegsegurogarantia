// apolice-expiry-reminders: avisa o cliente 30 dias antes do fim da apólice
// (Seguro Garantia, exceto Licitante, e Seguro Residencial) e manda um resumo
// diário ao Fábio. Cron `apolice-expiry-reminders-daily`.
//
// Desde 06/11/2026 os avisos de Seguro Residencial levam em cópia oculta a
// equipe do Residencial (lista em residencial_config). Os de garantia seguem só
// com o Fábio.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { bccResidencial } from '../_shared/copiasResidencial.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ADMIN_EMAIL = 'fabio@fegsegurogarantia.com.br'
const FROM_EMAIL = 'F&G Seguro Garantia <contato@fegsegurogarantia.com.br>'
const BCC_EMAIL = 'fabio@fegsegurogarantia.com.br'

// Logo oficial (horizontal azul, para o cartão branco). PNG porque cliente de
// e-mail não mostra SVG.
const LOGO_HTML = '<img src="https://hub.fegsegurogarantia.com/marca/fg-logo-horizontal-azul.png" width="150" height="49" alt="F&amp;G Seguro Garantia" style="display:block;border:0;margin:0 0 28px;" />'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayBRT(): string {
  const now = new Date()
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return brt.toISOString().slice(0, 10)
}

function fmtDate(d: string): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

async function sendEmail(to: string, subject: string, html: string, bcc: string[] = [BCC_EMAIL]) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, bcc }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error(`[Resend] Erro ao enviar para ${to}:`, err)
    return false
  }
  return true
}

function clientEmailHtml(nome: string, produto: string, vencimento: string, seguradora?: string): string {
  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head><meta charset="UTF-8"><style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f1ec; margin: 0; padding: 32px 16px; color: #1B263B; }
    .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 20px; padding: 40px; border: 1px solid #e2e8f0; box-shadow: 0 2px 16px rgba(0,0,0,.06); }
    h1 { font-size: 20px; font-weight: 900; color: #1B263B; margin: 0 0 12px; }
    p { font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 12px; }
    .highlight { background: #fef9f0; border-left: 4px solid #C69C6D; padding: 16px 20px; border-radius: 0 10px 10px 0; margin: 20px 0; }
    .highlight strong { color: #1B263B; }
    .btn { display: inline-block; background: #1B263B; color: #fff; font-weight: 900; font-size: 14px; padding: 12px 28px; border-radius: 12px; text-decoration: none; margin-top: 20px; }
    .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; }
  </style></head>
  <body>
    <div class="card">
      ${LOGO_HTML}
      <h1>Aviso de vencimento de apólice</h1>
      <p>Olá, <strong>${nome}</strong>.</p>
      <p>Identificamos que sua apólice de <strong>${produto}</strong>${seguradora ? ` (${seguradora})` : ''} vence em <strong>30 dias</strong>.</p>
      <div class="highlight">
        <strong>Vencimento:</strong> ${fmtDate(vencimento)}
      </div>
      <p>Para garantir a continuidade da sua cobertura sem interrupções, entre em contato conosco para renovação.</p>
      <a href="https://wa.me/5515998618659?text=Olá!%20Gostaria%20de%20renovar%20minha%20apólice." class="btn">Falar com a F&amp;G</a>
      <div class="footer">F&amp;G Seguro Garantia · Este é um aviso automático.</div>
    </div>
  </body></html>`
}

function adminEmailHtml(items: { nome: string; produto: string; vencimento: string; email?: string }[]): string {
  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;font-weight:700">${i.nome}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#475569">${i.produto}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#C69C6D;font-weight:900">${fmtDate(i.vencimento)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px">${i.email || '—'}</td>
    </tr>`).join('')
  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head><meta charset="UTF-8"><style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f1ec; margin: 0; padding: 32px 16px; color: #1B263B; }
    .card { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 20px; padding: 40px; border: 1px solid #e2e8f0; }
    h1 { font-size: 20px; font-weight: 900; color: #1B263B; margin: 0 0 8px; }
    p { font-size: 14px; color: #475569; margin: 0 0 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th { background: #f8fafc; padding: 10px 16px; text-align: left; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; }
    .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; }
  </style></head>
  <body>
    <div class="card">
      ${LOGO_HTML}
      <h1>⚠️ ${items.length} apólice(s) vencem em 30 dias</h1>
      <p>Resumo diário automático — ${new Date().toLocaleDateString('pt-BR')}</p>
      <table>
        <thead><tr><th>Cliente</th><th>Produto</th><th>Vencimento</th><th>Email</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">F&amp;G Seguro Garantia · Alerta automático gerado pelo Hub.</div>
    </div>
  </body></html>`
}

serve(async (req) => {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const today = todayBRT()
    const target = addDays(today, 30)

    console.log(`[Expiry Reminders] Running for target date: ${target}`)

    const allItems: { nome: string; produto: string; vencimento: string; email?: string }[] = []
    let sentClient = 0
    let skippedNoEmail = 0

    // --- Seguro Garantia (sales) — exclui tipo Licitante ---
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .select('id, nome, tipo, seguradora, email, vigencia_fim')
      .eq('vendeu', 'Sim')
      .eq('vigencia_fim', target)
      .neq('tipo', 'Licitante')

    if (salesError) throw salesError

    for (const s of (salesData || [])) {
      const produto = s.tipo || 'Seguro Garantia'
      allItems.push({ nome: s.nome || '—', produto, vencimento: s.vigencia_fim, email: s.email })
      if (s.email) {
        await sendEmail(s.email, `⚠️ Sua apólice de ${produto} vence em 30 dias`, clientEmailHtml(s.nome, produto, s.vigencia_fim, s.seguradora))
        sentClient++
      } else {
        skippedNoEmail++
      }
    }

    // --- Seguro Residencial (residential_clients) ---
    const { data: resData, error: resError } = await supabase
      .from('residential_clients')
      .select('id, nome, email, fim_vigencia')
      .eq('fim_vigencia', target)

    if (resError) throw resError

    const copiasRes = (resData || []).length > 0 ? await bccResidencial(BCC_EMAIL) : [BCC_EMAIL]
    for (const r of (resData || [])) {
      const produto = 'Seguro Residencial'
      allItems.push({ nome: r.nome || '—', produto, vencimento: r.fim_vigencia, email: r.email })
      if (r.email) {
        await sendEmail(r.email, `⚠️ Sua apólice de ${produto} vence em 30 dias`, clientEmailHtml(r.nome, produto, r.fim_vigencia), copiasRes)
        sentClient++
      } else {
        skippedNoEmail++
      }
    }

    // --- Resumo para o admin ---
    if (allItems.length > 0) {
      await sendEmail(ADMIN_EMAIL, `[F&G Hub] ${allItems.length} apólice(s) vencem em 30 dias`, adminEmailHtml(allItems))
    } else {
      console.log('[Expiry Reminders] Nenhuma apólice vencendo em 30 dias hoje.')
    }

    const result = { today, target, total: allItems.length, sentClient, skippedNoEmail }
    console.log('[Expiry Reminders] Done:', result)
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('[Expiry Reminders] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } })
  }
})
