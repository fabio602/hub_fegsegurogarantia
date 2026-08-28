-- 031 — Lembrete de vencimento por parcela (seguro garantia)
--
-- Até aqui o lembrete automático (garantia-cobranca) olhava só um campo em
-- `sales`: `vencimento_boleto`. Numa venda parcelada isso significa que o
-- cliente era lembrado da parcela 1 e nunca mais — as parcelas 2..N ficavam
-- registradas na tabela `boletos` sem nenhum aviso.
--
-- Esta coluna dá à tabela `boletos` o mesmo controle que `sales` já tinha,
-- só que por parcela: cada parcela tem seu próprio D-3.
--
-- Só existe o aviso de 3 dias ANTES do vencimento. Avisos no dia e de
-- "venceu ontem" foram removidos de propósito — eles exigiriam manter a
-- marca `pago` de cada parcela em dia para não cobrar quem já pagou, e esse
-- controle manual não se sustenta. A inadimplência é tratada à parte, pelo
-- relatório mensal das seguradoras.
--
-- A marca é definitiva: uma vez enviado o lembrete daquela parcela, ele não
-- se repete — mesmo que a função rode várias vezes no mesmo dia.

ALTER TABLE boletos
  ADD COLUMN IF NOT EXISTS cobranca_d3_sent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN boletos.cobranca_d3_sent IS 'Lembrete de 3 dias antes do vencimento já foi enviado para esta parcela.';

-- A função busca por data de vencimento entre as parcelas.
CREATE INDEX IF NOT EXISTS boletos_vencimento_idx ON boletos (vencimento);

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
-- enxurrada de avisos retroativos: tudo que já venceu entra como "já
-- avisado". As parcelas futuras seguem o fluxo normal.
UPDATE boletos
   SET cobranca_d3_sent = true
 WHERE vencimento IS NOT NULL
   AND vencimento < CURRENT_DATE;

-- Herda o que a venda já avisou.
--
-- O lembrete de uma venda à vista sai de `sales`; a partir de agora, se a
-- parcela 1 tem a mesma data, ela passa a mandar no lugar. Sem herdar a
-- marca, um aviso já enviado hoje pela venda sairia de novo pela parcela.
UPDATE boletos b
   SET cobranca_d3_sent = true
  FROM sales s
 WHERE s.id = b.sale_id
   AND b.vencimento IS NOT NULL
   AND b.vencimento = s.vencimento_boleto
   AND s.cobranca_d3_sent = true;
