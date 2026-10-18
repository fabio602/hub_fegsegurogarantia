-- 116_prospect_roteiros.sql
-- Roteiros de abordagem (WhatsApp, e-mail e ligação) por grupo de lead do Kanban.
-- Aditiva: não altera nem apaga dados existentes.

begin;

-- 1. prospect_toques passa a aceitar ligação
alter table public.prospect_toques drop constraint prospect_toques_canal_check;
alter table public.prospect_toques add constraint prospect_toques_canal_check
  check (canal = any (array['whatsapp'::text, 'email'::text, 'ligacao'::text]));

-- 2. tabela de roteiros
create table if not exists public.prospect_roteiros (
  id uuid primary key default gen_random_uuid(),
  grupo text not null check (grupo in ('energia', 'imobiliarias', 'consultores')),
  canal text not null check (canal in ('whatsapp', 'email', 'ligacao')),
  etapa smallint not null check (etapa between 1 and 3),
  variacao text not null default 'A' check (variacao in ('A', 'B')),
  assunto text,
  corpo text not null,
  ativo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (grupo, canal, etapa, variacao)
);

alter table public.prospect_roteiros enable row level security;

grant select, insert, update, delete on table public.prospect_roteiros to authenticated;
grant select, insert, update, delete on table public.prospect_roteiros to service_role;

drop policy if exists authenticated_prospect_roteiros_all on public.prospect_roteiros;
create policy authenticated_prospect_roteiros_all on public.prospect_roteiros
  for all to authenticated using (true) with check (true);

-- 3. textos iniciais (os mesmos do guia de abordagem da Bruna)
insert into public.prospect_roteiros (grupo, canal, etapa, variacao, assunto, corpo) values
  ('energia', 'whatsapp', 1, 'A', null,
   $t$Olá, {nome}, tudo bem? Meu nome é {remetente} e falo da F&G Seguro Garantia, corretora especializada só em seguro garantia. Entro em contato porque a {empresa} aparece como agente na CCEE, e no mercado livre os contratos de compra de energia costumam exigir uma garantia. Quando o contrato aceita, essa garantia pode ser feita por seguro, sem usar o limite de crédito da empresa no banco. Vocês têm algum contrato com garantia hoje, ou alguma renovação prevista?$t$),
  ('energia', 'whatsapp', 1, 'B', null,
   $t$Olá, {nome}! Aqui é {remetente}, da F&G Seguro Garantia, uma corretora de Boituva/SP que trabalha exclusivamente com seguro garantia, com mais de 25 seguradoras parceiras. Uma das garantias que fazemos é a do contrato de compra de energia: quando o contrato permite, ela substitui a fiança bancária ou a caução. Posso te explicar em dois minutos como funciona para a {empresa}?$t$),
  ('energia', 'whatsapp', 2, 'A', null,
   $t$Olá, {nome}! Retomando minha mensagem sobre a garantia dos contratos de energia da {empresa}. Se esse assunto for com outra pessoa, consegue me indicar quem cuida? Agradeço!$t$),
  ('energia', 'whatsapp', 3, 'A', null,
   $t$Olá, {nome}. Esta é minha última mensagem, para não incomodar. Quando a {empresa} tiver um contrato de energia para garantir ou renovar, é só me chamar aqui. Nosso site é fegsegurogarantia.com.br.$t$),
  ('energia', 'ligacao', 1, 'A', null,
   $t$NA RECEPÇÃO
"Bom dia! Meu nome é {remetente}, falo da F&G Seguro Garantia. Eu poderia falar com {nome_ou_responsavel}? É sobre a garantia dos contratos de energia da empresa."

Se perguntarem do que se trata: "Somos uma corretora especializada em seguro garantia. Quero apresentar uma alternativa para a garantia que os contratos de compra de energia costumam pedir. São dois minutinhos."

Se a pessoa não estiver: "Sem problema. Você consegue me passar o e-mail dela, ou de quem cuida dos contratos de energia? Eu mando uma apresentação curta."

COM A PESSOA CERTA
"Agradeço por atender, {nome}, vou ser breve. Meu nome é {remetente} e sou da F&G Seguro Garantia, uma corretora de Boituva, no interior de São Paulo, que trabalha só com seguro garantia, com mais de 25 seguradoras parceiras. Uma das garantias que fazemos é a do contrato de compra de energia, que muitas empresas ainda fazem por fiança bancária ou caução. Quando o contrato aceita seguro garantia, ele substitui essas opções sem usar o limite de crédito da empresa no banco. Hoje vocês têm algum contrato de energia com garantia, ou alguma renovação chegando?"

Tem contrato ou renovação: "Para fazer uma cotação, precisamos do valor e do prazo da garantia, e se possível do contrato ou da minuta. Qual o melhor e-mail para eu mandar a apresentação?" Anotar o e-mail no card e avisar o Fábio.
Já usa seguro garantia: "Perfeito. Se quiser comparar condições na próxima renovação, cotamos com as seguradoras parceiras. Qual o melhor e-mail?"
Sem interesse: "Tudo bem, agradeço o seu tempo. Posso deixar nosso contato para quando surgir uma renovação?"$t$),
  ('energia', 'email', 1, 'A', $t$Garantia do contrato de energia da {empresa}$t$,
   $t$Olá, {nome}!

Conforme conversamos, segue uma apresentação rápida da F&G Seguro Garantia. Somos uma corretora especializada exclusivamente em seguro garantia, em todas as modalidades, com mais de 25 seguradoras parceiras.

No contrato de compra de energia, quando ele aceita essa forma de garantia, o seguro garantia substitui a fiança bancária ou a caução. A diferença principal é que ele não usa o limite de crédito da empresa no banco e não prende dinheiro em caixa.

Para cotar, precisamos de três informações: o contrato ou a minuta, o valor e o prazo da garantia exigida, e o CNPJ da {empresa}. Com isso levamos a operação às seguradoras e voltamos com a proposta.

Fico à disposição.

{remetente}
F&G Seguro Garantia
fegsegurogarantia.com.br · (15) 99861-8659$t$),
  ('imobiliarias', 'whatsapp', 1, 'A', null,
   $t$Olá, tudo bem? Falo com a {empresa}? Meu nome é {remetente} e sou da F&G Seguro Garantia, corretora especializada em garantias. Vocês trabalham com locação em {cidade}? Pergunto porque atendemos imobiliárias com seguro fiança locatícia, para fechar contratos sem fiador e sem caução, com Tokio Marine, Porto e Pottencial.$t$),
  ('imobiliarias', 'whatsapp', 1, 'B', null,
   $t$Olá! Aqui é {remetente}, da F&G Seguro Garantia. Somos uma corretora especializada em garantias e atendemos imobiliárias com seguro fiança locatícia. Trabalhamos com mais de uma seguradora justamente para aprovar perfis de inquilino que uma só recusaria. A {empresa} administra locações? Se sim, gostaria de apresentar como funciona em poucos minutos.$t$),
  ('imobiliarias', 'whatsapp', 2, 'A', null,
   $t$Olá! Retomando minha mensagem sobre seguro fiança locatícia. Se quem cuida das locações na {empresa} for outra pessoa, consegue me passar o contato? Agradeço!$t$),
  ('imobiliarias', 'whatsapp', 3, 'A', null,
   $t$Olá! Esta é minha última mensagem, para não incomodar. Se em alguma locação o fiador travar o fechamento, é só me chamar aqui. Nosso site é fegsegurogarantia.com.br.$t$),
  ('imobiliarias', 'ligacao', 1, 'A', null,
   $t$NA RECEPÇÃO
"Bom dia! Meu nome é {remetente}, falo da F&G Seguro Garantia. Eu poderia falar com quem cuida das locações?"

COM A PESSOA CERTA
"Somos uma corretora especializada em garantias e atendemos imobiliárias com seguro fiança locatícia, que substitui o fiador e a caução, com Tokio Marine, Porto e Pottencial. Hoje vocês usam fiador, caução ou já trabalham com seguro fiança?"

Usam fiador ou caução: "Posso mandar uma apresentação curta? Qual o melhor WhatsApp ou e-mail?"
Já usam seguro fiança: "Ótimo, então vocês já conhecem. Como trabalhamos com mais de uma seguradora, quando um inquilino for recusado podemos tentar em outra. Posso deixar nosso contato?"
Não trabalham com locação: agradecer, anotar no card e encerrar.$t$),
  ('imobiliarias', 'email', 1, 'A', $t$Seguro fiança locatícia para a {empresa}$t$,
   $t$Olá, {nome}!

Conforme conversamos, segue uma apresentação rápida da F&G Seguro Garantia. Somos uma corretora especializada em garantias e atendemos imobiliárias com seguro fiança locatícia, com Tokio Marine, Porto e Pottencial.

O seguro fiança substitui o fiador e a caução. Para a imobiliária, o contrato fecha mais rápido; para o proprietário, em caso de inadimplência quem paga é a seguradora, dentro das condições da apólice.

Para simular uma locação, precisamos do valor do aluguel e dos encargos, do tipo de imóvel (residencial ou comercial) e do CPF ou CNPJ do pretendente.

Fico à disposição.

{remetente}
F&G Seguro Garantia
fegsegurogarantia.com.br · (15) 99861-8659$t$),
  ('consultores', 'whatsapp', 1, 'A', null,
   $t$Olá, tudo bem? Meu nome é {remetente} e sou da F&G Seguro Garantia, corretora especializada só em seguro garantia, em todas as modalidades, com mais de 25 seguradoras parceiras. Falo com assessorias de licitação porque muito cliente vence o pregão e trava na garantia por não ter limite aprovado na seguradora. Nós fazemos essa análise de limite antes da disputa. A {empresa} atende clientes que participam de licitações com exigência de garantia?$t$),
  ('consultores', 'whatsapp', 1, 'B', null,
   $t$Olá! Aqui é {remetente}, da F&G Seguro Garantia. Trabalhamos exclusivamente com seguro garantia, da garantia de proposta à de execução, e queremos ser parceiros de assessorias de licitação na parte da garantia dos clientes. Posso te apresentar como funciona em poucos minutos?$t$),
  ('consultores', 'whatsapp', 2, 'A', null,
   $t$Olá! Retomando minha mensagem sobre parceria em seguro garantia. Se a {empresa} tiver algum cliente com edital aberto pedindo garantia, pode me mandar que analisamos o limite dele.$t$),
  ('consultores', 'whatsapp', 3, 'A', null,
   $t$Olá! Esta é minha última mensagem, para não incomodar. No dia em que um cliente seu vencer e precisar da garantia, é só me chamar aqui. Nosso site é fegsegurogarantia.com.br.$t$),
  ('consultores', 'ligacao', 1, 'A', null,
   $t$NA RECEPÇÃO
"Bom dia! Meu nome é {remetente}, falo da F&G Seguro Garantia. Eu poderia falar com o responsável pela assessoria de licitações?"

COM A PESSOA CERTA
"Somos uma corretora especializada só em seguro garantia, com mais de 25 seguradoras parceiras. Buscamos parceria com assessorias de licitação: analisamos o limite do cliente na seguradora antes do pregão, para a garantia não travar depois que ele vence. Vocês atendem clientes com edital pedindo garantia?"

Sim: "Posso mandar uma apresentação curta? Qual o melhor WhatsApp ou e-mail?" Anotar no card e avisar o Fábio.
Já têm corretora: "Entendo. Se em algum caso a seguradora recusar ou o prazo apertar, podemos ajudar com outras seguradoras. Posso deixar nosso contato?"$t$),
  ('consultores', 'email', 1, 'A', $t$Parceria em seguro garantia para os clientes da {empresa}$t$,
   $t$Olá, {nome}!

Conforme conversamos, segue uma apresentação rápida da F&G Seguro Garantia. Somos uma corretora especializada exclusivamente em seguro garantia, em todas as modalidades, com mais de 25 seguradoras parceiras.

Para assessorias de licitação, a parceria funciona assim: você nos indica o cliente com edital aberto, analisamos o limite dele na seguradora antes do pregão e cuidamos da garantia de proposta e da de execução.

Se tiver um edital agora, pode nos mandar que fazemos a análise.

Fico à disposição.

{remetente}
F&G Seguro Garantia
fegsegurogarantia.com.br · (15) 99861-8659$t$)
on conflict (grupo, canal, etapa, variacao) do nothing;

commit;

-- Conferência depois de rodar (esperado: 18 linhas, 6 por grupo):
-- select grupo, canal, etapa, variacao from public.prospect_roteiros order by 1,2,3,4;
