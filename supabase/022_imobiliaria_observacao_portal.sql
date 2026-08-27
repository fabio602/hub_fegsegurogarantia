-- Observação escrita pelo hub e visível para a imobiliária no portal.
-- Separada de "observacoes", que é anotação interna e não pode vazar.
alter table imobiliaria_clientes
  add column if not exists observacao_imobiliaria text;

comment on column imobiliaria_clientes.observacao_imobiliaria is
  'Recado da corretora para a imobiliária. Aparece no portal do parceiro.';
