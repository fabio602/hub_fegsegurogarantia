-- 143: análise S8 aprovada vira solicitação de contratação (11/11/2026, decisão do Fábio).
--
-- Na análise aprovada o portal mostra "Contratar a garantia com a F&G". A
-- Edge Function s8-analise (ação contratar) cria a linha em
-- imobiliaria_clientes com status_garantia 'aprovado', intencao 'contratar' e
-- kanban_status 'solicitado', no fluxo que a imobiliária já usa (Minhas
-- Solicitações), e avisa o Fábio. A ativação continua com a F&G.
--
-- contratacao_solicitada_em é gravado antes de criar a solicitação, numa
-- atualização condicional, para dois cliques não gerarem duas solicitações.

alter table public.s8_analises
  add column if not exists imobiliaria_cliente_id uuid,
  add column if not exists contratacao_solicitada_em timestamptz;

-- Aplicada no banco em 11/11/2026.
