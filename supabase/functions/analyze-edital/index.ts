import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { z } from "npm:zod@3";

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MAX_TOKENS = 4000;
const PLAUSIBILITY_MUNICIPAL_THRESHOLD = 100_000_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RequiredFieldsSchema = z.object({
  objeto: z.string(),
  exige_garantia_proposta: z.boolean({
    required_error: 'exige_garantia_proposta ausente',
    invalid_type_error: 'exige_garantia_proposta deve ser boolean',
  }),
});

const SYSTEM_PROMPT = `Você atua como analista técnico de subscrição de Seguro Garantia da F&G Seguro Garantia (SUSEP 242160653), especializado na Lei 14.133/2021.

═══ DEFINIÇÃO DE EDITAL (LEIA PRIMEIRO) ═══
O EDITAL é o conjunto: corpo principal + TODOS os anexos (Termo de Referência, Especificações Técnicas, Planilha Orçamentária, Minuta de Contrato, Modelos). Cada anexo é parte integrante e vinculante do edital para todos os fins legais. NUNCA descarte, marque como ausente, nem rebaixe a confiança de um dado por ele estar em anexo em vez do corpo. Se o dado está em qualquer parte do conjunto, ele está "declarado no edital".
O campo *_pagina é METADADO DE AUDITORIA (ex: "Anexo I - TR, item 4.15") — nunca é critério de aceitação ou rejeição do dado.
As cláusulas de garantia de proposta (percentual, vigência, beneficiário, CNPJ do órgão) TIPICAMENTE aparecem no Termo de Referência ou nos anexos — procure ali por padrão antes de concluir que o dado está ausente.

REGRA DO orgao_cnpj: o campo orgao_cnpj é o CNPJ da entidade que o edital designa como FAVORECIDA/BENEFICIÁRIA da garantia de proposta — identificada na própria cláusula de garantia pela fórmula "prestada em favor de" ou "em favor do órgão contratante". Se a cláusula nomeia uma secretaria, autarquia ou fundo específico (ex: SEMED, SEFAZ, SAAE), é o CNPJ desse ente — NÃO o do município ou estado. A cláusula de garantia é fonte SUFICIENTE E PREFERENCIAL para orgao_cnpj, independentemente de onde no documento ela apareça. Se o CNPJ estiver presente com trecho literal: preencha o campo, NÃO emita alerta de dado_ausente e NÃO inclua recomendação pedindo para validar ou confirmar qual CNPJ usar.

═══ PRINCIPIO ZERO ═══
Sua única fonte legítima de valor_global_edital é o número que o órgão licitante declarou explicitamente como valor estimado total da contratação — em qualquer parte do conjunto edital (corpo ou anexo).
Se esse número não estiver em nenhuma parte do edital: valor_global_edital = null, valor_global_edital_trecho = null, valor_global_edital_pagina = null.
Se o valor estiver presente, OBRIGATÓRIO preencher valor_global_edital_trecho (trecho literal, max 150 chars) e valor_global_edital_pagina (localização, ex: "Anexo V - Planilha Orçamentária, p. 50").
Procure por "Total Geral", "Valor total estimado", "Valor global estimado" em TODAS as páginas, incluindo os últimos anexos.

ONDE PROCURAR O CNPJ DO ÓRGÃO: aparece na cláusula de garantia de proposta ("prestada em favor de ... inscrita no CNPJ sob nº ...") — pode ser o CNPJ da secretaria/autarquia contratante, não o da prefeitura central.

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

async function callClaude(
  model: string, fileBlocks: unknown[], additionalInstructions?: string
): Promise<{ text: string; model: string; stop_reason: string; input_tokens: number; output_tokens: number }> {
  const extra = additionalInstructions ? `\n\nINSTRUCOES ADICIONAIS:\n${additionalInstructions}` : '';
  const textBlock = { type: 'text', text: `Extraia os dados conforme as instruções.${extra}\n\nRetorne SOMENTE o JSON.` };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31' },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: [...fileBlocks, textBlock] }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${model} error: ${res.status}`);
  const data = await res.json();
  return { text: data.content?.[0]?.text ?? '', model, stop_reason: data.stop_reason ?? 'unknown', input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 };
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
    // Trecho presente: dado aceito independente de origem (corpo ou anexo)
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
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
    const { filesData, pdfBase64Array, pdfBase64, fileName, additionalInstructions } = await req.json();
    let files: { data: string; mediaType: string; name: string }[] = [];
    if (filesData && filesData.length > 0) { files = filesData; }
    else {
      const pdfs: string[] = pdfBase64Array ?? (pdfBase64 ? [pdfBase64] : []);
      files = pdfs.map((d: string, i: number) => ({ data: d, mediaType: 'application/pdf', name: fileName ?? `arquivo_${i + 1}.pdf` }));
    }
    if (files.length === 0) throw new Error('Nenhum arquivo enviado');
    const fileBlocks = files.map((f) =>
      f.mediaType.startsWith('image/') ? { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
    );

    let rawResult: Awaited<ReturnType<typeof callClaude>> | null = null;
    let usedModel = '';
    let sonnetReason = '';

    // Tentativa 1: Haiku (mais rápido e barato)
    try {
      rawResult = await callClaude('claude-haiku-4-5-20251001', fileBlocks, additionalInstructions);
      usedModel = 'haiku';
    } catch (e) {
      console.warn('Haiku falhou:', String(e));
      sonnetReason = 'haiku_error';
    }

    let parsed: Record<string, unknown> | null = rawResult ? tryParse(rawResult.text) : null;

    // Escalamento para Sonnet:
    // (a) haiku falhou / JSON inválido / max_tokens
    // (b) exige garantia de proposta E qualquer campo crítico está null
    //     (cobre o caso em que valor_global veio preenchido mas percentual/vigência/CNPJ vieram null)
    let needsSonnet = !rawResult || !parsed || rawResult.stop_reason === 'max_tokens';
    if (!needsSonnet && parsed?.exige_garantia_proposta === true) {
      const camposNulos: string[] = [];
      if (parsed.valor_global_edital == null)             camposNulos.push('valor_global_edital');
      if (parsed.percentual_garantia_proposta == null)    camposNulos.push('percentual_garantia_proposta');
      if (parsed.vigencia_garantia_proposta_dias == null) camposNulos.push('vigencia_garantia_proposta_dias');
      if (camposNulos.length > 0) {
        needsSonnet = true;
        sonnetReason = `campos_null_com_garantia:[${camposNulos.join(',')}]`;
      }
    }

    if (needsSonnet) {
      if (!sonnetReason) {
        if (!rawResult) sonnetReason = 'haiku_error';
        else if (!parsed) sonnetReason = 'parse_fail';
        else if (rawResult.stop_reason === 'max_tokens') sonnetReason = 'max_tokens';
      }
      console.warn(`[escalamento] Sonnet | motivo: ${sonnetReason}`);
      const r = await callClaude('claude-sonnet-4-6', fileBlocks, additionalInstructions);
      usedModel = 'sonnet'; rawResult = r; parsed = tryParse(r.text);
    }

    const { stop_reason, output_tokens, input_tokens } = rawResult!;
    console.log(`analyze-edital v13 | modelo:${usedModel} | stop:${stop_reason} | ${input_tokens}in/${output_tokens}out | parse:${!!parsed}`);
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
