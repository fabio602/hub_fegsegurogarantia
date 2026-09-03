-- 063_sales_motivo_perda.sql
-- O formulário de venda tinha o select "Motivo da perda" (aparece quando
-- Vendeu = Não) desde sempre, mas o campo não entrava no payload e não
-- existia a coluna. Tudo o que foi escolhido ali se perdia. Nome em camelCase
-- entre aspas para bater com a chave que o front envia, como "orgaoLicitante".
alter table sales add column if not exists "motivoPerda" text;
