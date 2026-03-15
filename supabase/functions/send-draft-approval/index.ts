
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
    const { 
      clientName, 
      clientEmail, 
      decisor, 
      tipoSeguro, 
      isGarantida, 
      valorLote,
      orgaoLicitante,
      dataPregao,
      numeroContrato,
      objetoContrato,
      segurado,
      valorContrato,
      vigenciaInicio, 
      vigenciaFim,
      seguradora,
      premio,
      attachment,
      attachmentName
    } = payload
    
    console.log(`[Draft Approval Request] To: ${clientEmail} (Client: ${clientName}) - Type: ${tipoSeguro}`)

    if (!clientEmail || !clientName) {
      throw new Error('Email e Nome do Cliente são obrigatórios')
    }

    const greeting = decisor ? `Olá ${decisor}, tudo bem?` : `Olá, tudo bem?`
    
    const formattedIs = isGarantida || 'R$ 0,00'
    const formattedLote = valorLote || 'R$ 0,00'
    const formattedContrato = valorContrato || 'R$ 0,00'
    const formattedPremio = premio || 'R$ 0,00'
    const formattedPregao = dataPregao ? new Date(dataPregao).toLocaleDateString('pt-BR') : '--/--/----'
    const formattedInicio = vigenciaInicio ? new Date(vigenciaInicio).toLocaleDateString('pt-BR') : '--/--/----'
    const formattedFim = vigenciaFim ? new Date(vigenciaFim).toLocaleDateString('pt-BR') : '--/--/----'

    const isPerformance = tipoSeguro === 'Performance'
    
    // Custom body based on insurance type
    const mainMessage = isPerformance 
      ? `Segue dados da minuta da <strong>${clientName}</strong> referente ao contrato <strong>${numeroContrato || '---'}</strong> com <strong>${segurado || '---'}</strong>. Se perceber qualquer erro na importância segurada ou objeto, por favor, nos informe imediatamente.`
      : `Segue dados da minuta da <strong>${clientName}</strong> para participar do pregão do <strong>${orgaoLicitante || 'Órgão Licitante'}</strong>. Se perceber qualquer erro na importância segurada, por favor, nos informe imediatamente.`

    const summaryTable = isPerformance 
      ? `
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">Seguradora:</td>
          <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 15px;">${seguradora || 'Não Informada'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Número do Contrato:</td>
          <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 14px;">${numeroContrato || '---'}</td>
        </tr>
        <tr style="background-color: #f0f9ff;">
          <td style="padding: 8px 10px; color: #0369a1; font-size: 13px; font-weight: bold;">Segurado:</td>
          <td style="padding: 8px 10px; color: #0369a1; font-weight: 900; font-size: 15px;">${segurado || '---'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Objeto:</td>
          <td style="padding: 8px 0; color: #1B263B; font-size: 13px;">${objetoContrato || '---'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Valor do Contrato:</td>
          <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 14px;">${formattedContrato}</td>
        </tr>
      `
      : `
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">Seguradora:</td>
          <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 15px;">${seguradora || 'Não Informada'}</td>
        </tr>
        <tr style="background-color: #fffbeb;">
          <td style="padding: 8px 10px; color: #b45309; font-size: 13px; font-weight: bold; width: 40%;">Data do Pregão:</td>
          <td style="padding: 8px 10px; color: #b45309; font-weight: 900; font-size: 15px;">${formattedPregao}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">Valor do Edital:</td>
          <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 15px;">${formattedLote}</td>
        </tr>
      `

    const htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 25px;">
           <h2 style="color: #1B263B; margin: 0; font-size: 22px; border-bottom: 2px solid #C69C6D; display: inline-block; padding-bottom: 5px;">Minuta para Conferência</h2>
        </div>
        
        <p style="font-size: 16px;">${greeting}</p>
        
        <p style="font-size: 15px;">${mainMessage}</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #C69C6D; padding: 15px; margin: 20px 0; border-radius: 8px;">
           <p style="margin: 5px 0; font-size: 14px; color: #64748b;">Emitimos com data anterior ao pregão/instrumento contratual, pois temos notado que alguns órgãos públicos desclassificam empresas por não entenderem que o seguro já está vigente no momento da disputa, e isso não altera o valor.</p>
        </div>

        <p style="font-size: 15px;">Além disso, pedimos que verifique se há necessidade de sigilo do licitante. Se houver, lembre-se de que sua apólice contém os dados da empresa proponente.</p>

        <div style="margin: 25px 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #1B263B; color: white; padding: 10px 15px; font-weight: bold; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
            Resumo da Minuta
          </div>
          <div style="padding: 15px;">
            <table style="width: 100%; border-collapse: collapse;">
              ${summaryTable}
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">Valor da Garantia:</td>
                <td style="padding: 8px 0; color: #C69C6D; font-weight: bold; font-size: 15px;">${formattedIs}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Valor do Prêmio:</td>
                <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 15px;">${formattedPremio}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Vigência:</td>
                <td style="padding: 8px 0; color: #1B263B; font-weight: bold; font-size: 14px;">${formattedInicio} - ${formattedFim}</td>
              </tr>
            </table>
          </div>
        </div>
        
        <p style="font-size: 15px; font-weight: bold; color: #1B263B; text-align: center; margin-top: 30px;">No aguardo do OK para emitir a apólice.</p>
        
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; text-align: center;">
          <p style="margin-bottom: 5px; font-weight: bold; color: #1B263B; font-size: 14px;">F&G Corretora de Seguros</p>
          <div style="margin-bottom: 15px;">
            <a href="https://www.instagram.com/fg_segurogarantia" style="text-decoration: none; color: #E1306C; font-size: 12px; font-weight: bold; margin: 0 8px;">Instagram</a>
            <span style="color: #ccc;">|</span>
            <a href="https://www.linkedin.com/company/107618467" style="text-decoration: none; color: #0077B5; font-size: 12px; font-weight: bold; margin: 0 8px;">LinkedIn</a>
          </div>
          <p style="font-size: 11px; color: #94a3b8;">
            <a href="https://fegsegurogarantia.com.br" style="color: #C69C6D; text-decoration: none;">fegsegurogarantia.com.br</a>
          </p>
        </div>
      </div>
    `

    const resendPayload: any = {
      from: 'F&G Corretora <contato@fegsegurogarantia.com.br>',
      to: [clientEmail.trim()],
      subject: `Minuta para Conferência - ${clientName}`,
      html: htmlBody,
    }

    if (attachment && attachmentName) {
      resendPayload.attachments = [
        {
          filename: attachmentName,
          content: attachment,
        }
      ]
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(resendPayload),
    })

    const status = res.status
    const result = await res.json()
    console.log(`[Draft Approval Response] Status: ${status}`, JSON.stringify(result))

    if (!res.ok) {
      throw new Error(`Resend error (${status}): ${JSON.stringify(result)}`)
    }

    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    })

  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error'
    console.error('Function execution error:', errorMessage)
    return new Response(JSON.stringify({ error: errorMessage }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400 
    })
  }
})
