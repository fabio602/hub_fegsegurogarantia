import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SYSTEM_PROMPT = `Você é um extrator especializado em documentos de seguro garantia brasileiros (apólices e minutas).
Extraia os campos abaixo e retorne APENAS um JSON válido, sem texto extra, sem markdown.

DEFINIÇÕES IMPORTANTES (seguro garantia):
- TOMADOR: a empresa privada que CONTRATOU o seguro e paga o prêmio. É uma empresa privada (CNPJ de empresa privada).
- SEGURADO / BENEFICIÁRIO / ÓRGÃO LICITANTE: o órgão público ou entidade que recebe a garantia.

Campos a extrair:
- nome: razão social do TOMADOR (empresa privada)
- cnpj: CNPJ do Tomador
- orgao_licitante: razão social do SEGURADO / BENEFICIÁRIO
- seguradora: nome da seguradora emissora
- modalidade: modalidade do seguro
- premio: valor do Prêmio Líquido em reais (formato R$ 160,00)
- valor_garantia: Limite Máximo de Garantia (LMG) em reais
- vigencia_inicio: data início de vigência (formato dd/mm/aaaa)
- vigencia_fim: data fim de vigência (formato dd/mm/aaaa)
- num_apolice: número da apólice
- num_proposta: número da proposta

Se um campo não estiver disponível, use string vazia "".
Retorne APENAS o JSON, sem nenhum texto antes ou depois.`;

/**
 * Muitas apólices brasileiras são PDFs com assinatura digital CMS/PKCS#7.
 * O arquivo começa com dados ASN.1 e o PDF real está embutido dentro.
 * Esta função detecta e extrai o PDF real automáticamente.
 */
function extractPdfIfCmsWrapped(pdfBase64: string): string {
  // Decode base64 to bytes
  const binaryStr = atob(pdfBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // If already starts with %PDF-, nothing to do
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return pdfBase64;
  }

  // Search for %PDF- marker (0x25 0x50 0x44 0x46 0x2D)
  let pdfStart = -1;
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x25 && bytes[i+1] === 0x50 && bytes[i+2] === 0x44 && bytes[i+3] === 0x46 && bytes[i+4] === 0x2D) {
      pdfStart = i;
      break;
    }
  }

  if (pdfStart === -1) {
    console.log('No %PDF- marker found, sending original');
    return pdfBase64; // Not CMS wrapped, send as-is
  }

  console.log(`CMS-wrapped PDF detected. PDF starts at offset ${pdfStart}`);

  // Find last %%EOF to get the end of the actual PDF
  let pdfEnd = bytes.length;
  for (let i = bytes.length - 1; i > pdfStart + 4; i--) {
    if (bytes[i] === 0x46 && bytes[i-1] === 0x4F && bytes[i-2] === 0x45 &&
        bytes[i-3] === 0x25 && bytes[i-4] === 0x25) { // %%EOF backwards
      pdfEnd = i + 1;
      // Include trailing newlines
      while (pdfEnd < bytes.length && (bytes[pdfEnd] === 0x0A || bytes[pdfEnd] === 0x0D || bytes[pdfEnd] === 0x20)) {
        pdfEnd++;
      }
      break;
    }
  }

  // Extract and re-encode
  const pdfBytes = bytes.slice(pdfStart, pdfEnd);
  let out = '';
  for (let i = 0; i < pdfBytes.length; i++) {
    out += String.fromCharCode(pdfBytes[i]);
  }
  console.log(`Extracted PDF: ${pdfBytes.length} bytes`);
  return btoa(out);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    });
  }

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

  try {
    const { pdf_base64 } = await req.json();

    if (!pdf_base64) {
      return new Response(JSON.stringify({ error: 'pdf_base64 é obrigatório' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Auto-extract PDF from CMS digital signature wrapper if needed
    const cleanPdfBase64 = extractPdfIfCmsWrapped(pdf_base64);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: cleanPdfBase64 }
            },
            {
              type: 'text',
              text: 'Extraia os dados deste documento de seguro garantia. Lembre-se: nome e cnpj devem ser do TOMADOR (empresa privada), e orgao_licitante deve ser o SEGURADO/BENEFICIÁRIO (órgão público). Retorne o JSON.'
            }
          ]
        }]
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(result));
      return new Response(JSON.stringify({ error: 'Erro ao processar com IA', details: result }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const text = result.content[0].text.trim();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      data = match ? JSON.parse(match[0]) : {};
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno', message: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
