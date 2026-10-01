-- 102: endereço do imóvel (rua, bairro, cidade/UF), preenchido pela busca de CEP
-- no portal da imobiliária e no Registro de Vendas. Só acrescenta colunas;
-- nenhum dado existente muda. Aplicada no projeto real em 01/10/2026.
alter table public.imobiliaria_clientes add column if not exists endereco_imovel text;
alter table public.residential_clients add column if not exists endereco_imovel text;
comment on column public.imobiliaria_clientes.endereco_imovel is 'Rua, bairro e cidade/UF do imóvel, vindos da busca de CEP (editável).';
comment on column public.residential_clients.endereco_imovel is 'Rua, bairro e cidade/UF do imóvel, vindos da busca de CEP (editável).';
