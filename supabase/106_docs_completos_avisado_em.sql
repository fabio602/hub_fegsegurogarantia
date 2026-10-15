-- 106 — Aviso ao Fábio quando a imobiliária completa os documentos da garantia
--
-- Quando o terceiro documento (contrato, termo de vistoria, fotos da vistoria)
-- chega pelo portal, a Edge Function `imobiliaria-docs-completos` manda um
-- e-mail ao Fábio com os três links. Esta coluna é o carimbo desse envio: o
-- aviso sai uma vez por cadastro, mesmo que a imobiliária reenvie um arquivo.

alter table public.imobiliaria_clientes
  add column if not exists docs_completos_avisado_em timestamptz;
