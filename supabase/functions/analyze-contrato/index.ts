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

    const { pdfBase64, fileName } = await req.json();
    if (!pdfBase64) throw new Error('PDF não enviado');

    const prompt = `Você é um especialista em contratos públicos brasileiros e seguros de garantia de execução contratual (performance bond).

Analise este contrato administrativo/público e extraia APENAS as informações abaixo, com máxima precisão.

CONCEITOS IMPORTANTES — distinga claramente:
- "TOMADOR": a empresa privada que irá EXECUTAR o contrato (contratada). Extraia CNPJ e razão social.
- "SEGURADO": o órgão público CONTRATANTE (que recebe a garantia). Extraia CNPJ e nome.
- "Importância Segurada (IS)": valor garantido pelo seguro — normalmente um percentual do valor do contrato (ex: 5%, 10%, 30%).
- "Vigência da garantia": período de cobertura do seguro garantia — pode ser igual à vigência do contrato + prazo adicional.
- "Dias adicionais": prazo extra de cobertura após o término do contrato exigido pelo órgão (ex: "mais 90 dias após o término").
- "Cláusula específica de garantia": qualquer cláusula no contrato que detalhe condições especiais do seguro garantia.
- "Coberturas adicionais": multas contratuais, verbas trabalhistas, rescisão — se o contrato exige explicitamente essas coberturas no seguro.
- "Contrato abaixo de 85%": situação prevista na Lei 14.133/2021 (art. 59, §4º) — quando o lance vencedor foi mais de 15% abaixo do valor de referência, o órgão pode exigir garantia adicional. Busque menção explícita a isso no contrato.

Retorne SOMENTE o JSON abaixo, sem texto extra, sem markdown:

{
  "numero_contrato": "Número/identificação do contrato (ex: Contrato nº 045/2024), ou null",
  "objeto_contrato": "Objeto/finalidade do contrato em 1-2 frases",
  "tomador_cnpj": "CNPJ da empresa contratada (tomador do seguro) no formato XX.XXX.XXX/XXXX-XX, ou null",
  "tomador_nome": "Razão social da empresa contratada (tomador), ou null",
  "segurado_cnpj": "CNPJ do órgão público contratante (segurado) no formato XX.XXX.XXX/XXXX-XX, ou null",
  "segurado_nome": "Nome do órgão público contratante (segurado), ou null",
  "valor_contrato": número com o valor total do contrato em reais (sem formatação), ou null,
  "percentual_is": número do percentual da Importância Segurada exigido (ex: 5 para "5%"), ou null,
  "valor_is_calculado": número = valor_contrato × percentual_is / 100, ou null,
  "vigencia_contrato_inicio": "Data de início do contrato no formato DD/MM/YYYY, ou null",
  "vigencia_contrato_fim": "Data de término do contrato no formato DD/MM/YYYY, ou null",
  "vigencia_garantia": "Vigência/prazo do seguro garantia conforme exigido no contrato, ou null",
  "exige_dias_adicionais": true ou false — SE o contrato exige prazo adicional de cobertura além do término do contrato,
  "dias_adicionais": número de dias adicionais exigidos após o término do contrato, ou null,
  "exige_clausula_especifica": true ou false — SE há cláusula contratual específica sobre condições do seguro garantia,
  "clausula_garantia_descricao": "Transcrição resumida da cláusula específica de garantia, se existir. null caso contrário.",
  "exige_multas_trabalhistas": true ou false — SE o contrato exige cobertura adicional de multas contratuais e/ou verbas trabalhistas no seguro,
  "contrato_abaixo_85_percent": true ou false — SE o contrato menciona que o lance ficou abaixo de 85% do valor de referência (art. 59 §4º Lei 14.133/2021) e exige garantia adicional por isso,
  "observacoes_relevantes": "Informações adicionais importantes sobre a garantia contratual — condições especiais, restrições, prazos diferenciados. Máximo 3 linhas. null se não houver nada relevante."
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
        max_tokens: 2000,
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
    console.error('[analyze-contrato] Erro:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
