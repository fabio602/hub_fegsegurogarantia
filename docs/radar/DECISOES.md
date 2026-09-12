# Radar · Fase 1 · Decisões de implementação

Pontos que o [RADAR-FASE1.md](RADAR-FASE1.md) não cobria (ou cobria de um
jeito que não batia com o repositório) e como foram resolvidos. Data: 12/09/2026.

## Banco

1. **Pasta das migrações.** O repo não tem `supabase/migrations/`; as migrações
   ficam em `supabase/NNN_nome.sql` (CLAUDE.md). A Fase 1 seguiu a convenção
   do repo: `supabase/075_radar_fase1.sql` e `supabase/076_radar_receitas_tipos.sql`
   (074 já existia sem commit). Foram aplicadas no projeto real pelo MCP do
   Supabase (`apply_migration`), como as anteriores foram pelo SQL Editor.
2. **Padrão do cron.** Os jobs `posvenda-toques-daily` (chama uma função SQL) e
   `cadencia-emails-daily` (URL fixa, sem Authorization) só existem no banco,
   não no repo. O `radar-enrich-hourly` seguiu o padrão que está commitado
   (`prospeccao-pncp-daily`, `garimpo-daily`): pg_cron + pg_net com
   `project_url` e `anon_key` lidos do Vault, que funciona com `verify_jwt` ligado.
3. **`radar_atualizar_score(cnpj)`.** Além de `radar_calcular_score`, existe uma
   função que grava o score na própria linha. A Edge Function e a tela chamam
   ela por RPC depois de mudar cadastro ou status.
4. **Consolidação não regride.** Se uma competência mais antiga for ingerida
   depois de uma mais nova, o `on conflict` de `radar_consolidar_empresas` não
   sobrescreve o consolidado (`where competencia_ultima <= excluded`).
5. **Coluna computada `receitas_tipos`** (migração 076). `receitas` guarda os
   textos completos da PGFN e o PostgREST não faz `ilike` dentro de array; a
   função `receitas_tipos(radar_empresas)` devolve `{PIS, COFINS, IPI}` e a tela
   filtra com `overlaps`. Testado no PostgREST do projeto.
6. **`status` tem check constraint** com os quatro valores da especificação.
   A view `vw_radar_empresas` usa `security_invoker` para a RLS valer para
   quem consulta.
7. **`prospect_id` é uuid sem FK física**, para o lead poder ser apagado do
   Kanban sem travar o Radar (o PK de `prospects` é uuid).
8. **Porte.** A BrasilAPI devolve `DEMAIS` para quem não é ME/EPP; o score
   aceita `DEMAIS` e as variações de `MEDIA`/`MÉDIA` por segurança.

## Script de ingestão

9. **Ambiente Python.** O Mac tem Python 3.14 sem pandas; o script roda numa
   venv em `.venv/` (git-ignorada) com `scripts/radar/requirements.txt`.
10. **`.env` não estava no `.gitignore`** (só `*.local` e `.env.production`).
    Foi adicionado, junto com `data/pgfn/`, `.venv/` e `__pycache__/`.
    `.env.example` foi criado.
11. **`--pasta`** foi acrescentado para apontar outra pasta de CSVs (usado no
    aceite com o fixture). `--chunk` muda o tamanho do chunk.
12. **`--uf` e nome de arquivo.** Com `--uf`, o script usa os arquivos cujo nome
    contém a UF como token; se nenhum casar, lê todos e filtra pela coluna
    `UF_UNIDADE_RESPONSAVEL` (o descarte aparece no log como `uf_diferente`).
13. **Datas** aceitas em `dd/mm/aaaa` e `aaaa-mm-dd`. Data inválida conta no
    filtro `data_antiga`.
14. **Duplicidade dentro do chunk.** O Postgres rejeita a mesma chave duas
    vezes num único upsert; o script deduplica por `NUMERO_INSCRICAO` dentro
    do chunk (fica a última). Entre chunks o `on_conflict` resolve.
15. **429 e 5xx da REST** têm 3 tentativas com pausa antes de marcar o arquivo
    como erro.

## Edge Function

16. **Corpo opcional `{ cnpjs }` e `{ limite }`** para chamada manual (aceite E6.4
    e reenriquecimento de uma empresa específica). Com `cnpjs`, a função ignora
    `status` e `enriquecido_em` daquelas linhas.
17. **Orçamento de tempo de 120 s.** A Edge Function deste projeto é encerrada
    aos 150 s; a rodada para antes e devolve o que fez.
18. **Desempate da seleção** por `valor_total desc` depois de `score desc`.
19. **Timeout e erro de rede** são tratados como 5xx: registram
    `enriquecimento_erro` (`timeout` ou `rede: ...`) e encerram a rodada.
20. **Exclusão só troca o status de quem está `novo`.** Empresa já enviada ao
    Kanban ou descartada recebe o cadastro mas mantém o status.
21. **Telefone** formatado `(DD) NNNN-NNNN` a partir de `ddd_telefone_1`.
    E-mail em minúsculas. Sócios como `[{nome, qualificacao}]` a partir de `qsa`.

## Tela

22. **Caminho `src/views/Radar/`** foi mantido como a especificação pediu,
    embora o repo use `components/`. O `content` do `tailwind.config.js`
    passou a incluir `./src/**/*.{ts,tsx}`; sem isso as classes da tela não
    entrariam no build. Imports relativos, como o resto do hub (o alias `@`
    existe mas ninguém usa).
23. **Posição no menu:** item "Radar" dentro do subgrupo Prospecção, logo
    abaixo de "Prospecção Ativa". `NavSubItem` ganhou a prop opcional `icon`
    (o menu não tinha ícone em subitem).
24. **"Link para o card".** O Kanban não tem deep link por card; o botão
    "Abrir no Kanban" navega para a view `prospeccao`.
25. **Enviar ao Kanban** insere direto em `prospects` (mesmo mecanismo da
    `lead-cotacao`, sem passar por Edge Function): `name` = primeiro sócio ou
    razão social, `company`, `cnpj` com máscara (como o `prospeccao-pncp`),
    `email`, `phonenumber`, `city`, `state`, `status = 'Novos Leads'`,
    `status_entered_at`, `source = 'radar'`, `product_type`, `segmento` =
    descrição do CNAE, `decisor`, `description` com valor, inscrições,
    receitas, garantia, competência, CNAE, porte e score, `tags = ['radar','pgfn']`,
    `cnae_principal`. Nenhuma coluna nova em `prospects`.
26. **Reverter** zera `motivo_exclusao` e `prospect_id`; o card do Kanban não é
    apagado (fica a cargo de quem opera o Kanban).
27. **Motivo do descarte** é pedido num formulário inline no rodapé do drawer,
    não em `window.prompt` (que trava automação e não segue o visual do hub).
28. **Status `novo` em azul** (informação), conforme o mapa semântico; a
    especificação só fixava as cores de excluído, enviado e descartado.
29. **Badge do score em fundo branco** com borda `linha`: em `areia-escura`
    o dourado escuro ficava em 3,97:1 de contraste e o Lighthouse apontava.
30. **Busca**: se o texto for só dígitos de CNPJ (4 ou mais), procura por CNPJ;
    senão por nome devedor, razão social e nome fantasia. Caracteres da sintaxe
    do PostgREST (`, ( ) . * \ %`) são removidos antes.
31. **Contagens do cabeçalho** vêm de consultas `head` com `count: exact`
    (uma por status), suficientes para o volume da Fase 1.

## Aceite

32. **Banco limpo sem Docker.** O Mac não tem Docker nem Postgres; o teste em
    banco limpo usou PGlite (Postgres em WebAssembly), com o bloco do cron de
    fora por depender de pg_cron, pg_net e Vault. Script em
    `tests/radar/migracao_banco_limpo.mjs`.
33. **Fixture** (`tests/fixtures/pgfn_sample.csv`, 5.000 linhas) é gerado por
    `tests/fixtures/gerar_pgfn_sample.py` com seed fixa. CNPJs reais: Petrobras,
    Vale, Gerdau, Ambev e Higident (indústrias), Asher Bruffer (Simples) e
    Banco do Brasil com nome sem "BANCO" (para passar pelo filtro de nome e ser
    barrado só no enriquecimento). WEG ficou de fora porque seu CNAE fiscal é
    64.62-0 (holding) e cairia na exclusão `financeiro`.
34. **"Em produção"** foi verificado no dev server local apontando para o
    Supabase de produção (o deploy do hub é o push da `main`, que só acontece
    depois do merge). Lighthouse rodou em user flow (puppeteer + perfil do
    navegador do Playwright MCP, que guarda a sessão do Fábio).
35. **Dados do fixture ficaram no projeto real** (competência 202506, 756
    empresas) para a tela não abrir vazia. Para limpar antes da primeira
    ingestão real:
    `delete from radar_inscricoes; delete from radar_empresas; delete from radar_ingestoes;`
    e apagar do Kanban o lead de teste da Higident (origem `radar`).

## Ingestão da base real (13/09/2026, competência 202606)

36. **A base SIDA não vem separada por UF.** O ZIP "Dados abertos Não
    Previdenciário" traz 6 partições (`arquivo_lai_SIDA_1..6_202606.csv`, 9 GB)
    com todas as UFs misturadas. O CSV de SP em `data/pgfn/202606/` é gerado
    por partição da coluna `UF_DEVEDOR` numa passada pelos 6 arquivos
    (`awk -F';' '$5=="SP"'`, com o cabeçalho do primeiro). Os originais ficam
    fora do repo.
37. **A coluna de UF chama `UF_DEVEDOR`**, não `UF_UNIDADE_RESPONSAVEL`. O
    script aceita as duas (alias) e grava como `uf` a UF do devedor, que é a
    que interessa: a unidade responsável da PGFN pode ser de outro estado.
38. **Só o devedor PRINCIPAL entra.** Cada inscrição aparece uma vez por
    devedor (PRINCIPAL e cada CORRESPONSAVEL); como a chave é o número da
    inscrição, corresponsáveis são descartados (`corresponsavel` no log) para a
    empresa devedora não ser substituída por um sócio ou coobrigado.
39. **Retenção na fonte fica de fora.** Receitas com RETEN, RETID ou FONTE
    (PIS/COFINS retidos na fonte) são descartadas (`receita_retencao`): o
    devedor é quem reteve, não quem gerou a receita.
40. **`--dry-run`** aplica todos os filtros e imprime as contagens sem gravar
    e sem precisar de `.env`.
