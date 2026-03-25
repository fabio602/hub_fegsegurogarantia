-- Campos do formulário público (antes só em `obs`): colunas próprias para edição no painel.
-- Rode no SQL Editor do Supabase após fazer backup se necessário.

alter table public.residential_clients
  add column if not exists telefone_2 text,
  add column if not exists estado_civil text,
  add column if not exists cep_imovel text,
  add column if not exists numero_imovel text,
  add column if not exists tipo_imovel text,
  add column if not exists valor_imovel text,
  add column if not exists valor_aluguel text,
  add column if not exists data_primeiro_pag_aluguel text,
  add column if not exists valor_iptu_condominio text;

comment on column public.residential_clients.telefone_2 is 'Telefone/celular 2 (formulário público)';
comment on column public.residential_clients.estado_civil is 'Estado civil (formulário público)';
comment on column public.residential_clients.cep_imovel is 'CEP do imóvel (formulário público)';
