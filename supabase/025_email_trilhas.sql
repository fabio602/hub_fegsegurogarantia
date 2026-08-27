-- ============================================================================
-- Trilhas de e-mail viram conteúdo de banco, não código.
--
-- Antes: cada modalidade nova exigia editar o check constraint, os assuntos e
-- os 5 templates HTML dentro da Edge Function, e depois rodar um deploy à
-- parte. Com 8 modalidades isso vira 40 HTMLs num arquivo só.
--
-- Agora: a identidade visual da F&G (o "molde" — cabeçalho navy, faixa
-- dourada, assinatura, rodapé) continua no código, em um lugar só. O que muda
-- de e-mail para e-mail — assunto, título, corpo, botão — vira linha de tabela.
-- Criar uma modalidade nova passa a ser preencher um formulário.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A trilha: uma modalidade de seguro e o público dela.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists email_trilhas (
  slug        text primary key,
  nome        text not null,
  descricao   text,
  -- Linha pequena acima do nome da F&G no cabeçalho.
  eyebrow     text not null default 'Corretora Especializada',
  -- Justificativa do contato, no rodapé. Exigido por boa prática de opt-out.
  rodape      text not null default 'Você recebe este e-mail por ter demonstrado interesse em seguro garantia',
  ativo       boolean not null default true,
  ordem       integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table email_trilhas is
  'Cada linha é uma modalidade com cadência própria de prospecção por e-mail.';
comment on column email_trilhas.ativo is
  'Trilha inativa some do seletor mas não interrompe quem já está recebendo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A etapa: um e-mail dentro de uma trilha.
--
-- O corpo aceita dois atalhos, expandidos pela Edge Function na hora do envio:
--   {{P}}  -> estilo de parágrafo comum
--   {{PF}} -> estilo do último parágrafo (respiro maior antes do botão)
-- Assim dá para escrever <p style="{{P}}">texto</p> sem decorar 90 caracteres
-- de CSS. Texto puro, sem nenhuma tag, também funciona: cada linha em branco
-- vira um parágrafo formatado.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists email_trilha_etapas (
  id          uuid primary key default gen_random_uuid(),
  trilha      text not null references email_trilhas(slug) on update cascade on delete cascade,
  -- Posição na sequência: 1 é o primeiro e-mail.
  ordem       integer not null,
  -- Dias após a entrada do contato. D+1, D+3, D+7...
  dia         integer not null,
  assunto     text not null,
  -- Palavra sobre o título, na faixa escura. Ex: "Apresentação", "Comparativo".
  tagline     text,
  -- Aceita <br> para quebrar a linha onde você quiser.
  titulo      text,
  corpo_html  text,
  -- Botão. Nulo esconde o botão, para quando o corpo já tiver o seu próprio.
  cta_texto   text,
  cta_link    text not null default 'https://wa.me/5515998618659',
  -- Escape hatch: HTML completo, ignorando o molde. Normalmente nulo.
  html_completo text,
  ativo       boolean not null default true,
  unique (trilha, ordem)
);

comment on table email_trilha_etapas is
  'Um e-mail de uma trilha. O visual vem do molde na Edge Function; aqui fica só o conteúdo.';
comment on column email_trilha_etapas.html_completo is
  'Use apenas para um e-mail com layout totalmente fora do padrão. Se preenchido, o molde é ignorado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- O check constraint travava as trilhas em dois valores fixos. Vira FK: a lista
-- de trilhas válidas passa a ser a própria tabela.
-- ─────────────────────────────────────────────────────────────────────────────
alter table email_cadencia
  drop constraint if exists email_cadencia_trilha_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- Registro de envios.
--
-- As colunas email_1_sent .. email_5_sent cravam o número 5 no schema: uma
-- trilha com 3 ou 7 e-mails não tem onde ser registrada. Uma linha por envio
-- resolve isso e ainda deixa o histórico legível.
--
-- As colunas antigas continuam existindo e sendo preenchidas em paralelo, para
-- que nada que as leia quebre e para que dê para voltar atrás sem perder nada.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists email_envios (
  id          uuid primary key default gen_random_uuid(),
  contato_id  uuid not null references email_cadencia(id) on delete cascade,
  ordem       integer not null,
  enviado_em  timestamptz not null default now(),
  unique (contato_id, ordem)
);

create index if not exists idx_email_envios_contato on email_envios (contato_id);

comment on table email_envios is
  'Um registro por e-mail efetivamente enviado. Substitui as colunas email_N_sent.';

-- Traz para a tabela nova o que já foi enviado, sem perder as datas.
insert into email_envios (contato_id, ordem, enviado_em)
select id, 1, coalesce(email_1_sent_at, created_at) from email_cadencia where email_1_sent
union all
select id, 2, coalesce(email_2_sent_at, created_at) from email_cadencia where email_2_sent
union all
select id, 3, coalesce(email_3_sent_at, created_at) from email_cadencia where email_3_sent
union all
select id, 4, coalesce(email_4_sent_at, created_at) from email_cadencia where email_4_sent
union all
select id, 5, coalesce(email_5_sent_at, created_at) from email_cadencia where email_5_sent
on conflict (contato_id, ordem) do nothing;

-- ============================================================================
-- SEMENTE — as duas trilhas que já existem, com o conteúdo que já está no ar.
-- ============================================================================

insert into email_trilhas (slug, nome, descricao, eyebrow, rodape, ordem) values
  ('garantia', 'Seguro Garantia — Licitações',
   'Empresas que participam de licitações públicas.',
   'Corretora Especializada',
   'Você recebe este e-mail por atuar em licitações públicas', 1),
  ('energia', 'Garantia de Pagamento de Energia',
   'Comercializadoras, geradoras, traders e consumidores livres do mercado livre (ACL).',
   'Mercado Livre de Energia',
   'Você recebe este e-mail por atuar no mercado livre de energia', 2)
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- TRILHA GARANTIA
-- ─────────────────────────────────────────────────────────────────────────────

insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto) values

('garantia', 1, 1,
 'F&G Seguro Garantia — corretora especializada para quem licita',
 'Apresentação',
 'Corretora especializada<br>para quem licita',
 $html$<p style="{{P}}">Meu nome é Fábio Lima e sou fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>. Vi que a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tem atuação em licitações e queria me apresentar, somos uma corretora 100% focada em Seguro Garantia, e esse é o nosso único mercado.</p>
<p style="{{P}}">Trabalhamos com mais de 12 seguradoras e entendemos o dia a dia de quem vive de licitação: prazos apertados, exigências de edital e a necessidade de uma apólice que realmente esteja em conformidade. É exatamente isso que a gente entrega.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:28px 32px;border-radius:0 4px 4px 0;"><p style="margin:0 0 20px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Nossas Modalidades</p><table width="100%" cellpadding="0" cellspacing="0"><tr><td width="48%" style="padding-bottom:10px;vertical-align:top;"><table cellpadding="0" cellspacing="0"><tr><td style="color:#C69C6D;font-size:10px;padding-right:10px;vertical-align:top;padding-top:4px;">•</td><td style="color:#333;font-size:13px;font-family:Arial,sans-serif;line-height:1.5;">Seguro Garantia Licitante</td></tr></table></td><td width="4%"></td><td width="48%" style="padding-bottom:10px;vertical-align:top;"><table cellpadding="0" cellspacing="0"><tr><td style="color:#C69C6D;font-size:10px;padding-right:10px;vertical-align:top;padding-top:4px;">•</td><td style="color:#333;font-size:13px;font-family:Arial,sans-serif;line-height:1.5;">Seguro Garantia de Contrato</td></tr></table></td></tr><tr><td width="48%" style="padding-bottom:10px;vertical-align:top;"><table cellpadding="0" cellspacing="0"><tr><td style="color:#C69C6D;font-size:10px;padding-right:10px;vertical-align:top;padding-top:4px;">•</td><td style="color:#333;font-size:13px;font-family:Arial,sans-serif;line-height:1.5;">Seguro Garantia Judicial</td></tr></table></td><td width="4%"></td><td width="48%" style="padding-bottom:10px;vertical-align:top;"><table cellpadding="0" cellspacing="0"><tr><td style="color:#C69C6D;font-size:10px;padding-right:10px;vertical-align:top;padding-top:4px;">•</td><td style="color:#333;font-size:13px;font-family:Arial,sans-serif;line-height:1.5;">Seguro Garantia Trabalhista</td></tr></table></td></tr></table></td></tr></table>
<p style="{{PF}}">Posso enviar uma cotação sem compromisso? É só me responder aqui ou me chamar no WhatsApp, estou à disposição.</p>$html$,
 'Falar com o Fábio'),

('garantia', 2, 3,
 'Você venceu a licitação. E agora?',
 'Próximo Passo',
 'Você venceu a licitação.<br>E agora?',
 $html$<p style="{{P}}">Vencer uma licitação é o resultado de muito esforço, e o próximo passo costuma ser o mais burocrático: apresentar o <strong style="color:#1B263B;">Seguro Garantia de Contrato</strong> ao órgão dentro do prazo do edital.</p>
<p style="{{PF}}">A F&amp;G analisa o edital, indica a seguradora certa e emite a apólice com agilidade. Você foca no contrato, a gente cuida da garantia.</p>$html$,
 'Quero uma Cotação'),

('garantia', 3, 7,
 'Como aumentar seu limite para licitar mais?',
 'Estratégia',
 'Como aumentar seu limite<br>para licitar mais?',
 $html$<p style="{{P}}">Quando o limite de capacidade (CCG) trava, a empresa perde o pregão. A F&amp;G trabalha com <strong>mais de 12 seguradoras</strong> para distribuir seu portfólio de forma inteligente.</p>
<p style="{{PF}}">Posso fazer uma análise gratuita da sua situação atual. É rápido e sem compromisso.</p>$html$,
 'Quero Analisar meu CCG'),

('garantia', 4, 14,
 'Sua corretora conhece o processo licitatório?',
 'Diferencial',
 'Sua corretora conhece<br>o processo licitatório?',
 $html$<p style="{{P}}">Trabalhar com Seguro Garantia para licitações vai muito além de emitir uma apólice. A <strong>F&amp;G</strong> nasceu para esse mercado — é nossa única especialidade.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Corretora Genérica</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Pouco conhecimento em editais<br>✕ 1-2 seguradoras<br>✕ Suporte lento</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">F&amp;G Seguro Garantia</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ Especialista em licitações<br>✓ 12+ seguradoras<br>✓ Atendimento ágil</p></td></tr></table>$html$,
 'Vamos Conversar'),

('garantia', 5, 21,
 'Última mensagem — F&G Seguro Garantia',
 'Última Mensagem',
 'A porta da F&amp;G<br>sempre estará aberta',
 $html$<p style="{{P}}">Esta é minha última mensagem. Não vou insistir. Mas quando a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> precisar de Seguro Garantia, a F&amp;G está aqui.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="background-color:#F7F4F0;border:1px solid #E0D8CE;padding:28px;border-radius:4px;text-align:center;"><p style="margin:0 0 8px 0;color:#1B263B;font-size:15px;font-weight:bold;font-family:Georgia,serif;">Quando precisar, estamos aqui.</p><p style="margin:0 0 20px 0;color:#666;font-size:13px;font-family:Arial,sans-serif;">Uma cotação, uma dúvida, uma análise de edital.</p><table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background-color:#1B263B;padding:13px 32px;border-radius:2px;"><a href="https://wa.me/5515998618659" style="color:#C69C6D;font-size:12px;font-weight:bold;text-decoration:none;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">Falar com a F&amp;G</a></td></tr></table></td></tr></table>
<p style="margin:0;color:#AAA;font-size:12px;text-align:center;font-style:italic;font-family:Georgia,serif;">Obrigado pela atenção, [NOME_CONTATO]. Boa sorte nas próximas licitações!</p>$html$,
 null)

on conflict (trilha, ordem) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- TRILHA ENERGIA
-- ─────────────────────────────────────────────────────────────────────────────

insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto) values

('energia', 1, 1,
 'F&G — garantia financeira para contratos de compra e venda de energia',
 'Apresentação',
 'Garantia financeira para<br>contratos de energia',
 $html$<p style="{{P}}">Meu nome é Fábio Lima, sou fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong> — uma corretora que trabalha só com seguro garantia. Vi que a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> atua na compra e venda de energia e queria me apresentar.</p>
<p style="{{P}}">No mercado livre, todo contrato de compra e venda pede garantia financeira. A tradicional é a fiança bancária ou o depósito caução. O <strong style="color:#1B263B;">Seguro Garantia de Pagamento de Energia</strong> faz o mesmo papel: garante ao vendedor que as faturas de energia serão pagas — sem imobilizar o caixa do comprador nem consumir o limite de crédito dele no banco.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Para quem serve</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Comercializadoras e traders de energia<br>• Geradoras que vendem no ACL<br>• Consumidores livres e especiais<br>• Indústrias, redes de varejo e shoppings</p></td></tr></table>
<p style="{{PF}}">Posso montar uma cotação sem compromisso, é só me responder aqui ou chamar no WhatsApp.</p>$html$,
 'Falar com o Fábio'),

('energia', 2, 3,
 'A fiança bancária consome seu limite. O seguro garantia não.',
 'Comparativo',
 'A fiança consome seu limite.<br>O seguro garantia, não.',
 $html$<p style="{{P}}">Quando a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> dá uma fiança bancária como garantia de um contrato de energia, aquele valor sai do limite de crédito no banco. É crédito que deixa de estar disponível para capital de giro, investimento ou uma oportunidade de compra melhor.</p>
<p style="{{P}}">O seguro garantia é emitido por seguradora, não por banco. O limite bancário fica livre.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Fiança / Caução</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Consome limite bancário<br>✕ Costuma exigir reciprocidade<br>✕ Caução imobiliza o caixa<br>✕ Renovação renegociada com o banco</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Seguro Garantia</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ Não consome limite no banco<br>✓ Sem reciprocidade<br>✓ Caixa livre para operar<br>✓ Prêmio diluído no prazo</p></td></tr></table>
<p style="{{PF}}">Se quiser, comparo os dois números no seu caso concreto — me manda o valor e o prazo do contrato que eu te devolvo a conta.</p>$html$,
 'Quero Comparar'),

('energia', 3, 7,
 'Vendeu energia no mercado livre. E se o comprador não pagar?',
 'Para quem vende',
 'Vendeu energia. E se o<br>comprador não pagar?',
 $html$<p style="{{P}}">Do lado de quem vende, a conta é simples: a energia é entregue e a fatura vence depois. Entre a entrega e o pagamento, o risco de inadimplência é todo seu.</p>
<p style="{{P}}">Com o Seguro Garantia de Pagamento de Energia, se o comprador não pagar, a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> aciona a apólice e a seguradora indeniza — depois é ela quem corre atrás do devedor.</p>
<p style="{{P}}">Na prática isso muda a régua de crédito: dá para fechar contrato com contraparte nova, ou aumentar volume com um cliente que já está no limite, sem aumentar a exposição.</p>
<p style="{{PF}}">Quer que eu avalie a exigência de garantia dos seus contratos atuais? Levo uns 15 minutos e não custa nada.</p>$html$,
 'Avaliar meus Contratos'),

('energia', 4, 14,
 'O que a seguradora pede para garantir um contrato de energia',
 'Na prática',
 'O que a seguradora pede<br>para emitir a apólice',
 $html$<p style="{{P}}">A dúvida mais comum que recebo é o que precisa para contratar. É menos burocrático do que parece:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Documentação</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">1. Contrato de compra e venda (ou a minuta)<br>2. Valor e prazo a garantir<br>3. Balanço e demonstrativos recentes<br>4. Cadastro e documentos societários</p></td></tr></table>
<p style="{{P}}">Com isso em mãos eu levo a operação para as seguradoras que trabalham com energia e volto com as propostas comparadas. O prêmio é um percentual ao ano sobre o valor garantido e varia conforme prazo, valor e perfil de crédito da empresa — por isso a cotação é sempre feita caso a caso.</p>
<p style="{{PF}}">Me manda os dados de um contrato e eu te trago os números reais.</p>$html$,
 'Pedir uma Cotação'),

('energia', 5, 21,
 'Última mensagem — F&G Seguro Garantia',
 'Última Mensagem',
 'A porta da F&amp;G<br>sempre estará aberta',
 $html$<p style="{{P}}">Esta é minha última mensagem desta sequência — não vou insistir. Mas quando a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> precisar estruturar a garantia de um contrato de energia, é só chamar.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="background-color:#F7F4F0;border:1px solid #E0D8CE;padding:26px;border-radius:4px;text-align:center;"><p style="margin:0 0 8px 0;color:#1B263B;font-size:15px;font-weight:bold;font-family:Georgia,serif;">Quando precisar, estamos aqui.</p><p style="margin:0;color:#666;font-size:13px;font-family:Arial,sans-serif;">Uma cotação, uma dúvida sobre exigência de garantia, uma segunda opinião num contrato.</p></td></tr></table>
<p style="{{PF}}">Obrigado pela atenção, <strong>[NOME_CONTATO]</strong>. Bons negócios.</p>$html$,
 'Falar com a F&amp;G')

on conflict (trilha, ordem) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Só agora, com as trilhas cadastradas, a FK pode entrar sem quebrar nada.
-- ─────────────────────────────────────────────────────────────────────────────
alter table email_cadencia
  drop constraint if exists email_cadencia_trilha_fkey;

alter table email_cadencia
  add constraint email_cadencia_trilha_fkey
  foreign key (trilha) references email_trilhas(slug) on update cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS no mesmo padrão do resto do hub: quem está logado enxerga e edita.
-- A Edge Function usa a service role e passa por cima disso.
-- ─────────────────────────────────────────────────────────────────────────────
alter table email_trilhas       enable row level security;
alter table email_trilha_etapas enable row level security;
alter table email_envios        enable row level security;

drop policy if exists email_trilhas_auth       on email_trilhas;
drop policy if exists email_trilha_etapas_auth on email_trilha_etapas;
drop policy if exists email_envios_auth        on email_envios;

create policy email_trilhas_auth       on email_trilhas       for all to authenticated using (true) with check (true);
create policy email_trilha_etapas_auth on email_trilha_etapas for all to authenticated using (true) with check (true);
create policy email_envios_auth        on email_envios        for all to authenticated using (true) with check (true);
