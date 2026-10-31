-- ============================================================================
-- 123_kanban_equipe_grace.sql
-- Grace entra na equipe de prospecção e a coluna "Leads Grace" passa a ser
-- dela (item 1 do Kanban pessoal, migração 122).
--
-- O login grace@fegsegurogarantia.com.br ainda não existia no HUB em
-- 31/10/2026: o vínculo vale assim que o login for criado com esse e-mail.
-- Se o login sair com outro e-mail, basta trocar o e-mail em
-- prospeccao_equipe; a troca passa sozinha para colunas e leads
-- (chave estrangeira com on update cascade).
--
-- Os 4 leads da coluna já tinham contato registrado (pelo login adm@, que
-- ela dividia com a Bruna), então entram como "tentando".
--
-- COMO REVERTER:
--   update public.prospects set responsavel_email = null, responsavel_em = null, etapa = null
--    where responsavel_email = 'grace@fegsegurogarantia.com.br';
--   update public.kanban_colunas set responsavel_email = null where id = 'col_1792687541855';
--   delete from public.prospeccao_equipe where email = 'grace@fegsegurogarantia.com.br';
-- ============================================================================

insert into public.prospeccao_equipe (email, nome) values
    ('grace@fegsegurogarantia.com.br', 'Grace')
on conflict (email) do nothing;

update public.kanban_colunas
   set responsavel_email = 'grace@fegsegurogarantia.com.br', etapa_padrao = null
 where id = 'col_1792687541855';   -- Leads Grace

update public.prospects p
   set responsavel_email = 'grace@fegsegurogarantia.com.br',
       responsavel_em    = coalesce(p.status_entered_at, now()),
       etapa = case
           when p.situacao_manual in ('aguardando', 'retomar')
             or exists (select 1 from public.prospect_toques t where t.prospect_id = p.id)
           then 'tentando'
           else 'contatar'
       end
 where p.status = 'col_1792687541855'
   and p.responsavel_email is null;
