# RADAR · Fase 1 · Ingestão PGFN + Enriquecimento de CNPJ

Módulo novo do F&G HUB (repo `~/Documents/fg-corretora-hub`). Objetivo da Fase 1: transformar a base pública de devedores da PGFN em uma lista filtrada e enriquecida de empresas industriais com dívida federal ajuizada, visível numa tela do HUB e com um clique para virar card no Kanban.

Fases 2 (descoberta do processo via PJe) e 3 (monitoramento Datajud) NÃO fazem parte deste trabalho. Não criar nada para elas.

## Regras de execução (leia antes de começar)

1. Não faça perguntas. Toda ambiguidade já foi decidida abaixo. Se encontrar algo não coberto, decida do jeito mais simples, registre a decisão em `docs/radar/DECISOES.md` e siga.
2. Siga o `CLAUDE.md` do repo: tokens de cor (gold é identidade, amber alerta, rose erro, emerald sucesso, blue informação), tipografia, roteamento por `activeView` no `App.tsx`, numeração de migração continuando a sequência existente em `supabase/migrations/`.
3. Branch `radar-fase1`. Um commit por etapa (E1 a E6 abaixo), mensagem em português começando por `radar:`.
4. Nenhuma API paga. Só Dados Abertos PGFN e BrasilAPI.
5. RLS ligado em todas as tabelas novas, política de leitura e escrita para `authenticated`. Edge Functions usam a service role.
6. Antes de escrever qualquer código que toque em `prospects` ou no Kanban, leia o schema real da tabela `prospects` (via migrações existentes ou `supabase db dump`) e reutilize as colunas que existem. Não crie coluna nova em `prospects`.
7. Não instalar dependência nova no frontend. Backend Python pode usar `pandas`, `requests`, `python-dotenv`.
8. Ao terminar, rode os critérios de aceite da seção final e cole o resultado no PR.

## Fonte de dados

Dados Abertos da PGFN, conjunto "Devedores inscritos em Dívida Ativa da União", atualização trimestral. O usuário baixa o ZIP manualmente e coloca os CSVs em `data/pgfn/<AAAAMM>/` (pasta ignorada pelo git, adicionar ao `.gitignore`).

Formato conhecido: CSV com separador `;`, encoding `latin-1`, um arquivo por UF ou arquivos particionados. Colunas esperadas (o script deve mapear por nome, sem diferenciar maiúsculas, acentos ou espaços extras, e falhar com mensagem clara se alguma faltar):

CPF_CNPJ, TIPO_PESSOA, TIPO_DEVEDOR, NOME_DEVEDOR, UF_UNIDADE_RESPONSAVEL, UNIDADE_RESPONSAVEL, NUMERO_INSCRICAO, TIPO_SITUACAO_INSCRICAO, SITUACAO_INSCRICAO, RECEITA_PRINCIPAL, DATA_INSCRICAO, INDICADOR_AJUIZADO, VALOR_CONSOLIDADO

`CPF_CNPJ` vem mascarado para pessoa física e completo para pessoa jurídica. Pessoa física é descartada.

## E1 · Migração: tabelas do Radar

Arquivo `supabase/migrations/<n>_radar_fase1.sql`.

create table radar_ingestoes (
  id bigserial primary key,
  competencia text not null,
  arquivo text not null,
  linhas_lidas int not null default 0,
  linhas_aceitas int not null default 0,
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  erro text
);

create table radar_inscricoes (
  id bigserial primary key,
  ingestao_id bigint references radar_ingestoes(id),
  competencia text not null,
  cnpj text not null,
  nome_devedor text not null,
  uf text,
  unidade_responsavel text,
  numero_inscricao text not null,
  tipo_situacao text,
  situacao text,
  receita_principal text,
  data_inscricao date,
  ajuizado boolean not null default false,
  valor_consolidado numeric(16,2) not null default 0,
  unique (competencia, numero_inscricao)
);
create index on radar_inscricoes (cnpj);
create index on radar_inscricoes (competencia);

create table radar_empresas (
  cnpj text primary key,
  nome_devedor text not null,
  uf text,
  competencia_ultima text not null,
  qtd_inscricoes int not null default 0,
  valor_total numeric(16,2) not null default 0,
  data_inscricao_mais_recente date,
  tem_garantia boolean not null default false,
  receitas text[] not null default '{}',
  score int not null default 0,
  enriquecido_em timestamptz,
  enriquecimento_erro text,
  razao_social text,
  nome_fantasia text,
  cnae_principal text,
  cnae_descricao text,
  porte text,
  optante_simples boolean,
  optante_mei boolean,
  situacao_cadastral text,
  municipio text,
  email text,
  telefone text,
  socios jsonb,
  status text not null default 'novo',
  motivo_exclusao text,
  prospect_id uuid,
  atualizado_em timestamptz not null default now()
);
create index on radar_empresas (status);
create index on radar_empresas (score desc);

Comentários: `cnpj` sempre 14 dígitos sem máscara. `tem_garantia` = alguma inscrição com tipo_situacao contendo GARANTIA. `status` aceita novo | excluido | enviado_kanban | descartado. `prospect_id` é FK lógica para `prospects`; se o PK de `prospects` não for uuid, ajustar o tipo para bater.

View `vw_radar_empresas`: tudo de `radar_empresas` com `status <> 'excluido'`, ordenado por `score desc, valor_total desc`.

## E2 · Script de ingestão scripts/radar/pgfn_ingest.py

Roda local, no Mac. Uso:

python scripts/radar/pgfn_ingest.py --competencia 202506 --uf SP

`--uf` opcional; sem ele processa todos os arquivos da pasta. Lê `.env` na raiz com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (adicionar ao `.env.example`).

Pipeline por arquivo, em chunks de 200 mil linhas com pandas:

1. Registrar linha em `radar_ingestoes`.
2. Descartar `TIPO_PESSOA` diferente de pessoa jurídica.
3. Normalizar `cnpj` (só dígitos, 14 caracteres) e `valor_consolidado` (vírgula decimal para ponto).
4. Filtro de receita: manter só linhas cuja `RECEITA_PRINCIPAL` em maiúsculas contenha PIS, COFINS ou IPI. Descartar qualquer linha que contenha SIMPLES.
5. Filtro de ajuizamento: manter só `INDICADOR_AJUIZADO` = SIM.
6. Filtro de data: manter só `DATA_INSCRICAO >= 2021-01-01`.
7. Filtro de nome: descartar `NOME_DEVEDOR` que contenha BANCO, FINANCEIRA, CREDITO, CRÉDITO, CONSORCIO, CONSÓRCIO, SEGURADORA, SEGUROS, CAPITALIZACAO, MASSA FALIDA, FALIDA, PREFEITURA, MUNICIPIO, MUNICÍPIO, ESTADO DE, FUNDACAO, FUNDAÇÃO, ASSOCIACAO, ASSOCIAÇÃO, IGREJA, SINDICATO.
8. Upsert em `radar_inscricoes` por `(competencia, numero_inscricao)`, em lotes de 1000 via REST do Supabase (`on_conflict`).
9. Atualizar `radar_ingestoes` com contagens e `finalizado_em`.

Ao final de todos os arquivos, chamar a função SQL `radar_consolidar_empresas(p_competencia text)` (criar na migração E1):

- Agrega `radar_inscricoes` da competência por `cnpj`: `qtd_inscricoes`, `valor_total`, `data_inscricao_mais_recente`, `tem_garantia` (existe linha com `tipo_situacao` contendo GARANTIA), `receitas` (distinct de `receita_principal`), `nome_devedor` e `uf` da linha de maior valor.
- Upsert em `radar_empresas`. Não sobrescrever campos de enriquecimento nem `status`, `prospect_id`, `motivo_exclusao` se já existirem.
- Recalcular `score` com a fórmula da seção Score.

Log em stdout: arquivo, linhas lidas, aceitas por filtro, tempo. Falha em um arquivo não interrompe os demais; erro fica em `radar_ingestoes.erro`.

## E3 · Edge Function radar-enrich-cnpj

Endpoint público https://brasilapi.com.br/api/cnpj/v1/{cnpj}. Sem chave.

Comportamento por execução:

- Seleciona até 60 empresas com `enriquecido_em is null` e `status = 'novo'`, ordem `score desc`.
- Uma requisição por vez, pausa de 1200 ms entre elas. Timeout de 10 s.
- Sucesso: preenche `razao_social`, `nome_fantasia`, `cnae_principal` (`cnae_fiscal` como texto), `cnae_descricao`, `porte`, `optante_simples` (`opcao_pelo_simples`), `optante_mei` (`opcao_pelo_mei`), `situacao_cadastral` (`descricao_situacao_cadastral`), `municipio`, `email`, `telefone` (montar de `ddd_telefone_1`), `socios` (array de {nome, qualificacao} a partir de `qsa`). Grava `enriquecido_em = now()`.
- Após preencher, aplica exclusões pós-enriquecimento, mudando `status` para `excluido` e preenchendo `motivo_exclusao`:
  - `optante_simples = true` ou `optante_mei = true`: motivo `simples_nacional`
  - `cnae_principal` começando com 64 ou 65: motivo `financeiro`
  - `situacao_cadastral` diferente de ATIVA: motivo `cadastro_inativo`
- Erro HTTP 404: grava `enriquecimento_erro = 'nao_encontrado'`, `enriquecido_em = now()`, status `excluido`, motivo `cnpj_nao_encontrado`.
- Erro 429 ou 5xx: não grava `enriquecido_em`, grava `enriquecimento_erro` com o código e encerra a execução (a próxima rodada tenta de novo).
- Recalcula `score` das linhas tocadas.

Cron no pg_cron: `radar-enrich-hourly`, a cada hora entre 8h e 22h horário de Brasília (11:00 a 01:00 UTC), mesmo padrão de chamada de Edge Function já usado nos crons `posvenda-toques-daily` e `cadencia-emails-daily`. Incluir o `cron.schedule` na migração E1 com comentário explicando o fuso.

## Score

Função SQL `radar_calcular_score(cnpj text)`, inteiro de 0 a 100:

- `tem_garantia = true`: +35
- `valor_total >= 5.000.000`: +25
- `valor_total` entre 1.000.000 e 4.999.999: +18
- `valor_total` entre 300.000 e 999.999: +10
- `qtd_inscricoes >= 3`: +10
- `data_inscricao_mais_recente >= hoje menos 24 meses`: +10
- `porte` = DEMAIS ou MEDIA (empresa acima de EPP): +10
- `email` preenchido: +5
- `telefone` preenchido: +5

Teto 100. Empresas com `status = 'excluido'` ficam com score 0.

## E4 · Tela Radar no HUB

- Nova `activeView = 'radar'`, item "Radar" no sidebar, logo abaixo de "Prospecção" (ou do item de prospecção que já exista). Ícone de radar do conjunto de ícones já usado no projeto.
- Componente `src/views/Radar/RadarView.tsx` mais subcomponentes na mesma pasta. Sem react-router.
- Layout: barra de filtros no topo, tabela abaixo, drawer lateral de detalhe ao clicar na linha.
- Filtros: busca por nome ou CNPJ, UF (select), faixa de valor (mín e máx), `tem_garantia` (toggle), `status` (novo, enviado_kanban, descartado; excluído fica fora por padrão com opção "mostrar excluídos"), receita (PIS, COFINS, IPI, multi).
- Colunas: Score (badge, gold só no número, sem cor de estado), Razão social ou nome devedor, CNPJ formatado, UF, Município, Qtd inscrições, Valor total (R$ formatado), Garantia (sim/não), Data mais recente, Porte, Status.
- Ordenação padrão `score desc`. Paginação de 50 por página, server side via range do Supabase.
- Drawer de detalhe: dados cadastrais, CNAE, sócios, e-mail e telefone com botão copiar, lista das inscrições da empresa (número, receita, situação, data, valor), e três botões:
  - Enviar ao Kanban: insere em `prospects` na coluna "Novos Leads" (mesmo mecanismo da Edge Function `lead-cotacao`), preenchendo os campos que existirem em `prospects` (nome, cnpj, email, telefone, origem = radar, observação com valor total e qtd de inscrições). Atualiza `radar_empresas.status = 'enviado_kanban'` e `prospect_id`. Se já estiver enviado, botão desabilitado com link para o card.
  - Descartar: `status = 'descartado'`, pede motivo em texto curto (grava em `motivo_exclusao`).
  - Reverter: volta para `novo`.
- Cabeçalho da tela mostra: competência mais recente carregada, total de empresas por status, e quantas ainda sem enriquecimento. Se não houver ingestão nenhuma, estado vazio com instrução: python scripts/radar/pgfn_ingest.py --competencia AAAAMM --uf SP
- Cores conforme mapa semântico do CLAUDE.md. Nenhum vermelho. Excluído em cinza, enviado_kanban em emerald, descartado em amber.

## E5 · Documentação

- `docs/radar/README.md`: o que é o módulo, como baixar o ZIP da PGFN, onde colocar, como rodar o script, como funciona o enriquecimento e o score, roadmap das Fases 2 e 3 (duas linhas cada, sem detalhar).
- `docs/radar/DECISOES.md`: lista de decisões tomadas durante a implementação que não estavam neste documento.
- Atualizar o `CLAUDE.md` com uma seção curta "Módulo Radar" apontando para o README.

## E6 · Critérios de aceite (rodar e colar resultado no PR)

1. Migração aplica sem erro num banco limpo e no projeto real (hfjvwibucplyhsvnwfor).
2. `pgfn_ingest.py` com um CSV de teste de 5 mil linhas (criar `tests/fixtures/pgfn_sample.csv` com cabeçalho real e linhas sintéticas cobrindo cada filtro) termina em menos de 30 s e o log mostra a contagem de descartes por filtro.
3. Após ingestão do fixture, `select count(*) from radar_empresas` é maior que zero e nenhuma linha tem `receitas` sem PIS, COFINS ou IPI.
4. `radar-enrich-cnpj` chamada manualmente enriquece pelo menos 3 CNPJs reais do fixture (usar CNPJs públicos de grandes indústrias) e marca `excluido` corretamente para um CNPJ do Simples e para um banco.
5. Tela Radar carrega em produção, filtros funcionam, "Enviar ao Kanban" cria o card na coluna "Novos Leads" e o botão fica desabilitado depois.
6. `npm run build` sem warnings novos. Lighthouse de acessibilidade da tela acima de 90.
7. RLS ativo nas três tabelas novas (`select relname, relrowsecurity from pg_class where relname like 'radar_%'`).

Fim da Fase 1. Não iniciar Fase 2.
