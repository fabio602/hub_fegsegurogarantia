-- 129: portal do parceiro, demandas enviadas pelo portal e comissão escalonada.
--
-- 1) partners.comissao_faixas: regra de comissão escalonada do contrato de
--    parceria. Quando preenchida, vale no lugar do commission_pct fixo.
--    A faixa é escolhida pela comissão LÍQUIDA do negócio (comissão da F&G
--    menos imposto_pct) e o percentual incide sobre a comissão INTEGRAL do
--    negócio, nunca sobre o prêmio. Tabela passada pelo Fábio em 04/11/2026,
--    imposto de 6% (reserva do DAS), aplicada a Solicita, Raphael e Maximus.
--    O cálculo fica em supabase/functions/_shared/comissaoParceiro.ts, usado
--    pela Edge Function do portal e pelo HUB.
--
-- 2) sales.anexos_demanda: edital ou contrato que o parceiro anexou ao enviar
--    a demanda pelo portal. Lista de { path, nome, tamanho, tipo } no bucket
--    privado parceiro-demandas. O HUB abre por link assinado.
--
-- 3) parceiro_portal_segredo: chave que assina o token de sessão do portal.
--    Só a service role lê (RLS ligada, sem policy, sem grant para anon nem
--    authenticated). Trocar a chave derruba todas as sessões abertas.
--
-- 4) Bucket privado parceiro-demandas. O parceiro sobe o arquivo por URL de
--    upload assinada gerada pela Edge Function, então não precisa de policy de
--    insert. O HUB (authenticated) só lê.
--
-- 5) Corrige o nome do parceiro nas 4 vendas da Maximus gravadas como
--    "Maximusb2gov": o cadastro é "Maximus 2 Gov" e o portal casa pelo nome,
--    então essas vendas não apareciam para ele.

-- 1 ---------------------------------------------------------------------------
alter table public.partners add column if not exists comissao_faixas jsonb;

comment on column public.partners.comissao_faixas is
  'Comissão escalonada do parceiro. Formato: {"imposto_pct":6,"faixas":[{"ate":10000,"pct":10},...,{"ate":null,"pct":50}]}. A faixa usa a comissão líquida do negócio (comissão menos imposto_pct); o pct incide sobre a comissão integral. Nulo = usa commission_pct fixo.';

update public.partners
   set comissao_faixas = '{"imposto_pct":6,"faixas":[{"ate":10000,"pct":10},{"ate":30000,"pct":20},{"ate":50000,"pct":30},{"ate":80000,"pct":40},{"ate":null,"pct":50}]}'::jsonb
 where name in ('Solicita Licitações', 'Raphael Icaro Licitações', 'Maximus 2 Gov', 'Joao Victor Teste');

-- 2 ---------------------------------------------------------------------------
alter table public.sales add column if not exists anexos_demanda jsonb;

comment on column public.sales.anexos_demanda is
  'Arquivos (edital ou contrato) enviados pelo parceiro no portal: [{path, nome, tamanho, tipo}] no bucket privado parceiro-demandas.';

-- 3 ---------------------------------------------------------------------------
create table if not exists public.parceiro_portal_segredo (
  id int primary key default 1 check (id = 1),
  token_secret text not null,
  criado_em timestamptz not null default now()
);

alter table public.parceiro_portal_segredo enable row level security;

grant select on table public.parceiro_portal_segredo to service_role;

insert into public.parceiro_portal_segredo (id, token_secret)
values (1, encode(extensions.gen_random_bytes(48), 'hex'))
on conflict (id) do nothing;

-- 4 ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parceiro-demandas', 'parceiro-demandas', false, 31457280,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
on conflict (id) do nothing;

create policy "parceiro_demandas_ler_hub" on storage.objects
  for select to authenticated
  using (bucket_id = 'parceiro-demandas');

-- 5 ---------------------------------------------------------------------------
update public.sales set parceiro = 'Maximus 2 Gov' where parceiro = 'Maximusb2gov';
