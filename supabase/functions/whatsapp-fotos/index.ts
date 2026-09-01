// Busca a foto de perfil dos contatos que ainda não têm nenhuma.
//
// O webhook já grava a foto de quem manda mensagem, mas quem está na lista e
// não escreveu desde então ficaria sem imagem para sempre. Esta função varre
// os leads sem foto e pergunta o endereço para a Z-API, um contato por vez.
//
// É para ser chamada de vez em quando, na mão ou por um agendamento. Não roda
// tudo de uma vez: o parâmetro `limite` segura o tamanho do lote para a função
// não estourar o tempo nem a cota da Z-API.
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

async function buscarFoto(phone: string): Promise<string | null> {
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/profile-picture?phone=${phone}`;
  const res = await fetch(url, { headers: { 'Client-Token': ZAPI_CLIENT_TOKEN } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  // Contato sem foto ou com foto restrita devolve link vazio, não erro.
  const link = data?.link ?? data?.url ?? null;
  return typeof link === 'string' && link.startsWith('http') ? link : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const corpo = await req.json().catch(() => ({}));
    const limite = Math.min(Number(corpo?.limite ?? 40), 100);
    // `refazer` reprocessa quem já tem foto, para quando a URL do CDN expirar.
    const refazer = corpo?.refazer === true;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let consulta = supabase.from('whatsapp_leads').select('phone')
      .order('updated_at', { ascending: false }).limit(limite);
    if (!refazer) consulta = consulta.is('foto_url', null);
    const { data: leads } = await consulta;

    let achadas = 0;
    for (const lead of leads ?? []) {
      const foto = await buscarFoto(lead.phone);
      if (!foto) continue;
      await supabase.from('whatsapp_leads').update({ foto_url: foto }).eq('phone', lead.phone);
      achadas++;
      // Respiro entre chamadas para não bater no limite de requisições da Z-API.
      await new Promise(r => setTimeout(r, 250));
    }

    return new Response(
      JSON.stringify({ success: true, verificados: leads?.length ?? 0, achadas }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[whatsapp-fotos]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
