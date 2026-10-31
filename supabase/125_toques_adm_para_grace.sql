-- ============================================================================
-- 125_toques_adm_para_grace.sql
-- Os WhatsApps registrados pelo login adm@ nos leads da Grace (23/10/2026)
-- foram feitos por ela, que dividia esse login com a Bruna (confirmado pelo
-- Fábio em 31/10/2026). Passam para o nome da Grace. Os contatos do adm@ em
-- leads de outras colunas continuam como estão (ficam com a Bruna).
--
-- COMO REVERTER:
--   update public.prospect_toques t set autor_email = 'adm@fegsegurogarantia.com.br'
--     from public.prospects p
--    where p.id = t.prospect_id and p.status = 'col_1792687541855'
--      and t.autor_email = 'grace@fegsegurogarantia.com.br'
--      and t.created_at < '2026-10-31';
-- ============================================================================

update public.prospect_toques t
   set autor_email = 'grace@fegsegurogarantia.com.br'
  from public.prospects p
 where p.id = t.prospect_id
   and p.status = 'col_1792687541855'   -- Leads Grace
   and lower(t.autor_email) = 'adm@fegsegurogarantia.com.br';
