-- 030 — Rescisão de contrato solicitada pela imobiliária
--
-- Quando o inquilino encerra o contrato de locação, a imobiliária precisa
-- avisar a corretora para que a Fiantec seja informada e a apólice cancelada.
-- Hoje isso acontece por WhatsApp solto, sem os documentos, e o corretor
-- descobre tarde.
--
-- O portal ganha um botão "Rescisão" que só conclui com os dois documentos
-- obrigatórios anexados — sem eles a Fiantec não aceita o cancelamento:
--   rescisao_distrato_url — termo de distrato assinado
--   rescisao_vistoria_url — laudo de vistoria de saída
--   rescisao_obs          — recado livre da imobiliária (débitos, prazos etc.)
--   rescisao_solicitada_em— carimbo do envio. Também serve de trava: com data
--                           preenchida o portal mostra "rescisão em análise"
--                           em vez do botão.

alter table imobiliaria_clientes
  add column if not exists rescisao_solicitada_em timestamptz,
  add column if not exists rescisao_distrato_url  text,
  add column if not exists rescisao_vistoria_url  text,
  add column if not exists rescisao_obs           text;

comment on column imobiliaria_clientes.rescisao_solicitada_em is
  'Quando a imobiliária concluiu o pedido de rescisão no portal.';
comment on column imobiliaria_clientes.rescisao_distrato_url is
  'Termo de distrato assinado, anexado pela imobiliária.';
comment on column imobiliaria_clientes.rescisao_vistoria_url is
  'Laudo de vistoria de saída, anexado pela imobiliária.';
comment on column imobiliaria_clientes.rescisao_obs is
  'Observação livre da imobiliária sobre a rescisão.';
