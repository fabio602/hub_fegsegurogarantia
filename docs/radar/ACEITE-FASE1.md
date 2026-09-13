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

## 8. Fechamento: base real 06/2026 (12 e 13/09/2026)

Os critérios acima foram rodados com o fixture. Depois do merge, o fixture e
o lead de teste da Higident foram apagados do projeto real e a base real da
PGFN foi carregada e enriquecida por completo.

**Ingestão** (`radar_ingestoes` id 2, `arquivo_lai_SIDA_SP_202606.csv`,
12/09/2026 17:03 a 17:09 de Brasília, sem erro):

| Item | Resultado |
| --- | --- |
| Linhas lidas (SP, todas as inscrições e corresponsáveis) | 13.071.122 |
| Inscrições aceitas | 219.132 |
| Empresas consolidadas | 30.986 |
| Tempo | 6 min |

**Enriquecimento** pelo `scripts/radar/enrich_local.py` (BrasilAPI, pausa de
1.200 ms, log em `data/pgfn/enrich_202606.log`), de 12/09 17:19 a 13/09 07:52,
873 min a 0,58 CNPJ/s, 9 esperas de rate limit, nenhum 404, 3 erros de
gravação (um 504 e dois reset de conexão) regravados no retry. O cron
`radar-enrich-hourly` continuou ativo em paralelo e segue ativo, sem fila.
Migrações 077 (score v2) e 078 (recuperação judicial) aplicadas durante a
rodada; o UPDATE final da 078 foi rodado de novo após o término e pegou mais
8 empresas pela razão social. Nova execução em 13/09 às 09h não encontrou
nenhuma pendente.

| Item | Qtd |
| --- | --- |
| Total de empresas | 30.986 |
| Enriquecidas (`enriquecido_em` preenchido) | 30.475 |
| Sem `enriquecido_em` | 511 |
| Com `enriquecimento_erro` | 0 |
| Mantidas como `novo` | 23.436 |
| Excluídas (total) | 7.550 |
| Excluídas: cadastro inativo | 6.377 |
| Excluídas: recuperação judicial | 578 |
| Excluídas: Simples Nacional / MEI | 300 |
| Excluídas: CNAE financeiro | 295 |
| Enviadas ao Kanban | 0 |

As 511 sem `enriquecido_em` são as empresas excluídas por recuperação judicial
já no nome da PGFN, que o script pula de propósito. Não há pendência de fila.

**Score v2 entre as `novo`:** 56 com 90 ou mais, 932 entre 70 e 89, 4.381
entre 50 e 69 e 18.067 abaixo de 50; 708 têm garantia. As 20 primeiras por
score (desempate por valor), todas com garantia e todas com CNAE industrial
exceto uma de TV aberta, uma de apoio administrativo e uma de atacado de
máquinas:

| Score | Nome | Município | Valor total | Insc. | Em cobrança | CNAE |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | Convenção São Paulo Ind. de Bebidas | Caieiras | R$ 39,56 mi | 26 | 12 | 1122-4 Refrigerantes |
| 100 | Larru's Ind. e Com. de Cosméticos | Jandira | R$ 27,83 mi | 17 | 7 | 2063-1 Cosméticos |
| 100 | Sorvetes Skimil & Skimoni | Americana | R$ 13,03 mi | 32 | 31 | 1053-8 Sorvetes |
| 100 | Protege Ind. e Com. Materiais Contra Incêndio | São Paulo | R$ 7,74 mi | 25 | 24 | 2829-1 Máquinas e equipamentos |
| 100 | Companhia Metalúrgica Estampex | São Paulo | R$ 5,56 mi | 26 | 24 | 2610-8 Componentes eletrônicos |
| 100 | Emifran Ind. Artefatos Plásticos e Metalúrgicos | São Paulo | R$ 3,07 mi | 22 | 20 | 2229-3 Artefatos plásticos |
| 100 | IBTEC Serv. e Com. de Construção Civil | Cotia | R$ 1,65 mi | 12 | 4 | 2330-3 Pré-moldados de concreto |
| 100 | Steel Anéis e Forjados Especiais | Mairiporã | R$ 1,57 mi | 11 | 8 | 2531-4 Forjados de aço |
| 100 | Florend Ind. e Com. de Chocolates | Cajamar | R$ 1,31 mi | 6 | 5 | 1093-7 Derivados do cacau |
| 95 | Rádio e Televisão Bandeirantes S.A. | São Paulo | R$ 17,66 mi | 4 | 2 | 6021-7 TV aberta |
| 95 | Atomplast Ind. e Com. de Plásticos | Indaiatuba | R$ 16,42 mi | 24 | 11 | 2229-3 Artefatos plásticos |
| 95 | Burocenter Ind. e Com. de Móveis | Barueri | R$ 10,43 mi | 23 | 21 | 3101-2 Móveis de madeira |
| 95 | Ferrusi Ind. e Com. de Peças | Sertãozinho | R$ 9,85 mi | 25 | 24 | 2451-2 Fundição de ferro e aço |
| 95 | Hangar Moriah Comércio Geral | São Paulo | R$ 7,07 mi | 10 | 9 | 8211-3 Apoio administrativo |
| 95 | JLG Latino Americana | Indaiatuba | R$ 6,00 mi | 32 | 29 | 4663-0 Atacado de máquinas |
| 95 | Sensym Ind. Com. e Serv. Eletrônicos | Campinas | R$ 2,98 mi | 31 | 29 | 2790-2 Equipamentos elétricos |
| 95 | Tresuno Serv. e Com. Materiais Cimentícios | Itupeva | R$ 1,76 mi | 20 | 18 | 2330-3 Artefatos de cimento |
| 95 | Total Cabos | São Paulo | R$ 1,57 mi | 32 | 31 | 2733-3 Fios e cabos elétricos |
| 95 | Thermototal Ind. e Com. | Capivari | R$ 1,27 mi | 18 | 15 | 3099-7 Equip. de transporte |
| 92 | MD Papéis | São Paulo | R$ 140,52 mi | 20 | 13 | 1721-4 Fabricação de papel |

## Observação

O fixture (competência 202506) e o lead de teste da Higident foram apagados
do projeto real em 12/09/2026, antes da ingestão da base real (seção 8). O
que aparece no Radar em produção hoje é a base 06/2026 de SP. Para uma nova
competência, seguir o README (ingestão, depois `enrich_local.py`).
