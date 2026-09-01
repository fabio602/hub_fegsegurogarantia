-- 051: guardar a mídia das conversas do WhatsApp
--
-- Até aqui a única mídia com endereço era o áudio (audio_url). Imagem, vídeo
-- e documento viravam texto ("[Imagem: foto.jpg]") e o arquivo em si se perdia:
-- no recebido o webhook nem chegava a salvar, e no enviado o base64 ia para a
-- Z-API e sumia. Com estas colunas a bolha passa a mostrar a mídia de verdade,
-- como no WhatsApp Web.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_url  text,
  ADD COLUMN IF NOT EXISTS media_type text,  -- 'image' | 'video' | 'document' | 'audio' | 'sticker'
  ADD COLUMN IF NOT EXISTS media_name text;  -- nome original do arquivo, para o cartão de documento

COMMENT ON COLUMN public.whatsapp_messages.media_url  IS 'Endereço público do arquivo (bucket whatsapp-midia ou URL da Z-API)';
COMMENT ON COLUMN public.whatsapp_messages.media_type IS 'image, video, document, audio ou sticker';
COMMENT ON COLUMN public.whatsapp_messages.media_name IS 'Nome original do arquivo';

-- Bucket dos arquivos que NÓS enviamos. O recebido continua apontando para a
-- URL que a Z-API devolve, que já é servida por eles.
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-midia', 'whatsapp-midia', true)
ON CONFLICT (id) DO NOTHING;

-- Quem está logado no hub pode subir e apagar; leitura é pública (o caminho
-- tem uuid, então não dá para adivinhar o arquivo de um cliente).
DROP POLICY IF EXISTS "wa midia leitura publica" ON storage.objects;
CREATE POLICY "wa midia leitura publica" ON storage.objects
  FOR SELECT USING (bucket_id = 'whatsapp-midia');

DROP POLICY IF EXISTS "wa midia envio autenticado" ON storage.objects;
CREATE POLICY "wa midia envio autenticado" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'whatsapp-midia');

DROP POLICY IF EXISTS "wa midia exclusao autenticado" ON storage.objects;
CREATE POLICY "wa midia exclusao autenticado" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'whatsapp-midia');
