/**
 * Double Check por regras: confere a minuta/apólice contra os dados do edital.
 * Substitui a Edge Function validate-minuta (IA) na aba Seguro Licitante.
 * Devolve o mesmo formato que a tela já usava (ValidationResult).
 */
import type { EditalData } from '../editalSchema.ts';
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

/** "DD/MM/YYYY..." → dia em ms (UTC) */
function dia(s: string | null | undefined): number | null {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
}
const fmtDia = (t: number) => new Date(t).toISOString().slice(0, 10).split('-').reverse().join('/');
const DIA_MS = 86_400_000;

/** "013/2026" e "13/2026" são o mesmo número. */
const normNumero = (s: string) => s.replace(/\s/g, '').replace(/^0+(?=\d)/, '');

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
  const segEncontrado = [m.segurado, m.segurado_cnpj].filter(Boolean).join(' — ') || NAO;
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
    encontrado: segEncontrado,
    status: segStatus,
    observacao: segObs,
  });

  // 3. Valor da garantia
  const esperadoValor = e.valor_garantia_proposta_calculado ?? null;
  const porParte = e.base_calculo_garantia === 'por_lote' || e.base_calculo_garantia === 'por_item';
  let valStatus: ValidationItem['status'];
  let valObs: string | null = null;
  if (m.valor_garantia == null) {
    valStatus = 'nao_encontrado';
  } else if (esperadoValor == null) {
    valStatus = 'conferir';
    valObs = 'O valor da garantia não foi calculado na análise do edital.';
  } else if (Math.abs(m.valor_garantia - esperadoValor) <= 0.01) {
    valStatus = 'ok';
  } else if (m.valor_garantia > esperadoValor) {
    valStatus = 'atencao_favoravel';
    valObs = `Acima do exigido em ${brl(m.valor_garantia - esperadoValor)}: cobre o edital, mas o prêmio pode estar maior que o necessário.`;
  } else if (porParte) {
    valStatus = 'conferir';
    valObs = `Abaixo do teto (todos os ${e.base_calculo_garantia === 'por_lote' ? 'lotes' : 'itens'}). Está certo se o cliente disputa só parte deles: confirme quais.`;
  } else {
    valStatus = 'divergencia';
    valObs = `Faltam ${brl(esperadoValor - m.valor_garantia)} para o valor exigido no edital.`;
  }
  itens.push({
    campo: 'Valor da garantia',
    esperado: esperadoValor != null ? `${brl(esperadoValor)}${e.formula_calculo ? ` (${e.formula_calculo})` : ''}` : 'Não calculado',
    encontrado: m.valor_garantia != null ? brl(m.valor_garantia) : NAO,
    status: valStatus,
    observacao: valObs,
  });

  // 4. Vigência
  const ini = dia(m.vigencia_inicio), fim = dia(m.vigencia_fim);
  const sessao = dia(e.data_sessao_publica);
  const dias = e.vigencia_garantia_proposta_dias ?? null;
  let vigStatus: ValidationItem['status'] = 'ok';
  let vigObs: string | null = null;
  let vigEsperado = 'Vigência que cubra a sessão pública';
  if (ini == null || fim == null) {
    vigStatus = 'nao_encontrado';
  } else {
    if (sessao != null && ini > sessao) {
      vigStatus = 'divergencia';
      vigObs = `A vigência começa (${fmtDia(ini)}) depois da sessão pública (${fmtDia(sessao)}).`;
    }
    if (dias != null) {
      const termo = e.vigencia_garantia_termo_inicial;
      const base = termo === 'emissao' ? ini
        : termo === 'entrega_proposta' ? (dia(e.data_limite_propostas) ?? sessao)
        : sessao;
      if (base != null) {
        const fimMin = base + dias * DIA_MS;
        vigEsperado = `${dias} dias a partir de ${fmtDia(base)} → até ${fmtDia(fimMin)} ou depois`;
        if (fim < fimMin && vigStatus !== 'divergencia') {
          vigStatus = 'divergencia';
          vigObs = `Termina ${Math.round((fimMin - fim) / DIA_MS)} dia(s) antes do exigido (${fmtDia(fimMin)}).`;
        }
      } else {
        vigEsperado = `${dias} dias`;
        if ((fim - ini) / DIA_MS < dias) { vigStatus = 'divergencia'; vigObs = `A vigência tem menos de ${dias} dias.`; }
      }
    } else if (vigStatus === 'ok') {
      const validade = e.validade_proposta_dias ?? null;
      if (validade != null && sessao != null) {
        const fimMin = sessao + validade * DIA_MS;
        vigEsperado = `Edital não fixa vigência; referência: validade da proposta (${validade} dias) → ${fmtDia(fimMin)}`;
        if (fim < fimMin) {
          vigStatus = 'conferir';
          vigObs = `Termina antes do fim da validade da proposta (${fmtDia(fimMin)}). O edital não exige, mas confira a política de subscrição.`;
        }
      } else {
        vigObs = 'O edital não fixa vigência para a garantia; conferido só o início.';
      }
    }
  }
  itens.push({
    campo: 'Vigência',
    esperado: vigEsperado,
    encontrado: ini != null && fim != null ? `${m.vigencia_inicio} a ${m.vigencia_fim}` : NAO,
    status: vigStatus,
    observacao: vigObs,
  });

  // 5. Edital citado no objeto da apólice
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

  // 6. Tomador (o cliente)
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
      valor_garantia: m.valor_garantia != null ? brl(m.valor_garantia) : null,
      vigencia: m.vigencia_inicio && m.vigencia_fim ? `${m.vigencia_inicio} a ${m.vigencia_fim}` : null,
      custo_seguro: m.premio != null ? brl(m.premio) : null,
      numero_apolice_minuta: m.numero,
    },
  };
}
