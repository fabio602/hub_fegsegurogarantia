-- 050: índice composto para abrir conversa do WhatsApp mais rápido
--
-- O hub sempre lê as mensagens de um telefone ordenadas por data, e agora
-- pagina (últimas 80, depois o lote anterior). Com os índices separados de
-- phone e created_at o Postgres filtrava por telefone e ordenava depois.
-- Com o composto ele lê direto na ordem certa e para nas 80 primeiras.

CREATE INDEX IF NOT EXISTS idx_wamsg_phone_created
  ON public.whatsapp_messages (phone, created_at DESC);
