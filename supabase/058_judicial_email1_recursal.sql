-- 058_judicial_email1_recursal.sql
-- Reescreve o e-mail 1 da trilha judicial com foco em depósito recursal
-- trabalhista (pedido do Fábio em 02/09/2026). O intervalo (dia = 1) e os
-- e-mails 2 a 5 ficam como estão. O molde visual continua vindo da Edge
-- Function prospecting-cadence ({{P}}/{{PF}}, faixa navy, quadro dourado,
-- assinatura); aqui só muda o conteúdo da etapa.

update email_trilha_etapas
set
  assunto = 'Recorrer sem tirar o dinheiro do caixa da empresa',
  tagline = 'Seguro garantia para depósito recursal',
  titulo  = 'Recorrer sem tirar o dinheiro<br>do caixa da empresa',
  corpo_html = $h$<p style="{{P}}">Quando a empresa perde uma ação trabalhista em primeira instância e decide recorrer, a Justiça exige o depósito recursal. Esse dinheiro sai do caixa e fica parado no processo, às vezes por anos, sem previsão de retorno. O <strong style="color:#1B263B;">seguro garantia judicial</strong> substitui esse depósito.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que muda na prática</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">O capital continua na empresa:</strong> em vez de imobilizar o valor no processo, você paga um prêmio e mantém o dinheiro girando no negócio.<br><br><strong style="color:#1B263B;">Aceito pela Justiça do Trabalho:</strong> a apólice substitui o depósito recursal e a garantia do juízo, conforme a CLT e a Reforma Trabalhista.<br><br><strong style="color:#1B263B;">Emissão rápida:</strong> com a documentação em mãos, a apólice sai a tempo do prazo do recurso.</p></td></tr></table>
<p style="{{PF}}">A F&amp;G trabalha com mais de 25 seguradoras e faz a análise antes do prazo apertar, para você saber o limite disponível antes de precisar. Se quiser, me responda com o valor da condenação que eu retorno com uma simulação.</p>$h$,
  cta_texto = 'Pedir uma simulação (WhatsApp)',
  cta_link  = 'https://wa.me/5515998618659'
where trilha = 'judicial' and ordem = 1;
