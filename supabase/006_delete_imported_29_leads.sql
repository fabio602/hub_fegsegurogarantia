-- Exclui os 29 leads importados do CSV "(3) Pedido de Orçamento.csv".
-- Rode no Supabase SQL Editor.

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

commit;
