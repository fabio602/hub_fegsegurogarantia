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

    const { pdfBase64, contexto, tipo } = await req.json();
    if (!pdfBase64) throw new Error('PDF da minuta não enviado');
    if (!contexto) throw new Error('Contexto de dados originais não enviado');

    const tipoDoc = tipo === 'contrato' ? 'contrato administrativo' : 'edital de licitação';
    const tipoGarantia = tipo === 'contrato' ? 'seguro-garantia de execução contratual' : 'seguro-garantia de proposta (bid bond)';

    const prompt = `Você é um auditor especialista em ${tipoGarantia} no Brasil.

Sua tarefa é fazer o DOUBLE CHECK de uma minuta de seguro, comparando os dados da minuta com os dados extraídos do ${tipoDoc} original.

DADOS ORIGINAIS EXTRAÍDOS DO ${tipoDoc.toUpperCase()}:
${contexto}

Analise o PDF da minuta de seguro anexo e valide CADA UM DOS CAMPOS acima.

Para cada campo:
- Compare o valor esperado (dados originais) com o que está na minuta
- Classifique como "ok" se estiver correto, "divergencia" se houver diferença, "nao_encontrado" se o campo não aparecer na minuta
- Se for "divergencia", descreva claramente o que está errado

Retorne SOMENTE o JSON abaixo, sem texto extra, sem markdown:

{
  "status_geral": "aprovado" ou "divergencias" ou "verificar",
  "itens": [
    {
      "campo": "Nome do campo verificado",
      "esperado": "Valor esperado conforme dados originais",
      "encontrado": "Valor encontrado na minuta (ou 'Não localizado na minuta')",
      "status": "ok" ou "divergencia" ou "nao_encontrado",
      "observacao": "Explicação adicional se necessário, ou null"
    }
  ],
  "resumo": "Resumo geral do double check em 2-3 linhas: quantos campos OK, quais divergências críticas encontradas."
}

REGRAS:
- status_geral = "aprovado" se todos os campos verificados estiverem OK
- status_geral = "divergencias" se houver qualquer campo com status "divergencia"
- status_geral = "verificar" se houver campos "nao_encontrado" mas sem divergências explícitas
- Seja rigoroso: diferenças de CNPJ, valor, datas e vigência são críticas
- Diferenças de formatação ou grafia menor podem ser observadas mas não necessariamente marcadas como divergência
- Se a minuta tiver um campo que o original não tinha, inclua como item extra com status "ok" ou observação`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} — ${err}`);
    }

    const anthropicData = await response.json();
    const rawText = anthropicData.content?.[0]?.text ?? '';

    let resultado;
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      resultado = JSON.parse(cleaned);
    } catch {
      resultado = { raw: rawText, parse_error: true };
    }

    return new Response(JSON.stringify({ success: true, data: resultado }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[validate-minuta] Erro:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
