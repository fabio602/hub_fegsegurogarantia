-- 055: lista de conversas em tempo real
--
-- A barra lateral do hub só se atualizava por polling de 10 em 10 segundos,
-- então uma mensagem nova podia levar até 10s para aparecer na lista. Colocar
-- whatsapp_leads na publicação do Realtime permite assinar INSERT/UPDATE e
-- reordenar a lista no instante em que a mensagem chega.
do $$
begin
  alter publication supabase_realtime add table public.whatsapp_leads;
exception
  when duplicate_object then null;
end
$$;

-- REPLICA IDENTITY FULL faz o Postgres mandar a linha inteira no payload de
-- UPDATE. Sem isso o Realtime só entrega a chave primária no registro antigo,
-- e a lista não conseguiria reordenar sem uma consulta extra.
alter table public.whatsapp_leads replica identity full;
alter table public.whatsapp_messages replica identity full;
