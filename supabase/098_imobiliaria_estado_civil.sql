-- 098 — estado civil do inquilino no cadastro feito pelo portal da imobiliária.
--
-- O portal passou a exigir o estado civil. A Edge Function imobiliaria-nova-cotacao
-- grava o payload inteiro em imobiliaria_clientes e já repassa dados.estado_civil
-- para residential_clients; faltava só a coluna aqui. Aditiva e anulável: os
-- cadastros antigos ficam com null. Tabela existente, então não precisa de grant.

alter table public.imobiliaria_clientes
  add column if not exists estado_civil text;

comment on column public.imobiliaria_clientes.estado_civil is 'Estado civil do inquilino (portal da imobiliária)';
