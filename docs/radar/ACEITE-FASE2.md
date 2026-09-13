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

CNPJ localizado em `radar_empresas` pelo nome: `56199714000710`.

```
.venv/bin/python scripts/radar/pje_worker.py --cnpj 56199714000710 --detalhes 30
```

`--detalhes 30` abre o detalhe de todos os processos: o 5002050-64.2023 do
gabarito não está entre os 8 mais recentes (decisão 54). Trecho do log:

```
-> 56199714000710 CONVENCAO SAO PAULO INDUSTRIA DE BEBIDAS E CONEXOS LTDA
   busca: "CONVENCAO SAO PAULO INDUSTRIA DE BEBIDAS E CONEXOS LTDA"
   pausa 14s (abrir consulta)
   pausa 19s (pesquisar)
   22 resultados, 20 das classes 1116/1118
   listagem: 20 processos das classes 1116/1118
   pausa 26s (detalhe 5018946-80.2026.4.03.6182)
   ...
   5002050-64.2023.4.03.6182: 2ª Vara de Execuções Fiscais Federal de São Paulo | dist. 2023-06-07 | 3 adv | 15 mov gravadas de 44
   ...
<- 56199714000710 CONVENCAO SAO PAULO ... | processos 20 | detalhes 20 | homônimos 0 | 557s
```

Sem bloqueio (nenhum `!! BLOQUEIO` no log), intervalos respeitados (pausas de
12 a 27 s entre requisições, 20 s ± 8 s). Gravado no banco:

| Critério | Esperado | Gravado |
| --- | --- | --- |
| Processos com autuação desde 2021 | 20 | **20** |
| Classe 1116 (execução fiscal) | 13 | **12** |
| Classe 1118 (embargos) | 7 | **8** |
| 5002050-64.2023 · órgão julgador | 2ª Vara de Execuções Fiscais Federal de São Paulo | **igual** |
| 5002050-64.2023 · data de distribuição | 07/06/2023 | **2023-06-07** |
| 5002050-64.2023 · advogados | SP182592, SP384275, SP490636 | **3: SP182592, SP384275, SP490636** (polo passivo) |
| 5002050-64.2023 · movimentações gravadas | 15 | **15** (de 44 no PJe, `qtd_movimentacoes = 44`) |

A busca do PJe devolve hoje 22 resultados (20 das duas classes mais um
mandado de segurança e um procedimento comum). A divisão 12/8 é o que a
listagem mostra linha a linha (a especificação dizia 13/7; decisão 62). Há
uma execução nova de 04/09/2026 (5018946-80.2026). Assunto do 5002050:
Cofins e PIS. CNPJ mascarado conferido em todos os 20 detalhes (`56.1XX`).

## 3. Segunda empresa do topo: Larru's

CNPJ `43606714000150` (LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS LTDA., Jandira/SP,
score 100, R$ 27,8 milhões inscritos, com garantia).

```
.venv/bin/python scripts/radar/pje_worker.py --cnpj 43606714000150 --debug
```

```
   busca: "LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS LTDA."   → 0 resultados
   busca: "LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS LTDA"    → 0 resultados
   busca: "LARRUS INDUSTRIA E COMERCIO DE COSMETICOS LTDA"     → 0 resultados
   busca: "LARRUS INDUSTRIA E COMERCIO DE COSMETICOS LTDA."    → 0 resultados
   busca: "LARRU'S INDUSTRIA E COMERCIO DE COSMETICOS"         → 0 resultados
<- 43606714000150 ... | processos 0 | detalhes 0 | homônimos 0 | 252s
```

Nenhum processo das classes 1116/1118 com autuação desde 01/01/2021 no PJe
TRF3 1º grau para nenhuma das cinco variantes do nome. Sem bloqueio.
Resultado: `dossie_status = 'sem_processos'`, fila `sem_processos`. Possíveis
causas (não verificadas): execuções autuadas antes de 2021 ou nome diferente
no PJe.

## 4. Dossiê, contagens e score das duas empresas

| Empresa | dossie_status | qtd_execucoes | qtd_embargos | score |
| --- | --- | --- | --- | --- |
| Convenção (56199714000710) | pronto (13/09/2026 16:57) | 12 | 8 | 100 (já era 100; +10 dos embargos fica no teto) |
| Larru's (43606714000150) | sem_processos (13/09/2026 17:05) | 0 | 0 | 100 |

`radar_calcular_score` recalculado confere com a coluna `score` nas duas.
Fila: 706 pendentes, 1 concluído (Convenção), 1 sem_processos (Larru's).

## 5. Tela

- Build e type-check passam com a seção "Processos no TRF3" (badge, data,
  botão Buscar processos/Atualizar, leitura automática, processos com
  movimentações expansíveis, advogados do executado, garantia informada), a
  coluna e o filtro "Dossiê" e a view "Radar · Advogados".
- `vw_radar_advogados` lista os advogados da Convenção no banco:
  FREDERICO SANTIAGO LOUREIRO DE OLIVEIRA (SP182592, 17 processos), LUIZ
  GUSTAVO RODELLI SIMIONATO (SP223795, 11), HELENA CASTRO GONZALEZ (SP490636, 1)
  e TAIS BARBOSA DE OLIVEIRA (SP384275, 1), todos com 1 empresa.
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

- A busca do PJe é por nome exato (decisões 48 e 64); a forma tolerante da
  especificação devolve zero.
- Total gravado no banco ao final: 20 processos, 283 movimentações, 34
  linhas de advogados (por processo).
- Fase 3 (Datajud) não foi iniciada.
