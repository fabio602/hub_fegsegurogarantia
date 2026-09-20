# Radar: migração do worker do PJe para a API JSON da nova consulta pública (TRF3)

Data: 20/09/2026
Status: executada em 20/09/2026. Três pontos desta spec não sobreviveram ao
contato com a API e foram corrigidos na implementação — leia
[ACEITE-PJE-API.md](ACEITE-PJE-API.md) seção 4 antes de usar este documento
como referência:

- a paginação não pode se guiar pelo `pageInfo.last` (seção 3 e item 9 da
  seção 4); o sinal de truncagem é o aviso em `messages[]`;
- `/poloPassivo` e `/poloAtivo` precisam paginar, senão um processo com muitas
  partes esconde o advogado (seção 3);
- o aceite da Procomp (seção 5) está errado: a empresa tem três execuções
  fiscais, não zero.

## 1. O que quebrou

Desde 14/09/2026 (por volta das 19h56) todas as empresas da fila voltam com
`RuntimeError('radio de CNPJ não encontrado')`. Nenhuma empresa foi concluída
desde então: 44 concluídas, 94 erros, 568 pendentes, 2 presas em `processando`.

Causa: o TRF3 aposentou a consulta pública antiga em JSF/Seam.
`https://pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam` agora redireciona
para `https://pje1g-consultapublica.trf3.jus.br/`, um aplicativo Angular novo.
Os ids que o worker usa (`fPP:dpDec:documentoParte`, `fPP:searchProcessos`,
`input[name="tipoMascaraDocumento"]`) não existem mais. Não é bloqueio do Akamai:
nenhum item da fila foi para `bloqueado` e a página abre normalmente no navegador.

## 2. Decisão

Parar de raspar HTML. O aplicativo novo é um front Angular que consome uma API
REST pública em JSON, sem autenticação e sem captcha. O worker passa a chamar
essa API. Menos requisições, sem cliques, sem parse de texto, sem popup.

O navegador continua sendo aberto (Chrome com perfil persistente, janela fora da
área visível, como hoje) só para obter e renovar os cookies do Akamai. As
chamadas da API são feitas com `context.request.get(...)` do Playwright, que
reusa cookies e cabeçalhos do contexto. Se em teste o `httpx` puro funcionar do
IP do Mac, o navegador pode ser removido depois, em outra branch.

## 3. API mapeada (verificada em 20/09/2026)

Base: `https://pje1g-consultapublica.trf3.jus.br`

Busca por CNPJ:

    GET /v1/processos?page=0&documento=<14 dígitos>&dataAutuacaoInicio=YYYY-MM-DD

Resposta:

    { "status":"ok", "code":"200", "messages":[],
      "result":[ { "idProcesso":"<token>", "numeroProcesso":"5000607-02.2021.4.03.6133",
                   "classe":"EXECUÇÃO FISCAL", "classeSigla":"ExFis",
                   "assunto":"...", "ultimaMovimentacao":"Texto (dd/mm/aaaa hh:mm:ss)",
                   "partes":{"poloAtivo":{"nomeParte":"...","qntOutros":0},
                             "poloPassivo":{"nomeParte":"...","qntOutros":1}} } ],
      "pageInfo":{"count":8,"current":1,"last":1,"size":30} }

Detalhe (usar o `idProcesso` devolvido na mesma resposta da busca; o token muda a
cada resposta, então não guarde nem reaproveite entre execuções):

    GET /v1/processos/<idProcesso>/dados
    GET /v1/processos/<idProcesso>/poloAtivo?page=0
    GET /v1/processos/<idProcesso>/poloPassivo?page=0
    GET /v1/processos/<idProcesso>/outrosInteressados?page=0
    GET /v1/processos/<idProcesso>/movimentacoes?page=0
    GET /v1/processos/<idProcesso>/documentos?page=0

`/dados` devolve em `result`: `numeroProcesso`, `dataDistribuicao` (ISO),
`classeJudicial` ("EXECUÇÃO FISCAL (1116)", com o código entre parênteses),
`assunto`, `jurisdicao`, `orgaoJulgador`, `endereco`.

`/poloPassivo` devolve em `result` uma lista de:

    { "participante":"SUZANO PAPEL E CELULOSE S.A. - CNPJ: 16.4XX.XXX/XXXX-XX (EXECUTADO)",
      "nome":"SUZANO PAPEL E CELULOSE S.A.", "tipo":"EXECUTADO",
      "situacao":"Ativo", "principal":true }

Advogado vem como item do mesmo array, com `tipo":"ADVOGADO"` e a OAB dentro de
`participante` ("MARIA BEATRIZ DE ALCANTARA ROTONDI - OAB SP455504 - CPF: ...").
Extrair a OAB de `participante` com regex `OAB\s*([A-Z]{2}\d+)`.

`/movimentacoes?page=0` devolve `result` com `movimento` (texto) e
`dataAtualizacao` ("dd/mm/aaaa hh:mm:ss"), já em ordem decrescente.

Observações:
- O CNPJ dos participantes vem mascarado (`16.4XX.XXX/XXXX-XX`). Como a busca já
  é feita por CNPJ, a conferência passa a ser só de sanidade: comparar os 4
  primeiros caracteres visíveis. Guardar a máscara em `cnpj_mascarado`.
- `/poloPassivo` pode devolver HTTP 500 em alguns processos. Tratar como lista
  vazia e seguir, sem marcar erro na empresa.
- Sem `dataAutuacaoInicio`, a busca traz tudo; o limite de 30 por página continua,
  com aviso "somente os 30 primeiros". Manter a lógica atual de fallback por ano,
  agora usando `page` e `pageInfo.last` em vez do rodapé HTML.

## 4. Mudanças no `scripts/radar/pje_worker.py`

Sem migração de banco. As tabelas `radar_processos`, `radar_processo_advogados` e
`radar_processo_movimentos` continuam iguais.

1. Novas constantes: `URL_BASE = "https://pje1g-consultapublica.trf3.jus.br"`,
   `API = URL_BASE + "/v1"`. Remover `URL_CONSULTA` do Seam e `ABRIR_DETALHE_EM_ABA`.
2. Trocar a classe `ConsultaPje` por um cliente de API (`PjeApi`) com os métodos
   `buscar(cnpj, data_de=None, data_ate=None, page=0)`, `dados(id)`, `polo(id, lado)`
   e `movimentacoes(id)`. Cada método chama `context.request.get`, valida
   `status == 200` e `json()["status"] == "ok"`.
3. Manter `Bloqueado`: disparar quando a resposta vier 403, ou com corpo contendo
   "Access Denied" ou "edgesuite.net". O tratamento de bloqueio (dormir 1 h, teto
   de 3 por dia) fica como está.
4. Apagar todo o parse de HTML que não for mais usado: `parse_detalhe`, `campo`,
   `secao`, `participantes`, `_linhas`, `_movimentos`, `classe_da_linha`,
   `RE_MOV`, `RE_AVISO_30`, e o mecanismo de aba/popup do detalhe. Apagar também
   `nomes_de_busca`/`nome_de_busca` e o fallback por nome: a busca por CNPJ é a
   única via agora (o nome era fallback da tela antiga e não é mais necessário).
5. Filtro de classe: manter `CLASSES` (1116 execução fiscal, 1118 embargos).
   Na listagem, casar por `classeSigla` ("ExFis", "EmbExeFis") e por `classe`
   sem acento; confirmar o código lendo os parênteses de `classeJudicial` em
   `/dados`. Processos de outras classes não entram na tabela.
6. `gravar_listagem` passa a receber os itens já normalizados da API. O
   `polo_passivo_nome` sai de `partes.poloPassivo.nomeParte` para 1116 e de
   `partes.poloAtivo.nomeParte` para 1118 (a empresa embargante está no polo
   ativo), mesma regra de hoje.
7. `gravar_detalhe` passa a montar `parsed` a partir de `/dados`, `/poloPassivo`,
   `/poloAtivo` e `/movimentacoes`, mantendo exatamente as mesmas chaves que a
   função já grava hoje. Continuam valendo: no máximo 15 movimentações por
   processo, no máximo 8 processos detalhados por empresa (os mais recentes pelo
   número CNJ), advogados deduplicados por (nome, OAB).
8. `qtd_execucoes_sem_advogado` continua sendo calculada pela
   `radar_consolidar_dossie` no banco. Nada muda aqui.
9. Ritmo novo, porque o custo por empresa caiu de dezenas de cliques para cerca
   de 1 + 4 x N chamadas: `INTERVALO_ENTRE_REQUISICOES_S = 6` com jitter 4,
   `INTERVALO_ENTRE_EMPRESAS_S = 60` com jitter 30, `TETO_DIARIO = 150`. Janela
   de 7h às 23h mantida. Em qualquer 403 ou Access Denied, dobrar as pausas pelo
   resto do dia, além da dormida de 1 h que já existe.
10. `--debug` passa a salvar o JSON bruto de cada chamada em `data/radar/debug/`
    (`busca_<cnpj>.json`, `dados_<numero>.json`, etc.).

## 5. Aceite

Rodar `scripts/radar/pje_worker.py --cnpj <x> --debug` para:

- `16404287004738` (Suzano Papel e Celulose, subseção de Santos): a busca com
  `dataAutuacaoInicio=2021-01-01` devolve 8 processos, 7 deles execução fiscal.
- `54083035000160` (Procomp): devolve mandados de segurança e nenhuma execução
  fiscal, ou seja, a empresa fica sem processos gravados e sem erro.

Conferir no banco: `radar_processos` com `data_distribuicao`, `orgao_julgador` e
`jurisdicao` preenchidos, `radar_processo_advogados` com nome e OAB, e
`radar_processo_movimentos` com até 15 linhas por processo.

## 6. Depois do merge

1. Reenfileirar o que ficou para trás:

       update radar_pje_fila set status='pendente', erro=null, tentativas=0,
              iniciado_em=null, finalizado_em=null
        where status in ('erro','processando');

2. Religar o worker no launchd e conferir o log na primeira hora.

## 7. Regras de execução

Branch `radar-pje-api` a partir da `main`, worker parado durante o trabalho,
só mudanças no `scripts/radar/pje_worker.py` e nesta pasta de docs, `git add`
arquivo por arquivo (o repo tem restos não commitados de outras sessões que
ficam de fora), e PR ao final.
