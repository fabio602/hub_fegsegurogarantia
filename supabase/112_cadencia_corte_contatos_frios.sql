-- ============================================================================
-- 112_cadencia_corte_contatos_frios.sql
-- Desativa os contatos da cadencia com mais de 21 dias de entrada.
--
-- Por que: o cron ficou 12 dias abortando (ver 111) e a fila acumulou 2.156
-- e-mails vencidos. Com teto de 50/dia a fila so zeraria em 03/02/2027, o que
-- significaria mandar o 2o e-mail da trilha em dezembro para quem entrou em
-- setembro. Nao vale: o contato esfriou, a mensagem chega fora de contexto e o
-- unico efeito provavel e bounce e reclamacao de spam, que e exatamente o que
-- a trava de reputacao existe para evitar.
--
-- O que sai: 542 contatos ativos com data_inicio ha mais de 21 dias. Desses,
-- 172 ainda tinham etapa vencida na fila (688 e-mails que deixam de sair) e
-- 370 ja tinham terminado a trilha e estavam ativos sem nada a enviar.
--
-- O que NAO muda: o lead continua no Kanban, com o historico de e-mails
-- intacto em email_envios. `ativo = false` so tira o contato da varredura do
-- cron. O e-mail da licitacao tambem nao e afetado: a tela olha a ordem 1 em
-- email_envios, nao o `ativo`, e 541 dos 542 tem a ordem 1 gravada.
--
-- COMO REVERTER (tudo, ou uma trilha so):
--   update email_cadencia c set ativo = true
--     from public.email_cadencia_desativados_20261016 b
--    where b.contato_id = c.id;                      -- tudo
--   ... and b.trilha = 'garantia';                   -- uma trilha
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A fotografia de quem foi desativado. Guarda o bastante para decidir a
-- reversao sem precisar cruzar com mais nada: trilha, origem, idade e quantas
-- etapas estavam pendentes.
-- ----------------------------------------------------------------------------
create table if not exists public.email_cadencia_desativados_20261016 (
  contato_id         uuid primary key,
  email              text,
  nome_empresa       text,
  trilha             text,
  origem             text,
  data_inicio        date,
  dias_desde_entrada integer,
  etapas_pendentes   integer,
  teve_e1            boolean,
  desativado_em      timestamptz not null default now(),
  motivo             text not null
);

comment on table public.email_cadencia_desativados_20261016 is
  'Contatos desativados em 16/10/2026 por terem mais de 21 dias de entrada, depois dos 12 dias em que o cron da cadencia abortou. Serve para reverter: o SQL de reversao esta no cabecalho da migracao 112.';

-- Atencao ao ler esta coluna numa reversao: ela conta toda etapa vencida e nao
-- enviada do contato, SEM a janela de varredura do cron (data_inicio nos
-- ultimos 25 dias). Contato de 56 dias esta fora da janela e o cron nunca o
-- alcancaria, mas aqui ele aparece com as 4 etapas pendentes. Soma 1.863 na
-- tabela; o efeito real na fila do cron foi de 688 e-mails (2.156 -> 1.468).
comment on column public.email_cadencia_desativados_20261016.etapas_pendentes is
  'Etapas vencidas e nao enviadas do contato, sem aplicar a janela de varredura do cron. Para contato fora da janela (mais de 25 dias) o numero e maior do que o que o cron mandaria de fato.';

alter table public.email_cadencia_desativados_20261016 enable row level security;

-- Sem policy, de proposito: backup nao alimenta tela nenhuma. So a service
-- role, que ignora RLS, alcanca. Mesma decisao da migracao 094, que teve de
-- consertar duas tabelas de backup que estavam legiveis pela chave anon.
grant select, insert, update, delete
  on table public.email_cadencia_desativados_20261016 to service_role;

-- ----------------------------------------------------------------------------
-- O corte. Grava a fotografia e desativa na mesma transacao, para nao existir
-- instante em que o contato esta desativado sem registro de como voltar.
-- ----------------------------------------------------------------------------
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
alvo as (
  select c.id, c.email, c.nome_empresa, c.trilha, c.origem, c.data_inicio,
         ((select d from hoje) - c.data_inicio) as dias,
         (select count(*) from email_trilha_etapas e
           where e.trilha = c.trilha and e.ativo
             and e.dia <= ((select d from hoje) - c.data_inicio)
             and not exists (select 1 from email_envios x
                              where x.contato_id = c.id and x.ordem = e.ordem)
         ) as pendentes,
         exists (select 1 from email_envios x where x.contato_id = c.id and x.ordem = 1) as teve_e1
    from email_cadencia c
   where c.ativo
     and ((select d from hoje) - c.data_inicio) > 21
),
gravado as (
  insert into public.email_cadencia_desativados_20261016
    (contato_id, email, nome_empresa, trilha, origem, data_inicio,
     dias_desde_entrada, etapas_pendentes, teve_e1, motivo)
  select a.id, a.email, a.nome_empresa, a.trilha, a.origem, a.data_inicio,
         a.dias, a.pendentes, a.teve_e1,
         'mais de 21 dias de entrada; fila acumulada pelos 12 dias de cron abortado'
    from alvo a
  on conflict (contato_id) do nothing
  returning contato_id
)
update email_cadencia
   set ativo = false
 where id in (select contato_id from gravado);
