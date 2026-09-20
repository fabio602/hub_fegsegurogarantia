# Radar

Módulo do Hub que transforma a base pública de devedores da PGFN em uma lista
de indústrias com dívida federal ajuizada, enriquecida com o cadastro da
Receita e pontuada, pronta para virar lead no Kanban com um clique.

A ideia: empresa com PIS, COFINS ou IPI ajuizado precisa garantir a execução
fiscal (penhora, depósito ou seguro garantia judicial). É prospecção de seguro
garantia judicial com o gatilho certo.

Especificações: [RADAR-FASE1.md](RADAR-FASE1.md) (PGFN) e
[RADAR-FASE2.md](RADAR-FASE2.md) (PJe TRF3). Decisões tomadas durante a
implementação: [DECISOES.md](DECISOES.md). Aceite: [ACEITE-FASE1.md](ACEITE-FASE1.md)
e [ACEITE-FASE2.md](ACEITE-FASE2.md).

## Peças

| Peça | Onde | O que faz |
| --- | --- | --- |
| Migrações 075 e 076 | `supabase/075_radar_fase1.sql`, `supabase/076_radar_receitas_tipos.sql` | Tabelas `radar_ingestoes`, `radar_inscricoes`, `radar_empresas`, view `vw_radar_empresas`, funções de score e consolidação, cron do enriquecimento |
| Script de ingestão | `scripts/radar/pgfn_ingest.py` | Lê os CSVs da PGFN, filtra, grava as inscrições e consolida por CNPJ |
| Edge Function | `supabase/functions/radar-enrich-cnpj` | Enriquece as empresas pela BrasilAPI, de hora em hora |
| Tela | `src/views/Radar/` | View `radar` do Hub (menu Seguro Garantia > Prospecção > Radar) |
| Migração 079 (Fase 2) | `supabase/079_radar_fase2_pje.sql` | Fila do PJe, processos, movimentações, advogados, `vw_radar_advogados`, dossiê e score v3 |
| Worker do PJe (Fase 2) | `scripts/radar/pje_worker.py` | Chama a API JSON da consulta pública do TRF3; o Chrome real só mantém os cookies do Akamai |
| launchd (Fase 2) | `scripts/radar/com.fg.radar-pje.plist`, `install_launchd.sh` | Mantém o worker rodando no Mac |

## 1. Baixar a base da PGFN

1. Acesse o portal de Dados Abertos da PGFN (dadosabertos.pgfn.gov.br) e
   procure o conjunto **Devedores inscritos em Dívida Ativa da União**
   (a base "não previdenciária" é a que traz PIS, COFINS e IPI). A atualização
   é trimestral.
2. Baixe o ZIP da competência desejada e extraia os CSVs em
   `data/pgfn/<AAAAMM>/` (por exemplo `data/pgfn/202506/`). A pasta é
   ignorada pelo git.
3. Os CSVs vêm com separador `;` e encoding latin-1, um arquivo por UF ou
   particionados. O script mapeia as colunas pelo nome (sem diferenciar
   maiúsculas, acentos ou espaços) e falha com mensagem clara se faltar alguma:
   `CPF_CNPJ, TIPO_PESSOA, TIPO_DEVEDOR, NOME_DEVEDOR, UF_UNIDADE_RESPONSAVEL,
   UNIDADE_RESPONSAVEL, NUMERO_INSCRICAO, TIPO_SITUACAO_INSCRICAO,
   SITUACAO_INSCRICAO, RECEITA_PRINCIPAL, DATA_INSCRICAO, INDICADOR_AJUIZADO,
   VALOR_CONSOLIDADO`.

## 2. Rodar a ingestão (no Mac)

Uma vez só:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/radar/requirements.txt
cp .env.example .env   # e preencha SUPABASE_SERVICE_ROLE_KEY
```

A service role key está em Supabase > Project Settings > API. Ela ignora RLS:
fica só no `.env` (git-ignorado), nunca no frontend.

A cada competência:

```bash
.venv/bin/python scripts/radar/pgfn_ingest.py --competencia 202506 --uf SP
```

`--uf` é opcional: sem ele o script processa todos os arquivos da pasta. Com
ele, usa os arquivos cujo nome contém a UF (ou, se a base não vier separada
por UF, todos os arquivos filtrando pela coluna `UF_UNIDADE_RESPONSAVEL`).
`--pasta` aponta para outra pasta de CSVs; `--chunk` muda o tamanho do chunk
(padrão 200 mil linhas).

O que o script faz com cada arquivo:

1. Registra a execução em `radar_ingestoes`.
2. Descarta pessoa física e CNPJ sem 14 dígitos.
3. Mantém só receita com PIS, COFINS ou IPI, e descarta qualquer linha com
   SIMPLES na receita.
4. Mantém só inscrição ajuizada (`INDICADOR_AJUIZADO = SIM`).
5. Mantém só inscrição a partir de 01/01/2021.
6. Descarta nomes de banco, financeira, crédito, consórcio, seguradora,
   capitalização, massa falida, prefeitura, município, estado, fundação,
   associação, igreja e sindicato.
7. Faz upsert em `radar_inscricoes` por `(competencia, numero_inscricao)`, em
   lotes de 1000.
8. Ao final de todos os arquivos, chama `radar_consolidar_empresas`, que agrega
   por CNPJ em `radar_empresas` (quantidade, valor total, data mais recente,
   garantia, receitas) sem mexer em enriquecimento, status ou vínculo com o
   Kanban, e recalcula o score.

O log mostra, por arquivo, linhas lidas, aceitas, tempo e o descarte de cada
filtro. Falha em um arquivo fica em `radar_ingestoes.erro` e não interrompe os
demais.

## 3. Enriquecimento (automático)

O job `radar-enrich-hourly` do pg_cron chama a Edge Function
`radar-enrich-cnpj` a cada hora cheia, das 08h às 22h de Brasília. Cada rodada
pega até 70 empresas ainda não enriquecidas com status `novo`, da maior para a
menor pontuação, e consulta a BrasilAPI (pública, sem chave) uma por vez com
pausa de 1,2 s.

Com o cadastro em mãos, a função preenche razão social, nome fantasia, CNAE,
porte, situação cadastral, Simples/MEI, município, e-mail, telefone e sócios,
e aplica as exclusões automáticas (status `excluido` com o motivo):

- `simples_nacional`: optante do Simples ou MEI;
- `financeiro`: CNAE principal começando com 64 ou 65;
- `cadastro_inativo`: situação cadastral diferente de ATIVA;
- `cnpj_nao_encontrado`: a BrasilAPI respondeu 404.

Se a BrasilAPI responder 429 ou 5xx, a rodada para e a próxima hora tenta de
novo. A BrasilAPI raramente devolve e-mail (a Receita tirou o campo dos dados
abertos), então a coluna `email` costuma ficar vazia.

Para enriquecer CNPJs específicos na hora (ou reenriquecer), chame a function
com corpo `{ "cnpjs": ["33000167000101"] }`:

```bash
curl -X POST https://hfjvwibucplyhsvnwfor.supabase.co/functions/v1/radar-enrich-cnpj \
  -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
  -d '{"cnpjs":["33000167000101"]}'
```

Deploy da function: `npx supabase functions deploy radar-enrich-cnpj`.

**Enriquecimento local (fila inteira de uma vez).** O cron faz 70 CNPJs por
hora; para uma base nova de dezenas de milhares de empresas, rode no Mac:

```bash
nohup .venv/bin/python scripts/radar/enrich_local.py > data/pgfn/enrich_202606.log 2>&1 &
tail -f data/pgfn/enrich_202606.log        # acompanhar
pkill -f enrich_local.py                   # interromper (retomável: basta rodar de novo)
```

Mesma lógica da function (campos, exclusões, 404), pausa de 1200 ms, log a
cada 100 CNPJs; em 429 ou 5xx espera 60 s e tenta de novo. Pode rodar com o
cron ligado.

## 4. Score

`radar_calcular_score(cnpj)` devolve um inteiro de 0 a 100 (versão 3: migração 077
recalibrada com a base real de 06/2026, mais o critério da Fase 2 na 079):

| Critério | Pontos |
| --- | --- |
| Alguma inscrição com garantia | +30 |
| Valor total entre R$ 300 mil e R$ 1 milhão | +10 |
| Valor total entre R$ 1 milhão e R$ 5 milhões | +20 |
| Valor total entre R$ 5 milhões e R$ 50 milhões | +25 |
| Valor total entre R$ 50 milhões e R$ 300 milhões | +12 |
| Valor total acima de R$ 300 milhões | +3 |
| Pelo menos uma inscrição "Em cobrança" | +15 |
| Nenhuma em cobrança e todas em benefício fiscal ou negociação | -25 |
| 3 inscrições ou mais | +5 |
| Inscrição mais recente nos últimos 24 meses | +10 |
| CNAE principal nas divisões 05 a 33 (extrativa e indústria de transformação) | +10 |
| Porte DEMAIS | +5 |
| E-mail preenchido | +5 |
| Telefone preenchido | +5 |
| Embargos à execução fiscal localizados no PJe (Fase 2) | +10 |

Empresa com status `excluido` fica com score 0. O score é recalculado na
consolidação, no enriquecimento e quando o status muda na tela.

## 5. A tela

Menu **Seguro Garantia > Prospecção > Radar**. O cabeçalho mostra a competência
mais recente, o total por status e quantas empresas ainda não foram
enriquecidas. Os filtros (busca por nome ou CNPJ, UF, município com chips e
autocomplete, região com presets em `src/views/Radar/radarRegioes.ts`, faixa
de valor, garantia, status, receita, dossiê, mostrar excluídos) rodam no
servidor; a tabela vem ordenada por score, 50 por página.

Clicar numa linha abre o drawer com a dívida, o cadastro, os sócios, e-mail e
telefone (com botão copiar) e as inscrições. Ações:

- **Enviar ao Kanban**: cria o lead em `prospects` na coluna Novos Leads
  (origem `radar`, tags `radar` e `pgfn`, observação com valor e inscrições)
  e marca a empresa como `enviado_kanban`. Depois disso o botão fica
  desabilitado e aparece "Abrir no Kanban".
- **Descartar**: pede um motivo curto e marca `descartado`.
- **Reverter para novo**: volta para `novo` (o card já criado no Kanban não é
  apagado).

Status na tela: novo em azul, no Kanban em verde (emerald), descartado em
âmbar, excluído em cinza.

## 6. Fase 2 · dossiê judicial (PJe TRF3)

Para cada empresa do Radar com garantia, um worker no Mac localiza as
execuções fiscais (classe 1116) e os embargos à execução fiscal (1118) na
consulta pública do PJe TRF3 1º grau e grava vara, advogados e as 15
movimentações mais recentes. O drawer da empresa mostra tudo isso na seção
"Processos no TRF3", com uma leitura automática em uma frase e o campo
"Garantia informada" para anotar o que o advogado ou a empresa disser.

### Fluxo

1. `radar_enfileirar_dossies()` (cron `radar-fila-daily`, 06h de Brasília)
   coloca em `radar_pje_fila` toda empresa `novo`, com garantia e sem dossiê,
   com prioridade igual ao score. O botão "Buscar processos" do drawer
   enfileira com prioridade 100.
2. O worker pega a próxima da fila (prioridade maior, mais antiga primeiro)
   e busca na API por CNPJ (`GET /v1/processos?documento=...&dataAutuacaoInicio=
   2021-01-01`), paginando enquanto a página vier cheia com o aviso dos 30, e
   fica só com as classes 1116/1118. Sem nada desde 2021, repete sem filtro de
   data; se nem a paginação der conta, quebra por ano.
3. Grava todos os processos da listagem em `radar_processos` (número CNJ,
   classe, assunto, partes, última movimentação) e detalha os 8 mais recentes
   com quatro chamadas cada (`/dados`, `/poloPassivo`, `/poloAtivo`,
   `/movimentacoes`): vara, jurisdição, data de distribuição, polos, advogados
   (`radar_processo_advogados`) e as 15 movimentações mais recentes
   (`radar_processo_movimentos`). Confere os 3 primeiros dígitos do CNPJ
   mascarado; homônimo é apagado e vai para o log.
4. `radar_consolidar_dossie(cnpj)` recalcula `qtd_execucoes`, `qtd_embargos`,
   `dossie_status` (`pronto` ou `sem_processos`), `dossie_em` e o score
   (embargos localizados valem +10).

### Fatos verificados sobre a API da consulta pública (20/09/2026)

Em 14/09/2026 o TRF3 aposentou a consulta pública antiga em JSF/Seam
(`pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam`), que passou a
redirecionar para `https://pje1g-consultapublica.trf3.jus.br/`, um aplicativo
Angular. O worker deixou de raspar HTML e passou a chamar a API REST pública
que esse aplicativo consome (decisão 74).

- Base `https://pje1g-consultapublica.trf3.jus.br/v1`, JSON, sem login e sem
  captcha. Toda resposta tem `status`, `code`, `messages[]`, `result` e,
  quando pagina, `pageInfo {current, last, size, count}`.
- Busca: `GET /v1/processos?page=0&documento=<14 dígitos>&dataAutuacaoInicio=
  YYYY-MM-DD` (e `dataAutuacaoFim` para a quebra por ano). Cada item traz
  `idProcesso`, `numeroProcesso`, `classe`, `classeSigla` ("ExFis",
  "EmbExeFis"), `assunto`, `ultimaMovimentacao` ("Texto (dd/mm/aaaa hh:mm:ss)")
  e `partes.poloAtivo/poloPassivo.nomeParte`.
- Detalhe, com o `idProcesso` da mesma resposta da busca (o token muda a cada
  resposta; não guardar entre execuções): `/dados` (`dataDistribuicao` ISO,
  `classeJudicial` com o código entre parênteses, `jurisdicao`,
  `orgaoJulgador`), `/poloPassivo?page=0` e `/poloAtivo?page=0` (10 por
  página, `participante` com OAB e documento mascarado, `nome`, `tipo`) e
  `/movimentacoes?page=0` (15 por página, `movimento` e `dataAtualizacao`
  "dd/mm/aaaa hh:mm:ss", já em ordem decrescente; `pageInfo.count` é o total).
- **O `pageInfo` da primeira página não é confiável.** Com mais de 30
  processos ela devolve `last: 1` e `count: 30`; só a partir de `?page=1` a
  API admite o total real. O sinal de que há mais é o aviso "somente os 30
  primeiros" em `messages[]` — foi assim que a Procomp passou de 30 para 42.
- `/poloPassivo` devolve HTTP 500 em alguns processos: trata como lista vazia
  e segue, sem marcar erro na empresa.
- O CNPJ dos participantes vem mascarado (`16.4XX.XXX/XXXX-XX`). Como a busca
  já é por CNPJ, a conferência é só de sanidade (3 primeiros dígitos).
- Nome social vem como "FULANA registrado(a) civilmente como FULANO" no mesmo
  campo; o worker guarda só o nome social.
- Nos embargos a empresa é EMBARGANTE no polo ativo; o worker grava os lados
  em relação à empresa.
- O Akamai continua na frente: a API responde HTTP/2 `INTERNAL_ERROR` para
  cliente sem os cookies do navegador. Por isso o Chrome real continua sendo
  aberto, só para abrir o aplicativo uma vez por empresa e renovar o cookie;
  as chamadas saem por `context.request.get`, que reusa a sessão.

### Ritmo e bloqueio (Akamai)

O PJe fica atrás do Akamai: requisições em sequência rápida geram "Access
Denied" (`errors.edgesuite.net`), bloqueio temporário por IP. A API custa
cerca de 1 + 4 x N chamadas por empresa (uma busca e quatro por processo
detalhado), contra dezenas de cliques da tela antiga, então o ritmo pôde
afrouxar. Configurado no topo de `scripts/radar/pje_worker.py`:

| Parâmetro | Valor |
| --- | --- |
| Janela de trabalho | 07h às 23h (hora do Mac) |
| Intervalo entre empresas | 60 s ± 30 s |
| Intervalo entre requisições (busca, cada chamada de detalhe) | 6 s ± 4 s |
| Detalhes abertos por empresa | 8 (os mais recentes) |
| Teto diário | 150 empresas |
| Bloqueio | empresa vira `bloqueado`, worker dorme 60 min, dobra as pausas pelo resto do dia e tenta a mesma empresa; no 3º bloqueio do dia para até a próxima janela |

Uma empresa com 7 detalhes leva uns 3 minutos (medido em 20/09/2026: Suzano,
186 s; Procomp, 3 detalhes em 98 s); com o intervalo entre empresas, o teto de
150 por dia cabe na janela. Erro inesperado (não bloqueio) conta tentativa: na
3ª a fila fica `erro` e a empresa `dossie_status = 'erro'`.

### Rodar o worker

```bash
.venv/bin/pip install -r scripts/radar/requirements.txt   # playwright entrou aqui
.venv/bin/python scripts/radar/pje_worker.py --cnpj 56199714000710              # uma empresa, com janela
.venv/bin/python scripts/radar/pje_worker.py --cnpj 56199714000710 --detalhes 30 # abrindo todos os detalhes
.venv/bin/python scripts/radar/pje_worker.py                                     # fila inteira, com janela
```

`--headless` existe, mas o PJe responde `ERR_HTTP2_PROTOCOL_ERROR` ao Chrome
headless (decisão 67); use com janela.

O worker usa o Google Chrome instalado no Mac (`channel="chrome"`) com perfil
persistente em `data/radar/pje-profile/` (cookies mantidos entre execuções).
`--debug` salva o JSON bruto de cada chamada em `data/radar/debug/`
(`busca_<cnpj>_<periodo>_p<n>.json`, `dados_<numero>.json`,
`poloPassivo_<numero>_p<n>.json`, `movimentacoes_<numero>.json`). Log:
`data/radar/pje_worker.log`, uma linha por empresa (processos, detalhes,
homônimos, tempo) e uma por bloqueio.

### Deixar rodando (launchd)

```bash
scripts/radar/install_launchd.sh --dry-run   # mostra o que faria
scripts/radar/install_launchd.sh             # copia o plist para ~/Library/LaunchAgents e carrega
tail -f data/radar/pje_worker.log            # acompanhar
scripts/radar/install_launchd.sh --unload    # parar (launchctl unload) e remover
```

O plist (`com.fg.radar-pje`) tem `KeepAlive` e `RunAtLoad`: o worker sobe no
login e volta sozinho se cair. Roda com janela (o PJe rejeita headless), mas
o processo do Chrome fica escondido (Cmd+H via System Events) e o foco volta
ao app que estava na frente (decisão 68). Desde a migração para a API o
navegador só abre o aplicativo uma vez por empresa, para renovar o cookie do
Akamai: não há mais aba de detalhe nem popup (decisão 74). Na primeira execução o macOS pode pedir permissão
para o Python controlar o System Events: aceite, senão a janela fica visível. Saída e erro do processo ficam em
`data/radar/launchd.out.log` e `launchd.err.log`. O modelo em
`scripts/radar/com.fg.radar-pje.plist` usa `__RAIZ__` no lugar da pasta do
repositório; se o repo mudar de pasta, rode o install de novo.

### Se o bloqueio virar frequente

Bloqueio é por IP. Se o log mostrar `!! BLOQUEIO` todo dia, mova o worker
para outra máquina ou outra rede: copie a pasta do repositório (ou só
`scripts/radar/`, `requirements.txt` e a venv recriada), o `.env` da raiz e a
pasta `data/radar/pje-profile/` (o perfil do navegador, com os cookies do
Akamai) e instale o launchd lá. Antes disso, aumentar
`INTERVALO_ENTRE_REQUISICOES_S` no topo do worker costuma bastar.

### Tela

- Drawer: seção "Processos no TRF3" com badge do dossiê, data, botão "Buscar
  processos"/"Atualizar", leitura automática, lista de processos (clicar
  expande as movimentações), "Advogados do executado" (deduplicados, com
  contagem e botão copiar) e "Garantia informada" (select + observação).
- Tabela: coluna "Dossiê" (execuções/embargos quando pronto) e filtro "Dossiê"
  (todos, pronto, com embargos, na fila, sem processos).
- "Enviar ao Kanban" acrescenta "Execuções fiscais: N, Embargos: M" e
  "Advogados: nome (OAB), ..." à observação do lead.
- Menu Prospecção > "Radar · Advogados": `vw_radar_advogados`, os escritórios
  que mais defendem executados fiscais (canal de parceria).

## Roadmap

- **Fase 3 · monitoramento (Datajud)**: acompanhar as movimentações dos
  processos encontrados e avisar quando surgir a janela do seguro garantia.
  Não começou.
