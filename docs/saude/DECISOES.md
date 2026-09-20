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

**Vista Prospecção ainda não existe.**
Fase 1 entregou Funil e Simulador. A Prospecção (seção 6) depende da campanha
de garimpo, que é uma migração ainda não escrita.

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
- `npm run build` passa. O `tsc --noEmit` não acusa nada em `App.tsx`,
  `lib/permissoes.ts` nem em `src/views/Saude/`. Os erros que ele mostra em
  `components/ContratoAnalyzer.tsx`, `components/GarantiaLocaticia.tsx`,
  `components/ResultsDashboard.tsx`, `lib/editalSchema.ts` e `regressao/*`
  são anteriores a este módulo.
