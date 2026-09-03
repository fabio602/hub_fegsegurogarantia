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
  // READ_BY_ME é quando a leitura partiu do nosso lado (abrimos a conversa no
  // celular). Vale como lida do mesmo jeito.
  'READ_BY_ME': 'read',
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

    const isFromMe: boolean = body.fromMe === true || body.isMe === true ||
      body.type === 'SentCallback' || body.type === 'SendMsgAction' || body.type === 'SendMsgCallback';

    // Grupo. A Z-API marca com isGroup e o id do chat termina em "-group".
    // Antes tudo isso era descartado: a mensagem com participantPhone caía em
    // "group_inbound" e o id do grupo era barrado pela guarda de telefone.
    const eGrupo: boolean = body.isGroup === true ||
      String(body.phone ?? body.chatId ?? '').endsWith('-group');
    // Num grupo o nome do chat é o nome do grupo, então quem escreveu precisa
    // vir à parte para a bolha mostrar o autor, como no WhatsApp.
    const autor: string | null = eGrupo && !isFromMe
      ? (body.senderName ?? body.participantPhone ?? null)
      : null;

    // ── VISTO ────────────────────────────────────────────────────
    // Precisa vir antes da checagem de telefone. No callback de status a Z-API
    // preenche o campo `phone` com o LID (40257315688657@lid), não com o número,
    // então a guarda abaixo descartava todo recibo de leitura e o visto nunca
    // saía de um risco. Aqui o telefone nem é usado: o casamento é pelos ids.
    if (body.type === 'MessageStatusCallback' || body.type === 'DeliveryCallback') {
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

    const rawPhone: string = body.phone ?? body.chatId?.replace(/@(c|g)\.us$/, '') ?? '';
    // O hífen só é aceito no id de grupo (120363379108469082-group). Fora
    // disso continua valendo a guarda original, que existe para não gravar
    // conversa com LID ou com id de transmissão.
    const idValido = rawPhone && !rawPhone.includes('@') &&
      (!rawPhone.includes('-') || (eGrupo && rawPhone.endsWith('-group')));
    if (!idValido) {
      console.log('[descartado] invalid_phone', rawPhone);
      return new Response(JSON.stringify({ ignored: true, reason: 'invalid_phone' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const phone = rawPhone;
    // Fora de grupo o senderName é quem escreveu, que é o próprio contato.
    // Dentro do grupo ele é o participante, então o nome tem que ser o do
    // grupo (chatName), senão a conversa mudaria de nome a cada mensagem.
    const name: string = eGrupo
      ? (body.chatName ?? phone)
      : (body.chatName ?? body.senderName ?? phone);
    // Espalhado nos upserts de lead, para o hub saber que a linha é grupo.
    const comGrupo = eGrupo ? { e_grupo: true } : {};
    const zapiId: string | null = body.messageId ?? body.zaapId ?? null;
    // Foto de perfil: senderPhoto é a de quem escreveu, photo é a do chat.
    // Vem em quase todo callback, então a URL se renova sozinha antes de o
    // endereço do CDN do WhatsApp expirar.
    // No grupo a ordem se inverte: senderPhoto é a foto de quem escreveu, e
    // a que interessa na lista é a do grupo.
    const fotoUrl: string | null = eGrupo
      ? (body.photo ?? null)
      : (body.senderPhoto ?? body.photo ?? null);
    // Espalhar objeto vazio quando não veio foto evita sobrescrever a que já
    // está no banco com null num callback que não trouxe a imagem.
    const comFoto = fotoUrl ? { foto_url: fotoUrl } : {};

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

    // ── ANEXO ────────────────────────────────────────────────────
    // Fica antes do desvio entre enviada e recebida de propósito. O anexo que
    // sai do hub volta pelo webhook como fromMe, e antes só a legenda era
    // guardada: a bolha da mensagem enviada aparecia sem a imagem nem o
    // arquivo. Vale também para o que é mandado pelo celular.
    const audioObj = body.audio ?? body.audioMessage ?? null;
    const imgObj = body.image ?? body.imageMessage ?? null;
    const vidObj = body.video ?? body.videoMessage ?? null;
    const stkObj = body.sticker ?? body.stickerMessage ?? null;
    const docObj = body.documentMessage ?? body.document ?? null;

    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    let mediaName: string | null = null;

    if (audioObj) {
      mediaUrl = audioObj.audioUrl ?? audioObj.url ?? null;
      mediaType = 'audio';
    } else if (imgObj) {
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

    // Texto de apoio do anexo sem legenda. Sem ele a lista de conversas e a
    // busca ficariam com a linha em branco.
    const rotuloMidia = mediaType === 'audio' ? '[Áudio]'
      : mediaType === 'image' ? '[Imagem]'
      : mediaType === 'video' ? '[Vídeo]'
      : mediaType === 'sticker' ? '[Figurinha]'
      : mediaType === 'document' ? `[Documento: ${mediaName}]`
      : '';
    // O player de voz do hub lê audio_url; media_url serve para todo o resto.
    const comMidia = mediaType
      ? {
          media_url: mediaUrl,
          media_type: mediaType,
          media_name: mediaName,
          ...(mediaType === 'audio' ? { audio_url: mediaUrl } : {}),
        }
      : {};

    // ── MENSAGENS ENVIADAS ─────────────────────────────────────
    if (isFromMe) {
      // O hub grava a própria mensagem assim que a Z-API confirma o envio.
      // Quando essa linha já existe, o eco não pode virar uma segunda bolha.
      // A comparação é pelo id da Z-API, e não pelo texto: com anexo os dois
      // textos são diferentes ("[Imagem: foto.png] - legenda" contra a legenda
      // pura), e a mensagem acabava duplicada ou perdia o arquivo.
      if (zapiId) {
        const { data: jaGravada } = await supabase
          .from('whatsapp_messages').select('id').eq('zapi_id', zapiId).limit(1);
        if (jaGravada && jaGravada.length > 0) {
          return new Response(JSON.stringify({ success: true, bot: false, reason: 'ja_registrado' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      const messageText = extractText(body) || rotuloMidia;
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
          const updatePayload: Record<string, string> = { updated_at: new Date().toISOString(), ...comFoto };
          if (AUTO_ADVANCE_STATUSES.has(existingLead.status)) {
            updatePayload.status = 'em atendimento';
          }
          await supabase.from('whatsapp_leads').update(updatePayload).eq('phone', phone);
        } else {
          await supabase.from('whatsapp_leads').insert({ phone, name, source: 'whatsapp', status: 'em atendimento', updated_at: new Date().toISOString(), ...comFoto, ...comGrupo });
        }
        if (messageText) {
          await supabase.from('whatsapp_messages').insert({ phone, name, message: messageText, direction: 'outbound', status: 'sent', zapi_id: zapiId, ...comMidia, ...(await citarOriginal()) });
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

    if (audioObj) {
      await supabase.from('whatsapp_messages').insert({
        phone, name, message: '[Áudio]',
        direction: 'inbound', zapi_id: zapiId, autor,
        ...comMidia,
        ...(await citarOriginal()),
      });
      await supabase.from('whatsapp_leads').upsert({ phone, name, source: 'whatsapp', updated_at: new Date().toISOString(), ...comFoto, ...comGrupo }, { onConflict: 'phone', ignoreDuplicates: false });
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'audio_inbound' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Imagem, vídeo, figurinha e documento recebidos saem do mesmo bloco de
    // anexo lá de cima. Antes só a legenda era aproveitada: imagem sem legenda
    // caía em "empty_text" e sumia da conversa.
    const messageText: string = body.text?.message ?? body.image?.caption
      ?? body.video?.caption ?? body.document?.caption ?? rotuloMidia;
    if (!messageText) {
      return new Response(JSON.stringify({ ignored: true, reason: 'empty_text' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('whatsapp_messages').insert({
      phone, name, message: messageText, direction: 'inbound', zapi_id: zapiId,
      autor, ...comMidia,
      ...(await citarOriginal()),
    });
    // Nota da pesquisa de satisfação só faz sentido de um para um. Num grupo
    // qualquer "5" solto viraria avaliação de uma venda que não é daquela pessoa.
    if (!eGrupo) await trySaveSurveyScore(supabase, phone, messageText);

    const { data: existingLead } = await supabase.from('whatsapp_leads').select('status').eq('phone', phone).maybeSingle();
    if (existingLead) {
      await supabase.from('whatsapp_leads').update({ name, updated_at: new Date().toISOString(), ...comFoto, ...comGrupo }).eq('phone', phone);
      if (existingLead.status !== 'novo') {
        return new Response(JSON.stringify({ success: true, bot: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      await supabase.from('whatsapp_leads').insert({ phone, name, source: 'whatsapp', status: 'novo', updated_at: new Date().toISOString(), ...comFoto, ...comGrupo });
    }

    // A assistente nunca responde em grupo: seria um "chamei o Fábio" para uma
    // dúzia de pessoas que não pediram atendimento.
    if (eGrupo) {
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'grupo_sem_bot' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── LIGA/DESLIGA DA BOAS-VINDAS ──────────────────────────────
    // Secret BOT_WHATSAPP no dashboard do Supabase. Com valor "off" a
    // assistente não manda a boas-vindas; qualquer outro valor (ou a ausência
    // do secret) mantém o comportamento de sempre. Desliga SÓ a boas-vindas:
    // gravação de mensagens, leads, visto, presença e o agradecimento da
    // pesquisa (trySaveSurveyScore, acima) continuam funcionando.
    if (Deno.env.get('BOT_WHATSAPP') === 'off') {
      return new Response(JSON.stringify({ success: true, bot: false, reason: 'bot_desligado' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
