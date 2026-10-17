-- 114 — Trocar o e-mail do lead no Kanban passa a valer para a trilha
--
-- Quando um lead entra numa trilha, email_cadencia guarda uma cópia do
-- e-mail, e é essa cópia que o cron usa. Editar o e-mail no card mudava só
-- prospects.email: a trilha continuava mandando para o endereço antigo.
--
-- Este gatilho roda quando prospects.email muda e ajusta o contato da trilha
-- ligado ao lead (email_cadencia.prospect_id):
--
--   e-mail novo vazio ou inválido -> só pausa a trilha (ativo = false)
--   e-mail novo na blocklist      -> troca o endereço e pausa a trilha
--   endereço antigo deu bounce    -> RECOMEÇA a trilha do zero com o novo:
--       apaga os envios antigos (ficam guardados no log), zera as etapas,
--       data_inicio = hoje, limpa o bounce. Lead do PNCP volta para
--       "Aguardando 1º e-mail" (ativo = false, o botão do card reaparece);
--       os demais voltam ativos e o cron manda o E1. Se o card estava em
--       "Sem e-mail válido", volta para "Novos Leads".
--   demais casos                  -> só troca o endereço; a trilha segue
--       de onde estava, sem mexer em ativo.
--   reclamação de spam            -> só troca o endereço, segue pausada.
--
-- Toda troca fica registrada em email_cadencia_trocas_email.

create table if not exists public.email_cadencia_trocas_email (
  id            bigserial primary key,
  contato_id    uuid not null,
  prospect_id   uuid,
  email_antigo  text,
  email_novo    text,
  acao          text not null,
  envios_apagados jsonb,
  criado_em     timestamptz not null default now()
);

alter table public.email_cadencia_trocas_email enable row level security;

grant select, insert, update, delete on table public.email_cadencia_trocas_email to authenticated;
grant select, insert, update, delete on table public.email_cadencia_trocas_email to service_role;
grant usage, select on sequence public.email_cadencia_trocas_email_id_seq to authenticated, service_role;

drop policy if exists email_cadencia_trocas_email_auth on public.email_cadencia_trocas_email;
create policy email_cadencia_trocas_email_auth on public.email_cadencia_trocas_email
  for select to authenticated using (true);

create or replace function public.prospects_sincronizar_email_trilha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c          record;
  v_novo     text := lower(trim(coalesce(new.email, '')));
  v_valido   boolean;
  v_bloq     boolean;
  v_envios   jsonb;
  v_hoje     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_reiniciou boolean := false;
begin
  if lower(trim(coalesce(old.email, ''))) = v_novo then
    return new;
  end if;

  v_valido := v_novo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_bloq := v_valido and exists (
    select 1 from email_blocklist b where lower(trim(b.email)) = v_novo);

  for c in select * from email_cadencia where prospect_id = new.id loop

    if not v_valido then
      update email_cadencia set ativo = false where id = c.id;
      insert into email_cadencia_trocas_email (contato_id, prospect_id, email_antigo, email_novo, acao)
        values (c.id, new.id, c.email, v_novo, 'pausada: e-mail novo vazio ou inválido');

    elsif v_bloq then
      update email_cadencia set email = v_novo, ativo = false where id = c.id;
      insert into email_cadencia_trocas_email (contato_id, prospect_id, email_antigo, email_novo, acao)
        values (c.id, new.id, c.email, v_novo, 'pausada: e-mail novo está na blocklist');

    elsif c.bounce_status = 'bounced_permanent' then
      select coalesce(jsonb_agg(jsonb_build_object('ordem', e.ordem, 'enviado_em', e.enviado_em)), '[]'::jsonb)
        into v_envios from email_envios e where e.contato_id = c.id;
      delete from email_envios where contato_id = c.id;
      update email_cadencia set
        email = v_novo,
        data_inicio = v_hoje,
        ativo = (coalesce(c.origem, '') <> 'pncp_auto'),
        bounce_status = null, bounce_motivo = null, bounce_em = null,
        email_1_sent = false, email_2_sent = false, email_3_sent = false,
        email_4_sent = false, email_5_sent = false,
        email_1_sent_at = null, email_2_sent_at = null, email_3_sent_at = null,
        email_4_sent_at = null, email_5_sent_at = null
      where id = c.id;
      insert into email_cadencia_trocas_email (contato_id, prospect_id, email_antigo, email_novo, acao, envios_apagados)
        values (c.id, new.id, c.email, v_novo,
          case when coalesce(c.origem, '') = 'pncp_auto'
               then 'recomeçada após bounce: aguardando 1º e-mail (PNCP)'
               else 'recomeçada após bounce: cron manda o E1' end,
          v_envios);
      v_reiniciou := true;

    else
      update email_cadencia set email = v_novo where id = c.id;
      insert into email_cadencia_trocas_email (contato_id, prospect_id, email_antigo, email_novo, acao)
        values (c.id, new.id, c.email, v_novo, 'endereço trocado, trilha segue de onde estava');
    end if;
  end loop;

  -- Card parado em "Sem e-mail válido" por causa do bounce volta para a fila,
  -- a menos que a própria edição já tenha movido o card.
  if v_reiniciou and old.status = 'Sem e-mail válido' and new.status = old.status then
    new.status := 'Novos Leads';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_sincronizar_email_trilha on public.prospects;
create trigger trg_prospects_sincronizar_email_trilha
  before update of email on public.prospects
  for each row execute function public.prospects_sincronizar_email_trilha();
