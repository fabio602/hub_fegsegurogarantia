-- ============================================================================
-- Documentos do cliente guardados junto do card da Carteira.
--
-- Problema que resolve: contrato social, balancetes, DRE e certidões viviam em
-- pastas do computador. Na hora de cotar, o tempo ia embora procurando arquivo.
--
-- A amarração é pelo CNPJ, não pelo card: a mesma empresa aparece em mais de um
-- card quando a razão social foi digitada diferente ("LTDA" e "LTDA EPP"), e
-- anexar duas vezes o mesmo balancete não faz sentido. Guardamos o CNPJ só com
-- os dígitos, para 31.132.978/0001-30 e 31132978000130 caírem no mesmo lugar.
-- Cliente sem CNPJ cai no nome, que é o que sobra para identificá-lo.
-- ============================================================================

create table if not exists cliente_documentos (
  id            uuid primary key default gen_random_uuid(),
  -- Só dígitos. Vazio quando o cliente não tem CNPJ cadastrado.
  cnpj_digitos  text not null default '',
  -- Guardado sempre: serve de chave quando não há CNPJ e ajuda a reconhecer o
  -- documento se o cadastro for corrigido depois.
  cliente_nome  text not null,
  tipo          text not null default 'Outros',
  -- Ano de referência do balancete ou da DRE. Nulo no que não tem ano, como o
  -- contrato social.
  ano           integer,
  descricao     text,
  arquivo_url   text not null,
  arquivo_nome  text,
  created_at    timestamptz not null default now()
);

comment on table cliente_documentos is
  'Documentos do cliente (contrato social, balancete, DRE) mostrados no card da Carteira. Arquivo no bucket cliente-documentos.';
comment on column cliente_documentos.arquivo_url is
  'Caminho dentro do bucket cliente-documentos, não link público. O download usa URL assinada.';

create index if not exists cliente_documentos_cnpj_idx on cliente_documentos (cnpj_digitos);
create index if not exists cliente_documentos_nome_idx on cliente_documentos (lower(cliente_nome));

-- ─────────────────────────────────────────────────────────────────────────────
-- Acesso: documento de cliente é dado sensível, então só quem está logado no
-- hub enxerga. Diferente dos formulários em branco, aqui não existe link
-- público: o download passa por URL assinada, que expira.
-- ─────────────────────────────────────────────────────────────────────────────
alter table cliente_documentos enable row level security;

drop policy if exists cliente_documentos_auth on cliente_documentos;
create policy cliente_documentos_auth on cliente_documentos
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('cliente-documentos', 'cliente-documentos', false)
on conflict (id) do update set public = false;

drop policy if exists cliente_documentos_arquivos on storage.objects;
create policy cliente_documentos_arquivos on storage.objects
  for all to authenticated
  using (bucket_id = 'cliente-documentos')
  with check (bucket_id = 'cliente-documentos');
