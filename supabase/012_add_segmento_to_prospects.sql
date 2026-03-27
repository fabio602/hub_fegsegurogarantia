-- Prospecção (Kanban) - adicionar campo de segmento ao lead
-- Rode no SQL Editor do Supabase antes do frontend.

begin;

alter table public.prospects
  add column if not exists segmento text;

comment on column public.prospects.segmento is
  'Segmento do lead na prospecção (ex.: Advogado, Indústria, Consultoria, Energia, Distribuidora).';

commit;
