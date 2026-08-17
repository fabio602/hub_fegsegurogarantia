import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

    const { messages, context } = await req.json();
    if (!messages || messages.length === 0) throw new Error('Nenhuma mensagem enviada');

    const systemPrompt = `Você é um assistente especializado em seguros de garantia e licitações públicas brasileiras, integrado ao Hub da FEG Seguro Garantia — uma corretora de seguros especializada em seguro-garantia.

Seu papel é ajudar os corretores da FEG com:
- Dúvidas sobre seguro-garantia de proposta (bid bond) e de execução contratual (performance bond)
- Análise de editais e contratos públicos
- Legislação: Lei 14.133/2021 (Nova Lei de Licitações), Lei 8.666/93, Lei 10.520/02
- Cálculos de IS (importância segurada), vigência de garantia, percentuais
- Prospecção e carteira de clientes
- Procedimentos internos da corretora
- Qualquer outra dúvida relacionada ao dia a dia da corretora

${context ? `Contexto atual do usuário: ${context}` : ''}

Seja conciso, direto e prático. Use linguagem profissional mas acessível. Quando relevante, cite artigos de lei. Formate valores em BRL (R$) e datas no padrão brasileiro (DD/MM/AAAA).`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '';

    return new Response(JSON.stringify({ success: true, text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[chat-assistant] Erro:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
