import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
/** Opcional: recebe lembretes de vendas com vendedor não listado em SELLERS (ex.: Larissa, Equipe). */
const STALE_REMINDERS_FALLBACK_EMAIL = Deno.env.get("STALE_REMINDERS_FALLBACK_EMAIL")?.trim() || null

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

const toPtBrDateTime = (value: any) => {
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return "--/--/----"
    return d.toLocaleString("pt-BR")
  } catch {
    return "--/--/----"
  }
}

const TZ_BR = "America/Sao_Paulo"

/** Data civil (YYYY-MM-DD). Campo `data` tipo date: usa o dia literal; timestamps usam fuso America/Sao_Paulo. */
const calendarYmdInSaoPaulo = (value: any): string | null => {
  try {
    if (value == null) return null
    if (typeof value === "string") {
      const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/)
      if (m) return `${m[1]}-${m[2]}-${m[3]}`
    }
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ_BR }).format(d)
  } catch {
    return null
  }
}

/** True se a última atualização é de um dia civil anterior ao de hoje em BRT (≥ 1 dia “em aberto”). */
const isStaleByCalendarDayBrt = (lastRaw: any, now = new Date()) => {
  const lastYmd = calendarYmdInSaoPaulo(lastRaw)
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_BR }).format(now)
  if (!lastYmd) return false
  return lastYmd < todayYmd
}

const todayBrtYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ_BR }).format(new Date())

const alreadySentToday = async (
  supabase: any,
  args: { saleId: number; reminderKey: string; reminderDate: string; toEmail: string },
) => {
  const { saleId, reminderKey, reminderDate, toEmail } = args
  const { data: existing, error: selectError } = await supabase
    .from("email_reminder_logs")
    .select("id")
    .eq("sale_id", saleId)
    .eq("reminder_key", reminderKey)
    .eq("reminder_date", reminderDate)
    .eq("to_email", toEmail)
    .limit(1)

  if (selectError) throw selectError
  return !!(existing && existing.length > 0)
}

const recordReminderSent = async (
  supabase: any,
  args: { saleId: number; reminderKey: string; reminderDate: string; audience: "seller"; toEmail: string },
) => {
  const { saleId, reminderKey, reminderDate, audience, toEmail } = args
  const { error: insertError } = await supabase.from("email_reminder_logs").insert([{
    sale_id: saleId,
    reminder_key: reminderKey,
    reminder_date: reminderDate,
    audience,
    to_email: toEmail,
  }])
  if (insertError) throw insertError
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

    const { data: sales, error } = await supabase
      .from("sales")
      .select("*")
      .eq("vendeu", "Em andamento")

    if (error) throw error

    const stale = (sales || []).filter((s: any) => {
      const last = s.updated_at ?? s.created_at ?? s.data
      return isStaleByCalendarDayBrt(last)
    })

    let sent = 0
    const skipped: any[] = []
    const todayBrt = todayBrtYmd()

    for (const s of stale) {
      const mapped = sellerEmailByName(s.vendedor)
      const toEmail = (mapped || STALE_REMINDERS_FALLBACK_EMAIL || "").trim()
      if (!toEmail) {
        skipped.push({
          id: s.id,
          reason: "seller_email_not_found",
          vendedor: s.vendedor,
          hint: "Defina STALE_REMINDERS_FALLBACK_EMAIL na edge function ou inclua o vendedor em SELLERS",
        })
        continue
      }
      if (await alreadySentToday(supabase, {
        saleId: Number(s.id),
        reminderKey: "stale_sales",
        reminderDate: todayBrt,
        toEmail,
      })) {
        skipped.push({ id: s.id, reason: "already_sent_today", to: toEmail })
        continue
      }

      const clientName = s.nome || "Cliente"
      const premio = s.premio || "—"
      const lastUpdatedRaw = s.updated_at ?? s.created_at ?? s.data
      const lastUpdated = toPtBrDateTime(lastUpdatedRaw)

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 25px;">
            <h2 style="color: #1B263B; margin: 0; font-size: 18px; border-bottom: 3px solid #C69C6D; display: inline-block; padding-bottom: 5px;">Follow-up pendente</h2>
          </div>
          
          <p style="font-size: 14px; color: #1B263B;">
            Esta venda está com status <strong>Em andamento</strong> há <strong>pelo menos um dia civil</strong> (calendário Brasil) sem alteração no registro.
            Por favor, faça o follow-up com o cliente e atualize o registro.
          </p>
          
          <div style="margin: 20px 0; border: 2px solid #C69C6D; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #1B263B; color: #C69C6D; padding: 12px 15px; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
              Detalhes
            </div>
            <div style="padding: 15px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 40%;">Cliente:</td>
                  <td style="padding: 8px 0; color: #1B263B; font-weight: 900; font-size: 15px;">${clientName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Valor do Prêmio:</td>
                  <td style="padding: 8px 0; color: #1B263B; font-weight: 800; font-size: 14px;">${premio}</td>
                </tr>
                <tr style="background-color: #fffbeb;">
                  <td style="padding: 8px 10px; color: #b45309; font-size: 13px; font-weight: bold;">Última atualização:</td>
                  <td style="padding: 8px 10px; color: #b45309; font-weight: 900; font-size: 14px;">${lastUpdated}</td>
                </tr>
              </table>
            </div>
          </div>
          
          <p style="font-size: 14px; color: #1B263B; text-align: center; font-weight: 800;">
            Ação sugerida: <strong>entrar em contato</strong> e registrar o progresso no sistema.
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
          subject: `Follow-up pendente - ${clientName}`,
          html: htmlBody,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        skipped.push({ id: s.id, reason: "resend_error", status: res.status, body: errText })
        continue
      }

      await recordReminderSent(supabase, {
        saleId: Number(s.id),
        reminderKey: "stale_sales",
        reminderDate: todayBrt,
        audience: "seller",
        toEmail,
      })
      sent++
    }

    return new Response(JSON.stringify({ checked: (sales || []).length, stale: stale.length, sent, skipped }), {
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

