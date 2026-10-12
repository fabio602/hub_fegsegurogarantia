/**
 * Double Check por regras: confere a minuta/apólice contra os dados do edital.
 * Substitui a Edge Function validate-minuta (IA) na aba Seguro Licitante.
 * Devolve o mesmo formato que a tela já usava (ValidationResult).
 *
 * Itens conferidos:
 *  1. Modalidade (licitante)
 *  2. Segurado: CNPJ igual ao do edital
 *  3. CNPJs da minuta: dígitos verificadores (erro de digitação da seguradora)
 *  4. Valor da garantia: exato sobre o valor global ou sobre os lotes escolhidos;
 *     sem lotes escolhidos, diz a qual combinação de lotes a minuta corresponde
 *  5. Início da cobertura: valendo até o limite de entrega das propostas,
 *     respeitando a convenção da seguradora ("00:00h" x "às 24h")
 *  6. Prazo da vigência: dias exigidos a partir do termo inicial (art. 183)
 *  7. Edital citado no objeto
 *  8. Tomador presente
 */
import type { EditalData } from '../editalSchema.ts';
import { arredondar2, cnpjValido } from '../edital/numeros.ts';
import type { MinutaExtraida } from './extrairMinuta.ts';

export interface ValidationItem {
  campo: string;
  esperado: string;
  encontrado: string;
  /** 'conferir' = não dá para afirmar certo ou errado só pelos documentos */
  status: 'ok' | 'divergencia' | 'nao_encontrado' | 'atencao_favoravel' | 'nao_aplicavel' | 'conferir';
  observacao?: string | null;
}

export interface MinutaDados {
  seguradora?: string | null;
  tomador?: string | null;
  segurado?: string | null;
  valor_garantia?: string | null;
  vigencia?: string | null;
  custo_seguro?: string | null;
  numero_apolice_minuta?: string | null;
}

export interface ValidationResult {
  status_geral: 'aprovado' | 'divergencias' | 'verificar';
  veredicto?: 'PODE EMITIR' | 'EMITIR COM RESSALVA' | 'NAO EMITIR';
  veredicto_acao?: string | null;
  itens: ValidationItem[];
  resumo: string;
  pendencias_bloqueantes?: string[];
  minuta_dados?: MinutaDados;
  raw?: string;
  parse_error?: boolean;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const NAO = 'Não localizado na minuta';
const DIA_MS = 86_400_000;
const MIN_MS = 60_000;

/** "DD/MM/YYYY[ HH:MM]" → ms (UTC, hora de parede). Data impossível (31/02) → NaN. */
function instante(s: string | null | undefined, horaPadrao = { h: 0, m: 0 }): number | null {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [d, mes, a] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(a, mes - 1, d, m[4] != null ? +m[4] : horaPadrao.h, m[5] != null ? +m[5] : horaPadrao.m);
  const dt = new Date(t);
  return dt.getUTCDate() === d && dt.getUTCMonth() === mes - 1 ? t : NaN;
}
const fmtDia = (t: number) => new Date(t).toISOString().slice(0, 10).split('-').reverse().join('/');
const fmtDiaHora = (t: number) => `${fmtDia(t)} ${new Date(t).toISOString().slice(11, 16)}`;

/** "013/2026" e "13/2026" são o mesmo número. */
const normNumero = (s: string) => s.replace(/\s/g, '').replace(/^0+(?=\d)/, '');

type Lote = NonNullable<EditalData['lotes']>[number];

/** Combinações de lotes cuja garantia (pct sobre a soma) dá exatamente `alvo`. */
function combinacoesQueBatem(lotes: Lote[], pct: number, alvo: number): Lote[][] {
  if (lotes.length > 12) return [];
  const out: Lote[][] = [];
  for (let mask = 1; mask < 1 << lotes.length; mask++) {
    const escolha = lotes.filter((_, i) => mask & (1 << i));
    const g = arredondar2(escolha.reduce((s, l) => s + l.valor, 0) * pct / 100);
    if (Math.abs(g - alvo) <= 0.01) out.push(escolha);
  }
  return out;
}
const nomeLotes = (ls: Lote[]) => `${ls.length === 1 ? 'lote' : 'lotes'} ${ls.map(l => l.numero).join(', ')}`;

export function conferirMinuta(m: MinutaExtraida, e: EditalData): ValidationResult {
  const itens: ValidationItem[] = [];

  // 1. Modalidade
  itens.push({
    campo: 'Modalidade',
    esperado: 'Garantia de proposta (Licitante)',
    encontrado: m.modalidade_texto ?? NAO,
    status: m.modalidade === 'licitante' ? 'ok' : m.modalidade === 'contrato' ? 'divergencia' : 'nao_encontrado',
    observacao: m.modalidade === 'contrato' ? 'A minuta é de garantia de execução/contrato, não de proposta.' : null,
  });

  // 2. Segurado (órgão) — o CNPJ decide
  const cnpjEdital = e.orgao_cnpj ?? null;
  let segStatus: ValidationItem['status'];
  let segObs: string | null = null;
  if (!cnpjEdital) {
    segStatus = 'conferir';
    segObs = 'O CNPJ do órgão não foi informado na análise do edital; confira o segurado manualmente.';
  } else if (m.segurado_cnpj === cnpjEdital) {
    segStatus = 'ok';
  } else if (m.cnpjs.includes(cnpjEdital)) {
    segStatus = 'ok';
    segObs = 'O CNPJ do edital consta na minuta.';
  } else if (m.segurado_cnpj) {
    segStatus = 'divergencia';
    segObs = `O segurado da minuta tem outro CNPJ (${m.segurado_cnpj}). Confira se o beneficiário é o órgão ou uma secretaria.`;
  } else {
    segStatus = 'nao_encontrado';
  }
  itens.push({
    campo: 'Segurado',
    esperado: [e.orgao_nome, cnpjEdital].filter(Boolean).join(' — ') || 'Órgão licitante',
    encontrado: [m.segurado, m.segurado_cnpj].filter(Boolean).join(' — ') || NAO,
    status: segStatus,
    observacao: segObs,
  });

  // 3. CNPJs da minuta: dígito verificador
  const cnpjsMinuta = [
    m.segurado_cnpj ? { papel: 'segurado', cnpj: m.segurado_cnpj } : null,
    m.tomador_cnpj ? { papel: 'tomador', cnpj: m.tomador_cnpj } : null,
  ].filter(Boolean) as { papel: string; cnpj: string }[];
  const invalidos = cnpjsMinuta.filter(c => !cnpjValido(c.cnpj));
  itens.push({
    campo: 'CNPJs da minuta',
    esperado: 'Dígitos verificadores válidos',
    encontrado: cnpjsMinuta.length ? cnpjsMinuta.map(c => `${c.papel}: ${c.cnpj}`).join(' · ') : NAO,
    status: !cnpjsMinuta.length ? 'nao_encontrado' : invalidos.length ? 'divergencia' : 'ok',
    observacao: invalidos.length
      ? `Dígito verificador inválido no CNPJ do ${invalidos.map(c => c.papel).join(' e do ')}: erro de digitação da seguradora. Peça a correção.`
      : null,
  });

  // 4. Valor da garantia
  const pct = e.percentual_garantia_proposta ?? null;
  const esperadoValor = e.valor_garantia_proposta_calculado ?? null;
  const lotes = e.base_calculo_garantia === 'por_lote' && e.lotes?.length ? e.lotes : null;
  const escolhidos = lotes && e.lotes_selecionados?.length ? lotes.filter(l => e.lotes_selecionados!.includes(l.numero)) : null;
  const IS = m.valor_garantia;
  let valStatus: ValidationItem['status'];
  let valObs: string | null = null;
  const igual = (a: number, b: number) => Math.abs(a - b) <= 0.01;

  if (IS == null) {
    valStatus = 'nao_encontrado';
  } else if (esperadoValor == null) {
    valStatus = 'conferir';
    valObs = 'O valor da garantia não foi calculado na análise do edital.';
  } else if (lotes && pct != null) {
    const combos = combinacoesQueBatem(lotes, pct, IS);
    const descricaoCombo = combos.length
      ? combos.map(c => `${nomeLotes(c)} (${brl(c.reduce((s, l) => s + l.valor, 0))})`).join(' ou ')
      : null;
    if (igual(IS, esperadoValor)) {
      valStatus = 'ok';
      if (!escolhidos) valObs = 'Corresponde a todos os lotes.';
    } else if (escolhidos) {
      if (IS > esperadoValor) {
        valStatus = 'atencao_favoravel';
        valObs = `Acima do exigido para ${nomeLotes(escolhidos)} em ${brl(IS - esperadoValor)}${descricaoCombo ? `; a minuta corresponde a ${descricaoCombo}` : ''}.`;
      } else {
        valStatus = 'divergencia';
        valObs = `Faltam ${brl(esperadoValor - IS)} para ${nomeLotes(escolhidos)}.${descricaoCombo ? ` A minuta corresponde a ${descricaoCombo}.` : ''}`;
      }
    } else if (combos.length) {
      valStatus = 'conferir';
      valObs = `A minuta corresponde a ${descricaoCombo}. Se o cliente disputa só isso, marque os lotes na análise do edital e o item fica OK.`;
    } else if (IS > esperadoValor) {
      valStatus = 'atencao_favoravel';
      valObs = `Acima do teto (todos os lotes) em ${brl(IS - esperadoValor)}.`;
    } else {
      valStatus = 'divergencia';
      valObs = 'Não corresponde a nenhuma combinação de lotes do edital. Confira o valor com a seguradora.';
    }
  } else if (igual(IS, esperadoValor)) {
    valStatus = 'ok';
  } else if (IS > esperadoValor) {
    valStatus = 'atencao_favoravel';
    valObs = `Acima do exigido em ${brl(IS - esperadoValor)}: cobre o edital, mas o prêmio pode estar maior que o necessário.`;
  } else if (e.base_calculo_garantia === 'por_item' || e.base_calculo_garantia === 'por_lote') {
    valStatus = 'conferir';
    valObs = `Abaixo do teto (todos os ${e.base_calculo_garantia === 'por_lote' ? 'lotes' : 'itens'}). Está certo se o cliente disputa só parte deles: confirme quais.`;
  } else {
    valStatus = 'divergencia';
    valObs = `Faltam ${brl(esperadoValor - IS)} para o valor exigido no edital.`;
  }
  itens.push({
    campo: 'Valor da garantia',
    esperado: esperadoValor != null ? `${brl(esperadoValor)}${e.formula_calculo ? ` (${e.formula_calculo})` : ''}` : 'Não calculado',
    encontrado: IS != null ? brl(IS) : NAO,
    status: valStatus,
    observacao: valObs,
  });

  // 5 e 6. Vigência
  const ini = instante(m.vigencia_inicio), fim = instante(m.vigencia_fim);
  const datasInvalidas = [ini, fim].some(t => t != null && Number.isNaN(t));
  const sessao = instante(e.data_sessao_publica, { h: 23, m: 59 });
  const limiteTxt = e.data_limite_propostas ?? e.data_sessao_publica ?? null;
  const limite = instante(limiteTxt, { h: 23, m: 59 });

  // 5. Início da cobertura x limite de entrega das propostas
  if (ini == null || datasInvalidas) {
    itens.push({
      campo: 'Início da cobertura',
      esperado: limite ? `Valendo até ${fmtDiaHora(limite)} (limite das propostas)` : 'Valendo antes do limite das propostas',
      encontrado: datasInvalidas ? `${m.vigencia_inicio ?? '?'} a ${m.vigencia_fim ?? '?'}` : NAO,
      status: datasInvalidas ? 'divergencia' : 'nao_encontrado',
      observacao: datasInvalidas ? 'A minuta traz uma data que não existe no calendário: erro de digitação da seguradora.' : null,
    });
  } else {
    // "às 24h" (ou 23:59h) da data inicial: a cobertura começa na virada para o dia seguinte
    const conv24 = m.vigencia_inicio_24h !== false;
    const efetivo = ini + (conv24 ? DIA_MS : 0);
    const descIni = conv24
      ? `${m.vigencia_inicio} às 24h → vale a partir de ${fmtDiaHora(efetivo)}${m.vigencia_inicio_24h == null ? ' (horário não informado; considerado às 24h)' : ''}`
      : `${m.vigencia_inicio} 00:00`;
    let st: ValidationItem['status'] = 'ok';
    let obs: string | null = null;
    if (limite == null) {
      st = 'conferir';
      obs = 'A análise do edital não tem a data limite das propostas nem a da sessão.';
    } else if (efetivo > limite) {
      st = 'divergencia';
      const ultimoDia = limite - (conv24 ? DIA_MS : 0);
      obs = `A cobertura só começa depois do limite de entrega das propostas: a garantia não estaria constituída a tempo (inabilitação). Peça início em ${fmtDia(ultimoDia)} ou antes.`;
    } else if (limite - efetivo < 6 * 60 * MIN_MS) {
      st = 'conferir';
      obs = `Começa a valer só ${Math.round((limite - efetivo) / (60 * MIN_MS))}h antes do limite. Está dentro, mas sem folga.`;
    }
    itens.push({
      campo: 'Início da cobertura',
      esperado: limite ? `Valendo até ${fmtDiaHora(limite)} (${e.data_limite_propostas ? 'limite das propostas' : 'sessão pública'})` : 'Valendo antes do limite das propostas',
      encontrado: descIni,
      status: st,
      observacao: obs,
    });
  }

  // 6. Prazo da vigência
  const dias = e.vigencia_garantia_proposta_dias ?? null;
  let vigStatus: ValidationItem['status'] = 'ok';
  let vigObs: string | null = null;
  let vigEsperado = 'Cobrir a sessão pública';
  if (ini == null || fim == null || datasInvalidas) {
    vigStatus = datasInvalidas ? 'divergencia' : 'nao_encontrado';
  } else if (fim <= ini) {
    vigStatus = 'divergencia';
    vigObs = 'O fim da vigência é anterior ou igual ao início.';
  } else if (dias != null) {
    const termo = e.vigencia_garantia_termo_inicial;
    const baseDia = termo === 'emissao' ? ini
      : termo === 'entrega_proposta' ? instante((e.data_limite_propostas ?? e.data_sessao_publica)?.slice(0, 10))
      : instante(e.data_sessao_publica?.slice(0, 10));
    if (baseDia != null && !Number.isNaN(baseDia)) {
      // Art. 183: exclui o dia do começo e inclui o do vencimento
      const fimMin = baseDia + dias * DIA_MS;
      vigEsperado = `${dias} dias contados de ${fmtDia(baseDia)} → até ${fmtDia(fimMin)} ou depois`;
      if (fim < fimMin) {
        vigStatus = 'divergencia';
        vigObs = `Termina ${Math.round((fimMin - fim) / DIA_MS)} dia(s) antes do exigido (${fmtDia(fimMin)}).`;
      } else if (fim - fimMin > 0) {
        vigObs = `Folga de ${Math.round((fim - fimMin) / DIA_MS)} dia(s) além do mínimo.`;
      }
    } else {
      vigEsperado = `${dias} dias`;
      if ((fim - ini) / DIA_MS < dias) { vigStatus = 'divergencia'; vigObs = `A vigência tem menos de ${dias} dias.`; }
    }
  } else {
    const validade = e.validade_proposta_dias ?? null;
    if (validade != null && sessao != null) {
      const fimMin = instante(e.data_sessao_publica!.slice(0, 10))! + validade * DIA_MS;
      vigEsperado = `Edital não fixa vigência; referência: validade da proposta (${validade} dias) → ${fmtDia(fimMin)}`;
      if (fim < fimMin) {
        vigStatus = 'conferir';
        vigObs = `Termina antes do fim da validade da proposta (${fmtDia(fimMin)}). O edital não exige, mas confira a política de subscrição.`;
      }
    } else {
      vigObs = 'O edital não fixa vigência para a garantia; conferido só o início.';
    }
  }
  itens.push({
    campo: 'Prazo da vigência',
    esperado: vigEsperado,
    encontrado: ini != null && fim != null ? `${m.vigencia_inicio} a ${m.vigencia_fim}` : NAO,
    status: vigStatus,
    observacao: vigObs,
  });

  // 7. Edital citado no objeto da apólice
  if (e.numero_edital) {
    const alvo = normNumero(e.numero_edital);
    const bate = m.edital_refs.some(r => normNumero(r) === alvo);
    itens.push({
      campo: 'Edital no objeto',
      esperado: e.numero_edital,
      encontrado: m.edital_refs.length ? m.edital_refs.join(', ') : NAO,
      status: bate ? 'ok' : m.edital_refs.length ? 'divergencia' : 'nao_encontrado',
      observacao: !bate && m.edital_refs.length ? 'O número do edital citado na apólice não bate com o edital analisado.' : null,
    });
  }

  // 8. Tomador (o cliente)
  itens.push({
    campo: 'Tomador',
    esperado: 'Cliente licitante',
    encontrado: [m.tomador, m.tomador_cnpj].filter(Boolean).join(' — ') || NAO,
    status: m.tomador || m.tomador_cnpj ? 'ok' : 'nao_encontrado',
    observacao: null,
  });

  // Veredicto
  const div = itens.filter(i => i.status === 'divergencia');
  const duvidas = itens.filter(i => i.status === 'nao_encontrado' || i.status === 'conferir');
  const okCount = itens.filter(i => i.status === 'ok' || i.status === 'atencao_favoravel').length;
  const status_geral: ValidationResult['status_geral'] = div.length ? 'divergencias' : duvidas.length ? 'verificar' : 'aprovado';
  const veredicto: ValidationResult['veredicto'] = div.length ? 'NAO EMITIR' : duvidas.length ? 'EMITIR COM RESSALVA' : 'PODE EMITIR';
  const veredicto_acao = div.length
    ? `Peça à seguradora a correção de: ${div.map(i => i.campo.toLowerCase()).join(', ')}.`
    : duvidas.length
      ? `Confira manualmente: ${duvidas.map(i => i.campo.toLowerCase()).join(', ')}.`
      : 'Minuta confere com o edital.';
  const resumo = `${okCount} de ${itens.length} itens conferem.`
    + (div.length ? ` Divergência em ${div.map(i => i.campo).join(', ')}.` : '')
    + (duvidas.length ? ` A conferir: ${duvidas.map(i => i.campo).join(', ')}.` : '');

  return {
    status_geral,
    veredicto,
    veredicto_acao,
    itens,
    resumo,
    pendencias_bloqueantes: div.map(i => `${i.campo}: ${i.observacao ?? `esperado ${i.esperado}, minuta traz ${i.encontrado}`}`),
    minuta_dados: {
      seguradora: m.seguradora,
      tomador: m.tomador,
      segurado: m.segurado,
      valor_garantia: IS != null ? brl(IS) : null,
      vigencia: m.vigencia_inicio && m.vigencia_fim ? `${m.vigencia_inicio} a ${m.vigencia_fim}` : null,
      custo_seguro: m.premio != null ? brl(m.premio) : null,
      numero_apolice_minuta: m.numero,
    },
  };
}
