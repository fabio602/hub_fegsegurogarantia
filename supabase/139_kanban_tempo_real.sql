-- 139: Kanban de Leads em tempo real (06/11/2026)
--
-- O que um usuário mudava no quadro (mover card, registrar toque, lembrete,
-- coluna) só aparecia para os outros depois de F5. Estas tabelas entram na
-- publicação do Realtime para o ProspectsKanban receber o aviso e recarregar
-- sozinho. As políticas RLS (authenticated, sem anon) continuam decidindo
-- quem recebe: anônimo não recebe nada.
--
-- Só acrescenta; idempotente.

do $$
declare t text;
begin
  foreach t in array array['prospects', 'prospect_toques', 'crm_tasks', 'kanban_colunas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
