-- 113: aviso de vencimento passa a identificar a apólice.
-- Antes o e-mail só dizia produto, seguradora e data, e o cliente com várias
-- apólices não sabia de qual se tratava. A função email-followup agora busca a
-- venda pelo saleId e preenche [DETALHES] (modalidade, seguradora, tomador,
-- segurado, contrato, objeto, valores e vigência; campo vazio não aparece) e
-- [ORIENTACAO] (execução pede o termo aditivo ou a confirmação de conclusão;
-- demais modalidades, renovação). Residencial e Auto, sem saleId, continuam
-- recebendo só vencimento e dias restantes dentro de [DETALHES].

update public.email_modelos
set assunto   = '[EMOJI] Sua apólice de [PRODUTO][REFERENCIA] vence em [DIAS] (F&G Corretora)',
    titulo    = '[EMOJI] Aviso de vencimento: [DIAS]',
    corpo_html = '<p>Olá, <strong>[NOME]</strong>.</p>
<p>A apólice abaixo vence em <strong>[VENCIMENTO]</strong>. Seguem os dados para você identificar de qual se trata:</p>
[DETALHES]
[ORIENTACAO]',
    cta_texto = 'Falar com a F&G pelo WhatsApp',
    cta_link  = 'https://wa.me/5515998618659?text=Ol%C3%A1!%20Sobre%20o%20vencimento%20da%20minha%20ap%C3%B3lice%20de%20[PRODUTO_URL].',
    updated_at = now()
where chave = 'renewal';
