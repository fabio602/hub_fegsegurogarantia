-- Leads originados da prospecção PNCP (Hub) — envio manual a partir da ferramenta PNCP.
create table if not exists public.leads_seguro_garantia (
  id uuid primary key default gen_random_uuid(),
  tipo_lead text not null
    check (tipo_lead in ('Seguro Garantia', 'Judicial', 'Energia', 'Seguro de Crédito')),
  empresa text,
  cnpj text not null,
  telefone text,
  email text,
  site text,
  socio_responsavel text,
  valor_contrato numeric,
  objeto_contrato text,
  orgao_contratante text,
  uf text,
  municipio text,
  data_assinatura text,
  probabilidade_sg text
    check (probabilidade_sg in ('alta', 'media', 'verificar')),
  origem text not null default 'PNCP',
  status text not null default 'novo',
  criado_em timestamptz not null default now()
);

create index if not exists idx_leads_seguro_garantia_cnpj on public.leads_seguro_garantia (cnpj);
create index if not exists idx_leads_seguro_garantia_criado on public.leads_seguro_garantia (criado_em desc);

comment on table public.leads_seguro_garantia is 'Leads capturados via Prospecção PNCP no Hub F&G.';
comment on column public.leads_seguro_garantia.tipo_lead is 'Funil escolhido ao enviar (Seguro Garantia, Judicial, Energia, Seguro de Crédito).';

alter table public.leads_seguro_garantia enable row level security;

drop policy if exists "authenticated_leads_seguro_garantia_all" on public.leads_seguro_garantia;
create policy "authenticated_leads_seguro_garantia_all"
  on public.leads_seguro_garantia
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
