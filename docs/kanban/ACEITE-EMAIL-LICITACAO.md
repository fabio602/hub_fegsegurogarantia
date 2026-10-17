# Aceite: e-mail da licitação (1º contato manual dos leads PNCP)

Branch `email-licitacao`. Executado em 16/10/2026, contra o banco e as Edge
Functions de produção. Spec: `docs/kanban/EMAIL-LICITACAO.md`.

## O que foi publicado

| Peça | Estado |
| --- | --- |
| `supabase/109_email_licitacao.sql` | aplicada (trilha `licitacao` + etapa 1) |
| `supabase/110_prospeccao_envio_imediato.sql` | aplicada (flag `envio_imediato`, default `false`) |
| `prospecting-cadence` | publicada, v31, `verify_jwt=false` preservado |
| `prospeccao-pncp` | publicada, v24, `verify_jwt=true` preservado |
| `components/ProspectsKanban.tsx` | no branch, sai no deploy do merge |

`verify_jwt` foi conferido antes e depois de cada publicação: o cron chama a
`prospecting-cadence` sem cabeçalho `Authorization`, e subir a função com a
verificação ligada quebraria a cadência inteira.

## Os sete itens da spec

### 1. Lead PNCP novo entra sem e-mail enviado, com selo e no chip

**Passa, com uma ressalva de método.** A flag `envio_imediato` está `false` na
config, e com ela desligada a `enviarLead()` insere o lead e a linha da
cadência com `ativo = false` e não chama a `prospecting-cadence`.

A ressalva: um lead PNCP de verdade só nasce quando o cron
`prospeccao-pncp-daily` roda (10:00 UTC, 07:00 BRT). Em vez de disparar o job
diário à mão, montei um lead no estado exato que a função deixa e verifiquei
o estado no banco:

```
company          TESTE AGUARDANDO E1 (apagar)
source           pncp_auto
cadencia.ativo   false      <- o cron varre só ativo = true
envios (ordem 1) 0          <- "aguardando 1º e-mail" é isto: zero envios
```

É esse par (`ativo = false`, zero linhas em `email_envios`) que o card lê para
mostrar o selo amber "Aguardando 1º e-mail" e o botão livre, e que o chip
"Aguardando 1º e-mail (N)" conta no topo da coluna Novos Leads. Confirmar o
lead nascendo pelo cron é observação de amanhã, 07:00.

### 2. Prévia mostra os dados reais; campo vazio não deixa placeholder

**Passa.** Prévia no lead real `UBA POSTE` (licitação do Município de Ubatuba,
R$ 5.239.449,60):

```
assunto : Garantia contratual: Contratação emergencial de uma empresa especializada em
para    : financeiro@ubaposte.com.br
avisos  : Parece caixa de setor (fiscal, jurídico), não de uma pessoa.
placeholder cru no html: nenhum
```

O aviso está certo: `financeiro` está mesmo na lista `email_prefixos_genericos`
da config em produção.

Os três casos de campo vazio, renderizados de verdade:

| Lead | Resultado |
| --- | --- |
| completo | `...licitação 46482857000196-1-000279/2026 do MUNICIPIO DE UBATUBA, para Contratação..., no valor de R$ 5.239.449,60. Parabéns pelo resultado.` |
| sem valor e sem número | `...o resultado da licitação do MUNICIPIO DE SOROCABA, para Reforma da escola municipal. Parabéns pelo resultado.` |
| sem nenhum dado | `...o resultado da licitação. Parabéns pelo resultado.` |

Nunca sai `R$ 0,00`, nunca sai `[VALOR]`, e a frase fecha sozinha nos três.
Assunto no caso extremo: `Garantia contratual`, sem dois-pontos solto.

Placeholder digitado à mão no corpo editado também resolve, e o HTML é
escapado uma vez só:

```
digitado: "Valor de [VALOR] e órgão [ORGAO]."  ->  "Valor de R$ 1.234.567,89 e órgão MUNICIPIO DE SOROCABA."
digitado: "Texto & com <tag>"                  ->  "Texto &amp; com &lt;tag&gt;"
```

### 3. Envio de teste para fabio@fegsegurogarantia.com.br

**Passa.** Lead de teste `TESTE E-MAIL DA LICITACAO (apagar)`, licitação do
Município de Sorocaba, R$ 1.234.567,89. Chamada `licitacao_enviar`:

```
HTTP 200
{"success":true,"para":"fabio@fegsegurogarantia.com.br",
 "contato_id":"cb4e51d8-d159-48ee-8cc7-846b3150309f",
 "data_inicio":"2026-10-16","email_trocado":null}
```

Estado gravado, lido do banco depois do envio:

```
email_cadencia.trilha        garantia
email_cadencia.origem        pncp_auto
email_cadencia.ativo         true
email_cadencia.data_inicio   2026-10-16      (hoje, BRT)
email_cadencia.email_1_sent  true
email_envios.ordem           1
email_envios.enviado_em      2026-10-17 00:59:45+00
prospects.description         ...
  [16/10/2026 21:59] E-mail da licitação enviado em 16/10 para fabio@fegsegurogarantia.com.br
```

O lead não tinha linha em `email_cadencia` (foi criado direto no banco, não
pela prospecção), então esse envio também exercitou o caminho "lead manual
antigo": a função criou a linha antes de enviar.

A linha na descrição entra no formato `[DD/MM/AAAA HH:MM]` que o histórico de
observações do Kanban lê, em BRT, e não no fim do bloco do PNCP.

### 4. Segundo clique no mesmo lead

**Passa.**

```
HTTP 409
{"success":false,
 "error":"Trilha já iniciada em 16/10/2026. O primeiro e-mail deste lead já saiu.",
 "trilha_iniciada_em":"2026-10-17T00:59:45.283+00:00"}
```

Na tela o botão já aparece travado, com a dica "Trilha iniciada em 16/10", e a
chamada direta devolve 409 de qualquer jeito. A trava é a ordem 1 em
`email_envios`, então duas abas abertas no mesmo lead também não enviam duas
vezes.

### 5. E-mail na blocklist devolve 422 e não envia

**Passa.** Quatro casos, todos antes de qualquer gravação ou envio:

| Caso | Resposta |
| --- | --- |
| na blocklist | 422 `...está na lista de bloqueio: <motivo>. Não enviei.` |
| na blocklist, caixa diferente | 422, mesma mensagem (comparação sem distinção de caixa) |
| formato inválido | 422 `E-mail com formato inválido: nao-e-email` |
| vazio | 422 `E-mail com formato inválido: (vazio)` |

Os quatro rodaram apontando para um lead real do PNCP. Depois: `email` do lead
intacto, `description` não tocada, nenhuma linha nova na cadência. O endereço
de teste foi retirado da blocklist no fim.

### 6. Lead antigo, E1 já enviado

**Passa.** Lead PNCP de 15/10, trilha em andamento:

```
HTTP 409  Trilha já iniciada em 15/10/2026. O primeiro e-mail deste lead já saiu.
```

Depois da chamada: `email` igual, `ativo` igual, `data_inicio` igual, 1 envio
(o mesmo de antes), `description` não tocada. Os 691 leads que já receberam o
E1 ficam como estavam.

### 7. Com `envio_imediato = true`, o fluxo antigo volta igual

**Verificado por código, não por envio.** Ligar a flag faz a `enviarLead()`
voltar a chamar a `prospecting-cadence` com `contact_id`, e a linha da cadência
volta a nascer com `ativo = true`. O caminho antigo está intacto: o modo
`contact_id` da função não foi tocado (ver abaixo).

Não testei ligando a flag porque isso dispararia o E1 genérico de verdade para
a próxima empresa que entrasse na prospecção. O teste honesto é ligar a flag
num dia de baixa e olhar o relatório, se um dia for preciso.

## O teste A/B e as trilhas de hoje continuam iguais

A mudança na `prospecting-cadence` é inserção pura: **442 linhas adicionadas,
nenhuma removida**. Removendo do arquivo exatamente as duas faixas inseridas,
o resultado é idêntico à main, byte a byte:

```
linhas main           : 656
linhas sem as inserções: 656
sha main              : de7f520e7b01d10a
sha sem as inserções  : de7f520e7b01d10a
```

Ficam intocados o `varianteDoContato()`, o `moldeSimples()`, o `htmlParaTexto()`,
o `sendEmail()` com `text` e `List-Unsubscribe`, os modos `preview`/`teste`, o
modo `contact_id` e o caminho do cron inteiro. O cron chama com `body := '{}'`,
então os dois `if` novos nem são avaliados.

Uma consequência que vale registrar: o `AB_INICIO` do teste A/B é 16/10/2026 e
o teste pega `trilha = garantia` + `origem = pncp_auto`, que são os mesmos
leads que agora recebem o e-mail da licitação. O E1 do A/B deixa de existir
para lead novo do PNCP, e o teste passa a comparar molde x versão simples do
E2 ao E5. Por decisão do Fábio, o e-mail da licitação sai **sempre no molde
navy/dourado**; quando o lead está no braço "simples", a prévia avisa que os
e-mails seguintes dele não terão o layout de newsletter.

## Testes automáticos das regras de texto

48 asserções rodando o código real da função (import do próprio arquivo, sem
cópia), contra dados de leads de verdade: `✅ todos os testes passaram`.
Cobrem o corte do objeto em 60 caracteres na palavra, `DD/MM/AAAA` sem virar o
dia por fuso, valor zerado virando vazio, o trecho condicional `{{? }}`, o
escape de `&`/`<`/`>`, objeto do PNCP com colchetes (`[Portal de Compras
Públicas]` preservado), corpo editado virando parágrafos escapados, os avisos
e as cinco regras do `varianteDoContato`.

`tsc --noEmit` limpo e `npm run build` verde antes de cada commit. `deno check`
limpo nas duas funções, com os dois bloqueios de ambiente contornados
(`npm:openai` do `edge-runtime.d.ts` e `npm:xlsx`) — os dois são pré-existentes
e acontecem igual na main.

## Defeitos encontrados e corrigidos durante o aceite

1. **Assunto com dois-pontos solto.** Sem objeto, saía `Garantia contratual: `.
   O assunto virou condicional: `Garantia contratual{{?: [OBJETO_CURTO]}}`.
2. **`.,` no meio da frase.** O objeto do PNCP quase sempre termina em ponto e
   entra no meio da frase: saía `...municipal de Ubatuba., no valor de`. A
   pontuação final do objeto passou a cair.
3. **Data do 409 em UTC.** O 409 dizia "Trilha já iniciada em 17/10/2026" para
   um envio de 16/10 às 21h59, porque `enviado_em` é gravado em UTC. Agora a
   data é formatada em BRT, na função e na dica do botão.
4. **Placeholder digitado à mão ficava cru.** Se o Fábio escrevesse `[VALOR]`
   no corpo ou no assunto editado, saía literal. O texto editado passou a
   atravessar o resolvedor também.

## Achado fora do escopo, mas que derruba a premissa da spec

O cron `cadencia-emails-daily` **está abortando todo dia útil desde ao menos
05/10/2026**, 12 dias seguidos, com zero e-mails enviados:

```
dia         execucoes  abortadas  enviados  erro
2026-10-16      2          2         0      Falha ao ler os envios: Bad Request
2026-10-15      2          2         0      Falha ao ler os envios: Bad Request
... (idem até 05/10; 10 e 11/10 são fim de semana)
```

É anterior a este branch: a primeira publicação minha foi 17/10 00:57 UTC e as
falhas vêm de antes. Não é regressão do e-mail da licitação.

Causa, com alta confiança: na varredura do cron, a leitura dos envios monta um
`.in('contato_id', [...])` com o id de todo contato elegível. Hoje são **718
contatos**, o que dá uma query string de **~27 KB** — muito acima do limite de
URL do PostgREST, que responde 400. A linha é esta, na `prospecting-cadence`:

```ts
const { data: envios, error: errEnvios } = await supabase
  .from('email_envios')
  .select('contato_id, ordem, enviado_em')
  .in('contato_id', contatos.map(c => c.id));
if (errEnvios) return abortar(`Falha ao ler os envios: ${errEnvios.message}`);
```

O `abortar()` está certo em abortar: tratar essa falha como lista vazia
reenviaria a etapa 1 para todo mundo. O problema é o tamanho do `in`.

Por que importa para esta entrega: a spec diz que "a trilha segue sozinha a
partir do E2 (dia 3), pelo cron que já existe". Hoje ela não segue. O e-mail
da licitação funciona e é enviado, mas o E2 não vai sair enquanto isso não for
corrigido. A correção (ler os envios em lotes, ou filtrar por data em vez de
por lista de ids) é pequena, mas é outro assunto: não mexi sem combinar.

## Pontos abertos

- **Objeto longo.** A spec manda `para [OBJETO]` com o objeto inteiro, e os
  objetos reais do PNCP têm 250 a 340 caracteres, o que deixa a primeira frase
  bem longa. Mantido como a spec pede: a prévia existe para aparar, lead por
  lead, e o modal avisa isso embaixo da textarea.
- **`assinatura_linha` continua sem efeito.** A coluna existe desde a migração
  085, mas o `molde()` da Edge Function tem a linha "Corretora especialista em
  Seguro Garantia" fixa no código. Vale para todas as trilhas, não só para esta;
  não mexi.
