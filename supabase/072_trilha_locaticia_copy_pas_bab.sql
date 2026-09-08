-- 072_trilha_locaticia_copy_pas_bab.sql
-- Registrada no banco em 07/09/2026 como trilha_locaticia_copy_pas_bab
-- (version 20260908004550). Este arquivo existe para o repositório refletir o
-- que já está em produção; não reaplicar.
--
-- Mesma reescrita das trilhas garantia (070) e energia (071), agora na trilha
-- locatícia, nos moldes PAS (problema, agitação, solução) e BAB (antes,
-- depois, ponte). O interlocutor é a imobiliária, não o inquilino:
--   1 (PAS)  o imóvel parado esperando fiador, com o custo da semana vazia.
--   2 (BAB)  fiador contra caução contra seguro fiança, lado a lado.
--   3        o que acontece no sinistro, que é a objeção do proprietário.
--   4        quebra da objeção de custo: quem paga é o inquilino, em até 12x.
--   5        encerramento, retomando a proposta de corretora parceira.
--
-- O marcador [CIDADE] é resolvido em tempo de envio pela Edge Function
-- prospecting-cadence e fica como está.

update email_trilha_etapas
set
  assunto = 'O imóvel parado esperando fiador',
  tagline = 'Sem Fiador',
  titulo  = 'Locação aprovada<br>sem fiador e sem caução',
  corpo_html = $h$<p style="{{P}}">A locação está quase fechada: inquilino aprovado, proprietário de acordo. E trava no fiador, porque não tem ninguém para indicar ou o indicado não passa.</p>
<p style="{{P}}">Cada semana de imóvel vazio é aluguel que o proprietário não recebe e comissão que a imobiliária não fatura. E o inquilino, cansado, fecha na concorrência que aceita sem fiador.</p>
<p style="{{P}}">Com <strong style="color:#1B263B;">seguro fiança da Tokio Marine, Porto ou Pottencial</strong>, a análise do inquilino sai em até 24 horas, sem fiador e sem caução, cobrindo aluguel, encargos, danos ao imóvel e despejo. Trabalho com mais de uma seguradora justamente para aprovar o perfil que uma só recusaria.</p>
<p style="{{PF}}">Me diga o valor médio de aluguel que a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> administra que eu respondo com uma simulação. Sou o Fábio, da F&amp;G Seguro Garantia, corretora especialista em garantias, atendendo imobiliárias da região de [CIDADE].</p>$h$,
  cta_texto = 'Pedir uma simulação',
  ativo = true
where trilha = 'locaticia' and ordem = 1;

update email_trilha_etapas
set
  assunto = 'Fiador, caução ou seguro fiança em [CIDADE]',
  tagline = 'Comparativo',
  titulo  = 'O comparativo que uso com<br>as imobiliárias parceiras',
  corpo_html = $h$<p style="{{P}}"><strong style="color:#1B263B;">Antes:</strong> a garantia padrão é o fiador. Imóvel parado, inquilino desistindo e cobrança em atraso virando processo.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• <strong style="color:#1B263B;">Fiador:</strong> inquilino demora para achar, muitos desistem, e a cobrança em atraso vira processo.<br>• <strong style="color:#1B263B;">Caução:</strong> trava o dinheiro do inquilino e limita a cobertura a três aluguéis.<br>• <strong style="color:#1B263B;">Seguro fiança:</strong> aprova em um dia, cobre até 30 vezes o aluguel dependendo da seguradora, e a própria seguradora paga o proprietário em caso de inadimplência.</p></td></tr></table>
<p style="{{P}}"><strong style="color:#1B263B;">Depois:</strong> seguro fiança como garantia padrão. O imóvel gira mais rápido e o proprietário recebe da seguradora, não do processo.</p>
<p style="{{PF}}">Envio a tabela com as condições das três seguradoras para a região de [CIDADE]?</p>$h$,
  cta_texto = 'Pedir a tabela',
  ativo = true
where trilha = 'locaticia' and ordem = 2;

update email_trilha_etapas
set
  assunto = 'E se o inquilino parar de pagar?',
  tagline = 'Na hora do sinistro',
  titulo  = 'O proprietário recebe<br>e fica sem preocupações',
  corpo_html = $h$<p style="{{P}}">É a pergunta que todo proprietário faz antes de aceitar o seguro fiança.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O caminho</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">1.</strong> O aluguel vence e não é pago.<br><strong style="color:#1B263B;">2.</strong> A imobiliária comunica a inadimplência à garantidora, dentro do prazo do contrato.<br><strong style="color:#1B263B;">3.</strong> A garantidora paga o proprietário até o limite contratado.<br><strong style="color:#1B263B;">4.</strong> A cobrança do inquilino e a ação de despejo passam a ser da garantidora, não do proprietário.</p></td></tr></table>
<p style="{{PF}}">É esse argumento que convence. Se quiser, te envio um texto curto, pronto para a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> encaminhar ao dono do imóvel. E se a inadimplência acontecer, quem conduz o sinistro com a garantidora sou eu, sem custo à parte.</p>$h$,
  cta_texto = 'Receber o texto para o proprietário',
  ativo = true
where trilha = 'locaticia' and ordem = 3;

update email_trilha_etapas
set
  assunto = 'Quem paga o seguro fiança é o inquilino',
  tagline = 'Custo',
  titulo  = 'Parcelado em até 12x,<br>diluído no mês',
  corpo_html = $h$<p style="{{P}}">A objeção do inquilino é o custo. Só que não é desembolso à vista como a caução: entra parcelado em até 12x, proporcional ao aluguel, e a imobiliária passa a noção de valor ao proprietário na hora.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Para simular, preciso de</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Valor do aluguel e dos encargos<br>• Tipo do imóvel: residencial ou comercial<br>• CPF ou CNPJ do pretendente</p></td></tr></table>
<p style="{{PF}}">Mande os dados de uma locação em análise na <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> que eu devolvo a simulação no mesmo dia.</p>$h$,
  cta_texto = 'Fazer uma simulação',
  ativo = true
where trilha = 'locaticia' and ordem = 4;

update email_trilha_etapas
set
  assunto = 'Fico por aqui, [NOME_CONTATO]',
  tagline = 'Encerramento',
  titulo  = 'Deixo o canal aberto',
  corpo_html = $h$<p style="{{P}}">Última mensagem da sequência. Em uma linha: o seguro fiança fecha locação sem fiador, protege o proprietário com indenização em vez de processo, e o custo fica com o inquilino, diluído no mês.</p>
<p style="{{P}}">O convite de verdade é ser a corretora de garantia locatícia da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong>. As imobiliárias que atendo em [CIDADE] têm um portal para acompanhar cada contrato e o relatório de repasse fechado por e-mail todo mês, sem planilha paralela.</p>
<p style="{{PF}}">Não precisa mudar tudo de uma vez. Começa pela próxima locação e avalia pelo resultado. Obrigado pelo tempo.</p>$h$,
  cta_texto = 'Falar com o Fábio',
  ativo = true
where trilha = 'locaticia' and ordem = 5;
