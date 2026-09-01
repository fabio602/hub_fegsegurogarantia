-- 054 — Visto (entregue/lido) e "digitando..." no WhatsApp do hub.
--
-- Duas coisas independentes:
--  1. A coluna status de whatsapp_messages passa a receber também 'delivered',
--     'read' e 'played', vindos do MessageStatusCallback da Z-API. Antes só
--     existia 'sent' no enviado e 'received' no recebido, então não dava para
--     saber se o cliente tinha lido.
--  2. Uma tabela nova guarda a presença do contato (digitando, gravando), que
--     é um estado momentâneo e não pertence a nenhuma mensagem.

create table if not exists public.whatsapp_presenca (
  phone         text primary key,
  -- 'available' | 'unavailable' | 'composing' | 'recording'
  estado        text not null default 'available',
  atualizado_em timestamptz not null default now()
);

alter table public.whatsapp_presenca enable row level security;

drop policy if exists "presenca_leitura_autenticada" on public.whatsapp_presenca;
create policy "presenca_leitura_autenticada"
  on public.whatsapp_presenca for select
  to authenticated
  using (true);

-- Quem escreve é a Edge Function do webhook, com a service role, que passa
-- por cima do RLS. O hub só lê.

-- Realtime: sem isso o "digitando..." só apareceria no próximo poll.
do $$
begin
  alter publication supabase_realtime add table public.whatsapp_presenca;
exception
  when duplicate_object then null;
end $$;

-- O status callback chega com uma lista de ids, então o filtro é sempre por
-- zapi_id. O índice parcial de 053 já cobre isso.
