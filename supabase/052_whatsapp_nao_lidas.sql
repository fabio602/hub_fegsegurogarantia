-- 052: contador de mensagens não lidas por conversa
--
-- O hub não tinha como saber o que já foi visto: toda conversa parecia igual
-- e a única pista era a ordem por updated_at. Guardamos em lido_em o instante
-- em que a conversa foi aberta pela última vez e contamos as recebidas depois
-- disso, que é o mesmo critério da bolinha verde do WhatsApp.

ALTER TABLE public.whatsapp_leads
  ADD COLUMN IF NOT EXISTS lido_em timestamptz;

COMMENT ON COLUMN public.whatsapp_leads.lido_em IS 'Última vez que a conversa foi aberta no hub. Base do contador de não lidas.';

-- Conversa nunca aberta não deve aparecer com o histórico inteiro por ler,
-- então quem já existe começa zerado.
UPDATE public.whatsapp_leads SET lido_em = now() WHERE lido_em IS NULL;

-- Uma consulta só devolve o contador de todas as conversas. Fazer isso no
-- cliente exigiria varrer as 2.800 mensagens a cada 10 segundos.
CREATE OR REPLACE FUNCTION public.whatsapp_nao_lidas()
RETURNS TABLE (phone text, nao_lidas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.phone, count(m.id) AS nao_lidas
  FROM public.whatsapp_leads l
  JOIN public.whatsapp_messages m
    ON m.phone = l.phone
   AND m.direction = 'inbound'
   AND m.created_at > coalesce(l.lido_em, '-infinity'::timestamptz)
  GROUP BY l.phone;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_nao_lidas() TO authenticated;
