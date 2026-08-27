-- Valor de cada parcela do prêmio.
-- Sem ele o portal do parceiro só consegue mostrar a comissão total; com ele
-- dá para ratear a comissão parcela a parcela e mostrar quanto o parceiro
-- recebe de fato em cada uma.
--
-- Fica nulo de propósito: os boletos já cadastrados continuam funcionando
-- exatamente como antes, e o portal só troca a exibição quando o valor existe.
alter table boletos
  add column if not exists valor numeric(12,2);

comment on column boletos.valor is
  'Valor da parcela do prêmio, em reais. Usado para ratear a comissão do parceiro por parcela.';
