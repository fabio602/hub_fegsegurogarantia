import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PDFDocument } from "npm:pdf-lib";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

/**
 * Muitas apólices brasileiras são PDFs com assinatura digital CMS/PKCS#7.
 * O arquivo começa com dados ASN.1 e o PDF real está embutido dentro.
 * Esta função detecta e extrai o PDF real automaticamente.
 */
function extractPdfIfCmsWrapped(pdfBase64: string): string {
  const bytes = b64ToBytes(pdfBase64);

  // Se já começa com %PDF-, nada a fazer
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return pdfBase64;
  }

  // Procura marcador %PDF-
  let pdfStart = -1;
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x25 && bytes[i+1] === 0x50 && bytes[i+2] === 0x44 &&
        bytes[i+3] === 0x46 && bytes[i+4] === 0x2D) {
      pdfStart = i;
      break;
    }
  }

  if (pdfStart === -1) {
    console.log('No %PDF- marker found, sending original');
    return pdfBase64;
  }

  console.log(`CMS-wrapped PDF detected. PDF starts at offset ${pdfStart}`);

  let pdfEnd = bytes.length;
  for (let i = bytes.length - 1; i > pdfStart + 4; i--) {
    if (bytes[i] === 0x46 && bytes[i-1] === 0x4F && bytes[i-2] === 0x45 &&
        bytes[i-3] === 0x25 && bytes[i-4] === 0x25) {
      pdfEnd = i + 1;
      while (pdfEnd < bytes.length && [0x0A, 0x0D, 0x20].includes(bytes[pdfEnd])) pdfEnd++;
      break;
    }
  }

  const pdfBytes = bytes.slice(pdfStart, pdfEnd);
  console.log(`Extracted PDF: ${pdfBytes.length} bytes`);
  return bytesToB64(pdfBytes);
}

/**
 * Reduz o PDF às primeiras N páginas antes de enviar à Anthropic.
 *
 * Todos os campos que extraímos (tomador, segurado, LMG, prêmio, vigência)
 * estão nas primeiras páginas. As demais são Condições Gerais padronizadas
 * (SUSEP ramo 775), idênticas em toda apólice — incluí-las desperdiça ~92%
 * dos tokens sem nenhum ganho de qualidade.
 *
 * Usa 3 páginas por padrão. Com 2 páginas o Valor Prêmio vinha sempre vazio
 * nas apólices da AllSeg: p.1 é a carta de rosto, p.2 tem a face (tomador,
 * segurado, IS, vigências) e o DEMONSTRATIVO DE PRÊMIO só aparece na p.3.
 *
 * Fallback: qualquer erro no pdf-lib devolve o PDF original intacto.
 */
async function trimToFirstPages(pdfBytes: Uint8Array, maxPages = 3): Promise<{ bytes: Uint8Array; totalPages: number }> {
  try {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const total  = srcDoc.getPageCount();
    if (total <= maxPages) return { bytes: pdfBytes, totalPages: total };

    const dstDoc = await PDFDocument.create();
    const indices = Array.from({ length: maxPages }, (_, i) => i);
    const pages   = await dstDoc.copyPages(srcDoc, indices);
    pages.forEach(p => dstDoc.addPage(p));
    const out = await dstDoc.save();
    return { bytes: out, totalPages: total };
  } catch (e) {
    console.warn(`[trim] pdf-lib falhou, enviando original: ${String(e).slice(0, 80)}`);
    const fallback = await PDFDocument.load(pdfBytes).catch(() => null);
    return { bytes: pdfBytes, totalPages: fallback?.getPageCount() ?? 0 };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

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

    // 1. Desempacota assinatura digital CMS, se presente
    const cleanPdfBase64 = extractPdfIfCmsWrapped(pdf_base64);

    // 2. Corta o PDF nas primeiras 3 páginas (face da apólice + demonstrativo
    //    de prêmio). Reduz ~92% dos tokens sem perder nenhum campo relevante.
    const MAX_PAGINAS = 3;
    const cleanBytes = b64ToBytes(cleanPdfBase64);
    const { bytes: trimmedBytes, totalPages } = await trimToFirstPages(cleanBytes, MAX_PAGINAS);
    const trimmedBase64 = bytesToB64(trimmedBytes);
    const sentPages = Math.min(MAX_PAGINAS, totalPages || MAX_PAGINAS);
    console.log(`[parse] total:${totalPages}p | enviando:${sentPages}p | bytes:${trimmedBytes.length}`);

    // 3. Envia à Anthropic
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
              source: { type: 'base64', media_type: 'application/pdf', data: trimmedBase64 }
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

    // 4. Propaga o erro real da Anthropic (status + mensagem), sem mascarar.
    //    Saldo zerado aparece como saldo zerado, não como "HTTP 500".
    if (!response.ok) {
      const anthropicMsg  = result?.error?.message ?? 'Erro na API da Anthropic';
      const anthropicType = result?.error?.type    ?? 'unknown';
      console.error(`[parse] Anthropic ${response.status} (${anthropicType}): ${anthropicMsg}`);
      return new Response(
        JSON.stringify({ error: anthropicMsg, anthropic_type: anthropicType, status: response.status }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        }
      );
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
    console.error('[parse] Erro interno:', error);
    return new Response(JSON.stringify({ error: 'Erro interno', message: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
