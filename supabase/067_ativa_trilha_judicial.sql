-- 067_ativa_trilha_judicial.sql
-- Liga a trilha judicial (slug 'judicial'), que nasceu inativa na 026. Com
-- ativo = true ela passa a aparecer no seletor de trilhas ao adicionar
-- contato e a entrar na cadência da prospecting-cadence.
--
-- Conferido em 03/09/2026 antes de ativar: as cinco etapas (D+1, D+3, D+7,
-- D+14 e D+21) estão com assunto, título e corpo definitivos, sem nenhum
-- texto de modelo como o encontrado na etapa 6 da trilha garantia.

update email_trilhas
set ativo = true
where slug = 'judicial';
