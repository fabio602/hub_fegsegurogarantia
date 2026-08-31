-- ============================================================================
-- Campo próprio para o termo com a cláusula do seguro.
--
-- Contexto: no modal do Repasse foi criado um anexo chamado "Contrato de
-- Locação" apontando para doc_contrato_url. Só que doc_contrato_url é o
-- contrato assinado que a IMOBILIÁRIA envia pelo portal, e a checklist de lá
-- usa esse campo para saber o que ainda falta. São documentos que andam em
-- sentidos opostos:
--
--   doc_contrato_url    imobiliária -> F&G   contrato de locação assinado
--   termo_clausula_url  F&G -> imobiliária   termo com a cláusula do seguro,
--                                            que ela precisa incluir no contrato
--
-- Deixar os dois no mesmo campo faria a pendência do portal sumir sozinha sem
-- a imobiliária ter mandado nada.
--
-- O único registro que já usava o campo errado é o do Tiago Pegoraro, anexado
-- hoje por esta tela; o UPDATE abaixo devolve o arquivo para o lugar certo e
-- limpa a pendência falsa. Nenhum contrato vindo do portal é afetado.
-- ============================================================================

alter table imobiliaria_clientes
  add column if not exists termo_clausula_url text;

comment on column imobiliaria_clientes.termo_clausula_url is
  'Termo com a cláusula do seguro que a F&G manda para a imobiliária incluir no contrato de locação. Vai anexado no e-mail da apólice da garantia.';

update imobiliaria_clientes
set termo_clausula_url = doc_contrato_url,
    doc_contrato_url = null
where doc_contrato_url like '%/apolices/%doc_contrato_url_%';
