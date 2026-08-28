-- 029 — Recado da corretora que exige retorno da imobiliária
--
-- O campo observacao_imobiliaria (022) é um recado de mão única: aparece no
-- portal do parceiro, mas ninguém é avisado de que ele existe. Quando o recado
-- é uma pergunta ("qual a data de início do contrato?"), o corretor precisa de
-- uma resposta — e a imobiliária só vê se entrar no portal por acaso.
--
-- Estes dois campos resolvem isso:
--   recado_precisa_retorno — marca o recado como pergunta aberta. O portal
--                            destaca em laranja e o hub dispara o e-mail.
--   recado_enviado_em      — quando o e-mail saiu. Evita reenviar o mesmo
--                            recado a cada salvamento do cadastro.

alter table imobiliaria_clientes
  add column if not exists recado_precisa_retorno boolean not null default false,
  add column if not exists recado_enviado_em      timestamptz;

comment on column imobiliaria_clientes.recado_precisa_retorno is
  'Recado em observacao_imobiliaria aguarda resposta da imobiliária.';
comment on column imobiliaria_clientes.recado_enviado_em is
  'Quando o e-mail de aviso do recado foi enviado ao parceiro.';
