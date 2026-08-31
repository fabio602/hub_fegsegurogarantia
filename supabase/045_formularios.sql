-- ============================================================================
-- Biblioteca de formulários do Seguro Garantia.
--
-- Problema que resolve: os formulários em branco que a corretora manda para o
-- cliente (cadastro, questionário, procuração) viviam espalhados entre pasta
-- do computador, e-mail antigo e WhatsApp. Na hora de mandar, ninguém lembrava
-- onde estava a última versão.
--
-- Aqui cada formulário é uma linha com o PDF no storage. A tela do hub copia o
-- link ou baixa o arquivo. Quem sobe e apaga é só o admin; todo mundo que está
-- logado consegue ver e usar.
-- ============================================================================

create table if not exists formularios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  descricao     text,
  -- Texto livre de propósito: a tela sugere as categorias que já existem, mas
  -- não trava a criação de uma nova quando aparecer um formulário diferente.
  categoria     text not null default 'Geral',
  arquivo_url   text not null,
  arquivo_nome  text,
  ordem         integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table formularios is
  'Formulários em branco enviados para clientes. O PDF fica no bucket formularios; aqui ficam nome, categoria e link.';

create index if not exists formularios_categoria_idx on formularios (categoria, ordem, nome);

-- ─────────────────────────────────────────────────────────────────────────────
-- Acesso: ler é para qualquer usuário do hub; incluir, editar e apagar é só do
-- admin. A checagem é pelo e-mail do token, o mesmo critério que o App.tsx já
-- usa para liberar a aba de usuários.
-- ─────────────────────────────────────────────────────────────────────────────
alter table formularios enable row level security;

drop policy if exists formularios_leitura on formularios;
create policy formularios_leitura on formularios
  for select to authenticated using (true);

drop policy if exists formularios_escrita_admin on formularios;
create policy formularios_escrita_admin on formularios
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'fabio@fegsegurogarantia.com.br')
  with check ((auth.jwt() ->> 'email') = 'fabio@fegsegurogarantia.com.br');

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket público: o link precisa abrir no navegador do cliente, que não tem
-- login no hub. São formulários em branco, sem dado de ninguém.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('formularios', 'formularios', true)
on conflict (id) do update set public = true;

drop policy if exists formularios_arquivos_leitura on storage.objects;
create policy formularios_arquivos_leitura on storage.objects
  for select to public using (bucket_id = 'formularios');

drop policy if exists formularios_arquivos_admin on storage.objects;
create policy formularios_arquivos_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'formularios' and (auth.jwt() ->> 'email') = 'fabio@fegsegurogarantia.com.br')
  with check (bucket_id = 'formularios' and (auth.jwt() ->> 'email') = 'fabio@fegsegurogarantia.com.br');
