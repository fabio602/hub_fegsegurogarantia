import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { pdfBase64 } = await req.json();
    if (!pdfBase64) throw new Error('pdfBase64 é obrigatório');

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurado');

    const prompt = `Você é um extrator especializado em apólices de seguro brasileiras. Analise este PDF de apólice e extraia os dados no JSON abaixo.

REGRAS IMPORTANTES:
- Datas: retorne SEMPRE no formato YYYY-MM-DD (ex: 2025-03-15). Se houver "Início de Vigência" e "Fim de Vigência", use-os para vigencia_inicio e vigencia_fim.
- Valores monetários: retorne como string formatada em BRL (ex: "R$ 5.393,60")
- Tomador: é a empresa/pessoa QUE CONTRATOU o seguro (quem paga o prêmio)
- Segurado: é a empresa/pessoa QUE É BENEFICIÁRIA da cobertura
- Seguradora: é a empresa seguradora (Tokio Marine, Porto Seguro, Zurich, etc.)
- Se não encontrar um campo, retorne null
- Telefone: inclua DDD, formato (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
- Forma de pagamento: ex: "Boleto Mensal", "Boleto Anual", "Cartão de Crédito", "PIX"

Retorne APENAS o JSON, sem texto adicional:

{
  "tomador_razao_social": "razão social de quem contratou",
  "tomador_cpf_cnpj": "CPF ou CNPJ do tomador",
  "segurado_razao_social": "razão social do beneficiário (se diferente do tomador)",
  "segurado_cpf_cnpj": "CPF ou CNPJ do segurado",
  "nome_segurado": "nome completo do segurado/tomador (campo legado)",
  "cpf_cnpj": "CPF ou CNPJ principal",
  "email": "e-mail do tomador ou segurado",
  "telefone": "telefone do tomador ou segurado com DDD",
  "seguradora": "nome da seguradora",
  "numero_apolice": "número da apólice",
  "produto": "nome do produto/modalidade",
  "modalidade_rc": "modalidade de RC (ex: RC Ambiental, RC Profissional, D&O)",
  "premio_total": "prêmio total em BRL",
  "comissao": "valor de comissão em BRL",
  "vigencia_inicio": "data início vigência em YYYY-MM-DD",
  "vigencia_fim": "data fim vigência em YYYY-MM-DD",
  "forma_pagamento": "forma de pagamento",
  "limite_indenizacao": "limite máximo de indenização em BRL (RC)",
  "placa": "placa do veículo (Auto)",
  "modelo": "marca e modelo do veículo (Auto)",
  "ano": "ano do veículo (Auto)"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const anthropicData = await response.json();
    const rawText = anthropicData.content?.[0]?.text ?? '';

    // Extrai o JSON da resposta
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta inválida da IA');

    let data: Record<string, string | null>;
    try {
      data = JSON.parse(jsonMatch[0]);
    } catch {
      data = { parse_error: 'true' };
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
