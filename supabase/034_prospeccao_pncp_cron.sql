-- ============================================================================
-- 034: Agendamento da prospeccao automatica PNCP
--
-- Roda todo dia as 07:00 de Brasilia (10:00 UTC), mesmo padrao dos jobs
-- remind-stale-sales-daily e pregao-reminders-daily: pg_cron + pg_net,
-- com URL e anon key lidas do Vault (segredos project_url e anon_key,
-- ja cadastrados).
-- ============================================================================

select cron.unschedule('prospeccao-pncp-daily')
where exists (select 1 from cron.job where jobname = 'prospeccao-pncp-daily');

select cron.schedule(
  'prospeccao-pncp-daily',
  '0 10 * * *',
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
