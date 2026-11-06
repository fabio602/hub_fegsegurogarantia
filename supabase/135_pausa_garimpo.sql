-- 135: pausa do garimpo (06/11/2026, decisão do Fábio)
--
-- O garimpo (energia, imobiliárias e consultores) nunca gerou resultado:
-- cerca de 675 contatos por WhatsApp e as trilhas de e-mail sem retorno.
-- A prospecção passa a focar nos homologados do PNCP com o contato lido
-- das propostas. Nada é apagado; tudo aqui é reversível.
--
-- 1) As três campanhas ficam inativas (a de saúde já estava).
-- 2) O agendamento garimpo-daily fica pausado.
-- 3) Os leads de garimpo saem da cadência de e-mail. A lista de quem
--    estava ativo fica em garimpo_pausa_cadencia para poder voltar:
--      update email_cadencia set ativo = true
--       where id in (select cadencia_id from garimpo_pausa_cadencia);
--
-- A trilha garantia (leads do PNCP) não é tocada.

update public.campanhas_garimpo
   set ativo = false, updated_at = now()
 where slug in ('energia', 'imobiliarias', 'consultores');

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'garimpo-daily'), active := false);

create table if not exists public.garimpo_pausa_cadencia (
  cadencia_id uuid primary key,
  trilha text,
  origem text,
  pausado_em timestamptz not null default now()
);

alter table public.garimpo_pausa_cadencia enable row level security;
grant select, insert, update, delete on table public.garimpo_pausa_cadencia to service_role;

insert into public.garimpo_pausa_cadencia (cadencia_id, trilha, origem)
select id, trilha, origem
  from public.email_cadencia
 where ativo and origem like 'garimpo\_%'
on conflict do nothing;

update public.email_cadencia
   set ativo = false
 where id in (select cadencia_id from public.garimpo_pausa_cadencia);
