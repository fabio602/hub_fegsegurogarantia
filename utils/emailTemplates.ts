
export const generateThankYouEmail = (email: string, clientName: string, decisor?: string) => {
  const subject = encodeURIComponent('Agradecimento pela confiança - F&G Corretora');
  const greeting = decisor ? `Olá ${decisor},` : `Olá,`;
  
  const body = encodeURIComponent(`${greeting}

Agradecemos pela parceria e pela confiança na F&G Corretora para a contratação da sua apólice. Estamos à total disposição para o que precisar.

Aproveito para lembrar que também atuamos com outras soluções que podem proteger ainda mais a sua empresa:
• Risco de Obra e Engenharia
• Seguro Cyber
• Seguro de Crédito
• Seguro Garantia Adiantamento de Pagamento
• Seguros Judiciais (Cível e Trabalhistas)

Conte conosco para o que for necessário!

Atenciosamente,
Equipe F&G Corretora`);

  return `mailto:${email}?subject=${subject}&body=${body}`;
};
