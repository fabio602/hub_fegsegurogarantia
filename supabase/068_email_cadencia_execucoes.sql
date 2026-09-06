-- ============================================================================
-- 068: registro de execucao do cron das trilhas de e-mail
--
-- A prospecting-cadence contava enviados e erros em variaveis locais que
-- morriam na resposta HTTP, e o cron descarta a resposta. Uma rodada com 40
-- falhas do Resend era indistinguivel de uma rodada perfeita. Agora cada
-- rodada do modo cron grava uma linha aqui, inclusive quando aborta.
-- ============================================================================

create table if not exists public.email_cadencia_execucoes (
  id uuid primary key default gen_random_uuid(),
  executado_em timestamptz not null default now(),
  contatos_elegiveis integer not null default 0,
  enviados integer not null default 0,
  erros integer not null default 0,
  -- E-mail saiu pelo Resend mas a gravacao em email_envios falhou (o Fabio
  -- recebe um aviso por e-mail no mesmo instante).
  sem_registro integer not null default 0,
  abortada boolean not null default false,
  detalhes jsonb
);

create index if not exists idx_email_cadencia_execucoes_data
  on public.email_cadencia_execucoes (executado_em desc);

comment on table public.email_cadencia_execucoes is
  'Uma linha por rodada do cron da prospecting-cadence: elegiveis, enviados, erros do Resend, envios sem registro e abortos.';

alter table public.email_cadencia_execucoes enable row level security;

drop policy if exists "authenticated_email_cadencia_execucoes_read" on public.email_cadencia_execucoes;
create policy "authenticated_email_cadencia_execucoes_read"
  on public.email_cadencia_execucoes for select
  using (auth.role() = 'authenticated');
-- Escrita so pela Edge Function (service role, que ignora RLS).
