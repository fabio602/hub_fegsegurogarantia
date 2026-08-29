-- ============================================================================
-- 033: Prospeccao automatica PNCP
--
-- Todo dia as 07h (BRT) uma Edge Function (prospeccao-pncp) coleta os contratos
-- publicados no PNCP no dia anterior, enriquece os CNPJs vencedores na
-- BrasilAPI, filtra por valor e por CNAE, e insere os aprovados no Kanban
-- (prospects, coluna "Novos Leads") e na trilha de e-mail existente
-- (email_cadencia + prospecting-cadence). Nada de template novo: a trilha
-- 'garantia' que ja funciona hoje e reaproveitada por inteiro.
--
-- Esta migracao cria a configuracao, os logs, o cache de CNPJs consultados,
-- a lista de bloqueio de e-mails e o bucket do relatorio diario.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Configuracao (linha unica). Tudo que o Fabio pode querer ajustar sem deploy.
-- ----------------------------------------------------------------------------
create table if not exists public.prospeccao_pncp_config (
  id integer primary key default 1 check (id = 1),

  -- Liga/desliga geral da automacao.
  ativo boolean not null default true,

  -- Modo de teste: faz a coleta, o enriquecimento, os filtros e o relatorio,
  -- mas NAO insere no Kanban, NAO entra na trilha e NAO envia e-mail a leads.
  -- O relatorio diario continua chegando, para validar a lista antes de ligar.
  dry_run boolean not null default true,

  -- Pausa automatica por reputacao (taxa de bounce). Setada pelo webhook do
  -- Resend; a automacao nao roda enquanto pausado = true.
  pausado boolean not null default false,
  pausado_motivo text,
  pausado_em timestamptz,

  -- Filtros da coleta. ufs vazio significa todas as UFs.
  ufs text[] not null default '{}',
  valor_minimo numeric not null default 200000,

  -- Dispensas e inexigibilidades so passam acima deste valor (nelas raramente
  -- ha exigencia de garantia contratual quando o valor e baixo).
  dispensa_inexig_valor_minimo numeric not null default 500000,

  -- Filtro de perfil por divisao CNAE (2 primeiros digitos do codigo).
  -- Passa quem tem alguma divisao (principal ou secundaria) na lista de
  -- inclusao e cuja divisao principal nao esta na lista de exclusao.
  cnae_divisoes_incluir text[] not null
    default '{41,42,43,71,77,78,79,80,81,82,62,49,52,46,47}',
  cnae_divisoes_excluir text[] not null
    default '{86,85,56,64,65,66}',

  -- Limites da fase de teste.
  limite_diario integer not null default 30,
  max_consultas_brasilapi integer not null default 400,
  pausa_entre_consultas_ms integer not null default 1500,

  -- Protecao de reputacao: pausa quando os bounces do dia atingem
  -- max(bounce_min_quantidade, bounce_max_percentual% dos envios).
  bounce_max_percentual numeric not null default 5,
  bounce_min_quantidade integer not null default 2,

  -- Trilha de e-mail usada para os leads novos (email_trilhas.slug).
  trilha text not null default 'garantia',

  -- Quem recebe o relatorio diario e os avisos de pausa.
  email_relatorio text not null default 'fabio@fegsegurogarantia.com.br',

  updated_at timestamptz not null default now()
);

comment on table public.prospeccao_pncp_config is
  'Configuracao (linha unica) da prospeccao automatica PNCP. Editavel na tela Prospeccao Automatica do Hub.';

insert into public.prospeccao_pncp_config (id) values (1)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Lista de bloqueio de e-mails. Nunca reenviar para quem esta aqui.
-- Alimentada pelo webhook do Resend (bounce permanente e reclamacao de spam).
-- ----------------------------------------------------------------------------
create table if not exists public.email_blocklist (
  email text primary key,
  motivo text not null,
  origem text not null default 'bounce'
    check (origem in ('bounce', 'spam', 'manual')),
  criado_em timestamptz not null default now()
);

comment on table public.email_blocklist is
  'E-mails que nunca devem receber prospeccao. Bounce permanente, reclamacao de spam ou bloqueio manual.';

-- ----------------------------------------------------------------------------
-- Cache das consultas a BrasilAPI. Um CNPJ consultado nunca e consultado de
-- novo: se nao tinha e-mail, e pulado nos dias seguintes; se tinha, os dados
-- sao reutilizados sem gastar a cota da API.
-- ----------------------------------------------------------------------------
create table if not exists public.prospeccao_pncp_cnpj_cache (
  cnpj text primary key,
  consultado_em timestamptz not null default now(),
  tem_email boolean not null default false,
  razao_social text,
  nome_fantasia text,
  email text,
  telefone text,
  cidade text,
  uf text,
  cnae_principal text,
  cnae_descricao text,
  cnae_divisao text,
  cnaes_secundarios jsonb,
  socio text,
  situacao text
);

comment on table public.prospeccao_pncp_cnpj_cache is
  'Resultado de cada consulta de CNPJ na BrasilAPI. Evita reconsultar o mesmo CNPJ em execucoes seguintes.';

-- ----------------------------------------------------------------------------
-- Log de execucoes: uma linha por rodada da automacao.
-- ----------------------------------------------------------------------------
create table if not exists public.prospeccao_pncp_execucoes (
  id uuid primary key default gen_random_uuid(),
  executado_em timestamptz not null default now(),
  -- Dia dos contratos coletados (o dia anterior a execucao).
  data_referencia date not null,
  dry_run boolean not null default false,
  coletados integer not null default 0,
  enriquecidos integer not null default 0,
  enviados integer not null default 0,
  sem_email integer not null default 0,
  fora_do_perfil integer not null default 0,
  bounces integer not null default 0,
  erros integer not null default 0,
  -- Caminho do XLSX no bucket prospeccao-pncp.
  arquivo_relatorio text,
  -- Detalhes livres: tempo de execucao, motivo de parada, erros.
  detalhes jsonb
);

create index if not exists idx_prospeccao_pncp_execucoes_data
  on public.prospeccao_pncp_execucoes (executado_em desc);

comment on table public.prospeccao_pncp_execucoes is
  'Uma linha por execucao da prospeccao automatica PNCP.';

-- ----------------------------------------------------------------------------
-- Leads avaliados: uma linha por empresa que passou pelo funil em cada
-- execucao, com o resultado. E a fonte do relatorio XLSX e do rastreio de
-- bounce/clique via webhook do Resend.
-- ----------------------------------------------------------------------------
create table if not exists public.prospeccao_pncp_leads (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid references public.prospeccao_pncp_execucoes (id) on delete cascade,
  criado_em timestamptz not null default now(),

  cnpj text not null,
  razao_social text,
  nome_fantasia text,
  email text,
  telefone text,
  cidade text,
  uf text,
  cnae_principal text,
  cnae_descricao text,
  cnae_divisao text,

  -- Dados da licitacao vencida.
  orgao text,
  objeto text,
  valor numeric,
  numero_licitacao text,

  -- enviado: entrou no Kanban e na trilha.
  -- sem_email: BrasilAPI sem e-mail ou e-mail com formato invalido.
  -- fora_do_perfil: passou no valor mas nao no CNAE (aba propria no XLSX).
  -- dry_run: seria enviado, mas a automacao estava em modo de teste.
  resultado text not null
    check (resultado in ('enviado', 'sem_email', 'fora_do_perfil', 'dry_run')),
  motivo text,

  enviado_em timestamptz,
  -- Atualizado pelo webhook do Resend: delivered, bounced_permanent,
  -- bounced_transient, complained, delivery_delayed, clicked.
  resend_status text,

  prospect_id uuid,
  contato_id uuid
);

create index if not exists idx_prospeccao_pncp_leads_execucao
  on public.prospeccao_pncp_leads (execucao_id);
create index if not exists idx_prospeccao_pncp_leads_cnpj
  on public.prospeccao_pncp_leads (cnpj);
create index if not exists idx_prospeccao_pncp_leads_email
  on public.prospeccao_pncp_leads (email);

comment on table public.prospeccao_pncp_leads is
  'Empresas avaliadas pela prospeccao automatica PNCP, com o resultado de cada uma. Alimenta o relatorio diario.';

-- ----------------------------------------------------------------------------
-- Vinculo da cadencia com o Kanban e rastreio de bounce.
-- ----------------------------------------------------------------------------
alter table public.email_cadencia
  add column if not exists prospect_id uuid,
  add column if not exists bounce_status text,
  add column if not exists bounce_motivo text,
  add column if not exists bounce_em timestamptz;

comment on column public.email_cadencia.prospect_id is
  'Lead do Kanban (prospects.id) ligado a este contato da cadencia, quando houver.';
comment on column public.email_cadencia.bounce_status is
  'Preenchido pelo webhook do Resend: bounced_permanent, complained, delivery_delayed ou clicked.';

-- ----------------------------------------------------------------------------
-- Dados da licitacao e do CNAE no proprio lead do Kanban.
-- ----------------------------------------------------------------------------
alter table public.prospects
  add column if not exists cnae_principal text,
  add column if not exists cnae_divisao text,
  add column if not exists orgao_licitante text,
  add column if not exists objeto_contrato text,
  add column if not exists valor_contrato numeric,
  add column if not exists numero_licitacao text;

comment on column public.prospects.cnae_principal is
  'CNAE principal (codigo) vindo da BrasilAPI, para leads da prospeccao PNCP.';
comment on column public.prospects.cnae_divisao is
  'Divisao do CNAE principal (2 primeiros digitos), para analise de perfil.';

-- ----------------------------------------------------------------------------
-- RLS: mesmas politicas do restante do Hub (usuario autenticado ve tudo).
-- As Edge Functions usam a service role e nao passam por RLS.
-- ----------------------------------------------------------------------------
alter table public.prospeccao_pncp_config enable row level security;
alter table public.email_blocklist enable row level security;
alter table public.prospeccao_pncp_cnpj_cache enable row level security;
alter table public.prospeccao_pncp_execucoes enable row level security;
alter table public.prospeccao_pncp_leads enable row level security;

drop policy if exists "authenticated_prospeccao_pncp_config_all" on public.prospeccao_pncp_config;
create policy "authenticated_prospeccao_pncp_config_all"
  on public.prospeccao_pncp_config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_email_blocklist_all" on public.email_blocklist;
create policy "authenticated_email_blocklist_all"
  on public.email_blocklist for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_prospeccao_pncp_cnpj_cache_all" on public.prospeccao_pncp_cnpj_cache;
create policy "authenticated_prospeccao_pncp_cnpj_cache_all"
  on public.prospeccao_pncp_cnpj_cache for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_prospeccao_pncp_execucoes_all" on public.prospeccao_pncp_execucoes;
create policy "authenticated_prospeccao_pncp_execucoes_all"
  on public.prospeccao_pncp_execucoes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_prospeccao_pncp_leads_all" on public.prospeccao_pncp_leads;
create policy "authenticated_prospeccao_pncp_leads_all"
  on public.prospeccao_pncp_leads for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Bucket privado do relatorio diario (AAAA-MM-DD.xlsx).
-- Usuario autenticado pode baixar (via URL assinada gerada no Hub).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('prospeccao-pncp', 'prospeccao-pncp', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_read_prospeccao_pncp" on storage.objects;
create policy "authenticated_read_prospeccao_pncp"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'prospeccao-pncp');
