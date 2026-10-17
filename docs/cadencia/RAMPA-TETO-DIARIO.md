# Rampa do teto diário da cadência

Combinado com o Fábio em 16/10/2026, depois dos 12 dias em que o cron
`cadencia-emails-daily` abortou (ver PR #24). O teto existe para o domínio não
levar uma rajada de 723 e-mails de uma vez, contra um pico histórico de 120.

## A rampa

| A partir de | Teto | Condição para subir |
| --- | --- | --- |
| 19/10/2026 (seg) | **50/dia** | — é o ponto de partida |
| 26/10/2026 (seg) | 100/dia | bounce e reclamações de spam da semana de 19 a 23/10 normais |
| 02/11/2026 (seg) | 150/dia | bounce e reclamações da semana de 26 a 30/10 normais |

**Cada subida é uma decisão, não um agendamento.** Não há cron que mexa no
teto: se a semana anterior veio ruim, não sobe, e não há nada para desfazer.

Como subir (e como voltar atrás):

```sql
update reputacao_envio set limite_diario_envios = 100;  -- ou 150, ou 50
```

Sem deploy. O valor vale na próxima rodada do cron, 09:00 BRT.

## O que é "normal"

Dois limites, e o que manda é o mais apertado dos dois — que é o do Resend:

| Métrica | Limite do Resend | Trava do HUB |
| --- | --- | --- |
| Bounce | menos de 4% | **3%** (`bounce_max_percentual`) |
| Reclamação de spam | menos de 0,08% | não tem trava própria |

`bounce_max_percentual` foi de 15 para **3** em 16/10/2026, por decisão do
Fábio, para ficar abaixo do limite de 4% do Resend em vez de quase 4x acima
dele. A trava de reclamação de spam ficou para outro dia: hoje reclamação só
entra na trava somada aos bounces, sem limite próprio, e 0,08% é apertado
demais para o gatilho absoluto de 5 enxergar.

O valor mora em `reputacao_envio` e é editável na tela Garimpo Automático, sem
deploy. Este documento registra a intenção; a fonte da verdade é o banco.

### O que 3% custa em pausas

A trava pausa **toda** a prospecção automática (PNCP, garimpo e cadência) se
qualquer um dos dois gatilhos estourar, e sai da pausa só à mão:

- **absoluto:** `bounces >= bounce_min_quantidade` (5), em qualquer volume;
- **percentual:** `envios >= envios_minimos_avaliacao` (20) **e** taxa do dia
  acima de `bounce_max_percentual` (3%).

O percentual é medido **no dia**, sobre o volume do dia. Com o teto em 50, 3%
são 1,5 e-mails: **2 bounces num dia já pausam tudo.** Isso é mais rígido que
o limite do Resend, que é a taxa da conta ao longo do tempo, não a de um dia.

Medido nos 26 dias com bounce entre 03/09 e 16/10/2026: 3 dias já pausariam
pelo gatilho absoluto (5 bounces) e **outros 7 passariam a pausar** por causa
do 3%. Em volume de 50/dia o aperto é maior, porque qualquer dia com 2 bounces
estoura — e 17 dos 26 tiveram 2 ou mais.

Ou seja: espere pausas com alguma frequência, talvez semanais. Pausa não é
perda de dado, é a automação parada até alguém religar na tela. Se virar
incômodo, o ajuste certo **não** é afrouxar o 3%, e sim subir
`envios_minimos_avaliacao` de 20 para ~100, para o gatilho percentual só opinar
com amostra que significa algo e deixar o gatilho absoluto cobrir o volume
pequeno. Não foi feito.

0,08% de reclamação é pouca coisa: em 250 e-mails na semana, **uma** reclamação
já passa do limite. Reclamação pesa muito mais que bounce.

## Onde ver os dois números

### 1. Resend, aba Metrics (é a fonte autoritativa)

O gráfico de barras de Bounces e Complaints, com indicador de risco, e filtro
por domínio e por período. É o único lugar que **separa** bounce de reclamação
de spam e que mostra a semana fechada.

### 2. HUB, tela Garimpo Automático — com ressalva séria

Garantia → Prospecção → **Garimpo Automático**. O cartão mostra
"bounces hoje (N%)".

Três limitações que importam para esta decisão:

- **Junta bounce e reclamação num número só** (conta
  `resend_status in ('bounced_permanent','complained')`). Não dá para aplicar
  os dois limites separados olhando só para ali.
- **É só o dia, não a semana.**
- **Para lead do PNCP, filtra pela data do 1º e-mail, não pela data do
  bounce.** Um bounce de hoje num lead cujo E1 saiu há três dias não aparece
  no número de hoje. Como a rampa governa justamente o E2 ao E5, boa parte do
  que interessa fica invisível nesse cartão. (A metade do garimpo conta certo,
  por `atualizado_em`.)

Ou seja: serve para um olhar rápido no dia, não para decidir a rampa.

### 3. SQL, para a semana fechada e separando os dois

O registro confiável é `email_cadencia`: o webhook do Resend sempre grava
`bounce_status` e `bounce_em` ali, com a data do evento.

```sql
-- Semana de 19 a 23/10, por tipo de evento
select bounce_status, count(*) as eventos
  from email_cadencia
 where bounce_em >= '2026-10-19' and bounce_em < '2026-10-24'
 group by bounce_status;

-- Denominador: quanto saiu na mesma semana
select count(*) as enviados
  from email_envios
 where enviado_em >= '2026-10-19' and enviado_em < '2026-10-24';
```

`bounce_status` vem com `bounced_permanent`, `complained` ou
`delivery_delayed`. Para a rampa interessam os dois primeiros, separados.

Não existe tela no HUB com esse corte semanal. Se a rampa virar rotina, vale
fazer uma.

## O que o teto não resolve

Medido em 16/10/2026: entram ~34,9 contatos novos por dia, e cada um recebe 4
e-mails (E2 a E5) pelo cron. A demanda de regime é **~140 e-mails/dia**.

| Origem | Contatos/dia | E-mails/dia que gera | Automático? |
| --- | --- | --- | --- |
| `pncp_auto` | 23,3 | 93 | não — depende do clique no e-mail da licitação |
| garimpo (3 fontes) | 11,6 | 46 | sim |

Com o garimpo sozinho a demanda é 46/dia. **Com teto de 50 a fila fica
congelada, não drena.** Os 1.468 e-mails vencidos que sobraram depois do corte
dos contatos frios só começam a diminuir de verdade acima de ~150/dia. Subir a
rampa é o que faz a fila andar; o teto de 50 só impede a rajada.

## Duas coisas que ficam de fora do teto, de propósito

- **O e-mail da licitação** (`licitacao_enviar`). É ação humana, um lead por
  vez, com prévia conferida. Decisão do Fábio em 16/10. Consequência: o volume
  real do dia é o teto do cron **mais** o que ele mandar à mão. Se um dia o
  teto precisar valer como total de verdade, o caminho é o `licitacao_enviar`
  também consultá-lo e avisar na tela quando estourar.
- **Os modos `preview` e `teste`** da `prospecting-cadence`, que nunca
  contaram para trava nenhuma.

## Como o teto se comporta

- Lido de `reputacao_envio.limite_diario_envios` em toda rodada.
- Conta **todos** os envios gravados em `email_envios` no dia (BRT), inclusive
  os manuais. Se o teto já foi atingido quando o cron roda, ele manda zero.
- Ordem de atendimento: `data_inicio` mais recente primeiro. Com fila
  acumulada, quem entrou ontem é servido antes de quem entrou há três semanas.
- A execução registra `teto_diario`, `ja_enviados_hoje` e
  `nao_couberam_no_teto` em `email_cadencia_execucoes`, então dá para ver a
  fila sem consulta à mão.
