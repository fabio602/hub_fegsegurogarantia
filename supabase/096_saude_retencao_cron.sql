-- 096_saude_retencao_cron.sql
--
-- Agenda a limpeza dos documentos de contratacao que passaram da retencao.
--
-- A pagina de contratacao promete ao cliente, no texto de consentimento, que
-- os arquivos sao apagados 90 dias depois da vigencia. Sem este cron a
-- promessa depende de alguem lembrar, e ninguem lembra.
--
-- Roda de madrugada porque nao compete com nada e nao tem pressa. Segue o
-- mesmo molde dos outros jobs do projeto: url e chave saem do vault.

select cron.unschedule('saude-retencao-daily')
where exists (select 1 from cron.job where jobname = 'saude-retencao-daily');

select cron.schedule(
  'saude-retencao-daily',
  '20 6 * * *',                      -- 6h20 UTC, cerca de 3h20 em Sao Paulo
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/saude-retencao',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
