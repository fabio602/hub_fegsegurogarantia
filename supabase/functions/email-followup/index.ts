import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL = 'F&G Corretora <contato@fegsegurogarantia.com.br>'
const BCC_EMAIL = 'fabio@fegsegurogarantia.com.br'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// ─── Molde visual ───────────────────────────────────────────────────────────
// Fica no código de propósito: é a identidade da F&G e vale para todos os
// modelos. O que muda de e-mail para e-mail mora na tabela email_modelos.

function baseLayout(content: string) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f1ec;margin:0;padding:32px 16px;color:#1B263B}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:40px;border:1px solid #e2e8f0;box-shadow:0 2px 16px rgba(0,0,0,.06)}
  .logo{background:#1B263B;color:#C69C6D;font-weight:900;font-size:18px;padding:10px 18px;border-radius:10px;display:inline-block;margin-bottom:28px}
  h1{font-size:20px;font-weight:900;color:#1B263B;margin:0 0 12px}
  p{font-size:14px;color:#475569;line-height:1.6;margin:0 0 12px}
  .highlight{background:#fef9f0;border-left:4px solid #C69C6D;padding:16px 20px;border-radius:0 10px 10px 0;margin:20px 0}
  .highlight strong{color:#1B263B}
  .info{background:#f0f6ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:0 10px 10px 0;margin:20px 0}
  .info strong{color:#1e40af}
  .btn{display:inline-block;background:#1B263B;color:#C69C6D !important;font-weight:900;font-size:14px;padding:12px 28px;border-radius:12px;text-decoration:none;margin-top:20px}
  .footer{margin-top:32px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px}
</style></head>
<body><div class="card">
  <div class="logo">F&amp;G</div>
  ${content}
  <div class="footer">F&amp;G Corretora de Seguros &middot; Fábio &middot; (15) 99861-8659 &middot; <a href="https://wa.me/5515998618659" style="color:#C69C6D">WhatsApp</a></div>
</div></body></html>`
}

// ─── Modelos ────────────────────────────────────────────────────────────────

interface Modelo {
  assunto: string
  titulo?: string | null
  corpo_html: string
  cta_texto?: string | null
  cta_link?: string | null
}

/**
 * Rede de segurança: se a tabela email_modelos não existir ou a linha sumir,
 * o e-mail sai igualzinho ao que saía antes de o conteúdo ir para o banco.
 * Nunca deixe de mandar um e-mail por causa de um registro faltando.
 */
const FALLBACK: Record<string, Modelo> = {
  renewal: {
    assunto: '[EMOJI] Sua apólice de [PRODUTO] vence em [DIAS] (F&G Corretora)',
    titulo: '[EMOJI] Aviso de vencimento: [DIAS]',
    corpo_html: `<p>Olá, <strong>[NOME]</strong>.</p>
<p>Sua apólice de <strong>[PRODUTO]</strong>[SEGURADORA] está se aproximando do vencimento. Queremos garantir que você não fique sem cobertura.</p>
<div class="highlight">
  <strong>📅 Vencimento:</strong> [VENCIMENTO]<br/>
  <strong>⏳ Dias restantes:</strong> [DIAS]
</div>
<p>Entre em contato conosco agora para iniciar a renovação sem burocracia.</p>`,
    cta_texto: 'Renovar agora via WhatsApp',
    cta_link: 'https://wa.me/5515998618659?text=Ol%C3%A1!%20Preciso%20renovar%20minha%20ap%C3%B3lice%20de%20[PRODUTO_URL].',
  },
  prospect_intro: {
    assunto: '🛡️ Seguro Garantia para [EMPRESA] (F&G Corretora)',
    titulo: '🛡️ Seguro Garantia para [EMPRESA]',
    corpo_html: `<p>Olá, <strong>[NOME]</strong>.</p>
<p>Sou o <strong>Fábio</strong> da <strong>F&amp;G Corretora de Seguros</strong>. Identificamos que a <strong>[EMPRESA]</strong> pode se beneficiar das nossas soluções em <strong>Seguro Garantia</strong>.</p>
<div class="info">
  <strong>O que é o Seguro Garantia?</strong><br/>
  É a alternativa inteligente ao capital bloqueado em garantias contratuais, licitações e processos judiciais. Sua empresa mantém o fluxo de caixa livre e garante as obrigações contratuais com um prêmio acessível.
</div>
<p><strong>✅ Aprovação rápida &nbsp;·&nbsp; Sem burocracia &nbsp;·&nbsp; Melhores seguradoras do mercado</strong></p>`,
    cta_texto: 'Solicitar apresentação',
    cta_link: 'https://wa.me/5515998618659?text=Ol%C3%A1!%20Gostaria%20de%20saber%20mais%20sobre%20o%20Seguro%20Garantia.',
  },
  prospect_followup: {
    assunto: '📋 Retomando nosso contato (F&G Corretora)',
    titulo: '📋 Retomando nosso contato',
    corpo_html: `<p>Olá, <strong>[NOME]</strong>.</p>
<p>Recentemente entrei em contato sobre nossas soluções em Seguro Garantia e queria saber se surgiu alguma dúvida ou oportunidade em que possamos ajudar a <strong>[EMPRESA]</strong>.</p>
<div class="highlight">
  Estamos prontos para apresentar uma <strong>proposta personalizada</strong> para o seu negócio, sem compromisso.
</div>
<p>Basta me responder este e-mail ou chamar no WhatsApp. Será um prazer conversar!</p>`,
    cta_texto: 'Falar pelo WhatsApp',
    cta_link: 'https://wa.me/5515998618659?text=Ol%C3%A1%20F%C3%A1bio!%20Gostaria%20de%20retomar%20nossa%20conversa%20sobre%20Seguro%20Garantia.',
  },
}

/** Troca [VARIAVEL] pelo valor. O que não conhecer fica como está, para aparecer na prévia. */
function aplicar(texto: string, vars: Record<string, string>) {
  return texto.replace(/\[([A-Z_]+)\]/g, (achado, chave) => vars[chave] ?? achado)
}

async function carregarModelo(db: any, chave: string): Promise<Modelo> {
  try {
    const { data } = await db.from('email_modelos').select('*').eq('chave', chave).eq('ativo', true).maybeSingle()
    if (data?.corpo_html) return data as Modelo
  } catch (err) {
    console.error(`[email-followup] Falha ao ler o modelo ${chave}:`, err)
  }
  return FALLBACK[chave]
}

function montar(modelo: Modelo, vars: Record<string, string>) {
  const titulo = modelo.titulo?.trim() ? `<h1>${aplicar(modelo.titulo, vars)}</h1>` : ''
  const corpo = aplicar(modelo.corpo_html, vars)
  const botao = modelo.cta_texto?.trim()
    ? `<a href="${aplicar(modelo.cta_link || 'https://wa.me/5515998618659', vars)}" class="btn">${aplicar(modelo.cta_texto, vars)}</a>`
    : ''
  return {
    subject: aplicar(modelo.assunto, vars),
    html: baseLayout(`${titulo}\n${corpo}\n${botao}`),
  }
}

/** Avulso é escrito pelo usuário na hora, então não passa pela tabela. */
function customHtml(nome: string, message: string) {
  const escaped = message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>')
  return baseLayout(`
    <p>Olá, <strong>${nome}</strong>.</p>
    <p style="white-space:pre-wrap">${escaped}</p>
    <a href="https://wa.me/5515998618659" class="btn">Falar com a F&amp;G</a>
  `)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = await req.json()
    const { type, toEmail, toName, saleId, prospectId, produto, vencimento, daysLeft, seguradora, company, template, subject: customSubject, message, preview } = body

    // No modo prévia o destinatário é opcional: o hub só quer ver assunto e corpo.
    if (!toEmail && !preview) throw new Error('toEmail is required')

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const nome = toName || toEmail || 'cliente'

    let subject = ''
    let html = ''

    if (type === 'renewal') {
      const d = daysLeft ?? 0
      const prod = produto || 'seguro'
      const modelo = await carregarModelo(db, 'renewal')
      const montado = montar(modelo, {
        NOME: nome,
        PRODUTO: prod,
        PRODUTO_URL: encodeURIComponent(prod),
        VENCIMENTO: vencimento ? fmtDate(vencimento) : '',
        DIAS: `${d} dia${d !== 1 ? 's' : ''}`,
        EMOJI: d <= 7 ? '🔴' : d <= 30 ? '🟠' : '🟡',
        SEGURADORA: seguradora ? ` (${seguradora})` : '',
      })
      subject = montado.subject
      html = montado.html
    } else if (type === 'prospect') {
      const chave = template === 'intro' ? 'prospect_intro' : 'prospect_followup'
      const modelo = await carregarModelo(db, chave)
      const montado = montar(modelo, {
        NOME: nome,
        EMPRESA: company || 'sua empresa',
      })
      subject = montado.subject
      html = montado.html
    } else if (type === 'custom') {
      subject = customSubject || 'Mensagem da F&G Corretora'
      html = customHtml(nome, message || '')
    } else {
      throw new Error(`Unknown type: ${type}`)
    }

    // Prévia: devolve o e-mail montado sem enviar nada e sem gravar log.
    if (preview) {
      return new Response(JSON.stringify({ success: true, preview: true, subject, html }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Send via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [toEmail], subject, html, bcc: [BCC_EMAIL] }),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('[email-followup] Resend error:', err)
      return new Response(JSON.stringify({ success: false, error: err }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Log the send
    const today = new Date().toISOString().slice(0, 10)

    if (type === 'renewal' && saleId) {
      await db.from('email_reminder_logs').insert({
        sale_id: saleId,
        reminder_key: 'manual_renewal',
        reminder_date: today,
        audience: 'client',
        to_email: toEmail,
      })
    } else if (type === 'prospect' && prospectId) {
      await db.from('prospects').update({
        ult_contato: new Date().toISOString(),
        email_enviado: true,
      }).eq('id', prospectId)
    }

    console.log(`[email-followup] Sent ${type} to ${toEmail}`)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[email-followup] Error:', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200, // always 200 so caller can read body
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
