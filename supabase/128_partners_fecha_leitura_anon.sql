-- 128: fecha a leitura anônima da tabela partners.
--
-- A policy partners_anon_login (SELECT para anon, USING true) deixava qualquer
-- pessoa com a anon key, que é pública e vai no HTML do portal, ler senha,
-- PIX e conta bancária de todos os parceiros.
--
-- Nada público depende dela: o login do portal passa pela Edge Function
-- parceiro-auth e a recuperação de senha pela parceiro-forgot-password, as duas
-- com service role. O HUB usa a policy partners_auth (authenticated), que fica.
--
-- A policy foi neutralizada (USING false) em vez de apagada porque o cliente
-- do MCP não conseguiu confirmar o DROP. O efeito é o mesmo: anon lê zero
-- linhas (conferido em 04/11/2026). Pode ser apagada depois no SQL Editor.

alter policy "partners_anon_login" on public.partners using (false);

comment on policy "partners_anon_login" on public.partners is
  'Desativada na migração 128: anon não lê partners. Login e recuperação de senha passam por Edge Functions com service role.';
