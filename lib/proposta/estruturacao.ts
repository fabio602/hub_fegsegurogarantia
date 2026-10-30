// Motivos da estruturação (honorários) na proposta comercial de Seguro Garantia.
// Compartilhado pela tela Gerar Proposta e pelo template do PDF: cada motivo
// marcado gera um parágrafo explicando ao tomador por que o honorário existe.

export type MotivoEstruturacao = 'restricao' | 'sem_limite' | 'aumento_limite' | 'limite_tomado' | 'clausula_especial';

export interface OpcaoMotivo {
  id: MotivoEstruturacao;
  rotulo: string; // texto curto da tela
  dica: string;
}

export const MOTIVOS: OpcaoMotivo[] = [
  { id: 'restricao', rotulo: 'CNPJ com restrição financeira', dica: 'Serasa, protestos, pendências' },
  { id: 'sem_limite', rotulo: 'Sem limite ou limite insuficiente, sem restrição', dica: 'Empresa nova, balanço fraco, faturamento baixo para o valor' },
  { id: 'aumento_limite', rotulo: 'Aumento de limite', dica: 'Contrato acima do limite atual' },
  { id: 'limite_tomado', rotulo: 'Limite já tomado', dica: 'Outras apólices em aberto consomem o limite' },
  { id: 'clausula_especial', rotulo: 'Cláusula fora do padrão', dica: 'Descreva a cláusula no campo abaixo' },
];

export const CLAUSULA_EXEMPLO = 'cláusula de trânsito em julgado com pagamento direto ao funcionário';

// O que está incluso em toda estruturação.
export const INCLUSO: string[] = [
  'Análise completa da documentação da empresa, entendendo os pontos fortes e os pontos de atenção da situação financeira atual.',
  'Montagem de uma defesa técnica do CNPJ, mostrando às seguradoras os elementos que permitem aprovar o limite necessário.',
  'Apresentação do backlog e da operação da empresa em reuniões com seguradoras do nosso painel.',
  'Definição da melhor estratégia de pleito junto a cada seguradora, com o objetivo de conseguir o limite.',
];

export function paragrafoMotivo(id: MotivoEstruturacao, clausula?: string | null): string {
  const c = (clausula ?? '').trim();
  switch (id) {
    case 'restricao':
      return 'O CNPJ apresenta restrições financeiras (como apontamentos em birôs de crédito, protestos ou pendências), o que costuma levar as seguradoras a recusar ou reduzir o limite na análise automática. A estruturação leva o caso para a análise interna da seguradora, com documentação e argumentos que a análise automática não considera.';
    case 'sem_limite':
      return 'Mesmo sem restrições cadastrais, a empresa hoje não tem limite aprovado ou tem limite inferior ao necessário (por exemplo, por ser recente, ter histórico financeiro curto ou faturamento abaixo do valor pretendido). A estruturação apresenta à seguradora elementos da operação que vão além dos números do balanço.';
    case 'aumento_limite':
      return 'O valor desta garantia supera o limite hoje aprovado para a empresa. A estruturação reúne a documentação e os argumentos para pleitear o aumento de limite necessário para este contrato.';
    case 'limite_tomado':
      return 'O limite da empresa está comprometido com apólices em vigor. A estruturação avalia a carteira atual, a baixa de apólices já encerradas e o pleito de limite adicional junto às seguradoras.';
    case 'clausula_especial':
      return c
        ? `A garantia exige uma condição fora do padrão do mercado de Seguro Garantia: ${c}. Por ter aceitação restrita entre as seguradoras, vamos buscar uma seguradora que aceite essa condição e ajudá-la a entender e aceitar esse risco.`
        : 'A garantia exige uma condição fora do padrão do mercado de Seguro Garantia. Por ter aceitação restrita entre as seguradoras, vamos buscar uma seguradora que aceite essa condição e ajudá-la a entender e aceitar esse risco.';
  }
}

export const FECHAMENTO = [
  'Sem essa situação, o cadastro e a emissão seguiriam o fluxo normal, sem o custo de estruturação.',
  'Com o limite aprovado, a tendência é que as próximas emissões sejam mais simples, mas isso depende da seguradora que aprovar e das revisões periódicas de cadastro que ela realiza. A decisão final sobre o limite é sempre da seguradora.',
];

/** Mantém a ordem da lista MOTIVOS e descarta valores desconhecidos. */
export const ordenarMotivos = (ids: readonly string[] | null | undefined): MotivoEstruturacao[] =>
  MOTIVOS.map(m => m.id).filter(id => (ids ?? []).includes(id));
