# Módulo Saúde, desvios da especificação

A spec (`HUB-SAUDE-FASE1.md`) manda registrar aqui tudo que a realidade do
código obrigou a fazer diferente. Ordem cronológica.

## 20/09/2026

**Edição no drawer salva ao sair do campo, não por clique para editar.**
A spec pedia o padrão de clique-para-editar que o Radar usa em telefone e
e-mail. Ficou input direto que grava no blur. O uso real é corrigir um
telefone no meio de uma ligação, e um passo a mais de clique só atrapalha.
Comportamento de gravação é o mesmo: um `update` por campo, sem botão de
salvar no fim.

**O Simulador ganhou uma proposta pronta para enviar, que a spec não pedia.**
A spec previa três textos copiáveis. Foi mantido o texto de WhatsApp e o
pedido para a Favorita, e entrou junto um bloco de proposta que imprime em
PDF, com o nome da empresa, validade, composição, os três planos lado a lado
e o rodapé legal. Pedido do Fábio em 20/09/2026: o que vende não é a conta, é
o cliente entender o que está comprando.

**Coparticipação passou a variar por acomodação.**
A primeira versão da proposta mostrava R$ 35,00 de consulta para os três
planos. Está errado: no Max B, que é apartamento, consulta é R$ 70,00 e pronto
atendimento é R$ 100,00. Os valores agora vêm de `copy.ts` e mudam conforme o
plano em destaque. Quem mexer nesse arquivo confira a tabela por acomodação
antes de publicar.

**Vista Prospecção entregue, com uma parte de fora.**
Os três painéis da seção 6 estão na tela: estado da campanha com botão de
ligar, leitura da trilha, e o estoque garimpado com o botão de virar lead.
Fica pendente o mesmo botão dentro do drawer do prospect no Kanban de Seguro
Garantia, que é tela de outro módulo e seria mexida invasiva para entregar
junto. Quem for fazer: a lógica idempotente por CNPJ está em
`Prospeccao.tsx`, função `promover`.

**O botão de ligar a campanha pede confirmação, e isso é de propósito.**
Ligar não é só mudar um booleano: o cron das 9h dispara todas as trilhas
ativas, então ligar a campanha começa a mandar e-mail de verdade assim que o
primeiro contato for inscrito. O texto do aviso repete os dois pré-requisitos
(site no ar e patch da cadência aplicado) porque ninguém lê a migração na
hora de clicar.

**A numeração das migrações andou mais que o previsto.**
Entre 088 e 091 entraram quatro migrações de trilha de e-mail que não estavam
no plano original, por causa de três rodadas de reescrita do texto. A migração
da campanha de garimpo deve pegar o próximo número livre, não o 088 que a spec
original citava.

## Conferido em produção, 20/09/2026

- `unimed_calcular_cotacao` devolve 3225.53 para o caso de aceite da spec.
- A constraint de `status` aceita os rótulos acentuados, e a trigger
  `unimed_leads_touch_trg` reescreve `status_entered_at` e `updated_at` sozinha
  num update que só manda `status`. Testado com lead de teste, depois apagado.
- A campanha `saude-pme` foi criada em produção pela migração 092, desligada
  e em dry run. Nenhum e-mail sai até alguém ligar.
- `npm run build` passa. O `tsc --noEmit` não acusa nada em `App.tsx`,
  `lib/permissoes.ts` nem em `src/views/Saude/`. Os erros que ele mostra em
  `components/ContratoAnalyzer.tsx`, `components/GarantiaLocaticia.tsx`,
  `components/ResultsDashboard.tsx`, `lib/editalSchema.ts` e `regressao/*`
  são anteriores a este módulo.

## 20/09/2026, segunda rodada

**Inclusão manual de empresas ficou dentro do módulo de Saúde.**
Dava para usar a tela de Prospecção por E-mail do Seguro Garantia, que já
escreve em `email_cadencia` e já deixa escolher a trilha. O Fábio pediu
independência: saúde é outra linha de negócio e não deveria obrigar a entrar
no módulo do garantia. O painel novo está em `Prospeccao.tsx` e lê listas
coladas ou de arquivo, com separador flexível e o campo com arroba
reconhecido como e-mail em qualquer posição.

Diferenças em relação à tela do garantia, todas de propósito:

- lê **cidade**, que a importação de lá não lê. Na trilha de saúde isso
  importa, porque o assunto do e-mail do dia 7 é "Onde você é atendido em
  [CIDADE]", e sem cidade vira "em sua cidade";
- entra **em espera** por padrão (`ativo = false`), com um botão separado para
  ativar todos. A tela do garantia insere ativo e, no cadastro um a um, ainda
  dispara o primeiro e-mail na hora. Para montar uma lista antes de o site
  estar no ar, espera é o comportamento certo;
- deduplica contra quem já está na trilha, porque `email_cadencia` não tem
  índice único de e-mail.

**Bug encontrado e corrigido: o check de `origem` quebraria a campanha.**
`supabase/functions/garimpo/index.ts` grava `origem` como `garimpo_` mais o
slug da campanha. O check da tabela listava os slugs um a um, então a campanha
de saúde, slug `saude-pme`, produziria `garimpo_saude-pme`, fora da lista. O
insert falharia dentro do cron: ninguém inscrito, nenhum aviso, e a impressão
de que a campanha simplesmente não achou empresas. A migração 093 troca a
lista fixa por `origem like 'garimpo\_%'`, o que resolve para toda campanha
futura, não só esta. Testado em produção com as duas origens e limpo depois.

## 20/09/2026, terceira rodada

**O preço passou a ser público, valor exato e não faixa.**
O simulador do site respondia com uma faixa ("R$ 1.100 a R$ 1.300 por mês"),
por medo de errar antes da análise da operadora. O Fábio apontou que na
região é normal publicar valor, e confirmou que não há regra da Favorita nem
da Unimed que impeça. Quem procura preço e não acha sai do site, então a
faixa protegia a gente e custava o visitante.

Três mudanças, nessa ordem:

1. `cotar-saude` voltou a devolver o payload inteiro da RPC, com
   `total_mensal`, `subtotal_base` e `subtotal_adicionais`. A versão com
   faixa foi descartada. Está na v3 em produção.
2. `assets/cotacao.js` mostra o valor exato no cartão de cada plano, a média
   por pessoa, e no resumo abre mensalidade, adicionais e total.
3. `planos.html` ganhou a seção `#precos` com a tabela inteira por faixa
   etária, as duas tabelas (2 a 29 vidas e 1 vida), os quatro adicionais com
   valor, um exemplo com números reais e o que a tabela não inclui.

**A tabela agora vive em dois lugares, de propósito, com trava.**
O cálculo continua só no banco, na `unimed_calcular_cotacao`: isso não mudou
e não deve mudar. O que foi duplicado é a *impressão* da tabela, no bloco
`PRECOS` do `gerar.py`, porque o site é estático e não consulta o banco.
Para o risco de divergência existe `conferir-precos.py`, que lê o `PRECOS` do
gerar.py, busca `unimed_precos` pela API REST e falha com código 1 se alguma
das 60 células não bater. Rodar sempre que a vigência mudar.

**Texto do site: "faixa de preço" saiu de dez lugares.**
Sobrava em index, cotação, como contratar, hospital e planos, inclusive no
aviso do passo 4 do simulador, que explicava por que o valor era uma faixa.
Contradiria a tela nova. Virou "por que ainda chamamos de estimativa", que é
o que continua verdade: o definitivo sai na proposta.

**Tabela de preço cabe inteira no celular.**
As tabelas de preço levam `dados-precos`, que tira o `min-width` de 520px e,
abaixo de 680px, aperta a célula e esconde o `R$` (o subtítulo passou a dizer
"em reais"). Medido com o Chromium: a 320px, 390px e 430px nenhuma das três
tabelas corta. Sem isso o Max B, que é justamente a coluna mais cara e mais
consultada, ficava escondido atrás de rolagem lateral sem aviso.

**Conferência feita contra a fonte, não contra a memória.**
As 60 células do `PRECOS` foram comparadas uma a uma com `unimed_precos` e
com a Tabela UNIPART 09.2026 da Favorita: batem. A tabela de 09.2026 é a
mesma vigência de 18/05/2026 que já estava no banco, não houve reajuste. A
conferência do valor com adicionais fecha: Fácil 0 a 18 sai 152,02 na base e
166,14 na tabela publicada com APH e BF, que é 152,02 + 8,38 + 5,74.

**Carência da trilha estava certa, e agora tem fonte.**
O e-mail do dia 12 diz 1 dia para consulta e exame básico, 30 para terapia,
180 para internação e 300 para parto. A tabela oficial tem seis colunas e a
T1, que é a mais restritiva, dá 30 dias para consulta. A coluna válida é a
**T7**, descrita como "usado para inclusões e novas vendas PME", e ela bate
com o e-mail linha por linha. Não mexer no texto achando que está errado.

## 20/09/2026, quarta rodada

**O cliente passa a contratar sozinho, até a proposta.**
O Fábio perguntou se, agora que o preço está aberto, o cliente não poderia
comprar sozinho e mandar a documentação por ali.

Comprar sozinho, não. O processo da Favorita não permite: quem emite a
proposta é o corretor na plataforma, o cliente tem 72 horas para aceitar, e
cada beneficiário maior de 18 anos passa por entrevista médica por
videochamada, com prazo até as 12h do dia útil anterior à vigência. Não
existe botão que feche contrato nesse desenho, e prometer checkout para
entregar um processo de três dias estragaria a primeira impressão que o
preço aberto acabou de comprar.

Tudo até a proposta, sim. O cliente simula, escolhe, declara as pessoas e
manda os documentos pelo site. O Fábio só emite. Some a conversa de WhatsApp
que hoje fica entre o "gostei do preço" e o "documento chegou".

**Duas coisas mudaram desde o desenho da seção 10.2.**

A declaração de saúde não passa pelo corretor: a operadora manda direto para
cada beneficiário. Isso tirou do sistema a parte mais sensível. Nenhum dado
de saúde encosta no nosso storage, e isso passou a ser regra explícita, não
acidente.

O link deixou de nascer só no funil. No desenho antigo ele vinha de um botão
no lead, o que não serve para quem começa sozinho, porque aí ainda não existe
lead. Agora a `lead-saude` cria lead e envio na mesma transação lógica, e o
link vai por e-mail para o endereço que o próprio cliente informou. Mandar o
link para o e-mail declarado é, de quebra, a verificação de que o contato é
real. O botão no funil continua existindo para quem chegou por outro caminho.

**O que foi construído**

- migração 095: `saude_envios`, `saude_documentos`, bucket privado
  `saude-documentos` (15 MB, só PDF, JPG, PNG, HEIC e WebP), RLS nas duas
  tabelas e na leitura do bucket, e a view `saude_envios_para_apagar`;
- `saude-documentos`, com `verify_jwt` false: valida token, validade, pessoa,
  slot, tipo e tamanho, e grava com service role. É ela que decide quais
  documentos cada pessoa precisa;
- `saude-retencao` e o cron `saude-retencao-daily` da migração 096;
- `enviar.html` e `assets/enviar.js` no site, fora do menu, fora do sitemap,
  com noindex e Disallow no robots;
- o passo 6 do simulador agora abre a contratação em vez de só agradecer;
- no HUB, o bloco Documentos dentro da ficha do lead.

**A lista de documentos mora na Edge Function, e em nenhum outro lugar.**
Ela sai por papel: titular pede comprovante de vínculo, cônjuge pede certidão
de casamento, bebê com menos de 60 dias pede teste do pezinho. O site e o HUB
só desenham o que a função devolve. Se essa regra fosse copiada para o site,
um dia as duas divergiriam e o Fábio veria uma lista diferente da que o
cliente viu.

**Sem endpoint aberto, e isso foi verificado, não suposto.**
Com a chave anon: a URL pública do bucket responde "bucket não encontrado", o
objeto não é lido, o bucket não é listado, não sai URL assinada, e as duas
tabelas novas voltam vazias. O upload recusa `.txt` com 415, arquivo de 16 MB
com 413, slot que a pessoa não precisa com 400, pessoa inventada com 400,
token torto com 400 e token inexistente com 404.

**`titular_de`: numa empresa com duas famílias, sem isso o Fábio ligaria.**
Quando há mais de um titular, a página pergunta de quem cada dependente
depende. Considerei deixar de fora para simplificar e voltei atrás: o objetivo
do fluxo é entregar um dossiê que dispense a conversa, e "de quem é este
filho" é exatamente a ligação que ele não deveria precisar fazer.

**A retenção virou código porque a página promete.**
O texto de consentimento diz que os arquivos são apagados. Enquanto isso não
fosse executável, a página estaria mentindo. A `saude-retencao` foi testada em
produção: simulação lista, execução apaga arquivo e linha, e a segunda
execução devolve zero.

**Não fechei o `imobiliaria-docs`, e o motivo importa.**
Eu tinha recomendado corrigir junto, como item rápido. Ao olhar, não é:
`public/imobiliaria.html`, que a imobiliária usa sem login, sobe arquivo com a
chave anon e monta URL pública em quatro lugares; as URLs públicas estão
gravadas em colunas de `residential_clients` e `imobiliaria_clientes`; e a
`imobiliaria-envia-apolice` faz `fetch` na URL pública para anexar a apólice
no e-mail. Virar a chave quebraria a operação com as imobiliárias no mesmo
dia. Precisa do mesmo padrão de Edge Function intermediando o portal, que
agora existe pronto e testado na saúde. **Continua em aberto e continua sendo
risco real.**

**RLS ligado nos dois backups de prospects (migração 094).**
`prospects_apagados_20260906` e `prospects_apagados_garimpo_20260906` estavam
sem RLS, com 919 linhas de razão social, CNPJ e e-mail abertas para a chave
anon. Sem policy: backup não alimenta tela nenhuma.

---

## Materiais e carta de exclusividade

**A permissão tem uma segunda lista de views, e a spec não a mencionava.**
`SAUDE_VIEWS` no `App.tsx` só decide qual grupo do menu abre sozinho. Quem
decide se a tela renderiza é `podeVer`, que consulta `viewsDosModulos` e, por
baixo, o array `views` do módulo `saude` em `lib/permissoes.ts`. Acrescentei as
duas abas lá também. Sem isso elas apareceriam no menu e renderizariam tela em
branco para qualquer usuário com módulos restritos. O admin nunca veria o
defeito, porque para ele `modulos` é `null` e todas as views passam.

**O destinatário da carta usa travessão curto, não hífen.**
Conferi o texto frase a frase contra o `.doc` da operadora em vez de ler. A
linha é `A UNIMED SOROCABA – COOPERATIVA DE TRABALHO MÉDICO`, com en dash: o
Word trocou o caractere na origem. A transcrição a olho tinha posto hífen, e
antes disso a spec tinha posto vírgula.

**O nome do responsável legal entra como sugestão, não como verdade.**
A BrasilAPI devolve o quadro societário e o primeiro sócio nem sempre é quem
assina. O campo vem preenchido para poupar digitação, com aviso na tela de que
precisa ser conferido. Numa carta que vai para a operadora, nome errado é
problema.

**Nada da carta é gravado em banco, de propósito.**
Registrar a geração sem registrar a devolução assinada criaria um status que
mente. Quando esse controle for necessário, o lugar é um slot em
`saude_documentos`, que já existe para arquivo assinado.
