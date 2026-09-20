-- 091_trilha_saude_desejo.sql
--
-- Terceira e mais funda reescrita da trilha saude-pme. Muda a estrategia, nao
-- so o texto.
--
-- POR QUE. O Fabio observou, com razao, que boa parte do publico nao sabe que
-- precisa de plano. Publico sem consciencia do problema nao responde a dor,
-- porque nao sente dor nenhuma. Bater na dor de quem nao a reconhece soa como
-- vendedor inventando urgencia. Para esse publico o caminho e identificacao
-- primeiro, depois desejo, e so entao preco.
--
-- Espinha nova, na ordem que ele descreveu:
--   dia  1  quem e a Unimed de Sorocaba: cooperativa daqui, nao marca de fora
--   dia  3  como o plano aparece no dia a dia de quem tem
--   dia  7  os hospitais, que e o que decide de verdade
--   dia 12  quanto custa e como se entra
--   dia 20  fechamento e captura do mes de renovacao
--
-- O que saiu: a abertura pelo bolso do dono, que era o e-mail 1 da versao 090.
-- O angulo nao foi jogado fora, virou uma frase dentro do e-mail de preco, que
-- e onde ele cabe sem soar como abordagem.
--
-- FONTES DOS NUMEROS INSTITUCIONAIS, conferidas em 20/09/2026:
--   Federacao das Unimeds do Estado de Sao Paulo, materia de 25/06/2026:
--     fundacao em 4 de junho de 1971 por 47 medicos; mais de 1.300 medicos
--     cooperados; mais de 165 mil clientes diretos; cerca de 3.800
--     colaboradores; pontos de atendimento em Boituva, Piedade e Porto Feliz;
--     dois hospitais proprios (Dr. Miguel Soeiro e Centro).
--   Medicina S/A, 27/07/2023: o Hospital Dr. Miguel Soeiro passou de 222 para
--     286 leitos na setima ampliacao, com cerca de R$ 80 milhoes e 7.000 m2.
-- O texto diz "mais de 280 leitos" e nao "286", porque o dado e de 2023 e o
-- hospital seguiu em obra. Se for atualizar, confirme antes com a operadora.
--
-- TRADEOFF, para decisao consciente: esta sequencia constroi desejo antes de
-- pedir qualquer coisa, e o primeiro pedido de verdade so aparece no dia 12.
-- Tende a dar menos resposta cedo e resposta melhor depois. A versao 090, que
-- abria pela dor do bolso, faz o contrario. Vale medir as duas.
--
-- ATENCAO: quatro dos cinco botoes levam a fgsaude.com.br. Nao ative a trilha
-- antes de o site estar no ar.

update email_trilha_etapas set
  assunto    = 'A Unimed de Sorocaba faz 55 anos este ano',
  tagline    = 'Desde 1971',
  titulo     = 'Uma cooperativa de médicos<br>daqui, não uma marca de fora',
  cta_texto  = 'Ver a rede aqui na região',
  cta_link   = 'https://fgsaude.com.br/rede.html',
  corpo_html = '<p style="{{P}}">Quando se fala em plano de saúde, quase todo mundo imagina uma empresa distante, com central de atendimento em outro estado. A Unimed de Sorocaba não é isso.</p>
<p style="{{P}}">Ela nasceu em 4 de junho de 1971, criada por 47 médicos de Sorocaba, e continua sendo uma cooperativa: quem é dono dela são os próprios médicos que atendem.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">A cooperativa hoje</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">55 anos</strong> de atuação na região de Sorocaba.<br><strong style="color:#123A2D;">Mais de 1.300</strong> médicos cooperados.<br><strong style="color:#123A2D;">Mais de 165 mil</strong> clientes diretos.<br><strong style="color:#123A2D;">Dois hospitais próprios</strong>, além de unidades avançadas e laboratórios.<br><strong style="color:#123A2D;">Atendimento em [CIDADE]</strong> e em mais onze cidades da região.</p></td></tr></table>
<p style="{{PF}}">Nos próximos dias eu mostro como isso aparece no dia a dia de quem tem o plano, e onde você seria atendido. Sou o Fábio, da F&amp;G, corretora aqui em Boituva.</p>'
where trilha = 'saude-pme' and ordem = 1;

update email_trilha_etapas set
  assunto    = 'Como é o dia a dia de quem tem o plano',
  tagline    = 'No dia a dia',
  titulo     = 'A consulta que você marca<br>para esta semana',
  cta_texto  = 'Ver os três planos',
  cta_link   = 'https://fgsaude.com.br/planos.html',
  corpo_html = '<p style="{{P}}">Plano de saúde não se sente no dia em que assina. Se sente nas coisas pequenas, que só aparecem quando você precisa.</p>
<p style="{{P}}">É a consulta marcada para esta semana, e não para daqui a dois meses. É o exame feito no laboratório do próprio bairro, sem atravessar a cidade. É chegar no pronto atendimento às duas da manhã e ser atendido sem ninguém perguntar antes quanto você vai pagar.</p>
<p style="{{P}}">Nas vendas novas de PME da Unimed Sorocaba, <strong style="color:#123A2D;">consulta e exame básico liberam em 1 dia</strong>, não em trinta. E urgência e emergência têm cobertura em todo o país, então vale também quando você está viajando.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que se paga ao usar</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Consulta em consultório:</strong> R$ 35,00.<br><strong style="color:#123A2D;">Exame básico:</strong> R$ 5,90 por exame.<br><strong style="color:#123A2D;">Terapia:</strong> R$ 9,90 por sessão.<br><strong style="color:#123A2D;">Internação:</strong> sem coparticipação, exceto psiquiátrica a partir do 31º dia.<br>Só paga quem usou, na fatura seguinte.</p></td></tr></table>
<p style="{{PF}}">São três planos, que mudam na rede e na acomodação. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 2;

update email_trilha_etapas set
  assunto    = 'Onde você seria internado, se precisasse',
  tagline    = 'Os hospitais',
  titulo     = 'O hospital é a parte que<br>ninguém olha até precisar',
  cta_texto  = 'Ver a rede da minha cidade',
  cta_link   = 'https://fgsaude.com.br/rede.html',
  corpo_html = '<p style="{{P}}">Na hora de comparar planos, todo mundo olha a mensalidade. O que decide de verdade é outra coisa: para onde você vai se precisar de uma cirurgia, de uma UTI ou de ficar internado uma semana.</p>
<p style="{{P}}">A referência da Unimed Sorocaba é o <strong style="color:#123A2D;">Hospital Dr. Miguel Soeiro</strong>, próprio da cooperativa, em Sorocaba. Ele passou de 222 para <strong style="color:#123A2D;">mais de 280 leitos</strong> na sétima ampliação, concluída em 2023, com cerca de R$ 80 milhões investidos, e tem UTI adulto, centro cirúrgico e pronto atendimento. Ele entra na rede do Unipart Max A e do Max B.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Onde você é atendido</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Boituva:</strong> Hospital São Luís, Centro Médico São José, unidade Unimed de laboratório, Foizer e Lab Clin.<br><strong style="color:#123A2D;">Porto Feliz:</strong> Santa Casa de Porto Feliz e unidade Unimed de laboratório.<br><strong style="color:#123A2D;">Sorocaba:</strong> Hospital Dr. Miguel Soeiro, Santa Lucinda, Santo Antônio, GPACI e pronto atendimento Unimed na Zona Norte.<br><strong style="color:#123A2D;">Região:</strong> Araçoiaba da Serra, Capela do Alto, Iperó, Mairinque, Piedade, Pilar do Sul, Salto de Pirapora, Tapiraí e Votorantim.</p></td></tr></table>
<p style="{{P}}">Consulta e exame básico saem na própria cidade. O hospital fica para o que é grande, que é exatamente quando você não quer estar improvisando.</p>
<p style="{{P}}"><strong style="color:#123A2D;">E vem mais coisa para cá:</strong> a Unimed Sorocaba vai construir um hospital próprio em Boituva, anunciado em abril de 2026, com conclusão prevista para o final de 2027. Prazos e escopo são definidos pela operadora e podem mudar.</p>
<p style="{{PF}}">Se quiser a rede completa da cidade onde fica a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong>, com endereços, é só responder. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 3;

update email_trilha_etapas set
  assunto    = 'Quanto custa ter isso',
  tagline    = 'Valores',
  titulo     = 'A conta é menor do que<br>a maioria imagina',
  cta_texto  = 'Fazer a conta agora',
  cta_link   = 'https://fgsaude.com.br/cotacao.html',
  corpo_html = '<p style="{{P}}">Depois de tudo isso vem a pergunta que interessa, e eu vou direto a ela.</p>
<p style="{{P}}">Na tabela de 2 a 29 vidas, o <strong style="color:#123A2D;">Unipart Fácil</strong> começa em R$ 152,02 por vida na faixa de 0 a 18 anos e fica em R$ 262,68 na faixa de 29 a 33. O <strong style="color:#123A2D;">Unipart Max</strong>, com rede maior e opção de apartamento, parte de R$ 224,50 na mesma tabela.</p>
<p style="{{P}}">A Unimed Sorocaba aceita empresa <strong style="color:#123A2D;">a partir de 2 vidas</strong>. Se você hoje paga plano no seu CPF, vale fazer a comparação: quem tem CNPJ costuma ter caminho melhor, embora isso dependa das idades de quem entra.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Quando cada coisa libera</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">1 dia:</strong> urgência, emergência, consultas e exames básicos.<br><strong style="color:#123A2D;">30 dias:</strong> terapias como fisioterapia, psicoterapia e fonoaudiologia.<br><strong style="color:#123A2D;">180 dias:</strong> internações, cirurgias e exames de alta complexidade.<br><strong style="color:#123A2D;">300 dias:</strong> parto.<br>Quem vem de outra operadora pode entrar por portabilidade, com carência zero, dentro das regras vigentes.</p></td></tr></table>
<p style="{{PF}}">No site você coloca as idades e vê a faixa de preço na hora, sem falar com ninguém. Se preferir, me mande só as idades, sem nomes, que eu fecho o valor exato no mesmo dia. Sou o Fábio, da F&amp;G.</p>'
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
