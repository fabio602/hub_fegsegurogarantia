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
import { arredondar2 } from './numeros.ts';
import { extrairGarantia } from './regras/garantia.ts';
import { extrairValorGlobal } from './regras/valor.ts';
import { extrairIdentificacao } from './regras/identificacao.ts';
import { extrairDatas } from './regras/datas.ts';
import { extrairExecucao } from './regras/execucao.ts';
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
  const valor = extrairValorGlobal(doc);
  const exec = extrairExecucao(doc);

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
  if (valor?.alternativos.length) {
    extracao.push(makeAlerta('outro', 'atencao', 'valor_global_edital',
      `O edital traz outros valores totais: ${valor.alternativos.slice(0, 3).map(a => `${brl(a.valor)} (p. ${a.pagina})`).join(', ')}. Confira qual é o valor estimado da contratação.`));
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

  // Garantia calculada
  const pct = d.percentual_garantia_proposta;
  const valor = d.valor_global_edital;
  if (d.exige_garantia_proposta !== false && pct != null && valor != null) {
    d.valor_garantia_proposta_calculado = arredondar2(valor * pct / 100);
    d.formula_calculo = `${String(pct).replace('.', ',')}% x valor global (${brl(valor)})`;
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

  if (d.base_calculo_garantia === 'por_lote' || d.base_calculo_garantia === 'por_item') {
    recomendacoes.push(`A garantia incide sobre o valor do(s) ${d.base_calculo_garantia === 'por_lote' ? 'lote(s)' : 'item(ns)'} em que o cliente participar. O valor calculado sobre o total é o teto; ajuste se ele não disputar tudo.`);
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
