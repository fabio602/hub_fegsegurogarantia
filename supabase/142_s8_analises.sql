-- 142: análise de crédito da garantia locatícia direto na S8 Garante,
-- pelo portal da imobiliária (11/11/2026, decisão do Fábio).
--
-- A imobiliária preenche a análise no portal; a Edge Function s8-analise
-- confere o token do login, envia para a API da S8 (POST /analises) com a
-- chave da F&G (secret S8_API_KEY) e grava aqui o pedido e a resposta. O
-- status é atualizado consultando GET /analises/{id} (pelo portal enquanto a
-- tela está aberta e pelo cron s8-analises-sync).
--
-- A tabela só é lida e escrita pela function (service role). A equipe da F&G
-- logada no HUB pode ler. O portal nunca lê direto com a anon key.

create table if not exists public.s8_analises (
  id                    uuid primary key default gen_random_uuid(),
  partner_id            bigint not null,
  idempotency_key       uuid not null default gen_random_uuid(),
  s8_id                 uuid,
  contract_number       text,
  status                text not null default 'enviando',
  guarantee_value       numeric,
  plan_id               uuid,
  inquilino_nome        text not null,
  inquilino_documento   text not null,
  inquilino_telefone    text,
  inquilino_email       text,
  imovel_resumo         text,
  aluguel               numeric,
  custo_total           numeric,
  payload               jsonb,
  erro                  text,
  aviso                 text,
  analysis_completed_at timestamptz,
  status_consultado_em  timestamptz,
  decisao_avisada_em    timestamptz,
  lgpd_aceite_em        timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists s8_analises_partner on public.s8_analises (partner_id, created_at desc);
create unique index if not exists s8_analises_s8_id on public.s8_analises (s8_id) where s8_id is not null;

comment on table public.s8_analises is
  'Análises de garantia locatícia enviadas à S8 Garante pelo portal da imobiliária (Edge Function s8-analise).';

alter table public.s8_analises enable row level security;

grant select, insert, update, delete on table public.s8_analises to authenticated;
grant select, insert, update, delete on table public.s8_analises to service_role;

drop policy if exists s8_analises_equipe_le on public.s8_analises;
create policy s8_analises_equipe_le on public.s8_analises
  for select to authenticated using (true);

-- Cron: atualiza o status das análises abertas mesmo com o portal fechado
-- (a function consulta no máximo 8 por rodada; limite da S8 é 30/min).
select cron.schedule('s8-analises-sync', '*/2 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/s8-analise',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"acao":"sincronizar"}'::jsonb
  );
$$);

-- Aplicada no banco em 11/11/2026.
