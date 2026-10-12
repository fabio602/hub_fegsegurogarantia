# Seguro Licitante — leitura de edital e Double Check sem IA

Desde outubro de 2026 a aba **Seguro Licitante** não chama mais nenhuma API paga.
O edital e a minuta são lidos **no navegador**, por regras escritas para editais
brasileiros. Nenhum arquivo sai da máquina e não há custo por documento.

As Edge Functions `analyze-edital` e `validate-minuta` continuam publicadas no Supabase,
mas a aba Licitante não as usa mais. A aba **Seguro de Contrato** continua na IA.

## Como funciona

```
PDF / imagem
  └─ lib/pdf/lerDocumento.ts      texto de cada página (unpdf num Web Worker)
       └─ sem texto? lib/pdf/ocr.ts   OCR local (Tesseract, português)
  └─ lib/edital/index.ts          extrairEdital(paginas) → EditalData
       ├─ documento.ts            junta as páginas, tira cabeçalho/rodapé repetido
       ├─ regras/garantia.ts      exige?, %, base, modalidades, vigência, termo, CNPJ
       ├─ regras/valor.ts         valor estimado (rótulos fortes votam no número)
       ├─ regras/datas.ts         sessão pública, limite de propostas, validade (art. 59)
       ├─ regras/identificacao.ts órgão, modalidade, nº, processo, objeto, portal
       ├─ regras/execucao.ts      garantia de execução (oportunidade de contrato)
       ├─ regras/lotes.ts         valor de cada lote (quando a garantia é por lote)
       └─ travas.ts               travas portadas do analyze-edital
  └─ finalizarEdital / corrigirCampo  recalcula garantia, alertas e pendências
                                      a cada correção manual na tela

Minuta (Double Check)
  └─ lib/minuta/extrairMinuta.ts  seguradora, segurado, tomador, CNPJs, IS, prêmio,
                                  vigência, modalidade, edital citado
  └─ lib/minuta/conferirMinuta.ts confere contra o edital → veredicto
```

## O que o Double Check confere

| Item | Regra |
|---|---|
| Modalidade | tem de ser licitante / garantia de proposta |
| Segurado | o CNPJ do edital tem de estar na minuta |
| CNPJs da minuta | dígitos verificadores do segurado e do tomador (pega erro de digitação) |
| Valor da garantia | exato sobre o valor global ou sobre os lotes marcados; sem lote marcado, diz a qual combinação de lotes a minuta corresponde |
| Início da cobertura | a garantia tem de estar valendo até o limite de entrega das propostas (ou a sessão). Respeita a convenção da seguradora: "a partir das 00:00h" começa no dia; "às 24h"/"23:59h" só vale no dia seguinte. Sem informação, considera às 24h (conservador) |
| Prazo da vigência | dias exigidos contados do termo inicial (art. 183: exclui o dia do começo e inclui o do vencimento); sem vigência no edital, compara com a validade da proposta e só marca "conferir" |
| Edital no objeto | o número do edital citado na apólice tem de bater ("013/2026" = "13/2026") |
| Tomador | tem de estar identificado |

Datas impossíveis (31/02) e fim antes do início são divergência. Quando o usuário marca
lotes depois de validar, o Double Check se recalcula sozinho.

Cada dado extraído guarda a **evidência** (`_evidencias`: trecho literal e página). Na
tela, "p. 16 · ver trecho" abre a página do PDF com o trecho destacado
(`components/VisualizadorTrecho.tsx`), e o lápis corrige o campo à mão. O campo
corrigido fica marcado como "Informado manualmente" e não é derrubado pelas travas.

## Princípios das regras

- **Campo vazio é melhor que campo errado.** Na dúvida a regra devolve `null` e a tela
  mostra "Não encontrado — preencher".
- A garantia de proposta é procurada **dentro da cláusula de garantia**. Ela começa na
  âncora ("garantia da proposta", "art. 58"…) e termina no próximo título ou capítulo.
- Armadilhas tratadas de propósito (todas estão na bateria):
  - a validade da **proposta** (art. 59) não é a vigência da garantia;
  - o prazo de **devolução** da garantia não é a vigência;
  - garantia **adicional** (art. 59 §5º) e garantia de **execução** não são a de proposta;
  - valores "até R$ X", preço unitário e "Total sem BDI" não são o valor estimado;
  - na minuta, a majoração do endosso e as despesas de contenção não são a IS.
- Base de cálculo por lote ou por item: o valor calculado é o **teto**. No Double Check,
  uma minuta abaixo do teto fica como "conferir", não como divergência.

## Bateria de regressão

```bash
~/.deno/bin/deno run -A --node-modules-dir=none regressao/rodar-local.ts
~/.deno/bin/deno run -A --node-modules-dir=none regressao/rodar-local.ts --caso maraba-cp-148-2026 --json
```

- `regressao/gabarito.json`: 5 editais × 8 campos, conferidos à mão.
- `regressao/gabarito-minutas.json`: 7 minutas de 5 seguradoras.
- Os PDFs ficam em `regressao/pdfs/` e `regressao/minutas/` e não vão para o git.
- Casos adulterados (no próprio `rodar-local.ts`): a minuta de Mortugaba com um erro
  plantado de cada vez (CNPJ com dígito trocado, início às 24h do dia da sessão, data
  impossível, lote errado, edital errado, modalidade errada, prazo curto). Cada um prova
  que a regra correspondente pega o problema.
- Placar em 11/10/2026: **117/117** (editais 41/41, minutas 63/63, Double Check 13/13).

Rode a bateria **antes e depois** de qualquer mudança nas regras. Quando um edital real
vier errado, a correção é: adicionar o PDF em `regressao/pdfs/`, o caso no gabarito
(com a evidência literal), ajustar a regra e conferir que nada antigo quebrou.

Atenção: os 5 editais são o conjunto em que as regras foram calibradas. Acertar 100%
neles não garante o mesmo nos próximos. Por isso, ampliar a bateria com editais novos
(de outros órgãos e portais) é a melhor forma de melhorar o sistema.

## OCR

- Só entra quando o PDF não tem texto (média abaixo de 50 caracteres por página) ou
  quando o arquivo é uma imagem.
- Lê no máximo as 40 primeiras páginas de cada arquivo (`MAX_PAGINAS_OCR`).
- Os arquivos do Tesseract (worker, wasm e `por.traineddata`) são servidos pelo próprio
  hub em `/tesseract/*` (plugin `ocrLocal` no `vite.config.ts`, a partir do
  `node_modules`). Nada é baixado de CDN externa.
- O pdf.js e o Tesseract são carregados sob demanda: só baixam quando alguém usa a aba.

## Seguradora nova no Double Check

O leitor de minuta é genérico e não tem um extrator por seguradora. Ele se baseia em:

- tabela de coberturas (cabeçalho + linha de valores);
- rótulo seguido de valor;
- tipo do nome (órgão público × empresa) e o CNPJ mais próximo;
- par de datas perto da palavra "vigência".

Se uma seguradora nova vier errada:

1. acrescente o nome dela em `SEGURADORAS` (`extrairMinuta.ts`);
2. ponha a minuta em `regressao/minutas/` e o caso em `gabarito-minutas.json`;
3. ajuste a regra até a bateria fechar.
