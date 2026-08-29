-- ============================================================================
-- 037: Corrigir o segredo anon_key do Vault  (RODAR NO SQL EDITOR DO SUPABASE)
--
-- Descoberta em 29/08/2026: o segredo 'anon_key' do Vault contem o texto
-- placeholder "SUA_ANON_KEY", nunca foi preenchido. Consequencia: TODOS os
-- jobs do pg_cron que montam o Authorization com esse segredo recebem 401
-- (Invalid JWT) das Edge Functions:
--   - remind-stale-sales-daily   (ninguem notou porque o GitHub Actions
--   - pregao-reminders-daily      duplica essas chamadas com o secret certo)
--   - prospeccao-pncp-daily      (novo; fica parado ate este conserto)
--
-- A anon key e publica por design (esta hardcoded em lib/supabase.ts e no
-- bundle do site); guarda-la no Vault e so conveniencia para o pg_cron.
-- ============================================================================

select vault.update_secret(
  (select id from vault.secrets where name = 'anon_key'),
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmanZ3aWJ1Y3BseWhzdm53Zm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODA4NTIsImV4cCI6MjA4Nzk1Njg1Mn0.jCBS1YnDcKuVzJSVhGiJM0kyafPMZxFi52kszTJCxZQ'
);

-- Conferencia: o tamanho deve ser 208, nao 12.
select name, length(decrypted_secret) as tamanho
from vault.decrypted_secrets
where name = 'anon_key';
