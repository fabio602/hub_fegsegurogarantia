-- 094_backups_prospects_rls.sql
--
-- Liga RLS nas duas tabelas de backup criadas em 06/09/2026, quando o CHECK
-- de origem em email_cadencia rejeitava garimpo_% e deixou prospects orfaos.
--
-- Estavam com RLS desligado, o que as deixava legiveis e gravaveis por
-- qualquer um com a chave anon: 919 linhas com razao social, CNPJ e e-mail.
--
-- Sem policy de proposito. Backup nao alimenta tela nenhuma, entao ninguem
-- precisa ler: so a service role, que ignora RLS, continua alcancando.

alter table public.prospects_apagados_20260906 enable row level security;
alter table public.prospects_apagados_garimpo_20260906 enable row level security;
