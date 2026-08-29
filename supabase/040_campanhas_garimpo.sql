-- ============================================================================
-- 040: Motor de campanhas de garimpo (Google Maps via Apify)
--
-- Campanha e dado, nao codigo: cada linha de campanhas_garimpo define termos
-- de busca, cidades, exclusoes, trilha de e-mail, limite diario e cadencia.
-- A Edge Function `garimpo` e unica e processa as campanhas em rodizio, por
-- tiques (mesma restricao de 150s da funcao do PNCP).
--
-- Fluxo por campanha:
--   garimpo (Apify compass/crawler-google-places, US$ 1,50 por 1.000 lugares)
--     -> garimpo_estoque (estoque persistente, dedup por place_id/telefone/email)
--     -> enriquecimento (site: e-mail + CNPJ; BrasilAPI: CNAE e socio)
--     -> envio diario (limite da campanha) na trilha da campanha
--     -> relatorio XLSX em garimpo/<slug>/AAAA-MM-DD.xlsx + e-mail
--
-- Sem e-mail mas com telefone: vai para a coluna "Contato por WhatsApp" do
-- Kanban e para a aba "So WhatsApp" do relatorio (a Bruna trabalha manual).
-- "Sem e-mail valido" fica reservado para bounce.
--
-- A pausa por reputacao passa a ser GLOBAL por dominio remetente
-- (reputacao_envio): bounces de todas as automacoes somados (PNCP + campanhas).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Campanhas
-- ----------------------------------------------------------------------------
create table if not exists public.campanhas_garimpo (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  ativo boolean not null default true,
  dry_run boolean not null default true,

  -- 'maps' e a unica fonte implementada; 'instagram' fica preparado para o futuro.
  fonte text not null default 'maps' check (fonte in ('maps', 'instagram')),

  termos_busca text[] not null default '{}',
  cidades text[] not null default '{}',
  -- Palavra simples exclui quando aparece no nome/categoria/site.
  -- "X sem mencao a Y" exclui quando contem X e NAO contem Y.
  palavras_exclusao text[] not null default '{}',

  trilha text not null references email_trilhas (slug),
  tipo_prospect text not null default 'Seguro Garantia',
  limite_diario integer not null default 10,
  -- A cada quantos dias o garimpo revisita a lista de cidades.
  cadencia_garimpo_dias integer not null default 7,
  -- Exige CNPJ identificado no site (ex.: exclui corretor autonomo sem CNPJ).
  exigir_cnpj boolean not null default false,

  -- Estado do garimpo incremental.
  garimpo_cursor integer not null default 0,          -- proxima cidade da lista
  garimpo_ciclo_iniciado timestamptz,                 -- inicio da varredura atual
  apify_run_id text,                                  -- run em andamento no Apify
  apify_dataset_id text,
  apify_cidade text,                                  -- cidade do run em andamento
  ultimo_tique timestamptz,                           -- rodizio entre campanhas

  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.campanhas_garimpo is
  'Cada linha e uma campanha de garimpo (Google Maps via Apify). O motor (Edge Function garimpo) e unico.';

-- ----------------------------------------------------------------------------
-- Estoque persistente por campanha
-- ----------------------------------------------------------------------------
create table if not exists public.garimpo_estoque (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_garimpo (id) on delete cascade,
  place_id text not null,
  nome text not null,
  categoria text,
  endereco text,
  cidade text,
  uf text,
  telefone text,
  site text,
  email text,
  tipo_email text,
  cnpj text,
  razao_social text,
  socio text,
  cnae_descricao text,
  avaliacoes integer,
  nota numeric,

  -- novo: garimpado, aguardando enriquecimento
  -- enriquecido: com e-mail valido, aguardando envio
  -- enviado: entrou no Kanban e na trilha
  -- so_whatsapp: sem e-mail mas com telefone; Kanban "Contato por WhatsApp"
  -- descartado: exclusao, sem canal, sem CNPJ (quando exigido), duplicado
  -- bounce: e-mail enviado voltou (setado pelo webhook do Resend)
  estado text not null default 'novo'
    check (estado in ('novo', 'enriquecido', 'enviado', 'so_whatsapp', 'descartado', 'bounce')),
  motivo text,

  -- Carimbo do dia em que o item foi trabalhado, para o relatorio diario.
  -- Em dry run o estado nao muda (o envio real continua possivel depois);
  -- so o ultimo_resultado marca 'dry_run'.
  ultima_execucao_id uuid,
  ultimo_resultado text,

  enviado_em timestamptz,
  prospect_id uuid,
  contato_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (campanha_id, place_id)
);

create index if not exists idx_garimpo_estoque_campanha_estado
  on public.garimpo_estoque (campanha_id, estado);
create index if not exists idx_garimpo_estoque_execucao
  on public.garimpo_estoque (ultima_execucao_id);
create index if not exists idx_garimpo_estoque_email
  on public.garimpo_estoque (email);

comment on table public.garimpo_estoque is
  'Estoque de lugares garimpados por campanha. O envio diario consome daqui, priorizando e-mail direto, site proprio e mais avaliacoes.';

-- ----------------------------------------------------------------------------
-- Execucoes (uma por campanha por dia)
-- ----------------------------------------------------------------------------
create table if not exists public.garimpo_execucoes (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_garimpo (id) on delete cascade,
  data_referencia date not null,
  executado_em timestamptz not null default now(),
  dry_run boolean not null default false,
  fase text not null default 'processando'
    check (fase in ('processando', 'finalizada')),
  garimpados integer not null default 0,
  enriquecidos integer not null default 0,
  enviados integer not null default 0,
  so_whatsapp integer not null default 0,
  descartados integer not null default 0,
  bounces integer not null default 0,
  erros integer not null default 0,
  arquivo_relatorio text,
  detalhes jsonb
);

create index if not exists idx_garimpo_execucoes_campanha
  on public.garimpo_execucoes (campanha_id, executado_em desc);

comment on table public.garimpo_execucoes is
  'Uma linha por campanha por dia. O relatorio XLSX do dia sai daqui.';

-- ----------------------------------------------------------------------------
-- Reputacao global por dominio remetente
-- ----------------------------------------------------------------------------
create table if not exists public.reputacao_envio (
  dominio text primary key,
  pausado boolean not null default false,
  pausado_motivo text,
  pausado_em timestamptz,
  bounce_max_percentual numeric not null default 5,
  bounce_min_quantidade integer not null default 2,
  updated_at timestamptz not null default now()
);

comment on table public.reputacao_envio is
  'Pausa global por dominio remetente: bounces de TODAS as automacoes (PNCP + campanhas) somados no dia. Pausado aqui, tudo para.';

insert into public.reputacao_envio (dominio) values ('fegsegurogarantia.com.br')
on conflict (dominio) do nothing;

-- ----------------------------------------------------------------------------
-- Personalizacao por cidade e site nos e-mails da trilha
-- ----------------------------------------------------------------------------
alter table public.email_cadencia
  add column if not exists cidade text,
  add column if not exists site text;

comment on column public.email_cadencia.cidade is
  'Cidade do lead; a Edge Function prospecting-cadence substitui [CIDADE] nos templates.';
comment on column public.email_cadencia.site is
  'Site do lead; a Edge Function prospecting-cadence substitui [SITE] nos templates.';

-- ----------------------------------------------------------------------------
-- As trilhas das duas campanhas entram em atividade (o conteudo ja existe;
-- Fabio revisa os textos na tela Trilhas de E-mail antes de tirar do dry run).
-- ----------------------------------------------------------------------------
update email_trilhas set ativo = true where slug in ('consultores', 'locaticia');

-- ----------------------------------------------------------------------------
-- Seed das duas campanhas
-- ----------------------------------------------------------------------------
insert into public.campanhas_garimpo
  (slug, nome, termos_busca, cidades, palavras_exclusao, trilha, tipo_prospect, limite_diario, exigir_cnpj)
values
  ('consultores',
   'Consultores de licitação',
   array['consultoria em licitações', 'assessoria em licitações', 'consultor de licitação', 'assessoria para licitações públicas'],
   array[
     -- 27 capitais
     'São Paulo, SP', 'Rio de Janeiro, RJ', 'Brasília, DF', 'Salvador, BA', 'Fortaleza, CE',
     'Belo Horizonte, MG', 'Manaus, AM', 'Curitiba, PR', 'Recife, PE', 'Goiânia, GO',
     'Belém, PA', 'Porto Alegre, RS', 'São Luís, MA', 'Maceió, AL', 'Campo Grande, MS',
     'Natal, RN', 'Teresina, PI', 'João Pessoa, PB', 'Aracaju, SE', 'Cuiabá, MT',
     'Porto Velho, RO', 'Macapá, AP', 'Florianópolis, SC', 'Boa Vista, RR', 'Rio Branco, AC',
     'Vitória, ES', 'Palmas, TO',
     -- 50 maiores nao-capitais por populacao
     'Guarulhos, SP', 'Campinas, SP', 'São Gonçalo, RJ', 'São Bernardo do Campo, SP', 'Nova Iguaçu, RJ',
     'Santo André, SP', 'Osasco, SP', 'Duque de Caxias, RJ', 'Sorocaba, SP', 'Ribeirão Preto, SP',
     'Uberlândia, MG', 'Contagem, MG', 'Feira de Santana, BA', 'Joinville, SC', 'Juiz de Fora, MG',
     'Londrina, PR', 'Aparecida de Goiânia, GO', 'Niterói, RJ', 'Ananindeua, PA', 'Campos dos Goytacazes, RJ',
     'Serra, ES', 'Vila Velha, ES', 'Caxias do Sul, RS', 'São José dos Campos, SP', 'Mauá, SP',
     'Santos, SP', 'Mogi das Cruzes, SP', 'Betim, MG', 'Diadema, SP', 'Jundiaí, SP',
     'Piracicaba, SP', 'Cariacica, ES', 'Bauru, SP', 'Montes Claros, MG', 'Canoas, RS',
     'Maringá, PR', 'Anápolis, GO', 'São Vicente, SP', 'Caruaru, PE', 'Itaquaquecetuba, SP',
     'Franca, SP', 'Ponta Grossa, PR', 'Blumenau, SC', 'Vitória da Conquista, BA', 'Paulista, PE',
     'Petrolina, PE', 'Uberaba, MG', 'Cascavel, PR', 'Praia Grande, SP', 'Guarujá, SP'
   ],
   array['treinamento', 'curso', 'software', 'advocacia sem menção a licitação', 'contabilidade sem menção a licitação', 'órgão público', 'prefeitura', 'câmara municipal'],
   'consultores',
   'Seguro Garantia',
   10,
   false),
  ('imobiliarias',
   'Imobiliárias',
   array['imobiliária', 'administradora de imóveis', 'locação de imóveis'],
   array[
     'Sorocaba, SP', 'Votorantim, SP', 'Itu, SP', 'Salto, SP', 'Indaiatuba, SP',
     'Boituva, SP', 'Tatuí, SP', 'Itapetininga, SP', 'São Roque, SP',
     'Campinas, SP', 'Valinhos, SP', 'Vinhedo, SP', 'Jundiaí, SP', 'Louveira, SP',
     'Americana, SP', 'Santa Bárbara d''Oeste, SP', 'Piracicaba, SP', 'Limeira, SP',
     'Rio Claro, SP', 'Sumaré, SP', 'Hortolândia, SP', 'Paulínia, SP'
   ],
   array['construtora', 'incorporadora', 'corretor autônomo', 'cartório'],
   'locaticia',
   'Garantia Locatícia',
   5,
   true)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.campanhas_garimpo enable row level security;
alter table public.garimpo_estoque enable row level security;
alter table public.garimpo_execucoes enable row level security;
alter table public.reputacao_envio enable row level security;

drop policy if exists "authenticated_campanhas_garimpo_all" on public.campanhas_garimpo;
create policy "authenticated_campanhas_garimpo_all"
  on public.campanhas_garimpo for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_garimpo_estoque_all" on public.garimpo_estoque;
create policy "authenticated_garimpo_estoque_all"
  on public.garimpo_estoque for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_garimpo_execucoes_all" on public.garimpo_execucoes;
create policy "authenticated_garimpo_execucoes_all"
  on public.garimpo_execucoes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_reputacao_envio_all" on public.reputacao_envio;
create policy "authenticated_reputacao_envio_all"
  on public.reputacao_envio for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Bucket unico com pasta por campanha: garimpo/<slug>/AAAA-MM-DD.xlsx
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('garimpo', 'garimpo', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_read_garimpo" on storage.objects;
create policy "authenticated_read_garimpo"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'garimpo');

-- ----------------------------------------------------------------------------
-- Cron: tiques a cada 10 min, deslocados 5 min dos tiques do PNCP,
-- das 11:05 as 14:55 UTC (08:05 as 11:55 BRT).
-- ----------------------------------------------------------------------------
select cron.unschedule('garimpo-daily')
where exists (select 1 from cron.job where jobname = 'garimpo-daily');

select cron.schedule(
  'garimpo-daily',
  '5-55/10 11-14 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
    || '/functions/v1/garimpo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
