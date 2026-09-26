-- 074_pncp_monitor_homologacao.sql
--
-- Muda o momento em que a prospeccao do PNCP entra na vida do cliente.
--
-- Como era: a coleta lia /api/consulta/v1/contratos, ou seja, contrato ja
-- assinado e publicado. Medindo 50 contratos publicados em 01/09/2026, a
-- mediana entre a assinatura e a publicacao no PNCP foi de 11 dias, com casos
-- de 204. Como a garantia contratual e exigida para assinar, quando o contrato
-- aparecia na busca a apolice ja tinha sido entregue por outra corretora. A
-- prospeccao chegava depois da venda, sempre.
--
-- Como fica: acompanha a licitacao desde a publicacao do edital e dispara no
-- dia da HOMOLOGACAO, que e quando o vencedor e conhecido e ainda falta
-- apresentar a garantia para assinar. Em um caso real conferido na API, um
-- pregao publicado em 20/07 teve resultado em 27/08.
--
-- Duas engrenagens, as duas apoiadas nesta tabela:
--   1. uma varredura diaria da busca textual do portal (/api/search/) cruzando
--      os termos de objeto com as UFs, que insere as licitacoes novas aqui;
--   2. um tique frequente que sonda os itens dessas licitacoes e, quando a
--      situacao vira Homologado, le o vencedor em
--      .../itens/{n}/resultados e joga na fila que ja existe.
--
-- O resto do pipeline nao muda: enriquecimento por CNPJ, cache, deduplicacao
-- contra prospects/sales/leads, blocklist, Kanban, trilha de e-mail, XLSX e
-- guarda de bounce continuam iguais.

-- ── Licitacoes em acompanhamento ────────────────────────────────────────────
-- Uma linha por licitacao vigiada. O estado fica no banco, e nao na memoria da
-- funcao, porque o PNCP responde 429 (limite de requisicoes excedido) quando a
-- sondagem acelera. Assim cada tique gasta um orcamento de chamadas e o
-- seguinte retoma de onde parou.
create table if not exists public.pncp_monitor (
  id                   bigserial primary key,
  numero_controle_pncp text        not null unique,
  orgao_cnpj           text        not null,
  orgao_nome           text,
  ano                  integer     not null,
  sequencial           integer     not null,
  uf                   text,
  municipio            text,
  modalidade_id        integer,
  modalidade_nome      text,
  objeto               text,
  -- Quais termos de objeto casaram. Guardado para dar para medir qual termo
  -- traz lead que fecha e qual so traz volume.
  termos               text[]      not null default '{}',
  valor_estimado       numeric,
  data_publicacao      date,
  situacao             text,

  -- Sondagem
  checado_em           timestamptz,
  checagens            integer     not null default 0,
  erro_ultimo          text,

  -- Homologacao
  homologado           boolean     not null default false,
  homologado_em        date,                  -- dataResultado do PNCP
  valor_homologado     numeric,               -- soma do valorTotalHomologado
  vencedor_cnpj        text,
  vencedor_nome        text,
  vencedor_porte       text,                  -- porteFornecedorNome
  material_ou_servico  text,                  -- M ou S, so informativo

  -- Ciclo de vida
  prioritario          boolean     not null default false,
  enfileirado          boolean     not null default false,
  descartado_em        timestamptz,
  descartado_motivo    text,
  created_at           timestamptz not null default now()
);

-- Fila da sondagem: pega o que ainda nao homologou nem foi descartado, mais
-- antigo checado primeiro.
create index if not exists pncp_monitor_sondagem_idx
  on public.pncp_monitor (checado_em nulls first)
  where homologado = false and descartado_em is null;

-- Fila de quem homologou e ainda nao entrou na fila de enriquecimento.
create index if not exists pncp_monitor_pendente_idx
  on public.pncp_monitor (prioritario desc, valor_homologado desc)
  where homologado = true and enfileirado = false and descartado_em is null;

create index if not exists pncp_monitor_vencedor_idx
  on public.pncp_monitor (vencedor_cnpj)
  where vencedor_cnpj is not null;

alter table public.pncp_monitor enable row level security;

drop policy if exists "authenticated_pncp_monitor_all" on public.pncp_monitor;
create policy "authenticated_pncp_monitor_all"
  on public.pncp_monitor for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ── Config ──────────────────────────────────────────────────────────────────

-- Os objetos que costumam exigir garantia contratual. Substitui o filtro por
-- divisao CNAE como criterio principal: o CNAE confundia "execucao de obra"
-- com "fornecimento de tubos para obra", porque as duas empresas podem estar
-- na mesma divisao. O objeto da licitacao separa as duas.
--
-- Tentei antes usar o catalogo do PNCP, que seria o caminho mais limpo, e nao
-- da: em 71 itens conferidos na API, itemCategoriaNome veio "Nao se aplica" em
-- 100% dos casos e catalogo, catalogoCodigoItem e ncmNbsCodigo vieram nulos.
-- Os orgaos nao amarram o item ao CATMAT/CATSER na hora de publicar.
alter table public.prospeccao_pncp_config
  add column if not exists termos_objeto text[] not null default array[
    'obra', 'reforma', 'constru', 'amplia', 'pavimenta', 'recapea',
    'drenagem', 'saneamento', 'edifica', 'engenharia', 'manuten',
    'limpeza', 'resíduo', 'vigil', 'segurança patrimonial', 'conserva',
    'mão de obra', 'transporte escolar', 'ilumina',
    'fornecimento e instala', 'prestação de servi', 'ar condicionado',
    'evento', 'show', 'medicamento'
  ]::text[];

-- Segunda faixa de valor. Acima dela o lead entra na frente da fila, porque a
-- garantia de um contrato de 5 milhoes paga muito mais do que a de um de 1.
alter table public.prospeccao_pncp_config
  add column if not exists valor_prioritario numeric not null default 2000000;
alter table public.prospeccao_pncp_config
  add column if not exists dispensa_valor_prioritario numeric not null default 5000000;

-- Quanto tempo insistir numa licitacao que nao homologa. Passado o prazo, ela
-- sai da sondagem para nao consumir orcamento de chamadas para sempre.
alter table public.prospeccao_pncp_config
  add column if not exists monitor_validade_dias integer not null default 90;

-- Orcamento de chamadas ao PNCP por tique, por causa do 429.
alter table public.prospeccao_pncp_config
  add column if not exists monitor_max_checagens integer not null default 120;
alter table public.prospeccao_pncp_config
  add column if not exists monitor_pausa_ms integer not null default 350;

-- Piso de valor sobe, porque a lista de termos e bem mais larga do que o
-- filtro de CNAE que ela substitui e o limite diario de envio continua 30.
update public.prospeccao_pncp_config
set valor_minimo = 1000000,
    dispensa_inexig_valor_minimo = 2000000
where id = 1;

-- A lista de divisoes CNAE permitidas deixa de existir: era ela que descartava
-- industria farmaceutica (divisao 21) e produtora de eventos (divisao 90),
-- justamente dois dos objetos que passam a ser procurados. A lista de exclusao
-- continua valendo e segue tirando saude, educacao, restaurante e financeiro.
update public.prospeccao_pncp_config
set cnae_divisoes_incluir = '{}'::text[]
where id = 1;

-- ── Registro de precos (SRP) ────────────────────────────────────────────────
-- Homologar uma ata de registro de precos nao e assinar contrato: o orgao so
-- registra que talvez compre depois, e a garantia so nasce se o contrato for
-- firmado contra a ata. Por isso SRP fica fora da fila por padrao, mas segue
-- gravado no monitor, para poder ser reavaliado sem revarrer o PNCP.
alter table public.pncp_monitor
  add column if not exists srp boolean not null default false;

alter table public.prospeccao_pncp_config
  add column if not exists incluir_srp boolean not null default false;

drop index if exists pncp_monitor_pendente_idx;
create index if not exists pncp_monitor_pendente_idx
  on public.pncp_monitor (prioritario desc, valor_homologado desc)
  where homologado = true and enfileirado = false and descartado_em is null and srp = false;
