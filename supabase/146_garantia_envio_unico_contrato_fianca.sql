-- ============================================================================
-- Garantia locatícia: e-mail da apólice enviado uma vez só e terceiro anexo.
--
-- Contexto (27/11/2026, caso Ariel Campos de Oliveira, S8G-2026-54585): a
-- imobiliária recebeu o mesmo e-mail duas vezes, porque anexar a apólice no
-- cadastro do Repasse e depois na ficha do Registro de Vendas disparava a
-- função `imobiliaria-envia-apolice` nos dois lugares. E a S8 Garante manda
-- três documentos (Resumo, Contrato de Fiança e Cláusula), mas só havia dois
-- campos de anexo.
--
--   apolice_garantia_enviada_em      quando o e-mail da garantia saiu
--   apolice_residencial_enviada_em   quando o e-mail do residencial saiu
--   contrato_fianca_url              contrato de fiança (condições gerais) que
--                                    a garantidora emite para o inquilino
--
-- A função só envia de novo quando o corretor confirma o reenvio na tela.
-- Só acrescenta colunas: nenhuma tabela nova, então não há grant a conceder.
-- ============================================================================

alter table imobiliaria_clientes
  add column if not exists contrato_fianca_url text,
  add column if not exists apolice_garantia_enviada_em timestamptz,
  add column if not exists apolice_residencial_enviada_em timestamptz;

alter table residential_clients
  add column if not exists contrato_fianca_url text;

comment on column imobiliaria_clientes.contrato_fianca_url is
  'Contrato de fiança (condições gerais) emitido pela garantidora. Vai anexado no e-mail da apólice da garantia, junto do termo da cláusula.';
comment on column imobiliaria_clientes.apolice_garantia_enviada_em is
  'Quando o e-mail da apólice da garantia saiu para a imobiliária. Preenchido pela função imobiliaria-envia-apolice; com valor, ela só reenvia se receber reenviar = true.';
comment on column imobiliaria_clientes.apolice_residencial_enviada_em is
  'Quando o e-mail da apólice do residencial saiu para a imobiliária. Mesma regra da garantia.';
comment on column residential_clients.contrato_fianca_url is
  'Espelho de imobiliaria_clientes.contrato_fianca_url no Registro de Vendas.';

-- Único envio cuja hora é conhecida com certeza: o da Ariel, que originou esta
-- correção (segundo e-mail às 11h24 de 27/11/2026, horário de Brasília). Os
-- cadastros antigos ficam sem data: a tela mostra "Enviar" e pede confirmação.
update imobiliaria_clientes
set apolice_garantia_enviada_em = '2026-11-27T14:24:17Z',
    status_garantia = 'emitido'
where numero_apolice = 'S8G-2026-54585'
  and apolice_garantia_enviada_em is null;
