import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ZAPI_INSTANCE_ID = '3F7C45AF93AD91301C9696FEEDA07377';
const ZAPI_TOKEN = '8E9F5BD8488D8591141B0834';
const ZAPI_CLIENT_TOKEN = 'F1febfc77e5734fc38a3de6979b7c9bd8S';
const BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** A Z-API só aceita base64 em forma de data URL ("data:image/png;base64,...").
 *  Mandar o miolo puro devolve 400 com "Base64/Url could not be read". O leitor
 *  do navegador já entrega no formato certo; esta função existe para o caso de
 *  chegar sem o cabeçalho, remontando-o a partir do tipo do arquivo. */
function paraDataUrl(valor: string, tipo?: string): string {
  const limpo = valor.trim();
  // O Chrome grava áudio como "audio/webm;codecs=opus". O parâmetro extra no
  // cabeçalho do data URL confunde o leitor da Z-API, e ela só olha o mime.
  if (limpo.startsWith('data:')) return limpo.replace(/;codecs=[^;,]+/i, '');
  // Link direto também é aceito pela Z-API, então passa sem mexer.
  if (limpo.startsWith('http://') || limpo.startsWith('https://')) return limpo;
  return `data:${tipo || 'application/octet-stream'};base64,${limpo}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { phone, message, file, fileName, fileType, replyTo, reaction, reactionMessageId } = await req.json();
    if (!phone) throw new Error('phone é obrigatório');

    let zapiUrl: string;
    let zapiBody: Record<string, unknown>;
    /** Endpoint alternativo, tentado só quando o primeiro recusa. Existe por
     *  causa do áudio: o Chrome grava webm/opus e o WhatsApp espera ogg/opus,
     *  então nem sempre dá para saber de antemão qual dos dois vai aceitar. */
    let zapiUrlAlt: string | null = null;

    // Reagir com emoji. Emoji vazio remove a reação, igual ao WhatsApp:
    // tocar de novo no mesmo emoji tira a reação em vez de duplicar.
    if (reactionMessageId) {
      zapiUrl = reaction ? `${BASE}/send-reaction` : `${BASE}/send-remove-reaction`;
      zapiBody = reaction
        ? { phone, reaction, messageId: reactionMessageId }
        : { phone, messageId: reactionMessageId };
    } else if (file) {
      const raw = paraDataUrl(file, fileType);
      const isImage = (fileType ?? '').startsWith('image/');
      const isAudio = (fileType ?? '').startsWith('audio/');

      if (isAudio) {
        // send-ptt entrega como mensagem de voz (a bolha com a onda sonora),
        // send-audio entrega como arquivo de música. Preferimos voz e só
        // caímos no outro se a Z-API recusar o contêiner gravado.
        zapiUrl = `${BASE}/send-ptt`;
        zapiUrlAlt = `${BASE}/send-audio`;
        zapiBody = { phone, audio: raw };
      } else if (isImage) {
        zapiUrl = `${BASE}/send-image`;
        zapiBody = { phone, image: raw, caption: message ?? '' };
      } else {
        const ext = (fileName ?? 'arquivo.pdf').split('.').pop()?.toLowerCase() ?? 'pdf';
        zapiUrl = `${BASE}/send-document/${ext}`;
        zapiBody = { phone, document: raw, fileName: fileName ?? 'arquivo', caption: message ?? '' };
      }
    } else {
      if (!message) throw new Error('message é obrigatório para mensagens de texto');
      zapiUrl = `${BASE}/send-text`;
      // messageId opcional: quando vem, a Z-API entrega como resposta citada.
      zapiBody = replyTo ? { phone, message, messageId: replyTo } : { phone, message };
    }

    const chamar = (url: string) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify(zapiBody),
    });

    // A Z-API às vezes responde 200 com um campo `error` no corpo, então olhar
    // só o status HTTP deixava passar recusa como se fosse envio bem-sucedido.
    const recusou = (r: Response, d: unknown) =>
      !r.ok || Boolean((d as Record<string, unknown> | null)?.error);

    let res = await chamar(zapiUrl);
    let data = await res.json().catch(() => null);
    if (recusou(res, data) && zapiUrlAlt) {
      console.log('Z-API recusou', zapiUrl, res.status, JSON.stringify(data), '- tentando', zapiUrlAlt);
      res = await chamar(zapiUrlAlt);
      data = await res.json().catch(() => null);
    }
    // messageId primeiro, e não zaapId: é o id do WhatsApp, o mesmo que volta
    // no MessageStatusCallback (visto) e na citação de reação. Guardar o zaapId
    // deixava a mensagem sem par na hora de casar o status.
    const zapiId = data?.messageId ?? data?.zaapId ?? null;
    console.log('Z-API response:', res.status, JSON.stringify(data));

    if (recusou(res, data)) {
      return new Response(
        JSON.stringify({ success: false, error: data?.error ?? data?.value ?? `Z-API ${res.status}`, zapiData: data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, zapiId, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
