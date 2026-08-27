-- 027_seguradoras_contato_comercial.sql
-- Contato comercial (gerente, telefone/WhatsApp e e-mail) em todos os cadastros
-- de seguradoras. A tabela `insurers` (Seguro Garantia) já tinha essas colunas —
-- aqui só igualamos as demais, porque a tela InsuranceDirectory é a mesma para todas.

alter table seguradoras_auto        add column if not exists gerente text;
alter table seguradoras_auto        add column if not exists contato text;
alter table seguradoras_auto        add column if not exists email   text;

alter table seguradoras_rc          add column if not exists gerente text;
alter table seguradoras_rc          add column if not exists contato text;
alter table seguradoras_rc          add column if not exists email   text;

alter table seguradoras_residencial add column if not exists gerente text;
alter table seguradoras_residencial add column if not exists contato text;
alter table seguradoras_residencial add column if not exists email   text;

alter table garantidoras_residencial add column if not exists gerente text;
alter table garantidoras_residencial add column if not exists contato text;
alter table garantidoras_residencial add column if not exists email   text;

comment on column seguradoras_auto.gerente         is 'Nome do gerente comercial';
comment on column seguradoras_auto.contato         is 'Telefone do gerente — vira link de WhatsApp na tela';
comment on column seguradoras_rc.gerente           is 'Nome do gerente comercial';
comment on column seguradoras_rc.contato           is 'Telefone do gerente — vira link de WhatsApp na tela';
comment on column seguradoras_residencial.gerente  is 'Nome do gerente comercial';
comment on column seguradoras_residencial.contato  is 'Telefone do gerente — vira link de WhatsApp na tela';
comment on column garantidoras_residencial.gerente is 'Nome do gerente comercial';
comment on column garantidoras_residencial.contato is 'Telefone do gerente — vira link de WhatsApp na tela';
