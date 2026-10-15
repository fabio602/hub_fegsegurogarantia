-- 105 — Portal da imobiliária: gravar documentos pela RPC
--
-- O portal (public/imobiliaria.html) roda com a chave anon e uma sessão própria
-- (localStorage), não com o Supabase Auth. A tabela imobiliaria_clientes só
-- concede SELECT ao anon, então o .update() direto do portal era descartado em
-- silêncio pelo RLS (PostgREST devolve 0 linhas, sem erro): o PDF subia para o
-- storage, a coluna ficava vazia e o portal continuava pedindo o documento.
-- O mesmo acontecia com os anexos da rescisão, que nunca liberavam o botão de
-- concluir.
--
-- Em vez de abrir UPDATE geral ao anon, esta função grava só os campos de
-- documento, só no cadastro que pertence à imobiliária informada, e só com
-- link do próprio bucket imobiliaria-docs na pasta daquele cadastro.

create or replace function public.imobiliaria_portal_salvar_campo(
  p_client_id  uuid,
  p_partner_id integer,
  p_campo      text,
  p_valor      text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dono   integer;
  v_prefixo text;
begin
  if p_campo not in (
    'doc_contrato_url', 'doc_termo_vistoria_url', 'doc_fotos_vistoria_url',
    'rescisao_distrato_url', 'rescisao_vistoria_url', 'rescisao_obs'
  ) then
    raise exception 'Campo não permitido: %', p_campo;
  end if;

  select partner_id into v_dono from imobiliaria_clientes where id = p_client_id;
  if not found or v_dono is distinct from p_partner_id then
    raise exception 'Cadastro não encontrado para esta imobiliária';
  end if;

  if p_campo <> 'rescisao_obs' then
    v_prefixo := 'https://hfjvwibucplyhsvnwfor.supabase.co/storage/v1/object/public/imobiliaria-docs/'
                 || p_partner_id || '/' || p_client_id || '/';
    if p_valor is null or left(p_valor, length(v_prefixo)) <> v_prefixo then
      raise exception 'Link de arquivo inválido';
    end if;
  else
    p_valor := nullif(btrim(left(coalesce(p_valor, ''), 2000)), '');
  end if;

  execute format('update imobiliaria_clientes set %I = $1 where id = $2', p_campo)
    using p_valor, p_client_id;
end;
$$;

revoke all on function public.imobiliaria_portal_salvar_campo(uuid, integer, text, text) from public;
grant execute on function public.imobiliaria_portal_salvar_campo(uuid, integer, text, text) to anon, authenticated, service_role;
