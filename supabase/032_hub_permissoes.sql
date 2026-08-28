-- 032 — Permissões de acesso por usuário do hub
--
-- Até aqui o hub não tinha controle nenhum: qualquer pessoa que logasse via
-- todas as telas — WhatsApp, vendas, metas, financeiro. A única checagem
-- existente era um `if` no e-mail do admin, direto no App.tsx, escondendo a
-- tela "Usuários do Hub".
--
-- A permissão é por MÓDULO, não por tela. São ~30 views mas só 10 módulos, e
-- eles batem exatamente com os grupos do menu lateral — é assim que a decisão
-- é tomada na prática ("a Geisa não precisa ver o WhatsApp"), e não tela a
-- tela.
--
-- Ausência de linha = acesso total. Isso é deliberado: no dia do deploy os
-- usuários que já existem não podem perder acesso a nada. Restringir é um
-- ato explícito — só passa a valer quando o admin salva a linha da pessoa.
--
-- ATENÇÃO: isto controla o que aparece na interface, não o que o banco
-- entrega. Esconder o menu impede que um colega navegue até a tela; não
-- impede quem sabe usar a anon key de consultar a tabela direto. Blindagem
-- de verdade dos dados depende de RLS em cada tabela (whatsapp_messages,
-- sales, etc.), que é outro trabalho.

create table if not exists hub_permissoes (
  user_email text primary key,
  modulos    text[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table hub_permissoes is
  'Módulos do menu que cada usuário enxerga. Sem linha = vê tudo.';
comment on column hub_permissoes.modulos is
  'Chaves de módulo: garantia, auto, residencial, rc, financeiro, whatsapp, parceiros, agenda, manual, email-followup.';

alter table hub_permissoes enable row level security;

-- Cada um lê a própria linha; o admin lê todas (precisa, para montar a tela).
drop policy if exists "hub_permissoes_select" on hub_permissoes;
create policy "hub_permissoes_select" on hub_permissoes
  for select to authenticated
  using (
    user_email = auth.jwt() ->> 'email'
    or auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br'
  );

-- Só o admin escreve. Sem isso, um usuário restrito poderia dar acesso a si
-- mesmo com uma chamada direta ao PostgREST — e aí o controle não valeria nada.
drop policy if exists "hub_permissoes_write" on hub_permissoes;
create policy "hub_permissoes_write" on hub_permissoes
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br')
  with check (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br');
