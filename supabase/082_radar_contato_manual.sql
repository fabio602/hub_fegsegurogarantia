-- ============================================================================
-- 082: Radar · telefone e e-mail manuais (nao sobrescritos pelo enriquecimento)
--
-- Aditiva: tres colunas novas em radar_empresas, a view vw_radar_empresas
-- recriada com as MESMAS 28 colunas na mesma ordem mais quatro no fim, e uma
-- RPC nova. Nenhuma funcao existente e alterada. O enriquecimento (Edge
-- Function radar-enrich-cnpj, scripts/radar/enrich_local.py) e a
-- consolidacao escrevem por coluna nomeada e nunca tocam nas colunas manuais.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Colunas
-- ---------------------------------------------------------------------------

alter table public.radar_empresas
  add column if not exists telefone_manual text,
  add column if not exists email_manual text,
  add column if not exists contato_manual_atualizado_em timestamptz;

-- ---------------------------------------------------------------------------
-- View: as 28 colunas atuais na mesma ordem + telefone_manual, email_manual,
-- telefone_efetivo, email_efetivo. security_invoker mantido.
-- ---------------------------------------------------------------------------

create or replace view public.vw_radar_empresas
  with (security_invoker = true) as
  select
    cnpj,
    nome_devedor,
    uf,
    competencia_ultima,
    qtd_inscricoes,
    valor_total,
    data_inscricao_mais_recente,
    tem_garantia,
    receitas,
    score,
    enriquecido_em,
    enriquecimento_erro,
    razao_social,
    nome_fantasia,
    cnae_principal,
    cnae_descricao,
    porte,
    optante_simples,
    optante_mei,
    situacao_cadastral,
    municipio,
    email,
    telefone,
    socios,
    status,
    motivo_exclusao,
    prospect_id,
    atualizado_em,
    telefone_manual,
    email_manual,
    coalesce(telefone_manual, telefone) as telefone_efetivo,
    coalesce(email_manual, email)       as email_efetivo
  from public.radar_empresas
  where status <> 'excluido'
  order by score desc, valor_total desc;

-- ---------------------------------------------------------------------------
-- RPC: grava (ou limpa) o contato manual de uma empresa, campo a campo.
--   p_telefone / p_email:
--     null          = manter o valor manual atual
--     string vazia  = limpar (grava null)
--     outro valor   = validar e gravar
--   telefone so digitos, 10 ou 11; e-mail com o mesmo criterio de
--   inscrever_endosso_novas_apolices. contato_manual_atualizado_em = now() so
--   quando algum dos dois mudou de fato; atualizado_em = now() sempre.
--   security invoker: vale a RLS de radar_empresas (authenticated).
-- ---------------------------------------------------------------------------

create or replace function public.radar_atualizar_contato_manual(
  p_cnpj text,
  p_telefone text,
  p_email text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tel_atual   text;
  v_email_atual text;
  v_tel_novo    text;
  v_email_novo  text;
  v_mudou       boolean;
begin
  select telefone_manual, email_manual
    into v_tel_atual, v_email_atual
    from public.radar_empresas
   where cnpj = p_cnpj;
  if not found then
    raise exception 'empresa % nao encontrada', p_cnpj using errcode = 'P0002';
  end if;

  v_tel_novo := case
    when p_telefone is null then v_tel_atual
    else nullif(regexp_replace(p_telefone, '\D', '', 'g'), '')
  end;
  v_email_novo := case
    when p_email is null then v_email_atual
    else nullif(lower(trim(p_email)), '')
  end;

  if p_telefone is not null and v_tel_novo is not null and length(v_tel_novo) not in (10, 11) then
    raise exception 'telefone invalido: use DDD + numero (10 ou 11 digitos)'
      using errcode = '22023';
  end if;
  if p_email is not null and v_email_novo is not null
     and v_email_novo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'e-mail invalido'
      using errcode = '22023';
  end if;

  v_mudou := (v_tel_novo is distinct from v_tel_atual) or (v_email_novo is distinct from v_email_atual);

  update public.radar_empresas
     set telefone_manual = v_tel_novo,
         email_manual    = v_email_novo,
         contato_manual_atualizado_em = case when v_mudou then now() else contato_manual_atualizado_em end,
         atualizado_em   = now()
   where cnpj = p_cnpj;
end;
$$;

grant execute on function public.radar_atualizar_contato_manual(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback (comentado). A view volta ao SQL capturado em 14/09/2026 antes
-- desta migracao (28 colunas, criada com select * na 075).
-- ---------------------------------------------------------------------------
-- drop function if exists public.radar_atualizar_contato_manual(text, text, text);
-- create or replace view public.vw_radar_empresas
--   with (security_invoker = true) as
--   select cnpj, nome_devedor, uf, competencia_ultima, qtd_inscricoes, valor_total,
--          data_inscricao_mais_recente, tem_garantia, receitas, score, enriquecido_em,
--          enriquecimento_erro, razao_social, nome_fantasia, cnae_principal, cnae_descricao,
--          porte, optante_simples, optante_mei, situacao_cadastral, municipio, email,
--          telefone, socios, status, motivo_exclusao, prospect_id, atualizado_em
--   from public.radar_empresas
--   where status <> 'excluido'
--   order by score desc, valor_total desc;
-- alter table public.radar_empresas
--   drop column if exists telefone_manual,
--   drop column if exists email_manual,
--   drop column if exists contato_manual_atualizado_em;
