-- 073_trilhas_judicial_consultores_retoques_copy.sql
-- Registrada no banco em 07/09/2026 como
-- trilhas_judicial_consultores_retoques_copy (version 20260908004720). Este
-- arquivo existe para o repositório refletir o que já está em produção; não
-- reaplicar.
--
-- Fecha a rodada de reescrita das trilhas (070 a 072) com retoques pontuais
-- nas duas que já estavam mais próximas do padrão PAS/BAB. Aqui não houve
-- reescrita completa, só ajuste de gancho e de título:
--   judicial 1     abre pelo depósito recursal que fica parado no processo,
--                  em vez de abrir pela apresentação da corretora.
--   judicial 3     título passa de "Não é uma boa ideia" (migração 062) para
--                  "Não é opinião", que é o que a base legal sustenta.
--   consultores 1  passa a puxar a garantia de proposta como porta de entrada
--                  da análise de limite.
--   consultores 2  vira o e-mail do problema: ganhou a licitação e travou.
--
-- As demais etapas das duas trilhas seguem como estavam nas migrações
-- anteriores e por isso não aparecem aqui.

update email_trilha_etapas
set
  assunto = 'Recorrer sem tirar o dinheiro do caixa da empresa',
  tagline = 'Seguro garantia para depósito recursal',
  titulo  = 'Recorrer sem tirar o dinheiro<br>do caixa da empresa',
  corpo_html = $h$<p style="{{P}}">Quando a empresa perde uma ação trabalhista em primeira instância e decide recorrer, a Justiça exige o depósito recursal. Esse dinheiro sai do caixa e fica parado no processo, às vezes por anos, sem previsão de retorno. O <strong style="color:#1B263B;">seguro garantia judicial</strong> substitui esse depósito.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que muda na prática</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">O capital continua na empresa:</strong> em vez de imobilizar o valor no processo, você paga um prêmio e mantém o dinheiro girando no negócio.<br><br><strong style="color:#1B263B;">Aceito pela Justiça do Trabalho:</strong> a apólice substitui o depósito recursal e a garantia do juízo, conforme a CLT e a Reforma Trabalhista.<br><br><strong style="color:#1B263B;">Emissão rápida:</strong> com a documentação em mãos, a apólice sai a tempo do prazo do recurso.</p></td></tr></table>
<p style="{{PF}}">A análise de limite pode ser feita antes de o prazo apertar, para a empresa saber quanto tem disponível antes de precisar. Me responda com o valor da condenação que eu retorno com uma simulação. Sou o Fábio Lima, da F&amp;G Seguro Garantia, corretora especialista em seguro garantia com mais de 25 seguradoras.</p>$h$,
  cta_texto = 'Pedir uma simulação (WhatsApp)',
  ativo = true
where trilha = 'judicial' and ordem = 1;

update email_trilha_etapas
set
  assunto = 'O que a CLT diz sobre substituir o depósito recursal',
  tagline = 'Base legal',
  titulo  = 'Não é opinião:<br>está na CLT',
  corpo_html = $h$<p style="{{P}}">Uma dúvida comum é se a Justiça do Trabalho aceita a apólice no lugar do depósito. A resposta está em três normas.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que dizem</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">CLT, art. 899, §11</strong> (Lei 13.467/2017): o depósito recursal poderá ser substituído por fiança bancária ou seguro garantia judicial.<br><br><strong style="color:#1B263B;">CLT, art. 882</strong> (Lei 13.467/2017): na execução, o devedor pode garantir o juízo apresentando seguro garantia judicial, em vez de depositar o valor ou nomear bens à penhora.<br><br><strong style="color:#1B263B;">Ato Conjunto TST.CSJT.CGJT nº 1/2019</strong>: regulamenta a apólice na Justiça do Trabalho. O valor segurado corresponde ao depósito acrescido de 30%, e a seguradora precisa estar regular perante a SUSEP.</p></td></tr></table>
<p style="{{P}}">Ou seja: não depende de o juiz gostar da ideia nem de a parte contrária concordar. É previsão expressa, e a apólice já sai desenhada nos termos do Ato.</p>
<p style="{{PF}}">Se o jurídico da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> quiser discutir um caso concreto, estou à disposição para conversar com ele.</p>$h$,
  cta_texto = 'Tirar uma dúvida (WhatsApp)',
  ativo = true
where trilha = 'judicial' and ordem = 3;

update email_trilha_etapas
set
  assunto = 'A garantia de proposta é a melhor hora de descobrir o limite',
  tagline = 'Garantia de Proposta',
  titulo  = 'A antecipação começa<br>na garantia de proposta',
  corpo_html = $h$<p style="{{P}}">Cada vez mais edital exige <strong style="color:#1B263B;">garantia de proposta</strong> para deixar a empresa participar. A Lei 14.133/2021 trata dela no art. 58: é requisito de pré-habilitação e não pode passar de 1% do valor estimado da contratação.</p>
<p style="{{P}}">Muito cliente recolhe isso em dinheiro, por hábito. É caixa parado até a assinatura do contrato, e a devolução só sai em até 10 dias úteis depois. Feita por seguro garantia, a mesma exigência custa uma fração disso e não imobiliza capital de giro.</p>
<div style="background-color:#FAF8F5;border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:20px 24px;margin:0 0 24px 0;"><p style="margin:0;color:#1B263B;font-size:14px;line-height:1.8;font-family:Arial,sans-serif;">Tem um detalhe aí que interessa direto ao seu trabalho: para emitir a garantia de proposta, a seguradora precisa analisar o crédito do cliente antes. Isso quer dizer que o limite dele já sai aprovado enquanto a licitação ainda está correndo. Se ele vencer, a garantia de execução vira papelada, porque a parte demorada já foi feita lá atrás.</p></div>
<p style="{{P}}">É por isso que eu insisto nela. Resolve a exigência do edital e ainda adianta a análise que costuma travar a emissão depois.</p>
<p style="{{PF}}">Tem cliente com edital aberto pedindo garantia de proposta? Me manda. Analiso o limite e já te digo até quanto ele vai conseguir na execução. Sou o Fábio, da F&amp;G Seguro Garantia, corretora especialista em seguro garantia, e quero ser a parceira dos seus clientes nessa etapa.</p>$h$,
  cta_texto = 'Analisar um Edital',
  ativo = true
where trilha = 'consultores' and ordem = 1;

update email_trilha_etapas
set
  assunto = 'Ganhou a licitação e travou na garantia',
  tagline = 'O Problema',
  titulo  = 'Ganhou a licitação.<br>E travou na garantia.',
  corpo_html = $h$<p style="{{P}}">O consultor monta a proposta, arruma a documentação, disputa o pregão. Faz o trabalho inteiro, e o cliente vence. Aí, na hora de apresentar o <strong style="color:#1B263B;">Seguro Garantia de execução</strong>, trava: o cliente não tinha limite na seguradora. Semanas de trabalho paradas numa análise de crédito que não foi realizada.</p>
<div style="background-color:#FAF8F5;border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:20px 24px;margin:0 0 24px 0;"><p style="margin:0;color:#1B263B;font-size:14px;line-height:1.8;font-family:Arial,sans-serif;">Quem já passou por isso sabe que não é só um contratempo do cliente. Não apresentar o seguro garantia impacta na sua operação.</p></div>
<p style="{{PF}}">Meu papel é antecipar essa etapa: aprovar o limite do cliente na seguradora <strong style="color:#1B263B;">antes</strong> do pregão, não depois. Me manda o próximo cliente com edital aberto e eu faço a simulação. Sou o Fábio Lima, fundador da F&amp;G Seguro Garantia, e escrevo porque a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> assessora empresas em licitações.</p>$h$,
  cta_texto = 'Simule Agora',
  ativo = true
where trilha = 'consultores' and ordem = 2;
