-- 088_trilha_saude_identidade.sql
--
-- Tres correcoes na trilha saude-pme, na mesma migracao porque mexem nas
-- mesmas linhas:
--
-- 1. IDENTIDADE POR TRILHA. O molde de e-mail assinava tudo com o telefone,
--    o site e o nome do Seguro Garantia. Num e-mail de plano de saude isso
--    manda o prospect para o canal errado. Agora cada trilha guarda o seu
--    nome, cargo, telefone, site, WhatsApp e paleta, com valores padrao
--    iguais aos de hoje, entao nenhuma trilha existente muda de aparencia.
--
-- 2. ACENTUACAO. A trilha saude-pme era a unica do sistema sem acento, no
--    assunto, no titulo e no corpo das cinco etapas. As outras sete trilhas
--    sempre tiveram. Texto corrigido inteiro.
--
-- 3. COERENCIA COM O SITE. A etapa 4 prometia "o valor fechado, nao uma faixa
--    de a partir de", enquanto o site mostra justamente uma faixa. Quem lesse
--    o e-mail e depois usasse o simulador veria a contradicao. A frase agora
--    conta a mesma historia: a faixa sai na hora no site, o valor fechado sai
--    quando chega a lista de idades.
--
-- As cores dos e-mails de saude passam a ser as do site (verde), e nao o
-- dourado da F&G Seguro Garantia. Os tons foram escolhidos para reproduzir o
-- contraste que o dourado tinha sobre o navy, nao apenas para "ficar verde":
--   acento sobre cabecalho  dourado 6,04  ->  verde 6,69
--   acento sobre painel     dourado 5,11  ->  verde 4,92
--   acento sobre branco     dourado 2,51  ->  verde 5,37  (melhorou)
--
-- ATENCAO: a etapa 4 passa a mandar o prospect para fgsaude.com.br/cotacao.html.
-- Nao ative a trilha saude-pme antes de o site estar no ar, senao o botao cai
-- num dominio que ainda nao responde. Hoje isso nao corre risco, porque a
-- campanha de garimpo de saude ainda nao existe e a trilha nao tem contato.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Colunas de identidade, com o padrao de hoje
-- ─────────────────────────────────────────────────────────────────────────

alter table email_trilhas
  add column if not exists marca_nome        text not null default 'F&G Seguro Garantia',
  add column if not exists marca_cargo       text not null default 'Fundador, F&G Seguro Garantia',
  add column if not exists contato_telefone  text not null default '(15) 99861-8659',
  add column if not exists contato_site      text not null default 'fegsegurogarantia.com.br',
  add column if not exists contato_whatsapp  text not null default 'https://wa.me/5515998618659',
  add column if not exists tema              jsonb;

comment on column email_trilhas.tema is
  'Paleta do e-mail desta trilha. NULL usa o tema navy e dourado da F&G Seguro Garantia. '
  'Chaves aceitas: acento, cabecalho, painel, rodape_fundo, pagina, texto_suave, texto_legal.';

comment on column email_trilhas.contato_whatsapp is
  'Link usado no botao quando a etapa nao traz cta_link proprio.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. A trilha saude-pme ganha identidade propria e acentuacao
-- ─────────────────────────────────────────────────────────────────────────

update email_trilhas set
  nome             = 'Plano de Saúde PME Unimed Sorocaba',
  eyebrow          = 'Plano de Saúde Empresarial',
  rodape           = 'Você recebe este e-mail por ser responsável por uma empresa na região de Sorocaba',
  assinatura_linha = 'Planos de saúde empresariais e Seguro Garantia',
  marca_nome       = 'F&G Saúde',
  marca_cargo      = 'Fundador, F&G Saúde',
  contato_telefone = '(15) 99740-2635',
  contato_site     = 'fgsaude.com.br',
  contato_whatsapp = 'https://wa.me/5515997402635',
  tema = jsonb_build_object(
    'acento',       '#5FD1A6',
    'cabecalho',    '#123A2D',
    'painel',       '#1B5040',
    'rodape_fundo', '#0D2A20',
    'pagina',       '#E7EFEA',
    'texto_suave',  '#9BBCAD',
    'texto_legal',  '#3E6555'
  )
where slug = 'saude-pme';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. As cinco etapas, com acento e nas cores do site
-- ─────────────────────────────────────────────────────────────────────────

update email_trilha_etapas set
  assunto    = 'Plano de saúde para a equipe em [CIDADE]',
  tagline    = '2 a 29 vidas',
  titulo     = 'O plano que o candidato<br>pergunta antes do salário',
  cta_texto  = 'Quero o valor para a minha empresa',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Contratar gente boa em [CIDADE] ficou disputado, e o plano de saúde virou a primeira pergunta da entrevista, muitas vezes antes do salário.</p>
<p style="{{P}}">Sem plano, a empresa perde o candidato para o concorrente da rua de cima, paga consulta particular quando alguém adoece no meio da semana e ainda convive com o funcionário sumindo meio dia para ser atendido no posto.</p>
<p style="{{P}}">A <strong style="color:#123A2D;">Unimed Sorocaba tem plano empresarial a partir de 2 vidas</strong>, com rede em [CIDADE] e em mais onze cidades da região. Nas vendas novas de PME, consulta e exame básico liberam em 1 dia, não em 30.</p>
<p style="{{PF}}">Me diga quantas pessoas a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> tem hoje e eu devolvo o valor por faixa etária, sem compromisso. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 1;

update email_trilha_etapas set
  assunto    = 'Onde a sua equipe vai ser atendida',
  tagline    = 'Rede credenciada',
  titulo     = 'Plano barato com rede longe<br>ninguém usa',
  cta_texto  = 'Ver a rede da minha cidade',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}"><strong style="color:#123A2D;">Antes:</strong> a empresa fecha o plano mais barato da praça, e o funcionário descobre que a consulta mais perto fica a quarenta minutos de carro. Ninguém usa, todo mundo reclama, e a empresa paga assim mesmo.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Rede Unimed Sorocaba na região</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Sorocaba:</strong> Hospital Dr. Miguel Soeiro, Santa Lucinda, Santo Antônio, GPACI, pronto atendimento Unimed na Zona Norte.<br><strong style="color:#123A2D;">Boituva:</strong> Hospital São Luís, Centro Médico São José, unidade Unimed de laboratório, Foizer e Lab Clin.<br><strong style="color:#123A2D;">Porto Feliz:</strong> Santa Casa de Porto Feliz e unidade Unimed de laboratório.<br><strong style="color:#123A2D;">Região:</strong> Araçoiaba da Serra, Capela do Alto, Iperó, Mairinque, Piedade, Pilar do Sul, Salto de Pirapora, Tapiraí e Votorantim.</p></td></tr></table>
<p style="{{P}}"><strong style="color:#123A2D;">Depois:</strong> o funcionário consulta na própria cidade, faz o exame no laboratório do bairro e volta a trabalhar no mesmo dia. Urgência e emergência têm cobertura em todo o país.</p>
<p style="{{PF}}">Se quiser, eu mando a rede completa da cidade onde fica a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong>, com endereços. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 2;

update email_trilha_etapas set
  assunto    = 'O que libera em 1 dia e o que espera 180',
  tagline    = 'Carências',
  titulo     = 'A carência é o motivo real<br>de a empresa adiar',
  cta_texto  = 'Simular com portabilidade',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Quase todo empresário que adia o plano de saúde adia pelo mesmo motivo: acha que vai pagar seis meses antes de alguém conseguir usar.</p>
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
<p style="{{P}}">Na tabela de 2 a 29 vidas, o <strong style="color:#123A2D;">Unipart Fácil</strong> começa em R$ 152,02 por vida na faixa de 0 a 18 anos e fica em R$ 262,68 na faixa de 29 a 33 anos. O <strong style="color:#123A2D;">Unipart Max</strong>, que tem rede maior e opção de apartamento, parte de R$ 224,50 na mesma tabela.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #DCE6E0;border-left:3px solid #12795A;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#12795A;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que pesa no valor final</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#123A2D;">Idade de cada vida:</strong> o preço é por faixa etária, não um valor único por pessoa.<br><strong style="color:#123A2D;">Acomodação:</strong> enfermaria ou apartamento.<br><strong style="color:#123A2D;">Coparticipação:</strong> consulta em consultório R$ 35,00, exame básico R$ 5,90, só paga quem usa.<br><strong style="color:#123A2D;">Internação:</strong> sem coparticipação, exceto psiquiátrica a partir do 31º dia.</p></td></tr></table>
<p style="{{P}}">No site você monta a composição da equipe e vê a faixa de preço na hora, sem falar com ninguém. Com a lista de idades em mãos eu fecho o valor exato da proposta no mesmo dia.</p>
<p style="{{PF}}">Me mande só as idades da equipe da <strong style="color:#123A2D;">[NOME_EMPRESA]</strong>, sem nomes, que eu monto a conta. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 4;

update email_trilha_etapas set
  assunto    = 'Quando renova o plano de vocês?',
  tagline    = 'Último contato',
  titulo     = 'Se não for agora,<br>me diga quando é',
  cta_texto  = 'Avisar o mês da renovação',
  cta_link   = 'https://wa.me/5515997402635',
  corpo_html = '<p style="{{P}}">Este é o último e-mail desta sequência, então vou ser curto.</p>
<p style="{{P}}">Plano de saúde empresarial quase nunca se decide no dia em que alguém oferece. Decide-se quando o contrato atual vence, quando o reajuste chega ou quando um funcionário importante pede.</p>
<p style="{{P}}">Se a <strong style="color:#123A2D;">[NOME_EMPRESA]</strong> já tem plano, me diga só o mês da renovação. Eu anoto e volto a falar com você trinta dias antes, com a comparação pronta. Se ainda não tem, o contrato da Unimed Sorocaba pode começar no dia 1, 10 ou 20 do mês, então dá para planejar com calma.</p>
<p style="{{PF}}">Qualquer dúvida sobre rede, carência ou documentos, é só responder este e-mail. Sou o Fábio, da F&amp;G.</p>'
where trilha = 'saude-pme' and ordem = 5;
