-- 121: motivo da estruturação na proposta comercial (Cotações > Gerar Proposta).
-- Quando há honorário, a proposta registra por que a estruturação é necessária;
-- cada motivo gera um parágrafo no PDF (textos em lib/proposta/estruturacao.ts).
-- Só acrescenta colunas: a tabela propostas já tem grants e RLS (migração 117).

alter table public.propostas
    add column if not exists estruturacao_motivos text[] not null default '{}',
    add column if not exists estruturacao_clausula text;

alter table public.propostas drop constraint if exists propostas_estruturacao_motivos_check;
alter table public.propostas add constraint propostas_estruturacao_motivos_check
    check (estruturacao_motivos <@ array['restricao', 'sem_limite', 'aumento_limite', 'limite_tomado', 'clausula_especial']::text[]);

comment on column public.propostas.estruturacao_motivos is
    'Motivos da estruturação marcados na proposta: restricao, sem_limite, aumento_limite, limite_tomado, clausula_especial';
comment on column public.propostas.estruturacao_clausula is
    'Descrição da cláusula fora do padrão (motivo clausula_especial), como sai no PDF';
