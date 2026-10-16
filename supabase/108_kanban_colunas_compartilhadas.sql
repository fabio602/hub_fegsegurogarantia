-- 108 — Colunas do Kanban de prospecção compartilhadas no banco
--
-- Até aqui as colunas do Kanban (nome, cor e ordem) ficavam no localStorage de
-- cada navegador. O lead guardava em prospects.status só o id da coluna
-- (ex.: col_1782126694460), então uma coluna criada por um usuário não existia
-- para os outros e os leads dela caíam em "Novos Leads" na tela de quem não a
-- conhecia. Agora a lista de colunas vive nesta tabela e todos veem o mesmo
-- quadro. Os ids continuam os mesmos, então nenhum lead precisa ser mexido.
--
-- As colunas criadas à mão em cada navegador são importadas pelo próprio HUB,
-- uma vez por navegador, na primeira abertura depois desta versão.

create table if not exists public.kanban_colunas (
  id          text primary key,
  title       text not null,
  color       text not null default 'fg_blue_2',
  protected   boolean not null default false,
  ordem       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.kanban_colunas enable row level security;

grant select, insert, update, delete on table public.kanban_colunas to authenticated;
grant select, insert, update, delete on table public.kanban_colunas to service_role;

drop policy if exists kanban_colunas_auth on public.kanban_colunas;
create policy kanban_colunas_auth on public.kanban_colunas
  for all to authenticated using (true) with check (true);

-- Colunas fixas, usadas pelas automações (lead-cotacao, PNCP, webhook do Resend).
insert into public.kanban_colunas (id, title, color, protected, ordem) values
  ('Novos Leads',          'Novos Leads',          'fg_blue_1', true, 0),
  ('Em contato',           'Em contato',           'fg_gold_1', true, 100),
  ('Contato por WhatsApp', 'Contato por WhatsApp', 'fg_gold_2', true, 110),
  ('Sem e-mail válido',    'Sem e-mail válido',    'fg_blue_2', true, 120)
on conflict (id) do nothing;
