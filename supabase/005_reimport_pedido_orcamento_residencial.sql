-- Reimporta o CSV "(3) Pedido de Orçamento.csv" com texto correto (UTF-8).
-- Uso: rode este SQL no Supabase SQL Editor.
-- Ele remove os registros importados anteriormente por e-mail e reinsere com os valores corretos.

begin;

delete from public.residential_clients
where origem_publica is true
  and situacao = 'Lead (site)'
  and email in (
    'jessica.mnt2014@gmail.com','guitoarruda03@gmail.com','camilainfante602@gmail.com',
    'bruno.rcomercial@gmail.com','alan@as-refrigeracao.com.br','eli.lubile@gmail.com',
    'roseilda10@hotmail.com','vjosy2450@gmail.com','carolrodrigues.sousa1@gmail.com',
    'geovanna.gsantos@outlook.com','gabriellecarnauba98@gmail.com','andrenucci29@gmail.com',
    'christinanucci@gmail.com','pamelarh@gmail.com','rogerzl_79@hotmail.com',
    'camilaveronicamessias@gmail.com','vicristina.s.silva@gmail.com','samanthapaludeto@gmail.com',
    'nbeatrizif@gmail.com','luanapereira.isa@gmail.com','magnaldosouzadoss@gmail.com',
    'jayne-cristina@hotmal.com','dany.g.santos1984@gmail.com','daniel@enroladoegranulado.com.br',
    'rb.elaine@gmail.com','uberjaque051015@gmail.com','gislaine.albu@gmail.com','thotymaga@gmail.com'
  );

insert into public.residential_clients (
  nome, email, produto, situacao, origem_publica, created_at,
  telefone, cpf, apolice, premio_total, comissao, data_emissao, fim_vigencia,
  forma_pagamento, obs, tem_garantia, garantia_inicio, garantia_fim, garantia_valor
)
values
  ('Jessica Mnt2014','jessica.mnt2014@gmail.com','Residencial','Lead (site)',true,'2026-03-24 10:06:56+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Guitoarruda03','guitoarruda03@gmail.com','Residencial','Lead (site)',true,'2026-03-23 14:55:22+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Camilainfante602','camilainfante602@gmail.com','Residencial','Lead (site)',true,'2026-03-12 10:26:18+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Bruno Rcomercial','bruno.rcomercial@gmail.com','Residencial','Lead (site)',true,'2026-03-10 12:29:10+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Alan','alan@as-refrigeracao.com.br','Residencial','Lead (site)',true,'2026-03-10 11:34:24+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Eli Lubile','eli.lubile@gmail.com','Residencial','Lead (site)',true,'2026-02-19 14:24:08+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Roseilda10','roseilda10@hotmail.com','Residencial','Lead (site)',true,'2026-02-10 10:38:09+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Vjosy2450','vjosy2450@gmail.com','Residencial','Lead (site)',true,'2026-02-09 13:08:44+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Carolrodrigues Sousa1','carolrodrigues.sousa1@gmail.com','Residencial','Lead (site)',true,'2026-01-31 10:05:56+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Geovanna Gsantos','geovanna.gsantos@outlook.com','Residencial','Lead (site)',true,'2026-01-28 15:30:03+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Gabriellecarnauba98','gabriellecarnauba98@gmail.com','Residencial','Lead (site)',true,'2026-01-28 15:23:32+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Andrenucci29','andrenucci29@gmail.com','Residencial','Lead (site)',true,'2026-01-23 09:15:25+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Christinanucci','christinanucci@gmail.com','Residencial','Lead (site)',true,'2026-01-22 14:15:54+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Pamelarh','pamelarh@gmail.com','Residencial','Lead (site)',true,'2026-01-21 11:55:58+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Rogerzl 79','rogerzl_79@hotmail.com','Residencial','Lead (site)',true,'2026-01-16 13:48:53+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Camilaveronicamessias','camilaveronicamessias@gmail.com','Residencial','Lead (site)',true,'2025-12-12 14:30:03+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Vicristina S Silva','vicristina.s.silva@gmail.com','Residencial','Lead (site)',true,'2025-12-06 12:34:13+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Samanthapaludeto','samanthapaludeto@gmail.com','Residencial','Lead (site)',true,'2025-12-06 11:29:11+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Nbeatrizif','nbeatrizif@gmail.com','Residencial','Lead (site)',true,'2025-12-03 12:25:18+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Luanapereira Isa','luanapereira.isa@gmail.com','Residencial','Lead (site)',true,'2025-12-02 15:10:37+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Magnaldosouzadoss','magnaldosouzadoss@gmail.com','Residencial','Lead (site)',true,'2025-11-27 13:41:38+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Luanapereira Isa','luanapereira.isa@gmail.com','Residencial','Lead (site)',true,'2025-11-24 11:03:05+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Jayne Cristina','jayne-cristina@hotmal.com','Residencial','Lead (site)',true,'2025-11-21 15:58:28+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Dany G Santos1984','dany.g.santos1984@gmail.com','Residencial','Lead (site)',true,'2025-11-18 10:05:21+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Daniel','daniel@enroladoegranulado.com.br','Residencial','Lead (site)',true,'2025-11-10 12:09:25+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Rb Elaine','rb.elaine@gmail.com','Residencial','Lead (site)',true,'2025-11-03 14:25:24+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Uberjaque051015','uberjaque051015@gmail.com','Residencial','Lead (site)',true,'2025-10-28 16:00:08+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Gislaine Albu','gislaine.albu@gmail.com','Residencial','Lead (site)',true,'2025-10-28 11:34:27+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null),
  ('Thotymaga','thotymaga@gmail.com','Residencial','Lead (site)',true,'2025-10-27 12:18:58+00',null,null,null,null,null,null,null,null,null,'Não',null,null,null);

commit;
