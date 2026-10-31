-- ============================================================================
-- 122_kanban_pessoal_base.sql
-- Kanban pessoal ("Minha prospecção"), item 1: só banco. Nenhuma tela muda.
--
-- Por que: o lead tinha uma informação só, a coluna (prospects.status), e ela
-- fazia dois papéis ao mesmo tempo: dono ("João Victor") e etapa. Sem lugar
-- para a etapa, o João criou colunas próprias ("JV Ligou sem Retorno",
-- "JV em contato") e o quadro virou improviso. Além disso, o toque registrado
-- guardava só canal, autor e data, sem o resultado do contato.
--
-- O que entra (só acréscimos, nada é apagado):
--   1. prospeccao_equipe: quem prospecta, pelo e-mail de login no HUB.
--   2. kanban_colunas: a quem a coluna pertence e, se for o caso, qual etapa
--      ela representa.
--   3. prospects: responsável, etapa, próximo passo, motivo de perda e data
--      de encerramento.
--   4. prospect_toques: resultado, roteiro, assunto, mensagem, nota e próximo
--      passo marcado naquele contato.
--   5. Gatilho: enquanto a tela nova não sai, arrastar o card para a coluna de
--      uma pessoa no quadro atual preenche dono e etapa sozinho. Voltar para
--      Novos Leads limpa os dois. Colunas sem dono (automações) não mexem.
--   6. pegar_leads(qtd, origem): puxa os próximos da fila para quem chamou,
--      sem duas pessoas pegarem o mesmo lead.
--   7. Leads atuais: os das colunas do João e do Fábio ganham dono e etapa.
--      Grace e Bruna usam o mesmo login (adm@) e ficam sem dono até cada uma
--      ter login próprio. O lead parado numa coluna apagada volta para a fila.
--
-- Etapas: contatar, tentando, conversa, cotacao, ganho, perdido.
--
-- COMO REVERTER:
--   drop function if exists public.pegar_leads(integer, text);
--   drop trigger if exists trg_prospects_sync_responsavel on public.prospects;
--   drop function if exists public.prospects_sync_responsavel();
--   alter table public.prospects
--     drop column if exists responsavel_email, drop column if exists responsavel_em,
--     drop column if exists etapa, drop column if exists proximo_passo,
--     drop column if exists motivo_perda, drop column if exists encerrado_em;
--   alter table public.prospect_toques
--     drop column if exists resultado, drop column if exists roteiro,
--     drop column if exists assunto, drop column if exists mensagem,
--     drop column if exists nota, drop column if exists proximo_passo;
--   alter table public.kanban_colunas
--     drop column if exists responsavel_email, drop column if exists etapa_padrao;
--   drop table if exists public.prospeccao_equipe;
-- ============================================================================

-- 1. Equipe de prospecção ----------------------------------------------------
create table if not exists public.prospeccao_equipe (
    email       text primary key check (email = lower(email)),
    nome        text not null,
    ativo       boolean not null default true,
    gestor      boolean not null default false,
    created_at  timestamptz not null default now()
);

alter table public.prospeccao_equipe enable row level security;

grant select, insert, update, delete on table public.prospeccao_equipe to authenticated;
grant select, insert, update, delete on table public.prospeccao_equipe to service_role;

drop policy if exists prospeccao_equipe_auth on public.prospeccao_equipe;
create policy prospeccao_equipe_auth on public.prospeccao_equipe
    for all to authenticated using (true) with check (true);

comment on table public.prospeccao_equipe is
    'Quem prospecta no Kanban, pelo e-mail de login no HUB (auth). gestor = pode distribuir leads.';

insert into public.prospeccao_equipe (email, nome, gestor) values
    ('fabio@fegsegurogarantia.com.br', 'Fábio',       true),
    ('joaovictors@gmail.com',          'João Victor', false)
on conflict (email) do nothing;

-- 2. Colunas com dono --------------------------------------------------------
alter table public.kanban_colunas
    add column if not exists responsavel_email text
        references public.prospeccao_equipe(email) on update cascade on delete set null,
    add column if not exists etapa_padrao text
        check (etapa_padrao in ('contatar', 'tentando', 'conversa', 'cotacao'));

comment on column public.kanban_colunas.responsavel_email is
    'Dono da coluna. Lead que entra nela passa a ser dessa pessoa.';
comment on column public.kanban_colunas.etapa_padrao is
    'Etapa que a coluna representa. Nula na coluna principal da pessoa (a etapa vem dos toques).';

update public.kanban_colunas set responsavel_email = 'joaovictors@gmail.com', etapa_padrao = null
 where id = 'col_1792195496014';   -- João Victor
update public.kanban_colunas set responsavel_email = 'joaovictors@gmail.com', etapa_padrao = 'tentando'
 where id = 'col_1792763511390';   -- JV Ligou sem Retorno
update public.kanban_colunas set responsavel_email = 'joaovictors@gmail.com', etapa_padrao = 'conversa'
 where id = 'col_1792765116287';   -- JV em contato
update public.kanban_colunas set responsavel_email = 'fabio@fegsegurogarantia.com.br', etapa_padrao = null
 where id = 'col_1782126694460';   -- Leads Fábio

-- 3. Lead: dono e etapa separados -------------------------------------------
alter table public.prospects
    add column if not exists responsavel_email text
        references public.prospeccao_equipe(email) on update cascade on delete set null,
    add column if not exists responsavel_em timestamptz,
    add column if not exists etapa text
        check (etapa in ('contatar', 'tentando', 'conversa', 'cotacao', 'ganho', 'perdido')),
    add column if not exists proximo_passo date,
    add column if not exists motivo_perda text
        check (motivo_perda in ('sem_interesse', 'ja_tem_corretora', 'nao_precisa', 'contato_invalido', 'sem_retorno')),
    add column if not exists encerrado_em timestamptz;

alter table public.prospects drop constraint if exists prospects_motivo_perda_so_perdido;
alter table public.prospects add constraint prospects_motivo_perda_so_perdido
    check (motivo_perda is null or etapa = 'perdido');

create index if not exists prospects_responsavel_etapa_idx
    on public.prospects (responsavel_email, etapa)
    where responsavel_email is not null;

comment on column public.prospects.responsavel_email is 'Dono do lead (login no HUB). Nulo = está na fila (Novos Leads).';
comment on column public.prospects.etapa is 'contatar, tentando, conversa, cotacao, ganho ou perdido.';
comment on column public.prospects.proximo_passo is 'Dia combinado para o próximo contato (horário de São Paulo).';

-- 4. Toque com resultado -----------------------------------------------------
alter table public.prospect_toques
    add column if not exists resultado text
        check (resultado in ('enviado', 'respondeu', 'conversou', 'nao_atendeu', 'pediu_retorno',
                             'pediu_cotacao', 'numero_errado', 'sem_interesse')),
    add column if not exists roteiro text,
    add column if not exists assunto text,
    add column if not exists mensagem text,
    add column if not exists nota text,
    add column if not exists proximo_passo date;

comment on column public.prospect_toques.roteiro is 'Roteiro usado no contato (ex.: email_licitacao, energia/2).';
comment on column public.prospect_toques.mensagem is 'Texto enviado, quando o HUB souber.';

-- 5. Gatilho: coluna de pessoa preenche dono e etapa -------------------------
create or replace function public.prospects_sync_responsavel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_resp  text;
    v_etapa text;
begin
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
        return new;
    end if;

    -- De volta à fila: sem dono e sem etapa.
    if new.status = 'Novos Leads' then
        new.responsavel_email := null;
        new.responsavel_em    := null;
        new.etapa             := null;
        new.proximo_passo     := null;
        new.motivo_perda      := null;
        new.encerrado_em      := null;
        return new;
    end if;

    select c.responsavel_email, c.etapa_padrao
      into v_resp, v_etapa
      from public.kanban_colunas c
     where c.id = new.status;

    -- Coluna sem dono (automações, arquivo): não mexe em dono nem etapa.
    if v_resp is null then
        return new;
    end if;

    if new.responsavel_email is distinct from v_resp then
        new.responsavel_email := v_resp;
        new.responsavel_em    := now();
    end if;

    if v_etapa is not null then
        new.etapa := v_etapa;
    elsif new.etapa is null or new.etapa in ('ganho', 'perdido') then
        new.etapa := case
            when exists (select 1 from public.prospect_toques t where t.prospect_id = new.id) then 'tentando'
            else 'contatar'
        end;
    end if;

    -- Reaberto: deixa de ser perdido.
    if new.etapa <> 'perdido' then
        new.motivo_perda := null;
        new.encerrado_em := null;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_prospects_sync_responsavel on public.prospects;
create trigger trg_prospects_sync_responsavel
    before insert or update of status on public.prospects
    for each row execute function public.prospects_sync_responsavel();

-- 6. Pegar leads da fila -----------------------------------------------------
-- Leva os próximos N leads de Novos Leads para a coluna principal de quem
-- chamou (o gatilho preenche dono e etapa). Prioridade: pedido do formulário
-- do site, depois PNCP pela homologação mais recente (o contrato ainda vai ser
-- assinado), depois o resto (garimpo) pela data de entrada. p_origem limita a
-- uma origem só (ex.: 'garimpo_imobiliarias'). SKIP LOCKED evita que duas
-- pessoas clicando juntas peguem o mesmo lead.
create or replace function public.pegar_leads(p_qtd integer default 10, p_origem text default null)
returns setof public.prospects
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email  text := lower(auth.jwt() ->> 'email');
    v_coluna text;
begin
    if v_email is null
       or not exists (select 1 from public.prospeccao_equipe e where e.email = v_email and e.ativo) then
        raise exception 'Seu login (%) não está na equipe de prospecção.', coalesce(v_email, 'sem login');
    end if;

    select c.id into v_coluna
      from public.kanban_colunas c
     where c.responsavel_email = v_email
       and c.etapa_padrao is null
     order by c.ordem
     limit 1;

    if v_coluna is null then
        raise exception 'Não há uma coluna sua no Kanban para receber os leads.';
    end if;

    return query
    with fila as (
        select p.id
          from public.prospects p
         where p.status = 'Novos Leads'
           and p.responsavel_email is null
           and (p_origem is null or p.source = p_origem)
         order by case
                      when p.source ilike 'formulario%' then 0
                      when p.source = 'pncp_auto'       then 1
                      else 2
                  end,
                  p.data_homologacao desc nulls last,
                  p.created_at desc
         limit least(greatest(coalesce(p_qtd, 10), 1), 50)
         for update skip locked
    ), pegos as (
        update public.prospects p
           set status = v_coluna
          from fila
         where p.id = fila.id
        returning p.*
    )
    select * from pegos;
end;
$$;

revoke all on function public.pegar_leads(integer, text) from public, anon;
grant execute on function public.pegar_leads(integer, text) to authenticated;

-- 7. Leads atuais -------------------------------------------------------------
-- Não muda status, então os gatilhos de status não disparam.
update public.prospects p
   set responsavel_email = c.responsavel_email,
       responsavel_em    = coalesce(p.status_entered_at, now()),
       etapa = coalesce(
           c.etapa_padrao,
           case
               when p.situacao_manual in ('aguardando', 'retomar')
                 or exists (select 1 from public.prospect_toques t where t.prospect_id = p.id)
               then 'tentando'
               else 'contatar'
           end)
  from public.kanban_colunas c
 where c.id = p.status
   and c.responsavel_email is not null
   and p.responsavel_email is null;

-- Lead parado numa coluna que não existe mais (CONSTRUTORA SOBRINHO): a tela
-- já o mostrava em Novos Leads; agora o banco diz o mesmo.
update public.prospects
   set status = 'Novos Leads'
 where status = 'col_1791835382839';
