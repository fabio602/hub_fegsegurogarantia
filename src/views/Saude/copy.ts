/**
 * Textos longos do módulo Saúde.
 *
 * Ficam fora dos componentes porque são material de venda: mudam por decisão
 * comercial, não por refatoração de tela. Regra fixa: nenhuma linha com
 * travessão, aqui e em qualquer coisa que o cliente leia.
 */

import type { Composicao, Faixa, PlanoId } from './precos.ts';

export type Acomodacao = 'enfermaria' | 'apartamento';

/** Max B é apartamento; Fácil e Max A são enfermaria. */
export function acomodacaoDoPlano(plano: PlanoId): Acomodacao {
  return plano === 'max_b' ? 'apartamento' : 'enfermaria';
}

/**
 * Coparticipação por evento.
 *
 * ATENÇÃO: consulta e pronto atendimento DOBRAM no apartamento, porque a
 * tabela é por acomodação. Os demais itens são iguais nas duas. Errar isso
 * numa proposta de Max B é entregar um valor que não existe.
 */
export const COPARTICIPACAO: {
  item: string;
  enfermaria: number;
  apartamento: number;
  exemplos: string;
}[] = [
  { item: 'Consulta em consultório', enfermaria: 35.00, apartamento: 70.00, exemplos: 'Consulta eletiva' },
  { item: 'Pronto atendimento', enfermaria: 50.00, apartamento: 100.00, exemplos: 'Urgência e pronto socorro' },
  { item: 'Exame básico', enfermaria: 5.90, apartamento: 5.90, exemplos: 'Hemograma, raio X, ultrassom, eletrocardiograma' },
  { item: 'Terapia básica', enfermaria: 9.90, apartamento: 9.90, exemplos: 'Fisioterapia, psicoterapia, fonoaudiologia' },
  { item: 'Exame especial', enfermaria: 14.90, apartamento: 14.90, exemplos: 'Doppler, holter, endoscopia, densitometria' },
  { item: 'Alta complexidade e terapias especiais', enfermaria: 49.90, apartamento: 49.90, exemplos: 'Tomografia, ressonância, métodos ABA e Bobath' },
];

export const CARENCIAS: { prazo: string; o_que: string }[] = [
  { prazo: '1 dia', o_que: 'Urgência, emergência, consultas e exames básicos' },
  { prazo: '30 dias', o_que: 'Terapias como fisioterapia, psicoterapia e fonoaudiologia' },
  { prazo: '180 dias', o_que: 'Internações, cirurgias e exames de alta complexidade' },
  { prazo: '300 dias', o_que: 'Parto' },
];

/**
 * A pegadinha do produto para quem vende em Boituva e Porto Feliz: o APH é
 * cobrado por vida em qualquer cidade, mas a ambulância só busca o
 * beneficiário em três. Explicar antes evita reclamação depois.
 */
export const AVISO_APH =
  'O Atendimento Pré-Hospitalar é cobrado por vida, mas a ambulância busca o ' +
  'beneficiário apenas em Sorocaba, Votorantim e Araçoiaba da Serra. Em ' +
  'Boituva e Porto Feliz vale o atendimento médico 24h por telefone, não o ' +
  'envio de ambulância. Explique isso antes de incluir.';

export const REGRAS_VIGENCIA =
  'O contrato pode começar no dia 1, 10 ou 20 do mês. Cada beneficiário maior ' +
  'de 18 anos recebe a proposta por e-mail e WhatsApp e tem 72 horas para o ' +
  'aceite. A entrevista médica é por videochamada, até as 12h do dia útil ' +
  'anterior à vigência.';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function listarComposicao(c: Composicao, faixas: Faixa[]): string {
  return faixas
    .filter(f => (c[f.faixa] ?? 0) > 0)
    .map(f => `${c[f.faixa]} de ${f.faixa} anos`)
    .join(', ');
}

export interface DadosOrcamento {
  empresa: string;
  composicao: Composicao;
  faixas: Faixa[];
  vidas: number;
  totais: Record<PlanoId, number>;
  destaque: PlanoId;
  validade: string;
}

const NOME_PLANO: Record<PlanoId, string> = {
  facil: 'Unipart Fácil',
  max_a: 'Unipart Max A',
  max_b: 'Unipart Max B',
};

/** Orçamento pronto para colar no WhatsApp do cliente. */
export function textoOrcamento(d: DadosOrcamento): string {
  const acomodacao = acomodacaoDoPlano(d.destaque);
  const consulta = COPARTICIPACAO[0][acomodacao];
  const pronto = COPARTICIPACAO[1][acomodacao];
  const porPessoa = d.totais[d.destaque] / d.vidas;

  const comparativo = (Object.keys(NOME_PLANO) as PlanoId[])
    .map(p => `${NOME_PLANO[p]}: ${brl(d.totais[p])}`)
    .join('\n');

  return [
    `*Plano de saúde Unimed Sorocaba*${d.empresa ? ` para ${d.empresa}` : ''}`,
    '',
    `${d.vidas} ${d.vidas === 1 ? 'vida' : 'vidas'}: ${listarComposicao(d.composicao, d.faixas)}`,
    '',
    '*Os três planos, por mês*',
    comparativo,
    '',
    `*Sugestão: ${NOME_PLANO[d.destaque]}*, em ${acomodacao}`,
    `${brl(d.totais[d.destaque])} por mês, ${brl(porPessoa)} por pessoa`,
    '',
    '*Quando cada coisa libera*',
    ...CARENCIAS.map(c => `${c.prazo}: ${c.o_que.toLowerCase()}`),
    '',
    '*Quanto custa usar*',
    `Consulta em consultório: ${brl(consulta)}`,
    `Pronto atendimento: ${brl(pronto)}`,
    `Exame básico: ${brl(COPARTICIPACAO[2][acomodacao])}`,
    'Só paga quem usou, na fatura seguinte. Internação não tem coparticipação, exceto psiquiátrica a partir do 31º dia.',
    '',
    REGRAS_VIGENCIA,
    '',
    d.validade ? `Valores válidos até ${d.validade}.` : '',
    'Fábio, F&G Saúde, (15) 99740-2635',
  ].filter(l => l !== '').join('\n');
}

/**
 * Corpo do pedido de cotação para a Favorita Brasil, no formato que eles pedem.
 * Só monta o texto: nenhum e-mail é disparado daqui.
 */
export function textoPedidoFavorita(o: {
  empresa: string; plano: PlanoId; inicio: string; vidas: number;
}): string {
  const nome = (o.empresa || 'NOME DA EMPRESA').toUpperCase();
  return [
    `Assunto: ${nome} - F & G SEGUROS`,
    '',
    nome,
    `Plano: ${NOME_PLANO[o.plano].toUpperCase()}`,
    `Início: ${o.inicio}`,
    `Nº de vidas: ${String(o.vidas).padStart(2, '0')}`,
    '',
    'Dados responsável pela Empresa: telefone, e-mail e estado civil',
    'Dados Titular e maiores de 18 anos: telefone, e-mail e estado civil',
  ].join('\n');
}

export const EMAIL_FAVORITA = 'comercial@favoritabrasil.com.br';
