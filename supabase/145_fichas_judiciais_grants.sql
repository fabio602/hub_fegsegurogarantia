-- 145: fecha os grants da fichas_judiciais (24/11/2026).
--
-- Conferindo a 144 no banco, a tabela nasceu com TODOS os privilégios para
-- anon e authenticated: o projeto ainda tem "default privileges" que concedem
-- tudo a esses papéis em toda tabela nova do schema public. Quem estava
-- segurando o acesso era só a RLS (ligada, sem policy para anon). Funciona,
-- mas a ficha tem CPF e dados de processo, então aqui a porta fica fechada
-- também no grant, para a tabela não depender de uma única trava.
--
-- Fica assim: anon nada; equipe logada lê e atualiza; só a service role
-- (Edge Function ficha-judicial) insere.

revoke all on table public.fichas_judiciais from anon;
revoke insert, delete, truncate, references, trigger on table public.fichas_judiciais from authenticated;
revoke all on sequence public.fichas_judiciais_seq from anon, authenticated;

grant select, update on table public.fichas_judiciais to authenticated;
grant select, insert, update, delete on table public.fichas_judiciais to service_role;
grant usage, select on sequence public.fichas_judiciais_seq to service_role;
