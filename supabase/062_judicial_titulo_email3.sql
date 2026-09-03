-- 062_judicial_titulo_email3.sql
-- Complemento da 061. Além do assunto do e-mail 4, o título do e-mail 3 da
-- trilha judicial também apareceu alterado no banco ("Seguro Garantia:<br>
-- Protege seu capital") depois da migração 059, por edições feitas pela tela
-- de trilhas do hub em 03/09/2026 entre 05:35 e 05:37 (horário de Brasília).
-- Volta ao título da 059. Corpo, assunto, tagline e botão já estavam iguais.

update email_trilha_etapas
set titulo = 'Não é uma boa ideia:<br>está na CLT'
where trilha = 'judicial' and ordem = 3;
