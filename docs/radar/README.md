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
| Worker do PJe (Fase 2) | `scripts/radar/pje_worker.py` | Chrome real via Playwright consultando o PJe TRF3 em ritmo humano |
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
enriquecidas. Os filtros (busca por nome ou CNPJ, UF, faixa de valor, garantia,
status, receita, mostrar excluídos) rodam no servidor; a tabela vem ordenada
por score, 50 por página.

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
2. O worker pega a próxima da fila (prioridade maior, mais antiga primeiro),
   abre a consulta pública com um Chrome real, preenche "Nome da parte" com a
   razão social exata e "Data de Autuação" a partir de 01/01/2021, pesquisa e
   fica só com as linhas das duas classes. Se o PJe avisar que há mais de 30
   resultados, repete a pesquisa ano a ano.
3. Grava todos os processos da listagem em `radar_processos` (número CNJ,
   classe, assunto, partes, última movimentação) e abre o detalhe dos 8 mais
   recentes, em popup, clicando em "Ver Detalhes": vara, jurisdição, data de
   distribuição, polos, advogados (`radar_processo_advogados`) e as 15
   movimentações da primeira página (`radar_processo_movimentos`). Confere os
   3 primeiros dígitos do CNPJ mascarado; homônimo é apagado e vai para o log.
4. `radar_consolidar_dossie(cnpj)` recalcula `qtd_execucoes`, `qtd_embargos`,
   `dossie_status` (`pronto` ou `sem_processos`), `dossie_em` e o score
   (embargos localizados valem +10).

### Fatos verificados sobre o PJe TRF3 (13/09/2026)

- URL: `https://pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam`. Sem
  login e sem captcha (o hCaptcha existe na página, mas está desligado).
- Campos: `fPP:dnp:nomeParte` (nome exato da parte), `fPP:dataAutuacaoDecoration:
  dataAutuacaoInicioInputDate` e `...FimInputDate` (dd/mm/aaaa, preencher pelo
  valor do input), botão `fPP:searchProcessos`. Não mexer nos hidden
  `...InputCurrentDate` do calendário: zerá-los faz o servidor ignorar o
  formulário e devolver a base inteira.
- Resultado: tabela `fPP:processosTable`, uma linha por processo, com classe,
  "ExFis 5002050-64.2023.4.03.6182 - PIS", partes "A X B" e última
  movimentação "(dd/mm/aaaa hh:mm:ss)". Rodapé "N resultados encontrados".
  Teto de 30 linhas; acima disso aparece o aviso "somente os 30 primeiros".
- "Ver Detalhes" abre um popup (`openPopUp(...)`); o worker captura o popup
  com `expect_popup` e nunca navega direto para a URL do detalhe.
- Detalhe: "Número Processo", "Data da Distribuição", "Classe Judicial
  (1116)", "Assunto", "Jurisdição", "Órgão Julgador", "Polo ativo", "Polo
  Passivo" (participante " - CNPJ: 56.1XX.XXX/XXXX-XX (EXECUTADO)", advogado
  " - OAB SP182592 - CPF: ... (ADVOGADO)"), "Movimentações do Processo"
  (15 por página, "dd/mm/aaaa hh:mm:ss - texto", linha de Documento indentada
  por tabulação) e "Documentos juntados ao processo" (ignorado). Nos embargos a
  empresa é EMBARGANTE no polo ativo; o worker grava os lados em relação à
  empresa.

### Ritmo e bloqueio (Akamai)

O PJe fica atrás do Akamai: cerca de 10 requisições em sequência rápida
(menos de 2 s) geram "Access Denied" (`errors.edgesuite.net`), bloqueio
temporário por IP. Por isso o worker, configurado no topo de
`scripts/radar/pje_worker.py`:

| Parâmetro | Valor |
| --- | --- |
| Janela de trabalho | 07h às 23h (hora do Mac) |
| Intervalo entre empresas | 5 min ± 60 s |
| Intervalo entre requisições (pesquisa, cada detalhe, cada ano) | 20 s ± 8 s |
| Detalhes abertos por empresa | 8 (os mais recentes) |
| Teto diário | 60 empresas |
| Bloqueio | empresa vira `bloqueado`, worker dorme 60 min e tenta a mesma empresa; no 3º bloqueio do dia para até a próxima janela |

Uma empresa com 8 detalhes leva uns 5 minutos; com o intervalo entre
empresas, o teto de 60 por dia cabe na janela. Erro inesperado (não bloqueio)
conta tentativa: na 3ª a fila fica `erro` e a empresa `dossie_status = 'erro'`.

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
`--debug` salva o HTML e o texto de cada página em `data/radar/debug/`. Log:
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
ao app que estava na frente; a cada detalhe aberto o Chrome pisca por menos
de um segundo (decisão 68). Na primeira execução o macOS pode pedir permissão
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
