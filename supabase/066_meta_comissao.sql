-- 066_meta_comissao.sql
-- Meta de comissão (tela "Meta de Comissão" em Gestão Financeira e a Edge
-- Function weekly-goal-report). Decisões do Fábio em 03/09/2026:
--   * referência: vendas com vendeu = 'Sim', pela `data` da venda;
--   * meta configurável por mês, não fixa no código; meta diária = meta
--     mensal / dias úteis base (20), ritmo e projeção com dias úteis reais;
--   * relatório semanal aos sábados 8h, só para o Fábio;
--   * vendeu_at passa a ser gravado por trigger para medir conversão.

-- Meta por mês. Mês sem registro herda o último anterior.
create table if not exists public.metas_comissao (
  mes date primary key,                    -- sempre dia 1
  meta_mensal numeric(12,2) not null,
  dias_uteis_base integer not null default 20,
  atualizado_em timestamptz not null default now(),
  constraint metas_comissao_mes_dia1 check (extract(day from mes) = 1)
);
alter table public.metas_comissao enable row level security;
drop policy if exists "metas_comissao_autenticados" on public.metas_comissao;
create policy "metas_comissao_autenticados" on public.metas_comissao
  for all to authenticated using (true) with check (true);
insert into public.metas_comissao (mes, meta_mensal, dias_uteis_base)
  values ('2026-09-01', 20000, 20)
  on conflict (mes) do nothing;

-- Configurações soltas do hub, em JSON, para não criar uma tabela por chave.
create table if not exists public.hub_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.hub_config enable row level security;
drop policy if exists "hub_config_autenticados" on public.hub_config;
create policy "hub_config_autenticados" on public.hub_config
  for all to authenticated using (true) with check (true);
insert into public.hub_config (chave, valor)
  values ('relatorio_meta_destinatarios', '["fabio@fegsegurogarantia.com.br"]'::jsonb)
  on conflict (chave) do nothing;

-- Registro de envio por semana, para reenvio manual não duplicar.
-- Quem escreve é a function, com a service role; o hub só lê.
create table if not exists public.relatorio_meta_envios (
  semana_inicio date primary key,
  enviado_em timestamptz not null default now(),
  destinatarios text[] not null,
  comissao_semana numeric(12,2),
  comissao_mes numeric(12,2)
);
alter table public.relatorio_meta_envios enable row level security;
drop policy if exists "relatorio_meta_envios_leitura" on public.relatorio_meta_envios;
create policy "relatorio_meta_envios_leitura" on public.relatorio_meta_envios
  for select to authenticated using (true);

-- vendeu_at existia e nunca era gravado (0 de 100 vendas). A partir daqui
-- marca o momento em que o status vira 'Sim'. Não mexe no histórico.
create or replace function public.sales_marca_vendeu_at() returns trigger
language plpgsql as $$
begin
  if new.vendeu = 'Sim' and (tg_op = 'INSERT' or old.vendeu is distinct from 'Sim') then
    new.vendeu_at = coalesce(new.vendeu_at, now());
  end if;
  return new;
end $$;
drop trigger if exists trg_sales_vendeu_at on public.sales;
create trigger trg_sales_vendeu_at
  before insert or update of vendeu on public.sales
  for each row execute function public.sales_marca_vendeu_at();
