# Aceite · worker do PJe pela API JSON

Data: 20/09/2026. Spec: [RADAR-PJE-API.md](RADAR-PJE-API.md). Decisões 74 e 75.
Branch `radar-pje-api`. Worker do launchd parado durante todo o trabalho.

## 1. Ponto de partida

Desde 14/09/2026 todas as empresas voltavam com
`RuntimeError('radio de CNPJ não encontrado')`. No começo desta sessão a fila
estava com 44 concluídas, 99 em `erro` (97 desse mesmo erro) e 565 em
`bloqueado` — estas últimas estacionadas de propósito, com
`erro = 'pausado em 20/09/2026: migracao da consulta publica do PJe TRF3'`.

## 2. Os dois testes da seção 5 da spec

Rodados com `.venv/bin/python scripts/radar/pje_worker.py --cnpj <x> --debug`.

### Suzano · 16404287004738 (subseção de Santos)

```
busca 2021-01-01: 8 resultados em 1 pág., 7 das classes 1116/1118
listagem: 7 processos das classes 1116/1118
5001664-69.2026.4.03.6104: 7ª Vara Federal de Santos | dist. 2026-03-18 | 0 adv | 10 mov gravadas de 10
5001661-17.2026.4.03.6104: 7ª Vara Federal de Santos | dist. 2026-03-18 | 0 adv | 10 mov gravadas de 10
5002304-09.2025.4.03.6104: 7ª Vara Federal de Santos | dist. 2025-04-04 | 1 adv | 15 mov gravadas de 27
5001681-91.2021.4.03.6133: 7ª Vara Federal de Santos | dist. 2025-01-09 | 0 adv | 15 mov gravadas de 22
5001327-66.2021.4.03.6133: 7ª Vara Federal de Santos | dist. 2025-01-09 | 1 adv | 15 mov gravadas de 25
5000912-83.2021.4.03.6133: 7ª Vara Federal de Santos | dist. 2025-01-09 | 0 adv | 15 mov gravadas de 25
5000607-02.2021.4.03.6133: 7ª Vara Federal de Santos | dist. 2025-01-09 | 1 adv | 15 mov gravadas de 34
<- 16404287004738 SUZANO S.A. | processos 7 | detalhes 7 | homônimos 0 | 186s
```

8 processos, 7 execuções fiscais (o oitavo é mandado de segurança cível), como
a spec previa. Saída 0.

### Procomp · 54083035000160

```
busca 2021-01-01: 42 resultados em 2 pág., 3 das classes 1116/1118
listagem: 3 processos das classes 1116/1118
5039149-68.2023.4.03.6182: 8ª Vara de Execuções Fiscais Federal de São Paulo | dist. 2023-11-10 | 3 adv | 15 mov gravadas de 28
5028996-73.2023.4.03.6182: 12ª Vara de Execuções Fiscais Federal de São Paulo | dist. 2023-08-09 | 1 adv | 15 mov gravadas de 26
5013955-03.2022.4.03.6182: 4ª Vara de Execuções Fiscais Federal de São Paulo | dist. 2022-06-24 | 3 adv | 15 mov gravadas de 40
<- 54083035000160 PROCOMP INDUSTRIA ELETRONICA LTDA | processos 3 | detalhes 3 | homônimos 0 | 98s
```

**A spec errou aqui.** Ela esperava "mandados de segurança e nenhuma execução
fiscal, ou seja, a empresa fica sem processos gravados". A empresa tem três
execuções fiscais, todas nas Varas de Execuções Fiscais Federal de São Paulo,
todas com advogado constituído. O que a spec descreve é o começo da primeira
página, que é quase toda de mandado de segurança; as execuções aparecem mais
abaixo, na mesma página. Saída 0, sem erro — o comportamento do worker está
certo, só o número esperado estava errado.

## 3. Conferência no banco

| | Suzano | Procomp |
| --- | --- | --- |
| `radar_pje_fila.status` | `concluido`, sem erro | `concluido`, sem erro |
| `radar_empresas.dossie_status` | `pronto` | `pronto` |
| `qtd_execucoes` / `qtd_execucoes_sem_advogado` | 7 / 4 | 3 / 0 |
| `radar_processos` | 7 | 3 |
| sem `data_distribuicao`, `orgao_julgador` ou `jurisdicao` | nenhum | nenhum |
| `radar_processo_advogados` | 3, todos com nome e OAB | 8, todos com nome e OAB |
| `radar_processo_movimentos` | 95 (máx. 15 por processo) | 45 (máx. 15 por processo) |

`cnpj_mascarado` gravado e coerente em todos (`16.4XX.XXX/XXXX-XX` e
`54.0XX.XXX/XXXX-XX`). `--debug` gravou 43 JSON em `data/radar/debug/`.

## 4. O que mudou em relação à spec

1. **Paginação pelo `messages[]`, não pelo `pageInfo.last`** (decisão 75). A
   spec mandava paginar "usando `page` e `pageInfo.last`". Na prática a
   primeira página de uma busca grande devolve `last: 1` e `count: 30`: a
   Procomp só admitiu 42 quando `?page=1` foi pedida. Com a regra da spec ao
   pé da letra a busca pararia na página 0 e perderia processos. O worker
   pagina enquanto a página vier cheia e o aviso "somente os 30 primeiros"
   estiver presente.
2. **Participantes paginados** (decisão 75). `/poloPassivo` e `/poloAtivo` vêm
   10 por página. A spec só previa `page=0`; um processo com mais de 10 partes
   esconderia o advogado e criaria alerta falso de "execução sem advogado"
   (decisão 72). Teto de 5 páginas.
3. **Nome social aparado**. A API devolve "FULANA registrado(a) civilmente
   como FULANO" no campo `nome`, o que sairia duplicado na tela de advogados.
   O worker guarda só o nome social. Há 29 nomes assim gravados por execuções
   antigas; serão corrigidos quando essas empresas forem reprocessadas.
4. **Aceite 2 da spec está errado** (seção 2 acima).
5. **O requeue da seção 6 da spec não basta**. O `update ... where status in
   ('erro','processando')` traz de volta as 99 em `erro`, mas deixa as 565 em
   `bloqueado`, que foram estacionadas por causa desta migração. O comando
   correto está abaixo.

## 5. Depois do merge

```sql
update radar_pje_fila
   set status = 'pendente', erro = null, tentativas = 0,
       iniciado_em = null, finalizado_em = null
 where status in ('erro', 'processando', 'bloqueado');
```

Depois religar o worker (`scripts/radar/install_launchd.sh`) e conferir
`data/radar/pje_worker.log` na primeira hora.
