
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

    const formattedIs = isGarantida || 'R$ 0,00'
    const formattedLote = valorLote || 'R$ 0,00'
    const formattedContrato = valorContrato || 'R$ 0,00'
    const formattedPremio = premio || 'R$ 0,00'
    const formattedPregao = dataPregao ? new Date(dataPregao).toLocaleDateString('pt-BR') : '--/--/----'
    const formattedInicio = vigenciaInicio ? new Date(vigenciaInicio).toLocaleDateString('pt-BR') : '--/--/----'
    const formattedFim = vigenciaFim ? new Date(vigenciaFim).toLocaleDateString('pt-BR') : '--/--/----'

    const isPerformance = tipoSeguro === 'Performance'
    
    // Greeting
    const greeting = decisor ? `Olá ${decisor}, tudo bem?` : `Olá, tudo bem?`
    const formalGreeting = decisor ? `Prezado(a) <strong>${decisor}</strong>,` : `Prezado(a),`

    // Main Message & Title
    const emailTitle = isPerformance ? "Minuta para Conferência – Seguro Garantia de Contrato" : "Minuta para Conferência"
    const mainMessage = isPerformance 
      ? `Encaminhamos a minuta do Seguro Garantia de Contrato referente aos dados abaixo para sua conferência e aprovação.`
      : `${greeting}<br><br>Segue dados da minuta da <strong>${clientName}</strong> para participar do pregão do <strong>${orgaoLicitante || 'Órgão Licitante'}</strong>. Se perceber qualquer erro na importância segurada, por favor, nos informe imediatamente.`

    const summaryTable = isPerformance 
      ? `
        <tr>
          <td style="padding: 10px; color: #64748b; font-size: 13px; width: 40%; border: 1px solid #e2e8f0;"><strong>Seguradora</strong></td>
          <td style="padding: 10px; color: #1B263B; font-size: 14px; border: 1px solid #e2e8f0;">${seguradora || 'Não Informada'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; color: #64748b; font-size: 13px; border: 1px solid #e2e8f0;"><strong>Número do Contrato</strong></td>
          <td style="padding: 10px; color: #1B263B; font-size: 14px; border: 1px solid #e2e8f0;">${numeroContrato || '---'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; color: #64748b; font-size: 13px; border: 1px solid #e2e8f0;"><strong>Segurado</strong></td>
          <td style="padding: 10px; color: #1B263B; font-size: 14px; border: 1px solid #e2e8f0;">${segurado || '---'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; color: #64748b; font-size: 13px; border: 1px solid #e2e8f0;"><strong>Objeto</strong></td>
          <td style="padding: 10px; color: #1B263B; font-size: 14px; border: 1px solid #e2e8f0;">${objetoContrato || '---'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; color: #64748b; font-size: 13px; border: 1px solid #e2e8f0;"><strong>Valor do Contrato</strong></td>
          <td style="padding: 10px; color: #1B263B; font-size: 14px; border: 1px solid #e2e8f0;">${formattedContrato}</td>
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

    const extraRows = isPerformance ? `
      <tr>
        <td style="padding: 10px; color: #64748b; font-size: 13px; width: 40%; border: 1px solid #e2e8f0;"><strong>Valor da Garantia</strong></td>
        <td style="padding: 10px; color: #C69C6D; font-weight: bold; font-size: 14px; border: 1px solid #e2e8f0;">${formattedIs}</td>
      </tr>
      <tr>
        <td style="padding: 10px; color: #64748b; font-size: 13px; border: 1px solid #e2e8f0;"><strong>Valor do Prêmio</strong></td>
        <td style="padding: 10px; color: #1B263B; font-weight: bold; font-size: 14px; border: 1px solid #e2e8f0;">${formattedPremio}</td>
      </tr>
      <tr>
        <td style="padding: 10px; color: #64748b; font-size: 13px; border: 1px solid #e2e8f0;"><strong>Vigência</strong></td>
        <td style="padding: 10px; color: #1B263B; font-weight: bold; font-size: 13px; border: 1px solid #e2e8f0;">${formattedInicio} - ${formattedFim}</td>
      </tr>
    ` : `
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
    `

    const footerMessage = isPerformance 
      ? `Solicitamos que verifique as informações contidas na minuta. Caso identifique qualquer divergência, pedimos que nos informe imediatamente para que possamos realizar a correção antes da emissão.<br><br>Aguardamos seu <strong>OK</strong> para darmos sequência à emissão da apólice.`
      : `No aguardo do OK para emitir a apólice.`

    const htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 25px;">
           <h2 style="color: #1B263B; margin: 0; font-size: 20px; border-bottom: 3px solid #C69C6D; display: inline-block; padding-bottom: 5px;">${emailTitle}</h2>
        </div>
        
        <p style="font-size: 15px; color: #1B263B;">${isPerformance ? formalGreeting : ''}</p>
        
        <p style="font-size: 15px; color: #1B263B;">${mainMessage}</p>
        
        ${!isPerformance ? `
        <div style="background-color: #f8fafc; border-left: 4px solid #C69C6D; padding: 15px; margin: 20px 0; border-radius: 8px;">
           <p style="margin: 5px 0; font-size: 14px; color: #1B263B;">Emitimos com data anterior ao pregão/instrumento contratual, pois temos notado que alguns órgãos públicos desclassificam empresas por não entenderem que o seguro já está vigente no momento da disputa, e isso não altera o valor.</p>
        </div>

        <p style="font-size: 15px; color: #1B263B;">Além disso, pedimos que verifique se há necessidade de sigilo do licitante. Se houver, lembre-se de que sua apólice contém os dados da empresa proponente.</p>
        ` : ''}

        <div style="margin: 25px 0; border: 2px solid #C69C6D; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #1B263B; color: #C69C6D; padding: 12px 15px; font-weight: bold; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
            Resumo da Minuta
          </div>
          <div style="padding: ${isPerformance ? '0' : '15px'};">
            <table style="width: 100%; border-collapse: collapse;">
              ${summaryTable}
              ${extraRows}
            </table>
          </div>
        </div>
        
        <p style="font-size: 15px; font-weight: ${isPerformance ? 'normal' : 'bold'}; color: #1B263B; text-align: ${isPerformance ? 'left' : 'center'}; margin-top: 30px;">${footerMessage}</p>
        
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 25px; text-align: center;">
          <p style="margin-bottom: 5px; font-weight: 900; color: #1B263B; font-size: 16px; text-transform: uppercase; letter-spacing: 1px;">F&G Seguro Garantia</p>
          <div style="margin-bottom: 20px;">
            <a href="https://www.instagram.com/fg_segurogarantia" style="text-decoration: none; color: #C69C6D; font-size: 12px; font-weight: bold; margin: 0 12px; border: 1px solid #C69C6D; padding: 5px 12px; border-radius: 6px;">Instagram</a>
            <a href="https://www.linkedin.com/company/107618467" style="text-decoration: none; color: #C69C6D; font-size: 12px; font-weight: bold; margin: 0 12px; border: 1px solid #C69C6D; padding: 5px 12px; border-radius: 6px;">LinkedIn</a>
          </div>
          <p style="font-size: 13px;">
            <a href="https://fegsegurogarantia.com.br" style="color: #1B263B; text-decoration: none; font-weight: bold;">fegsegurogarantia.com.br</a>
          </p>
        </div>
      </div>
    `

    const resendPayload: any = {
      from: 'F&G Corretora <contato@fegsegurogarantia.com.br>',
      to: [clientEmail.trim()],
      subject: isPerformance ? `Minuta para Conferência – Seguro Garantia de Contrato - ${clientName}` : `Minuta para Conferência - ${clientName}`,
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
