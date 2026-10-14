/**
 * Leitura de edital por regras — sem IA, sem rede.
 *
 *   extrairEdital(paginas)  → EditalData completo (mesmo formato da antiga Edge Function)
 *   finalizarEdital(dados)  → recalcula garantia, alertas e pendências a partir dos valores
 *                             atuais; é chamado de novo a cada correção feita na tela.
 *
 * As regras ficam em ./regras/*. As travas de segurança em ./travas.ts.
 */
import type { Alerta, EditalData, Evidencia } from '../editalSchema.ts';
import { montarDocumento } from './documento.ts';
import { arredondar2, cnpjValido } from './numeros.ts';
import { extrairGarantia } from './regras/garantia.ts';
import { extrairValorGlobal } from './regras/valor.ts';
import { extrairIdentificacao } from './regras/identificacao.ts';
import { extrairDatas } from './regras/datas.ts';
import { extrairExecucao } from './regras/execucao.ts';
import { extrairValorDaTabela } from './regras/tabela.ts';
import { extrairLotes } from './regras/lotes.ts';
import {
  addDeadlineAlerts, deduplicateBlockers, deriveExigeGarantia, enforcePlausibilityBand,
  enforcePositiveLock, enforceScaleSanity, enforceTermoInicialLock, makeAlerta,
} from './travas.ts';

export { montarDocumento } from './documento.ts';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function extrairEdital(paginas: string[], origem: 'texto' | 'ocr' = 'texto'): EditalData {
  const doc = montarDocumento(paginas);
  const ident = extrairIdentificacao(doc);
  const datas = extrairDatas(doc);
  const gar = extrairGarantia(doc);
  const valorRotulo = extrairValorGlobal(doc);
  // Sem total escrito: tenta a soma da tabela de itens (variação "total em branco")
  const tabela = valorRotulo ? null : extrairValorDaTabela(doc);
  const valor = valorRotulo ?? (tabela?.valor != null
    ? { valor: tabela.valor, evidencia: tabela.evidencia, alternativos: [] as { valor: number; pagina: number }[] }
    : null);
  const exec = extrairExecucao(doc);
  const lotes = gar.baseCalculo === 'por_lote' ? extrairLotes(doc) : [];

  const evidencias: Record<string, Evidencia> = { ...ident.evidencias, ...datas.evidencias };
  if (gar.exigeEvidencia) evidencias.exige_garantia_proposta = gar.exigeEvidencia;
  if (gar.percentualEvidencia) evidencias.percentual_garantia_proposta = gar.percentualEvidencia;
  if (gar.vigenciaEvidencia) {
    evidencias.vigencia_garantia_proposta_dias = gar.vigenciaEvidencia;
    if (gar.termoInicial) evidencias.vigencia_garantia_termo_inicial = gar.vigenciaEvidencia;
  }
  if (gar.cnpjEvidencia) evidencias.orgao_cnpj = gar.cnpjEvidencia;
  if (valor) evidencias.valor_global_edital = valor.evidencia;
  if (exec.evidencia) evidencias.exige_garantia_execucao = exec.evidencia;

  // Alertas que dependem só da leitura (não mudam quando o usuário corrige um campo)
  const extracao: Alerta[] = [];
  if (gar.cnpjDoCabecalho && gar.cnpj && gar.exige) {
    extracao.push(makeAlerta('outro', 'info', 'orgao_cnpj',
      'A cláusula de garantia não informa o CNPJ do beneficiário; usei o CNPJ do cabeçalho do edital. Confira se o segurado é o órgão ou uma secretaria.'));
  }
  if (tabela?.valor != null) {
    const mensal = tabela.meses ? ` (${brl(tabela.soma)} por mês × ${tabela.meses} meses)` : '';
    extracao.push(makeAlerta('outro', 'atencao', 'valor_global_edital',
      `O edital não traz o valor total geral. Calculei pela tabela de itens (p. ${tabela.evidencia.pagina}): soma de ${tabela.itens.length} ${tabela.itens.length === 1 ? 'item' : 'itens'}${mensal} = ${brl(tabela.valor)}. Confira a tabela e, se possível, o valor no PNCP.`));
  } else if (tabela?.mensalSemPrazo) {
    extracao.push(makeAlerta('outro', 'atencao', 'valor_global_edital',
      `A tabela de itens (p. ${tabela.evidencia.pagina}) traz só valores mensais (soma ${brl(tabela.soma)} por mês) e não diz por quantos meses. Informe o valor total ou o prazo do contrato.`));
  }
  if (valor?.alternativos.length) {
    extracao.push(makeAlerta('outro', 'atencao', 'valor_global_edital',
      `O edital traz outros valores totais: ${valor.alternativos.slice(0, 3).map(a => `${brl(a.valor)} (p. ${a.pagina})`).join(', ')}. Confira qual é o valor estimado da contratação.`));
  }
  if (gar.percentual != null && gar.percentualCriterio === 'teto') {
    extracao.push(makeAlerta('outro', 'atencao', 'percentual_garantia_proposta',
      `O edital fixa só o teto da garantia ("até" ou "não superior a" ${String(gar.percentual).replace('.', ',')}%). Usei o teto no cálculo; confirme com o órgão se é esse o percentual exigido.`));
  } else if (gar.percentual != null && gar.percentualCriterio === 'minimo') {
    extracao.push(makeAlerta('outro', 'atencao', 'percentual_garantia_proposta',
      `O edital fixa o mínimo da garantia ("não inferior a" ${String(gar.percentual).replace('.', ',')}%). Usei o mínimo no cálculo; confira se não há percentual maior no edital.`));
  }
  if (gar.cnpjInvalido) {
    extracao.push(makeAlerta('outro', 'atencao', 'orgao_cnpj',
      `O CNPJ ${gar.cnpj} tem dígito verificador inválido (erro de digitação no edital ou de leitura). Confirme o CNPJ do órgão antes de pedir a minuta.`));
  }
  if (lotes.length && valor) {
    const soma = lotes.reduce((s, l) => s + l.valor, 0);
    if (Math.abs(soma - valor.valor) > Math.max(1, valor.valor * 0.005)) {
      extracao.push(makeAlerta('outro', 'atencao', 'lotes',
        `A soma dos lotes (${brl(soma)}) não fecha com o valor global (${brl(valor.valor)}). Confira os valores por lote no edital.`));
    }
  }
  if (origem === 'ocr') {
    extracao.push(makeAlerta('outro', 'atencao', null,
      'Documento lido por OCR (imagem/escaneado). Números e CNPJ podem ter erro de leitura: confira cada campo no trecho de origem.'));
  }

  const dados: EditalData = {
    orgao_nome: ident.orgao_nome,
    orgao_cnpj: gar.cnpj,
    orgao_endereco: null,
    modalidade: ident.modalidade,
    numero_edital: ident.numero_edital,
    numero_processo: ident.numero_processo,
    portal_eletronico: ident.portal_eletronico,
    objeto: ident.objeto ?? '',
    criterio_julgamento: ident.criterio_julgamento,
    sistema_registro_precos: ident.sistema_registro_precos,

    data_sessao_publica: datas.data_sessao_publica,
    data_limite_propostas: datas.data_limite_propostas,
    prazo_impugnacao_dias: null,
    prazo_esclarecimento_dias: null,
    inversao_fases: null,

    exige_garantia_proposta: gar.exige as boolean,
    percentual_garantia_proposta: gar.percentual,
    base_calculo_garantia: gar.baseCalculo,
    modalidades_aceitas_garantia: gar.modalidades,
    vigencia_garantia_proposta_dias: gar.vigenciaDias,
    vigencia_garantia_termo_inicial: gar.termoInicial,
    vigencia_garantia_termo_inicial_trecho: gar.termoTrecho,
    consequencia_nao_apresentacao: null,
    hipoteses_execucao: null,

    valor_global_edital: valor?.valor ?? null,
    valor_global_edital_trecho: valor?.evidencia.trecho ?? null,
    valor_global_edital_pagina: valor ? `p. ${valor.evidencia.pagina}` : null,
    lotes: lotes.length ? lotes : null,
    lotes_selecionados: null,

    validade_proposta_dias: datas.validade_proposta_dias,
    validade_proposta_fonte: datas.validade_proposta_fonte,
    divergencia_validade_proposta: datas.divergencia_validade_proposta,

    exige_garantia_execucao: exec.exige,
    percentual_garantia_execucao: exec.percentual,
    garantia_legal_aplicavel: null,
    periodo_conservacao_aplicavel: null,

    observacoes_relevantes: null,
    _evidencias: evidencias,
    _editados: [],
    _alertas_extracao: extracao,
    _origem: origem,
    _total_paginas: paginas.length,
  };
  return finalizarEdital(dados);
}

/**
 * Recalcula o que deriva dos valores atuais: garantia calculada, alertas de dado
 * ausente, pendências, recomendações e travas. Idempotente.
 */
export function finalizarEdital(entrada: EditalData, agora = Date.now()): EditalData {
  const d: EditalData = { ...entrada };
  const editados = new Set(d._editados ?? []);
  const alertas: Alerta[] = [...(d._alertas_extracao ?? [])];
  const pendencias: string[] = [];
  const recomendacoes: string[] = [];

  deriveExigeGarantia(d);

  // Garantia calculada: sobre os lotes escolhidos (se houver) ou sobre o valor global
  const pct = d.percentual_garantia_proposta;
  const valor = d.valor_global_edital;
  const lotes = d.base_calculo_garantia === 'por_lote' && d.lotes?.length ? d.lotes : null;
  const escolhidos = lotes && d.lotes_selecionados?.length
    ? lotes.filter(l => d.lotes_selecionados!.includes(l.numero))
    : null;
  const pctTxt = pct != null ? `${String(pct).replace('.', ',')}%` : '';
  if (d.exige_garantia_proposta !== false && pct != null && escolhidos?.length) {
    const base = escolhidos.reduce((s, l) => s + l.valor, 0);
    d.valor_garantia_proposta_calculado = arredondar2(base * pct / 100);
    d.formula_calculo = `${pctTxt} x ${escolhidos.length === 1 ? 'lote' : 'lotes'} ${escolhidos.map(l => l.numero).join(', ')} (${brl(base)})`;
  } else if (d.exige_garantia_proposta !== false && pct != null && valor != null) {
    d.valor_garantia_proposta_calculado = arredondar2(valor * pct / 100);
    d.formula_calculo = `${pctTxt} x valor global (${brl(valor)})${lotes ? ' = todos os lotes' : ''}`;
  } else {
    d.valor_garantia_proposta_calculado = null;
    d.formula_calculo = pct != null && valor == null ? `${String(pct).replace('.', ',')}% x valor global (valor não localizado)` : null;
  }

  if (d.exige_garantia_proposta === false) {
    alertas.push(makeAlerta('outro', 'info', 'exige_garantia_proposta',
      'Não encontrei cláusula de garantia de proposta (art. 58) no edital. Confira se ele realmente não exige.'));
  } else if (d.exige_garantia_proposta == null) {
    alertas.push(makeAlerta('dado_ausente', 'atencao', 'exige_garantia_proposta',
      'O edital menciona garantia de proposta, mas não encontrei a cláusula que a exige. Confira no edital.'));
  }

  if (d.exige_garantia_proposta !== false) {
    if (valor == null) {
      alertas.push(makeAlerta('dado_ausente', 'bloqueante', 'valor_global_edital',
        'Valor estimado da contratação não localizado no edital. Informe o valor (PNCP ou órgão) para calcular a garantia.'));
    }
    if (pct == null && d.exige_garantia_proposta === true) {
      alertas.push(makeAlerta('dado_ausente', 'bloqueante', 'percentual_garantia_proposta',
        'Percentual da garantia de proposta não localizado. Informe o percentual exigido no edital.'));
    }
    if (d.exige_garantia_proposta === true && d.vigencia_garantia_proposta_dias == null) {
      alertas.push(makeAlerta('dado_ausente', 'atencao', 'vigencia_garantia_proposta_dias',
        'O edital não fixa vigência para a garantia de proposta (ou não localizei). Defina a vigência pela política de subscrição.'));
    }
    if (d.exige_garantia_proposta === true && !d.orgao_cnpj) {
      alertas.push(makeAlerta('dado_ausente', 'atencao', 'orgao_cnpj',
        'CNPJ do beneficiário não localizado. Informe o CNPJ do órgão que será o segurado.'));
    }
  }
  if (!d.data_sessao_publica) {
    alertas.push(makeAlerta('dado_ausente', 'atencao', 'data_sessao_publica', 'Data da sessão pública não localizada.'));
  }

  if (d.orgao_cnpj && !cnpjValido(d.orgao_cnpj) && !(d._alertas_extracao ?? []).some(a => a.campo_afetado === 'orgao_cnpj' && /verificador/.test(a.texto))) {
    alertas.push(makeAlerta('outro', 'atencao', 'orgao_cnpj', `O CNPJ ${d.orgao_cnpj} tem dígito verificador inválido. Confira antes de pedir a minuta.`));
  }

  if (lotes && !escolhidos?.length) {
    recomendacoes.push('A garantia incide sobre os lotes em que o cliente participar. Marque os lotes que ele disputa para o valor ficar exato; sem marcar, o cálculo é o teto (todos os lotes).');
  } else if (d.base_calculo_garantia === 'por_lote' || d.base_calculo_garantia === 'por_item') {
    if (!escolhidos?.length) recomendacoes.push(`A garantia incide sobre o valor do(s) ${d.base_calculo_garantia === 'por_lote' ? 'lote(s)' : 'item(ns)'} em que o cliente participar. O valor calculado sobre o total é o teto; ajuste se ele não disputar tudo.`);
  }
  if (d.divergencia_validade_proposta) recomendacoes.push(`Validade da proposta diverge no edital: ${d.divergencia_validade_proposta}`);
  if (d.exige_garantia_execucao === true) {
    recomendacoes.push(`O vencedor também prestará garantia de execução${d.percentual_garantia_execucao ? ` de ${String(d.percentual_garantia_execucao).replace('.', ',')}%` : ''}: oportunidade de seguro garantia de contrato.`);
  }

  d.alertas = alertas;
  d.pendencias_bloqueantes = pendencias;
  d.recomendacoes = recomendacoes;

  enforcePositiveLock(d, editados);
  enforceTermoInicialLock(d, editados);
  enforceScaleSanity(d, editados);
  enforcePlausibilityBand(d);
  deduplicateBlockers(d);
  addDeadlineAlerts(d, agora);
  return d;
}

/** Aplica uma correção manual e recalcula. */
export function corrigirCampo(d: EditalData, campo: keyof EditalData, valor: unknown): EditalData {
  const novo: EditalData = { ...d, [campo]: valor };
  novo._editados = [...new Set([...(d._editados ?? []), campo as string])];
  const ev = { ...(d._evidencias ?? {}) };
  ev[campo as string] = { trecho: 'Informado manualmente', pagina: 0 };
  novo._evidencias = ev;
  if (campo === 'valor_global_edital') {
    novo.valor_global_edital_trecho = 'Informado manualmente';
    novo.valor_global_edital_pagina = 'manual';
  }
  return finalizarEdital(novo);
}

/** CNPJ com dígito verificador válido num texto de OCR (tolera espaços que o OCR insere). */
export function cnpjNoTextoOcr(texto: string): string | null {
  const re = /\d{2}\s?\.\s?\d{3}\s?\.\s?\d{3}\s?\/\s?\d{4}\s?-\s?\d{2}/g;
  for (const m of texto.matchAll(re)) {
    const d = m[0].replace(/\D/g, '');
    const c = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    if (c !== '56.123.874/0001-90' && cnpjValido(c)) return c;
  }
  return null;
}

/**
 * Variação "CNPJ só no timbre": o cabeçalho das páginas é uma imagem, então o texto do PDF
 * não traz o CNPJ do órgão. A tela lê o topo da página por OCR e passa o texto aqui.
 * Só aplica quando o campo está vazio, não foi corrigido à mão e o CNPJ tem dígito válido.
 */
export function aplicarCnpjDoTimbre(d: EditalData, textoOcr: string, pagina: number): EditalData {
  if (d.orgao_cnpj || d._editados?.includes('orgao_cnpj')) return d;
  const cnpj = cnpjNoTextoOcr(textoOcr);
  if (!cnpj) return d;
  const linha = textoOcr.split('\n').find(l => l.replace(/\D/g, '').includes(cnpj.replace(/\D/g, '')))?.trim() ?? cnpj;
  return finalizarEdital({
    ...d,
    orgao_cnpj: cnpj,
    _evidencias: { ...(d._evidencias ?? {}), orgao_cnpj: { trecho: `Timbre da página (imagem, lido por OCR): ${linha}`, pagina } },
    _alertas_extracao: [...(d._alertas_extracao ?? []), makeAlerta('outro', 'atencao', 'orgao_cnpj',
      `O CNPJ ${cnpj} só aparece no timbre (imagem) do edital e foi lido por OCR; os dígitos verificadores conferem. Confirme se o segurado é o órgão ou uma secretaria.`)],
  });
}
