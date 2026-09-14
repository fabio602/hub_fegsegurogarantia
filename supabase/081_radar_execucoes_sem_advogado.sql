-- ============================================================================
-- 081: Radar · execucoes fiscais sem advogado constituido
--
-- radar_empresas.qtd_execucoes_sem_advogado: execucoes (classe 1116) com
-- detalhe capturado (orgao julgador ou data de distribuicao preenchidos; as
-- linhas so da listagem nao tem polo) e nenhum advogado no polo passivo.
-- Empresa que ainda nao se defendeu: risco imediato de bloqueio, contato
-- direto. Calculada em radar_consolidar_dossie; recalculada aqui para os
-- dossies ja prontos.
-- ============================================================================

alter table public.radar_empresas
  add column if not exists qtd_execucoes_sem_advogado int not null default 0;

create or replace function public.radar_consolidar_dossie(p_cnpj text)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  v_exec int;
  v_emb  int;
  v_sem_adv int;
begin
  select
    count(*) filter (where classe_codigo = 1116),
    count(*) filter (where classe_codigo = 1118),
    count(*) filter (
      where classe_codigo = 1116
        and (orgao_julgador is not null or data_distribuicao is not null)
        and not exists (
          select 1 from public.radar_processo_advogados a
          where a.processo_id = p.id and a.polo = 'passivo'
        ))
    into v_exec, v_emb, v_sem_adv
  from public.radar_processos p
  where cnpj = p_cnpj;

  update public.radar_empresas
     set qtd_execucoes = v_exec,
         qtd_embargos  = v_emb,
         qtd_execucoes_sem_advogado = v_sem_adv,
         dossie_status = case when (v_exec + v_emb) > 0 then 'pronto' else 'sem_processos' end,
         dossie_em     = now(),
         atualizado_em = now()
   where cnpj = p_cnpj;

  update public.radar_empresas
     set score = public.radar_calcular_score(p_cnpj)
   where cnpj = p_cnpj;
end;
$$;

-- Recalculo dos dossies prontos, sem mexer em dossie_em.
with calc as (
  select p.cnpj,
         count(*) filter (
           where p.classe_codigo = 1116
             and (p.orgao_julgador is not null or p.data_distribuicao is not null)
             and not exists (
               select 1 from public.radar_processo_advogados a
               where a.processo_id = p.id and a.polo = 'passivo'
             ))::int as sem_adv
  from public.radar_processos p
  group by p.cnpj
)
update public.radar_empresas e
   set qtd_execucoes_sem_advogado = c.sem_adv
  from calc c
 where e.cnpj = c.cnpj
   and e.dossie_status = 'pronto';
