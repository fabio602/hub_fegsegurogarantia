-- Tabela de clientes de Seguro AUTO
create table if not exists public.auto_clients (
  id               bigserial primary key,
  nome             text,
  cpf              text,
  telefone         text,
  telefone_2       text,
  email            text,
  -- Veículo
  marca_modelo     text,
  ano_fabricacao   text,
  ano_modelo       text,
  placa            text,
  chassis          text,
  cor              text,
  uso_veiculo      text,   -- particular, comercial, etc.
  -- Apólice
  seguradora       text,
  apolice          text,
  produto          text,
  cobertura        text,   -- básica, intermediária, completa, etc.
  franquia         text,
  premio_total     text,
  comissao         text,
  data_emissao     date,
  fim_vigencia     date,
  forma_pagamento  text,
  situacao         text default 'Ativo',
  obs              text,
  created_at       timestamptz default now()
);

-- RLS
alter table public.auto_clients enable row level security;

create policy "Authenticated users can do everything on auto_clients"
  on public.auto_clients
  for all
  to authenticated
  using (true)
  with check (true);
