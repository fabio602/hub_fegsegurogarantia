-- 120: situação do lead escolhida à mão no Kanban (menu ⋮ do card).
-- O bloco da coluna do vendedor (Para contatar, Em contato, Retomar) é
-- calculado pelos toques em prospect_toques. Quando o vendedor escolhe a
-- situação na mão, ela vale até o próximo toque registrado depois dela.
-- Só colunas novas e opcionais: nada muda para os leads existentes.

alter table public.prospects
    add column if not exists situacao_manual text
        check (situacao_manual in ('contatar', 'aguardando', 'retomar')),
    add column if not exists situacao_manual_em timestamptz;

comment on column public.prospects.situacao_manual is
    'Bloco escolhido à mão no Kanban (contatar, aguardando = Em contato, retomar). Perde efeito quando há toque mais novo que situacao_manual_em.';
