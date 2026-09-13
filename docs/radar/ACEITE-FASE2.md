# Radar · Fase 2 · Resultado dos critérios de aceite

Rodado em 13/09/2026 contra o projeto real `hfjvwibucplyhsvnwfor`, na branch
`radar-fase2`, a partir do Mac (Chrome real, com janela).

## 1. Migração aplica no projeto real

- Migração `079_radar_fase2_pje.sql` testada antes em banco limpo (PGlite,
  sem o bloco do cron) e aplicada no projeto real pelo MCP do Supabase
  (`apply_migration`, `success: true`).
- `radar_enfileirar_dossies()` enfileirou **708 empresas** (status `novo`,
  `tem_garantia = true`, `dossie_status = 'nenhum'`); a especificação estimava
  em torno de 800. Depois da carga: 0 empresas restantes com `nenhum` entre as
  candidatas, 708 com `dossie_status = 'fila'`.
- `cron.job` tem `radar-fila-daily` ativo com `0 9 * * *` (06h de Brasília).
- Funções `radar_consolidar_dossie`, `radar_enfileirar_dossies` e
  `radar_calcular_score` (v3) e view `vw_radar_advogados` existem.

## 2. Worker com --cnpj da Convenção

CNPJ localizado em `radar_empresas` pelo nome: `56199714000710`. Rodado duas
vezes: primeiro com a busca por nome (versão inicial do worker) e depois, em
13/09/2026 às 17h40, com a busca principal pelo CNPJ (decisão 66):

```
.venv/bin/python scripts/radar/pje_worker.py --cnpj 56199714000710 --detalhes 30
```

`--detalhes 30` abre o detalhe de todos os processos: o 5002050-64.2023 do
gabarito não está entre os 8 mais recentes (decisão 54). Trecho do log da
rodada por CNPJ:

```
-> 56199714000710 CONVENCAO SAO PAULO INDUSTRIA DE BEBIDAS E CONEXOS LTDA
   busca por cnpj: "56199714000710" (01/01/2021)
   22 resultados, 20 das classes 1116/1118
   listagem: 20 processos das classes 1116/1118
   ...
   5002050-64.2023.4.03.6182: 2ª Vara de Execuções Fiscais Federal de São Paulo | dist. 2023-06-07 | 3 adv | 15 mov gravadas de 44
   ...
<- 56199714000710 CONVENCAO SAO PAULO ... | processos 20 | detalhes 20 | homônimos 0 | 556s
```

Sem bloqueio (nenhum `!! BLOQUEIO` no log), intervalos respeitados (pausas de
12 a 27 s entre requisições, 20 s ± 8 s). A busca por CNPJ devolveu a mesma
listagem da busca pelo nome exato. Gravado no banco:

| Critério | Esperado | Gravado |
| --- | --- | --- |
| Processos com autuação desde 2021 | 20 | **20** |
| Classe 1116 (execução fiscal) | 13 | **12** |
| Classe 1118 (embargos) | 7 | **8** |
| 5002050-64.2023 · órgão julgador | 2ª Vara de Execuções Fiscais Federal de São Paulo | **igual** |
| 5002050-64.2023 · data de distribuição | 07/06/2023 | **2023-06-07** |
| 5002050-64.2023 · advogados | SP182592, SP384275, SP490636 | **3: SP182592, SP384275, SP490636** (polo passivo) |
| 5002050-64.2023 · movimentações gravadas | 15 | **15** (de 44 no PJe, `qtd_movimentacoes = 44`) |

A busca devolve hoje 22 resultados (20 das duas classes mais um mandado de
segurança e um procedimento comum). A divisão 12/8 é o que a listagem mostra
linha a linha (a especificação dizia 13/7; decisão 62). Há uma execução nova
de 04/09/2026 (5018946-80.2026). CNPJ mascarado conferido em todos os 20
detalhes (`56.1XX`).

Varas (20 processos): 2ª Vara de Execuções Fiscais Federal de São Paulo é a
mais frequente, com 4; depois 10ª e 7ª com 3 cada; 13ª, 5ª e 9ª com 2; 12ª,
1ª e 4ª com 1; e um embargos (5006308-88.2021) em "Rede de Apoio 4.0 - Plano
29", como o PJe mostra.

Advogados do executado (polo passivo, deduplicados):

| Advogado | OAB | Processos |
| --- | --- | --- |
| FREDERICO SANTIAGO LOUREIRO DE OLIVEIRA | SP182592 | 17 |
| LUIZ GUSTAVO RODELLI SIMIONATO | SP223795 | 11 |
| HELENA CASTRO GONZALEZ | SP490636 | 1 |
| TAIS BARBOSA DE OLIVEIRA | SP384275 | 1 |

## 3. Segunda empresa do topo: Larru's

CNPJ `43606714000150` (LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS LTDA., Jandira/SP,
score 100, R$ 27,8 milhões inscritos, com garantia).

**Pelo nome: zero.** Na primeira versão do worker, as cinco variantes do nome
("LARRU'S ... LTDA.", sem o ponto, "LARRUS ...", e a forma tolerante), com
data desde 2021 e depois sem data, devolveram 0 resultados. Um diagnóstico à
parte, pelo campo CPF/CNPJ do formulário, achou 30 resultados (teto) com 11
execuções fiscais: o índice de nome do PJe não casa nomes com apóstrofo. Por
isso a busca principal passou a ser pelo CNPJ (decisão 66).

**Pelo CNPJ** (13/09/2026, 17h30):

```
.venv/bin/python scripts/radar/pje_worker.py --cnpj 43606714000150 --detalhes 30
```

```
-> 43606714000150 LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS LTDA.
   busca por cnpj: "43606714000150" (01/01/2021)
   23 resultados, 12 das classes 1116/1118
   listagem: 12 processos das classes 1116/1118
   ...
<- 43606714000150 LARRU'S ... | processos 12 | detalhes 12 | homônimos 0 | 342s
```

Sem bloqueio. Gravado: **12 execuções fiscais (1116) e 0 embargos (1118)**,
todas com autuação desde 2021 (sete de 2025 e cinco de 2021 a 2024 na
subseção de Barueri, redistribuídas em 09/01/2025 para as varas de execuções
fiscais de São Paulo). CNPJ mascarado `43.6XX` conferido nos 12 detalhes.
`dossie_status = 'pronto'`, fila `concluido`.

Varas: 13ª e 4ª Varas de Execuções Fiscais Federal de São Paulo, com 3
processos cada, são as mais frequentes; 2ª com 2; 1ª, 3ª, 9ª e 10ª com 1.

Advogados do executado (polo passivo, deduplicados):

| Advogado | OAB | Processos |
| --- | --- | --- |
| LUIZ GUSTAVO ANTONIO SILVA BICHARA | SP303020 | 7 |
| PATRICIA CAMPOS LIMA | MG102096 | 4 |
| ANA CAROLINA MARTINS MARCONDES | SP462112 | 1 |
| EDUARDO OLIVEIRA GONCALVES | SP284974 | 1 |

Leitura automática na tela: "Execução em curso sem embargos localizados:
risco de penhora ou bloqueio. Oferecer seguro garantia para garantir o juízo."

## 4. Dossiê, contagens e score das duas empresas

| Empresa | dossie_status | qtd_execucoes | qtd_embargos | score |
| --- | --- | --- | --- | --- |
| Convenção (56199714000710) | pronto (13/09/2026 16:57) | 12 | 8 | 100 (já era 100; +10 dos embargos fica no teto) |
| Larru's (43606714000150) | pronto (13/09/2026 17:36) | 12 | 0 | 100 |

`radar_calcular_score` recalculado confere com a coluna `score` nas duas.
Fila: 706 pendentes, 2 concluídos (Convenção e Larru's).

## 5. Tela

- Build e type-check passam com a seção "Processos no TRF3" (badge, data,
  botão Buscar processos/Atualizar, leitura automática, processos com
  movimentações expansíveis, advogados do executado, garantia informada), a
  coluna e o filtro "Dossiê" e a view "Radar · Advogados".
- `vw_radar_advogados` lista os 8 advogados das duas empresas (4 da
  Convenção, 4 da Larru's), cada um com 1 empresa, ordenados por processos:
  SP182592 (17), SP223795 (11), SP303020 (7), MG102096 (4) e quatro com 1.
- **Não verificado no navegador:** salvar a garantia, o botão "Buscar
  processos" (upsert em `radar_pje_fila` com prioridade 100) e o filtro
  "Dossiê" dependem de uma sessão logada no hub, e o Claude Code não pode
  digitar a senha. O dev server ficou de pé em `http://localhost:3000` com uma
  aba aberta no Chrome para o teste manual: abrir o Radar, filtrar Dossiê =
  Pronto (deve aparecer a Convenção), abrir o drawer, salvar uma garantia e
  reabrir para conferir; em outra empresa, clicar em "Buscar processos" e
  conferir em `radar_pje_fila` a linha com `prioridade = 100`.

## 6. Build e RLS

- `npm run build`: sem warnings novos (só o aviso de chunk acima de 500 kB,
  que já existia). `npx tsc --noEmit` sem erros nos arquivos do Radar.
- RLS ativo (`relrowsecurity = true`) em `radar_pje_fila`, `radar_processos`,
  `radar_processo_movimentos` e `radar_processo_advogados`, com uma política
  `for all` para `authenticated` em cada uma (4 políticas).

## 7. launchd

`scripts/radar/com.fg.radar-pje.plist` e `scripts/radar/install_launchd.sh`
criados. `install_launchd.sh --dry-run` imprimiu os passos (pasta do repo,
destino em `~/Library/LaunchAgents`, comando com `--headless`, logs) sem
instalar: `~/Library/LaunchAgents` não tem `com.fg.radar-pje.plist`.

## Observações

- A busca principal é pelo CNPJ (decisão 66); o nome exato fica como
  fallback e não acha nomes com apóstrofo (decisões 48 e 64).
- Total gravado no banco ao final: 32 processos (20 da Convenção, 12 da
  Larru's), com movimentações e advogados de todos os 32 detalhes.
- Fase 3 (Datajud) não foi iniciada.
