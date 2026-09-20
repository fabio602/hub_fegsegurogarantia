-- 086: agenda o digest de pendencias do portal da imobiliaria.
--
-- Segunda e quinta as 8h de Brasilia. O banco roda em UTC e o Brasil nao tem
-- mais horario de verao, entao 8h BRT e sempre 11:00 UTC.
--
-- Duas vezes por semana e o meio termo escolhido: insiste o bastante para a
-- imobiliaria nao esquecer e nao vira e-mail diario que ninguem abre. A funcao
-- so envia quando ha pendencia, entao semana limpa nao gera e-mail nenhum.
--
-- Aplicada no projeto hfjvwibucplyhsvnwfor em 20/09/2026 (jobid 14).

select cron.unschedule('imobiliaria-pendencias-semanal')
where exists (select 1 from cron.job where jobname = 'imobiliaria-pendencias-semanal');

select cron.schedule(
  'imobiliaria-pendencias-semanal',
  '0 11 * * 1,4',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/imobiliaria-pendencias',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
