-- 095_saude_documentos.sql
--
-- Envio de documentos da contratacao do plano de saude, feito pelo proprio
-- cliente no site. Decidido com o Fabio em 20/09/2026.
--
-- A venda NAO fecha sozinha: pelo processo da Favorita quem emite a proposta
-- e o corretor, o cliente tem 72h para aceitar e cada beneficiario maior de
-- 18 anos passa por entrevista medica por videochamada. O que o site faz e
-- tudo ate a proposta: o cliente escolhe, declara as pessoas e manda os
-- documentos, e o Fabio so emite.
--
-- A declaracao de saude NAO passa por aqui. A operadora manda direto para
-- cada beneficiario por e-mail e WhatsApp. Entao nenhum dado de saude encosta
-- neste bucket, e isso e de proposito: nao criar aqui um lugar com dado
-- sensivel que nao precisa existir.
--
-- Regra que nao pode ser afrouxada: sem endpoint aberto. O upload passa pela
-- Edge Function saude-documentos, que valida token, validade, tipo e tamanho.
-- O bucket e privado e o Fabio abre cada arquivo por URL assinada curta.

-- ---------------------------------------------------------------------------
-- Envio: um por lead, com token na URL que o cliente recebe.
-- ---------------------------------------------------------------------------
create table if not exists public.saude_envios (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.unimed_leads(id) on delete cascade,

  -- 48 caracteres hex, 24 bytes de entropia. Vai na URL, entao hex e nao
  -- base64: nada de +, / ou = para escapar.
  token             text not null unique default encode(gen_random_bytes(24), 'hex'),

  criado_em         timestamptz not null default now(),
  expira_em         timestamptz not null default now() + interval '30 days',
  concluido_em      timestamptz,

  -- Dados que o cliente preenche na pagina, antes dos arquivos.
  empresa_razao     text,
  empresa_cnpj      text,

  -- Pessoas declaradas pelo cliente. Cada item vira um bloco de documentos:
  --   {"id":"p1","nome":"...","papel":"responsavel|titular|dependente",
  --    "parentesco":"conjuge|filho|...","titular_de":"...",
  --    "nascimento":"1986-04-12","cpf":"...","cns":"...",
  --    "email":"...","telefone":"..."}
  -- O papel decide quais slots sao exigidos; a regra vive na Edge Function
  -- para nao ficar duplicada entre banco, site e HUB.
  pessoas           jsonb not null default '[]'::jsonb,

  -- Registro do aceite, para a LGPD. IP so do aceite, nada de rastrear.
  consentimento_em  timestamptz,
  consentimento_ip  text,

  observacao        text
);

comment on table public.saude_envios is
  'Um link de envio de documentos por lead de saude. Token na URL; sem login.';
comment on column public.saude_envios.pessoas is
  'Pessoas declaradas pelo cliente. O papel de cada uma define os documentos exigidos.';

create index if not exists saude_envios_lead_idx on public.saude_envios (lead_id);

-- ---------------------------------------------------------------------------
-- Documento: um arquivo por pessoa por slot. Reenviar substitui.
-- ---------------------------------------------------------------------------
create table if not exists public.saude_documentos (
  id            uuid primary key default gen_random_uuid(),
  envio_id      uuid not null references public.saude_envios(id) on delete cascade,
  pessoa_id     text not null,
  slot          text not null,
  caminho       text not null,
  arquivo_nome  text not null,
  mime          text not null,
  bytes         integer not null check (bytes > 0),
  enviado_em    timestamptz not null default now(),
  unique (envio_id, pessoa_id, slot)
);

comment on table public.saude_documentos is
  'Arquivo enviado pelo cliente. O binario fica no bucket privado saude-documentos.';

create index if not exists saude_documentos_envio_idx on public.saude_documentos (envio_id);

-- ---------------------------------------------------------------------------
-- RLS. Mesmo padrao das outras tabelas do HUB: authenticated ve tudo.
-- O cliente nao tem sessao; quem escreve por ele e a Edge Function, com
-- service role, que ignora RLS.
-- ---------------------------------------------------------------------------
alter table public.saude_envios     enable row level security;
alter table public.saude_documentos enable row level security;

drop policy if exists saude_envios_auth on public.saude_envios;
create policy saude_envios_auth on public.saude_envios
  for all to authenticated using (true) with check (true);

drop policy if exists saude_documentos_auth on public.saude_documentos;
create policy saude_documentos_auth on public.saude_documentos
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Bucket privado. Espelha o cliente-documentos, que ja e privado, e NAO o
-- imobiliaria-docs, que estava publico.
-- 15 MB cobre foto de celular sem obrigar o cliente a redimensionar.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'saude-documentos', 'saude-documentos', false, 15728640,
  array['application/pdf', 'image/jpeg', 'image/png',
        'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Leitura so para quem tem sessao no HUB, e mesmo assim por URL assinada.
drop policy if exists saude_documentos_ler on storage.objects;
create policy saude_documentos_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'saude-documentos');

-- ---------------------------------------------------------------------------
-- Retencao: 90 dias depois de o plano entrar em vigor, decidido em
-- 20/09/2026. Margem para pendencia, correcao ou recusa da operadora. O
-- Fabio e intermediario, nao arquivo morto.
--
-- Envio abandonado tambem sai: 90 dias depois de vencer o link.
--
-- A view lista o que apagar; quem apaga de fato e a Edge Function
-- saude-retencao, porque remover o binario exige a API de storage (o Supabase
-- bloqueia delete direto em storage.objects).
-- ---------------------------------------------------------------------------
create or replace view public.saude_envios_para_apagar as
select e.id,
       e.lead_id,
       e.token,
       case
         when l.implantado_em is not null then 'implantado ha mais de 90 dias'
         else 'link vencido ha mais de 90 dias'
       end as motivo
from public.saude_envios e
join public.unimed_leads l on l.id = e.lead_id
where (l.implantado_em is not null and l.implantado_em < current_date - 90)
   or (l.implantado_em is null and e.expira_em < now() - interval '90 days');

comment on view public.saude_envios_para_apagar is
  'Envios cujos arquivos ja passaram da retencao de 90 dias. Consumida pela Edge Function saude-retencao.';
