-- 126: data em que o card do pipeline da imobiliária entrou na etapa atual.
--
-- As colunas Aprovado e Recusado do pipeline (Repasse Imobiliárias) mostram o
-- card por 3 dias. A conta usava created_at, a data do pedido. Quem aprovava
-- um pedido feito há mais de 3 dias via o card sumir na hora (foi o caso do
-- Donavam: pedido em 23/10, aprovado em 27/10).
--
-- kanban_status_em guarda quando kanban_status mudou pela última vez. O
-- gatilho cobre todos os caminhos que mexem na etapa (arrastar o card, modal
-- de status, Registro de Vendas, portal), sem depender de cada tela lembrar.

alter table public.imobiliaria_clientes
  add column if not exists kanban_status_em timestamptz;

-- Cadastros antigos: a melhor estimativa é a última alteração do registro.
update public.imobiliaria_clientes
   set kanban_status_em = coalesce(updated_at, created_at)
 where kanban_status_em is null;

create or replace function public.imobiliaria_clientes_kanban_status_em()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.kanban_status_em := coalesce(new.kanban_status_em, now());
  elsif new.kanban_status is distinct from old.kanban_status then
    new.kanban_status_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_imobiliaria_clientes_kanban_status_em on public.imobiliaria_clientes;
create trigger trg_imobiliaria_clientes_kanban_status_em
  before insert or update on public.imobiliaria_clientes
  for each row execute function public.imobiliaria_clientes_kanban_status_em();
