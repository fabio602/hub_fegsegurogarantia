-- 026_email_trilhas_novas.sql
-- Três novas trilhas de e-mail: Judicial/Recursal, Locatícia e Risco de Engenharia.
-- Todas nascem INATIVAS (ativo = false): não aparecem no seletor de contatos nem
-- entram na cadência até serem revisadas e ligadas na tela "Trilhas de E-mail".
--
-- O corpo usa os atalhos {{P}} (parágrafo) e {{PF}} (último parágrafo, com espaço
-- maior antes do botão), expandidos pela Edge Function prospecting-cadence.

-- ─────────────────────────────────────────────────────────────
-- TRILHAS
-- ─────────────────────────────────────────────────────────────
insert into email_trilhas (slug, nome, descricao, eyebrow, rodape, ativo, ordem) values
  ('judicial',
   'Seguro Garantia Judicial e Recursal',
   'Empresas e escritórios com processos em curso, execuções fiscais, penhoras e depósitos recursais.',
   'Seguro Garantia Judicial',
   'Você recebe este e-mail por ter demonstrado interesse em seguro garantia judicial',
   false, 3),
  ('locaticia',
   'Seguro Fiança Locatícia',
   'Imobiliárias, administradoras de imóveis e proprietários que hoje dependem de fiador ou caução.',
   'Seguro Fiança Locatícia',
   'Você recebe este e-mail por ter demonstrado interesse em seguro fiança locatícia',
   false, 4),
  ('risco-engenharia',
   'Risco de Engenharia',
   'Construtoras, incorporadoras e empresas de montagem industrial com obras em andamento.',
   'Seguro de Risco de Engenharia',
   'Você recebe este e-mail por ter demonstrado interesse em seguro de risco de engenharia',
   false, 5)
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────
-- TRILHA: judicial
-- ─────────────────────────────────────────────────────────────
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link) values

('judicial', 1, 1,
 'F&G — o depósito judicial não precisa ser em dinheiro',
 'Apresentação',
 'O dinheiro parado no processo<br>pode voltar para o caixa',
 $h$<p style="{{P}}">Olá [NOME_CONTATO], meu nome é Fábio Lima, sou fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong> — uma corretora que trabalha só com seguro garantia.</p>
<p style="{{P}}">Escrevo porque, quando uma empresa como a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> precisa garantir um processo, o caminho mais comum ainda é depositar o valor em dinheiro ou ter um bem penhorado. Existe uma terceira via: o seguro garantia judicial, que a legislação equipara a dinheiro para esse fim.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Onde costuma entrar</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Execuções cíveis e execuções fiscais<br>• Substituição de penhora sobre bens da empresa<br>• Substituição de depósito judicial já realizado<br>• Depósito recursal trabalhista<br>• Discussões de dívida ativa e autos de infração</p></td></tr></table>
<p style="{{PF}}">Se fizer sentido, posso olhar os processos em aberto e apontar em quais deles a substituição é possível. Sem compromisso.</p>$h$,
 'Falar com o Fábio', 'https://wa.me/5515998618659'),

('judicial', 2, 3,
 'Quanto custa deixar dinheiro parado em juízo',
 'Comparativo',
 'Depósito em dinheiro<br>versus seguro garantia',
 $h$<p style="{{P}}">[NOME_CONTATO], a diferença entre garantir um processo com dinheiro e garantir com seguro aparece direto no balanço.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Depósito / Penhora</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Imobiliza o caixa até o fim do processo<br>✕ Trava bens e imóveis da empresa<br>✕ Pode consumir limite bancário<br>✕ Valor só volta no trânsito em julgado</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Seguro Garantia Judicial</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ Caixa livre para operar<br>✓ Bens e imóveis desonerados<br>✓ Não consome limite no banco<br>✓ Custo é o prêmio anual, não o valor da causa</p></td></tr></table>
<p style="{{P}}">Na prática: em vez de tirar o valor integral do caixa, a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> paga um prêmio anual e apresenta a apólice no processo.</p>
<p style="{{PF}}">Posso fazer essa conta com os números reais dos seus processos e te mostrar a diferença.</p>$h$,
 'Quero Comparar', 'https://wa.me/5515998618659'),

('judicial', 3, 7,
 'A base legal da substituição — o que a lei diz',
 'Base legal',
 'Não é uma boa ideia:<br>está na lei',
 $h$<p style="{{P}}">[NOME_CONTATO], uma dúvida comum é se o juiz aceita. A resposta está em três dispositivos.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que dizem</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">CPC, art. 835, §2º</strong> — a fiança bancária e o seguro garantia judicial, em valor não inferior ao débito acrescido de 30%, equiparam-se a dinheiro para fins de substituição da penhora.<br><br><strong style="color:#1B263B;">Lei 6.830/80, art. 9º, II</strong> (redação da Lei 13.043/2014) — o seguro garantia é admitido como garantia na execução fiscal.<br><br><strong style="color:#1B263B;">CLT, art. 899, §11</strong> (Lei 13.467/2017) — o depósito recursal pode ser substituído por fiança bancária ou seguro garantia judicial.</p></td></tr></table>
<p style="{{P}}">Ou seja: não é discricionariedade do juiz nem favor da parte contrária. É previsão expressa.</p>
<p style="{{PF}}">Se o seu jurídico quiser discutir um caso concreto, estou à disposição para conversar com ele.</p>$h$,
 'Tirar uma Dúvida', 'https://wa.me/5515998618659'),

('judicial', 4, 14,
 'O limite aprovado antes de você precisar dele',
 'Prazo e documentos',
 'O prazo aperta<br>sempre no fim',
 $h$<p style="{{P}}">[NOME_CONTATO], o pedido de apólice judicial quase sempre chega com prazo curto — véspera de audiência, prazo recursal correndo, penhora já determinada.</p>
<p style="{{P}}">O processo tem três etapas, e só a última é rápida:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Como funciona</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">1. Cadastro</strong> — contrato social, balanços e documentos dos sócios.<br><strong style="color:#1B263B;">2. Análise de limite</strong> — a seguradora define quanto pode garantir para a empresa.<br><strong style="color:#1B263B;">3. Emissão</strong> — com o limite já aprovado, a apólice sai rápido.</p></td></tr></table>
<p style="{{P}}">A parte demorada é a segunda, e ela pode ser feita hoje, com o processo ainda tranquilo. Depois, cada apólice nova é só consumir o limite que já existe.</p>
<p style="{{PF}}">Se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> ainda não tem limite aprovado, dá para começar agora e deixar pronto.</p>$h$,
 'Iniciar meu Cadastro', 'https://wa.me/5515998618659'),

('judicial', 5, 21,
 'Fico por aqui, [NOME_CONTATO]',
 'Encerramento',
 'Deixo o canal aberto',
 $h$<p style="{{P}}">[NOME_CONTATO], esta é a última mensagem desta sequência — não quero ocupar sua caixa de entrada além do necessário.</p>
<p style="{{P}}">Resumindo o que compartilhei: o seguro garantia judicial substitui depósito e penhora com previsão legal expressa, libera caixa e bens da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong>, e o limite pode ser aprovado antes de haver urgência.</p>
<p style="{{PF}}">Quando surgir um processo em que isso ajude, é só responder este e-mail ou me chamar no WhatsApp. Obrigado pelo tempo.</p>$h$,
 null, 'https://wa.me/5515998618659');

-- ─────────────────────────────────────────────────────────────
-- TRILHA: locaticia
-- ─────────────────────────────────────────────────────────────
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link) values

('locaticia', 1, 1,
 'F&G — locação aprovada sem fiador e sem caução',
 'Apresentação',
 'A garantia que não trava<br>o fechamento do contrato',
 $h$<p style="{{P}}">Olá [NOME_CONTATO], meu nome é Fábio Lima, sou fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>.</p>
<p style="{{P}}">Escrevo porque a garantia locatícia costuma ser o ponto onde a locação emperra: o inquilino não acha fiador, ou não tem três aluguéis para deixar de caução. O seguro fiança resolve isso sem tirar dinheiro do bolso de ninguém.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que a apólice pode cobrir</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Aluguel em atraso e encargos (condomínio, IPTU, água, luz, gás)<br>• Danos ao imóvel<br>• Multa por rescisão antecipada<br>• Pintura interna e externa<br><br><span style="color:#777;font-size:12px;">As coberturas variam conforme o plano contratado.</span></p></td></tr></table>
<p style="{{PF}}">Se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> trabalha com locação, posso explicar como funciona a operação no dia a dia.</p>$h$,
 'Falar com o Fábio', 'https://wa.me/5515998618659'),

('locaticia', 2, 3,
 'Fiador, caução ou seguro fiança — o comparativo',
 'Comparativo',
 'Três garantias,<br>três velocidades',
 $h$<p style="{{P}}">[NOME_CONTATO], na prática o que muda entre as garantias é o tempo até assinar e o trabalho que sobra para a imobiliária.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td width="47%" style="border:1px solid #E8E2D8;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#AAA;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Fiador / Caução</p><p style="margin:0;color:#AAA;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✕ Depende de achar quem aceite<br>✕ Análise de terceiro atrasa a assinatura<br>✕ Caução imobiliza 3 aluguéis do inquilino<br>✕ Inadimplência vira ação de cobrança</p></td><td width="6%"></td><td width="47%" style="background-color:#1B263B;padding:20px;border-radius:4px;vertical-align:top;"><p style="margin:0 0 10px 0;color:#C69C6D;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:1px;">Seguro Fiança</p><p style="margin:0;color:#D5CCB8;font-size:13px;line-height:1.8;font-family:Arial,sans-serif;">✓ Análise só do próprio inquilino<br>✓ Aprovação em horas<br>✓ Inquilino não imobiliza capital<br>✓ Seguradora paga e depois cobra</p></td></tr></table>
<p style="{{P}}">Para a imobiliária, o efeito é direto: menos contrato parado esperando fiador e menos cobrança para administrar depois.</p>
<p style="{{PF}}">Posso mostrar como fica na rotina da <strong style="color:#1B263B;">[NOME_EMPRESA]</strong>, com um caso real.</p>$h$,
 'Quero Comparar', 'https://wa.me/5515998618659'),

('locaticia', 3, 7,
 'O que acontece quando o inquilino atrasa',
 'Na hora do sinistro',
 'O proprietário recebe<br>e não entra na briga',
 $h$<p style="{{P}}">[NOME_CONTATO], a pergunta que todo proprietário faz é essa: e se o inquilino parar de pagar?</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O caminho</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;"><strong style="color:#1B263B;">1.</strong> O aluguel vence e não é pago.<br><strong style="color:#1B263B;">2.</strong> A imobiliária comunica o sinistro à seguradora, dentro do prazo da apólice.<br><strong style="color:#1B263B;">3.</strong> A seguradora indeniza o proprietário até o limite contratado.<br><strong style="color:#1B263B;">4.</strong> A cobrança do inquilino passa a ser da seguradora, não do proprietário.</p></td></tr></table>
<p style="{{P}}">Com fiador, esse mesmo cenário vira uma ação judicial contra uma pessoa física — que pode levar anos e não ter patrimônio no fim.</p>
<p style="{{PF}}">É esse argumento que costuma convencer o proprietário. Posso te ajudar a apresentá-lo.</p>$h$,
 'Tirar uma Dúvida', 'https://wa.me/5515998618659'),

('locaticia', 4, 14,
 'Quanto custa e quem paga o seguro fiança',
 'Custo e operação',
 'Quem paga é o inquilino,<br>diluído no mês',
 $h$<p style="{{P}}">[NOME_CONTATO], o custo do seguro fiança é do inquilino e entra parcelado junto com o aluguel — não é um desembolso à vista como a caução.</p>
<p style="{{P}}">O prêmio depende do valor do aluguel e encargos, das coberturas escolhidas e do perfil de crédito do inquilino. Por isso não existe tabela única, mas dá para simular em minutos.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Para simular, preciso de</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Valor do aluguel e dos encargos<br>• Tipo do imóvel — residencial ou comercial<br>• CPF ou CNPJ do pretendente<br>• Coberturas desejadas</p></td></tr></table>
<p style="{{PF}}">Se quiser, mande os dados de uma locação que está em análise na <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> e eu devolvo a simulação.</p>$h$,
 'Fazer uma Simulação', 'https://wa.me/5515998618659'),

('locaticia', 5, 21,
 'Fico por aqui, [NOME_CONTATO]',
 'Encerramento',
 'Deixo o canal aberto',
 $h$<p style="{{P}}">[NOME_CONTATO], esta é a última mensagem desta sequência.</p>
<p style="{{P}}">Em resumo: o seguro fiança destrava contratos que hoje param na falta de fiador, protege o proprietário com indenização em vez de processo, e o custo fica com o inquilino, diluído no mês.</p>
<p style="{{PF}}">Quando aparecer uma locação em que isso ajude, é só responder este e-mail ou me chamar no WhatsApp. Obrigado pelo tempo.</p>$h$,
 null, 'https://wa.me/5515998618659');

-- ─────────────────────────────────────────────────────────────
-- TRILHA: risco-engenharia
-- ─────────────────────────────────────────────────────────────
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link) values

('risco-engenharia', 1, 1,
 'F&G — seguro de risco de engenharia para as obras da [NOME_EMPRESA]',
 'Apresentação',
 'A obra em construção<br>também precisa de apólice',
 $h$<p style="{{P}}">Olá [NOME_CONTATO], meu nome é Fábio Lima, sou fundador da <strong style="color:#1B263B;">F&amp;G Seguro Garantia</strong>.</p>
<p style="{{P}}">Escrevo porque o risco de engenharia é o seguro que protege a obra enquanto ela está sendo feita — o período em que ela ainda não tem apólice patrimonial e é justamente quando mais coisa pode dar errado.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Onde costuma ser exigido</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Contratos com órgãos públicos e editais de licitação<br>• Obras financiadas por banco ou fundo<br>• Incorporações e empreendimentos residenciais<br>• Montagem e instalação industrial<br>• Reformas e ampliações em imóvel de terceiro</p></td></tr></table>
<p style="{{PF}}">Se a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tem obra em andamento ou por começar, posso avaliar o que a apólice precisa cobrir.</p>$h$,
 'Falar com o Fábio', 'https://wa.me/5515998618659'),

('risco-engenharia', 2, 3,
 'O que o risco de engenharia cobre de verdade',
 'Coberturas',
 'Muito além<br>do incêndio',
 $h$<p style="{{P}}">[NOME_CONTATO], a apólice de risco de engenharia é montada por coberturas — a básica protege a obra e as adicionais cobrem o que o seu contrato exigir.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">Coberturas mais usadas</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Erro de projeto e erro de execução<br>• Vendaval, alagamento e demais riscos da natureza<br>• Incêndio, raio e explosão<br>• Responsabilidade civil geral e cruzada<br>• Danos a imóveis vizinhos e a linhas de serviço<br>• Despesas de desentulho e contenção<br>• Equipamentos e maquinário do canteiro<br>• Manutenção simples ou ampla, após a entrega<br><br><span style="color:#777;font-size:12px;">A composição final depende do tipo de obra e do que o contrato exige.</span></p></td></tr></table>
<p style="{{PF}}">A escolha errada aqui aparece só no sinistro. Vale conferir antes.</p>$h$,
 'Ver as Coberturas', 'https://wa.me/5515998618659'),

('risco-engenharia', 3, 7,
 'A cláusula do contrato pede exatamente o quê?',
 'Exigência contratual',
 'Apólice emitida<br>não é apólice aceita',
 $h$<p style="{{P}}">[NOME_CONTATO], acontece com frequência: a construtora contrata um risco de engenharia, apresenta ao contratante e a apólice é recusada por não bater com a cláusula do contrato.</p>
<p style="{{P}}">Os pontos que mais reprovam são a importância segurada abaixo do valor da obra, a vigência que não cobre todo o cronograma, a falta de RC cruzada quando há subempreiteiros e a ausência do contratante como segurado adicional.</p>
<p style="{{P}}">Por isso eu prefiro ler a cláusula antes de cotar. É mais rápido acertar de primeira do que endossar depois.</p>
<p style="{{PF}}">Se quiser, me mande o trecho do contrato ou do edital que trata do seguro e eu digo o que ele exige, em português claro.</p>$h$,
 'Enviar minha Cláusula', 'https://wa.me/5515998618659'),

('risco-engenharia', 4, 14,
 'O seguro precisa estar vigente antes da primeira máquina entrar',
 'Momento e preço',
 'Depois que a obra começa,<br>fica mais difícil',
 $h$<p style="{{P}}">[NOME_CONTATO], a apólice de risco de engenharia tem que estar em vigor antes do início dos trabalhos. Obra já iniciada é aceita com restrições, prêmio maior ou simplesmente recusada.</p>
<p style="{{P}}">Sobre o custo, ele não é tabelado. O que pesa na conta:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;"><tr><td style="border:1px solid #E0D8CE;border-left:3px solid #C69C6D;padding:24px 28px;border-radius:0 4px 4px 0;"><p style="margin:0 0 16px 0;color:#C69C6D;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">O que define o prêmio</p><p style="margin:0;color:#333;font-size:13px;line-height:1.9;font-family:Arial,sans-serif;">• Valor total e tipo da obra<br>• Prazo de execução e de manutenção<br>• Método construtivo e altura<br>• Localização e risco de natureza da região<br>• Coberturas adicionais escolhidas</p></td></tr></table>
<p style="{{PF}}">Com o cronograma e o orçamento da obra em mãos, consigo cotar em poucos dias.</p>$h$,
 'Pedir uma Cotação', 'https://wa.me/5515998618659'),

('risco-engenharia', 5, 21,
 'Fico por aqui, [NOME_CONTATO]',
 'Encerramento',
 'Deixo o canal aberto',
 $h$<p style="{{P}}">[NOME_CONTATO], esta é a última mensagem desta sequência.</p>
<p style="{{P}}">Em resumo: o risco de engenharia protege a obra durante a execução, precisa ser contratado antes do início, e a apólice tem que espelhar exatamente a cláusula do contrato para ser aceita.</p>
<p style="{{PF}}">Quando a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> tiver uma obra entrando, é só responder este e-mail ou me chamar no WhatsApp. Obrigado pelo tempo.</p>$h$,
 null, 'https://wa.me/5515998618659');
