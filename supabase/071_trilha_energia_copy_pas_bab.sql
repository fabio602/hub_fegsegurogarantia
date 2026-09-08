-- 071_trilha_energia_copy_pas_bab.sql
-- Registrada no banco em 07/09/2026 como trilha_energia_copy_pas_bab
-- (version 20260908004412). Este arquivo existe para o repositório refletir o
-- que já está em produção; não reaplicar.
--
-- Mesma reescrita aplicada à trilha garantia na 070, agora na trilha energia,
-- nos moldes PAS (problema, agitação, solução) e BAB (antes, depois, ponte).
-- O argumento central deixou de ser a apresentação da corretora e passou a ser
-- o limite de crédito que a fiança bancária consome:
--   1 (PAS)  a garantia do contrato de energia sai do limite no banco.
--   2 (BAB)  antes e depois de tirar a garantia da fiança, com comparativo.
--   3 (PAS)  a negociação com a comercializadora trava esperando o banco.
--   4        quebra da objeção de burocracia: três documentos e a apólice sai.
--   5        encerramento da sequência, sem oferta nova.
--
-- O marcador [GANCHO_ADESAO] no começo do e-mail 1 é resolvido em tempo de
-- envio pela Edge Function prospecting-cadence e fica como está.

update email_trilha_etapas
set
  assunto = 'A garantia do contrato de energia consome seu limite no banco?',
  tagline = 'Garantia Financeira',
  titulo  = 'A fiança bancária cobra<br>mais do que a tarifa',
  corpo_html = $h$[GANCHO_ADESAO]<p style="{{P}}">No mercado livre, quase todo contrato de compra de energia exige garantia financeira, e o caminho padrão é fiança bancária ou caução.</p>
<p style="{{P}}">A fiança sai do limite de crédito da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> no banco. É capital de giro que deixa de existir enquanto o contrato durar, com custo alto e reciprocidade. A caução trava o dinheiro direto.</p>
<p style="{{P}}">O <strong style="color:#1B263B;">Seguro Garantia de Pagamento de Energia</strong> faz o mesmo papel para a comercializadora, sem tocar no limite bancário, com custo menor e emissão em poucos dias. Aceito pelas comercializadoras e na CCEE.</p>
<p style="{{PF}}">Tem contrato em negociação ou renovação? Me responda com o valor e o prazo da garantia que eu retorno com a cotação. Sou o Fábio Lima, fundador da F&amp;G Seguro Garantia, corretora que trabalha só com seguro garantia.</p>$h$,
  cta_texto = 'Quero uma cotação',
  ativo = true
where trilha = 'energia' and ordem = 1;

update email_trilha_etapas
set
  assunto = 'O que muda quando a garantia sai do banco',
  tagline = 'Comparativo',
  titulo  = 'Antes e depois<br>da fiança bancária',
  corpo_html = $h$<p style="{{P}}"><strong style="color:#1B263B;">Antes:</strong> cada contrato de energia consome uma fatia do limite no banco, e a renovação depende de o gerente aprovar de novo.</p>
<p style="{{P}}"><strong style="color:#1B263B;">Depois:</strong> o limite bancário fica inteiro para capital de giro e investimento, e a garantia é uma apólice ajustada ao contrato.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Fiança / Caução</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Consome limite bancário<br>✕ Custo mais alto<br>✕ Processo demorado no banco<br>✕ Caução imobiliza o caixa</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Seguro Garantia de Energia</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ Não consome limite no banco<br>✓ Melhor custo-benefício<br>✓ Emissão em poucos dias<br>✓ Aceito no mercado e na CCEE</p></td></tr></table>
<p style="{{PF}}">Posso fazer essa conta com o contrato que a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tem hoje: quanto de limite está preso e quanto custaria com seguro.</p>$h$,
  cta_texto = 'Comparar com meu contrato',
  ativo = true
where trilha = 'energia' and ordem = 2;

update email_trilha_etapas
set
  assunto = 'Fechar com uma comercializadora nova sem voltar ao banco',
  tagline = 'Negociação',
  titulo  = 'A garantia decide<br>a negociação',
  corpo_html = $h$<p style="{{P}}">O contrato de energia só sai depois que a garantia é apresentada. É aí que a negociação para: o banco demora, pede reciprocidade e a comercializadora espera.</p>
<p style="{{P}}">Com a apólice, valor e prazo saem exatamente como o contrato pede, com a comercializadora como beneficiária, em poucos dias.</p>
<p style="{{P}}">Na prática, dá para fechar com comercializadora nova, aumentar volume ou renovar sem passar pelo banco outra vez.</p>
<p style="{{PF}}">Me mande a minuta, ou só valor e prazo, que eu retorno com a cotação.</p>$h$,
  cta_texto = 'Avaliar meus contratos',
  ativo = true
where trilha = 'energia' and ordem = 3;

update email_trilha_etapas
set
  assunto = 'Três documentos e a garantia sai',
  tagline = 'Na prática',
  titulo  = 'Muito pouco,<br>e o trabalho é meu',
  corpo_html = $h$<p style="{{P}}">A objeção que mais ouço é "deve ser burocrático". Não é.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Para começar, preciso só de</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">1. Contrato de compra e venda de energia (ou a minuta)<br>2. Valor e prazo da garantia exigida<br>3. CNPJ da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong></p></td></tr></table>
<p style="{{P}}">Com isso levo a operação às seguradoras que trabalham com energia, cuido do cadastro e volto com a melhor proposta. O custo é um percentual ao ano sobre o valor garantido, caso a caso.</p>
<p style="{{PF}}">Me mande o contrato que eu volto com o número.</p>$h$,
  cta_texto = 'Pedir uma cotação',
  ativo = true
where trilha = 'energia' and ordem = 4;

update email_trilha_etapas
set
  assunto = 'Fico por aqui, [NOME_CONTATO]',
  tagline = 'Encerramento',
  titulo  = 'Deixo o canal aberto',
  corpo_html = $h$<p style="{{P}}">Última mensagem da sequência. Em uma linha: o seguro garantia substitui fiança e caução no contrato de energia, sem consumir limite no banco, aceito pela comercializadora e na CCEE.</p>
<p style="{{PF}}">Quando a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tiver um contrato para garantir ou renovar, é só responder aqui. Obrigado pelo tempo.</p>$h$,
  cta_texto = 'Falar com o Fábio',
  ativo = true
where trilha = 'energia' and ordem = 5;
