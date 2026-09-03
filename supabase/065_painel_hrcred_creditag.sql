-- 065_painel_hrcred_creditag.sql
-- Complemento da 064. HR Cred e Creditag tinham vendas mas não estavam no
-- painel de seguradoras; o Fábio decidiu cadastrar as duas. `insurers.id`
-- não tem sequence, por isso o id é calculado. As vendas ficam com o nome
-- do painel ("CREDITAG" vira "Creditag"). O backup da 064 continua valendo.
insert into insurers (id, nome)
select (select coalesce(max(id), 0) + 1 from insurers), 'Creditag'
where not exists (select 1 from insurers where nome = 'Creditag');

insert into insurers (id, nome)
select (select coalesce(max(id), 0) + 1 from insurers), 'HR Cred'
where not exists (select 1 from insurers where nome = 'HR Cred');

update sales set seguradora = 'Creditag' where trim(seguradora) in ('CREDITAG', 'Creditag');
update sales set seguradora = 'HR Cred'  where trim(seguradora) in ('HR Cred');
