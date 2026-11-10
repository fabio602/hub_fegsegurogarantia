/**
 * Gatilhos do pós-venda (tabela posvenda_toques): rótulo, o que fazer e o que
 * perguntar ao cliente. Compartilhado pela tela Pós-venda e pelo "Meu dia".
 */
export const fmt = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');

export const GATILHOS: Record<string, { rot: string; acao: (s: any) => string; perguntar: string }> = {
  entrega: {
    rot: 'Entrega',
    acao: s => `Apólice emitida há 2 dias. Confirmar que ${s.segurado || s.orgaoLicitante || 'o segurado'} recebeu e aceitou.`,
    perguntar: 'A apólice foi aceita sem ressalva? Alguma exigência de cláusula? É melhor descobrir agora do que na sessão.',
  },
  licitacao: {
    rot: 'Resultado da licitação',
    acao: s => `A garantia de proposta ${s.orgaoLicitante ? 'do ' + s.orgaoLicitante : ''} vence hoje. Precisa saber o resultado.`,
    perguntar: 'Saiu o resultado do pregão? Se ganharam, a garantia de execução tem prazo curto. Posso já adiantar a cotação?',
  },
  renovacao: {
    rot: 'Renovação',
    acao: s => `A garantia de execução vence em 30 dias (${fmt(s.vigencia_fim)}). Confirmar se o contrato foi prorrogado.`,
    perguntar: 'O contrato foi prorrogado ou encerra na data? Se prorrogou, preciso do aditivo para o endosso de prazo antes do vencimento.',
  },
  acompanhamento: {
    rot: 'Acompanhamento',
    acao: s => `Checagem trimestral do contrato garantido${s.valorContrato ? ' de ' + s.valorContrato : ''}.`,
    perguntar: 'O contrato segue no valor e no prazo originais? Houve aditivo? Aditivo sem endosso deixa a apólice descasada do contrato.',
  },
  limite: {
    rot: 'Limite',
    acao: () => 'O limite aprovado na seguradora completa um ano. Sem limite válido não dá para emitir em prazo curto.',
    perguntar: 'O balanço já fechou? Com o balanço novo o limite pode subir e a análise sai antes de você precisar.',
  },
  inativo: {
    rot: 'Cliente parado',
    acao: () => 'Sem nenhuma cotação há 60 dias.',
    perguntar: 'Parou de licitar ou está cotando em outro lugar? Se for o segundo, entender o que faltou no nosso atendimento.',
  },
  relacionamento: { rot: 'Relacionamento', acao: () => 'Data de relacionamento.', perguntar: '' },
};
