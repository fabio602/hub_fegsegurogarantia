-- ============================================================================
-- 150: padrão de escrita no Kanban de prospecção (28/11/2026, pedido do Fábio)
--
-- Continuação da 149 (nome do inquilino). Na tabela prospects:
--   name    = pessoa de contato  -> nome_proprio (função da 149)
--   company = razão social       -> nome_empresa (função nova, abaixo)
-- Hoje 2.478 de 3.535 nomes e 2.771 empresas estão em maiúsculas.
--
-- nome_empresa segue a mesma ideia da nome_proprio (iniciais maiúsculas,
-- de/da/do/dos/das/e minúsculos) e mantém em MAIÚSCULAS o que em razão social
-- costuma ser sigla:
--   - S/A, S.A., SA, ME, EPP, MEI, EI, SS, S/S, SPE, SCP;
--   - letra solta e palavra de 2 letras (K M O, AM, RS, BR, CS);
--   - palavra com número (G4F) ou com ponto (J.P.L., JM.);
--   - palavra de até 4 letras sem vogal (DHD, DMG).
-- "LTDA" vira "Ltda". Sigla de 3 letras com vogal (UNE, ABC) NÃO é reconhecida
-- e sai "Une", "Abc": essas se corrigem à mão, e a correção fica, porque nome
-- escrito com maiúsculas e minúsculas misturadas nunca é reescrito.
-- Acento não é adivinhado (CONSTRUCOES vira Construcoes).
--
-- Só o Kanban. O Registro de Vendas (sales) NÃO é tocado aqui: lá o nome vai
-- para proposta e e-mail de seguradora, e a tabela tem um webhook que dispara a
-- cada alteração. Fica para depois da prévia aprovada pelo Fábio.
--
-- Os gatilhos que já existem em prospects são só de status, licitação e
-- origem: não disparam com a troca do nome.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.nome_proprio(text)') is null then
    raise exception 'Rode a migração 149 antes desta (falta a função nome_proprio).';
  end if;
end $$;

-- 1) -------------------------------------------------------------------------
create or replace function public.nome_empresa(p_nome text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_txt text;
  v_pal text;
  v_out text;
  v_res text[] := '{}';
  v_i   int := 0;
  v_j   int;
  v_ch  text;
  v_ant text;
begin
  if p_nome is null then return null; end if;
  v_txt := btrim(regexp_replace(p_nome, '\s+', ' ', 'g'));
  if v_txt = '' then return v_txt; end if;
  -- nome já escrito com maiúsculas e minúsculas fica como está
  if v_txt <> upper(v_txt) and v_txt <> lower(v_txt) then return v_txt; end if;

  foreach v_pal in array string_to_array(v_txt, ' ') loop
    v_i := v_i + 1;
    v_pal := lower(v_pal);
    if v_i > 1 and v_pal in ('de', 'da', 'do', 'dos', 'das', 'e', 'em', 'para', 'com') then
      v_res := v_res || v_pal;
    elsif upper(v_pal) in ('S/A', 'S.A.', 'S.A', 'SA', 'ME', 'EPP', 'MEI', 'EI', 'SS', 'S/S', 'SPE', 'SCP')
       or v_pal ~ '[0-9]'                                   -- G4F
       or v_pal ~ '^[[:alpha:]]+\.'                         -- J.P.L., JM., R.
       or v_pal ~ '^[[:alpha:]]{1,2}$'                      -- K M O, AM, RS
       or (char_length(v_pal) <= 4 and v_pal ~ '^[[:alpha:]]+$' and v_pal !~ '[aeiouyáàâãéêíóôõúü]')  -- DHD
    then
      v_res := v_res || upper(v_pal);
    else
      v_out := '';
      v_ant := '';
      for v_j in 1..char_length(v_pal) loop
        v_ch := substr(v_pal, v_j, 1);
        if v_j = 1 or v_ant in ('(', '-', '''', '/', '&', '+') then
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

comment on function public.nome_empresa(text) is
  'Padrão de escrita de razão social: iniciais maiúsculas, siglas societárias e palavras curtas sem vogal em maiúsculas. Só mexe em nome todo em maiúsculas ou todo em minúsculas.';

-- 2) leads que já existem -------------------------------------------------------
update public.prospects
   set name    = public.nome_proprio(name),
       company = public.nome_empresa(company)
 where name is distinct from public.nome_proprio(name)
    or company is distinct from public.nome_empresa(company);

-- 3) daqui para a frente (leads do PNCP, do garimpo, do formulário do site) ------
create or replace function public.prospects_nome_padrao()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.name    := public.nome_proprio(new.name);
  new.company := public.nome_empresa(new.company);
  return new;
end;
$function$;

drop trigger if exists trg_prospects_nome_padrao on public.prospects;
create trigger trg_prospects_nome_padrao
    before insert or update of name, company on public.prospects
    for each row execute function public.prospects_nome_padrao();

-- Conferência depois de rodar (as duas contagens devem dar zero ou perto disso:
-- sobra só nome que é sigla inteira, como "G4F" ou "CS"):
--   select count(*) from prospects where name = upper(name) and name ~ '[a-zA-Z]{3}';
--   select company from prospects where company = upper(company) and company ~ '[A-Z]{3}' limit 50;
