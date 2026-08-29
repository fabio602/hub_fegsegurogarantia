-- ============================================================================
-- 035: Fonte de e-mail da prospeccao PNCP
--
-- Descoberta em producao: a BrasilAPI (e a Minha Receita) NUNCA retornam
-- e-mail; a Receita retirou o campo dos dados abertos que elas espelham.
-- O e-mail passa a vir de uma cadeia de APIs publicas que ainda o expoem
-- (CNPJa aberta e cnpj.ws), com rate limit baixo (5/min e 3/min).
--
-- Por causa do rate limit, nem todo CNPJ em cache teve o e-mail consultado.
-- A coluna email_consultado separa "consultei e nao tem" (pular para sempre)
-- de "ainda nao consultei" (tentar de novo na proxima execucao).
-- ============================================================================

alter table public.prospeccao_pncp_cnpj_cache
  add column if not exists email_consultado boolean not null default false,
  add column if not exists email_fonte text;

comment on column public.prospeccao_pncp_cnpj_cache.email_consultado is
  'true = a cadeia de e-mail (CNPJa/cnpj.ws) ja respondeu para este CNPJ; tem_email=false com isso true significa que a empresa nao tem e-mail na Receita.';
comment on column public.prospeccao_pncp_cnpj_cache.email_fonte is
  'API que forneceu o e-mail: cnpja ou cnpjws.';
