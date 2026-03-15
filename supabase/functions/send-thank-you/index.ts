
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing environment variables')
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const payload = await req.json()
    const { record, old_record, type, attachments } = payload
    
    console.log(`[Thank You Email] Request Type: ${type} - Client: ${record?.nome}`)

    if (!record) {
      throw new Error('No record found in payload')
    }

    // --- STRATEGIC FILTERING ---
    // MANUAL: Triggered from UI with status 'Sim' (Preferred, carries attachments)
    // INSERT/UPDATE: Webhook when status becomes 'Sim'
    const isManual = type === 'MANUAL'
    const isNewWonSale = type === 'INSERT' && record.vendeu === 'Sim'
    const statusChangedToWon = type === 'UPDATE' && record.vendeu === 'Sim' && old_record?.vendeu !== 'Sim'

    // If it's a webhook for Licitante/Performance, we skip it because the UI handles it manually
    const isSpecialType = record.tipo === 'Licitante' || record.tipo === 'Performance'

    if (!isManual) {
      if (isSpecialType && (isNewWonSale || statusChangedToWon)) {
        console.log(`Skipping Webhook for ${record.tipo}: Waiting for Manual trigger with attachments from UI.`)
        return new Response(JSON.stringify({ message: 'Skipped: UI will trigger manually with attachments' }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        })
      }

      if (!isNewWonSale && !statusChangedToWon) {
        console.log('Skipping: Not a Manual trigger or Status change to Sim')
        return new Response(JSON.stringify({ message: 'No action needed' }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        })
      }
    }

    console.log(`Processing ${isManual ? 'MANUAL' : 'WEBHOOK'} send. Attachments: ${attachments?.length || 0}`)

    if (record.email) {
      // Check for repeat customer
      let orFilter = `email.eq.${record.email}`
      if (record.cnpj && typeof record.cnpj === 'string' && record.cnpj.trim() !== '') {
        orFilter = `cnpj.eq.${record.cnpj},${orFilter}`
      }

      const { data: previousSales } = await supabaseClient
        .from('sales')
        .select('id')
        .eq('vendeu', 'Sim')
        .or(orFilter)
        .neq('id', record.id)
        .limit(1)

      const isRepeatClient = previousSales && previousSales.length > 0
      const decisor = record.decisor || ''
      const greeting = decisor ? `Olá ${decisor},` : `Olá,`
      
      // Personalized message based on bond type
      let specificMessage = ''
      if (record.tipo === 'Licitante') {
        specificMessage = `Segue anexo a apólice e boleto do Seguro Garantia da <strong>${record.nome}</strong> com a <strong>${record.orgaoLicitante || 'Órgão Licitante'}</strong>.`
      } else if (record.tipo === 'Performance') {
        specificMessage = `Segue anexo a apólice e boleto do Seguro Garantia da <strong>${record.nome}</strong> com a <strong>${record.segurado || 'Segurado'}</strong>.`
      } else {
        specificMessage = isRepeatClient
          ? "É um prazer tê-lo conosco novamente! Agradecemos por continuar confiando na <strong>F&G Corretora</strong>."
          : "Agradecemos pela parceria e pela confiança na <strong>F&G Corretora</strong> para a contratação da sua primeira apólice."
      }

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 16px; background-color: #ffffff;">
          <h2 style="color: #1B263B; border-bottom: 2px solid #C69C6D; padding-bottom: 10px; margin-top: 0;">Entrega de Documentos - F&G Corretora</h2>
          
          <p style="font-size: 16px;">${greeting}</p>
          
          <p style="font-size: 15px;">${specificMessage}</p>
          
          <p style="font-size: 15px;">Agradecemos por nos escolher, e continuamos à total disposição para as próximas demandas.</p>
          
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; margin: 25px 0; border: 1px solid #e2e8f0;">
            <p style="margin-top: 0; font-weight: bold; color: #1B263B; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">💡 Conheça nossas outras soluções:</p>
            <ul style="list-style-type: none; padding-left: 0; margin-bottom: 0;">
              <li style="margin-bottom: 8px; font-size: 14px;">✅ <strong>Risco de Obra e Engenharia</strong></li>
              <li style="margin-bottom: 8px; font-size: 14px;">✅ <strong>Seguro Cyber</strong> (Proteção de dados e sistemas)</li>
              <li style="margin-bottom: 8px; font-size: 14px;">✅ <strong>Seguro de Crédito</strong></li>
              <li style="margin-bottom: 8px; font-size: 14px;">✅ <strong>Seguro Garantia Adiantamento</strong></li>
              <li style="margin-bottom: 8px; font-size: 14px;">✅ <strong>Seguros Judiciais</strong> (Cível e Trabalhistas)</li>
            </ul>
          </div>
          
          <p style="font-size: 15px; font-weight: bold;">Obrigado.</p>
          
          <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; text-align: center;">
            <p style="margin-top: 20px; font-size: 12px; color: #888;">
              F&G Corretora de Seguros<br>
              <a href="https://fegsegurogarantia.com.br" style="color: #C69C6D; text-decoration: none; font-weight: bold;">fegsegurogarantia.com.br</a>
            </p>
          </div>
        </div>
      `

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'F&G Corretora <contato@fegsegurogarantia.com.br>',
          to: [record.email],
          subject: record.tipo === 'Licitante' ? `Apólice e Boleto - ${record.nome}` : 'Obrigado por escolher a F&G Corretora!',
          html: htmlBody,
          attachments: attachments || []
        }),
      })

      if (!res.ok) {
        const errorText = await res.text()
        console.error('Error sending email through Resend:', errorText)
        throw new Error(`Failed to send email: ${res.statusText}`)
      }

      const result = await res.json()
      return new Response(JSON.stringify(result), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      })
    }

    return new Response(JSON.stringify({ message: 'No email found' }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Function execution error:', errorMessage)
    return new Response(JSON.stringify({ error: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    })
  }
})
