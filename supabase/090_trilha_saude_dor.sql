-- 090_trilha_saude_dor.sql
--
-- Reescreve a trilha saude-pme em cima de DOR, e nao de objecao.
--
-- A versao anterior (089) ja falava do plano e nao de RH, mas abria pelas
-- objecoes: "voce acha que precisa de 20 vidas", "voce acha que a carencia e
-- longa". Objecao e o que voce responde depois que a pessoa se interessou.
-- Dor e o que faz ela abrir o e-mail.
--
-- Premissa nova, confirmada pelo Fabio em 20/09/2026: a maioria das PME de 2 a
-- 29 vidas que ele vai prospectar em Boituva e Porto Feliz NAO tem plano de
-- saude empresarial. Entao a dor principal nao e o reajuste de quem ja tem, e
-- sim o bolso do proprio dono, que costuma pagar plano como pessoa fisica.
--
-- Espinha:
--   dia  1  o dono paga plano individual, e tem CNPJ na mao
--   dia  3  o valor e menor do que ele imagina, por isso ele nunca pediu
--   dia  7  a rede fica perto, e vem hospital proprio em Boituva
--   dia 12  o medo de pagar e nao poder usar: carencia e custo de usar
--   dia 20  fechamento, captura do mes de renovacao
--
-- Duas mudancas de forma, tambem de proposito:
--   1. Os e-mails 1 e 5 ficaram curtos, sem quadro. E-mail frio lido no
--      celular precisa ganhar um clique, nao convencer sozinho.
--   2. Os e-mails 1, 2 e 4 apontam para o simulador do site em vez de pedir
--      resposta. Pedir dado para um desconhecido no primeiro contato e um
--      pedido caro; deixar a pessoa fazer a conta sozinha nao e.
--
-- CUIDADO COM O ANGULO DO DONO (e-mail 1). O Fabio confirmou que ele funciona,
-- mas pediu contencao. O texto NAO promete que o empresarial sai mais barato:
-- diz que o individual raramente e a opcao mais barata e convida a fazer a
-- conta, porque o resultado depende das idades de quem entra. Nao endurecer
-- essa frase sem falar com ele.
--
-- ATENCAO: tres dos cinco botoes levam a fgsaude.com.br. Nao ative a trilha
-- antes de o site estar no ar.

update email_trilha_etapas set
  assunto    = 'Você paga plano de saúde por fora da empresa?',
  tagline    = 'A partir de 2 vidas',
  titulo     = 'Quem tem CNPJ quase nunca<br>precisa pagar plano individual',
  cta_texto  = 'Fazer a conta agora',
  cta_link   = 'https://fgsaude.com.br/cotacao.html',
  corpo_html = '<p style="{{P}}">Se você paga plano de saúde no seu CPF, para você ou para a família, essa raramente é a opção mais barata para quem tem empresa.</p>
<p style="{{P}}">Com o CNPJ da <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> ativo, dá para contratar o plano empresarial da Unimed Sorocaba <strong style="color:#123A2D;">a partir de 2 vidas</strong>. Você e mais uma pessoa já fecham contrato. Se sai melhor que o plano que você tem hoje depende das idades de quem entra, então só a conta responde.</p>
<p style="{{PF}}">Leva um minuto no site: você coloca as idades e ele mostra a faixa de preço na hora, sem falar com ninguém. Sou o Fábio, da F&amp;G, corretora aqui em Boituva.</p>'
where trilha = 'saude-pme' and ordem = 1;

update email_trilha_etapas set
  assunto    = 'Quanto custa para uma empresa do seu tamanho',
  tagline    = 'Valores',
  titulo     = 'A conta é menor do que<br>a maioria imagina',
  cta_texto  = 'Ver a faixa da minha empresa',
  cta_link   = 'https://fgsaude.com.br/cotacao.html',
  corpo_html = '<p style="{{P}}">Boa parte das empresas pequenas de [CIDADE] nunca pediu cotação de plano de saúde. Não por falta de vontade: por imaginar um número que não é o real.</p>
<p style="{{P}}">Na tabela de 2 a 29 vidas, o <strong style="color:#123A2D;">Unipart Fácil</strong> começa em R$ 152,02 por vida na faixa de 0 a 18 anos e fica em R$ 262,68 na faixa de 29 a 33. O <strong style="color:#123A2D;">Unipart Max</strong>, com rede maior e opção de apartamento, parte de R$ 224,50 na mesma tabela.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que pesa no valor final</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Idade de cada vida:</strong> o preço é por faixa etária, não um valor único por pessoa.<br><strong style="color:#123A2D;">Acomodação:</strong> enfermaria ou apartamento.<br><strong style="color:#123A2D;">Rede:</strong> o Fácil tem cerca de 583 médicos cooperados, o Max cerca de 1.229.<br><strong style="color:#123A2D;">Adicionais:</strong> odontológico, assistência funeral e outros, todos opcionais.</p></td></tr></table>
<p style="{{PF}}">Como o preço é por faixa etária, o valor da sua empresa depende de quem entra. No site você monta a composição e vê a faixa na hora. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 2;

update email_trilha_etapas set
  assunto    = 'Onde você é atendido em [CIDADE]',
  tagline    = 'Rede credenciada',
  titulo     = 'Plano só vale<br>se tiver médico perto',
  cta_texto  = 'Ver a rede da minha cidade',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Plano com rede longe não é usado. Consulta a quarenta minutos de carro vira consulta adiada, e no fim a mensalidade é paga e ninguém é atendido.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Rede Unimed Sorocaba na região</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Boituva:</strong> Hospital São Luís, Centro Médico São José, unidade Unimed de laboratório, Foizer e Lab Clin.<br><strong style="color:#123A2D;">Porto Feliz:</strong> Santa Casa de Porto Feliz e unidade Unimed de laboratório.<br><strong style="color:#123A2D;">Sorocaba:</strong> Hospital Dr. Miguel Soeiro, Santa Lucinda, Santo Antônio, GPACI e pronto atendimento Unimed na Zona Norte.<br><strong style="color:#123A2D;">Região:</strong> Araçoiaba da Serra, Capela do Alto, Iperó, Mairinque, Piedade, Pilar do Sul, Salto de Pirapora, Tapiraí e Votorantim.</p></td></tr></table>
<p style="{{P}}">Consulta e exame básico saem na própria cidade. Para internação e alta complexidade a referência é o Hospital Dr. Miguel Soeiro, em Sorocaba, que entra na rede do Max A e do Max B.</p>
<p style="{{P}}"><strong style="color:#123A2D;">E vem coisa nova por aqui:</strong> a Unimed Sorocaba vai construir um hospital próprio em Boituva, anunciado em abril de 2026, com conclusão prevista para o final de 2027. Prazos e escopo são definidos pela operadora e podem mudar.</p>
<p style="{{PF}}">Se quiser a rede completa da cidade onde fica a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong>, com endereços, é só responder este e-mail. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 3;

update email_trilha_etapas set
  assunto    = 'O medo de pagar e não poder usar',
  tagline    = 'Carências e uso',
  titulo     = 'O que libera em 1 dia<br>e quanto custa usar',
  cta_texto  = 'Tirar dúvida sobre carência',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Quem nunca teve plano empresarial costuma travar no mesmo ponto: o receio de pagar meio ano antes de alguém conseguir marcar uma consulta.</p>
<p style="{{P}}">Nas vendas novas de PME o prazo real é este, contado em dias a partir da vigência:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">1 dia:</strong> urgência, emergência, consultas e exames básicos.<br><strong style="color:#123A2D;">30 dias:</strong> terapias como fisioterapia, psicoterapia e fonoaudiologia.<br><strong style="color:#123A2D;">180 dias:</strong> internações, cirurgias e exames de alta complexidade.<br><strong style="color:#123A2D;">300 dias:</strong> parto.</p></td></tr></table>
<p style="{{P}}">E o custo de usar é previsível, que é justamente o que falta a quem não tem plano: consulta em consultório R$ 35,00, exame básico R$ 5,90, terapia R$ 9,90 por sessão. Só paga quem usou, na fatura seguinte. Internação não tem coparticipação, com exceção da psiquiátrica a partir do 31º dia.</p>
<p style="{{PF}}">Quem já tem plano em outra operadora pode entrar por portabilidade, com carência zero, desde que se enquadre nas regras vigentes. Se for o seu caso, me diga a operadora que eu verifico. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 4;

update email_trilha_etapas set
  assunto    = 'Último e-mail sobre isso',
  tagline    = 'Último contato',
  titulo     = 'Se não for agora,<br>me diga quando é',
  cta_texto  = 'Avisar o mês da renovação',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Este é o último e-mail desta sequência, então vou ser curto.</p>
<p style="{{P}}">Plano de saúde quase nunca se decide no dia em que alguém oferece. Decide quando o contrato vence, quando chega o reajuste, ou quando alguém precisa e descobre que não tem.</p>
<p style="{{P}}">Se a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> já tem plano, me diga só o mês da renovação, que eu volto a falar com você trinta dias antes, com a comparação pronta. Se não tem, o contrato da Unimed Sorocaba começa no dia 1, 10 ou 20 do mês, então dá para planejar com calma.</p>
<p style="{{PF}}">Qualquer dúvida sobre rede, carência ou documentos, é só responder este e-mail. Sou o Fábio, da F&amp;G, aqui em Boituva.</p>'
where trilha = 'saude-pme' and ordem = 5;
