-- 140: função de cada pessoa no dia a dia (10/11/2026, decisão do Fábio)
--
-- A hub_permissoes (032) diz o que cada um VÊ. Faltava dizer o que cada um
-- FAZ: a Bruna cuida de cotações, registro de vendas e pós-venda; a Grace é
-- SDR; o João é closer; a Andreza cuida do residencial. A função decide o que
-- aparece no "Meu dia" de cada pessoa e para quem vão as tarefas que o hub
-- gera sozinho (ex.: pós-venda aberto aparece para quem tem Operações).
--
-- Chaves de função (lib/funcoes.ts): sdr, closer, operacoes, residencial, gestao.
-- Uma pessoa pode ter mais de uma. Sem linha = sem função definida (o "Meu
-- dia" mostra só o geral). Não mexe em permissão de tela.

create table if not exists public.hub_funcoes (
  user_email text primary key check (user_email = lower(user_email)),
  funcoes    text[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.hub_funcoes is
  'Funções de cada usuário do hub no dia a dia: sdr, closer, operacoes, residencial, gestao.';

alter table public.hub_funcoes enable row level security;

grant select, insert, update, delete on table public.hub_funcoes to authenticated;
grant select, insert, update, delete on table public.hub_funcoes to service_role;

-- Todos os logados leem todas as linhas: o card do lead precisa saber quem é
-- closer para o "Passar para o closer", e a visão de gestão filtra por pessoa.
drop policy if exists hub_funcoes_select on public.hub_funcoes;
create policy hub_funcoes_select on public.hub_funcoes
  for select to authenticated
  using (true);

-- Só o admin escreve, como na hub_permissoes.
drop policy if exists hub_funcoes_write on public.hub_funcoes;
create policy hub_funcoes_write on public.hub_funcoes
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br')
  with check (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br');
