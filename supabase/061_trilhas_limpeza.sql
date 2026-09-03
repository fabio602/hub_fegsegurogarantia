-- 061_trilhas_limpeza.sql
-- Três correções nas trilhas de e-mail (pedido do Fábio em 03/09/2026):
--
-- 1. Trilha garantia, etapa 6 (dia 30) estava ativa com o texto de modelo
--    ("Título do e-mail", "escreva aqui o texto do e-mail"). Ninguém tinha
--    recebido ainda. Fica desativada até o Fábio escrever o texto.
--
-- 2. Trilha risco-engenharia, e-mails 2 a 5 abriam o corpo com
--    "[NOME_CONTATO], ..." logo abaixo do "Olá, [NOME_CONTATO]!" do molde,
--    e o nome saía duas vezes. Mesmo ajuste feito na judicial (059) e no
--    e-mail 1 desta trilha (060).
--
-- 3. Trilha judicial, e-mail 4: o assunto apareceu no banco como "Recorra
--    Processos Trabalhistas com Tranquilidade" depois da migração 059, sem
--    ninguém da equipe ter editado. Volta ao assunto da 059.

update email_trilha_etapas set ativo = false
where trilha = 'garantia' and ordem = 6;

update email_trilha_etapas set corpo_html = replace(corpo_html,
  '<p style="{{P}}">[NOME_CONTATO], a apólice de risco de engenharia é montada',
  '<p style="{{P}}">A apólice de risco de engenharia é montada')
where trilha = 'risco-engenharia' and ordem = 2;

update email_trilha_etapas set corpo_html = replace(corpo_html,
  '<p style="{{P}}">[NOME_CONTATO], acontece com frequência',
  '<p style="{{P}}">Acontece com frequência')
where trilha = 'risco-engenharia' and ordem = 3;

update email_trilha_etapas set corpo_html = replace(corpo_html,
  '<p style="{{P}}">[NOME_CONTATO], a apólice de risco de engenharia tem que estar',
  '<p style="{{P}}">A apólice de risco de engenharia tem que estar')
where trilha = 'risco-engenharia' and ordem = 4;

update email_trilha_etapas set corpo_html = replace(corpo_html,
  '<p style="{{P}}">[NOME_CONTATO], esta é a última mensagem',
  '<p style="{{P}}">Esta é a última mensagem')
where trilha = 'risco-engenharia' and ordem = 5;

update email_trilha_etapas
set assunto = 'O limite aprovado antes de a próxima condenação chegar'
where trilha = 'judicial' and ordem = 4;
