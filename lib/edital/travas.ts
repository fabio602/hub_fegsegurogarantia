/**
 * Travas de segurança aplicadas depois da extração.
 *
 * Portadas de supabase/functions/analyze-edital/index.ts (que continua publicada e
 * mantém a sua cópia). A lógica é a mesma; as diferenças são:
 *  - campos corrigidos à mão (`_editados`) não são derrubados pelas travas de evidência;
 *  - a âncora do termo inicial aceita também "abertura DAS propostas".
 */
import type { Alerta, EditalData } from '../editalSchema.ts';

const PLAUSIBILITY_MUNICIPAL_THRESHOLD = 100_000_000;

export const makeAlerta = (
  tipo: Alerta['tipo'], severidade: Alerta['severidade'], campo_afetado: string | null, texto: string,
): Alerta => ({ tipo, severidade, campo_afetado, texto: texto.slice(0, 300) });

function getAlertas(d: EditalData): Alerta[] {
  return (Array.isArray(d.alertas) ? d.alertas : []).map(a =>
    typeof a === 'string' ? makeAlerta('outro', 'atencao', null, a) : a);
}

/** Qualquer campo de garantia preenchido → a garantia é exigida. Nunca força false. */
export function deriveExigeGarantia(d: EditalData): void {
  const temEvidencia = d.percentual_garantia_proposta != null
    || d.vigencia_garantia_proposta_dias != null
    || (Array.isArray(d.modalidades_aceitas_garantia) && d.modalidades_aceitas_garantia.length > 0 && d.exige_garantia_proposta !== false)
    || d.vigencia_garantia_termo_inicial != null;
  if (temEvidencia && d.exige_garantia_proposta !== true) d.exige_garantia_proposta = true;
}

/** Valor global só é aceito com trecho + localização (ou se foi informado à mão). */
export function enforcePositiveLock(d: EditalData, editados: Set<string>): void {
  if (d.valor_global_edital == null || editados.has('valor_global_edital')) return;
  if (!d.valor_global_edital_trecho || !d.valor_global_edital_pagina) {
    d.valor_global_edital = null; d.valor_global_edital_trecho = null; d.valor_global_edital_pagina = null;
    d.valor_garantia_proposta_calculado = null; d.formula_calculo = null;
    d.alertas = [makeAlerta('dado_ausente', 'atencao', 'valor_global_edital', 'Valor estimado descartado: sem trecho literal ou localização no documento.'), ...getAlertas(d)];
  }
}

const MENCIONA_GARANTIA = /garantia|cau[çc][ãa]o|seguro[- ]garantia|fian[çc]a|ap[óo]lice/i;
const VALIDADE_DA_PROPOSTA = /valid(ade|ade\s+m[ií]nima)\s+d[ao]s?\s+propostas?/i;
const ANCORA_TERMO = /abertura\s+d[ao]s?\s+(sess[ãa]o|licita[çc][ãa]o|propostas?|certame)|entrega\s+d[ao]s?\s+propostas?|apresenta[çc][ãa]o\s+d[ao]s?\s+propostas?|emiss[ãa]o\s+d[ao]\s+(ap[óo]lice|garantia|seguro)|data\s+d[ao]\s+sess[ãa]o|sess[ãa]o\s+p[úu]blica/i;

/** O trecho do termo inicial precisa nomear o marco e não pode ser a validade da PROPOSTA. */
export function enforceTermoInicialLock(d: EditalData, editados: Set<string>): void {
  const termo = d.vigencia_garantia_termo_inicial;
  if (termo == null || editados.has('vigencia_garantia_termo_inicial')) return;
  const t = String(d.vigencia_garantia_termo_inicial_trecho ?? '');
  const descartar = (campo: string, texto: string) => {
    d.vigencia_garantia_termo_inicial = null;
    d.vigencia_garantia_termo_inicial_trecho = null;
    if (!editados.has('vigencia_garantia_proposta_dias')) d.vigencia_garantia_proposta_dias = null;
    d.alertas = [makeAlerta('dado_ausente', 'atencao', campo, texto), ...getAlertas(d)];
  };
  if (!t) {
    if (termo === 'emissao') descartar('vigencia_garantia_termo_inicial', 'Termo inicial "emissão" descartado: sem trecho literal de suporte.');
    return;
  }
  if (VALIDADE_DA_PROPOSTA.test(t) && !MENCIONA_GARANTIA.test(t)) {
    descartar('vigencia_garantia_proposta_dias', 'O edital não declara vigência para a garantia de proposta. O prazo encontrado refere-se à validade da PROPOSTA (art. 59 da Lei 14.133/2021). Defina a vigência pela política de subscrição.');
    return;
  }
  if (!ANCORA_TERMO.test(t)) {
    descartar('vigencia_garantia_termo_inicial', 'Vigência da garantia descartada: o trecho não identifica a partir de qual evento o prazo é contado. Confirme a cláusula no edital antes de emitir.');
  }
}

/** Alerta de escala/plausibilidade sobre o valor global zera o valor (a não ser que tenha sido digitado). */
export function enforceScaleSanity(d: EditalData, editados: Set<string>): void {
  if (d.valor_global_edital == null || editados.has('valor_global_edital')) return;
  const veto = getAlertas(d).some(a => a.campo_afetado === 'valor_global_edital' && a.tipo === 'escala');
  if (!veto) return;
  d.valor_global_edital = null; d.valor_global_edital_trecho = null; d.valor_global_edital_pagina = null;
  d.valor_garantia_proposta_calculado = null; d.formula_calculo = null;
  d.pendencias_bloqueantes = ['Valor estimado: escala suspeita. Confirme no PNCP ou junto ao órgão antes de calcular a garantia.', ...(d.pendencias_bloqueantes ?? [])];
}

/** Acima de R$ 100 mi em órgão municipal: pendência (não zera). */
export function enforcePlausibilityBand(d: EditalData): void {
  const valor = d.valor_global_edital;
  if (valor == null || valor <= PLAUSIBILITY_MUNICIPAL_THRESHOLD) return;
  if (!/prefeitura|munic[ií]pio|c[âa]mara municipal/i.test(String(d.orgao_nome ?? ''))) return;
  const valorFmt = valor.toLocaleString('pt-BR');
  d.alertas = [makeAlerta('plausibilidade', 'atencao', 'valor_global_edital', `Valor R$ ${valorFmt} acima de R$ 100 mi em órgão municipal. Confirme antes de emitir.`), ...getAlertas(d)];
  d.pendencias_bloqueantes = [`Valor global R$ ${valorFmt} acima da banda de plausibilidade para município. Confirme no orçamento municipal ou PNCP.`, ...(d.pendencias_bloqueantes ?? [])];
}

/** Alertas bloqueantes viram pendências (uma por campo) e saem da lista de alertas. */
export function deduplicateBlockers(d: EditalData): void {
  const pend: string[] = [];
  for (const p of d.pendencias_bloqueantes ?? []) {
    if (!pend.some(e => e.slice(0, 60) === p.slice(0, 60) || e.includes(p.slice(0, 40)) || p.includes(e.slice(0, 40)))) pend.push(p);
  }
  const vistos = new Set<string>();
  const resto: Alerta[] = [];
  for (const a of getAlertas(d)) {
    if (a.severidade !== 'bloqueante') { resto.push(a); continue; }
    const chave = a.campo_afetado ?? `_nc_${a.texto.slice(0, 30)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (!pend.some(p => p.includes(a.texto.slice(0, 50)) || a.texto.includes(p.slice(0, 50)))) pend.push(a.texto);
  }
  d.alertas = resto;
  d.pendencias_bloqueantes = pend;
}

/** Alertas de prazo pelo relógio (horário de Brasília = UTC-3). */
export function addDeadlineAlerts(d: EditalData, agora = Date.now()): void {
  const limite = d.data_limite_propostas ?? d.data_sessao_publica;
  if (!limite) return;
  const m = limite.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return;
  const [, dd, mm, yy, h = '23', min = '59'] = m;
  const prazo = Date.UTC(+yy, +mm - 1, +dd, +h + 3, +min);
  const diffH = (prazo - agora) / 3_600_000;
  const alertas = getAlertas(d);
  if (diffH < 0) alertas.unshift(makeAlerta('prazo', 'bloqueante', null, `PRAZO ENCERRADO: limite de propostas foi ${limite}.`));
  else if (diffH < 2) alertas.unshift(makeAlerta('prazo', 'bloqueante', null, `URGENTE: limite de propostas em ${Math.round(diffH * 60)} minutos (${limite}).`));
  else if (diffH < 24) alertas.unshift(makeAlerta('prazo', 'atencao', null, `ATENÇÃO: limite de propostas HOJE (${limite}), ${Math.round(diffH)}h restantes.`));
  else if (diffH < 48) alertas.unshift(makeAlerta('prazo', 'info', null, `Limite de propostas: amanhã (${limite}).`));
  d.alertas = alertas;
}
