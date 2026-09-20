-- 086_unimed_leads_cnpj_unique_simples.sql
-- O indice unico parcial (where cnpj is not null) nao pode ser inferido pelo
-- ON CONFLICT que o PostgREST monta no upsert: a Edge Function lead-saude
-- falhava com 42P10 e o lead era descartado em silencio.
-- Indice unico simples resolve. No Postgres NULLs sao distintos entre si,
-- entao varios leads sem CNPJ continuam permitidos.

drop index if exists unimed_leads_cnpj_uk;
create unique index if not exists unimed_leads_cnpj_uk on unimed_leads (cnpj);
