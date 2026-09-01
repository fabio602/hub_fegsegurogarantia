-- Grupos do WhatsApp no hub.
--
-- Antes o webhook descartava tudo que vinha de grupo: mensagem com
-- participantPhone caía em "group_inbound" e o id do grupo
-- (120363379108469082-group) era barrado pela guarda que rejeita telefone
-- com hífen. Agora o grupo entra na lista como qualquer outra conversa.
--
-- Duas informações novas fazem falta:
--  - o lead precisa saber que é grupo, para o hub trocar o ícone, esconder
--    o "Adicionar ao CRM" e não deixar o bot de boas-vindas responder lá;
--  - cada mensagem recebida precisa dizer quem escreveu, porque num grupo
--    o `name` é o nome do grupo e não o de quem falou.

alter table whatsapp_leads
  add column if not exists e_grupo boolean not null default false;

alter table whatsapp_messages
  -- Nome de quem escreveu, só nas recebidas de grupo. Null nas conversas
  -- de um para um, onde quem escreveu já é o próprio contato.
  add column if not exists autor text;

comment on column whatsapp_leads.e_grupo is 'Conversa é um grupo do WhatsApp (phone termina em -group).';
comment on column whatsapp_messages.autor is 'Nome de quem enviou dentro do grupo. Null fora de grupo.';

-- Marca como grupo o que já estiver no banco com id de grupo, caso alguma
-- linha tenha escapado antes das guardas.
update whatsapp_leads set e_grupo = true where phone like '%-group';
