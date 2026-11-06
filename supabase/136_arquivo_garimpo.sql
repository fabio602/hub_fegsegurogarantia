-- 136: arquivo dos leads de garimpo (06/11/2026, decisão do Fábio)
--
-- Complemento da 135. Os leads de garimpo (energia, imobiliárias e
-- consultores) saem do Kanban com o status 'Arquivo Garimpo', que não é
-- coluna e o quadro sempre esconde (ProspectsKanban.tsx, statusArquivado).
-- Ficam de fora os que alguém já puxou para a própria coluna
-- (responsavel_email preenchido ou status de coluna pessoal).
--
-- Nada é apagado. O status anterior fica em garimpo_arquivo_status:
--   update prospects p set status = a.status_anterior
--     from garimpo_arquivo_status a where a.prospect_id = p.id;

create table if not exists public.garimpo_arquivo_status (
  prospect_id uuid primary key,
  status_anterior text,
  arquivado_em timestamptz not null default now()
);

alter table public.garimpo_arquivo_status enable row level security;
grant select, insert, update, delete on table public.garimpo_arquivo_status to service_role;

insert into public.garimpo_arquivo_status (prospect_id, status_anterior)
select id, status
  from public.prospects
 where source like 'garimpo\_%'
   and responsavel_email is null
   and status in ('Novos Leads', 'Contato por WhatsApp', 'Sem e-mail válido')
on conflict do nothing;

update public.prospects
   set status = 'Arquivo Garimpo',
       status_entered_at = now()
 where id in (select prospect_id from public.garimpo_arquivo_status);
