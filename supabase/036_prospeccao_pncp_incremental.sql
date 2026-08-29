-- ============================================================================
-- 036: Prospeccao PNCP em lotes incrementais
--
-- Descoberta em producao: neste projeto a Edge Function e encerrada aos 150s
-- (WallClockTime). Com o rate limit das APIs de e-mail (13s a 21s por CNPJ),
-- uma execucao unica nunca fecharia os 30 envios do dia.
--
-- Solucao: o dia vira uma execucao com FILA persistente. O cron dispara a
-- cada 10 minutos entre 07:00 e 11:50 de Brasilia; cada tique processa o
-- lote que couber em ~130s e o ultimo tique gera o relatorio e finaliza.
-- ============================================================================

alter table public.prospeccao_pncp_execucoes
  add column if not exists fase text not null default 'processando'
    check (fase in ('processando', 'finalizada'));

comment on column public.prospeccao_pncp_execucoes.fase is
  'processando = fila do dia ainda tem candidatos; finalizada = relatorio gerado e enviado.';

create table if not exists public.prospeccao_pncp_fila (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references public.prospeccao_pncp_execucoes (id) on delete cascade,
  -- Posicao na fila: 1 e o contrato de maior valor.
  ordem integer not null,
  cnpj text not null,
  -- O contrato inteiro (orgao, objeto, valor, numero...), para o proximo
  -- tique nao precisar coletar o PNCP de novo.
  contrato jsonb not null,
  estado text not null default 'pendente'
    check (estado in ('pendente', 'avaliado', 'descartado')),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_prospeccao_pncp_fila_pendentes
  on public.prospeccao_pncp_fila (execucao_id, estado, ordem);

comment on table public.prospeccao_pncp_fila is
  'Candidatos do dia aguardando enriquecimento. Cada tique do cron consome o que couber em 130s.';

alter table public.prospeccao_pncp_fila enable row level security;

drop policy if exists "authenticated_prospeccao_pncp_fila_all" on public.prospeccao_pncp_fila;
create policy "authenticated_prospeccao_pncp_fila_all"
  on public.prospeccao_pncp_fila for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Reagenda: a cada 10 minutos, das 10:00 as 14:50 UTC (07:00 as 11:50 BRT).
select cron.unschedule('prospeccao-pncp-daily')
where exists (select 1 from cron.job where jobname = 'prospeccao-pncp-daily');

select cron.schedule(
  'prospeccao-pncp-daily',
  '*/10 10-14 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
    || '/functions/v1/prospeccao-pncp',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
