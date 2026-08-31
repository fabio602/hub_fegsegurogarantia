-- 045 — Revisão dos filtros da campanha Consultores (garimpo)
--
-- A lista de 31/08/2026 saiu ruim: maioria órgão público (EMOP-RJ, CAU/RJ,
-- CEPERJ, InvestSP), advocacia genérica ou fora do ramo. Três mudanças:
--
-- 1. `palavras_inclusao` (coluna nova): regra POSITIVA por campanha. Quando
--    preenchida, a Edge Function `garimpo` só aprova lead que mencione algum
--    dos termos no nome, categoria do Maps ou texto do site; o resto vai para
--    Descartados. É o que elimina advocacia/contabilidade genérica de uma vez,
--    sem regra caso a caso (as antigas regras condicionais "X sem menção a Y"
--    da campanha ficaram redundantes e saem daqui).
--
-- 2. `palavras_exclusao` reforçada com as categorias do Maps que dominavam a
--    lista (repartição pública, fundação, associação, consultor financeiro,
--    consórcios, contábil...) e com corretoras de seguros — concorrente não é
--    parceiro. Órgão público por nome/endereço e e-mail .gov/.leg/.jus/.mp
--    são exclusão dura no CÓDIGO da function (valem para toda campanha Maps).
--
-- 3. Ordenação do envio (no código): termo da campanha no próprio nome vem
--    primeiro, depois e-mail direto, depois site próprio e só então
--    avaliações do Maps — que favoreciam órgão público e escritório grande.

alter table public.campanhas_garimpo
  add column if not exists palavras_inclusao text[];

comment on column public.campanhas_garimpo.palavras_inclusao is
  'Regra positiva: se preenchida, só aprova lead que mencione algum termo no nome, categoria ou site. Primeiro termo aparece no motivo do descarte.';

update public.campanhas_garimpo
set
  palavras_inclusao = array['licitação', 'licitações', 'pregão'],
  palavras_exclusao = array[
    -- fora do ramo / genéricos (mantidos da lista original)
    'treinamento', 'curso', 'software',
    -- poder público e entidades (complementa a exclusão dura do código)
    'órgão público', 'prefeitura', 'câmara municipal', 'governo do estado',
    'conselho', 'fundação', 'companhia de desenvolvimento', 'autarquia',
    'sindicato', 'federação', 'repartição pública', 'escritório do governo',
    'associação',
    -- categorias do Maps que dominavam a lista de 31/08/2026
    'loja de informática', 'consultor financeiro', 'corretor de valores',
    'administração de consórcios', 'serviços administrativos', 'assessoria contábil',
    -- concorrentes
    'corretora de seguros', 'corretor de seguros', 'seguro garantia'
  ],
  updated_at = now()
where slug = 'consultores';
