import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const SELLERS = [
  { name: "Fábio", email: "fabio@fegsegurogarantia.com.br" },
  { name: "Andréia", email: "andreia@fegsegurogarantia.com.br" },
  { name: "Rafael", email: "rafael@fegsegurogarantia.com.br" },
]

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()

const sellerEmailByName = (name: string | null | undefined) => {
  if (!name) return null
  const normalized = normalizeName(name)
  const found = SELLERS.find(s => normalizeName(s.name) === normalized)
  return found?.email || null
}

const isoDateFromBrtNow = (now = new Date()) => {
  // Cron roda em UTC, mas queremos comparar com datas "do Brasil" (BRT = UTC-3).
  // Como `dataPregao` é um campo "date" (YYYY-MM-DD), basta ajustar o relógio.
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return brt.toISOString().slice(0, 10)
}

const addDaysToIsoDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const toPtBrDate = (isoDate: string) => {
  try {
    // Exibe dd/mm/aaaa
    const d = new Date(`${isoDate}T00:00:00.000Z`)
    return d.toLocaleDateString("pt-BR")
  } catch {
    return isoDate
  }
}

const shouldSendOncePerDay = async (supabase: any, args: { saleId: number; reminderKey: string; reminderDate: string; audience: "client" | "seller"; toEmail: string }) => {
  const { saleId, reminderKey, reminderDate, audience, toEmail } = args

  const { data: existing, error: selectError } = await supabase
    .from("email_reminder_logs")
    .select("id")
    .eq("sale_id", saleId)
    .eq("reminder_key", reminderKey)
    .eq("reminder_date", reminderDate)
    .eq("to_email", toEmail)
    .limit(1)

  if (selectError) throw selectError
  if (existing && existing.length > 0) return false

  const { error: insertError } = await supabase.from("email_reminder_logs").insert([{
    sale_id: saleId,
    reminder_key: reminderKey,
    reminder_date: reminderDate,
    audience,
    to_email: toEmail,
  }])

  if (insertError) throw insertError
  return true
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing environment variables (RESEND_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const todayBrt = isoDateFromBrtNow()
    const tomorrowBrt = addDaysToIsoDate(todayBrt, 1)

    const { data: sales, error } = await supabase
      .from("sales")
      .select("*")
      .eq("tipo", "Licitante")
      .not("dataPregao", "is", null)

    if (error) throw error

    const list = sales || []

    const forClient = list.filter((s: any) => String(s.dataPregao).slice(0, 10) === tomorrowBrt)
    const forSeller = list.filter((s: any) => String(s.dataPregao).slice(0, 10) === todayBrt)

    let sentClient = 0
    let sentSeller = 0
    const skipped: any[] = []

    // 1) CLIENTE (1 dia antes)
    for (const s of forClient) {
      const clientEmail = s.email
      if (!clientEmail) {
        skipped.push({ id: s.id, audience: "client", reason: "missing_client_email" })
        continue
      }
      const toEmail = String(clientEmail).trim()
      const canSend = await shouldSendOncePerDay(supabase, {
        saleId: Number(s.id),
        reminderKey: "pregao_client_d-1",
        reminderDate: todayBrt,
        audience: "client",
        toEmail,
      })
      if (!canSend) {
        skipped.push({ id: s.id, audience: "client", reason: "already_sent_today", to: toEmail })
        continue
      }

      const contactName = (s.decisor && String(s.decisor).trim()) ? String(s.decisor).trim() : "tudo bem"
      const companyName = s.nome || "sua empresa"

      const text = `Olá, ${contactName}.

Amanhã é o dia do seu pregão e nós da F&G torcemos para que tudo dê certo. Que seja mais um momento de vitória para a ${companyName}!

Aproveitamos para agradecer pela parceria e reafirmar que estamos aqui para caminhar junto com vocês — usando o Seguro Garantia como aliado estratégico nas suas operações.

Sucesso amanhã!

Equipe F&G Seguro Garantia`

      // Mantém o texto exatamente, só renderiza em HTML com quebras de linha
      const htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1B263B; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 25px;">
            <h2 style="color: #1B263B; margin: 0; font-size: 18px; border-bottom: 3px solid #C69C6D; display: inline-block; padding-bottom: 5px;">Lembrete de Pregão</h2>
          </div>
          <p style="white-space: pre-line; font-size: 15px; margin: 0;">${text}</p>
          <div style="margin-top: 35px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center;">
            <p style="margin-bottom: 5px; font-weight: 900; color: #1B263B; font-size: 15px; text-transform: uppercase; letter-spacing: 1px;">F&G Seguro Garantia</p>
            <p style="font-size: 12px; color: #64748b; margin: 0;">Pregão em ${toPtBrDate(tomorrowBrt)}</p>
          </div>
        </div>
      `

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "F&G Corretora <contato@fegsegurogarantia.com.br>",
          to: [toEmail],
          subject: `Lembrete: pregão amanhã - ${companyName}`,
          html: htmlBody,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        skipped.push({ id: s.id, audience: "client", reason: "resend_error", status: res.status, body: errText })
        continue
      }

      sentClient++
    }

    // 2) VENDEDOR (dia do pregão)
    for (const s of forSeller) {
      const sellerEmail = sellerEmailByName(s.vendedor)
      if (!sellerEmail) {
        skipped.push({ id: s.id, audience: "seller", reason: "seller_email_not_found", vendedor: s.vendedor })
        continue
      }
      const toEmail = String(sellerEmail).trim()
      const canSend = await shouldSendOncePerDay(supabase, {
        saleId: Number(s.id),
        reminderKey: "pregao_seller_d0",
        reminderDate: todayBrt,
        audience: "seller",
        toEmail,
      })
      if (!canSend) {
        skipped.push({ id: s.id, audience: "seller", reason: "already_sent_today", to: toEmail })
        continue
      }

      const companyName = s.nome || "Cliente"
      const pregaoDate = String(s.dataPregao).slice(0, 10)

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 25px;">
            <h2 style="color: #1B263B; margin: 0; font-size: 18px; border-bottom: 3px solid #C69C6D; display: inline-block; padding-bottom: 5px;">Pregão hoje</h2>
          </div>
          
          <p style="font-size: 14px; color: #1B263B;">
            O cliente <strong>${companyName}</strong> tem pregão <strong>hoje</strong> (${toPtBrDate(pregaoDate)}).
            Acompanhe o resultado e verifique se o cliente venceu e se vai precisar do <strong>Seguro Garantia de Contrato</strong>.
          </p>
          
          <div style="margin: 20px 0; border: 2px solid #C69C6D; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #1B263B; color: #C69C6D; padding: 12px 15px; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
              Detalhes
            </div>
            <div style="padding: 15px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">Cliente:</td>
                  <td style="padding: 8px 0; color: #1B263B; font-weight: 900; font-size: 15px;">${companyName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Data do pregão:</td>
                  <td style="padding: 8px 0; color: #1B263B; font-weight: 800; font-size: 14px;">${toPtBrDate(pregaoDate)}</td>
                </tr>
              </table>
            </div>
          </div>
          
          <p style="font-size: 14px; color: #1B263B; text-align: center; font-weight: 800;">
            Ação sugerida: <strong>falar com o cliente</strong> e atualizar o status no sistema.
          </p>
          
          <div style="margin-top: 35px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center;">
            <p style="margin-bottom: 5px; font-weight: 900; color: #1B263B; font-size: 15px; text-transform: uppercase; letter-spacing: 1px;">F&G Seguro Garantia</p>
            <p style="font-size: 12px; color: #64748b; margin: 0;">Mensagem automática diária</p>
          </div>
        </div>
      `

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "F&G Corretora <contato@fegsegurogarantia.com.br>",
          to: [toEmail],
          subject: `Pregão hoje - ${companyName}`,
          html: htmlBody,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        skipped.push({ id: s.id, audience: "seller", reason: "resend_error", status: res.status, body: errText })
        continue
      }

      sentSeller++
    }

    return new Response(JSON.stringify({
      todayBrt,
      tomorrowBrt,
      checked: list.length,
      matches: { client: forClient.length, seller: forSeller.length },
      sent: { client: sentClient, seller: sentSeller },
      skipped,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error: any) {
    const msg = error?.message || "Unknown error"
    console.error("Function execution error:", msg)
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  }
})

