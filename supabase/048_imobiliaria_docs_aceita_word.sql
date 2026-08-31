-- ============================================================================
-- O bucket imobiliaria-docs só aceitava PDF e imagem.
--
-- A tela passou a aceitar Word nos documentos da garantia locatícia, mas o
-- upload continuava sendo recusado pelo storage, com a mensagem
-- "mime type application/vnd.openxmlformats-...wordprocessingml.document is
-- not supported". O contrato de locação quase sempre chega em .docx, então a
-- restrição do bucket precisa acompanhar a da tela.
--
-- Já aplicado no banco; fica aqui para o histórico e para reconstruir o
-- ambiente do zero.
-- ============================================================================

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',                                                        -- .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'    -- .docx
]
where id = 'imobiliaria-docs';
