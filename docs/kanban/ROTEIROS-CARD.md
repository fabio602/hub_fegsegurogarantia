# Roteiros de abordagem no card do Kanban

Spec fechada em 18/10/2026. Colocar em `docs/kanban/ROTEIROS-CARD.md`. Branch `kanban-roteiros`.
Decisões já tomadas: não reabrir sem falar com o Fábio.

## Objetivo

Quem abre um card da coluna "Contato por WhatsApp" recebe a mensagem pronta, no tom certo para o grupo do lead,
com nome, empresa e cidade preenchidos. Edita se quiser, envia, confirma, e o toque fica registrado.

## O que já existe (conferido no banco em 18/10/2026)

- Tabela `prospects`. Grupo do lead vem de `source`:
  - `garimpo_energia` → grupo `energia` (153 na coluna)
  - `garimpo_imobiliarias` → grupo `imobiliarias` (220)
  - `garimpo_consultores` → grupo `consultores` (93)
  - qualquer outro `source` (ex.: `pncp_auto`) → sem roteiro; botões seguem como estão hoje.
- Campos usados: `decisor`, `company`, `city`, `phonenumber`, `email`, `source`.
- Nenhum dos 466 cards da coluna tem `email`.
- `name` NÃO serve para saudação: em imobiliárias e consultores é igual ao nome da empresa.
- `state` está corrompido em parte das linhas ("SÃ", "RI"). Não usar.
- Tabela `prospect_toques` (migração 115) existe, vazia, `canal` aceita só `whatsapp` e `email`; `autor_email` vem do JWT.
- Tabela `sellers` tem Fábio e João Victor. A Bruna NÃO está lá; não incluir (a tabela tem campos de comissão).

## Banco: migração `116_prospect_roteiros.sql` (arquivo pronto, entregue junto)

- Libera `ligacao` em `prospect_toques.canal`.
- Cria `prospect_roteiros` (grupo, canal, etapa 1 a 3, variação A/B, assunto, corpo, ativo), RLS igual às outras tabelas do Kanban (authenticated, tudo).
- Insere 18 roteiros: por grupo, WhatsApp 1A, 1B, 2, 3; ligação; e-mail.
- Use o próximo número livre em `supabase/`. Se 116 já existir, renomeie o arquivo; o conteúdo não muda.
- Aplicar pelo SQL Editor ou MCP só depois do OK do Fábio. O `drop constraint` pede confirmação: é esperado.
- Conferência: `select grupo, canal, etapa, variacao from prospect_roteiros order by 1,2,3,4;` → 18 linhas.

## Preenchimento dos campos

| Campo | Regra |
| --- | --- |
| `{nome}` | Primeira palavra de `decisor`, com só a inicial maiúscula (EDSON → Edson). Vazio se `decisor` for nulo, vazio, ou igual a `company`/`name`. |
| `{empresa}` | `company`. Remover no fim, repetindo até não sobrar: `LTDA`, `LTDA.`, `ME`, `EPP`, `EIRELI`, `S.A.`, `S/A`, `SA`, e pontuação solta no fim. Se não tiver nenhuma letra minúscula, passar para iniciais maiúsculas, com `de, da, do, das, dos, e` minúsculos. |
| `{cidade}` | `city`, mesma regra de maiúsculas. Vazio vira "sua cidade". |
| `{remetente}` | Primeiro nome do usuário logado em `sellers` pelo e-mail. Se não houver (caso da Bruna), campo "Seu nome" no modal, lembrado no navegador (localStorage com try/catch). |
| `{nome_ou_responsavel}` | `{nome}` se houver; senão "a pessoa que cuida dos contratos de energia". |

Regra do nome vazio: quando `{nome}` estiver vazio, apagar `", {nome}"` do texto (vírgula, espaço e o campo).
Todos os roteiros foram escritos para isso funcionar. Exemplos:
"Olá, {nome}, tudo bem?" → "Olá, tudo bem?"; "Olá, {nome}!" → "Olá!"; "Agradeço por atender, {nome}, vou ser breve." → "Agradeço por atender, vou ser breve."

Casos reais para testar:

| Card | {nome} | {empresa} |
| --- | --- | --- |
| CORETEX INDUSTRIA TEXTIL L... / EDSON IMIANOSKY | Edson | Coretex Industria Textil |
| AGIS MINERACAO LTDA. / ANDRE CAPOBIANCO | Andre | Agis Mineracao |
| Leandro Cossi Negócios Imobiliários (decisor nulo) | vazio | Leandro Cossi Negócios Imobiliários |
| CONDOMINIO DO PARKSHOPPING CAMPO GRANDE (decisor nulo) | vazio | Condominio do Parkshopping Campo Grande |

## Telefone

Normalizar: só dígitos; se tiver 12 ou 13 dígitos começando com `55`, tirar o `55`; se começar com `0`, tirar o `0`.
- 11 dígitos e o 3º é `9` → celular
- 10 dígitos e o 3º é 2, 3, 4 ou 5 → fixo
- qualquer outro → número com erro

Conferido no banco com esta regra, coluna Contato por WhatsApp:

| Grupo | Celular | Fixo | Com erro |
| --- | --- | --- | --- |
| imobiliarias | 122 | 96 | 2 |
| energia | 0 | 123 | 30 |
| consultores | 77 | 16 | 0 |

Link do WhatsApp: `https://wa.me/55{numero_normalizado}?text={encodeURIComponent(texto)}`.

## Comportamento no card (só para os 3 grupos)

Botão WhatsApp
- Celular: abre o modal de WhatsApp.
- Fixo: o botão passa a se chamar "Ligação" e abre o modal de ligação. No modal, link discreto "Tentar WhatsApp mesmo assim" (fixo pode ter WhatsApp Business).
- Número com erro: modal de ligação com aviso amber "Número incompleto. Procure o telefone no site ou no Google e corrija no card."

Modal de WhatsApp
- Etapa = nº de toques `whatsapp` do lead em `prospect_toques` + 1, no máximo 3. Mostra "1º contato", "Retomada" ou "Última mensagem".
- Na etapa 1, variação pelo último caractere do `id` do lead: 0 a 7 → A, 8 a f → B. Sempre a mesma para o mesmo lead.
- Texto preenchido num campo editável. Botões "Abrir WhatsApp" (abre o link em nova aba) e "Confirmar envio" (grava o toque como hoje).
- Na etapa 2, se o último toque tiver menos de 3 dias, aviso amber "Último contato há N dias; a retomada é a partir do 4º dia." Não bloqueia.
- Depois da etapa 3 confirmada, o modal só mostra "Ciclo de mensagens encerrado para este lead."
- Contador do dia: toques `whatsapp` do usuário logado desde 00h de São Paulo. A partir de 30, aviso amber "Você já registrou 30 WhatsApps hoje." Não bloqueia.

Modal de ligação
- Mostra o roteiro de ligação do grupo, preenchido, só para leitura, com o telefone clicável (`tel:`).
- Botão "Registrar ligação" grava toque com `canal = 'ligacao'`, com o mesmo "Confirmar" dos outros.

Botão E-mail
- Sem e-mail no card: abre aviso "Este lead ainda não tem e-mail. Peça na conversa e cadastre no card." e nada mais.
- Com e-mail: modal com assunto e corpo preenchidos, editáveis; "Abrir no e-mail" usa `mailto:` (quebra de linha como `%0D%0A`); "Confirmar envio" grava o toque como hoje.

Editar textos: por enquanto direto na tabela `prospect_roteiros` (Supabase). Sem tela de edição nesta entrega.

## Fora do escopo

- Cards de `pncp_auto` e de outros `source`.
- Mover card de coluna automaticamente.
- Envio automático de WhatsApp ou e-mail (tudo é manual, aberto pelo navegador da pessoa).

## Regras de trabalho

- Só mudanças aditivas. `git add` arquivo por arquivo; restos não commitados de sessões anteriores ficam de fora.
- `npm run build` e `tsc` sem erro antes de cada commit.
- Aplicar a migração antes de publicar o front.
- Cores conforme o mapa do CLAUDE.md: amber para alerta, token `whatsapp` só no botão de WhatsApp real.

## Aceite

1. 18 linhas em `prospect_roteiros`; `prospect_toques` aceita `ligacao`.
2. Card do Edson (Coretex): botão "Ligação", roteiro com "Edson" e "Coretex Industria Textil".
3. Card da Leandro Cossi (celular): modal WhatsApp começando "Olá, tudo bem? Falo com a Leandro Cossi Negócios Imobiliários?" ou a versão B.
4. Nenhuma mensagem gerada contém `{`, `}` ou ", ," .
5. Confirmar um envio cria 1 linha em `prospect_toques`; reabrir o modal mostra "Retomada".
6. Card de `pncp_auto`: comportamento igual ao de hoje.
