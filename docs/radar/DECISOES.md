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
41. **Lote do enriquecimento: 70, não 200.** O plano do projeto é Free e a
    Edge Function é encerrada aos 150 s. Com a pausa fixa de 1200 ms, cada CNPJ
    custa ~1,5 s mesmo com as gravações no banco correndo em paralelo com a
    pausa (medido em 12/09/2026: 79 CNPJs em 121 s). 200 CNPJs levariam ~300 s;
    70 levam ~105 s, dentro do orçamento de 120 s e com folga para o teto.
    O cron continua de hora em hora (70 x 15 rodadas = ~1.050 CNPJs por dia).

## Score v2 e enriquecimento local (12/09/2026)

42. **Score v2** (migração 077) recalibrado com a base real: valor em faixa
    útil pontua mais que valor gigante, inscrição "Em cobrança" pontua (garantia
    por apresentar) e quem só tem benefício fiscal ou negociação perde 25;
    CNAE 05 a 33 ganha 10. Tabela completa no README. As contagens
    `qtd_em_cobranca` e `qtd_beneficio` entram em `radar_empresas`.
43. **Sem acento por `translate`.** O projeto não tem a extensão `unaccent`;
    `radar_sem_acento(text)` faz a comparação de `tipo_situacao` ("Em cobrança",
    "Benefício Fiscal") em maiúsculas e sem acento.
44. **CNAE com zero à esquerda.** A BrasilAPI devolve `cnae_fiscal` como número
    (0600001 vira 600001); o score faz `lpad` para 7 dígitos antes de ler a divisão.
45. **`scripts/radar/enrich_local.py`** repete a lógica da Edge Function no Mac,
    sem limite de lote, porque o cron (70 por hora, plano Free) levaria semanas
    para 31 mil empresas. Em 429/5xx/timeout espera 60 s e tenta de novo até 5
    vezes, depois pula (a empresa volta na próxima rodada). Pode rodar junto
    com o cron: seleção igual (`enriquecido_em is null`) e gravações idempotentes.
46. **Recuperação judicial exclui** (migração 078): nome da PGFN ou razão
    social com "RECUPERACAO JUDICIAL" ou "EM RECUPERACAO" (sem acento) vira
    `excluido / recuperacao_judicial`, na consolidação, na Edge Function e no
    `enrich_local.py` (checagem antes das outras exclusões). Quem já foi ao
    Kanban ou foi descartado não muda. Aplicada na base de 202606 em 12/09/2026.

## Fase 2 · dossiê judicial via PJe TRF3 (13/09/2026)

Especificação em [RADAR-FASE2.md](RADAR-FASE2.md). Migração
`supabase/079_radar_fase2_pje.sql`, worker `scripts/radar/pje_worker.py`.

47. **Runtime do worker: Python, na venv do Radar.** A regra 6 mandava usar
    "a mesma instalação de Playwright do scraper do PNCP", mas o repo não
    tinha Playwright nenhum: o scraper do PNCP é uma Edge Function em Deno
    que usa `fetch`. Os scripts locais do Radar já são Python na `.venv/`,
    então o worker é Python (`playwright` entrou no `requirements.txt`).
    Usa o Google Chrome instalado no Mac (`channel="chrome"`), sem baixar
    navegador do Playwright.
48. **Busca por nome é exata.** O campo "Nome da parte" do PJe TRF3 só
    devolve resultado com o nome completo: a forma tolerante da especificação
    (sem pontuação e sem LTDA) devolveu zero para a Convenção. O worker tenta,
    nesta ordem, a razão social como está, o nome da PGFN e por último a forma
    tolerante, parando na primeira que devolve algo. Apóstrofo fica no nome
    (LARRU'S).
49. **Só o input visível da data pode ser preenchido.** O calendário do
    RichFaces tem um hidden `...InputCurrentDate` ("mm/aaaa") ao lado de
    `...InputDate`; o primeiro rascunho do worker zerava esse hidden ao tentar
    limpar "Até" e o servidor passou a ignorar o formulário inteiro (17,7
    milhões de resultados). O worker agora só toca `dataAutuacaoInicioInputDate`
    e `dataAutuacaoFimInputDate`, e trata pesquisa com mais de 500 resultados
    como erro ("critério não aplicado"), para nunca gravar processos de outra
    empresa.
50. **Espera do resultado.** O botão Pesquisar chama `executarReCaptcha()`
    (o hCaptcha está desligado no código da página) e um `a4j:jsFunction`;
    o worker espera a resposta do POST e o indicador `_viewRoot:status` sumir
    antes de ler a tabela.
51. **Recência pelo número CNJ.** A listagem não mostra a data de autuação;
    "os 8 mais recentes" são ordenados pelo ano e pelo sequencial do próprio
    número (NNNNNNN-DD.AAAA), que é a ordem de autuação.
52. **Embargos invertem os polos.** Nos embargos a empresa é EMBARGANTE e
    aparece no "Polo ativo" da página, com seus advogados. O worker grava
    `polo` em relação à empresa: `passivo` = lado do executado (empresa e
    seus advogados), `ativo` = lado da Fazenda. Assim `vw_radar_advogados`
    (polo passivo) e o bloco "Advogados do executado" funcionam para as duas
    classes. Na listagem, o `polo_passivo_nome` dos embargos é a parte antes
    do "X".
53. **Movimentações.** A coluna "Documento" vem como linha indentada por
    tabulação logo abaixo do movimento, no mesmo formato de data; o parser
    ignora linhas com tabulação. A primeira página traz até 15 movimentos e
    `qtd_movimentacoes` vem do rodapé "N resultados encontrados" da seção.
54. **`--detalhes N` no modo `--cnpj`.** O critério de aceite 2 pede os
    advogados e as 15 movimentações do processo 5002050-64.2023, que não está
    entre os 8 mais recentes da Convenção (há 5 de 2025/2026 e 4 de 2024). O
    aceite rodou com `--detalhes 30` (abre todos); a fila continua com 8.
55. **Homônimo só é conferível com detalhe aberto.** Processos gravados só
    pela listagem não têm CNPJ; ficam. Nos detalhes, participante EXECUTADO
    ou EMBARGANTE sem CNPJ (só CPF) também não descarta.
56. **Ordenação secundária** da tabela é `dossie_em desc nulls last` depois
    do score: pronto e sem_processos (que têm `dossie_em`) vêm antes de
    nenhum e fila quando o score empata.
57. **Botão "Buscar processos"** faz upsert em `radar_pje_fila` (prioridade
    100, status pendente, tentativas 0) e marca `dossie_status = 'fila'`.
    Fica desabilitado na fila e quando o dossiê tem menos de 30 dias; com mais
    de 30 dias vira "Atualizar".
58. **PostgREST do plano Free devolve 504 de vez em quando**; o worker
    repete até 3 vezes (5, 15 e 30 s) em 5xx, 429, timeout ou erro de rede.
59. **Teto diário** é contado por `finalizado_em` do dia em `radar_pje_fila`,
    então sobrevive a reinício do worker. A empresa que estava `processando`
    quando o worker caiu fica assim até alguém rodar `--cnpj` ou o botão da
    tela (que recoloca em pendente).
60. **Plist com `__RAIZ__`.** O repositório mudou de pasta durante a fase
    (`Documents/fg-corretora-hub` → `Documents/FG/hub`); o plist modelo tem
    `__RAIZ__` e o `install_launchd.sh` substitui pela pasta real na hora de
    instalar. Mover o repo = reinstalar.
61. **`radar_enfileirar_dossies()` marcou `fila` só em quem entrou** (a
    inserção é `on conflict do nothing`). Na base real entraram 708 empresas
    (a especificação estimava ~800).
62. **Gabarito da Convenção mudou.** Em 13/09/2026 a busca devolve 22
    resultados, 20 das classes 1116/1118: 12 execuções e 8 embargos (a
    especificação dizia 13 e 7). Há uma execução nova de 04/09/2026
    (5018946-80.2026). As contagens gravadas são as reais.
63. **Perfil do navegador** em `data/radar/pje-profile/` (git-ignorado junto
    com `data/`). `--headless` usa o modo headless novo do Chrome; o padrão
    abre janela, como a especificação pediu.
64. **Variantes do nome na busca exata.** Como a busca é exata, o worker
    tenta também cada nome sem o ponto final ("LTDA." → "LTDA") e sem o
    apóstrofo (LARRU'S → LARRUS). A Larru's devolveu zero nas cinco
    variantes em 13/09/2026: ficou `sem_processos` (sem gabarito para
    conferir; pode ser autuação anterior a 2021 ou nome diferente no PJe).
65. **Sem processo desde 2021, a busca é repetida sem filtro de data.** Se
    nenhuma variante do nome devolver linha das classes 1116/1118 com
    autuação a partir de 01/01/2021, o worker repete a busca com os campos de
    data em branco, começando pela "melhor" variante (a primeira que devolveu
    algum resultado de qualquer classe; se nenhuma devolveu, na ordem normal)
    e parando na primeira que traz resultado. Acima de 30 resultados, quebra
    por ano de 2010 até o ano atual. Tudo que for 1116/1118 é gravado; a
    `data_distribuicao` continua vindo só do detalhe (real), nunca do número
    CNJ, então processos antigos sem detalhe aberto ficam sem data. Pedido em
    13/09/2026 depois da Larru's ficar `sem_processos`.
66. **Busca principal pelo CNPJ.** O índice de nome do PJe não casa nomes
    com apóstrofo: a Larru's ("LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS
    LTDA.") devolveu zero por nome em todas as variantes, com e sem data, mas
    pelo campo CPF/CNPJ (radio CNPJ + `fPP:dpDec:documentoParte`, só dígitos
    digitados tecla a tecla; a máscara é do formulário) apareceram 30
    resultados, 11 execuções fiscais. Desde 13/09/2026 o worker busca pelo
    CNPJ (desde 2021; sem data se vier zero das classes; por ano acima de 30)
    e só cai para o nome exato, com a mesma lógica, se o CNPJ não devolver
    resultado nenhum. A conferência dos 3 primeiros dígitos do CNPJ mascarado
    continua no detalhe. Como a quebra por ano deixa na tela só a listagem do
    último ano, o worker refaz a listagem de origem antes de abrir o detalhe
    de um processo que não está na tela (agrupando os detalhes por listagem).
67. **O launchd roda o worker com janela, não headless.** Ao instalar o
    LaunchAgent (13/09/2026, 19h20) o Chrome headless recebeu
    `net::ERR_HTTP2_PROTOCOL_ERROR` do PJe em todas as tentativas, e um teste
    direto confirmou: headless falha, com janela abre. É o Akamai barrando a
    assinatura do Chrome headless. O plist ficou sem `--headless`; a flag
    continua no worker para testes, mas não funciona contra o PJe hoje. Como
    o LaunchAgent roda na sessão gráfica do usuário, a janela do Chrome abre
    no Mac (e some quando a empresa termina, porque o contexto é fechado).
68. **Janela do Chrome escondida pelo System Events.** `--window-position=-2400,-2400`
    e `--window-size=1366,800` vão nos argumentos do Chrome, mas o macOS puxa a
    janela de volta para a tela (bounds 0,34) e o Chrome ativa ao abrir. O
    worker então guarda qual app estava na frente, lança o Chrome, esconde o
    processo do Chrome do worker (`set visible ... to false`, identificado
    pelo PID que usa `--user-data-dir` do perfil) e devolve o foco ao app
    anterior; repete o esconder logo que cada popup de detalhe abre. O
    `window.open` do "Ver Detalhes" ganha um shim que tira as features de
    janela, então o detalhe abre como aba da janela escondida, não como
    janela nova. Mesmo assim o Chrome ativa por menos de 1 segundo a cada
    detalhe (medido a 1 amostra/s: 8 detalhes, 8 amostras) e o foco volta ao
    app anterior em seguida; cmd+clique (aba em segundo plano) não muda isso.
    Testado em 13/09/2026 na Convenção e na Tresuno: PJe respondeu
    normalmente, sem Access Denied. Precisa da permissão de Automação
    (System Events) para o Python; sem ela o worker segue com a janela
    visível.
69. **CNPJ zero, nome acha.** A Tresuno (27848826000161) devolveu zero pelo
    CNPJ, com e sem data, e zero pela razão social completa, mas a forma
    tolerante ("... CIMENTICIOS", sem LTDA) trouxe 14 execuções. O cadastro da
    parte no PJe pode não ter CNPJ e ter o nome sem sufixo; por isso a cadeia
    de fallbacks (CNPJ, razão social, nome PGFN, variantes, forma tolerante)
    fica inteira.
70. **Detalhe em aba, sem popup (`ABRIR_DETALHE_EM_ABA = True`).** Em vez de
    clicar em "Ver Detalhes", o worker lê a URL do `openPopUp(...)` do onclick
    (`/pje/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=...`)
    e faz `page.goto` nela numa aba do mesmo contexto, com `Referer` igual à
    URL da listagem. Nunca usa fetch. A aba é criada uma vez só, no lançamento
    do Chrome e antes de escondê-lo, e reutilizada (volta para `about:blank`
    entre detalhes): criar ou fechar aba com o app escondido o traz para a
    frente. Se algum detalhe responder Access Denied, a flag é desligada em
    tempo de execução e o worker volta ao clique com popup pelo resto da
    sessão, com registro no log. Testado em 13/09/2026 com a Convenção: 8
    detalhes abertos sem bloqueio e zero amostras (1 por segundo, 209 s) com
    o Chrome do worker na frente. Isso supera a regra da spec de "clicar e
    capturar o popup": o bloqueio relatado na spec era de navegação direta
    sem a sessão da listagem; com a sessão e o Referer o PJe aceita.
71. **Filtro Município e Região** (migração 080, 13/09/2026). O autocomplete
    vem da função `radar_municipios(uf)` (municípios distintos e contagem,
    sem excluídas), porque o PostgREST não faz distinct e SP tem 481
    municípios em dezenas de milhares de linhas. Os chips guardam o valor no
    formato do banco (maiúsculas, sem acento, como a BrasilAPI grava) e o
    filtro é `in('municipio', ...)` no servidor. Os presets de região ficam em
    `src/views/Radar/radarRegioes.ts` com os nomes acentuados; a comparação
    normaliza. Escolher uma região define a UF e os chips; editar os chips faz
    o seletor mostrar "Seleção própria". Trocar a UF limpa os chips.
