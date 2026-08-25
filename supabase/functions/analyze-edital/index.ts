import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { z } from "npm:zod@3";
import { extractText } from "npm:unpdf";
import { PDFDocument } from "npm:pdf-lib";

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const PREFILTRO_PAGINAS = Deno.env.get('PREFILTRO_PAGINAS') === 'on';
const MAX_TOKENS = 4000;
const PLAUSIBILITY_MUNICIPAL_THRESHOLD = 100_000_000;

// ── Provedor de IA ────────────────────────────────────────────────────────────
// Trocar de provedor é mudar UM secret. Todo o pipeline de travas
// (deriveExigeGarantia, enforcePositiveLock, enforceScaleSanity, …) roda idêntico
// nos dois casos, porque callGemini devolve exatamente a mesma estrutura de
// callClaude. Nenhuma trava sabe qual provedor respondeu.
type Provedor = 'claude' | 'gemini';
const PROVEDOR_IA: Provedor =
  (Deno.env.get('PROVEDOR_IA') ?? 'claude').trim().toLowerCase() === 'gemini' ? 'gemini' : 'claude';

// Nomes de modelo são sobrescrevíveis por secret: quando o fornecedor renomear ou
// aposentar um modelo, corrige-se sem novo deploy.
const MODELOS: Record<Provedor, { rapido: string; forte: string }> = {
  claude: {
    rapido: Deno.env.get('CLAUDE_MODELO_RAPIDO') ?? 'claude-haiku-4-5-20251001',
    forte:  Deno.env.get('CLAUDE_MODELO_FORTE')  ?? 'claude-sonnet-4-6',
  },
  gemini: {
    // Conferidos em ai.google.dev/gemini-api/docs/models (doc de 14/08/2026): ambos estáveis.
    // Não usamos gemini-3.1-pro-preview no nível forte: é preview, com rate limit mais
    // restrito e descontinuação avisada com só 2 semanas — impróprio para produção.
    rapido: Deno.env.get('GEMINI_MODELO_RAPIDO') ?? 'gemini-3.5-flash-lite',
    forte:  Deno.env.get('GEMINI_MODELO_FORTE')  ?? 'gemini-3.7-flash',
  },
};

// Modelos Gemini 3.x raciocinam antes de responder e os tokens de raciocínio contam
// DENTRO de maxOutputTokens. Com o teto de 4000 usado no Claude, o raciocínio comeria
// a cota e devolveria texto vazio com finishReason=MAX_TOKENS. Daí o teto maior e o
// nível de raciocínio baixo: a tarefa aqui é extração, não dedução.
const GEMINI_MAX_TOKENS = 16000;
const GEMINI_THINKING_LEVEL = (Deno.env.get('GEMINI_THINKING_LEVEL') ?? 'low').trim().toLowerCase();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Pré-filtro de páginas ─────────────────────────────────────────────────────

// Termos ponderados — frases específicas evitam falsos positivos de cabeçalho/rodapé
const PREFILTRO_PESO10 = [
  'garantia de proposta', 'seguro-garantia', 'seguro garantia',
  'caucao', 'fianca bancaria', 'apolice', 'art. 58', 'artigo 58',
];
const PREFILTRO_PESO5 = [
  'modalidade de garantia', 'garantia de participacao',
  'percentual da garantia', '1% (um por cento)',
  'valor estimado da contratacao', 'valor global',
];
const PREFILTRO_PESO3_TEXTO = ['lote']; // 'por lote'/'valor total do lote' eram substrings — contagem dupla/tripla
const PREFILTRO_MOEDA = /r\$\s*[\d.]+,\d{2}/gi;
const PREFILTRO_TOP_N = 12; // páginas de maior score que entram na seleção

function normTermo(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
const P10N = PREFILTRO_PESO10.map(normTermo);
const P5N  = PREFILTRO_PESO5.map(normTermo);
const P3N  = PREFILTRO_PESO3_TEXTO.map(normTermo);

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

interface PrefiltroResult {
  pdfBase64: string;
  paginasOriginais?: number; // opcional: desconhecido quando erro antes da extração
  paginasEnviadas: number;
  motivo: 'desativado' | 'ok' | 'texto_vazio' | 'erro'; // 'reducao_insuficiente' removido: inalcançável
  pagsSelecionadas?: number[]; // 1-indexed, para log
}

/** Seleciona páginas relevantes e monta PDF reduzido. Nunca lança excepção. */
async function aplicarPrefiltro(pdfBase64: string): Promise<PrefiltroResult> {
  if (!PREFILTRO_PAGINAS) {
    return { pdfBase64, paginasEnviadas: 0, motivo: 'desativado' };
  }
  try {
    const pdfBytes = b64ToBytes(pdfBase64);

    // Extrai texto por página
    let pageTexts: string[];
    try {
      const { text } = await extractText(pdfBytes, { mergePages: false }) as { text: string | string[] };
      pageTexts = Array.isArray(text) ? text : [text as string];
    } catch (e) {
      console.error(`[prefiltro] erro no unpdf: ${String(e).slice(0, 100)}`);
      return { pdfBase64, paginasEnviadas: 0, motivo: 'erro' }; // paginasOriginais desconhecido
    }

    const totalPags = pageTexts.length;

    // Fallback: PDF escaneado / sem texto
    const totalChars = pageTexts.reduce((s, t) => s + t.length, 0);
    if (totalPags === 0 || totalChars / Math.max(totalPags, 1) < 50) {
      console.log(`[prefiltro] fallback:texto_vazio | ${totalPags}p`);
      return { pdfBase64, paginasOriginais: totalPags, paginasEnviadas: totalPags, motivo: 'texto_vazio' };
    }

    // Pontua cada página com pesos diferenciados
    const scores = pageTexts.map(t => {
      const n = normTermo(t);
      let s = 0;
      for (const x of P10N) if (n.includes(x)) s += 10;
      for (const x of P5N)  if (n.includes(x)) s += 5;
      for (const x of P3N)  s += 3 * (n.split(x).length - 1); // conta ocorrências
      s += 3 * (n.match(PREFILTRO_MOEDA)?.length ?? 0);
      return s;
    });

    // Top-N por score + vizinhas ±1 + 3 primeiras páginas
    const ranked = scores
      .map((s, i) => ({ i, s }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const topIdx = new Set(ranked.slice(0, PREFILTRO_TOP_N).map(x => x.i));
    const sel = new Set<number>();
    for (let i = 0; i < Math.min(3, totalPags); i++) sel.add(i);
    for (const i of topIdx) {
      if (i > 0) sel.add(i - 1);
      sel.add(i);
      if (i < totalPags - 1) sel.add(i + 1);
    }
    // Fallback: menos de 5 páginas → pega as 15 primeiras (nunca o doc inteiro)
    if (sel.size < 5) {
      for (let i = 0; i < Math.min(15, totalPags); i++) sel.add(i);
    }
    const indices = [...sel].sort((a, b) => a - b);

    const reducao = 1 - indices.length / totalPags;

    // Monta PDF reduzido
    const srcDoc = await PDFDocument.load(pdfBytes);
    const dstDoc = await PDFDocument.create();
    const pages = await dstDoc.copyPages(srcDoc, indices);
    pages.forEach(p => dstDoc.addPage(p));
    const reducidoBytes = await dstDoc.save();
    const reducidoB64 = bytesToB64(reducidoBytes);

    const pagsSel = indices.map(i => i + 1); // 1-indexed para log
    console.log(`[prefiltro] origem:${totalPags}p -> enviado:${indices.length}p | reducao:${(reducao * 100).toFixed(0)}% | motivo:ok | pags:${pagsSel.join(',')}`);
    return { pdfBase64: reducidoB64, paginasOriginais: totalPags, paginasEnviadas: indices.length, motivo: 'ok', pagsSelecionadas: pagsSel };

  } catch (e) {
    console.error(`[prefiltro] fallback:erro | ${String(e).slice(0, 100)}`);
    return { pdfBase64, paginasEnviadas: 0, motivo: 'erro' }; // paginasOriginais desconhecido
  }
}

const RequiredFieldsSchema = z.object({
  objeto: z.string(),
  // Aceita boolean ou null: null = "não determinado" é tratado pela UI como indeterminado.
  // A coerção para false foi removida — "não sei" != "não exige".
  exige_garantia_proposta: z.boolean().nullable().optional(),
});

const SYSTEM_PROMPT = `Você atua como analista técnico de subscrição de Seguro Garantia da F&G Seguro Garantia (SUSEP 242160653), especializado na Lei 14.133/2021.

═══ DEFINIÇÃO DE EDITAL (LEIA PRIMEIRO) ═══
O EDITAL é o conjunto: corpo principal + TODOS os anexos (Termo de Referência, Especificações Técnicas, Planilha Orçamentária, Minuta de Contrato, Modelos). Cada anexo é parte integrante e vinculante do edital para todos os fins legais. NUNCA descarte, marque como ausente, nem rebaixe a confiança de um dado por ele estar em anexo em vez do corpo. Se o dado está em qualquer parte do conjunto, ele está "declarado no edital".
O campo *_pagina é METADADO DE AUDITORIA (ex: "Anexo I - TR, item 4.15") — nunca é critério de aceitação ou rejeição do dado.
As cláusulas de garantia de proposta (percentual, vigência, beneficiário, CNPJ do órgão) TIPICAMENTE aparecem no Termo de Referência ou nos anexos — procure ali por padrão antes de concluir que o dado está ausente.

═══ PRINCIPIO ZERO ═══
Sua única fonte legítima de valor_global_edital é o número que o órgão licitante declarou explicitamente como valor estimado total da contratação — em qualquer parte do conjunto edital (corpo ou anexo).
Se esse número não estiver em nenhuma parte do edital: valor_global_edital = null, valor_global_edital_trecho = null, valor_global_edital_pagina = null.
Se o valor estiver presente, OBRIGATÓRIO preencher valor_global_edital_trecho (trecho literal, max 150 chars) e valor_global_edital_pagina (localização, ex: "Anexo V - Planilha Orçamentária, p. 50").
Procure por "Total Geral", "Valor total estimado", "Valor global estimado" em TODAS as páginas, incluindo os últimos anexos.

orgao_cnpj: copie o CNPJ que aparecer na cláusula de garantia de proposta, junto do trecho literal. Esse CNPJ é o correto — não procure outro nem compare com o de outra entidade.

═══ TRES CONFUSOES PROIBIDAS ═══
1. PRECO DA PROPOSTA DO LICITANTE != VALOR ESTIMADO DA CONTRATACAO.
2. QUANTITATIVO x PRECO UNITARIO != VALOR ESTIMADO.
3. SUSPEITA DE ESCALA + CAMPO PREENCHIDO = ERRO. Suspeita = null + alerta tipo:"escala".

═══ TAXONOMIA ═══
1. validade_proposta: prazo de vinculação da oferta (art. 59)
2. garantia_proposta: bid bond, art. 58
3. garantia_execucao: performance bond, arts. 96/98 - USAR OS CAMPOS exige_garantia_execucao e percentual_garantia_execucao
4. garantia_legal: garantia técnica do objeto
5. periodo_conservacao: prazo pós-recebimento

═══ TERMO INICIAL DA VIGÊNCIA DA GARANTIA DE PROPOSTA ═══
Mapeamento OBRIGATÓRIO para vigencia_garantia_termo_inicial:
- "contados da data de abertura das propostas" / "da sessão pública" / "da data do certame" / "da data de abertura do certame" / "da data de abertura da proposta" → "sessao_publica"
- "da data de entrega/apresentação/protocolo da proposta" / "da apresentação da proposta" / "da entrega da proposta" → "entrega_proposta"
- "da emissão da apólice" / "da emissão do instrumento de garantia" → "emissao" SOMENTE se esta expressão aparecer LITERALMENTE no edital
- Sem menção explícita ao marco inicial → null (NÃO chute; "emissao" é o valor MAIS RARO)
OBRIGATÓRIO: se vigencia_garantia_termo_inicial != null, preencher vigencia_garantia_termo_inicial_trecho com o trecho literal do edital (max 150 chars) que justifica o valor escolhido.
Se vier preenchido SEM trecho literal, o sistema descartará automaticamente e usará null.

═══ DIVERGENCIA DE VALIDADE ═══
Sempre compare corpo do edital vs. cada anexo separadamente com os valores.
Ex: "Edital (art. 5.6.1): 90 dias. Anexo III: 120 dias. Edital prevalece."
NUNCA omita os valores dos anexos.
Preencher divergencia_validade_proposta SOMENTE quando houver divergência REAL entre edital e anexos com valores diferentes. Se não houver divergência: null (nunca "Nenhuma divergência identificada" ou similar).

═══ ALERTAS: TIPOS PERMITIDOS ═══
tipo: "dado_ausente" | "escala" | "plausibilidade" | "juridico" | "outro"
Não existe tipo "prazo" para o modelo. As datas são avaliadas automaticamente pelo sistema.

REGRAS DE ALERTA:
1. DADO AUSENTE: quando campo esperado não foi encontrado no documento, tipo = "dado_ausente" (NÃO "escala").
2. ESCALA SUSPEITA: valor existe mas escala é suspeita (fator 10/100/1000), tipo = "escala", campo_afetado = nome_do_campo.
3. GARANTIA DE EXECUCAO: usar campos exige_garantia_execucao e percentual_garantia_execucao. NAO colocar em alertas.
4. NAO avaliar se uma data já passou ou é futura. O sistema faz isso automaticamente.
5. NAO citar nomes de regras internas (ex: "PRINCIPIO ZERO", "TRAVA POSITIVA", "BANDA DE PLAUSIBILIDADE").
6. NAO deduzir prazo de impugnação. Se houver data de impugnação no cronograma, use prazo_impugnacao_dias. Se não houver, null.
7. DEDUPLICACAO: alerta de severidade "bloqueante" NAO deve repetir o mesmo dado em pendencias_bloqueantes. Um fato = um registro. No máximo UMA pendência por campo_afetado — se tiver mais de uma sobre o mesmo campo, mantenha apenas a mais informativa.

═══ DOIS NIVEIS DE PENDENCIAS ═══
pendencias_bloqueantes: itens que IMPEDEM a emissão da apólice (ex: valor estimado desconhecido).
recomendacoes: itens de atenção operacional que não impedem a emissão (ex: "validar quantitativos", "confirmar vigência da ARP").
Se um item é operacional e não impede a emissão: vai em recomendacoes, não em pendencias_bloqueantes.
DEDUPLICACAO: no máximo UMA entrada em pendencias_bloqueantes por assunto/campo. Se o mesmo campo gerar múltiplas pendências, consolide em uma só.

Retorne SOMENTE JSON válido, sem markdown:

{
  "orgao_nome": "string ou null",
  "orgao_cnpj": "XX.XXX.XXX/XXXX-XX ou null",
  "orgao_endereco": "string ou null",
  "modalidade": "string ou null",
  "numero_edital": "string ou null",
  "numero_processo": "string ou null",
  "portal_eletronico": "string ou null",
  "objeto": "string",
  "criterio_julgamento": "string ou null",
  "sistema_registro_precos": true|false|null,
  "data_sessao_publica": "DD/MM/YYYY HH:MM ou null",
  "data_limite_propostas": "DD/MM/YYYY HH:MM ou null",
  "prazo_impugnacao_dias": numero|null,
  "prazo_esclarecimento_dias": numero|null,
  "inversao_fases": true|false|null,
  "exige_garantia_proposta": true|false,
  "percentual_garantia_proposta": numero|null,
  "base_calculo_garantia": "global"|"por_item"|"nao_especificado"|null,
  "modalidades_aceitas_garantia": ["seguro-garantia","caucao","fianca_bancaria"]|null,
  "vigencia_garantia_proposta_dias": numero|null,
  "vigencia_garantia_termo_inicial": "sessao_publica"|"entrega_proposta"|"emissao"|null,
  "vigencia_garantia_termo_inicial_trecho": "trecho literal <= 150 chars, OBRIGATORIO se termo_inicial != null, ou null",
  "consequencia_nao_apresentacao": "string curta ou null",
  "hipoteses_execucao": "string curta ou null",
  "valor_global_edital": numero|null,
  "valor_global_edital_trecho": "trecho literal <= 150 chars, OBRIGATORIO se valor != null, ou null",
  "valor_global_edital_pagina": "localização no documento ou null",
  "valor_garantia_proposta_calculado": numero|null,
  "formula_calculo": "ex: 1% x valor_global ou null",
  "validade_proposta_dias": numero|null,
  "validade_proposta_fonte": "trecho literal <= 150 chars ou null",
  "divergencia_validade_proposta": "comparação edital vs cada anexo com valores, ou null se sem divergência",
  "exige_garantia_execucao": true|false|"condicionada"|null,
  "percentual_garantia_execucao": numero|null,
  "garantia_legal_aplicavel": true|false|null,
  "periodo_conservacao_aplicavel": true|false|null,
  "alertas": [
    { "tipo": "dado_ausente"|"escala"|"plausibilidade"|"juridico"|"outro", "severidade": "info"|"atencao"|"bloqueante", "campo_afetado": "string ou null", "texto": "string <= 300 chars" }
  ],
  "pendencias_bloqueantes": ["apenas o que impede emissão, sem valor fabricado"],
  "recomendacoes": ["itens operacionais que não impedem emissão"],
  "observacoes_relevantes": "string ou null"
}`;

interface ApiError extends Error { status: number; apiMsg: string; }

/** Contrato único de resposta — o resto da função não sabe qual provedor respondeu. */
interface IaResult {
  text: string; model: string; stop_reason: string;
  input_tokens: number; output_tokens: number;
  cache_creation_input_tokens: number; cache_read_input_tokens: number;
}

/**
 * Instrução do turno do usuário. Compartilhada pelos dois provedores de propósito:
 * se cada adaptador montasse a sua, a comparação Claude x Gemini estaria medindo
 * também a diferença entre dois prompts, e não só entre dois modelos.
 */
function montaInstrucao(additionalInstructions?: string): string {
  const extra = additionalInstructions ? `\n\nINSTRUCOES ADICIONAIS:\n${additionalInstructions}` : '';
  return `Extraia os dados conforme as instruções.${extra}\n\nRetorne SOMENTE o JSON.`;
}

async function callClaude(
  model: string, fileBlocks: unknown[], additionalInstructions?: string
): Promise<IaResult> {
  const textBlock = { type: 'text', text: montaInstrucao(additionalInstructions) };

  // Aplica cache_control ao ÚLTIMO bloco de arquivo: o breakpoint cacheia tudo
  // até ele inclusive (system prompt + documentos). O textBlock fica fora do cache
  // porque varia com additionalInstructions e invalidaria o hit.
  const cachedFileBlocks = fileBlocks.length > 0
    ? [
        ...fileBlocks.slice(0, -1),
        { ...(fileBlocks[fileBlocks.length - 1] as object), cache_control: { type: 'ephemeral' } },
      ]
    : fileBlocks;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31' },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: [...cachedFileBlocks, textBlock] }] }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const msg = `Anthropic ${model} HTTP ${res.status}: ${bodyText.slice(0, 500)}`;
    throw Object.assign(new Error(msg), { status: res.status, apiMsg: bodyText.slice(0, 500) }) as ApiError;
  }
  const data = await res.json();
  return {
    text: data.content?.[0]?.text ?? '',
    model,
    stop_reason: data.stop_reason ?? 'unknown',
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
  };
}

/**
 * Adaptador Gemini. Mesma assinatura e mesmo retorno de callClaude — de propósito.
 * Toda a diferença entre as duas APIs está contida aqui dentro, e só aqui:
 *
 *  - blocos Anthropic (document/image) -> parts com inlineData
 *  - system prompt                     -> systemInstruction
 *  - finishReason 'MAX_TOKENS'         -> stop_reason 'max_tokens'
 *    (o escalamento em index.ts depende dessa string exata; se não normalizar,
 *     um truncamento passa despercebido e a resposta cortada vira resultado)
 *  - usageMetadata                     -> contadores no formato da Anthropic
 *
 * Cache: NÃO há paridade. A Anthropic usa cache_control explícito por breakpoint;
 * o Gemini 3 faz cache implícito, sem controle nosso. cache_creation fica sempre 0
 * e cache_read reflete cachedContentTokenCount quando o Google reporta. Isso
 * importa na comparação de custo da ETAPA C: o Claude tem desconto de cache
 * garantido, o Gemini só se o Google decidir que houve reuso.
 */
async function callGemini(
  model: string, fileBlocks: unknown[], additionalInstructions?: string
): Promise<IaResult> {
  const parts: unknown[] = [];
  for (const bloco of fileBlocks as Array<Record<string, unknown>>) {
    const src = (bloco?.source ?? {}) as Record<string, string>;
    if (src.type !== 'base64' || !src.data) continue;
    parts.push({ inlineData: { mimeType: src.media_type ?? 'application/pdf', data: src.data } });
  }
  parts.push({ text: montaInstrucao(additionalInstructions) });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          maxOutputTokens: GEMINI_MAX_TOKENS,
          temperature: 0,
          responseMimeType: 'application/json',
          thinkingLevel: GEMINI_THINKING_LEVEL,
        },
      }),
    },
  );
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const msg = `Gemini ${model} HTTP ${res.status}: ${bodyText.slice(0, 500)}`;
    throw Object.assign(new Error(msg), { status: res.status, apiMsg: bodyText.slice(0, 500) }) as ApiError;
  }
  const data = await res.json();

  const cand = data.candidates?.[0];
  const finish = String(cand?.finishReason ?? 'unknown');
  // Descarta parts de raciocínio (thought:true) — não são a resposta.
  const texto = ((cand?.content?.parts ?? []) as Array<Record<string, unknown>>)
    .filter((p) => typeof p?.text === 'string' && p?.thought !== true)
    .map((p) => p.text as string)
    .join('');

  // Bloqueio de segurança devolve candidato sem texto. Tratamos como erro de API
  // (e não como resposta vazia) para que o escalamento dispare em vez de seguir
  // adiante com parse nulo.
  if (!texto && finish !== 'MAX_TOKENS') {
    const blockReason = data.promptFeedback?.blockReason ?? 'n/a';
    throw Object.assign(
      new Error(`Gemini ${model} não retornou texto (finishReason=${finish}, blockReason=${blockReason})`),
      { status: 502, apiMsg: `finishReason=${finish} blockReason=${blockReason}` },
    ) as ApiError;
  }

  const u = data.usageMetadata ?? {};
  return {
    text: texto,
    model,
    stop_reason: finish === 'MAX_TOKENS' ? 'max_tokens' : finish === 'STOP' ? 'end_turn' : finish.toLowerCase(),
    input_tokens: u.promptTokenCount ?? 0,
    // Soma os tokens de raciocínio: eles são cobrados como saída e sem eles o
    // custo do Gemini apareceria artificialmente menor que o do Claude.
    output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: u.cachedContentTokenCount ?? 0,
  };
}

/** Despacha para o provedor ativo. 'rapido' = 1ª tentativa, 'forte' = escalamento. */
function callIA(
  nivel: 'rapido' | 'forte', fileBlocks: unknown[], additionalInstructions?: string
): Promise<IaResult> {
  const model = MODELOS[PROVEDOR_IA][nivel];
  return PROVEDOR_IA === 'gemini'
    ? callGemini(model, fileBlocks, additionalInstructions)
    : callClaude(model, fileBlocks, additionalInstructions);
}

interface Alerta { tipo: string; severidade: string; campo_afetado: string | null; texto: string; }

function makeAlerta(tipo: string, severidade: string, campo: string | null, texto: string): Alerta {
  return { tipo, severidade, campo_afetado: campo, texto: texto.slice(0, 300) };
}

function getAlertas(parsed: Record<string, unknown>): Alerta[] {
  if (!Array.isArray(parsed.alertas)) return [];
  return parsed.alertas.map((a: unknown) =>
    typeof a === 'string' ? makeAlerta('outro', 'atencao', null, a) : (a as Alerta)
  );
}

/**
 * Fix 2 — Derivação determinística de exige_garantia_proposta.
 * Se o modelo preencheu qualquer campo de garantia de proposta (percentual, vigência,
 * modalidades), a garantia é exigida — independente do que o modelo respondeu no campo.
 * Corrige casos em que o modelo cita a cláusula mas não fecha o boolean.
 */
function deriveExigeGarantia(parsed: Record<string, unknown>): void {
  const atual = parsed.exige_garantia_proposta;
  const evidencias: string[] = [];
  if (parsed.percentual_garantia_proposta != null)    evidencias.push('percentual_garantia_proposta');
  if (parsed.vigencia_garantia_proposta_dias != null) evidencias.push('vigencia_garantia_proposta_dias');
  if (Array.isArray(parsed.modalidades_aceitas_garantia) && parsed.modalidades_aceitas_garantia.length > 0)
    evidencias.push('modalidades_aceitas_garantia');
  if (parsed.vigencia_garantia_termo_inicial != null) evidencias.push('vigencia_garantia_termo_inicial');

  if (evidencias.length > 0 && atual !== true) {
    console.log(`[deriva-garantia] exige_garantia_proposta: ${JSON.stringify(atual)} -> true (evidências: ${evidencias.join(', ')})`);
    parsed.exige_garantia_proposta = true;
  }
  // Sem coerção para false: "não determinado" fica null.
  // A UI trata via describeTriState — o aviso "verifique manualmente" é o comportamento correto.
}

/** Remove alertas tipo "prazo" gerados pelo modelo (TypeScript os recalcula) */
function stripModelPrazoAlertas(parsed: Record<string, unknown>): void {
  const alertas = getAlertas(parsed);
  const stripped = alertas.filter(a => a.tipo !== 'prazo');
  if (stripped.length !== alertas.length) {
    console.log(`[strip] removidos ${alertas.length - stripped.length} alertas tipo:prazo do modelo`);
  }
  parsed.alertas = stripped;
}

/**
 * Fix C — Deduplicação correta:
 * 1. Deduplicação do array pendencias_bloqueantes gerado pelo modelo (pode ter duplicatas
 *    com palavras diferentes sobre o mesmo campo).
 * 2. Alertas bloqueantes MOVEM para pendencias e SAEM dos alertas.
 *    Dedup por campo_afetado: um registro por campo, independente do texto.
 */
function deduplicateBlockers(parsed: Record<string, unknown>): void {
  const alertas = getAlertas(parsed);
  const rawPend: string[] = Array.isArray(parsed.pendencias_bloqueantes) ? parsed.pendencias_bloqueantes as string[] : [];

  // Passagem 1: dedup do array de pendências vindo do modelo (mesmo fato, texto diferente).
  // Usamos comparação por prefixo bidirecional.
  const pendDeduped: string[] = [];
  for (const p of rawPend) {
    const dupWith = pendDeduped.find(e =>
      e.slice(0, 60) === p.slice(0, 60) ||
      e.includes(p.slice(0, 40)) ||
      p.includes(e.slice(0, 40))
    );
    if (dupWith) {
      console.log(`[dedup-pend] descartado (duplicata de '${dupWith.slice(0, 60)}'): '${p.slice(0, 80)}'`);
    } else {
      pendDeduped.push(p);
    }
  }

  // Passagem 2: move alertas bloqueantes para pendências, dedup por campo_afetado.
  const camposVistos = new Set<string>();
  const nonBlockers: Alerta[] = [];

  for (const a of alertas) {
    if (a.severidade === 'bloqueante') {
      // Chave de dedup: campo_afetado quando presente, senão prefixo do texto
      const campoKey = a.campo_afetado ?? `_nc_${a.texto.slice(0, 30)}`;
      if (!camposVistos.has(campoKey)) {
        camposVistos.add(campoKey);
        const alreadyInPend = pendDeduped.some(p =>
          p.includes(a.texto.slice(0, 50)) || a.texto.includes(p.slice(0, 50))
        );
        if (!alreadyInPend) pendDeduped.push(a.texto);
      }
      // Não mantém no array de alertas — move completamente
    } else {
      nonBlockers.push(a);
    }
  }

  parsed.alertas = nonBlockers;
  parsed.pendencias_bloqueantes = pendDeduped;
}

/** Trava positiva: valor_global_edital só aceito com trecho + página */
function enforcePositiveLock(parsed: Record<string, unknown>): void {
  if (parsed.valor_global_edital == null) return;
  if (!parsed.valor_global_edital_trecho || !parsed.valor_global_edital_pagina) {
    console.warn(`[lock] valor sem trecho/pagina -> null`);
    parsed.valor_global_edital = null; parsed.valor_global_edital_trecho = null;
    parsed.valor_global_edital_pagina = null; parsed.valor_garantia_proposta_calculado = null;
    parsed.formula_calculo = null;
    const alertas = getAlertas(parsed);
    alertas.unshift(makeAlerta('dado_ausente', 'atencao', 'valor_global_edital', 'Valor estimado descartado: sem trecho literal ou localização no documento.'));
    parsed.alertas = alertas;
    const pend: string[] = Array.isArray(parsed.pendencias_bloqueantes) ? parsed.pendencias_bloqueantes as string[] : [];
    parsed.pendencias_bloqueantes = ['Valor estimado: não localizado com trecho literal no edital. Confirme no PNCP ou junto ao órgão.', ...pend];
  }
}

/**
 * Fix B — Trava do vigencia_garantia_termo_inicial.
 * Regra: dado encontrado + trecho presente → aceito (de onde vier, corpo ou anexo).
 * Sem trecho → decisão por risco:
 *   "emissao" sem trecho → zera (valor raro, alto risco se errado: quebra cálculo de datas)
 *   "sessao_publica"/"entrega_proposta" sem trecho → mantém + alerta leve (valor mais comum,
 *     mesmo que errado, front usa data_sessao_publica como fallback seguro)
 */
function enforceTermoInicialLock(parsed: Record<string, unknown>): void {
  const termo = parsed.vigencia_garantia_termo_inicial;
  if (termo == null) return;
  const trecho = parsed.vigencia_garantia_termo_inicial_trecho;
  if (trecho) {
    // Verifica se o trecho é sobre validade da PROPOSTA (art. 59) e não da GARANTIA de proposta
    const MENCIONA_GARANTIA = /garantia|cau[çc][ãa]o|seguro[- ]garantia|fian[çc]a/i;
    const VALIDADE_DA_PROPOSTA = /valid(ade|ade\s+m[ií]nima)\s+d[ao]s?\s+propostas?/i;
    if (VALIDADE_DA_PROPOSTA.test(String(trecho)) && !MENCIONA_GARANTIA.test(String(trecho))) {
      console.warn(`[lock-termo] trecho é validade da PROPOSTA, não da garantia -> null`);
      parsed.vigencia_garantia_termo_inicial = null;
      parsed.vigencia_garantia_termo_inicial_trecho = null;
      parsed.vigencia_garantia_proposta_dias = null;
      const alertas = getAlertas(parsed);
      alertas.unshift(makeAlerta('dado_ausente', 'atencao', 'vigencia_garantia_proposta_dias',
        'O edital não declara vigência para a garantia de proposta. O prazo encontrado refere-se à validade da PROPOSTA (art. 59 da Lei 14.133/2021), que é coisa distinta. Defina a vigência pela política de subscrição.'));
      parsed.alertas = alertas;
      return;
    }
    // O trecho precisa nomear o marco inicial que está justificando.
    // Fragmento sem marco ("a contar de sua apresentação") não é evidência.
    const ANCORA_TERMO = /abertura\s+d[ao]\s+(sess[ãa]o|licita[çc][ãa]o|proposta|certame)|entrega\s+d[ao]s?\s+propostas?|apresenta[çc][ãa]o\s+d[ao]s?\s+propostas?|emiss[ãa]o\s+d[ao]\s+(ap[óo]lice|garantia|seguro)|data\s+d[ao]\s+sess[ãa]o/i;
    if (!ANCORA_TERMO.test(String(trecho))) {
      console.warn(`[lock-termo] trecho não nomeia marco inicial -> null | trecho: '${String(trecho).slice(0, 80)}'`);
      parsed.vigencia_garantia_termo_inicial = null;
      parsed.vigencia_garantia_termo_inicial_trecho = null;
      parsed.vigencia_garantia_proposta_dias = null;
      const alertas = getAlertas(parsed);
      alertas.unshift(makeAlerta('dado_ausente', 'atencao', 'vigencia_garantia_termo_inicial',
        'Vigência da garantia descartada: o trecho citado não identifica a partir de qual evento o prazo é contado. Confirme a cláusula no edital antes de emitir.'));
      parsed.alertas = alertas;
      return;
    }
    // Trecho presente e nomeia marco inicial: aceito
    console.log(`[lock-termo] OK — termo:'${termo}' com trecho: '${String(trecho).slice(0, 60)}'`);
    return;
  }
  // Sem trecho: aplica regra por risco
  if (termo === 'emissao') {
    // "emissao" sem evidência literal é a hallucination mais perigosa
    console.warn(`[lock-termo] 'emissao' sem trecho -> null (alto risco)`);
    parsed.vigencia_garantia_termo_inicial = null;
    parsed.vigencia_garantia_termo_inicial_trecho = null;
    const alertas = getAlertas(parsed);
    alertas.push(makeAlerta('dado_ausente', 'atencao', 'vigencia_garantia_termo_inicial',
      'Termo inicial "emissão" descartado: sem trecho literal de suporte. Usando fallback conservador (sessão pública).'));
    parsed.alertas = alertas;
  } else {
    // sessao_publica ou entrega_proposta sem trecho: mantém + aviso leve
    console.warn(`[lock-termo] '${termo}' sem trecho — mantido com alerta info`);
    const alertas = getAlertas(parsed);
    alertas.push(makeAlerta('dado_ausente', 'info', 'vigencia_garantia_termo_inicial_trecho',
      `Termo inicial '${termo}' extraído sem trecho literal de suporte. Verifique o edital.`));
    parsed.alertas = alertas;
  }
}

/** Veto determinístico: alerta estruturado escala/plausibilidade -> zera valor */
function enforceScaleSanity(parsed: Record<string, unknown>): void {
  if (parsed.valor_global_edital == null) return;
  const alertas = getAlertas(parsed);
  const hasVeto = alertas.some(a => a.campo_afetado === 'valor_global_edital' && ['escala','plausibilidade'].includes(a.tipo));
  if (!hasVeto) return;
  console.warn(`[sanity] veto escala/plausibilidade -> null (era ${parsed.valor_global_edital})`);
  parsed.valor_global_edital = null; parsed.valor_global_edital_trecho = null;
  parsed.valor_global_edital_pagina = null; parsed.valor_garantia_proposta_calculado = null; parsed.formula_calculo = null;
  const pend: string[] = Array.isArray(parsed.pendencias_bloqueantes) ? parsed.pendencias_bloqueantes as string[] : [];
  parsed.pendencias_bloqueantes = ['Valor estimado: edital não informa explicitamente ou escala suspeita. Confirme no PNCP ou junto ao órgão antes de calcular o LMG.', ...pend.filter((p: string) => !/bilh|milh|R\$\s*\d/i.test(p))];
}

/** Banda de plausibilidade numérica: > R$100M em municipal -> pendência (não zera) */
function enforcePlausibilityBand(parsed: Record<string, unknown>): void {
  const valor = parsed.valor_global_edital as number | null;
  if (valor == null || valor <= PLAUSIBILITY_MUNICIPAL_THRESHOLD) return;
  const isMunicipal = /prefeitura|municipio|câmara municipal|camara municipal/i.test(String(parsed.orgao_nome ?? ''));
  if (!isMunicipal) return;
  const alertas = getAlertas(parsed);
  const jaTemVeto = alertas.some(a => a.campo_afetado === 'valor_global_edital' && ['escala','plausibilidade'].includes(a.tipo));
  if (jaTemVeto) return;
  console.warn(`[plausibility] ${valor} > ${PLAUSIBILITY_MUNICIPAL_THRESHOLD} em municipal`);
  alertas.unshift(makeAlerta('plausibilidade', 'atencao', 'valor_global_edital', `Valor R$ ${valor.toLocaleString('pt-BR')} acima de R$ 100 mi em órgão municipal. Confirme antes de emitir.`));
  parsed.alertas = alertas;
  const pend: string[] = Array.isArray(parsed.pendencias_bloqueantes) ? parsed.pendencias_bloqueantes as string[] : [];
  parsed.pendencias_bloqueantes = [`Valor global R$ ${valor.toLocaleString('pt-BR')} acima da banda de plausibilidade para município. Confirme no orçamento municipal ou PNCP.`, ...pend];
}

/** Alertas de prazo calculados em TypeScript (substitui os do modelo) */
function addDeadlineAlerts(parsed: Record<string, unknown>): void {
  const limite = parsed.data_limite_propostas as string | null;
  if (!limite) return;
  const match = limite.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return;
  const [, d, m, y, h = '23', min = '59'] = match;
  const deadlineMs = Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h) + 3, parseInt(min));
  const diffH = (deadlineMs - Date.now()) / 3_600_000;
  const alertas = getAlertas(parsed);
  if (diffH < 0) alertas.unshift(makeAlerta('prazo', 'bloqueante', null, `PRAZO ENCERRADO: limite de propostas foi ${limite}.`));
  else if (diffH < 2) alertas.unshift(makeAlerta('prazo', 'bloqueante', null, `URGENTE: limite de propostas em ${Math.round(diffH * 60)} minutos (${limite}).`));
  else if (diffH < 24) alertas.unshift(makeAlerta('prazo', 'atencao', null, `ATENÇÃO: limite de propostas HOJE (${limite}), ${Math.round(diffH)}h restantes.`));
  else if (diffH < 48) alertas.unshift(makeAlerta('prazo', 'info', null, `Limite de propostas: amanhã (${limite}).`));
  parsed.alertas = alertas;
}

const tryParse = (text: string) => {
  try { return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()); }
  catch { return null; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (PROVEDOR_IA === 'claude' && !ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
    if (PROVEDOR_IA === 'gemini' && !GEMINI_API_KEY)    throw new Error('GEMINI_API_KEY não configurada (PROVEDOR_IA=gemini)');
    const { filesData, pdfBase64Array, pdfBase64, fileName, additionalInstructions } = await req.json();
    let files: { data: string; mediaType: string; name: string }[] = [];
    if (filesData && filesData.length > 0) { files = filesData; }
    else {
      const pdfs: string[] = pdfBase64Array ?? (pdfBase64 ? [pdfBase64] : []);
      files = pdfs.map((d: string, i: number) => ({ data: d, mediaType: 'application/pdf', name: fileName ?? `arquivo_${i + 1}.pdf` }));
    }
    if (files.length === 0) throw new Error('Nenhum arquivo enviado');

    // Pré-filtro de páginas: roda antes de qualquer decisão de provedor
    // para que comparações futuras (Claude vs Gemini) usem exatamente o mesmo input.
    const filesProcessados = await Promise.all(files.map(async (f) => {
      if (f.mediaType !== 'application/pdf') return f;
      const r = await aplicarPrefiltro(f.data);
      if (r.motivo === 'desativado') return f; // sem log individual quando desativado
      return { ...f, data: r.pdfBase64 };
    }));

    const fileBlocks = filesProcessados.map((f) =>
      f.mediaType.startsWith('image/') ? { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
    );

    let rawResult: IaResult | null = null;
    let usedModel = '';
    let sonnetReason = '';
    let apiStatus = 0;   // HTTP status da última chamada que falhou
    let apiMsg = '';     // corpo de erro da API (truncado)

    // Tentativa 1: modelo rápido (mais barato) do provedor ativo
    try {
      rawResult = await callIA('rapido', fileBlocks, additionalInstructions);
      usedModel = rawResult.model;
    } catch (e: unknown) {
      apiStatus = (e as ApiError)?.status ?? 0;
      apiMsg    = (e as ApiError)?.apiMsg  ?? String(e);
      console.warn(`[${PROVEDOR_IA}] modelo rápido falhou: HTTP ${apiStatus} | ${apiMsg.slice(0, 200)}`);
      sonnetReason = 'rapido_error';
    }

    let parsed: Record<string, unknown> | null = rawResult ? tryParse(rawResult.text) : null;

    // Escalamento para Sonnet:
    // (a) haiku falhou / JSON inválido / max_tokens
    // (b) exige_garantia_proposta não é booleano estrito → parse degradado, sempre re-tenta
    // (c) exige_garantia_proposta === true E qualquer campo crítico está null
    let needsSonnet = !rawResult || !parsed || rawResult.stop_reason === 'max_tokens';
    if (!needsSonnet) {
      if (typeof parsed!.exige_garantia_proposta !== 'boolean') {
        needsSonnet = true;
        sonnetReason = 'exige_garantia_nao_booleano';
      } else if (parsed!.exige_garantia_proposta === true) {
        const camposNulos: string[] = [];
        if (parsed!.valor_global_edital == null)             camposNulos.push('valor_global_edital');
        if (parsed!.percentual_garantia_proposta == null)    camposNulos.push('percentual_garantia_proposta');
        if (parsed!.vigencia_garantia_proposta_dias == null) camposNulos.push('vigencia_garantia_proposta_dias');
        if (parsed!.orgao_cnpj == null)                      camposNulos.push('orgao_cnpj');
        if (camposNulos.length > 0) {
          needsSonnet = true;
          sonnetReason = `campos_null_com_garantia:[${camposNulos.join(',')}]`;
        }
      }
    }

    if (needsSonnet) {
      if (!sonnetReason) {
        if (!rawResult) sonnetReason = 'rapido_error';
        else if (!parsed) sonnetReason = 'parse_fail';
        else if (rawResult.stop_reason === 'max_tokens') sonnetReason = 'max_tokens';
      }
      console.warn(`[escalamento] ${MODELOS[PROVEDOR_IA].forte} | motivo: ${sonnetReason}`);
      try {
        const r = await callIA('forte', fileBlocks, additionalInstructions);
        usedModel = r.model; rawResult = r; parsed = tryParse(r.text);
      } catch (sonnetErr: unknown) {
        // Degradação graceful: mantém o resultado do modelo rápido se houver, nunca derruba
        apiStatus = (sonnetErr as ApiError)?.status ?? apiStatus;
        apiMsg    = (sonnetErr as ApiError)?.apiMsg  ?? String(sonnetErr);
        console.error(`[modelo-forte-falhou] HTTP ${apiStatus} | ${apiMsg.slice(0, 200)} — mantendo resultado do modelo rápido`);
        if (parsed) {
          const alertas = getAlertas(parsed);
          alertas.unshift(makeAlerta('outro', 'atencao', null,
            'Segunda análise (modelo reforçado) não pôde ser executada. Resultado baseado apenas na análise inicial — revisar campos críticos manualmente.'));
          parsed.alertas = alertas;
        }
        // rawResult e parsed permanecem os do modelo rápido; usedModel também
      }
    }

    if (!rawResult) {
      // Ramifica na causa real — nunca afirma o que não foi verificado
      let userMsg: string;
      if (apiStatus === 429) {
        userMsg = 'Limite de requisições da API atingido. Aguarde alguns minutos e tente novamente.';
      } else if (apiStatus === 400 && /too long|exceed/i.test(apiMsg)) {
        userMsg = 'O documento excede o limite de tamanho do modelo. Envie apenas o corpo do edital e os anexos relevantes.';
      } else if (apiStatus === 400) {
        userMsg = `A API recusou a requisição (400). Detalhe: ${apiMsg.slice(0, 200)}`;
      } else if (apiStatus >= 500 || apiStatus === 0) {
        userMsg = 'Serviço de análise temporariamente indisponível. Tente novamente em instantes.';
      } else {
        userMsg = `Não foi possível analisar o edital. ${apiMsg || sonnetReason}`;
      }
      const retryable = apiStatus === 429 || apiStatus >= 500;
      console.error(`[falha-total] motivo:${sonnetReason} | status:${apiStatus} | retryable:${retryable} | api:${apiMsg.slice(0, 200)}`);
      return new Response(JSON.stringify({ success: false, error: userMsg, apiStatus, retryable }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { stop_reason, output_tokens, input_tokens, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } = rawResult;
    console.log(`analyze-edital v17 | provedor:${PROVEDOR_IA} | modelo:${usedModel} | stop:${stop_reason} | ${input_tokens}in (cw:${cw} cr:${cr}) / ${output_tokens}out | parse:${!!parsed}`);
    if (stop_reason === 'max_tokens') console.error(`[TRUNCAMENTO] ${output_tokens} tokens`);

    let resultado: Record<string, unknown>;
    if (!parsed) {
      resultado = {
        parse_error: true,
        raw: rawResult!.text.slice(0, 2000),
        raw_tail: rawResult!.text.slice(-400),
        stop_reason,
        output_tokens,
        schema_validation_error: 'Resposta do modelo não é JSON válido',
      };
    } else {
      // Pipeline de travas e normalizações (ordem importa):
      // 0. Deriva exige_garantia_proposta deterministicamente (garante boolean estrito)
      deriveExigeGarantia(parsed);
      // 1. Remove alertas tipo prazo do modelo
      stripModelPrazoAlertas(parsed);
      // 2. Trava positiva do valor_global_edital
      enforcePositiveLock(parsed);
      // 3. Fix 1 — Trava positiva do termo inicial da vigência
      enforceTermoInicialLock(parsed);
      // 4. Veto determinístico (escala estruturada)
      enforceScaleSanity(parsed);
      // 5. Banda numérica municipal
      enforcePlausibilityBand(parsed);
      // 6. Fix 3 — Deduplicação: bloqueantes SAEM dos alertas e vão para pendencias
      deduplicateBlockers(parsed);
      // 7. Prazos calculados em TypeScript
      addDeadlineAlerts(parsed);
      // 8. Garante array recomendacoes
      if (!Array.isArray(parsed.recomendacoes)) parsed.recomendacoes = [];
      // 9. Fix 4 — Zera divergencia_validade_proposta se não há divergência real
      if (typeof parsed.divergencia_validade_proposta === 'string') {
        const dvp = parsed.divergencia_validade_proposta.trim();
        if (dvp === '' || /nenhuma diverg|sem diverg|não há diverg|nao ha diverg/i.test(dvp)) {
          parsed.divergencia_validade_proposta = null;
        }
      }
      // 10. Valida campos obrigatórios com Zod
      const v = RequiredFieldsSchema.safeParse(parsed);
      if (!v.success) {
        parsed.schema_validation_error = v.error.issues.map(i => i.message).join('; ');
        console.error('Schema failed:', parsed.schema_validation_error);
      }
      resultado = parsed;
    }
    // Metadados de observabilidade: quem produziu o resultado.
    // O script de regressão usa os dois para rotular as rodadas na comparação.
    resultado._modelo = usedModel;
    resultado._provedor = PROVEDOR_IA;
    return new Response(JSON.stringify({ success: true, data: resultado }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[analyze-edital]', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
