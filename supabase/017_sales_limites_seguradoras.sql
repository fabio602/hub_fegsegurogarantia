-- JSON dos limites por seguradora na Carteira (`limites_seguradoras` em `sales`).
-- Sem esta coluna o update do dashboard falha e "Outro corretor" / limites não persistem.

alter table public.sales
  add column if not exists limites_seguradoras text;

comment on column public.sales.limites_seguradoras is
  'JSON array: [{ "seguradora": string, "valor": string }], editado na Carteira de Clientes.';
