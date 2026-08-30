-- ============================================================================
-- 041: Campanha Energia (fonte CCEE) no motor de garimpo
--
-- Quarta automacao de prospeccao: consumidores livres e especiais da CCEE
-- entram na trilha 'energia' (5 por dia). A fonte nao e o Google Maps:
--   - Lista: dataset lista_perfil_v1 em dadosabertos.ccee.org.br (CKAN,
--     sem cadastro, CC-BY-4.0). Campos: CNPJ, NOME_EMPRESARIAL,
--     CLASSE_PERFIL_AGENTE, STATUS_PERFIL, CATEGORIA_AGENTE, SUBMERCADO.
--   - O WAF da CCEE bloqueia qualquer cliente que nao seja navegador real
--     (fingerprint TLS); a coleta usa o Apify (actor apify/web-scraper), que
--     abre o portal num Chrome e chama a API datastore da propria origem.
--   - Filtro: classe em (Consumidor Livre, Consumidor Especial) + STATUS
--     ATIVO + CATEGORIA 'Consumo' (exclui geradoras/comercializadoras/
--     distribuidoras/transmissoras, que tem perfis de consumidor tambem).
--   - Diff semanal: CNPJ novo na lista = aderiu agora = prioridade maxima.
--     Na primeira carga, o recurso de 2025 faz o papel de "semana anterior".
--   - Estoque antigo prioriza CNAE (industria 10-33, depois atacado e
--     logistica 46/49-53, depois servicos) e Consumidor Especial antes de
--     Consumidor Livre.
--   - [GANCHO_ADESAO]: paragrafo condicional no e-mail 1 da trilha energia,
--     renderizado so para leads novos (vazio para antigos e cadastro manual).
-- ============================================================================

-- Fonte nova no motor.
alter table public.campanhas_garimpo drop constraint if exists campanhas_garimpo_fonte_check;
alter table public.campanhas_garimpo
  add constraint campanhas_garimpo_fonte_check check (fonte in ('maps', 'instagram', 'ccee'));

alter table public.campanhas_garimpo
  add column if not exists gancho_adesao_texto text,
  add column if not exists fonte_config jsonb not null default '{}';

comment on column public.campanhas_garimpo.gancho_adesao_texto is
  'Paragrafo do [GANCHO_ADESAO]: entra no e-mail 1 apenas para leads marcados como novos no diff da fonte.';
comment on column public.campanhas_garimpo.fonte_config is
  'Configuracao especifica da fonte. Para ccee: recurso_atual, recurso_anterior (ids CKAN) e diff_inicial_feito.';

-- Estoque: campos da fonte CCEE e estagio intermediario de cadastro.
alter table public.garimpo_estoque
  add column if not exists classe text,
  add column if not exists submercado text,
  add column if not exists cnae_divisao text,
  add column if not exists lote_diff text,
  add column if not exists primeira_vista timestamptz not null default now();

alter table public.garimpo_estoque drop constraint if exists garimpo_estoque_estado_check;
alter table public.garimpo_estoque add constraint garimpo_estoque_estado_check
  check (estado in ('novo', 'cadastrado', 'enriquecido', 'enviado', 'so_whatsapp', 'descartado', 'bounce'));

comment on column public.garimpo_estoque.lote_diff is
  'novo = CNPJ que nao existia na lista anterior da fonte (aderiu agora); antigo = ja constava.';
comment on column public.garimpo_estoque.classe is
  'CCEE: Consumidor Livre ou Consumidor Especial.';

-- Gancho condicional por contato da cadencia.
alter table public.email_cadencia
  add column if not exists gancho_adesao text;

comment on column public.email_cadencia.gancho_adesao is
  'Texto do [GANCHO_ADESAO] deste contato. Vazio ou nulo renderiza nada (padrao para cadastro manual).';

-- Campanha Energia.
insert into public.campanhas_garimpo
  (slug, nome, fonte, termos_busca, cidades, palavras_exclusao, trilha, tipo_prospect,
   limite_diario, cadencia_garimpo_dias, exigir_cnpj, gancho_adesao_texto, fonte_config)
values
  ('energia',
   'Energia',
   'ccee',
   '{}', '{}', '{}',
   'energia',
   'Energia',
   5,
   7,
   false,
   'Vi que a [NOME_EMPRESA] passou a operar no mercado livre de energia recentemente. É nessa fase que as comercializadoras pedem garantia financeira para fechar o contrato, e a fiança bancária costuma ser o primeiro caminho oferecido, mesmo sendo o mais caro.',
   '{"recurso_atual": "c140a86b-f41e-45e6-9380-ec78b15492fd", "recurso_anterior": "6a2fce01-4e40-472a-a0d9-4ff6e8130a3b", "diff_inicial_feito": false}'::jsonb)
on conflict (slug) do nothing;

-- [GANCHO_ADESAO] no inicio do e-mail 1 da trilha energia.
update email_trilha_etapas
set corpo_html = '[GANCHO_ADESAO]' || corpo_html
where trilha = 'energia' and ordem = 1
  and corpo_html not like '[GANCHO_ADESAO]%';
