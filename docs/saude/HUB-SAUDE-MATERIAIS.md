# HUB, módulo Saúde: biblioteca de materiais e carta de exclusividade

Duas entregas pequenas em cima do que já existe. Nada aqui é módulo novo.

1. A tela **Formulários** (`components/Formularios.tsx`) passa a servir dois
   módulos, e o de saúde ganha a própria aba no grupo Plano de Saúde. É lá que
   moram a apresentação comercial, a tabela de preços, a de coparticipação e o
   que mais o Fábio precisar mandar para o cliente.
2. Um gerador de **carta de exclusividade** da Unimed Sorocaba, para os casos
   acima de 29 vidas, nos moldes do `components/NominationLetter.tsx` que já
   existe para Seguro Garantia.

Esta spec traz as decisões já tomadas. Não abra alternativa nem peça
confirmação de arquitetura: execute o que está aqui e registre em
`docs/saude/DECISOES.md` qualquer desvio que a realidade do código obrigar.

Branch: `saude-materiais`. Tag de retorno antes de começar: `pre-saude-materiais`.

---

## 0. Por que reaproveitar a tela de Formulários e não criar outra

A tela de Formulários já resolve o problema inteiro: arquivo no storage,
categoria, busca, copiar link, baixar, e escrita só para o admin, com a regra
no banco e não apenas na tela (`supabase/045_formularios.sql`). O bucket
`formularios` já é público, e é público de propósito: o link precisa abrir no
navegador de um cliente que não tem login no HUB, e o que mora lá é material em
branco, sem dado de pessoa nenhuma.

Material de saúde tem exatamente essa natureza. Apresentação comercial, tabela
de preços e folheto de rede credenciada não têm dado de cliente. Duplicar
tabela, bucket e policy para guardar o mesmo tipo de arquivo criaria duas
superfícies de permissão para manter em vez de uma.

O que separa os dois mundos é uma coluna, não uma tabela.

**Atenção ao limite:** nada que tenha dado de beneficiário entra no bucket
`formularios`. Documento de cliente já tem lugar próprio, privado e com
retenção: `saude-documentos`, migração 095. Essa fronteira não se afrouxa.

---

## 1. Migração `supabase/097_saude_materiais.sql`

Aditiva. Não edite as migrações antigas. A `045` continua valendo inteira: as
policies de leitura e de escrita do admin não mudam.

```sql
-- 097_saude_materiais.sql
--
-- A biblioteca de formularios passa a servir os dois modulos da corretora.
-- Seguro Garantia ja usa a tela; plano de saude passa a usar a mesma, com a
-- propria aba e as proprias categorias.
--
-- Nao ha bucket novo. O `formularios` ja e publico e ja guarda material em
-- branco sem dado de pessoa, que e a mesma natureza do material de saude.
-- Documento de beneficiario continua no `saude-documentos`, privado e com
-- retencao (migracao 095). Essa fronteira nao se mistura.

alter table formularios
  add column if not exists modulo text not null default 'garantia';

-- As linhas que ja existem sao todas de Seguro Garantia e ficam como estao
-- pelo default acima.
alter table formularios
  drop constraint if exists formularios_modulo_check;
alter table formularios
  add constraint formularios_modulo_check check (modulo in ('garantia', 'saude'));

comment on column formularios.modulo is
  'Qual aba do HUB mostra este arquivo: garantia (tela Formularios) ou saude (aba Materiais).';

-- Vigencia em texto livre, do jeito que a operadora escreve: "a partir de
-- 18.05.26". Existe porque tabela de preco vence, e um preco velho enviado
-- ao cliente custa caro.
alter table formularios
  add column if not exists vigencia text;

comment on column formularios.vigencia is
  'Vigencia declarada do material, como a operadora escreve. So exibicao, nao trava nada.';

-- Serve ao cache-busting do link publico: a URL nao muda quando o arquivo e
-- substituido, entao o ?v= do link carrega este timestamp.
alter table formularios
  add column if not exists atualizado_em timestamptz not null default now();

drop index if exists formularios_categoria_idx;
create index if not exists formularios_modulo_idx
  on formularios (modulo, categoria, ordem, nome);
```

Aplique no projeto real `hfjvwibucplyhsvnwfor` e deixe o arquivo no repositório,
no mesmo padrão das outras.

---

## 2. `components/Formularios.tsx` ganha a prop `modulo`

A tela continua sendo uma só. O que muda é de quem ela é.

**Assinatura**

```ts
type Modulo = 'garantia' | 'saude';
export default function Formularios({ modulo = 'garantia' }: { modulo?: Modulo })
```

O default garante que a view `formularios`, que hoje renderiza `<Formularios />`
sem prop, continue mostrando exatamente o que mostra hoje. Isso não é detalhe:
é o que impede uma regressão na tela que já está em produção.

**Mudanças pontuais**

- A consulta ganha `.eq('modulo', modulo)`.
- O insert grava `modulo`.
- O caminho do upload ganha o prefixo do módulo: `${modulo}/${nome-do-arquivo}`.
  Os arquivos que já existem não são movidos, e não precisam ser: a coluna
  `arquivo_url` guarda a URL inteira.
- `CATEGORIAS_SUGERIDAS` vira um mapa por módulo. O de garantia é o de hoje,
  sem tirar nem acrescentar nada:

```ts
const CATEGORIAS_SUGERIDAS: Record<Modulo, string[]> = {
  garantia: ['Cadastro', 'Seguro Garantia', 'Sinistro', 'Endosso', 'Geral'],
  saude: [
    'Apresentação',
    'Tabela de preços',
    'Coparticipação',
    'Rede credenciada',
    'Contratação',
    'Carta de nomeação',
  ],
};
```

- O modal de upload ganha o campo **Vigência**, opcional, com placeholder
  `a partir de 18.05.26`. Quando preenchido, aparece como um selo no card.
- O `id` do `datalist` passa a incluir o módulo (`categorias-formulario-${modulo}`),
  senão as duas telas brigam pelo mesmo id se um dia forem montadas juntas.
- O texto de vazio muda por módulo: em saúde, "Nenhum material ainda".

**Copiar link carrega a versão**

`copiarLink` passa a copiar `${f.arquivo_url}?v=${Date.parse(f.atualizado_em)}`.

Isso existe por um motivo concreto: o bucket é público e serve por CDN. Sem o
parâmetro, o cliente que já abriu o link uma vez pode continuar recebendo o
arquivo antigo do cache depois de uma substituição. Com ele, cada versão é uma
URL diferente para o cache e a mesma URL para nós.

**Substituir arquivo, sem quebrar o link já enviado**

Card do admin ganha o botão **Substituir**, ao lado de Baixar e Apagar. Ele
sobe o novo arquivo **no mesmo caminho**, com `upsert: true`, e faz update de
`arquivo_nome`, `vigencia` e `atualizado_em`. Não cria linha nova e não muda
`arquivo_url`.

A razão é operacional: quando a Unimed reajusta a tabela, o Fábio já mandou o
link antigo para uma dezena de clientes. Substituir no mesmo caminho faz esses
links passarem a servir o arquivo novo em vez de virarem link morto. Apagar e
subir de novo faria o contrário, e é o que a tela obriga hoje.

---

## 3. `App.tsx`

Mesmo padrão do resto do grupo de saúde, que já existe nas linhas 59 a 61,
86, 96, 128 a 130, 615 a 617 e 922 a 924.

- Novas views no type: `'saude-materiais' | 'saude-nomeacao'`.
- Acrescente as duas ao array `SAUDE_VIEWS`.
- Títulos: `'saude-materiais': 'Materiais · Plano de Saúde'` e
  `'saude-nomeacao': 'Carta de Exclusividade · Saúde'`.
- Sidebar, no grupo `saude`, depois de Prospecção:

```tsx
<NavSubItem view="saude-materiais" label="Materiais" />
<NavSubItem view="saude-nomeacao" label="Carta de Exclusividade" />
```

- Render:

```tsx
{vista === 'saude-materiais' && <Formularios modulo="saude" />}
{vista === 'saude-nomeacao' && <SaudeCartaExclusividade />}
```

A linha `{vista === 'formularios' && <Formularios />}` fica como está.

---

## 4. `src/views/Saude/CartaExclusividade.tsx`

Componente novo, na pasta do módulo de saúde, e não em `components/`, seguindo
o que o Radar e o resto da saúde já fazem.

**O documento não é uma carta de nomeação da F&G.** Esse ponto precisa estar
claro na tela, porque contraria a expectativa de quem já usa o gerador do
Seguro Garantia. No plano de saúde o credenciamento passa pela Favorita Brasil,
e o modelo que a operadora aceita nomeia a plataforma, não a corretora. Quem
assina é o cliente, e quem é nomeada é a **FAVORITA BRASIL CORRETORA DE SEGUROS
LTDA**. Escreva isso em uma linha de aviso acima do formulário, junto com
quando a carta é necessária: acima de 29 vidas, quando a cotação passa por
reserva de mercado. A própria `unimed_calcular_cotacao` já barra esse caso com
essa mensagem (`supabase/083_unimed_saude.sql`, linha 278).

**Reaproveite a mecânica de `components/NominationLetter.tsx`**, que já está
resolvida e testada: máscara de CNPJ, preenchimento por BrasilAPI
(`razao_social`, município e UF, telefone, e primeiro sócio do `qsa` como nome
do responsável), `formatDateExtenso` de `utils/formatters`, e exportação com
`html2pdf` usando o mesmo bloco de opções (A4, margem 0, escala 2). Não
importe nem estenda o `NominationLetter`: copie o que serve. São documentos
diferentes, com destinatários diferentes, e amarrar os dois faria uma mudança
no Seguro Garantia respingar na saúde.

**Campos**: razão social, CNPJ, nome do responsável legal, cidade e data.
Cidade e data vêm preenchidas de Sorocaba e de hoje, e são editáveis.

O modelo original da operadora está no repositório, em
`docs/saude/modelo-carta-exclusividade-unimed.doc` (arquivo enviado pelo
Tiago Vitorino, da Favorita). Ele é a fonte de verdade do texto: se houver
divergência entre a spec e o .doc, o .doc vence.

**Corpo do documento**, fiel ao modelo da operadora (o cabeçalho
"(Emitir em papel timbrado da empresa)" e a marca d'água "M O D E L O" do
arquivo original NÃO entram no documento gerado; são instrução, não conteúdo):

> Sorocaba, {dia} de {mês} de {ano}.
>
> A UNIMED SOROCABA – COOPERATIVA DE TRABALHO MÉDICO
>
> A/C: Diretora Executiva
>
> Ref: Carta de Exclusividade
>
> A/C Departamento Comercial
>
> Comunicamos que a Plataforma FAVORITA BRASIL CORRETORA DE SEGUROS LTDA, foi
> nomeada a partir desta data com exclusividade para solicitar estudos e
> propostas para nossa empresa.
>
> Desta forma, revogamos qualquer exclusividade, autorização ou reserva de
> mercado anteriormente firmada com a mesma finalidade.
>
> Atenciosamente,
>
> Empresa: {razão social}
> CNPJ: {cnpj}
> Assinatura do Responsável Legal: ______________________
> Nome do Responsável Legal: {nome}

**Dois botões de saída, e o segundo importa tanto quanto o primeiro:**

- **Baixar PDF**, arquivo `Exclusividade_{razaoSocial}.pdf`, com o topo da
  página deixado em branco, sem logo da F&G. O modelo manda emitir em papel
  timbrado da empresa do cliente, então o PDF serve para quem vai imprimir e
  carimbar, não para carregar a nossa marca.
- **Copiar texto**, que joga o corpo inteiro na área de transferência. Esse é o
  caminho mais usado na prática: o cliente cola no timbrado dele, assina e
  devolve. Sem isso a tela obriga um trabalho manual de transcrição.

Nada é gravado em banco nesta versão. A carta é um documento que o cliente
assina fora do HUB, e registrar a geração sem registrar a devolução assinada
seria um status que mente. Quando o Fábio pedir esse controle, ele entra como
um slot em `saude_documentos`, que já tem o lugar certo para arquivo assinado.

---

## 5. Depois de aplicar

`npm run build` tem que passar. Não existe step de `tsc` separado neste
repositório: o build é a checagem.

Confira na tela, com o usuário logado como admin:

1. A aba Formulários do Seguro Garantia mostra os mesmos arquivos de antes,
   sem nenhum item de saúde aparecendo lá.
2. A aba Materiais do Plano de Saúde começa vazia e aceita upload.
3. O link copiado abre em janela anônima, sem login.
4. Substituir um arquivo mantém o link e troca o conteúdo.
5. A carta gera PDF e copia texto com o CNPJ preenchido pela BrasilAPI.

Commit por passo, `git add` arquivo por arquivo. Push e merge só quando o
Fábio pedir.

---

## 6. O que o Fábio sobe assim que a aba existir

| Categoria | Arquivo |
|---|---|
| Apresentação | Apresentação comercial Unimed Sorocaba, PDF, 12 slides |
| Tabela de preços | Tabela UNIPART, vigência a partir de 18.05.26 |
| Coparticipação | Tabela de coparticipação UNIPART Max e Fácil |
| Contratação | Formulário de cotação PJ da Unimed Sorocaba |
| Carta de nomeação | Modelo em branco, para quem preferir o arquivo ao gerador |
