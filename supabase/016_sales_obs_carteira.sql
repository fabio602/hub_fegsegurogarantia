-- Observações da carteira (ResultsDashboard): update em `sales.obs` por cliente.
-- Rode no Supabase: SQL Editor ou `supabase db push` / migrações locais.

alter table public.sales
  add column if not exists obs text;

comment on column public.sales.obs is
  'Observações internas exibidas/editadas na Carteira de Clientes (dashboard).';
