import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZAPI_INSTANCE_ID = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT_TOKEN = 'F1febfc77e5734fc38a3de6979b7c9bd8S';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Statuses que o sistema pode avançar automaticamente.
// Qualquer status fora desta lista foi definido manualmente e deve ser preservado.
const AUTO_ADVANCE_STATUSES = new Set(['novo', 'em atendimento']);

// ── Visto (um risco, dois riscos, dois riscos azuis) ────────────────
// A Z-API manda o avanço do status num callback à parte, com uma lista de ids.
// Os nomes dela para os nossos.
const STATUS_ZAPI: Record<string, string> = {
  'SENT': 'sent',
  'RECEIVED': 'delivered',
  'DELIVERY_ACK': 'delivered',
  'READ': 'read',
  'READ-SELF': 'read',
  'PLAYED': 'played',
};
// Status que o novo pode substituir. O callback chega fora de ordem com
// frequência, e sem isso um "entregue" atrasado apagaria o "lido".
const STATUS_ANTERIORES: Record<string, string[]> = {
  'sent': [],
  'delivered': ['sent'],
  'read': ['sent', 'delivered'],
  'played': ['sent', 'delivered', 'read'],
};

const WELCOME_MESSAGE = `Sou a assistente aqui da F&G Seguro Garantia!\n\nChamei o Fábio Lima, nosso especialista, e ele já vai te responder.\n\nSó um momento, por favor 😊\n\nAh, enquanto isso, se quiser já me conta o que precisa.`;

function startOfDayBrasilia(): string {
  const now = new Date();
  const brasilia = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const midnight = new Date(Date.UTC(
    brasilia.getUTCFullYear(), brasilia.getUTCMonth(), brasilia.getUTCDate(),
    3, 0, 0, 0
  ));
  if (now.getUTCHours() < 3) midnight.setUTCDate(midnight.getUTCDate() - 1);
  return midnight.toISOString();
}

async function sendWhatsApp(phone: string, message: string): Promise<string | null> {
  const res = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone, message }),
  });
  const data = await res.json();
  // messageId primeiro: é o id que o WhatsApp devolve depois no visto e nas
  // citações. O zaapId é interno da Z-API e não casa com nada.
  return data?.messageId ?? data?.zaapId ?? null;
}

function extractText(body: any): string {
  const direct = [
    body?.text?.message, body?.conversation, body?.body, body?.caption, body?.content,
    body?.message?.body, body?.message?.text, body?.message?.conversation,
    body?.image?.caption, body?.video?.caption, body?.document?.caption, body?.audio?.caption,
    body?.listMessage?.description, body?.buttonMessage?.contentText,
  ];
  for (const v of direct) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const targets = new Set(['text','message','body','conversation','caption','content']);
  function search(obj: any, depth = 0): string {
    if (!obj || typeof obj !== 'object' || depth > 4) return '';
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim() && targets.has(k.toLowerCase())) return v.trim();
      if (typeof v === 'object') { const found = search(v, depth + 1); if (found) return found; }
    }
    return '';
  }
  return search(body);
}

async function trySaveSurveyScore(supabase: any, phone: string, messageText: string): Promise<void> {
  const trimmed = messageText.trim();
  const score = parseInt(trimmed);
  if (isNaN(score) || score < 1 || score > 5 || trimmed.length > 1) return;
  const digits = phone.replace(/\D/g, '');
  const withDDI    = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
  const withoutDDI = withDDI.slice(2);
  const { data: sales } = await supabase.from('sales').select('id, nome, decisor, telefone')
    .is('survey_score', null).not('telefone', 'is', null).order('created_at', { ascending: false }).limit(100);
  if (!sales?.length) return;
  const match = sales.find((s: any) => {
    const sDigits = (s.telefone ?? '').replace(/\D/g, '');
    if (!sDigits) return false;
    return sDigits === withDDI || sDigits === withoutDDI || sDigits.endsWith(withoutDDI) || withDDI.endsWith(sDigits) || withoutDDI.endsWith(sDigits);
  });
  if (!match) return;
  await supabase.from('sales').update({ survey_score: score, survey_sent: true }).eq('id', match.id);
  const primeiroNome = (match.decisor || match.nome || 'cliente').trim().split(/[\s/,]+/)[0];
  const agradecimento = `Obrigado, ${primeiroNome}! É com esse retorno que continuamos melhorando para te atender cada vez melhor.\n\nQualquer necessidade, estamos aqui! 😊\nF&G Seguro Garantia`;
  await sendWhatsApp(phone, agradecimento);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Rastro de diagnóstico: sem isso não dá para saber por que um recebimento
    // foi descartado, porque o motivo só volta no corpo da resposta.
    console.log('[entrada]', body.type, 'fromMe=', body.fromMe, 'phone=', body.phone, 'status=', body.status);
    if (body.type === 'ReceivedCallback') {
      console.log('[payload]', JSON.stringify(body).slice(0, 1500));
    }

    const isFromMe: boolean = body.fromMe === true || body.isMe === true ||
      body.type === 'SentCallback' || body.type === 'SendMsgAction' || body.type === 'SendMsgCallback';

    if (!isFromMe && body.participantPhone) {
      console.log('[descartado] group_inbound', body.participantPhone);
      return new Response(JSON.stringify({ ignored: true, reason: 'group_inbound' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const rawPhone: string = body.phone ?? body.chatId?.replace('@c.us', '') ?? '';
    if (!rawPhone || rawPhone.includes('@') || rawPhone.includes('-')) {
      console.log('[descartado] invalid_phone', rawPhone);
      return new Response(JSON.stringify({ ignored: true, reason: 'invalid_phone' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const phone = rawPhone;
    const name: string = body.chatName ?? body.senderName ?? phone;
    const zapiId: string | null = body.messageId ?? body.zaapId ?? null;

    // ── VISTO ────────────────────────────────────────────────────
    // Não é mensagem: só avança o status das que já estão no banco.
    if (body.type === 'MessageStatusCallback') {
      const novo = STATUS_ZAPI[String(body.status ?? '').toUpperCase()];
      const ids: string[] = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
      const anteriores = novo ? STATUS_ANTERIORES[novo] : undefined;
      if (novo && ids.length && anteriores?.length) {
        await supabase
          .from('whatsapp_messages')
          .update({ status: novo })
          .in('zapi_id', ids)
          .in('status', anteriores);
      }
      return new Response(JSON.stringify({ success: true, reason: 'status' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── DIGITANDO ────────────────────────────────────────────────
    // Estado momentâneo do contato, guardado numa tabela à parte porque não
    // pertence a nenhuma mensagem. O hub escuta por Realtime.
    if (body.type === 'PresenceChatCallback') {
      const estado = String(body.status ?? 'AVAILABLE').toLowerCase();
      await supabase.from('whatsapp_presenca').upsert(
        { phone, estado, atualizado_em: new Date().toISOString() },
        { onConflict: 'phone' },
      );
      return new Response(JSON.stringify({ success: true, reason: 'presenca' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── REAÇÃO ───────────────────────────────────────────────────
    // Vem antes de tudo porque a reação não é uma mensagem nova: ela altera
    // uma linha que já existe. Se caísse no fluxo normal viraria uma bolha
    // solta na conversa. Emoji vazio é retirada de reação.
    const reactObj = body.reaction ?? null;
    if (reactObj) {
      const alvo: string | null = reactObj.referencedMessage?.messageId ?? null;
      const emoji: string = reactObj.value ?? '';
      if (alvo) {
        // reactionBy é quem reagiu. Se for o nosso número, a reação é nossa.
        const nossa = reactObj.referencedMessage?.fromMe === false
          ? false
          : String(reactObj.reactionBy ?? '').replace(/\D/g, '') !== phone;
        await supabase
          .from('whatsapp_messages')
          .update(nossa ? { reacao_nossa: emoji || null } : { reacao_deles: emoji || null })
          .eq('zapi_id', alvo);
      }
      return new Response(JSON.stringify({ success: true, reason: 'reaction' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    /** Quando a mensagem cita outra, a Z-API manda o id da original em
     *  referenceMessageId. Guardamos o id mais um retrato do texto, para a
     *  citação continuar legível mesmo se a original não estiver carregada. */
    const citarOriginal = async () => {
      const ref: string | null = body.referenceMessageId ?? null;
      if (!ref) return {};
      const { data: orig } = await supabase
        .from('whatsapp_messages')
        .select('message, direction')
        .eq('zapi_id', ref)
        .maybeSingle();
      return {
        responde_a: ref,
        responde_a_texto: orig?.message ?? null,
        responde_a_de: orig?.direction ?? null,
      };
    };

    // ── MENSAGENS ENVIADAS ─────────────────────────────────────
    if (isFromMe) {
      const messageText = extractText(body);
      if (!messageText) {
        await supabase.from('whatsapp_messages').insert({
          phone, name, message: '[DEBUG fromMe] payload: ' + JSON.stringify(body).slice(0, 500),
          direction: 'outbound', status: 'debug',
        });
      }
      let isBotMessage = false;
      if (messageText) {
        const since30 = new Date(Date.now() - 30000).toISOString();
        const { data: botMsg } = await supabase.from('whatsapp_messages')
          .select('id').eq('phone', phone).eq('message', messageText)
          .eq('direction', 'outbound').gte('created_at', since30).limit(1);
        isBotMessage = !!(botMsg && botMsg.length > 0);
      }
      if (!isBotMessage) {
        const { data: existingLead } = await supabase
          .from('whatsapp_leads').select('id, status').eq('phone', phone).maybeSingle();
        if (existingLead) {
          const updatePayload: Record<string, string> = { updated_at: new Date().toISOString() };
          if (AUTO_ADVANCE_STATUSES.has(existingLead.status)) {
            updatePayload.status = 'em atendimento';
          }
          await supabase.from('whatsapp_leads').update(updatePayload).eq('phone', phone);
        } else {
          await supabase.from('whatsapp_leads').insert({ phone, name, source: 'whatsapp', status: 'em atendimento', updated_at: new Date().toISOString() });
        }
        if (messageText) {
          await supabase.from('whatsapp_messages').insert({ phone, name, message: messageText, direction: 'outbound', status: 'sent', zapi_id: zapiId, ...(await citarOriginal()) });
        }
        return new Response(JSON.stringify({ success: true, bot: false, reason: 'human_sent' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'bot_echo' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── MENSAGENS RECEBIDAS ──────────────────────────────────────
    if (body.type !== 'ReceivedCallback') {
      console.log('[descartado] unknown_type', body.type);
      return new Response(JSON.stringify({ ignored: true, reason: 'unknown_type' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const audioObj = body.audio ?? body.audioMessage ?? null;
    if (audioObj) {
      const audioUrl: string = audioObj.audioUrl ?? audioObj.url ?? '';
      await supabase.from('whatsapp_messages').insert({
        phone, name, message: '[Áudio]', audio_url: audioUrl || null,
        media_url: audioUrl || null, media_type: 'audio',
        direction: 'inbound', zapi_id: zapiId,
        ...(await citarOriginal()),
      });
      await supabase.from('whatsapp_leads').upsert({ phone, name, source: 'whatsapp', updated_at: new Date().toISOString() }, { onConflict: 'phone', ignoreDuplicates: false });
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'audio_inbound' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Imagem, vídeo, figurinha e documento recebidos. Antes só a legenda era
    // aproveitada: imagem sem legenda caía em "empty_text" e sumia da conversa.
    // Agora guardamos o endereço do arquivo para a bolha mostrar a mídia.
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    let mediaName: string | null = null;

    const imgObj = body.image ?? body.imageMessage ?? null;
    const vidObj = body.video ?? body.videoMessage ?? null;
    const stkObj = body.sticker ?? body.stickerMessage ?? null;
    const docObj = body.documentMessage ?? body.document ?? null;

    if (imgObj) {
      mediaUrl = imgObj.imageUrl ?? imgObj.url ?? null;
      mediaType = 'image';
    } else if (vidObj) {
      mediaUrl = vidObj.videoUrl ?? vidObj.url ?? null;
      mediaType = 'video';
    } else if (stkObj) {
      mediaUrl = stkObj.stickerUrl ?? stkObj.url ?? null;
      mediaType = 'sticker';
    } else if (docObj) {
      mediaUrl = docObj.documentUrl ?? docObj.url ?? null;
      mediaType = 'document';
      mediaName = docObj.title ?? docObj.fileName ?? docObj.filename ?? 'arquivo';
    }

    let messageText: string = body.text?.message ?? body.image?.caption ?? body.video?.caption ?? body.document?.caption ?? '';
    if (!messageText && mediaType) {
      // Texto de apoio, para a busca e a lista de contatos não ficarem vazias.
      messageText = mediaType === 'image' ? '[Imagem]'
        : mediaType === 'video' ? '[Vídeo]'
        : mediaType === 'sticker' ? '[Figurinha]'
        : `[Documento: ${mediaName}]`;
    }
    if (!messageText) {
      return new Response(JSON.stringify({ ignored: true, reason: 'empty_text' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('whatsapp_messages').insert({
      phone, name, message: messageText, direction: 'inbound', zapi_id: zapiId,
      media_url: mediaUrl, media_type: mediaType, media_name: mediaName,
      ...(await citarOriginal()),
    });
    await trySaveSurveyScore(supabase, phone, messageText);

    const { data: existingLead } = await supabase.from('whatsapp_leads').select('status').eq('phone', phone).maybeSingle();
    if (existingLead) {
      await supabase.from('whatsapp_leads').update({ name, updated_at: new Date().toISOString() }).eq('phone', phone);
      if (existingLead.status !== 'novo') {
        return new Response(JSON.stringify({ success: true, bot: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      await supabase.from('whatsapp_leads').insert({ phone, name, source: 'whatsapp', status: 'novo', updated_at: new Date().toISOString() });
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    const { data: newerMsgs } = await supabase.from('whatsapp_messages')
      .select('id').eq('phone', phone).eq('direction', 'inbound')
      .gt('created_at', new Date(Date.now() - 2500).toISOString()).limit(2);
    if (newerMsgs && newerMsgs.length > 1) {
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'burst_debounce' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const todayStart = startOfDayBrasilia();
    const { data: todayReply } = await supabase.from('whatsapp_messages')
      .select('id').eq('phone', phone).eq('direction', 'outbound').gte('created_at', todayStart).limit(1);
    if (todayReply && todayReply.length > 0) {
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'already_today' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sentZapiId = await sendWhatsApp(phone, WELCOME_MESSAGE);
    await supabase.from('whatsapp_messages').insert({ phone, name, message: WELCOME_MESSAGE, direction: 'outbound', status: 'sent', zapi_id: sentZapiId });
    await supabase.from('whatsapp_leads').update({ status: 'em atendimento', updated_at: new Date().toISOString() }).eq('phone', phone).eq('status', 'novo');

    return new Response(JSON.stringify({ success: true, bot: 'welcome' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[whatsapp-webhook]', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
