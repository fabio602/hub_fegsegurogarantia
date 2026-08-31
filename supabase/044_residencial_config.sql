-- 044 — Configuração do módulo Residencial: cópias adicionais de e-mail
--
-- Todo e-mail do módulo residencial saía com Cco fixo para o Fábio, hardcoded
-- em cada Edge Function (const BCC = 'fabio@...'). O pedido é que a Geisa
-- também receba cópia de tudo que o módulo dispara — e amanhã pode ser outra
-- pessoa, então vira configuração em vez de mais um e-mail no código.
--
-- Tabela de linha única (id = 1), mesmo desenho da prospeccao_pncp_config.
-- As Edge Functions leem `copias_adicionais` na hora do envio e somam ao Cco
-- que já vai para o Fábio. Cco de propósito: o cliente não vê a lista.
--
-- Escopo: SÓ o módulo residencial (functions imobiliaria-* e o send-boleto-email
-- quando o produto é Seguro Residencial). Trilhas de prospecção e os outros
-- módulos não leem esta tabela.

create table if not exists residencial_config (
  id                int primary key default 1 check (id = 1),
  copias_adicionais text[] not null default '{}',
  updated_at        timestamptz not null default now()
);

comment on table residencial_config is
  'Configuração do módulo Residencial (linha única, id=1).';
comment on column residencial_config.copias_adicionais is
  'E-mails que entram em Cco em todo envio do módulo residencial, além do Fábio.';

insert into residencial_config (id, copias_adicionais)
values (1, '{geisasegurogarantia@gmail.com}')
on conflict (id) do nothing;

alter table residencial_config enable row level security;

-- Todo mundo logado lê (a tela do Residencial mostra a lista); só o admin
-- escreve — sem isso, um usuário restrito poderia se colocar em cópia de
-- todos os e-mails de clientes com uma chamada direta ao PostgREST.
drop policy if exists "residencial_config_select" on residencial_config;
create policy "residencial_config_select" on residencial_config
  for select to authenticated using (true);

drop policy if exists "residencial_config_write" on residencial_config;
create policy "residencial_config_write" on residencial_config
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br')
  with check (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br');
