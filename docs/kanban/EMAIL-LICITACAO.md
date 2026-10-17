# E-mail da licitação: 1º contato manual com prévia (leads PNCP)

Branch: `email-licitacao`. Decisões já tomadas pelo Fábio em 16/10/2026. Não reabrir.

## Objetivo

Hoje todo lead do PNCP entra no Kanban (`prospects`, source `pncp_auto`), entra na trilha `garantia` (`email_cadencia`) e recebe o E1 genérico na hora, dentro de `enviarLead()` em `supabase/functions/prospeccao-pncp/index.ts`.

Passa a ser assim: o lead entra no Kanban e na trilha **sem disparar nada**. No card, o botão **"E-mail da licitação"** abre uma prévia preenchida com os dados daquela licitação. O Fábio confere, ajusta destinatário e texto e envia. Esse envio **conta como o E1 da trilha `garantia`**; a trilha segue sozinha a partir do E2 (dia 3), pelo cron que já existe.

## Decisões

1. **Prévia obrigatória.** Nada sai sem clique em "Enviar" no modal.
2. **O e-mail da licitação substitui o E1** só para leads `pncp_auto` novos. Os 691 leads PNCP que já receberam o E1 não mudam nada.
3. **Leads com E1 já enviado:** botão desabilitado com dica "Trilha iniciada em DD/MM". Sem envio extra.
4. **Outras origens** (Radar, garimpo, manual, saúde, energia etc.) não mudam.
5. **Molde visual:** o mesmo navy/dourado de `montarEmail()` da `prospecting-cadence`. Conteúdo no banco, como nas trilhas.
6. **Texto:** o e-mail **não afirma** que o contrato exige garantia nem o percentual. Pergunta e pede a minuta (regra do Fábio: nada não verificado escrito como certo para cliente). Sem travessões no texto.

## Banco (migração `supabase/105_email_licitacao.sql`)

- Trilha nova `licitacao` em `email_trilhas`, com `ativo = false` (o cron nunca a usa) e a mesma marca/rodapé/assinatura da `garantia` (copiar colunas).
- Uma etapa em `email_trilha_etapas`: `trilha = 'licitacao'`, `ordem = 1`, `dia = 0`, `ativo = true`, com o conteúdo abaixo.
- Nenhuma coluna nova em `email_cadencia`: "aguardando 1º e-mail" = `ativo = false` e nenhuma linha em `email_envios` para o contato.

Placeholders novos, além dos que o molde já troca (`[NOME_CONTATO]`, `[NOME_EMPRESA]`): `[ORGAO]`, `[OBJETO]`, `[OBJETO_CURTO]` (até 60 caracteres, cortando em palavra), `[VALOR]` (R$ formatado), `[NUMERO_LICITACAO]`, `[DATA_HOMOLOGACAO]` (DD/MM/AAAA). Fonte: colunas `orgao_licitante`, `objeto_contrato`, `valor_contrato`, `numero_licitacao`, `data_homologacao` do `prospects`. Campo vazio: a frase que o usa é omitida, nunca sai `[VALOR]` cru nem "R$ 0,00".

### Conteúdo da etapa

Assunto: `Garantia contratual: [OBJETO_CURTO]`

Corpo:

> Vimos que a [NOME_EMPRESA] teve homologado o resultado da licitação [NUMERO_LICITACAO] do [ORGAO], para [OBJETO], no valor de [VALOR]. Parabéns pelo resultado.
>
> Nessa fase, antes da assinatura do contrato, é comum o órgão pedir a garantia contratual. Se for o caso, providenciamos o seguro garantia de execução com rapidez, cotando em mais de 25 seguradoras para buscar a melhor taxa e o limite adequado para a sua empresa.
>
> O edital ou a minuta do contrato de vocês prevê garantia? Se puder nos enviar, analisamos o percentual exigido e devolvemos a cotação.

CTA: o mesmo da etapa 1 da `garantia` (copiar `cta_texto`/`cta_link`).

## Edge Functions

### `prospeccao-pncp`
- Novo campo de config `envio_imediato` (boolean, default **false**). Com false, `enviarLead()` insere `prospects` e `email_cadencia` (com `ativo = false`) e **não** chama a `prospecting-cadence`. `okEnvio` passa a significar "aguardando envio manual" no relatório diário (linha "Aguardando 1º e-mail: N").
- Com true, comportamento antigo (rollback sem deploy).

### `prospecting-cadence`: dois modos novos no corpo do POST
- `{ modo: 'licitacao_preview', prospect_id, email?, nome_contato?, assunto?, corpo? }` → devolve `{ assunto, html, para, avisos[] }` sem enviar. `corpo` editado é texto puro (parágrafos por linha em branco), escapado e inserido no molde no lugar do corpo da etapa.
- `{ modo: 'licitacao_enviar', prospect_id, email, nome_contato, assunto, corpo }`:
  1. Valida formato do e-mail e checa `email_blocklist`. Bloqueado → 422 com motivo.
  2. Trava: se o contato já tem `email_envios` com `ordem = 1` → 409 "trilha já iniciada".
  3. Envia com `sendEmail()` (mesmo remetente e BCC).
  4. Só se o envio deu certo, numa sequência: atualiza `email_cadencia` (`email`, `nome_contato`, `ativo = true`, `data_inicio = hoje BRT`), registra `registrarEnvio(contato, 1)` (que já marca `email_1_sent`), atualiza `prospects.email` se mudou e grava em `prospects.description` a linha `E-mail da licitação enviado em DD/MM para <email>` (e, se o e-mail mudou, `E-mail anterior: <antigo>`).
  5. Resultado: o cron envia o E2 da `garantia` em `data_inicio + 3`, como hoje.
- Contato sem linha em `email_cadencia` (lead manual antigo): cria a linha (`trilha = 'garantia'`, `origem = 'pncp_auto'`, `prospect_id`) antes de enviar.

## Frontend (`components/ProspectsKanban.tsx`)

- Botão **"E-mail da licitação"** no card/drawer do lead, visível só para `source = 'pncp_auto'`. Estados: habilitado (aguardando 1º e-mail), desabilitado com dica (trilha iniciada em DD/MM), oculto (outras origens).
- Badge no card "Aguardando 1º e-mail" (amber, conforme o mapa de cor do CLAUDE.md) e chip de filtro **"Aguardando 1º e-mail (N)"** no topo da coluna Novos Leads: é a fila diária.
- Modal da prévia, tela larga:
  - Esquerda: Para (e-mail editável, com o e-mail atual pré-preenchido), Nome do contato (editável), Assunto (editável), Corpo (textarea com o texto da etapa já com os dados trocados).
  - Direita: prévia HTML renderizada (iframe `srcDoc`), atualizada ao editar (debounce 600 ms, chamando `licitacao_preview`).
  - Avisos acima do botão: e-mail genérico (gmail/hotmail etc.) ou de contabilidade (usar as listas `email_padroes_contador` e `email_prefixos_genericos` da config da prospecção), campo da licitação vazio.
  - Botões: Cancelar, Enviar. Enviar com estado de carregamento; sucesso fecha o modal, mostra toast e atualiza o card; erro mostra a mensagem da função e mantém o modal aberto.

## Regras de execução

- Um item por vez, nesta ordem: migração 105, `prospecting-cadence` (modos novos), teste dos modos com curl, `prospeccao-pncp` (flag), frontend.
- `git add` arquivo por arquivo. Não incluir os arquivos soltos já existentes (`deno.lock`, os .xlsx do PNCP).
- `npm run build` e `tsc --noEmit` obrigatórios antes de cada commit.
- Antes de publicar a `prospeccao-pncp`, conferir que nenhuma execução diária está em andamento.
- Push e merge na main ficam com o Claude Code (o push na main dispara o deploy).

## Aceite (`docs/kanban/ACEITE-EMAIL-LICITACAO.md`)

1. Lead PNCP novo entra sem e-mail enviado, com badge e no chip de filtro.
2. Prévia mostra os dados reais da licitação; campos vazios não deixam placeholder.
3. Envio de teste para fabio@fegsegurogarantia.com.br num lead de teste: chega com o molde certo, `email_envios` ordem 1 gravado, `email_cadencia.ativo = true`, `data_inicio = hoje`.
4. Segundo clique no mesmo lead: botão desabilitado; chamada direta da função devolve 409.
5. E-mail na blocklist devolve 422 e não envia.
6. Lead antigo (E1 já enviado): botão desabilitado, nada muda.
7. Com `envio_imediato = true`, o fluxo antigo volta igual.
