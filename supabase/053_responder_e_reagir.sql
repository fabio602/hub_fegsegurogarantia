-- 053: responder citando uma mensagem e reagir com emoji
--
-- A Z-API já suporta as duas coisas: o send-text aceita um messageId opcional
-- e vira resposta citada, e existe o endpoint send-reaction. O que faltava era
-- onde guardar isso no nosso lado para a conversa continuar igual depois de
-- recarregar a página.

ALTER TABLE public.whatsapp_messages
  -- Citação: guardamos o zapi_id da mensagem original mais um retrato do texto.
  -- O retrato evita ficar sem nada quando a original é antiga e não está no
  -- lote carregado, ou quando foi apagada depois.
  ADD COLUMN IF NOT EXISTS responde_a       text,
  ADD COLUMN IF NOT EXISTS responde_a_texto text,
  ADD COLUMN IF NOT EXISTS responde_a_de    text,  -- 'inbound' | 'outbound'
  -- Reação: só existem dois lados nesta conversa, então duas colunas bastam
  -- e evitam um jsonb que ninguém consegue consultar.
  ADD COLUMN IF NOT EXISTS reacao_nossa     text,
  ADD COLUMN IF NOT EXISTS reacao_deles     text;

COMMENT ON COLUMN public.whatsapp_messages.responde_a       IS 'zapi_id da mensagem citada';
COMMENT ON COLUMN public.whatsapp_messages.responde_a_texto IS 'Retrato do texto citado, para a bolha não ficar vazia';
COMMENT ON COLUMN public.whatsapp_messages.responde_a_de    IS 'Direção da mensagem citada: inbound ou outbound';
COMMENT ON COLUMN public.whatsapp_messages.reacao_nossa     IS 'Emoji que nós colocamos na mensagem';
COMMENT ON COLUMN public.whatsapp_messages.reacao_deles     IS 'Emoji que o cliente colocou na mensagem';

-- A reação chega pelo webhook referenciando o messageId da Z-API, então
-- precisamos achar a linha por zapi_id rápido.
CREATE INDEX IF NOT EXISTS idx_wamsg_zapi_id
  ON public.whatsapp_messages (zapi_id)
  WHERE zapi_id IS NOT NULL;
