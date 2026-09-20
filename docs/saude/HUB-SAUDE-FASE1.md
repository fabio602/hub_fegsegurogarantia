# HUB, módulo Saúde, Fase 1

Aba nova no HUB para a segunda linha de negócio da F&G: planos de saúde
empresariais (PME) da Unimed Sorocaba, produto UNIPART, para empresas de 1 a 29
vidas nas doze cidades da área de abrangência.

Esta spec traz as decisões já tomadas. Não abra alternativa nem peça confirmação
de escolha de arquitetura: execute o que está aqui e registre em
`docs/saude/DECISOES.md` qualquer desvio que a realidade do código obrigar.

Branch: `saude-fase1`. Tag de retorno antes de começar: `pre-saude`.

---

## 1. O que JÁ ESTÁ APLICADO no Supabase

**Não recrie nada disto.** Já foi aplicado no projeto real `hfjvwibucplyhsvnwfor`
em 20/09/2026. Sua tarefa aqui é apenas **criar os arquivos de migração
correspondentes no repositório**, para o histórico não ficar furado, e consumir
essas estruturas na tela.

| Migração | O que fez |
|---|---|
| `083_unimed_saude` | tabelas `unimed_precos`, `unimed_adicionais`, `unimed_leads`, `unimed_cotacoes`; RLS `*_auth` para `authenticated`; carga da tabela UNIPART; função `unimed_calcular_cotacao`; trilha `saude-pme` em `email_trilhas` |
| `084_trilha_saude_pme` | as 5 etapas da trilha `saude-pme` em `email_trilha_etapas` |
| `085_email_trilhas_assinatura_linha` | coluna `assinatura_linha` em `email_trilhas`, default `'Corretora especialista em Seguro Garantia'` |
| `086_unimed_leads_cnpj_unique_simples` | troca do índice único parcial de `cnpj` por índice único simples |
| `087_unimed_leads_status_acentuado` | rótulos do funil gravados acentuados |
| `088_trilha_saude_identidade` | identidade por trilha em `email_trilhas` (`marca_nome`, `marca_cargo`, `contato_telefone`, `contato_site`, `contato_whatsapp`, `tema` jsonb), todas com o padrão antigo; a trilha `saude-pme` recebe os dados da F&G Saúde e a paleta verde; as 5 etapas são reescritas acentuadas e nas cores do site |
| `089_trilha_saude_foco_plano` | reescreve o texto das 5 etapas tirando o ângulo de RH (contratação e retenção de pessoal) e colocando o plano no centro: a etapa 1 passa a apresentar os três Unipart e a etapa 2 troca "sua equipe" por "você" e ganha o Hospital Unimed Boituva |
| `090_trilha_saude_dor` | remonta a trilha em cima de dor e não de objeção, partindo da premissa (confirmada pelo Fábio) de que a maioria dos prospects não tem plano empresarial: o e-mail 1 ataca o bolso do dono que paga plano no CPF, os e-mails 1 e 5 ficam curtos e sem quadro, e três dos cinco botões passam a levar ao simulador em vez de pedir resposta |
| `091_trilha_saude_desejo` | vira a estratégia da trilha: público sem consciência do problema não responde a dor, então a sequência passa a abrir apresentando a Unimed de Sorocaba (cooperativa de 1971, mais de 1.300 cooperados, hospitais próprios), segue pelo plano no dia a dia, depois pelos hospitais, e só chega ao preço no dia 12. Números institucionais com fonte anotada no comentário da migração |
| `092_campanha_saude_pme` | cria a campanha de garimpo `saude-pme`, desligada e em dry run, apontando para a trilha `saude-pme` e para Sorocaba, Boituva e Porto Feliz |

Também já está publicada a Edge Function **`lead-saude`** (`verify_jwt: false`),
que recebe o formulário do site de saúde, grava em `unimed_leads` com status
`Novo`, calcula a estimativa dos três planos e avisa por e-mail. O código-fonte
dela vive no **repositório do site de saúde**, não neste. Não duplique aqui.

### Esquema que você vai consumir

```
unimed_precos       (tabela, plano, faixa, faixa_ordem, idade_min, idade_max, valor, vigencia)
                    tabela IN ('1_vida', '2_a_29_vidas')
                    plano  IN ('max_a', 'max_b', 'facil')

unimed_adicionais   (codigo PK, nome, valor, valor_alt, regra_alt, descricao, padrao)
                    codigos: aph, bf, odonto, funeral

unimed_leads        (id, created_at, updated_at,
                     empresa, cnpj, cidade, uf, cnae_principal, porte, site,
                     contato, cargo, email, telefone,
                     vidas, tem_plano_atual, operadora_atual, valor_atual,
                     mes_renovacao, plano_interesse,
                     status, status_entered_at, origem, proxima_acao,
                     observacoes, motivo_perda,
                     vigencia_prevista, vidas_implantadas, valor_mensal, implantado_em)

unimed_cotacoes     (id, lead_id, created_at, plano, composicao jsonb,
                     adicionais text[], vidas_total, tabela, total_mensal,
                     detalhe jsonb, observacao)
```

`unimed_leads` tem trigger `unimed_leads_touch_trg`: ela mantém `updated_at` e
**reescreve `status_entered_at` sozinha** a cada troca de status. Não mande esses
dois campos no update a partir da tela.

`cnpj` é gravado **só com dígitos**, sem máscara. Índice único. A tela formata na
exibição e limpa antes de gravar.

### A função de cálculo

```sql
select unimed_calcular_cotacao(
  'max_a',
  '{"0 a 18": 2, "29 a 33": 3, "39 a 43": 1, "54 a 58": 1}'::jsonb,
  array['aph','bf']
);
```

Devolve `jsonb` com `plano`, `tabela`, `vidas`, `linhas[]` (faixa, vidas,
valor_unitario, subtotal), `subtotal_base`, `subtotal_adicionais`, `total_mensal`.
Para a composição acima o resultado é **3225.53**. Use esse número como gabarito
do seu teste manual.

Chame por RPC:

```ts
const { data, error } = await supabase.rpc('unimed_calcular_cotacao', {
  p_plano: plano,
  p_composicao: composicao,
  p_adicionais: adicionais,
});
```

A função levanta exceção em três casos: plano inválido, zero vidas e mais de 29
vidas. Trate os três na tela com mensagem em `rose`, não deixe estourar.

---

## 2. Decisões já tomadas

1. **Funil próprio, não o Kanban de `prospects`.** Saúde tem etapas que Seguro
   Garantia não tem (entrevista médica, documentação por beneficiário). Misturar
   na mesma tabela quebraria as duas telas.
2. **Prospecção fria continua em `prospects` + trilha**, pelo motor de garimpo que
   já existe. `unimed_leads` é para lead qualificado: quem veio do site, quem
   respondeu a trilha, quem você abordou e demonstrou interesse. O caminho de
   promoção está na seção 6.
3. **Uma fonte de verdade para preço: a função no banco.** A tela não reimplementa
   o cálculo em TypeScript. Se a chamada RPC falhar, mostre erro; não caia para um
   cálculo local, porque divergência silenciosa de preço em cotação é pior que
   erro visível.
4. **Três vistas na aba, sem submenu de grupo separado por enquanto:** Funil,
   Simulador e Prospecção.
5. **A tabela de preços não é editável pela tela.** Tabela nova da Favorita entra
   por migração numerada. A tela mostra a vigência em uso.
6. **Acima de 29 vidas a tela não cota.** Mostra o aviso de reserva de mercado e
   carta de nomeação, e um botão que copia o texto do pedido para a Favorita.
7. **Nada de API paga.** Vale a regra do projeto inteiro.

---

## 3. Estrutura de arquivos

Siga o precedente do Radar, que já é a única pasta fora de `components/` e já
está coberta pelo `content` do Tailwind:

```
src/views/Saude/
  index.tsx              shell da aba, alterna entre as três vistas
  Funil.tsx              kanban de unimed_leads
  LeadDrawer.tsx         painel lateral de um lead
  Simulador.tsx          calculadora de cotação
  Prospeccao.tsx         campanha, trilha e importação
  precos.ts              tipos e helpers de faixa etária, sem cálculo de preço
  copy.ts                textos longos (orçamento, pedido à Favorita)

docs/saude/
  README.md              como as peças se encaixam
  DECISOES.md            desvios desta spec

supabase/
  083_unimed_saude.sql            (espelho do que já está aplicado)
  084_trilha_saude_pme.sql
  085_email_trilhas_assinatura_linha.sql
  086_unimed_leads_cnpj_unique_simples.sql
  087_unimed_leads_status_acentuado.sql
  088_trilha_saude_identidade.sql
  089_trilha_saude_foco_plano.sql
  090_trilha_saude_dor.sql
  091_trilha_saude_desejo.sql
  0NN_campanha_saude_pme.sql      (esta você cria, seção 6.1, no próximo número livre)

patch-cadencia-saude.py           na raiz, aplica a seção 7 e depois pode sair
```

### Ligação no `App.tsx`

Quatro pontos, exatamente como o CLAUDE.md descreve:

1. adicionar ao type `View`: `'saude-funil' | 'saude-simulador' | 'saude-prospeccao'`;
2. `VIEW_TITLES`: `'Plano de Saúde'`, `'Simulador de Cotação'`, `'Prospecção Saúde'`;
3. criar `const SAUDE_VIEWS = ['saude-funil', 'saude-simulador', 'saude-prospeccao']`
   e um grupo no sidebar chamado **Saúde**, no mesmo padrão de `AUTO_VIEWS` e
   `RESIDENCIAL_VIEWS`, com o `isGroupActive` correspondente e a entrada no
   `useEffect` que abre o grupo (linha ~309);
4. blocos de render apontando para `src/views/Saude/`.

Ícone do grupo: `HeartPulse` do lucide-react. Se não existir na versão instalada,
use `Activity`. Não invente SVG.

---

## 4. Vista Funil

Kanban de `unimed_leads`, sete colunas, nesta ordem:

`Novo` · `Contato feito` · `Cotação enviada` · `Documentação` · `Entrevista médica` · `Implantado` · `Perdido`

Os valores no banco são exatamente esses, acentuados. Não crie mapa de tradução.

**Cartão** mostra: empresa, cidade, vidas, plano de interesse (quando houver) e o
valor da última cotação. Arrastar entre colunas faz `update` só do campo `status`.

**Cores.** `gold` só na identidade do cartão, nunca em estado. Use `emerald` no
cabeçalho de `Implantado`, `rose` em `Perdido`, `amber` no contador de leads
parados há mais de 7 dias em `status_entered_at`, `blue` em `Entrevista médica`
porque é etapa dependente de terceiro. Escreva a classe inteira nos dois ramos do
ternário: nada de `bg-${cor}-500`.

**Drawer do lead** (`LeadDrawer.tsx`), campos editáveis por clique, no padrão que
o Radar já usa para telefone e e-mail:

- bloco Empresa: empresa, CNPJ (com máscara na exibição), cidade, site, CNAE
- bloco Contato: contato, cargo, e-mail, telefone, com botão de WhatsApp usando
  `utils/whatsapp.ts`
- bloco Qualificação: vidas, tem plano atual, operadora atual, valor atual, mês de
  renovação, plano de interesse
- bloco Cotações: lista de `unimed_cotacoes` do lead, mais recente primeiro, com
  botão "Nova cotação" que abre o Simulador já com o lead vinculado
- bloco Fechamento, visível só em `Implantado`: vigência prevista, vidas
  implantadas, valor mensal, data de implantação
- campo `motivo_perda`, visível só em `Perdido`, obrigatório para salvar

**Alertas no drawer**, em `amber`:

- vidas acima de 29: "Acima de 29 vidas. Passa por reserva de mercado e precisa de
  carta de nomeação."
- `mes_renovacao` no mês corrente ou no seguinte: "Renovação do plano atual está
  próxima."
- lead parado há mais de 14 dias no mesmo status.

---

## 5. Vista Simulador

Reproduz, dentro do HUB, o simulador que já existe como página avulsa. A diferença
é que aqui ele grava em `unimed_cotacoes` e se liga a um lead.

**Entrada:** dez faixas etárias com stepper (mais e menos), seleção de plano e
checkboxes de adicionais. `aph` e `bf` marcados por padrão, que é o combo que o
Fábio usa.

**Comportamento obrigatório:**

- a tabela aplicada troca sozinha: 1 vida total usa `1_vida`, de 2 a 29 usa
  `2_a_29_vidas`. Mostre qual está valendo;
- os três planos são calculados ao mesmo tempo e exibidos lado a lado, com a
  diferença em reais em relação ao mais barato. O comparativo é a ferramenta de
  venda, não um detalhe;
- abertura por faixa: vidas, valor unitário, subtotal, e as linhas de adicionais
  separadas do subtotal de mensalidades;
- `font-variant-numeric: tabular-nums` em toda coluna de dinheiro;
- com 1 vida só, avisar em `amber` quanto cairia a mensalidade dessa vida na
  tabela de 2 a 29, para incentivar a inclusão de um dependente;
- com `aph` marcado, avisar em `amber` que a ambulância só busca em Sorocaba,
  Votorantim e Araçoiaba da Serra. É a pegadinha do produto: quem vende para
  Boituva e Porto Feliz precisa explicar isso antes;
- acima de 29 vidas, não calcular: mostrar o aviso da decisão 6.

**Saídas:**

1. **Salvar cotação:** grava em `unimed_cotacoes` com `lead_id` quando houver,
   `composicao`, `adicionais`, `vidas_total`, `tabela`, `total_mensal` e o jsonb
   completo da RPC em `detalhe`.
2. **Copiar orçamento:** texto pronto para WhatsApp, com composição, total,
   comparativo dos três planos, coparticipação, carência e regras de vigência.
   O texto vive em `copy.ts`. **Sem travessão em nenhuma linha.**
3. **Copiar pedido para a Favorita:** monta o corpo do e-mail no formato que a
   Favorita pede, que é:

   ```
   Assunto: NOME DA EMPRESA - F & G SEGUROS

   NOME DA EMPRESA
   Plano: UNIPART MAX A
   Início: dd/mm/aaaa
   Nº de vidas: 07

   Dados responsável pela Empresa: telefone, e-mail e estado civil
   Dados Titular e maiores de 18 anos: telefone, e-mail e estado civil
   ```

   Destino: `comercial@favoritabrasil.com.br`. Só monta o texto, não dispara
   e-mail.

**Coparticipação na tela:** os valores de consulta e pronto atendimento dobram no
Max B, porque a tabela é por acomodação. Consultório R$ 35,00 na enfermaria e
R$ 70,00 no apartamento; pronto atendimento R$ 50,00 e R$ 100,00. Exame básico
R$ 5,90, terapia básica R$ 9,90, exame especial R$ 14,90, alta complexidade e
terapias especiais R$ 49,90, iguais nas duas acomodações.

---

## 6. Vista Prospecção

Três painéis, nenhum deles exigindo motor novo.

### 6.1 Campanha de garimpo

O motor de campanhas já é genérico (`campanhas_garimpo` + `garimpo_estoque`).
Criar a campanha é um insert, feito por migração `campanha_saude_pme`, no **próximo número livre**
(a numeração andou bastante, confira a tabela da seção 1 antes de escolher):

```sql
insert into campanhas_garimpo (
  slug, nome, ativo, dry_run, fonte, termos_busca, cidades,
  palavras_exclusao, palavras_inclusao, trilha, tipo_prospect,
  limite_diario, cadencia_garimpo_dias, exigir_cnpj
) values (
  'saude-pme',
  'Plano de Saúde PME',
  false,                                  -- liga depois do primeiro dry run
  true,
  'maps',
  array['metalúrgica','usinagem','indústria','transportadora','distribuidora',
        'escritório de contabilidade','construtora','autopeças','gráfica',
        'confecção','logística','escola particular','clínica'],
  array['Sorocaba, SP','Boituva, SP','Porto Feliz, SP'],
  array['mei','autônomo','profissional liberal','órgão público','prefeitura',
        'sindicato','associação','franquia','loja de shopping'],
  null,
  'saude-pme',
  'Plano de Saúde',
  5,                                      -- 5 e-mails por dia, igual às outras
  7,
  true                                    -- CNPJ é obrigatório: sem CNPJ não há PME
);
```

O painel mostra: estado da campanha, último tique, quantos no estoque por cidade,
quantos já enviados, e um botão para ligar e desligar (`ativo`). Não reescreva o
motor.

**Atenção:** a campanha usa `trilha = 'saude-pme'`, e o cron
`cadencia-emails-daily` das 9h liga **todas** as trilhas ativas. Ou seja, assim
que a campanha sair do `dry_run` e começar a inscrever contatos, os e-mails saem
sozinhos. Deixe isso escrito na tela, perto do botão de ligar.

### 6.2 Trilha `saude-pme`

Reaproveite a tela de trilhas que já existe (`email-trilhas`). Aqui basta um
painel de leitura: quantos contatos ativos, em que etapa cada um está e quantos
e-mails saíram nos últimos 7 dias, lendo `email_cadencia` e `email_envios`
filtrados por `trilha = 'saude-pme'`.

### 6.3 Promover prospect para lead de saúde

Botão no drawer do prospect (Kanban existente) e na lista de estoque do garimpo:
**"Virar lead de saúde"**. Copia empresa, CNPJ, cidade, contato, e-mail, telefone
e site para `unimed_leads` com `status = 'Novo'` e
`origem = 'Prospecção ' || <nome da campanha ou fonte>`.

Idempotente: se já existir `unimed_leads` com aquele CNPJ, não duplica, abre o
lead existente e avisa em `blue`.

---

## 7. Patch pendente na cadência de e-mail

A Edge Function `prospecting-cadence` ainda desenha todo e-mail com o nome, o
cargo, a assinatura, o telefone, o site e as cores da F&G Seguro Garantia
fixos no código. Num e-mail de plano de saúde isso assina errado e manda o
prospect para o canal errado. As migrações 085 e 088 já criaram as colunas
que resolvem isso, e o banco preencheu todas as trilhas antigas com
exatamente os valores que hoje estão fixos, então nenhuma trilha existente
muda de aparência depois do patch.

Falta só aplicar o patch e publicar:

```bash
cd ~/Documents/FG/hub
python3 patch-cadencia-saude.py
supabase functions deploy prospecting-cadence
```

O script faz nove substituições exatas e **para sem gravar nada** se qualquer
trecho não bater, o que protege contra aplicar um patch velho num arquivo que
mudou. Rodar duas vezes é seguro: na segunda ele detecta que já está aplicado
e sai. O que ele muda:

1. `interface Trilha` passa a carregar a identidade da trilha.
2. `molde()` recebe nome, cargo, assinatura, telefone, site e paleta.
3. `montarEmail()` repassa esses campos, com o valor antigo como fallback.
4. Os **dois** `select` de `email_trilhas` trazem as colunas novas.
5. O botão usa o WhatsApp da trilha quando a etapa não traz link próprio.
6. O nome do remetente passa a ser o da trilha.

O item 4 é o que mais importa conferir: esquecer um dos dois selects faria a
assinatura sumir de todos os e-mails.

Depois de publicar, confira sem enviar nada:

```
{"modo":"preview","trilha":"garantia"}    -> cabeçalho "F&G Seguro Garantia"
{"modo":"preview","trilha":"saude-pme"}   -> cabeçalho "F&G Saúde", verde
```

O modo preview monta o HTML e devolve; não dispara e-mail.

**Não ative a trilha `saude-pme` antes de `fgsaude.com.br` estar no ar**: a
etapa 4 manda o prospect para `fgsaude.com.br/cotacao.html`.

## 8. Critérios de aceite

- [ ] `npm run build` passa e `tsc` não acusa erro
- [ ] a aba Saúde aparece no sidebar, abre nas três vistas e o grupo abre sozinho
      quando a vista está ativa
- [ ] criar um lead pela tela, arrastar por todas as sete colunas e ver
      `status_entered_at` mudando sozinho no banco
- [ ] o Simulador com `max_a`, `{"0 a 18":2,"29 a 33":3,"39 a 43":1,"54 a 58":1}`
      e `['aph','bf']` devolve **R$ 3.225,53**
- [ ] salvar essa cotação e ela aparecer no drawer do lead
- [ ] 1 vida troca para a tabela `1_vida` e mostra o aviso da segunda vida
- [ ] 30 vidas não calcula e mostra o aviso de reserva de mercado
- [ ] os três textos copiáveis saem sem travessão
- [ ] promover um prospect duas vezes não cria lead duplicado
- [ ] nenhuma classe do Tailwind montada por interpolação no código novo
- [ ] `docs/saude/README.md` e `docs/saude/DECISOES.md` escritos

## 9. Fora de escopo nesta fase

- Fonte Receita Federal para prospecção (Fase 2, seção abaixo)
- Controle de comissionamento e de implantação por beneficiário
- Gestão de documentos dos beneficiários
- Odonto como produto vendido sozinho, sem plano de saúde
- Qualquer alteração nas telas de Seguro Garantia

## 10. Fase 2, esboço

### 10.1 Fonte de prospecção pela Receita Federal

Trocar o Google Maps pela base de dados abertos da Receita Federal como fonte
principal de PMEs. A RFB traz, por município e CNAE, o porte declarado (ME, EPP,
DEMAIS), a data de abertura, o capital social, o telefone e o e-mail, que é
exatamente o recorte de PME que o Maps não consegue dar.

O modelo já existe e funciona: é o mesmo desenho do Radar da PGFN, ou seja,
download do dump, script local de ingestão numa venv no Mac, tabela própria e
tela com filtro por município. Não começar antes de a Fase 1 estar em produção e
a campanha do Maps ter rodado pelo menos duas semanas, para haver base de
comparação de qualidade de lead.

---

### 10.2 Envio de documentos pelo cliente

> **Construído em 20/09/2026, na mesma conversa.** O que está escrito abaixo é
> o desenho original, mantido porque explica o porquê de cada escolha. Duas
> coisas mudaram na hora de construir, e as duas estão em DECISOES.md:
> a declaração de saúde **não** passa pelo corretor, então nenhum dado de
> saúde encosta no bucket; e o link deixou de nascer só no funil, porque o
> cliente passou a poder começar sozinho pelo site, quando ainda não existe
> lead. Migração 095 e 096, funções `saude-documentos` e `saude-retencao`,
> página `enviar.html`, e o bloco Documentos na ficha do lead.

Decidido com o Fábio em 20/09/2026: **construir depois da Fase 1**, porque o
link nasce de um botão no lead, e o lead mora na aba que ainda não existe.

**O problema.** A página `como-contratar.html` do site já lista tudo o que a
operadora pede: cartão CNPJ e contrato social da empresa; RG, CPF ou CNH,
comprovante de endereço e Cartão Nacional de Saúde do responsável e de cada
titular; documento, CPF e certidões dos dependentes. Hoje isso chega por
WhatsApp, espalhado, sem ninguém saber o que ainda falta.

**Por que não é só uma caixa de upload.** É dado pessoal em volume, e parte dele
a LGPD trata como sensível. Formulário aberto no site vira, além do risco,
hospedagem de arquivo grátis para quem achar a URL. Então: **sem endpoint
aberto**.

**O desenho.**

1. Botão no lead do funil: pedir documentos.
2. Nasce um registro em `saude_envios` com token longo e aleatório, `lead_id`,
   validade e a lista do que é necessário. A lista é **montada a partir da
   cotação**: o sistema já sabe quantas vidas e quantos dependentes, então pede
   um conjunto por pessoa, com nome, em vez de um paredão genérico.
3. O cliente abre `fgsaude.com.br/enviar/?t=<token>` no celular, fotografa ou
   anexa, e vai marcando. Pode fechar e voltar: ele vê o que falta. É esta parte
   que economiza tempo, porque hoje quem persegue documento faltando é o Fábio.
4. O upload **não vai direto ao storage**. Passa por uma Edge Function
   (`saude-upload`, `verify_jwt: false`) que valida token, validade, tipo e
   tamanho, e grava em bucket **privado** `saude-documentos`, em
   `<lead_id>/<slot>/<arquivo>`. Espelhar o `cliente-documentos`, que é privado,
   e **não** o `imobiliaria-docs`, que está público.
5. Completou, o Fábio é avisado. No HUB ele vê a lista e abre cada arquivo por
   **URL assinada de poucos minutos**, nunca link público.
6. **Retenção: 90 dias após o plano entrar em vigor**, decidido em 20/09/2026.
   Margem para pendência, correção ou recusa da operadora, e então um cron
   apaga sozinho. O Fábio é intermediário, não arquivo morto.

**Texto de consentimento** curto na página: quem é o controlador, para que serve,
que vai para a Unimed Sorocaba e por quanto tempo fica.

**Pendência com a Favorita, antes de construir:** a declaração de saúde passa
pelo corretor ou o beneficiário preenche direto com a operadora na entrevista
médica? Em muita operadora ela não passa pelo corretor justamente para o
corretor não ver informação de saúde. Se não passar, some a parte mais sensível
do problema e o item 4 fica mais simples.

**Achado separado, não é deste módulo mas precisa entrar na fila:** o bucket
`imobiliaria-docs` está com `public: true`. Contratos e fotos de vistoria abrem
para qualquer pessoa que tenha a URL, sem autenticação. Trocar para privado e
servir por URL assinada, como já é feito em `cliente-documentos`.
