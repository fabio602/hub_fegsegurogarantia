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
    assunto: '[EMOJI] Sua apólice de [PRODUTO][REFERENCIA] vence em [DIAS] (F&G Corretora)',
    titulo: '[EMOJI] Aviso de vencimento: [DIAS]',
    corpo_html: `<p>Olá, <strong>[NOME]</strong>.</p>
<p>A apólice abaixo vence em <strong>[VENCIMENTO]</strong>. Seguem os dados para você identificar de qual se trata:</p>
[DETALHES]
[ORIENTACAO]`,
    cta_texto: 'Falar com a F&G pelo WhatsApp',
    cta_link: 'https://wa.me/5515998618659?text=Ol%C3%A1!%20Sobre%20o%20vencimento%20da%20minha%20ap%C3%B3lice%20de%20[PRODUTO_URL].',
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

// ─── Dados da apólice (aviso de vencimento) ─────────────────────────────────
// Busca a venda pelo saleId e monta o bloco com os dados que identificam a
// apólice. Campo vazio não vira linha: o cliente nunca vê "Contrato: ".

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tira espaço e pontuação solta do fim ("018/2026." vira "018/2026"). */
function limpo(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/[\s.,;]+$/, '') : ''
}

const MODALIDADE: Record<string, string> = {
  Performance: 'Garantia de Execução de Contrato (Performance)',
  Licitante: 'Garantia do Licitante (Proposta)',
  Judicial: 'Garantia Judicial',
}

function ehExecucao(tipo: string) {
  return /performance|execu/i.test(tipo)
}

async function carregarVenda(db: any, saleId: number) {
  try {
    const { data } = await db.from('sales')
      // '*' de propósito: "is" é palavra reservada e há colunas em camelCase.
      .select('*')
      .eq('id', saleId).maybeSingle()
    return data
  } catch (err) {
    console.error(`[email-followup] Falha ao ler a venda ${saleId}:`, err)
    return null
  }
}

function blocoDetalhes(v: any, vencimento: string, dias: string): string {
  const tipo = limpo(v?.tipo)
  const inicio = v?.vigencia_inicio ? fmtDate(v.vigencia_inicio) : ''
  const fim = vencimento
  const linhas: [string, string][] = [
    ['Modalidade', MODALIDADE[tipo] || tipo],
    ['Seguradora', limpo(v?.seguradora)],
    ['Tomador', [limpo(v?.nome), limpo(v?.cnpj) ? `CNPJ ${limpo(v.cnpj)}` : ''].filter(Boolean).join(', ')],
    ['Segurado', limpo(v?.segurado) || limpo(v?.orgaoLicitante)],
    ['Contrato nº', limpo(v?.numeroContrato)],
    ['Objeto', limpo(v?.objetoContrato)],
    ['Valor do contrato', limpo(v?.valorContrato)],
    ['Processo', limpo(v?.process_number)],
    ['Importância segurada', limpo(v?.is)],
    ['Vigência da apólice', inicio && fim ? `${inicio} a ${fim}` : fim ? `até ${fim}` : ''],
    ['Dias restantes', dias],
  ]
  const html = linhas
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => `<strong>${rotulo}:</strong> ${esc(valor)}`)
    .join('<br/>\n  ')
  return `<div class="highlight">\n  ${html}\n</div>`
}

/** O que pedir ao cliente depende da modalidade: execução segue o contrato. */
function orientacao(tipo: string): string {
  if (ehExecucao(tipo)) {
    return `<p>A garantia de execução acompanha o prazo do contrato. Para sabermos o próximo passo, pode nos confirmar:</p>
<ul style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 12px;padding-left:20px">
  <li>O contrato foi prorrogado ou a obra/serviço ainda está em andamento? Se sim, nos envie o termo aditivo para providenciarmos o endosso de prorrogação antes do vencimento.</li>
  <li>O contrato já foi concluído e recebido pelo órgão? Se sim, basta nos avisar.</li>
</ul>`
  }
  return `<p>Se precisar manter a cobertura após essa data, fale com a gente para providenciarmos a renovação.</p>`
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
      const venda = saleId ? await carregarVenda(db, Number(saleId)) : null
      const venc = vencimento ? fmtDate(vencimento) : ''
      const dias = `${d} dia${d !== 1 ? 's' : ''}`
      const contrato = limpo(venda?.numeroContrato)
      const segurado = limpo(venda?.segurado) || limpo(venda?.orgaoLicitante)
      const referencia = contrato
        ? ` do contrato ${contrato}${segurado ? ` (${segurado})` : ''}`
        : segurado ? ` (${segurado})` : ''
      const montado = montar(modelo, {
        NOME: nome,
        PRODUTO: prod,
        PRODUTO_URL: encodeURIComponent(`${prod}${contrato ? `, contrato ${contrato}` : ''}`),
        VENCIMENTO: venc,
        DIAS: dias,
        EMOJI: d <= 7 ? '🔴' : d <= 30 ? '🟠' : '🟡',
        SEGURADORA: seguradora ? ` (${seguradora})` : '',
        REFERENCIA: referencia,
        SEGURADO: esc(segurado),
        CONTRATO: esc(contrato),
        OBJETO: esc(limpo(venda?.objetoContrato)),
        IS: esc(limpo(venda?.is)),
        DETALHES: venda
          ? blocoDetalhes(venda, venc, dias)
          : `<div class="highlight">\n  <strong>📅 Vencimento:</strong> ${venc}<br/>\n  <strong>⏳ Dias restantes:</strong> ${dias}\n</div>`,
        ORIENTACAO: orientacao(venda?.tipo || prod),
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
