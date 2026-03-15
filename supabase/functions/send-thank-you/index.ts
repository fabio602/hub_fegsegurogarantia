
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
    // Validate environment variables early
    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing environment variables')
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const payload = await req.json()
    console.log('Received payload:', JSON.stringify(payload))
    
    const { record, old_record, type } = payload

    if (!record) {
      throw new Error('No record found in payload')
    }

    // --- STRATEGIC FILTERING TO PREVENT BULK EMAILS ---
    // Only proceed if it's a new record with status 'Sim' OR
    // an update where 'vendeu' CHANGED to 'Sim'.
    const isNewSale = type === 'INSERT' && record.vendeu === 'Sim'
    const statusChangedToSim = type === 'UPDATE' && record.vendeu === 'Sim' && old_record?.vendeu !== 'Sim'

    if (!isNewSale && !statusChangedToSim) {
      console.log(`Skipping: Event type ${type}, Status: ${record.vendeu}, Previous Status: ${old_record?.vendeu}`)
      return new Response(JSON.stringify({ message: 'No action needed: status did not change to Sim' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      })
    }
    // --------------------------------------------------

    if (record.email) {
      // Check for repeat customer
      // Build a robust OR filter that avoids errors if CNPJ is missing
      let orFilter = `email.eq.${record.email}`
      if (record.cnpj && typeof record.cnpj === 'string' && record.cnpj.trim() !== '') {
        orFilter = `cnpj.eq.${record.cnpj},${orFilter}`
      }

      const { data: previousSales, error: searchError } = await supabaseClient
        .from('sales')
        .select('id')
        .eq('vendeu', 'Sim')
        .or(orFilter)
        .neq('id', record.id)
        .limit(1)

      if (searchError) {
        console.error('Error searching previous sales:', searchError)
      }

      const isRepeatClient = previousSales && previousSales.length > 0
      
      const decisor = record.decisor || ''
      const greeting = decisor ? `Olá ${decisor},` : `Olá,`
      
      const welcomeText = isRepeatClient
        ? "É um prazer tê-lo conosco novamente! Agradecemos por continuar confiando na <strong>F&G Corretora</strong> para a gestão das suas apólices."
        : "Agradecemos pela parceria e pela confiança na <strong>F&G Corretora</strong> para a contratação da sua primeira apólice. Estamos à total disposição."

      const htmlBody = `
        <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #1B263B; border-bottom: 2px solid #C69C6D; padding-bottom: 10px;">Agradecimento - F&G Corretora</h2>
          
          <p>${greeting}</p>
          
          <p>${welcomeText}</p>
          
          <p>Aproveitamos para lembrar que também atuamos com outras soluções que podem proteger ainda mais a sua empresa:</p>
          
          <ul style="list-style-type: none; padding-left: 0;">
            <li style="margin-bottom: 8px;">✅ <strong>Risco de Obra e Engenharia</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguro Cyber</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguro de Crédito</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguro Garantia Adiantamento de Pagamento</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguros Judiciais (Cível e Trabalhistas)</strong></li>
          </ul>
          
          <p>Conte conosco para o que for necessário!</p>
          
          <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; text-align: center;">
            <p style="margin-bottom: 10px; font-weight: bold; color: #1B263B;">Siga-nos nas redes sociais:</p>
            <div style="display: flex; justify-content: center; gap: 20px;">
              <a href="https://www.instagram.com/fg_segurogarantia" style="text-decoration: none; color: #E1306C; font-weight: bold; padding: 5px 15px; border: 1px solid #E1306C; border-radius: 5px; font-size: 14px;">Instagram</a>
              <a href="https://www.linkedin.com/company/107618467" style="text-decoration: none; color: #0077B5; font-weight: bold; padding: 5px 15px; border: 1px solid #0077B5; border-radius: 5px; font-size: 14px;">LinkedIn</a>
            </div>
            
            <p style="margin-top: 20px; font-size: 12px; color: #888;">
              F&G Corretora de Seguros<br>
              <a href="https://fegsegurogarantia.com.br" style="color: #C69C6D; text-decoration: none;">fegsegurogarantia.com.br</a>
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
          subject: isRepeatClient ? 'Obrigado por confiar novamente na F&G Corretora!' : 'Seja bem-vindo à F&G Corretora!',
          html: htmlBody,
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

    return new Response(JSON.stringify({ message: 'No action needed' }), { 
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
