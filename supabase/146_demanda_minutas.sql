-- 146: devolução da minuta ao parceiro para validação.
--
-- A demanda que o parceiro envia pelo portal entra na `sales` (migração 129).
-- Até aqui o caminho era só de ida: a minuta voltava por e-mail ou WhatsApp.
-- Agora a F&G anexa a minuta na ficha da demanda, o parceiro é avisado por
-- e-mail, abre a minuta no portal e responde "Aprovar" ou "Pedir ajuste".
--
-- Cada envio da minuta é uma linha (uma rodada):
--   aguardando         enviada pela F&G, esperando o parceiro
--   aprovada           o parceiro aprovou
--   ajuste_solicitado  o parceiro pediu ajuste (texto em resposta_parceiro)
--   substituida        a F&G mandou versão nova antes de o parceiro responder
--
-- O histórico de idas e vindas é a própria lista de linhas da venda, em ordem
-- de versão. Só pode haver uma rodada "aguardando" por venda.
--
-- Quem grava é sempre Edge Function com service role:
--   demanda-minuta   (HUB, só e-mail @fegsegurogarantia.com.br) envia a minuta
--   parceiro-portal  (portal, token do parceiro) registra a resposta
-- O HUB (authenticated) só lê a tabela. O arquivo a equipe sobe direto no
-- bucket privado demanda-minutas; o parceiro abre por link assinado gerado
-- pela function, que confere que a venda é dele.
--
-- Tabela nova depois de 30/10/2026: os grants vão aqui (ver CLAUDE.md).

-- 1 ---------------------------------------------------------------------------
create table if not exists public.demanda_minutas (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id) on delete cascade,
  partner_id integer not null references public.partners(id),
  versao integer not null check (versao >= 1),

  arquivo_path text not null,
  arquivo_nome text not null,
  arquivo_tamanho integer,
  observacao_fg text,
  enviada_por text not null,
  enviada_em timestamptz not null default now(),

  status text not null default 'aguardando'
    check (status in ('aguardando', 'aprovada', 'ajuste_solicitado', 'substituida')),
  resposta_parceiro text,
  respondida_em timestamptz,

  unique (sale_id, versao)
);

create unique index if not exists demanda_minutas_uma_aguardando
  on public.demanda_minutas (sale_id) where status = 'aguardando';
create index if not exists demanda_minutas_partner_idx
  on public.demanda_minutas (partner_id, status);

comment on table public.demanda_minutas is
  'Rodadas de validação da minuta com o parceiro do portal. Uma linha por envio da F&G; a resposta do parceiro fica na mesma linha. Grava só por Edge Function (demanda-minuta e parceiro-portal).';

alter table public.demanda_minutas enable row level security;

grant select on table public.demanda_minutas to authenticated;
grant select, insert, update, delete on table public.demanda_minutas to service_role;
grant usage, select on sequence public.demanda_minutas_id_seq to service_role;

-- Os privilégios padrão do projeto ainda dão tudo para anon e authenticated em
-- tabela nova. A RLS já barraria, mas aqui fica só o que precisa.
revoke all on table public.demanda_minutas from anon;
revoke insert, update, delete, truncate, references, trigger on table public.demanda_minutas from authenticated;
revoke all on sequence public.demanda_minutas_id_seq from anon, authenticated;

drop policy if exists "demanda_minutas_hub_le" on public.demanda_minutas;
create policy "demanda_minutas_hub_le" on public.demanda_minutas
  for select to authenticated
  using (true);

-- 2 ---------------------------------------------------------------------------
-- Bucket privado das minutas. A equipe logada sobe e lê; ninguém apaga nem
-- sobrescreve pela tela (versão nova é arquivo novo). O parceiro não tem
-- acesso ao bucket: recebe link assinado pela Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'demanda-minutas', 'demanda-minutas', false, 31457280,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

drop policy if exists "demanda_minutas_ler_hub" on storage.objects;
create policy "demanda_minutas_ler_hub" on storage.objects
  for select to authenticated
  using (bucket_id = 'demanda-minutas');

drop policy if exists "demanda_minutas_subir_hub" on storage.objects;
create policy "demanda_minutas_subir_hub" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'demanda-minutas');
