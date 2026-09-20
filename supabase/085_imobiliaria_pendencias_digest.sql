-- 085: historico dos avisos de pendencia do portal da imobiliaria.
--
-- A Edge Function `imobiliaria-pendencias` manda um e-mail por parceiro com o
-- que esta parado do lado dele (documentos da garantia, renovacao sem resposta,
-- inquilino sem cobertura, recado aguardando retorno). Esta tabela guarda o que
-- saiu, para dar para conferir se a imobiliaria foi avisada antes de cobrar por
-- telefone, e para achar envio que falhou no Resend.
--
-- Aplicada no projeto hfjvwibucplyhsvnwfor em 20/09/2026.

create table if not exists public.imobiliaria_pendencias_envios (
  id             bigserial primary key,
  partner_id     integer not null references public.partners(id) on delete cascade,
  enviado_em     timestamptz not null default now(),
  total          integer not null default 0,
  resumo         jsonb,
  destinatarios  text[],
  erro           text
);

create index if not exists idx_pendencias_envios_partner_data
  on public.imobiliaria_pendencias_envios (partner_id, enviado_em desc);

alter table public.imobiliaria_pendencias_envios enable row level security;

-- So a service role (a propria function) escreve e le. O portal nao precisa
-- desta tabela, e o HUB usa a service role.
drop policy if exists "service role gerencia envios de pendencia" on public.imobiliaria_pendencias_envios;
create policy "service role gerencia envios de pendencia"
  on public.imobiliaria_pendencias_envios
  for all
  to service_role
  using (true)
  with check (true);
