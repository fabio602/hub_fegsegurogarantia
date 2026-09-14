# Radar · Contato manual · Aceite

Branch `radar-contato-manual` a partir da `main` (`a8d8d39`, tag
`pre-contato-manual`). Rodado em 14/09/2026 contra o projeto real
`hfjvwibucplyhsvnwfor`. Decisão 73 em [DECISOES.md](DECISOES.md).

## O que foi feito

- **Migração 082** (`supabase/082_radar_contato_manual.sql`, aplicada): colunas
  `telefone_manual`, `email_manual`, `contato_manual_atualizado_em`; view
  `vw_radar_empresas` com as 28 colunas antigas nas mesmas posições (conferido
  por `information_schema.columns`: posições 1 a 28 iguais, 29 a 32 novas) e
  `security_invoker` mantido; RPC `radar_atualizar_contato_manual` (security
  invoker, grant para authenticated), semântica por campo.
- **Enriquecimento** (passo 2, só leitura): `radar-enrich-cnpj` faz `update`
  com colunas nomeadas; `enrich_local.py` faz PATCH com dict de colunas;
  `radar_consolidar_dossie` e `radar_consolidar_empresas` atualizam colunas
  explícitas. Nenhum cita `telefone_manual`, `email_manual` ou
  `contato_manual_atualizado_em` (grep). Sem upsert de linha inteira.
- **Tela**: no drawer, telefone e e-mail viram `ContatoEditavel` (clique abre
  o input, Enter salva pela RPC enviando só o campo editado, Esc cancela sem
  fechar o drawer, toast de sucesso ou erro; em erro o valor anterior fica).
  Com valor manual: badge "manual", valor da BrasilAPI abaixo com rótulo e
  botão Restaurar por campo. Tabela ganhou a coluna Telefone com
  `telefone_efetivo`, fallback para manual e BrasilAPI.
- **Kanban**: o lead passa a usar `emailEfetivo(empresa)` e
  `telefoneEfetivo(empresa)`.
- Worker do PJe descarregado antes da migração (`launchctl list | grep radar`
  vazio) e reinstalado ao final.

## Checklist do passo 5

- [x] `npm run build` sem erros.
- [x] `npx tsc --noEmit` sem erros nos arquivos do Radar.
- [x] `npm run dev`, Radar aberto no Chrome logado: lista carrega (23.436 novos).
- [x] Filtro Região "Sorocaba e região" preenche os 12 chips, define UF = SP e
      filtra a tabela; remover um chip vira "Seleção própria"; Limpar filtros
      zera.
- [x] Drawer da Convenção abre com a seção de cadastro editável.
- [x] Edição salva: e-mail `financeiro@convencao.com.br` gravado pela RPC,
      toast "E-mail salvo.", badge manual e BrasilAPI abaixo.
- [x] Erro mantém o valor: telefone "123" devolve o toast "use DDD + numero
      (10 ou 11 digitos)" e o valor anterior continua na tela.
- [x] Restaurar funciona: Restaurar do e-mail voltou para "Não informado"
      (valor da BrasilAPI) e tirou o badge.
- [x] Envio ao Kanban cria o lead com o telefone manual: `prospects.phonenumber
      = "(11) 91234-5678"` (manual) enquanto a BrasilAPI tinha (11) 4441-6300.
- [x] Enriquecimento não sobrescreve: com `telefone_manual = 11912345678` na
      Convenção, a Edge Function `radar-enrich-cnpj` foi chamada com
      `{"cnpjs":["56199714000710"]}` (mesma lógica do `enrich_local.py`, que
      não tem modo dry-run nem `--cnpj`): `enriquecido_em` avançou e
      `telefone_manual` permaneceu.

Dados de teste removidos ao final: lead apagado de `prospects`, Convenção de
volta a `novo`, telefone e e-mail manuais limpos pela RPC.

## Rollback

```sql
drop function if exists public.radar_atualizar_contato_manual(text, text, text);
create or replace view public.vw_radar_empresas
  with (security_invoker = true) as
  select cnpj, nome_devedor, uf, competencia_ultima, qtd_inscricoes, valor_total,
         data_inscricao_mais_recente, tem_garantia, receitas, score, enriquecido_em,
         enriquecimento_erro, razao_social, nome_fantasia, cnae_principal, cnae_descricao,
         porte, optante_simples, optante_mei, situacao_cadastral, municipio, email,
         telefone, socios, status, motivo_exclusao, prospect_id, atualizado_em
  from public.radar_empresas
  where status <> 'excluido'
  order by score desc, valor_total desc;
alter table public.radar_empresas
  drop column if exists telefone_manual,
  drop column if exists email_manual,
  drop column if exists contato_manual_atualizado_em;
```

No código: `git checkout pre-contato-manual` (ou reverter os commits da branch).
