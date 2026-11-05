-- 133: comissão escalonada do parceiro passa a incidir sobre a comissão líquida.
--
-- Até aqui (migração 129) a comissão líquida do negócio, depois do imposto
-- (imposto_pct), só escolhia a faixa, e o percentual incidia sobre a comissão
-- integral. Em 05/11/2026 o Fábio decidiu que o percentual incide sobre a
-- líquida: comissão de R$ 1.000,00, líquida de R$ 940,00, faixa de 10%, o
-- parceiro recebe R$ 94,00 (antes, R$ 100,00).
--
-- O cálculo mora em supabase/functions/_shared/comissaoParceiro.ts (portal e
-- HUB). Aqui só muda a documentação da coluna; os dados não mudam.

comment on column public.partners.comissao_faixas is
  'Comissão escalonada do parceiro. Formato: {"imposto_pct":6,"faixas":[{"ate":10000,"pct":10},...,{"ate":null,"pct":50}]}. A comissão líquida do negócio (comissão menos imposto_pct) escolhe a faixa e o pct incide sobre essa líquida (desde 05/11/2026; antes incidia sobre a integral). Nulo = usa commission_pct fixo sobre a comissão integral.';
