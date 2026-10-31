-- ============================================================================
-- 124_kanban_equipe_bruna.sql
-- Bruna entra na equipe de prospecção pelo login adm@fegsegurogarantia.com.br
-- (confirmado pelo Fábio em 31/10/2026: o adm@ passa a ser só dela, e a Grace
-- ganhou login próprio no mesmo dia). A coluna "Leads Bruna" passa a ser dela.
--
-- Os 10 leads da coluna: 1 com contato registrado entra como "tentando", os
-- outros 9 como "contatar".
--
-- Atenção: os contatos registrados antes desta data pelo adm@ podem ter sido
-- feitos pela Grace, que dividia o login. Esta migração não mexe neles.
--
-- COMO REVERTER:
--   update public.prospects set responsavel_email = null, responsavel_em = null, etapa = null
--    where responsavel_email = 'adm@fegsegurogarantia.com.br';
--   update public.kanban_colunas set responsavel_email = null where id = 'col_1792371044065';
--   delete from public.prospeccao_equipe where email = 'adm@fegsegurogarantia.com.br';
-- ============================================================================

insert into public.prospeccao_equipe (email, nome) values
    ('adm@fegsegurogarantia.com.br', 'Bruna')
on conflict (email) do nothing;

update public.kanban_colunas
   set responsavel_email = 'adm@fegsegurogarantia.com.br', etapa_padrao = null
 where id = 'col_1792371044065';   -- Leads Bruna

update public.prospects p
   set responsavel_email = 'adm@fegsegurogarantia.com.br',
       responsavel_em    = coalesce(p.status_entered_at, now()),
       etapa = case
           when p.situacao_manual in ('aguardando', 'retomar')
             or exists (select 1 from public.prospect_toques t where t.prospect_id = p.id)
           then 'tentando'
           else 'contatar'
       end
 where p.status = 'col_1792371044065'
   and p.responsavel_email is null;
