-- ============================================================================
-- 038: Classificacao do e-mail e socio administrador na prospeccao PNCP
--
-- Pedido do Fabio apos analisar o primeiro XLSX de dry run:
--   1. Coluna tipo_email no lead: 'contador' (dominio/prefixo indica
--      contabilidade), 'generico_corporativo' (fiscal@, juridico@ etc.) ou
--      'direto'. Nenhum e bloqueado; o XLSX ordena com 'direto' primeiro.
--   2. Registrar o socio ADMINISTRADOR (nao o primeiro do QSA), para o
--      follow-up por telefone da Bruna.
-- Os padroes de classificacao sao configuraveis na tabela de configuracao.
-- ============================================================================

alter table public.prospeccao_pncp_config
  add column if not exists email_padroes_contador text[] not null
    default '{contab,contabil,contadores,contador,itax,fiscalcon,assessoriacont,escritoriocont}',
  add column if not exists email_prefixos_genericos text[] not null
    default '{fiscal,juridico,paralegal,normativos,compliance,dl-}';

comment on column public.prospeccao_pncp_config.email_padroes_contador is
  'Trechos (minusculos, sem @) que, presentes no e-mail, marcam tipo_email = contador. Nao bloqueiam o envio.';
comment on column public.prospeccao_pncp_config.email_prefixos_genericos is
  'Prefixos do e-mail (antes do @) que marcam tipo_email = generico_corporativo. Nao bloqueiam o envio.';

alter table public.prospeccao_pncp_leads
  add column if not exists tipo_email text
    check (tipo_email in ('direto', 'generico_corporativo', 'contador')),
  add column if not exists socio text;

comment on column public.prospeccao_pncp_leads.tipo_email is
  'Classificacao do e-mail: direto, generico_corporativo ou contador. So marcacao; nada e bloqueado por isso.';
comment on column public.prospeccao_pncp_leads.socio is
  'Socio administrador (ou o primeiro do QSA, na falta), para follow-up por telefone.';
