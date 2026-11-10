-- 141: o "Meu dia" passa a ser editável pela própria pessoa (10/11/2026, decisão do Fábio)
--
-- Até aqui o Meu dia era só leitura, montado a partir de leads, pós-venda e
-- residencial. Entram três coisas:
--   1. tarefas próprias ("ligar para o contador do cliente X"), com data;
--   2. adiar um item: não precisa de tabela, grava na origem
--      (prospects.proximo_passo e posvenda_toques.vence_em);
--   3. fixar um item no topo da lista: marcação pessoal, não muda o item.
--
-- Aplicada no banco em 10/11/2026.
--
-- As duas tabelas são pessoais: cada um lê e escreve só o que é seu. O admin
-- lê tudo, porque a visão de Gestão abre o dia de qualquer pessoa.

create table if not exists public.meu_dia_tarefas (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null check (user_email = lower(user_email)),
  titulo       text not null check (length(btrim(titulo)) between 1 and 300),
  dia          date not null default (now() at time zone 'America/Sao_Paulo')::date,
  concluida_em timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists meu_dia_tarefas_dono_dia on public.meu_dia_tarefas (user_email, dia);

comment on table public.meu_dia_tarefas is
  'Tarefas que a própria pessoa cria no Meu dia. dia = quando deve aparecer.';

alter table public.meu_dia_tarefas enable row level security;

grant select, insert, update, delete on table public.meu_dia_tarefas to authenticated;
grant select, insert, update, delete on table public.meu_dia_tarefas to service_role;

drop policy if exists meu_dia_tarefas_select on public.meu_dia_tarefas;
create policy meu_dia_tarefas_select on public.meu_dia_tarefas
  for select to authenticated
  using (
    user_email = lower(auth.jwt() ->> 'email')
    or auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br'
  );

drop policy if exists meu_dia_tarefas_insert on public.meu_dia_tarefas;
create policy meu_dia_tarefas_insert on public.meu_dia_tarefas
  for insert to authenticated
  with check (user_email = lower(auth.jwt() ->> 'email'));

drop policy if exists meu_dia_tarefas_update on public.meu_dia_tarefas;
create policy meu_dia_tarefas_update on public.meu_dia_tarefas
  for update to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'))
  with check (user_email = lower(auth.jwt() ->> 'email'));

drop policy if exists meu_dia_tarefas_delete on public.meu_dia_tarefas;
create policy meu_dia_tarefas_delete on public.meu_dia_tarefas
  for delete to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'));

-- Itens fixados no topo. tipo: 'lead' (prospects.id) ou 'posvenda' (posvenda_toques.id).
create table if not exists public.meu_dia_fixados (
  user_email text not null check (user_email = lower(user_email)),
  tipo       text not null check (tipo in ('lead', 'posvenda')),
  item_id    text not null,
  created_at timestamptz not null default now(),
  primary key (user_email, tipo, item_id)
);

comment on table public.meu_dia_fixados is
  'Itens que cada pessoa fixou no topo do Meu dia. Marcação pessoal: não altera o lead nem a tarefa.';

alter table public.meu_dia_fixados enable row level security;

grant select, insert, update, delete on table public.meu_dia_fixados to authenticated;
grant select, insert, update, delete on table public.meu_dia_fixados to service_role;

drop policy if exists meu_dia_fixados_select on public.meu_dia_fixados;
create policy meu_dia_fixados_select on public.meu_dia_fixados
  for select to authenticated
  using (
    user_email = lower(auth.jwt() ->> 'email')
    or auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br'
  );

drop policy if exists meu_dia_fixados_insert on public.meu_dia_fixados;
create policy meu_dia_fixados_insert on public.meu_dia_fixados
  for insert to authenticated
  with check (user_email = lower(auth.jwt() ->> 'email'));

drop policy if exists meu_dia_fixados_delete on public.meu_dia_fixados;
create policy meu_dia_fixados_delete on public.meu_dia_fixados
  for delete to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'));
