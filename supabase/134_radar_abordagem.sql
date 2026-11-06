-- ============================================================================
-- 134_radar_abordagem.sql
-- Abordagem dos leads do Radar fiscal dentro do próprio Radar, item 1: só banco.
--
-- Por que: os leads de Garantia Judicial Fiscal não devem se misturar com o
-- Kanban de prospecção (licitação/PNCP). O lead fica no Radar do início ao
-- fim, com dono, etapa e o registro de cada contato, no mesmo padrão do
-- Kanban (etapas e resultados iguais aos da migração 122).
--
-- O que entra (só acréscimos):
--   1. radar_empresas: responsável, etapa, próximo passo, motivo de perda,
--      encerramento e data do último toque.
--   2. radar_toques: cada contato (canal, resultado, com quem falou, nota,
--      próximo passo, autor). Gatilho mantém radar_empresas.ultimo_toque_em.
--   3. Os 11 leads que já tinham ido ao Kanban voltam para o Radar: dono e
--      etapa copiados do card, toques copiados, card apagado do Kanban.
--      Antes de apagar, os cards ficam guardados em
--      bkp_radar_devolvidos_kanban (pode ser apagada depois de conferido).
--
-- Etapas: contatar, tentando, conversa, cotacao, ganho, perdido.
-- etapa nula = ninguém começou a abordagem ainda.
--
-- COMO REVERTER (a devolução dos 11 se refaz a partir do backup):
--   drop trigger if exists trg_radar_toques_sync on public.radar_toques;
--   drop function if exists public.radar_toques_sync_ultimo();
--   drop table if exists public.radar_toques;
--   alter table public.radar_empresas
--     drop column if exists responsavel_email, drop column if exists responsavel_em,
--     drop column if exists etapa, drop column if exists proximo_passo,
--     drop column if exists motivo_perda, drop column if exists encerrado_em,
--     drop column if exists ultimo_toque_em;
-- ============================================================================

-- 1. Lead do Radar: dono e etapa ---------------------------------------------
alter table public.radar_empresas
    add column if not exists responsavel_email text
        references public.prospeccao_equipe(email) on update cascade on delete set null,
    add column if not exists responsavel_em timestamptz,
    add column if not exists etapa text
        check (etapa in ('contatar', 'tentando', 'conversa', 'cotacao', 'ganho', 'perdido')),
    add column if not exists proximo_passo date,
    add column if not exists motivo_perda text
        check (motivo_perda in ('sem_interesse', 'ja_tem_corretora', 'nao_precisa', 'contato_invalido', 'sem_retorno')),
    add column if not exists encerrado_em timestamptz,
    add column if not exists ultimo_toque_em timestamptz;

alter table public.radar_empresas drop constraint if exists radar_empresas_motivo_perda_so_perdido;
alter table public.radar_empresas add constraint radar_empresas_motivo_perda_so_perdido
    check (motivo_perda is null or etapa = 'perdido');

create index if not exists radar_empresas_abordagem_idx
    on public.radar_empresas (responsavel_email, etapa)
    where etapa is not null;

comment on column public.radar_empresas.responsavel_email is 'Quem assumiu a abordagem (login no HUB). Nulo = ninguém assumiu.';
comment on column public.radar_empresas.etapa is 'Etapa da abordagem: contatar, tentando, conversa, cotacao, ganho ou perdido. Nula = não iniciada.';
comment on column public.radar_empresas.proximo_passo is 'Dia combinado para o próximo contato (horário de São Paulo).';

-- 2. Contatos registrados ----------------------------------------------------
create table if not exists public.radar_toques (
    id             uuid primary key default gen_random_uuid(),
    cnpj           text not null references public.radar_empresas(cnpj) on delete cascade,
    canal          text not null check (canal in ('whatsapp', 'email', 'ligacao')),
    resultado      text
        check (resultado in ('enviado', 'respondeu', 'conversou', 'nao_atendeu', 'pediu_retorno',
                             'pediu_cotacao', 'numero_errado', 'sem_interesse')),
    falou_com      text check (falou_com in ('empresa', 'advogado', 'contador', 'outro')),
    nota           text,
    proximo_passo  date,
    autor_email    text default (auth.jwt() ->> 'email'),
    created_at     timestamptz not null default now()
);

create index if not exists radar_toques_cnpj_idx on public.radar_toques (cnpj, created_at desc);
create index if not exists radar_toques_created_idx on public.radar_toques (created_at desc);

alter table public.radar_toques enable row level security;

grant select, insert, update, delete on table public.radar_toques to authenticated;
grant select, insert, update, delete on table public.radar_toques to service_role;

drop policy if exists authenticated_radar_toques_all on public.radar_toques;
create policy authenticated_radar_toques_all on public.radar_toques
    for all to authenticated using (true) with check (true);

comment on table public.radar_toques is
    'Contatos da abordagem do Radar fiscal (ligação, WhatsApp, e-mail) com resultado e com quem falou.';

create or replace function public.radar_toques_sync_ultimo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cnpj text := coalesce(new.cnpj, old.cnpj);
begin
    update public.radar_empresas e
       set ultimo_toque_em = (select max(t.created_at) from public.radar_toques t where t.cnpj = v_cnpj)
     where e.cnpj = v_cnpj;
    return null;
end;
$$;

revoke all on function public.radar_toques_sync_ultimo() from public, anon, authenticated;

drop trigger if exists trg_radar_toques_sync on public.radar_toques;
create trigger trg_radar_toques_sync
    after insert or delete on public.radar_toques
    for each row execute function public.radar_toques_sync_ultimo();

-- 3. Devolução dos leads que tinham ido ao Kanban -----------------------------
create table if not exists public.bkp_radar_devolvidos_kanban (
    prospect_id  uuid primary key,
    cnpj         text not null,
    prospect     jsonb not null,
    toques       jsonb not null default '[]'::jsonb,
    devolvido_em timestamptz not null default now()
);
alter table public.bkp_radar_devolvidos_kanban enable row level security;

insert into public.bkp_radar_devolvidos_kanban (prospect_id, cnpj, prospect, toques)
select p.id, r.cnpj, to_jsonb(p),
       coalesce((select jsonb_agg(to_jsonb(t)) from public.prospect_toques t where t.prospect_id = p.id), '[]'::jsonb)
  from public.radar_empresas r
  join public.prospects p on p.id = r.prospect_id
 where r.prospect_id is not null
on conflict (prospect_id) do nothing;

insert into public.radar_toques (cnpj, canal, resultado, nota, proximo_passo, autor_email, created_at)
select r.cnpj, t.canal, t.resultado, t.nota, t.proximo_passo, t.autor_email, t.created_at
  from public.radar_empresas r
  join public.prospect_toques t on t.prospect_id = r.prospect_id
 where r.prospect_id is not null;

update public.radar_empresas r
   set responsavel_email = p.responsavel_email,
       responsavel_em    = coalesce(p.responsavel_em, now()),
       etapa             = case when p.responsavel_email is null then null else coalesce(p.etapa, 'contatar') end,
       proximo_passo     = p.proximo_passo,
       status            = 'novo',
       prospect_id       = null,
       atualizado_em     = now()
  from public.prospects p
 where p.id = r.prospect_id;

delete from public.prospects p
 using public.bkp_radar_devolvidos_kanban b
 where p.id = b.prospect_id;
