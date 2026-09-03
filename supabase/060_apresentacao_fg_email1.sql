-- 060_apresentacao_fg_email1.sql
-- Deixa claro no e-mail 1 de quatro trilhas que a F&G é uma corretora
-- especialista em seguro garantia (pedido do Fábio em 03/09/2026). As
-- trilhas garantia e energia já diziam isso e ficam como estão. A linha
-- "Corretora especialista em Seguro Garantia" da assinatura entrou no molde
-- da Edge Function prospecting-cadence, no mesmo commit.
--
-- As trocas são cirúrgicas, via replace() no trecho exato, para não
-- reescrever o resto do corpo.

-- locaticia: apresentação passa a dizer o que a F&G é.
update email_trilha_etapas
set corpo_html = replace(
  corpo_html,
  'Sou o Fábio, da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>. Atendo',
  'Sou o Fábio, da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>, corretora especialista em seguro garantia e seguro fiança locatícia. Atendo'
)
where trilha = 'locaticia' and ordem = 1;

-- risco-engenharia: some o "Olá [NOME_CONTATO]," que duplicava o cumprimento
-- do molde (mesmo ajuste feito na trilha judicial) e a apresentação ganha
-- o "corretora especialista".
update email_trilha_etapas
set corpo_html = replace(
  corpo_html,
  '<p style="{{P}}">Olá [NOME_CONTATO], meu nome é Fábio Lima, sou fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>.</p>',
  '<p style="{{P}}">Meu nome é Fábio Lima, fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>, corretora especialista em seguro garantia.</p>'
)
where trilha = 'risco-engenharia' and ordem = 1;

-- judicial: o fechamento apresenta a F&G antes de falar das 25 seguradoras.
update email_trilha_etapas
set corpo_html = replace(
  corpo_html,
  'A F&amp;G trabalha com mais de 25 seguradoras',
  'A F&amp;G é uma corretora especialista em seguro garantia e trabalha com mais de 25 seguradoras'
)
where trilha = 'judicial' and ordem = 1;

-- consultores: não havia nenhuma menção à F&G. Entra um parágrafo de
-- apresentação antes do assunto da garantia de proposta.
update email_trilha_etapas
set corpo_html = '<p style="{{P}}">Sou o Fábio, da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>, corretora especialista em seguro garantia, e queria me apresentar como parceira para os seus clientes.</p>
' || corpo_html
where trilha = 'consultores' and ordem = 1
  and corpo_html not like '%corretora especialista em seguro garantia%';
