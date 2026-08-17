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

    const { pdfBase64, pdfBase64Array, fileName } = await req.json();
    const pdfs: string[] = pdfBase64Array ?? (pdfBase64 ? [pdfBase64] : []);
    if (pdfs.length === 0) throw new Error('Nenhum PDF enviado');

    const prompt = `Você é um especialista em licitações públicas brasileiras e seguros de garantia (seguro-garantia de proposta / bid bond).

Analise este edital de licitação e extraia APENAS as informações abaixo, com máxima precisão.

ATENÇÃO — distinga claramente estes conceitos (NÃO são sinônimos):
- "validade da proposta": prazo em que a proposta do licitante fica válida aguardando adjudicação (ex: 60 dias).
- "vigência da garantia de proposta": prazo específico do seguro-garantia de proposta, se informado separadamente.
- "garantia contratual / de execução": garantia exigida para execução do contrato — NÃO é seguro de proposta.
- "garantia legal": percentual definido em lei — não confundir com seguro de proposta.
- "período de conservação": outro conceito, ignorar.

Retorne SOMENTE o JSON abaixo, sem texto extra, sem markdown:

{
  "orgao_nome": "Nome completo do órgão/entidade licitante",
  "orgao_cnpj": "CNPJ do órgão no formato XX.XXX.XXX/XXXX-XX, ou null",
  "numero_edital": "Número/identificação do edital (ex: Pregão Eletrônico 015/2024), ou null",
  "modalidade": "Modalidade da licitação (Pregão Eletrônico, Pregão Presencial, Concorrência, etc.)",
  "objeto": "Resumo do objeto licitado em 1-2 frases",
  "valor_global_edital": número com o valor global estimado do contrato/edital em reais (sem formatação), ou null,
  "exige_seguro_garantia_proposta": true ou false — SE o edital exige explicitamente seguro-garantia de proposta (bid bond) como condição de participação,
  "percentual_garantia_proposta": número do percentual exigido para a garantia de PROPOSTA (ex: 1 para "1%"), ou null — apenas se exige_seguro_garantia_proposta for true,
  "valor_garantia_proposta_calculado": número = valor_global_edital × percentual_garantia_proposta / 100, ou null,
  "validade_proposta_dias": número em dias da validade da proposta (ex: 60), ou null,
  "vigencia_garantia_proposta": "prazo específico da vigência do seguro-garantia de proposta, SE informado separadamente da validade da proposta — caso contrário null",
  "data_sessao_publica": "Data e horário da sessão pública / abertura do pregão no formato DD/MM/YYYY HH:MM ou DD/MM/YYYY, ou null",
  "observacoes_relevantes": "Informações importantes sobre condições do seguro de proposta, restrições, ou ausência de exigência — máximo 3 linhas. null se não houver nada relevante."
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
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              ...pdfs.map((pdf: string) => ({
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdf },
              })),
              { type: 'text', text: pdfs.length > 1
                ? `Analise os ${pdfs.length} documentos acima em conjunto (edital, termo de referência e/ou anexos) e extraia as informações solicitadas considerando todos eles.\n\n${prompt}`
                : prompt },
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
    console.error('[analyze-edital] Erro:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
