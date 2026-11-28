-- 148: agenda o lembrete de repasse em atraso para a imobiliária (28/11/2026).
--
-- Todo dia às 8h10 de Brasília (11:10 UTC; o Brasil não tem mais horário de
-- verão). A Edge Function imobiliaria-repasse-atraso só envia quando há parcela
-- vencida sem comprovante, e repete o lembrete da mesma parcela a cada 7 dias,
-- não todo dia. Fica 10 minutos depois do aviso de "10 dias" (11:00 UTC).
--
-- RODAR SÓ DEPOIS de publicar a function imobiliaria-repasse-atraso: antes
-- disso o cron chamaria um endereço que não existe.

select cron.unschedule('imobiliaria-repasse-atraso-daily')
where exists (select 1 from cron.job where jobname = 'imobiliaria-repasse-atraso-daily');

select cron.schedule(
  'imobiliaria-repasse-atraso-daily',
  '10 11 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/imobiliaria-repasse-atraso',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Conferência: deve voltar uma linha, ativa.
--   select jobname, schedule, active from cron.job where jobname = 'imobiliaria-repasse-atraso-daily';
