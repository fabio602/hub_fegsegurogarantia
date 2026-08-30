-- ============================================================================
-- 042: coluna bot_active em whatsapp_leads
--
-- O hub consulta `whatsapp_leads?bot_active=eq.false` em dois lugares (badge
-- do sidebar em App.tsx e item de ação do CommandCenter) para contar leads em
-- que o bot foi desligado e há atendimento humano pendente. A coluna nunca
-- existiu (a tabela nasceu fora do histórico de migrações), então toda
-- consulta respondia 400 e o badge nunca funcionou.
--
-- default TRUE: bot atendendo. A automação de atendimento marca FALSE quando
-- transfere o contato para humano; nesse momento o badge passa a contar.
-- ============================================================================

alter table public.whatsapp_leads
  add column if not exists bot_active boolean not null default true;

comment on column public.whatsapp_leads.bot_active is
  'false = bot desligado para este contato; atendimento humano pendente (conta no badge do hub).';
