-- 089_trilha_saude_foco_plano.sql
--
-- Tira o angulo de RH da trilha saude-pme e coloca o plano no centro.
--
-- A trilha tinha nascido falando de contratacao e retencao de gente: a etapa 1
-- inteira era sobre o candidato perguntar do plano na entrevista, e a etapa 2
-- abria com "onde a sua equipe vai ser atendida". E a mesma correcao que o site
-- ja tinha recebido em 20/09/2026, quando "onde a sua equipe e atendida" virou
-- "onde voce e atendido".
--
-- O que muda por etapa:
--
--   dia 1   era: o plano que o candidato pergunta antes do salario
--           fica: o plano existe para empresa do tamanho da sua, e sao tres
--                 opcoes; entra o quadro comparativo dos tres Unipart
--   dia 3   era: onde a sua equipe vai ser atendida
--           fica: onde voce e atendido; entra o Hospital Unimed Boituva, que
--                 e o diferencial local e ja tem aba propria no site
--   dia 7   carencias, so limpeza de linguagem
--   dia 12  valores, "idades da equipe" vira "idades das pessoas"
--   dia 20  sai "quando um funcionario importante pede", que era retencao
--
-- Os dias, a quantidade de etapas, o molde e as cores nao mudam. Isto mexe
-- so no texto.

update email_trilha_etapas set
  assunto    = 'Plano Unimed para empresa a partir de 2 vidas',
  tagline    = 'Três planos',
  titulo     = 'Plano de saúde Unimed<br>não é só para empresa grande',
  cta_texto  = 'Ver o valor para a minha empresa',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Muita empresa pequena em [CIDADE] nem pede cotação de plano de saúde, porque acha que plano empresarial só começa a partir de vinte ou trinta vidas.</p>
<p style="{{P}}">A <strong style="color:#123A2D;">Unimed Sorocaba tem plano empresarial a partir de 2 vidas</strong>. São três opções, todas com cobertura ambulatorial e hospitalar com obstetrícia, e urgência e emergência em todo o país.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que muda de um para o outro</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Unipart Fácil:</strong> internação em enfermaria, cerca de 583 médicos cooperados.<br><strong style="color:#123A2D;">Unipart Max A:</strong> enfermaria, cerca de 1.229 cooperados e o Hospital Dr. Miguel Soeiro na rede.<br><strong style="color:#123A2D;">Unipart Max B:</strong> a mesma rede do Max A, com internação em apartamento.</p></td></tr></table>
<p style="{{P}}">Os procedimentos cobertos são os mesmos nos três, pelo rol da ANS vigente. E não é preciso escolher um plano único para todo mundo: dá para ter o Max A e o Max B no mesmo contrato.</p>
<p style="{{PF}}">Me diga quantas pessoas a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> tem hoje e eu devolvo a faixa de preço por faixa etária, sem compromisso. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 1;

update email_trilha_etapas set
  assunto    = 'Onde você é atendido em [CIDADE]',
  tagline    = 'Rede credenciada',
  titulo     = 'Plano bom é o que tem<br>médico perto de você',
  cta_texto  = 'Ver a rede da minha cidade',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Plano de saúde com rede longe acaba não sendo usado. A consulta que exige quarenta minutos de carro vira consulta adiada, e no fim o plano é pago e não atende.</p>
<p style="{{P}}">A rede da Unimed Sorocaba cobre doze cidades da região. Estas são as principais referências:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Rede Unimed Sorocaba na região</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Boituva:</strong> Hospital São Luís, Centro Médico São José, unidade Unimed de laboratório, Foizer e Lab Clin.<br><strong style="color:#123A2D;">Porto Feliz:</strong> Santa Casa de Porto Feliz e unidade Unimed de laboratório.<br><strong style="color:#123A2D;">Sorocaba:</strong> Hospital Dr. Miguel Soeiro, Santa Lucinda, Santo Antônio, GPACI e pronto atendimento Unimed na Zona Norte.<br><strong style="color:#123A2D;">Região:</strong> Araçoiaba da Serra, Capela do Alto, Iperó, Mairinque, Piedade, Pilar do Sul, Salto de Pirapora, Tapiraí e Votorantim.</p></td></tr></table>
<p style="{{P}}">Consulta e exame básico saem na própria cidade. Para internação e alta complexidade a referência é o Hospital Dr. Miguel Soeiro, em Sorocaba, que entra na rede do Max A e do Max B.</p>
<p style="{{P}}"><strong style="color:#123A2D;">E vem coisa nova por aqui:</strong> a Unimed Sorocaba vai construir um hospital próprio em Boituva, anunciado em abril de 2026, com conclusão prevista para o final de 2027. Acompanho o andamento e posso te mandar como está. Prazos e escopo são definidos pela operadora e podem mudar.</p>
<p style="{{PF}}">Se quiser, eu mando a rede completa da cidade onde fica a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong>, com endereços. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 2;

update email_trilha_etapas set
  assunto    = 'O que libera em 1 dia e o que espera 180',
  tagline    = 'Carências',
  titulo     = 'A carência é o motivo real<br>de a empresa adiar',
  cta_texto  = 'Simular com portabilidade',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Quem adia a contratação de um plano quase sempre adia pelo mesmo motivo: acha que vai pagar seis meses antes de conseguir usar.</p>
<p style="{{P}}">Nas vendas novas de PME a regra é outra. Este é o prazo real, contado em dias a partir da vigência:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">1 dia:</strong> urgência, emergência, consultas e exames básicos.<br><strong style="color:#123A2D;">30 dias:</strong> terapias como fisioterapia, psicoterapia e fonoaudiologia.<br><strong style="color:#123A2D;">180 dias:</strong> internações, cirurgias e exames de alta complexidade.<br><strong style="color:#123A2D;">300 dias:</strong> parto.</p></td></tr></table>
<p style="{{P}}">E quem já tem plano em outra operadora pode entrar por <strong style="color:#123A2D;">portabilidade, com carência zero</strong> em tudo, desde que se enquadre nas regras vigentes. Nesse caso nem declaração de saúde é preciso preencher.</p>
<p style="{{PF}}">Se a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> já tem plano hoje, me diga qual operadora que eu verifico se a portabilidade se aplica. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 3;

update email_trilha_etapas set
  assunto    = 'Quanto custa, sem enrolação',
  tagline    = 'Valores',
  titulo     = 'O número que você<br>pediria na primeira ligação',
  cta_texto  = 'Simular no site',
  cta_link   = 'https://fgsaude.com.br/cotacao.html',
  corpo_html = '<p style="{{P}}">Você provavelmente já pediu cotação de plano e recebeu de volta um pedido de reunião. Então vamos direto ao número.</p>
<p style="{{P}}">Na tabela de 2 a 29 vidas, o <strong style="color:#123A2D;">Unipart Fácil</strong> começa em R$ 152,02 por vida na faixa de 0 a 18 anos e fica em R$ 262,68 na faixa de 29 a 33 anos. O <strong style="color:#123A2D;">Unipart Max</strong>, com rede maior e opção de apartamento, parte de R$ 224,50 na mesma tabela.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que pesa no valor final</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Idade de cada vida:</strong> o preço é por faixa etária, não um valor único por pessoa.<br><strong style="color:#123A2D;">Acomodação:</strong> enfermaria ou apartamento.<br><strong style="color:#123A2D;">Coparticipação:</strong> consulta em consultório R$ 35,00, exame básico R$ 5,90, só paga quem usa.<br><strong style="color:#123A2D;">Internação:</strong> sem coparticipação, exceto psiquiátrica a partir do 31º dia.</p></td></tr></table>
<p style="{{P}}">No site você monta a composição e vê a faixa de preço na hora, sem falar com ninguém. Com a lista de idades em mãos eu fecho o valor exato da proposta no mesmo dia.</p>
<p style="{{PF}}">Me mande só as idades das pessoas que entrariam no plano da <strong style="color:#123A2D;">[NOME_EMPRESA]</strong>, sem nomes, que eu monto a conta. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 4;

update email_trilha_etapas set
  assunto    = 'Quando vence o seu contrato atual?',
  tagline    = 'Último contato',
  titulo     = 'Se não for agora,<br>me diga quando é',
  cta_texto  = 'Avisar o mês da renovação',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Este é o último e-mail desta sequência, então vou ser curto.</p>
<p style="{{P}}">Plano de saúde empresarial quase nunca se decide no dia em que alguém oferece. Decide-se quando o contrato atual vence, quando chega o reajuste, ou quando alguém precisa usar e descobre que a rede não cobre o que precisava.</p>
<p style="{{P}}">Se a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> já tem plano, me diga só o mês da renovação. Eu anoto e volto a falar com você trinta dias antes, com a comparação de rede e de valor já pronta. Se ainda não tem, o contrato da Unimed Sorocaba pode começar no dia 1, 10 ou 20 do mês, então dá para planejar com calma.</p>
<p style="{{PF}}">Qualquer dúvida sobre rede, carência ou documentos, é só responder este e-mail. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 5;
