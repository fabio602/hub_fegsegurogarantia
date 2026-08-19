import { GarantiaResultBoleto, GarantiaResultCartao, fmtBRL, fmtDate } from './garantiaCalc.ts';

export function buildMensagemBoleto(
  result: GarantiaResultBoleto,
  aluguel_centavos: number,
  nome: string,
  endereco: string,
): string {
  const nomeDisplay = nome.trim() || 'cliente';
  const endDisplay = endereco.trim() || 'imovel';
  const taxa = (result.taxa_mensal_efetiva * 100).toFixed(2).replace('.', ',');
  const economia = fmtBRL(result.custo_financiamento);

  return `Oi, ${nomeDisplay}! Tudo bem?

Segue a simulacao da garantia de aluguel do imovel ${endDisplay}.

COMO FICA POR MES
1 mes (${fmtDate(result.parcelas[0].data_vencimento)}): ${fmtBRL(result.desembolso_mes1)}
Aluguel ${fmtBRL(aluguel_centavos)} + 1 parcela ${fmtBRL(result.parcelas[0].valor_centavos)} (ja com a taxa de setup de ${fmtBRL(result.setup)})
Do 2 ao 12 mes: ${fmtBRL(result.desembolso_demais)}
Aluguel ${fmtBRL(aluguel_centavos)} + parcela da garantia ${fmtBRL(result.parcela_boleto)}

O QUE ESTA INCLUSO NA GARANTIA
Aluguel
IPTU
Condominio
Danos ao imovel
Multa rescisoria
Acao de despejo

Toda a parte juridica fica por conta da garantidora. Voce nao precisa de fiador nem de deposito caucao.

CONDICOES
12 parcelas no boleto, totalizando ${fmtBRL(result.total_boleto)}, com juros de ${taxa}% ao mes. A vista na contratacao, o valor da garantia e ${fmtBRL(result.total_avista)}, uma economia de ${economia}.

Vigencia de 12 meses e emissao sujeita a analise cadastral. Qualquer duvida e so me chamar.`;
}

export function buildMensagemCartao(
  result: GarantiaResultCartao,
  aluguel_centavos: number,
  nome: string,
  endereco: string,
): string {
  const nomeDisplay = nome.trim() || 'cliente';
  const endDisplay = endereco.trim() || 'imovel';

  return `Oi, ${nomeDisplay}! Tudo bem?

Segue a simulacao da garantia de aluguel do imovel ${endDisplay}.

COMO FICA POR MES
Aluguel: ${fmtBRL(aluguel_centavos)}
Garantia locaticia: ${fmtBRL(result.parcela_display)} (12x sem juros no cartao)
TOTAL POR MES: ${fmtBRL(result.desembolso_mensal)}

O QUE ESTA INCLUSO NA GARANTIA
Aluguel
IPTU
Condominio
Danos ao imovel
Multa rescisoria
Acao de despejo

Toda a parte juridica fica por conta da garantidora. Voce nao precisa de fiador nem de deposito caucao.

CONDICOES
Total de ${fmtBRL(result.total_forma)} em 12x sem juros no cartao de credito. Primeiro pagamento em ${fmtDate(result.parcelas[0].data_vencimento)}.

Vigencia de 12 meses e emissao sujeita a analise cadastral. Qualquer duvida e so me chamar.`;
}
