-- 131: cotações de Seguro Garantia Licitante feitas pelo portal do parceiro
-- direto na API da Junto Seguros.
--
-- Cada tentativa do parceiro vira uma linha:
--   cotada              a Junto devolveu prêmio e comissão
--   recusada            a Junto não cotou (tomador sem cadastro, ligado a outro
--                       corretor, sem limite, órgão sem cadastro...). O parceiro
--                       manda a demanda manual para a F&G com os mesmos dados.
--   emissao_solicitada  o parceiro pediu a emissão; a minuta já foi gerada e a
--                       cotação entrou no Registro de Vendas (sale_id)
--   em_analise          a Junto segurou a emissão para análise
--   emitida             a F&G aprovou no HUB e a Junto emitiu
--   cancelada           a F&G desistiu da emissão
--
-- O portal nunca recebe o id da cotação na Junto: ele fala com o id desta
-- tabela, e a Edge Function confere que a linha é do parceiro do token.
-- A emissão é irreversível e só sai pelo HUB, com aprovação da F&G.
--
-- Tabela nova depois de 30/10/2026: os grants vão aqui (ver CLAUDE.md).
-- O HUB (authenticated) só lê; quem grava é a Edge Function com service role.

create table if not exists public.cotacoes_portal (
  id bigint generated always as identity primary key,
  partner_id integer not null references public.partners(id),
  seguradora text not null default 'Junto Seguros',
  cotacao_externa_id bigint,
  status text not null default 'cotada'
    check (status in ('cotada', 'recusada', 'emissao_solicitada', 'em_analise', 'emitida', 'cancelada')),
  motivo_recusa text,
  erro text,

  tomador_cnpj text not null,
  tomador_nome text,
  segurado_cnpj text not null,
  segurado_nome text,
  segurado_id bigint,
  segurado_endereco_id bigint,

  valor_garantia numeric(14, 2) not null,
  inicio_vigencia date not null,
  dias integer not null,

  premio numeric(14, 2),
  comissao_fg numeric(14, 2),
  comissao_parceiro numeric(14, 2),
  comissao_parceiro_pct numeric(5, 2),
  resposta jsonb,

  edital text,
  minuta_url text,
  minuta_pendencias boolean,
  sale_id bigint references public.sales(id) on delete set null,
  numero_apolice text,
  emitida_em timestamptz,
  emitida_por text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cotacoes_portal_partner_idx on public.cotacoes_portal (partner_id, created_at desc);
create index if not exists cotacoes_portal_sale_idx on public.cotacoes_portal (sale_id);

comment on table public.cotacoes_portal is
  'Cotações de Licitante feitas pelo portal do parceiro na API da Junto. Grava pela Edge Function parceiro-portal (service role); emissão só pelo HUB com aprovação da F&G.';

alter table public.cotacoes_portal enable row level security;

grant select on table public.cotacoes_portal to authenticated;
grant select, insert, update, delete on table public.cotacoes_portal to service_role;
grant usage, select on sequence public.cotacoes_portal_id_seq to service_role;

-- Os privilégios padrão do projeto ainda dão tudo para anon e authenticated em
-- tabela nova. A RLS já barraria, mas aqui fica só o que precisa.
revoke all on table public.cotacoes_portal from anon;
revoke insert, update, delete, truncate, references, trigger on table public.cotacoes_portal from authenticated;
revoke all on sequence public.cotacoes_portal_id_seq from anon, authenticated;

create policy "cotacoes_portal_hub_le" on public.cotacoes_portal
  for select to authenticated
  using (true);
