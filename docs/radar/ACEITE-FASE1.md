# Radar · Fase 1 · Resultado dos critérios de aceite

Rodado em 12/09/2026 contra o projeto real `hfjvwibucplyhsvnwfor`.

## 1. Migração aplica sem erro

- **Banco limpo:** PGlite (Postgres 17 em WebAssembly, sem Docker) com
  `tests/radar/migracao_banco_limpo.mjs`. Migração 075 aplicada, RLS `true`
  nas três tabelas, consolidação de 4 inscrições em 2 empresas com scores
  80 e 10, score 0 após excluir, view sem excluídos. O bloco do cron ficou
  de fora (pg_cron, pg_net e Vault são extensões do Supabase).
- **Projeto real:** 075 e 076 aplicadas pelo MCP do Supabase (`apply_migration`,
  `success: true`). `cron.job` tem `radar-enrich-hourly` ativo com
  `0 0-1,11-23 * * *`; view `vw_radar_empresas` e funções
  `radar_calcular_score`, `radar_atualizar_score`, `radar_consolidar_empresas`
  e `receitas_tipos` existem.

## 2. Ingestão do fixture de 5.000 linhas

`tests/fixtures/pgfn_sample.csv` (gerado por `gerar_pgfn_sample.py`, seed fixa),
copiado para `data/pgfn/202506/` e rodado com
`.venv/bin/python scripts/radar/pgfn_ingest.py --competencia 202506`.

```
== pgfn_sample.csv
   chunk 1:     5000 lidas |    2030 aceitas |    7.1s
   lidas: 5000 | aceitas: 2030 | tempo: 7.4s
   descartes por filtro:
     pessoa_fisica         450   TIPO_PESSOA diferente de pessoa jurídica
     cnpj_invalido         120   CPF_CNPJ sem 14 dígitos
     receita_simples       500   RECEITA_PRINCIPAL contém SIMPLES
     receita_fora          700   RECEITA_PRINCIPAL sem PIS, COFINS ou IPI
     nao_ajuizado          500   INDICADOR_AJUIZADO diferente de SIM
     data_antiga           500   DATA_INSCRICAO anterior a 2021-01-01 ou inválida
     nome_excluido         200   NOME_DEVEDOR na lista de exclusão

== consolidando radar_empresas (202506)
   empresas inseridas/atualizadas: 756

total: 5000 lidas | 2030 aceitas | 7.7s
```

Tempo total 7,7 s (limite: 30 s). Os descartes batem exatamente com o que o
gerador produziu para cada filtro.

## 3. Consolidado

| Consulta | Resultado |
| --- | --- |
| `select count(*) from radar_empresas` | 756 |
| `select count(*) from radar_inscricoes` | 2.030 |
| empresas cujo `receitas` não tem PIS, COFINS nem IPI | 0 |
| empresas com `tem_garantia` | 310 |
| `radar_ingestoes` | 1 linha, 5.000 lidas, 2.030 aceitas, sem erro, finalizada |

## 4. Enriquecimento manual

`POST /functions/v1/radar-enrich-cnpj` com os 7 CNPJs reais do fixture:

```
{"ok":true,"selecionadas":7,"processadas":7,"enriquecidas":7,"mantidas_novo":5,
 "excluidas":{"simples_nacional":1,"financeiro":1,"cadastro_inativo":0,"cnpj_nao_encontrado":0},
 "parou_em":null,"erros_gravacao":0,"segundos":15}
```

| CNPJ | Razão social | Porte | CNAE | Status | Motivo | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 33.000.167/0001-01 | PETROLEO BRASILEIRO S A PETROBRAS | DEMAIS | 0600001 | novo | | 95 |
| 33.592.510/0001-54 | VALE S.A. | DEMAIS | 0710301 | novo | | 95 |
| 07.526.557/0001-00 | AMBEV S.A. | DEMAIS | 1113502 | novo | | 95 |
| 51.609.238/0001-50 | HIGIDENT DO BRASIL IND. E COM. LTDA | DEMAIS | 2061400 | novo | | 95 |
| 33.611.500/0001-19 | GERDAU S.A. | DEMAIS | 2423702 | novo | | 85 |
| 20.648.430/0001-21 | ASHER BRUFFER ADMINISTRADORA DE CONDOMINIOS LTDA | EPP, Simples | 8211300 | excluido | simples_nacional | 0 |
| 00.000.000/0001-91 | BANCO DO BRASIL SA | DEMAIS | 6422100 | excluido | financeiro | 0 |

Telefone e sócios preenchidos em todos (Banco do Brasil com 41 sócios/administradores).
E-mail vazio em todos: a BrasilAPI não devolve e-mail.

O cron já rodou sozinho às 16h de Brasília e processou 60 CNPJs sintéticos do
fixture: todos 404 na BrasilAPI e marcados `excluido / cnpj_nao_encontrado`,
como especificado.

## 5. Tela

Verificado no dev server local (`localhost:3000`) apontando para o Supabase de
produção, com a sessão do Fábio no navegador do Playwright MCP. O hub só vai
para produção no push da `main`, depois do merge.

- Menu Seguro Garantia > Prospecção > **Radar** abre a tela com cabeçalho
  (competência 06/2025; novo 694, no Kanban 0, descartado 0, excluído 62,
  sem enriquecer 689), filtros e tabela com 50 por página (1–50 de 694, 14 páginas).
- Filtros conferidos contra SQL: busca "gerdau" 1 resultado; UF MG 72;
  MG + garantia + IPI 19; + valor mínimo R$ 20 mi 8; mostrar excluídos 756;
  limpar filtros 694.
- Drawer da Higident: dívida, cadastro, 3 sócios, telefone com copiar,
  3 inscrições. **Enviar ao Kanban** criou o lead
  `30d37545-574c-4d9e-a35b-945c33b20a16` em `prospects` (status Novos Leads,
  source `radar`, nome do sócio JORGE EDUARDO BEIRA, empresa, CNPJ, telefone,
  cidade, UF, tags radar/pgfn, descrição com valor e inscrições) e marcou
  `radar_empresas.status = 'enviado_kanban'` com `prospect_id` vinculado.
  O botão virou "Já no Kanban" (desabilitado) e "Abrir no Kanban" levou ao
  Kanban com o card HIGIDENT em Novos Leads.

## 6. Build e Lighthouse

- `npm run build`: sem warning novo. O único aviso ("Some chunks are larger
  than 500 kB") é o mesmo da `main`.
- `tsc --noEmit`: nenhum erro novo no frontend. Os 4 erros a mais em relação à
  `main` são `Cannot find name 'Deno'` e o import `esm.sh` na function nova,
  o mesmo que as outras 31 functions do repo produzem.
- Lighthouse (acessibilidade, user flow com puppeteer e a sessão do perfil do
  Playwright MCP): **Radar lista 96**, **Radar com drawer aberto 97**. Os 4
  apontamentos de contraste restantes são do shell do hub (texto do build no
  rodapé do sidebar e itens do header), fora do Radar; o badge de score, que
  também era apontado, foi corrigido (fundo branco, 4,87:1).

## 7. RLS

```
select relname, relrowsecurity from pg_class where relname like 'radar_%';
radar_empresas    true
radar_ingestoes   true
radar_inscricoes  true
```

## Observação

Os dados do fixture (competência 202506, 756 empresas, 2.030 inscrições) e o
lead de teste da Higident ficaram no projeto real. Para limpar antes da
primeira ingestão de verdade:

```sql
delete from radar_inscricoes; delete from radar_empresas; delete from radar_ingestoes;
delete from prospects where source = 'radar' and cnpj = '51.609.238/0001-50';
```
