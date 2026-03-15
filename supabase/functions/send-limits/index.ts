
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { clientName, clientEmail, decisor, limits } = payload
    
    console.log(`[Send Limits Request] To: ${clientEmail} (Client: ${clientName}), Decisor: ${decisor}`)
    console.log('Full Received payload:', JSON.stringify(payload))

    if (!clientEmail || !limits || !Array.isArray(limits)) {
      console.error('Invalid payload: email and limits array are required')
      throw new Error('Email and limits are required')
    }

    const greeting = decisor ? `Olá ${decisor},` : `Olá,`
    
    const limitsHtml = limits.map(l => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; color: #1B263B;">${l.seguradora}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; color: #C69C6D;">${l.valor}</td>
      </tr>
    `).join('')

    const htmlBody = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
        <h2 style="color: #1B263B; border-bottom: 2px solid #C69C6D; padding-bottom: 10px;">Limites de Crédito Aprovados - F&G Corretora</h2>
        
        <p>${greeting}</p>
        
        <p>Temos o prazer de informar que já possuímos limites de crédito aprovados para a <strong>${clientName}</strong> nas seguintes seguradoras:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f9f9f9; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #1B263B; color: white;">
              <th style="padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase;">Seguradora</th>
              <th style="padding: 12px; text-align: right; font-size: 12px; text-transform: uppercase;">Limite Aprovado</th>
            </tr>
          </thead>
          <tbody>
            ${limitsHtml}
          </tbody>
        </table>
        
        <p>Esses limites estão prontos para atender as demandas da sua empresa com agilidade e as melhores taxas do mercado.</p>
        
        <p>Qualquer dúvida ou nova demanda, conte com a nossa equipe!</p>
        
        <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; text-align: center;">
          <p style="margin-bottom: 10px; font-weight: bold; color: #1B263B;">F&G Corretora de Seguros</p>
          <div style="display: flex; justify-content: center; gap: 20px; margin-bottom: 15px;">
            <a href="https://www.instagram.com/fg_segurogarantia" style="text-decoration: none; color: #E1306C; font-size: 13px; font-weight: bold;">Instagram</a>
            <a href="https://www.linkedin.com/company/107618467" style="text-decoration: none; color: #0077B5; font-size: 13px; font-weight: bold;">LinkedIn</a>
          </div>
          <p style="font-size: 12px; color: #888;">
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
        to: [clientEmail],
        subject: `Limites de Crédito Disponíveis - ${clientName}`,
        html: htmlBody,
      }),
    })

    const result = await res.json()
    return new Response(JSON.stringify(result), { 
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
