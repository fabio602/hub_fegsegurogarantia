-- 070_trilha_garantia_copy_pas_bab.sql
-- Registrada no banco em 07/09/2026 como trilha_garantia_copy_pas_bab
-- (version 20260908004121). Este arquivo existe para o repositório refletir o
-- que já está em produção; não reaplicar.
--
-- Reescrita da copy dos e-mails 1 a 5 da trilha garantia nos moldes PAS
-- (problema, agitação, solução) e BAB (antes, depois, ponte). Cada e-mail
-- passou a abrir por uma dor concreta de quem fornece para o setor público em
-- vez de abrir pela apresentação da corretora:
--   1 (PAS)  o prazo entre a convocação e a entrega da garantia contratual.
--   2 (BAB)  limite único em uma seguradora contra capacidade distribuída.
--   3 (PAS)  caixa imobilizado em garantia de proposta recolhida em dinheiro.
--   4 (PAS)  os motivos que fazem o órgão recusar a apólice já emitida.
--   5        encerramento da sequência, sem oferta nova.
--
-- O e-mail 6 nunca chegou a ser escrito: continua com o texto de exemplo que
-- vem no cadastro de uma etapa nova e foi desativado para não entrar no
-- disparo. O conteúdo dele vai junto para que rodar esta migração num banco
-- limpo devolva exatamente o estado de produção.

update email_trilha_etapas
set
  assunto = 'A garantia contratual sai antes do prazo do edital?',
  tagline = 'Prazo do Edital',
  titulo  = 'Ganhou o contrato.<br>A garantia tem prazo.',
  corpo_html = $h$<p style="{{P}}">Quem fornece para o setor público conhece a sequência: homologação, convocação e poucos dias para apresentar a <strong style="color:#1B263B;">garantia contratual</strong>. Muita empresa só descobre nessa hora que não tem limite aprovado em seguradora nenhuma.</p>
<p style="{{P}}">Aí começa a corrida: cadastro, balanço, análise de crédito. Cada dia parado é um dia a menos para assinar, e o órgão não estende prazo porque a seguradora demorou.</p>
<p style="{{P}}">A F&amp;G trabalha só com seguro garantia, com <strong style="color:#1B263B;">mais de 25 seguradoras</strong>. Leio a cláusula do edital, indico a modalidade certa e emito dentro do prazo. E se a análise de limite for feita agora, a próxima garantia vira um e-mail.</p>
<p style="{{PF}}">Tem contrato para assinar ou edital em análise? Me responda com o número do edital ou o valor do contrato que eu retorno hoje. Sou o Fábio Lima, fundador da F&amp;G.</p>$h$,
  cta_texto = 'Enviar meu edital',
  ativo = true
where trilha = 'garantia' and ordem = 1;

update email_trilha_etapas
set
  assunto = 'O limite acaba antes do próximo pregão',
  tagline = 'Capacidade',
  titulo  = 'Um limite só,<br>ou capacidade para licitar mais',
  corpo_html = $h$<p style="{{P}}"><strong style="color:#1B263B;">Antes:</strong> uma seguradora, um limite. Cada contrato consome parte dele, e quando acaba a empresa deixa de disputar edital porque sabe que não vai conseguir a garantia.</p>
<p style="{{P}}"><strong style="color:#1B263B;">Depois:</strong> limite aprovado em várias seguradoras e distribuído por modalidade. Proposta numa, execução em outra, e capacidade sobrando para o pregão seguinte.</p>
<p style="{{PF}}">Mapeio o que a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tem aprovado hoje, quais seguradoras ainda não foram acionadas e onde há espaço. Gratuito e sem compromisso. Me responda com o CNPJ e o faturamento aproximado.</p>$h$,
  cta_texto = 'Mapear meu limite',
  ativo = true
where trilha = 'garantia' and ordem = 2;

update email_trilha_etapas
set
  assunto = 'Caixa parado em garantia de proposta',
  tagline = 'Garantia de Proposta',
  titulo  = 'Dinheiro parado<br>até a assinatura',
  corpo_html = $h$<p style="{{P}}">Cada vez mais edital exige <strong style="color:#1B263B;">garantia de proposta</strong>, até 1% do valor estimado (Lei 14.133, art. 58). Por hábito, muita empresa recolhe em dinheiro.</p>
<p style="{{P}}">Esse valor fica parado até a assinatura do contrato, e a devolução sai em até 10 dias úteis. Em três pregões ao mesmo tempo é capital de giro imobilizado por semanas.</p>
<p style="{{P}}">Feita por seguro, a mesma exigência custa uma fração e não trava o caixa. E a análise de crédito que a seguradora faz para emiti-la já deixa o limite pronto para a garantia de execução, se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> vencer.</p>
<p style="{{PF}}">Me mande o edital que eu digo o valor da garantia e o custo da apólice no mesmo dia.</p>$h$,
  cta_texto = 'Cotar garantia de proposta',
  ativo = true
where trilha = 'garantia' and ordem = 3;

update email_trilha_etapas
set
  assunto = 'Apólice recusada pelo órgão: por que acontece',
  tagline = 'Conformidade',
  titulo  = 'Apólice emitida<br>não é apólice aceita',
  corpo_html = $h$<p style="{{P}}">Os motivos que mais reprovam uma garantia: modalidade errada, vigência que não cobre o prazo do contrato mais o período exigido, valor abaixo do percentual do edital e cláusula de garantia que ninguém leu antes de cotar.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Corretora Genérica</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Pouco conhecimento em editais<br>✕ 1-2 seguradoras<br>✕ Suporte lento</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">F&amp;G Seguro Garantia</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ Especialista em licitações<br>✓ 25+ seguradoras<br>✓ Atendimento ágil</p></td></tr></table>
<p style="{{PF}}">Me mande o trecho do edital que trata da garantia e eu digo, em português claro, o que ele exige.</p>$h$,
  cta_texto = 'Conferir minha cláusula',
  ativo = true
where trilha = 'garantia' and ordem = 4;

update email_trilha_etapas
set
  assunto = 'Fico por aqui, [NOME_CONTATO]',
  tagline = 'Encerramento',
  titulo  = 'Deixo o canal aberto',
  corpo_html = $h$<p style="{{P}}">Esta é a última mensagem da sequência. Em uma linha: a F&amp;G lê o edital, aprova o limite antes do prazo apertar e emite a garantia dentro do prazo, com mais de 25 seguradoras.</p>
<p style="{{PF}}">Se hoje não faz sentido, guarda o contato. No dia em que um contrato travar na garantia, me chama. Obrigado pelo tempo e boa sorte nas próximas licitações.</p>$h$,
  cta_texto = 'Falar com o Fábio',
  ativo = true
where trilha = 'garantia' and ordem = 5;

-- Etapa 6: texto de exemplo, fora do disparo.
update email_trilha_etapas
set
  assunto = 'E-mail 6 para a [NOME_EMPRESA]',
  tagline = null,
  titulo  = 'Título do e-mail',
  corpo_html = $h$<p style="{{P}}">Olá [NOME_CONTATO], escreva aqui o texto do e-mail.</p>
<p style="{{PF}}">Último parágrafo, antes do botão.</p>$h$,
  cta_texto = 'Falar com um especialista',
  ativo = false
where trilha = 'garantia' and ordem = 6;
