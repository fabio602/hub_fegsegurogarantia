-- ============================================================================
-- 149: padrão de escrita do nome do inquilino (28/11/2026, pedido do Fábio)
--
-- Boa parte dos nomes foi digitada toda em maiúsculas (84 de 119 cadastros do
-- Repasse e 84 de 123 do Residencial). O padrão passa a ser: primeira letra de
-- cada nome maiúscula e o resto minúsculo, com "de, da, do, dos, das, e" em
-- minúsculas no meio do nome. Ex.: GUSTAVO DOS SANTOS DRUZIAN vira
-- Gustavo dos Santos Druzian.
--
--   1) função nome_proprio(texto);
--   2) arruma os nomes que já existem (imobiliaria_clientes.inquilino_nome e
--      residential_clients.nome);
--   3) gatilho nas duas tabelas, para o padrão valer daqui para a frente, venha
--      o nome do HUB, do portal da imobiliária ou de uma Edge Function.
--
-- Só reescreve nome TODO em maiúsculas ou TODO em minúsculas. Nome que alguém
-- já digitou com maiúsculas e minúsculas fica como está, a não ser o
-- "De/Da/Do/Dos/Das" do meio, que desce para minúscula. Acento não é
-- adivinhado: MONICA vira Monica, não Mônica.
--
-- As telas casam os dois cadastros pelo nome sem diferenciar maiúscula de
-- minúscula (ilike), então a troca não quebra a ligação entre Repasse e
-- Residencial. Os gatilhos que já existem nas duas tabelas não são tocados.
-- ============================================================================

-- 1) -------------------------------------------------------------------------
create or replace function public.nome_proprio(p_nome text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_txt   text;
  v_pal   text;
  v_out   text := '';
  v_res   text[] := '{}';
  v_i     int := 0;
  v_j     int;
  v_ch    text;
  v_ant   text;
begin
  if p_nome is null then return null; end if;
  -- espaços das pontas e espaços dobrados saem sempre
  v_txt := btrim(regexp_replace(p_nome, '\s+', ' ', 'g'));
  if v_txt = '' then return v_txt; end if;
  -- Nome já escrito com maiúsculas e minúsculas fica como está; só o
  -- "De/Da/Do/Dos/Das" do meio desce para minúscula (Tiago Pegoraro De Jesus).
  if v_txt <> upper(v_txt) and v_txt <> lower(v_txt) then
    foreach v_pal in array string_to_array(v_txt, ' ') loop
      v_i := v_i + 1;
      if v_i > 1 and v_pal in ('De', 'Da', 'Do', 'Dos', 'Das') then
        v_res := v_res || lower(v_pal);
      else
        v_res := v_res || v_pal;
      end if;
    end loop;
    return array_to_string(v_res, ' ');
  end if;

  foreach v_pal in array string_to_array(v_txt, ' ') loop
    v_i := v_i + 1;
    v_pal := lower(v_pal);
    if v_i > 1 and v_pal in ('de', 'da', 'do', 'dos', 'das', 'e') then
      v_res := v_res || v_pal;
    elsif upper(v_pal) in ('ME', 'EPP', 'SA', 'S/A', 'S.A.', 'II', 'III') then
      v_res := v_res || upper(v_pal);
    else
      -- maiúscula no começo e depois de ( - ' / (ex.: D'Avila, Ana-Maria, (Camila))
      v_out := '';
      v_ant := '';
      for v_j in 1..char_length(v_pal) loop
        v_ch := substr(v_pal, v_j, 1);
        if v_j = 1 or v_ant in ('(', '-', '''', '/') then
          v_out := v_out || upper(v_ch);
        else
          v_out := v_out || v_ch;
        end if;
        v_ant := v_ch;
      end loop;
      v_res := v_res || v_out;
    end if;
  end loop;

  return array_to_string(v_res, ' ');
end;
$function$;

comment on function public.nome_proprio(text) is
  'Padrão de escrita de nome de pessoa: iniciais maiúsculas, de/da/do/dos/das/e minúsculos. Só mexe em nome todo em maiúsculas ou todo em minúsculas.';

-- 2) nomes que já existem -------------------------------------------------------
update public.imobiliaria_clientes
   set inquilino_nome = public.nome_proprio(inquilino_nome)
 where inquilino_nome is distinct from public.nome_proprio(inquilino_nome);

update public.residential_clients
   set nome = public.nome_proprio(nome)
 where nome is distinct from public.nome_proprio(nome);

-- 3) daqui para a frente ----------------------------------------------------------
create or replace function public.imobiliaria_clientes_nome_proprio()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.inquilino_nome := public.nome_proprio(new.inquilino_nome);
  return new;
end;
$function$;

drop trigger if exists trg_imobiliaria_clientes_nome_proprio on public.imobiliaria_clientes;
create trigger trg_imobiliaria_clientes_nome_proprio
    before insert or update of inquilino_nome on public.imobiliaria_clientes
    for each row execute function public.imobiliaria_clientes_nome_proprio();

create or replace function public.residential_clients_nome_proprio()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.nome := public.nome_proprio(new.nome);
  return new;
end;
$function$;

drop trigger if exists trg_residential_clients_nome_proprio on public.residential_clients;
create trigger trg_residential_clients_nome_proprio
    before insert or update of nome on public.residential_clients
    for each row execute function public.residential_clients_nome_proprio();

-- Conferência depois de rodar (as duas contagens devem dar zero):
--   select count(*) from imobiliaria_clientes where inquilino_nome = upper(inquilino_nome) and inquilino_nome ~ '[A-Z]';
--   select count(*) from residential_clients where nome = upper(nome) and nome ~ '[A-Z]';
