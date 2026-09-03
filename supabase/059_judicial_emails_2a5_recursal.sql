-- 059_judicial_emails_2a5_recursal.sql
-- Alinha os e-mails 2 a 5 da trilha judicial ao novo e-mail 1 (migração 058),
-- que passou a falar só de depósito recursal trabalhista. Antes, os e-mails
-- seguintes ainda giravam em torno de penhora, execução fiscal e "bens e
-- imóveis", que não conversavam com o gancho do e-mail 1.
--
-- O que muda em cada um:
--   2 (dia 3)  comparativo passa a ser "depósito recursal em dinheiro" versus
--              apólice, com o argumento da correção pela poupança (CLT 899 §4º)
--              e do efeito cumulativo de vários recursos.
--   3 (dia 7)  base legal só trabalhista: CLT 899 §11 (recurso), CLT 882
--              (execução) e o Ato Conjunto TST.CSJT.CGJT 1/2019 (apólice com
--              acréscimo de 30%). Sai a Lei de Execução Fiscal.
--   4 (dia 14) o prazo vira o prazo recursal de oito dias da CLT (art. 895).
--   5 (dia 21) o resumo final repete os três argumentos da trilha nova.
--
-- Também some o "[NOME_CONTATO], ..." que abria o corpo dos e-mails 2 a 5:
-- o molde já cumprimenta com "Olá, [NOME_CONTATO]!" logo acima, e o nome
-- aparecia duas vezes seguidas. O e-mail 1 já não repetia.
-- Os textos dos botões seguem o padrão do e-mail 1: "Verbo + (WhatsApp)".
-- Intervalos (dia) não mudam.

update email_trilha_etapas
set
  assunto = 'Quanto custa deixar o depósito recursal parado',
  tagline = 'Comparativo',
  titulo  = 'Depósito em dinheiro<br>versus seguro garantia',
  corpo_html = $h$<p style="{{P}}">A diferença entre recorrer com depósito em dinheiro e recorrer com seguro garantia aparece direto no caixa. E ela cresce com o número de processos: cada recurso exige um depósito novo, e cada depósito fica retido até o fim da ação.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Depósito recursal em dinheiro</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Sai do caixa a cada recurso<br>✕ Fica retido até o trânsito em julgado<br>✕ Corrigido só pela poupança (CLT, art. 899, §4º)<br>✕ Na execução, o valor integral vai para o juízo</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Seguro garantia judicial</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ O caixa continua na empresa<br>✓ O custo é o prêmio, uma fração do valor<br>✓ Vale para o recurso e para a garantia da execução<br>✓ Uma apólice por processo, sem imobilizar nada</p></td></tr></table>
<p style="{{P}}">Na prática: em vez de tirar o valor integral do caixa a cada recurso, a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> paga um prêmio e apresenta a apólice nos autos.</p>
<p style="{{PF}}">Posso fazer essa conta com os números reais dos seus processos e mostrar quanto está retido hoje e quanto custaria com seguro.</p>$h$,
  cta_texto = 'Pedir a comparação (WhatsApp)'
where trilha = 'judicial' and ordem = 2;

update email_trilha_etapas
set
  assunto = 'O que a CLT diz sobre substituir o depósito recursal',
  tagline = 'Base legal',
  titulo  = 'Não é uma boa ideia:<br>está na CLT',
  corpo_html = $h$<p style="{{P}}">Uma dúvida comum é se a Justiça do Trabalho aceita a apólice no lugar do depósito. A resposta está em três normas.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que dizem</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">CLT, art. 899, §11</strong> (Lei 13.467/2017): o depósito recursal poderá ser substituído por fiança bancária ou seguro garantia judicial.<br><br><strong style="color:#1B263B;">CLT, art. 882</strong> (Lei 13.467/2017): na execução, o devedor pode garantir o juízo apresentando seguro garantia judicial, em vez de depositar o valor ou nomear bens à penhora.<br><br><strong style="color:#1B263B;">Ato Conjunto TST.CSJT.CGJT nº 1/2019</strong>: regulamenta a apólice na Justiça do Trabalho. O valor segurado corresponde ao depósito acrescido de 30%, e a seguradora precisa estar regular perante a SUSEP.</p></td></tr></table>
<p style="{{P}}">Ou seja: não depende de o juiz gostar da ideia nem de a parte contrária concordar. É previsão expressa, e a apólice já sai desenhada nos termos do Ato.</p>
<p style="{{PF}}">Se o jurídico da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> quiser discutir um caso concreto, estou à disposição para conversar com ele.</p>$h$,
  cta_texto = 'Tirar uma dúvida (WhatsApp)'
where trilha = 'judicial' and ordem = 3;

update email_trilha_etapas
set
  assunto = 'O limite aprovado antes de a próxima condenação chegar',
  tagline = 'Prazo e documentos',
  titulo  = 'O prazo do recurso<br>é de oito dias',
  corpo_html = $h$<p style="{{P}}">Na Justiça do Trabalho, o prazo para recorrer é de oito dias (CLT, art. 895), e o depósito, ou a apólice que o substitui, precisa estar nos autos dentro desse prazo. É por isso que o pedido de seguro garantia quase sempre chega com urgência.</p>
<p style="{{P}}">A emissão tem três etapas, e só a última é rápida:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Como funciona</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">1. Cadastro</strong>: contrato social, balanços e documentos dos sócios.<br><strong style="color:#1B263B;">2. Análise de limite</strong>: a seguradora define quanto pode garantir para a empresa.<br><strong style="color:#1B263B;">3. Emissão</strong>: com o limite aprovado, a apólice sai rápido, a tempo do recurso.</p></td></tr></table>
<p style="{{P}}">A parte demorada é a segunda, e ela pode ser feita agora, sem nenhum prazo correndo. Depois, cada recurso novo é só consumir o limite que já existe.</p>
<p style="{{PF}}">Se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> ainda não tem limite aprovado, dá para começar hoje e deixar pronto para a próxima sentença.</p>$h$,
  cta_texto = 'Começar o cadastro (WhatsApp)'
where trilha = 'judicial' and ordem = 4;

update email_trilha_etapas
set
  assunto = 'Fico por aqui, [NOME_CONTATO]',
  tagline = 'Encerramento',
  titulo  = 'Deixo o canal aberto',
  corpo_html = $h$<p style="{{P}}">Esta é a última mensagem desta sequência. Não quero ocupar sua caixa de entrada além do necessário.</p>
<p style="{{P}}">Resumindo o que compartilhei: o seguro garantia judicial substitui o depósito recursal e a garantia da execução com previsão expressa na CLT, mantém o caixa da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> girando no negócio, e o limite pode ser aprovado antes de a próxima condenação chegar.</p>
<p style="{{PF}}">Quando vier uma sentença em que isso ajude, é só responder este e-mail ou me chamar no WhatsApp. Obrigado pelo tempo.</p>$h$,
  cta_texto = null
where trilha = 'judicial' and ordem = 5;
