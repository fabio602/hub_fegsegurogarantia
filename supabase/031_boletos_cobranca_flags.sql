-- 031 — Cobrança automática por parcela (seguro garantia)
--
-- Até aqui a cobrança automática (garantia-cobranca) olhava só um campo em
-- `sales`: `vencimento_boleto`. Numa venda parcelada isso significa que o
-- cliente era lembrado da parcela 1 e nunca mais — as parcelas 2..N ficavam
-- registradas na tabela `boletos` sem nenhuma cobrança.
--
-- Estas colunas dão à tabela `boletos` o mesmo controle que `sales` já tinha,
-- só que por parcela: cada parcela tem seu próprio D-3, D0 e D+1.
--
-- Vale o mesmo que em `sales`: a marca é definitiva. Uma vez enviado o aviso
-- daquela etapa, ele não se repete — mesmo que a função rode várias vezes no
-- mesmo dia.

ALTER TABLE boletos
  ADD COLUMN IF NOT EXISTS cobranca_d3_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobranca_d0_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobranca_d1_sent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN boletos.cobranca_d3_sent IS 'Aviso de 3 dias antes do vencimento já foi enviado para esta parcela.';
COMMENT ON COLUMN boletos.cobranca_d0_sent IS 'Aviso do dia do vencimento já foi enviado para esta parcela.';
COMMENT ON COLUMN boletos.cobranca_d1_sent IS 'Aviso de vencido (dia seguinte) já foi enviado para esta parcela.';

-- A função busca por data de vencimento entre as parcelas em aberto.
CREATE INDEX IF NOT EXISTS boletos_vencimento_idx
  ON boletos (vencimento)
  WHERE pago = false;

-- Completa a data da parcela 1 das vendas já registradas.
--
-- Quando o boleto era anexado no formulário de venda, a linha em `boletos`
-- nascia só com a URL — sem vencimento. Isso deixava o modal de Boletos sem
-- data e mantinha a venda dependente do campo antigo. A data já existe em
-- `sales.vencimento_boleto`; aqui ela só é copiada para o lugar certo.
UPDATE boletos b
   SET vencimento = s.vencimento_boleto
  FROM sales s
 WHERE s.id = b.sale_id
   AND b.parcela = 1
   AND b.vencimento IS NULL
   AND s.vencimento_boleto IS NOT NULL;

-- Parcelas antigas (cadastradas antes desta migração) não devem gerar uma
-- enxurrada de cobranças retroativas: tudo que já venceu entra como "já
-- avisado". As parcelas futuras seguem o fluxo normal.
UPDATE boletos
   SET cobranca_d3_sent = true,
       cobranca_d0_sent = true,
       cobranca_d1_sent = true
 WHERE vencimento IS NOT NULL
   AND vencimento < CURRENT_DATE;

-- Herda o que a venda já avisou.
--
-- A cobrança de uma venda à vista sai de `sales`; a partir de agora, se a
-- parcela 1 tem a mesma data, ela passa a mandar no lugar. Sem herdar as
-- marcas, um aviso já enviado hoje pela venda sairia de novo pela parcela.
UPDATE boletos b
   SET cobranca_d3_sent = b.cobranca_d3_sent OR s.cobranca_d3_sent,
       cobranca_d0_sent = b.cobranca_d0_sent OR s.cobranca_d0_sent,
       cobranca_d1_sent = b.cobranca_d1_sent OR s.cobranca_d1_sent
  FROM sales s
 WHERE s.id = b.sale_id
   AND b.vencimento IS NOT NULL
   AND b.vencimento = s.vencimento_boleto;
