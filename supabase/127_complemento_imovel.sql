-- 127: complemento do endereço do imóvel (ex.: "ap 12", "bloco B").
--
-- O portal da imobiliária pedia CEP, endereço e número, mas não o complemento,
-- e a apólice de apartamento precisa dele. Campo opcional (casa não tem).
-- Vai nas duas esteiras: imobiliaria_clientes (o portal grava direto) e
-- residential_clients (espelho criado pela function imobiliaria-nova-cotacao,
-- usado no Registro de Vendas). Só acrescenta colunas; nada existente muda.

alter table public.imobiliaria_clientes add column if not exists complemento_imovel text;
alter table public.residential_clients  add column if not exists complemento_imovel text;

comment on column public.imobiliaria_clientes.complemento_imovel is 'Complemento do endereço do imóvel (apto, bloco, casa), informado no portal da imobiliária.';
comment on column public.residential_clients.complemento_imovel  is 'Complemento do endereço do imóvel (apto, bloco, casa).';
