
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { record } = payload

    console.log('Receiving record:', record)

    // Only send if 'vendeu' is 'Sim' and there is an email
    if (record.vendeu === 'Sim' && record.email) {
      const clientName = record.nome || 'Cliente'
      const decisor = record.decisor || ''
      const greeting = decisor ? `Olá ${decisor},` : `Olá,`

      const htmlBody = `
        <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #1B263B; border-bottom: 2px solid #C69C6D; padding-bottom: 10px;">Agradecimento - F&G Corretora</h2>
          
          <p>${greeting}</p>
          
          <p>Agradecemos pela parceria e pela confiança na <strong>F&G Corretora</strong> para a contratação da sua apólice. Estamos à total disposição para o que precisar.</p>
          
          <p>Aproveitamos para lembrar que também atuamos com outras soluções que podem proteger ainda mais a sua empresa:</p>
          
          <ul style="list-style-type: none; padding-left: 0;">
            <li style="margin-bottom: 8px;">✅ <strong>Risco de Obra e Engenharia</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguro Cyber</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguro de Crédito</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguro Garantia Adiantamento de Pagamento</strong></li>
            <li style="margin-bottom: 8px;">✅ <strong>Seguros Judiciais (Cível e Trabalhistas)</strong></li>
          </ul>
          
          <p>Conte conosco para o que for necessário!</p>
          
          <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
            <p style="margin-bottom: 0;">Atenciosamente,</p>
            <p style="font-weight: bold; color: #1B263B; margin-top: 5px;">Equipe F&G Corretora</p>
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
          subject: 'Agradecimento pela confiança - F&G Corretora',
          html: htmlBody,
        }),
      })

      const result = await res.json()
      console.log('Resend Response:', result)
      
      return new Response(JSON.stringify(result), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      })
    }

    return new Response(JSON.stringify({ message: 'No action needed: vendeu != Sim or no email' }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    })

  } catch (error) {
    console.error('Error in Edge Function:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    })
  }
})
