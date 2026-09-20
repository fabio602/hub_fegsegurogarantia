-- 084_trilha_saude_pme.sql
-- Etapas da trilha saude-pme no motor de e-mail ja existente.
-- Padrao de copy aprovado em 07/09/2026: assunto curto e especifico, primeira linha e a
-- situacao do leitor, um modelo por e-mail (PAS/BAB/AIDA), uma prova concreta,
-- um unico CTA, apresentacao do Fabio so na ultima frase.
-- Limite do motor: email_cadencia tem email_1..5_sent, entao no maximo 5 etapas ativas.

delete from email_trilha_etapas where trilha = 'saude-pme';

-- ===========================================================================
-- ETAPA 1 | dia 1 | PAS
-- ===========================================================================
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, cta_texto, cta_link, corpo_html, ativo)
values ('saude-pme', 1, 1,
  'Plano de saude para a equipe em [CIDADE]',
  '2 a 29 vidas',
  'O plano que o candidato<br>pergunta antes do salario',
  'Quero o valor para a minha empresa',
  'https://wa.me/5515998618659',
  $corpo$<p style="{{P}}">Contratar gente boa em [CIDADE] ficou disputado, e o plano de saude virou a primeira pergunta da entrevista, muitas vezes antes do salario.</p>
<p style="{{P}}">Sem plano, a empresa perde o candidato para o concorrente da rua de cima, paga consulta particular quando alguem adoece no meio da semana e ainda convive com o funcionario sumindo meio dia para ser atendido no posto.</p>
<p style="{{P}}">A <strong style="color:#1B263B;">Unimed Sorocaba tem plano empresarial a partir de 2 vidas</strong>, com rede em [CIDADE] e em mais onze cidades da regiao. Nas vendas novas de PME, consulta e exame basico liberam em 1 dia, nao em 30.</p>
<p style="{{PF}}">Me diga quantas pessoas a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tem hoje e eu devolvo o valor por faixa etaria, sem compromisso. Sou o Fabio, da F&amp;G.</p>$corpo$,
  true);

-- ===========================================================================
-- ETAPA 2 | dia 3 | BAB
-- ===========================================================================
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, cta_texto, cta_link, corpo_html, ativo)
values ('saude-pme', 2, 3,
  'Onde a sua equipe vai ser atendida',
  'Rede credenciada',
  'Plano barato com rede longe<br>ninguem usa',
  'Ver a rede da minha cidade',
  'https://wa.me/5515998618659',
  $corpo$<p style="{{P}}"><strong style="color:#1B263B;">Antes:</strong> a empresa fecha o plano mais barato da praca, e o funcionario descobre que a consulta mais perto fica a quarenta minutos de carro. Ninguem usa, todo mundo reclama, e a empresa paga assim mesmo.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Rede Unimed Sorocaba na regiao</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">Sorocaba:</strong> Hospital Dr. Miguel Soeiro, Santa Lucinda, Santo Antonio, GPACI, pronto atendimento Unimed na Zona Norte.<br><strong style="color:#1B263B;">Boituva:</strong> Hospital Sao Luis, Centro Medico Sao Jose, unidade Unimed de laboratorio, Foizer e Lab Clin.<br><strong style="color:#1B263B;">Porto Feliz:</strong> Santa Casa de Porto Feliz e unidade Unimed de laboratorio.<br><strong style="color:#1B263B;">Regiao:</strong> Aracoiaba da Serra, Capela do Alto, Ipero, Mairinque, Piedade, Pilar do Sul, Salto de Pirapora, Tapirai e Votorantim.</p></td></tr></table>
<p style="{{P}}"><strong style="color:#1B263B;">Depois:</strong> o funcionario consulta na propria cidade, faz o exame no laboratorio do bairro e volta a trabalhar no mesmo dia. Urgencia e emergencia tem cobertura em todo o pais.</p>
<p style="{{PF}}">Se quiser, eu mando a rede completa da cidade onde fica a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong>, com enderecos. Sou o Fabio, da F&amp;G.</p>$corpo$,
  true);

-- ===========================================================================
-- ETAPA 3 | dia 7 | AIDA
-- ===========================================================================
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, cta_texto, cta_link, corpo_html, ativo)
values ('saude-pme', 3, 7,
  'O que libera em 1 dia e o que espera 180',
  'Carencias',
  'A carencia e o motivo real<br>de a empresa adiar',
  'Simular com portabilidade',
  'https://wa.me/5515998618659',
  $corpo$<p style="{{P}}">Quase todo empresario que adia o plano de saude adia pelo mesmo motivo: acha que vai pagar seis meses antes de alguem conseguir usar.</p>
<p style="{{P}}">Nas vendas novas de PME a regra e outra. Este e o prazo real, contado em dias a partir da vigencia:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">1 dia:</strong> urgencia, emergencia, consultas e exames basicos.<br><strong style="color:#1B263B;">30 dias:</strong> terapias como fisioterapia, psicoterapia e fonoaudiologia.<br><strong style="color:#1B263B;">180 dias:</strong> internacoes, cirurgias e exames de alta complexidade.<br><strong style="color:#1B263B;">300 dias:</strong> parto.</p></td></tr></table>
<p style="{{P}}">E quem ja tem plano em outra operadora pode entrar por <strong style="color:#1B263B;">portabilidade, com carencia zero</strong> em tudo, desde que se enquadre nas regras vigentes. Nesse caso nem declaracao de saude e preciso preencher.</p>
<p style="{{PF}}">Se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> ja tem plano hoje, me diga qual operadora que eu verifico se a portabilidade se aplica. Sou o Fabio, da F&amp;G.</p>$corpo$,
  true);

-- ===========================================================================
-- ETAPA 4 | dia 12 | objecao de preco
-- ===========================================================================
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, cta_texto, cta_link, corpo_html, ativo)
values ('saude-pme', 4, 12,
  'Quanto custa, sem enrolacao',
  'Valores',
  'O numero que voce<br>pediria na primeira ligacao',
  'Pedir a tabela completa',
  'https://wa.me/5515998618659',
  $corpo$<p style="{{P}}">Voce provavelmente ja pediu cotacao de plano e recebeu de volta um pedido de reuniao. Entao vamos direto ao numero.</p>
<p style="{{P}}">Na tabela de 2 a 29 vidas, o <strong style="color:#1B263B;">Unipart Facil</strong> comeca em R$ 152,02 por vida na faixa de 0 a 18 anos e fica em R$ 262,68 na faixa de 29 a 33 anos. O <strong style="color:#1B263B;">Unipart Max</strong>, que tem rede maior e opcao de apartamento, parte de R$ 224,50 na mesma tabela.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que pesa no valor final</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">Idade de cada vida:</strong> o preco e por faixa etaria, nao um valor unico por pessoa.<br><strong style="color:#1B263B;">Acomodacao:</strong> enfermaria ou apartamento.<br><strong style="color:#1B263B;">Coparticipacao:</strong> consulta em consultorio R$ 35,00, exame basico R$ 5,90, so paga quem usa.<br><strong style="color:#1B263B;">Internacao:</strong> sem coparticipacao, exceto psiquiatrica a partir do 31o dia.</p></td></tr></table>
<p style="{{P}}">Por isso uma cotacao honesta precisa da lista de idades. Com ela eu devolvo o valor fechado no mesmo dia, nao uma faixa de "a partir de".</p>
<p style="{{PF}}">Me mande so as idades da equipe da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong>, sem nomes, que eu monto a conta. Sou o Fabio, da F&amp;G.</p>$corpo$,
  true);

-- ===========================================================================
-- ETAPA 5 | dia 20 | encerramento com pergunta
-- ===========================================================================
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, cta_texto, cta_link, corpo_html, ativo)
values ('saude-pme', 5, 20,
  'Quando renova o plano de voces?',
  'Ultimo contato',
  'Se nao for agora,<br>me diga quando e',
  'Avisar o mes da renovacao',
  'https://wa.me/5515998618659',
  $corpo$<p style="{{P}}">Este e o ultimo e-mail desta sequencia, entao vou ser curto.</p>
<p style="{{P}}">Plano de saude empresarial quase nunca se decide no dia em que alguem oferece. Decide-se quando o contrato atual vence, quando o reajuste chega ou quando um funcionario importante pede.</p>
<p style="{{P}}">Se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> ja tem plano, me diga so o mes da renovacao. Eu anoto e volto a falar com voce trinta dias antes, com a comparacao pronta. Se ainda nao tem, o contrato da Unimed Sorocaba pode comecar no dia 1, 10 ou 20 do mes, entao da para planejar com calma.</p>
<p style="{{PF}}">Qualquer duvida sobre rede, carencia ou documentos, e so responder este e-mail. Sou o Fabio, da F&amp;G.</p>$corpo$,
  true);
