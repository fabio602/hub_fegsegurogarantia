-- 097_saude_materiais.sql
--
-- A biblioteca de formularios passa a servir os dois modulos da corretora.
-- Seguro Garantia ja usa a tela; plano de saude passa a usar a mesma, com a
-- propria aba e as proprias categorias.
--
-- Nao ha bucket novo. O `formularios` ja e publico e ja guarda material em
-- branco sem dado de pessoa, que e a mesma natureza do material de saude.
-- Documento de beneficiario continua no `saude-documentos`, privado e com
-- retencao (migracao 095). Essa fronteira nao se mistura.
--
-- Tudo aqui e aditivo. A 045 continua valendo inteira: as policies de leitura
-- e de escrita do admin nao mudam.

alter table formularios
  add column if not exists modulo text not null default 'garantia';

-- As linhas que ja existem sao todas de Seguro Garantia e ficam como estao
-- pelo default acima.
alter table formularios
  drop constraint if exists formularios_modulo_check;
alter table formularios
  add constraint formularios_modulo_check check (modulo in ('garantia', 'saude'));

comment on column formularios.modulo is
  'Qual aba do HUB mostra este arquivo: garantia (tela Formularios) ou saude (aba Materiais).';

-- Vigencia em texto livre, do jeito que a operadora escreve: "a partir de
-- 18.05.26". Existe porque tabela de preco vence, e um preco velho enviado
-- ao cliente custa caro.
alter table formularios
  add column if not exists vigencia text;

comment on column formularios.vigencia is
  'Vigencia declarada do material, como a operadora escreve. So exibicao, nao trava nada.';

-- Serve ao cache-busting do link publico: a URL nao muda quando o arquivo e
-- substituido, entao o ?v= do link carrega este timestamp.
alter table formularios
  add column if not exists atualizado_em timestamptz not null default now();

comment on column formularios.atualizado_em is
  'Quando o arquivo foi subido ou substituido. Alimenta o ?v= do link publico.';

drop index if exists formularios_categoria_idx;
create index if not exists formularios_modulo_idx
  on formularios (modulo, categoria, ordem, nome);
