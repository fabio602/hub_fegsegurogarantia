-- Trilha de conteúdo da cadência de prospecção por e-mail.
--   'garantia' -> licitações públicas (a trilha original)
--   'energia'  -> Seguro Garantia de Pagamento de Energia (mercado livre / ACL)
-- O default é 'garantia' de propósito: os contatos já cadastrados continuam
-- recebendo exatamente os mesmos e-mails de antes.
alter table email_cadencia
  add column if not exists trilha text not null default 'garantia';

alter table email_cadencia
  drop constraint if exists email_cadencia_trilha_check;

alter table email_cadencia
  add constraint email_cadencia_trilha_check
  check (trilha in ('garantia', 'energia'));

create index if not exists idx_email_cadencia_trilha
  on email_cadencia (trilha);

comment on column email_cadencia.trilha is
  'Qual conjunto de 5 e-mails o contato recebe. Os textos ficam na Edge Function prospecting-cadence.';
