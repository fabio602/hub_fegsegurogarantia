-- 083_unimed_saude.sql
-- Segunda linha de negocio da F&G: planos de saude Unimed Sorocaba (PME).
-- Produto: UNIPART MAX (A enfermaria / B apartamento) e UNIPART FACIL (A enfermaria).
-- Fonte dos valores: "Tabela UNIPART - 09.2026" (Favorita Brasil), vigencia a partir de 18.05.2026.
-- Migracao ADITIVA: nao altera nenhuma tabela existente.

-- ---------------------------------------------------------------------------
-- 1. Tabela de precos por faixa etaria
-- ---------------------------------------------------------------------------
create table if not exists unimed_precos (
  id            uuid primary key default gen_random_uuid(),
  tabela        text not null check (tabela in ('1_vida', '2_a_29_vidas')),
  plano         text not null check (plano in ('max_a', 'max_b', 'facil')),
  faixa         text not null,
  faixa_ordem   smallint not null,
  idade_min     smallint not null,
  idade_max     smallint not null,
  valor         numeric(10,2) not null,
  vigencia      date not null default date '2026-05-18',
  created_at    timestamptz not null default now(),
  unique (tabela, plano, faixa, vigencia)
);

comment on table unimed_precos is
  'Precos UNIPART por faixa etaria, SEM beneficios adicionais. Adicionais ficam em unimed_adicionais.';

-- ---------------------------------------------------------------------------
-- 2. Beneficios adicionais (valor por vida)
-- ---------------------------------------------------------------------------
create table if not exists unimed_adicionais (
  codigo        text primary key,
  nome          text not null,
  valor         numeric(10,2) not null,
  valor_alt     numeric(10,2),
  regra_alt     text,
  descricao     text,
  padrao        boolean not null default false,
  vigencia      date not null default date '2026-05-18'
);

comment on column unimed_adicionais.valor_alt is
  'Valor alternativo quando a regra em regra_alt se aplica (ex.: APH acima de 200 vidas).';

-- ---------------------------------------------------------------------------
-- 3. Leads da linha saude (funil proprio, nao mistura com prospects)
-- ---------------------------------------------------------------------------
create table if not exists unimed_leads (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- empresa
  empresa             text not null,
  cnpj                text,
  cidade              text,
  uf                  text default 'SP',
  cnae_principal      text,
  porte               text,
  site                text,

  -- contato
  contato             text,
  cargo               text,
  email               text,
  telefone            text,

  -- qualificacao
  vidas               smallint,
  tem_plano_atual     boolean,
  operadora_atual     text,
  valor_atual         numeric(12,2),
  mes_renovacao       smallint check (mes_renovacao between 1 and 12),
  plano_interesse     text check (plano_interesse in ('max_a', 'max_b', 'facil')),

  -- funil
  status              text not null default 'Novo',
  status_entered_at   timestamptz not null default now(),
  origem              text,
  proxima_acao        date,
  observacoes         text,
  motivo_perda        text,

  -- fechamento
  vigencia_prevista   date,
  vidas_implantadas   smallint,
  valor_mensal        numeric(12,2),
  implantado_em       date,

  constraint unimed_leads_status_ck check (status in (
    'Novo',
    'Contato feito',
    'Cotacao enviada',
    'Documentacao',
    'Entrevista medica',
    'Implantado',
    'Perdido'
  ))
);

create unique index if not exists unimed_leads_cnpj_uk
  on unimed_leads (cnpj) where cnpj is not null;
create index if not exists unimed_leads_status_ix on unimed_leads (status);
create index if not exists unimed_leads_cidade_ix on unimed_leads (cidade);

-- updated_at automatico
create or replace function unimed_leads_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists unimed_leads_touch_trg on unimed_leads;
create trigger unimed_leads_touch_trg
  before update on unimed_leads
  for each row execute function unimed_leads_touch();

-- ---------------------------------------------------------------------------
-- 4. Cotacoes geradas para um lead
-- ---------------------------------------------------------------------------
create table if not exists unimed_cotacoes (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references unimed_leads(id) on delete cascade,
  created_at    timestamptz not null default now(),
  plano         text not null check (plano in ('max_a', 'max_b', 'facil')),
  composicao    jsonb not null,           -- {"0 a 18": 2, "29 a 33": 4, ...}
  adicionais    text[] not null default '{}',
  vidas_total   smallint not null,
  tabela        text not null,
  total_mensal  numeric(12,2) not null,
  detalhe       jsonb,
  observacao    text
);

create index if not exists unimed_cotacoes_lead_ix on unimed_cotacoes (lead_id);

-- ---------------------------------------------------------------------------
-- 5. RLS no mesmo padrao das demais tabelas do HUB
-- ---------------------------------------------------------------------------
alter table unimed_precos     enable row level security;
alter table unimed_adicionais enable row level security;
alter table unimed_leads      enable row level security;
alter table unimed_cotacoes   enable row level security;

drop policy if exists unimed_precos_auth on unimed_precos;
create policy unimed_precos_auth on unimed_precos
  for all to authenticated using (true) with check (true);

drop policy if exists unimed_adicionais_auth on unimed_adicionais;
create policy unimed_adicionais_auth on unimed_adicionais
  for all to authenticated using (true) with check (true);

drop policy if exists unimed_leads_auth on unimed_leads;
create policy unimed_leads_auth on unimed_leads
  for all to authenticated using (true) with check (true);

drop policy if exists unimed_cotacoes_auth on unimed_cotacoes;
create policy unimed_cotacoes_auth on unimed_cotacoes
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6. Carga: precos UNIPART, vigencia 18.05.2026
-- ---------------------------------------------------------------------------
insert into unimed_precos (tabela, plano, faixa, faixa_ordem, idade_min, idade_max, valor) values
-- TABELA PME - 1 VIDA
('1_vida','max_a','0 a 18',1,0,18,244.91),
('1_vida','max_a','19 a 23',2,19,23,293.89),
('1_vida','max_a','24 a 28',3,24,28,352.67),
('1_vida','max_a','29 a 33',4,29,33,423.20),
('1_vida','max_a','34 a 38',5,34,38,507.84),
('1_vida','max_a','39 a 43',6,39,43,609.41),
('1_vida','max_a','44 a 48',7,44,48,731.29),
('1_vida','max_a','49 a 53',8,49,53,914.11),
('1_vida','max_a','54 a 58',9,54,58,1042.09),
('1_vida','max_a','59 ou +',10,59,200,1417.25),
('1_vida','max_b','0 a 18',1,0,18,319.44),
('1_vida','max_b','19 a 23',2,19,23,383.33),
('1_vida','max_b','24 a 28',3,24,28,460.00),
('1_vida','max_b','29 a 33',4,29,33,551.99),
('1_vida','max_b','34 a 38',5,34,38,662.39),
('1_vida','max_b','39 a 43',6,39,43,794.87),
('1_vida','max_b','44 a 48',7,44,48,953.84),
('1_vida','max_b','49 a 53',8,49,53,1192.31),
('1_vida','max_b','54 a 58',9,54,58,1359.23),
('1_vida','max_b','59 ou +',10,59,200,1848.54),
('1_vida','facil','0 a 18',1,0,18,167.22),
('1_vida','facil','19 a 23',2,19,23,200.66),
('1_vida','facil','24 a 28',3,24,28,240.79),
('1_vida','facil','29 a 33',4,29,33,288.95),
('1_vida','facil','34 a 38',5,34,38,346.73),
('1_vida','facil','39 a 43',6,39,43,416.09),
('1_vida','facil','44 a 48',7,44,48,499.30),
('1_vida','facil','49 a 53',8,49,53,624.13),
('1_vida','facil','54 a 58',9,54,58,711.51),
('1_vida','facil','59 ou +',10,59,200,967.65),
-- TABELA PME - 2 A 29 VIDAS
('2_a_29_vidas','max_a','0 a 18',1,0,18,224.50),
('2_a_29_vidas','max_a','19 a 23',2,19,23,269.40),
('2_a_29_vidas','max_a','24 a 28',3,24,28,323.28),
('2_a_29_vidas','max_a','29 a 33',4,29,33,387.94),
('2_a_29_vidas','max_a','34 a 38',5,34,38,465.52),
('2_a_29_vidas','max_a','39 a 43',6,39,43,558.62),
('2_a_29_vidas','max_a','44 a 48',7,44,48,670.35),
('2_a_29_vidas','max_a','49 a 53',8,49,53,837.94),
('2_a_29_vidas','max_a','54 a 58',9,54,58,955.25),
('2_a_29_vidas','max_a','59 ou +',10,59,200,1299.14),
('2_a_29_vidas','max_b','0 a 18',1,0,18,292.82),
('2_a_29_vidas','max_b','19 a 23',2,19,23,351.38),
('2_a_29_vidas','max_b','24 a 28',3,24,28,421.66),
('2_a_29_vidas','max_b','29 a 33',4,29,33,505.99),
('2_a_29_vidas','max_b','34 a 38',5,34,38,607.19),
('2_a_29_vidas','max_b','39 a 43',6,39,43,728.63),
('2_a_29_vidas','max_b','44 a 48',7,44,48,874.36),
('2_a_29_vidas','max_b','49 a 53',8,49,53,1092.95),
('2_a_29_vidas','max_b','54 a 58',9,54,58,1245.96),
('2_a_29_vidas','max_b','59 ou +',10,59,200,1694.50),
('2_a_29_vidas','facil','0 a 18',1,0,18,152.02),
('2_a_29_vidas','facil','19 a 23',2,19,23,182.42),
('2_a_29_vidas','facil','24 a 28',3,24,28,218.90),
('2_a_29_vidas','facil','29 a 33',4,29,33,262.68),
('2_a_29_vidas','facil','34 a 38',5,34,38,315.21),
('2_a_29_vidas','facil','39 a 43',6,39,43,378.26),
('2_a_29_vidas','facil','44 a 48',7,44,48,453.91),
('2_a_29_vidas','facil','49 a 53',8,49,53,567.39),
('2_a_29_vidas','facil','54 a 58',9,54,58,646.83),
('2_a_29_vidas','facil','59 ou +',10,59,200,879.68)
on conflict (tabela, plano, faixa, vigencia) do update set valor = excluded.valor;

-- ---------------------------------------------------------------------------
-- 7. Carga: beneficios adicionais
-- ---------------------------------------------------------------------------
insert into unimed_adicionais (codigo, nome, valor, valor_alt, regra_alt, descricao, padrao) values
('aph','Atendimento Pre-Hospitalar (APH)',8.38,4.80,'vidas > 200',
 'Atendimento 24h por telefone e envio de ambulancia. Ambulancia busca o beneficiario apenas em Sorocaba, Votorantim e Aracoiaba da Serra.', true),
('bf','Beneficio Familia (BF)',5.74,null,null,
 'Em caso de falecimento do titular, a familia mantem o plano por 2 anos sem mensalidade e sem carencia (remissao).', true),
('funeral','Garantia Funeral',11.67,null,null,
 'Indenizacao de ate R$ 10.000,00 para despesas de funeral. Contratacao individual disponivel ate 70 anos.', false),
('odonto','Plano Odontologico Uniodonto',24.90,null,null,
 'Produto odontologico adicional, abrangencia nacional, registro ANS 701.833/99-9, carencia de 1 dia.', false)
on conflict (codigo) do update set
  valor = excluded.valor, valor_alt = excluded.valor_alt,
  regra_alt = excluded.regra_alt, descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- 8. Calculo de cotacao no banco (uma fonte de verdade para HUB e site)
-- ---------------------------------------------------------------------------
create or replace function unimed_calcular_cotacao(
  p_plano      text,
  p_composicao jsonb,            -- {"0 a 18": 2, "34 a 38": 3}
  p_adicionais text[] default '{}'
) returns jsonb
language plpgsql stable as $$
declare
  v_vidas    int := 0;
  v_tabela   text;
  v_base     numeric(12,2) := 0;
  v_adic     numeric(12,2) := 0;
  v_linhas   jsonb := '[]'::jsonb;
  r          record;
  a          record;
begin
  if p_plano not in ('max_a','max_b','facil') then
    raise exception 'plano invalido: %', p_plano;
  end if;

  select coalesce(sum((value)::int), 0) into v_vidas
  from jsonb_each_text(p_composicao);

  if v_vidas < 1 then
    raise exception 'informe ao menos uma vida';
  end if;
  if v_vidas > 29 then
    raise exception 'acima de 29 vidas a cotacao passa por Reserva de Mercado e Carta de Nomeacao; use o formulario PJ';
  end if;

  v_tabela := case when v_vidas = 1 then '1_vida' else '2_a_29_vidas' end;

  for r in
    select c.key as faixa, (c.value)::int as qtd, p.valor, p.faixa_ordem
    from jsonb_each_text(p_composicao) c
    join unimed_precos p
      on p.faixa = c.key and p.plano = p_plano and p.tabela = v_tabela
    where (c.value)::int > 0
    order by p.faixa_ordem
  loop
    v_base := v_base + (r.valor * r.qtd);
    v_linhas := v_linhas || jsonb_build_object(
      'faixa', r.faixa, 'vidas', r.qtd,
      'valor_unitario', r.valor, 'subtotal', round(r.valor * r.qtd, 2)
    );
  end loop;

  for a in
    select codigo, nome,
           case when regra_alt = 'vidas > 200' and v_vidas > 200 then valor_alt else valor end as v
    from unimed_adicionais
    where codigo = any(p_adicionais)
  loop
    v_adic := v_adic + (a.v * v_vidas);
  end loop;

  return jsonb_build_object(
    'plano', p_plano,
    'tabela', v_tabela,
    'vidas', v_vidas,
    'linhas', v_linhas,
    'subtotal_base', round(v_base, 2),
    'subtotal_adicionais', round(v_adic, 2),
    'total_mensal', round(v_base + v_adic, 2),
    'observacao', 'Valores sem beneficios adicionais na base. Coparticipacao cobrada a parte, conforme uso.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Trilha de e-mail saude-pme (motor de trilhas ja existente)
-- ---------------------------------------------------------------------------
insert into email_trilhas (slug, nome, descricao, eyebrow, rodape, ativo, ordem) values (
  'saude-pme',
  'Plano de Saude PME Unimed Sorocaba',
  'Empresas de 2 a 29 vidas em Sorocaba, Boituva, Porto Feliz e demais cidades da area Unimed Sorocaba.',
  'Plano de Saude Empresarial',
  'Voce recebe este e-mail por ser responsavel por uma empresa na regiao de Sorocaba',
  true,
  8
) on conflict (slug) do update set
  nome = excluded.nome, descricao = excluded.descricao,
  eyebrow = excluded.eyebrow, rodape = excluded.rodape, ordem = excluded.ordem;
