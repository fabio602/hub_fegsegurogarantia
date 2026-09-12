# Radar · Fase 1

Módulo do Hub que transforma a base pública de devedores da PGFN em uma lista
de indústrias com dívida federal ajuizada, enriquecida com o cadastro da
Receita e pontuada, pronta para virar lead no Kanban com um clique.

A ideia: empresa com PIS, COFINS ou IPI ajuizado precisa garantir a execução
fiscal (penhora, depósito ou seguro garantia judicial). É prospecção de seguro
garantia judicial com o gatilho certo.

Especificação completa: [RADAR-FASE1.md](RADAR-FASE1.md). Decisões tomadas
durante a implementação: [DECISOES.md](DECISOES.md).

## Peças

| Peça | Onde | O que faz |
| --- | --- | --- |
| Migrações 075 e 076 | `supabase/075_radar_fase1.sql`, `supabase/076_radar_receitas_tipos.sql` | Tabelas `radar_ingestoes`, `radar_inscricoes`, `radar_empresas`, view `vw_radar_empresas`, funções de score e consolidação, cron do enriquecimento |
| Script de ingestão | `scripts/radar/pgfn_ingest.py` | Lê os CSVs da PGFN, filtra, grava as inscrições e consolida por CNPJ |
| Edge Function | `supabase/functions/radar-enrich-cnpj` | Enriquece as empresas pela BrasilAPI, de hora em hora |
| Tela | `src/views/Radar/` | View `radar` do Hub (menu Seguro Garantia > Prospecção > Radar) |

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

`radar_calcular_score(cnpj)` devolve um inteiro de 0 a 100 (versão 2, migração 077,
recalibrada com a base real de 06/2026):

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

## Roadmap

- **Fase 2 · descoberta do processo (PJe)**: para cada empresa, achar a
  execução fiscal correspondente e o momento da citação, quando a garantia
  precisa ser apresentada.
- **Fase 3 · monitoramento (Datajud)**: acompanhar as movimentações dos
  processos encontrados e avisar quando surgir a janela do seguro garantia.
