# RADAR · Fase 2 · Dossiê judicial via PJe TRF3

Continuação do módulo Radar (ver docs/radar/README.md, DECISOES.md e ACEITE-FASE1.md). Objetivo: para cada empresa do Radar com garantia, localizar as execuções fiscais e embargos no PJe do TRF3, gravar vara, advogados e movimentações recentes, e mostrar isso no drawer da empresa. Tudo em ritmo humano, porque o PJe está atrás do Akamai.

Fase 3 (monitoramento via Datajud) NÃO faz parte deste trabalho.

## Regras de execução

1. Não faça perguntas. Ambiguidade não coberta: decida do jeito mais simples, registre em docs/radar/DECISOES.md e siga.
2. Siga o CLAUDE.md (tokens de cor, tipografia, activeView, numeração de migração continuando em supabase/).
3. Branch radar-fase2. Um commit por etapa (E1 a E6), mensagem em português começando por "radar:".
4. Nenhuma API paga. Fonte única desta fase: consulta pública do PJe TRF3 1º grau.
5. RLS ligado nas tabelas novas, política para authenticated. O worker usa a service role do .env.
6. O worker é Playwright rodando no Mac. Use a mesma instalação e linguagem do scraper do PNCP que já existe no repo. Se o PNCP for Node, o worker é Node; se for Python, é Python. Não instale um segundo runtime de Playwright.
7. O worker NUNCA usa fetch/XHR direto contra o PJe. Toda navegação é pelo navegador real, clicando, como um humano. Isso foi testado: fetch direto e navegação direta para a URL de detalhe geraram bloqueio do Akamai.
8. Ao terminar, rode os critérios de aceite (E6) e cole o resultado no PR.

## Fatos verificados sobre o PJe TRF3 (não redescobrir, usar)

URL da consulta: https://pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam

Sem captcha, sem login. Formulário com os campos: Processo, Nome da Parte (input texto, id contém "nomeParte" ou label "Nome da parte"), Nome do advogado, Classe judicial (input com autocomplete; ao digitar "EXECUÇÃO FISCAL" aparece a lista "1116 EXECUÇÃO FISCAL", "1118 EMBARGOS À EXECUÇÃO FISCAL"; é preciso clicar na opção, digitar não basta), CPF/CNPJ (radio + input), Data de Autuação De/Até (máscara dd/mm/aaaa; preencher via form input funcionou, digitar tecla a tecla não), botão PESQUISAR.

Resultado: tabela com uma linha por processo. Cada linha tem classe (ex.: "EXECUÇÃO FISCAL"), número no formato "ExFis 5002050-64.2023.4.03.6182 - PIS", partes "UNIAO FEDERAL - FAZENDA NACIONAL X <EMPRESA>" e última movimentação com data. Teto de 30 resultados; acima disso aparece o aviso "Sua consulta retornou muitos processos e somente os 30 primeiros serão exibidos". Ordenação: mais antigos primeiro.

O link "Ver Detalhes" de cada linha tem onclick openPopUp('Consulta pública','/pje/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=<token>'). O detalhe abre em POPUP. O worker deve clicar no link e capturar a nova página com page.waitForEvent('popup') (ou context.on('page')). Não navegar direto para a URL do detalhe.

Página de detalhe contém, em texto: "Número Processo", "Data da Distribuição", "Classe Judicial" (ex.: "EXECUÇÃO FISCAL (1116)"), "Assunto", "Jurisdição", "Órgão Julgador" (ex.: "2ª Vara de Execuções Fiscais Federal de São Paulo"), "Polo ativo", "Polo Passivo". No polo passivo cada participante vem numa linha como:
- "CONVENCAO SAO PAULO INDUSTRIA DE BEBIDAS E CONEXOS LTDA - CNPJ: 56.1XX.XXX/XXXX-XX (EXECUTADO)"
- "FREDERICO SANTIAGO LOUREIRO DE OLIVEIRA - OAB SP182592 - CPF: 281.XXX.XXX-XX (ADVOGADO)"
Depois "Movimentações do Processo": lista de "dd/mm/aaaa hh:mm:ss - <texto>", 15 por página, com paginador (campo de número de página). Gravar só a primeira página (as 15 mais recentes). Depois "Documentos juntados ao processo" (ignorar).

O CNPJ vem mascarado, mas os 3 primeiros dígitos aparecem. Usar para conferir homônimos: os 3 primeiros dígitos do CNPJ da empresa no Radar devem bater com os 3 primeiros do participante EXECUTADO/EMBARGANTE. Se não bater, descartar o processo.

Akamai: após cerca de 10 requisições em sequência rápida (menos de 2 s entre elas), o site respondeu "Access Denied" (título da página "Access Denied", corpo com "errors.edgesuite.net"). Bloqueio por IP, temporário. Regras de ritmo abaixo existem por causa disso.

Gabarito para teste (empresa CONVENCAO SAO PAULO INDUSTRIA DE BEBIDAS E CONEXOS LTDA, CNPJ começa com 56.1, busca por nome com autuação a partir de 01/01/2021, sem filtro de classe): 20 processos, sendo 13 EXECUÇÃO FISCAL e 7 EMBARGOS À EXECUÇÃO FISCAL. Um deles: ExFis 5002050-64.2023.4.03.6182, distribuído em 07/06/2023, 2ª Vara de Execuções Fiscais Federal de São Paulo, assunto Cofins e PIS, três advogados no polo passivo (OAB SP182592, SP384275, SP490636), 44 movimentações.

## E1 · Migração <n>_radar_fase2_pje.sql

create table radar_pje_fila (
  id bigserial primary key,
  cnpj text not null references radar_empresas(cnpj),
  prioridade int not null default 0,
  status text not null default 'pendente',
  tentativas int not null default 0,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  erro text,
  unique (cnpj)
);
create index on radar_pje_fila (status, prioridade desc, criado_em);

Comentários: prioridade maior primeiro, botão manual usa 100. status aceita pendente | processando | concluido | sem_processos | erro | bloqueado.

create table radar_processos (
  id bigserial primary key,
  cnpj text not null references radar_empresas(cnpj),
  numero_cnj text not null unique,
  classe_codigo int,
  classe_nome text,
  assunto text,
  jurisdicao text,
  orgao_julgador text,
  data_distribuicao date,
  polo_passivo_nome text,
  cnpj_mascarado text,
  ultima_movimentacao_texto text,
  ultima_movimentacao_em timestamptz,
  qtd_movimentacoes int,
  fonte text not null default 'pje_trf3',
  capturado_em timestamptz not null default now()
);
create index on radar_processos (cnpj);

Comentários: numero_cnj com 25 caracteres e pontuação, ex 5002050-64.2023.4.03.6182. classe_codigo é 1116 ou 1118.

create table radar_processo_movimentos (
  id bigserial primary key,
  processo_id bigint not null references radar_processos(id) on delete cascade,
  ocorrido_em timestamptz not null,
  texto text not null,
  unique (processo_id, ocorrido_em, texto)
);

create table radar_processo_advogados (
  id bigserial primary key,
  processo_id bigint not null references radar_processos(id) on delete cascade,
  nome text not null,
  oab text,
  polo text,
  unique (processo_id, nome, oab)
);

Comentários: oab no formato SP182592. polo é passivo ou ativo.

alter table radar_empresas
  add column dossie_status text not null default 'nenhum',
  add column dossie_em timestamptz,
  add column qtd_execucoes int not null default 0,
  add column qtd_embargos int not null default 0,
  add column garantia_informada text,
  add column garantia_obs text,
  add column garantia_informada_em timestamptz;

Comentários: dossie_status aceita nenhum | fila | pronto | sem_processos | erro. garantia_informada aceita seguro | penhora | deposito | fianca | nenhuma | nao_sei.

View vw_radar_advogados: advogado (nome, oab) com contagem de processos distintos e de empresas distintas em que aparece no polo passivo, ordenada por empresas desc. É a lista de escritórios que mais defendem executados fiscais, que é canal de parceria.

Função radar_enfileirar_dossies(): insere em radar_pje_fila (on conflict do nothing) toda empresa com status = 'novo', tem_garantia = true e dossie_status = 'nenhum', com prioridade = score; atualiza dossie_status = 'fila'. Rodar uma vez ao final da migração. Agendar no pg_cron como radar-fila-daily às 6h de Brasília (09:00 UTC), mesmo padrão dos crons existentes.

Função radar_consolidar_dossie(p_cnpj text): recalcula qtd_execucoes (classe 1116) e qtd_embargos (1118) a partir de radar_processos, define dossie_status = 'pronto' se houver processo, 'sem_processos' se não, e dossie_em = now().

Score: acrescentar na radar_calcular_score: qtd_embargos >= 1: +10 (garantia do juízo confirmada em processo). Teto 100 mantido.

## E2 · Worker scripts/radar/pje_worker.(ts|py)

Um processo de longa duração. Lê .env da raiz (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Configuração no topo do arquivo, com estes valores:

- JANELA: só trabalha entre 07:00 e 23:00 horário local. Fora disso dorme.
- INTERVALO_ENTRE_EMPRESAS: 5 minutos, com jitter de mais ou menos 60 s.
- INTERVALO_ENTRE_REQUISICOES: 20 s, com jitter de mais ou menos 8 s. Vale entre pesquisa, abertura de cada detalhe e paginação.
- MAX_DETALHES_POR_EMPRESA: 8 (os 8 processos mais recentes por data de autuação; os demais ficam gravados só com os dados da linha da listagem: número, classe, última movimentação).
- TETO_DIARIO: 60 empresas por dia.
- BLOQUEIO: se qualquer página tiver título "Access Denied" ou contiver "edgesuite.net", marcar a empresa como bloqueado, gravar o horário, dormir 60 minutos e tentar a mesma empresa de novo. No terceiro bloqueio do dia, parar até a próxima janela. Nunca contar bloqueio como tentativa falha da empresa.
- CONTEXTO: perfil persistente do navegador em data/radar/pje-profile (cookies mantidos entre execuções), Chrome real (channel chrome), headless false por padrão com flag --headless para rodar sem janela, viewport 1366x800, locale pt-BR, timezone America/Sao_Paulo.

Fluxo por empresa (pega a próxima da fila: status pendente, ordem prioridade desc, criado_em asc; marca processando):

1. Nome de busca: razao_social da BrasilAPI se existir, senão nome_devedor. Remover pontuação e sufixos LTDA, S.A., S/A, EIRELI, ME, EPP no fim para a busca ficar mais tolerante. Se o nome tiver menos de 2 palavras, usar como está.
2. Abrir a consulta pública. Preencher Nome da Parte. Preencher Data de Autuação De = 01/01/2021 (via preenchimento de valor do input, não tecla a tecla). NÃO filtrar por classe na pesquisa (o autocomplete é frágil); filtrar as classes pelo texto da linha depois.
3. Pesquisar. Se aparecer o aviso de mais de 30 resultados, repetir a pesquisa uma vez por ano (De 01/01/AAAA, Até 31/12/AAAA) de 2021 até o ano atual, respeitando o intervalo entre requisições.
4. Da listagem, manter só linhas cuja classe seja EXECUÇÃO FISCAL ou EMBARGOS À EXECUÇÃO FISCAL. Extrair número CNJ, classe, assunto (texto após o número), partes, última movimentação e data. Gravar/atualizar em radar_processos (upsert por numero_cnj).
5. Para até MAX_DETALHES_POR_EMPRESA processos, os mais recentes: clicar em Ver Detalhes, capturar o popup, extrair os campos da seção "Fatos verificados", gravar advogados e as 15 movimentações da primeira página, fechar o popup. Conferir os 3 primeiros dígitos do CNPJ mascarado; se não bater, apagar o processo gravado e registrar em log como homônimo.
6. Se a listagem não tiver nenhuma linha das duas classes (ou nenhuma linha), status sem_processos.
7. Chamar radar_consolidar_dossie(cnpj). Marcar a fila como concluido (ou sem_processos). Erro inesperado: tentativas + 1, status erro se tentativas >= 3, senão volta para pendente.
8. Log em data/radar/pje_worker.log: uma linha por empresa (cnpj, nome, processos encontrados, detalhes abertos, tempo) e uma linha por bloqueio.

Modo de teste: flag --cnpj <cnpj> processa só aquela empresa, ignorando fila e teto, mas respeitando os intervalos.

## E3 · launchd

Arquivo scripts/radar/com.fg.radar-pje.plist e script scripts/radar/install_launchd.sh que copia para ~/Library/LaunchAgents e carrega. KeepAlive true, RunAtLoad true, StandardOutPath e StandardErrorPath em data/radar/. Documentar no README como instalar, parar (launchctl unload) e ver o log. Não instalar automaticamente durante a execução da spec; só criar os arquivos e testar o worker com --cnpj.

## E4 · Tela

No drawer da empresa no Radar, nova seção "Processos no TRF3", abaixo dos dados cadastrais:

- Cabeçalho com dossie_status em badge (nenhum: cinza; fila: blue; pronto: emerald; sem_processos: cinza; erro: amber) e dossie_em formatado. Botão "Buscar processos" (insere na fila com prioridade 100; se já estiver em fila, desabilitado; se pronto há mais de 30 dias, vira "Atualizar").
- Lista de processos: badge da classe (Execução Fiscal ou Embargos), número CNJ com botão copiar, órgão julgador, data de distribuição, assunto, última movimentação com data. Clicar expande as 15 movimentações.
- Bloco "Advogados do executado": nomes e OAB deduplicados entre os processos da empresa, com botão copiar e contagem de processos em que aparecem.
- Bloco "Garantia informada": select (Seguro garantia, Penhora, Depósito judicial, Fiança bancária, Nenhuma, Não sei) e campo de observação curto; salvar grava garantia_informada, garantia_obs e garantia_informada_em. Texto de apoio: "Preencha depois de conversar com o advogado ou a empresa."
- Leitura automática em uma frase, calculada no front: se qtd_embargos > 0: "Há embargos: a empresa já garantiu o juízo em pelo menos um processo. Perguntar ao advogado qual garantia e quando vence."; se qtd_execucoes > 0 e qtd_embargos = 0: "Execução em curso sem embargos localizados: risco de penhora ou bloqueio. Oferecer seguro garantia para garantir o juízo."; se sem_processos: "Nenhuma execução fiscal federal localizada desde 2021 no TRF3."

Na tabela do Radar: coluna "Dossiê" com ícone por status e filtro "Dossiê" (todos, pronto, com embargos, fila, sem processos). Ordenação secundária: dossiê pronto antes de nenhum quando o score empata.

Enviar ao Kanban: a observação do prospect passa a incluir, quando houver, "Advogados: <nome> (OAB), <nome> (OAB)" e "Execuções fiscais: N, Embargos: M".

Nova view radar_advogados (submenu ou aba dentro do Radar): tabela de vw_radar_advogados com nome, OAB, empresas, processos, e botão copiar. Sem mais que isso nesta fase.

## E5 · Documentação

README do Radar: seção Fase 2 com o fluxo, os fatos verificados sobre o PJe, os limites de ritmo e o porquê (Akamai), como instalar e parar o worker, e o que fazer se o bloqueio virar frequente (mover o worker para outra máquina: copiar a pasta, .env e perfil do navegador). DECISOES.md com as decisões novas. Atualizar CLAUDE.md na seção do Radar.

## E6 · Critérios de aceite

1. Migração aplica no projeto real. radar_enfileirar_dossies() enfileira exatamente as empresas com status novo, tem_garantia true e dossie_status nenhum (informar a contagem; esperado em torno de 800).
2. Worker com --cnpj da CONVENCAO SAO PAULO INDUSTRIA DE BEBIDAS E CONEXOS LTDA (buscar o CNPJ em radar_empresas pelo nome) termina sem bloqueio, respeitando os intervalos, e grava: 20 processos com autuação desde 2021, 13 de classe 1116 e 7 de classe 1118; o processo 5002050-64.2023.4.03.6182 com órgão julgador "2ª Vara de Execuções Fiscais Federal de São Paulo", data de distribuição 07/06/2023, 3 advogados com OAB SP182592, SP384275 e SP490636, e 15 movimentações gravadas. Se o PJe estiver bloqueado no momento do teste, esperar 60 minutos e repetir, não pular o critério.
3. Rodar --cnpj para uma segunda empresa do topo do ranking (Larru's) e informar o resultado, sem gabarito.
4. dossie_status, qtd_execucoes, qtd_embargos e score recalculado corretos para as duas empresas.
5. Drawer mostra a seção com processos, advogados, leitura automática e o select de garantia; salvar a garantia persiste. Botão "Buscar processos" enfileira com prioridade 100. Filtro "Dossiê" funciona. vw_radar_advogados lista os advogados da Convenção.
6. npm run build sem warnings novos. RLS ativo nas 4 tabelas novas.
7. Arquivos do launchd criados e o install_launchd.sh testado em modo dry (imprime o que faria) sem instalar.

Fim da Fase 2. Não iniciar Fase 3.
