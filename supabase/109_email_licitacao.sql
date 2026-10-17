-- ============================================================================
-- 109_email_licitacao.sql
-- E-mail da licitacao: o 1o contato dos leads do PNCP passa a ser manual.
--
-- Antes: o lead entrava no Kanban e recebia o E1 generico da trilha `garantia`
-- na hora, dentro de enviarLead() da prospeccao-pncp.
--
-- Agora: o lead entra sem disparar nada. No card, o botao "E-mail da licitacao"
-- abre uma previa com os dados daquela licitacao; o Fabio confere, ajusta e
-- envia. Esse envio CONTA como o E1 da trilha `garantia` (ordem 1 em
-- email_envios), e a trilha segue sozinha a partir do E2 (dia 3), pelo cron
-- que ja existe.
--
-- A trilha `licitacao` criada aqui e so o deposito do conteudo desse primeiro
-- e-mail: nasce com ativo = false de proposito, para que o cron da cadencia
-- nunca a varra. Quem envia e a tela, pelos modos `licitacao_preview` e
-- `licitacao_enviar` da prospecting-cadence.
--
-- "Aguardando 1o e-mail" nao e coluna nova: e email_cadencia.ativo = false
-- sem nenhuma linha em email_envios para o contato.
--
-- A coluna prospects.data_homologacao, que alimenta o placeholder
-- [DATA_HOMOLOGACAO] da previa, vem da migracao 107 e nao e tocada aqui.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A trilha. Marca, rodape e assinatura copiados da `garantia`: e o mesmo
-- remetente falando com o mesmo publico, so que no primeiro toque.
-- ativo = false mantem o cron fora daqui.
-- ----------------------------------------------------------------------------
insert into email_trilhas (slug, nome, descricao, eyebrow, rodape, assinatura_linha, ativo, ordem)
select
  'licitacao',
  'E-mail da licitacao (1o contato manual)',
  'Conteudo do primeiro e-mail dos leads do PNCP, enviado a mao pela previa no card do Kanban. '
    || 'O envio conta como o E1 da trilha garantia, que segue sozinha a partir do E2. '
    || 'ativo = false de proposito: o cron da cadencia nunca varre esta trilha.',
  g.eyebrow,
  g.rodape,
  g.assinatura_linha,
  false,
  9
  from email_trilhas g
 where g.slug = 'garantia'
on conflict (slug) do update
   set nome             = excluded.nome,
       descricao        = excluded.descricao,
       eyebrow          = excluded.eyebrow,
       rodape           = excluded.rodape,
       assinatura_linha = excluded.assinatura_linha,
       ativo            = excluded.ativo,
       ordem            = excluded.ordem;

-- ----------------------------------------------------------------------------
-- A unica etapa. dia = 0 porque ela sai no dia em que o Fabio clica.
--
-- Placeholders proprios desta trilha, resolvidos pela Edge Function a partir
-- das colunas do `prospects`: [ORGAO], [OBJETO], [OBJETO_CURTO] (ate 60
-- caracteres, cortando em palavra), [VALOR] (R$ formatado),
-- [NUMERO_LICITACAO] e [DATA_HOMOLOGACAO] (DD/MM/AAAA).
--
-- {{? ... }} marca um trecho condicional: se algum placeholder dentro dele
-- estiver vazio, o trecho inteiro cai. E o que impede a frase de sair com
-- "no valor de R$ 0,00" ou com [VALOR] cru quando a licitacao veio sem valor.
-- Sem nenhum dos quatro, a frase ainda fecha: "o resultado da licitacao.
-- Parabens pelo resultado." No assunto vale a mesma trava: sem objeto, o
-- assunto e so "Garantia contratual", nunca "Garantia contratual: " com os
-- dois-pontos soltos.
--
-- O texto NAO afirma que o contrato exige garantia nem cita percentual:
-- pergunta e pede a minuta. Nada nao verificado escrito como certo.
-- ----------------------------------------------------------------------------
insert into email_trilha_etapas (trilha, ordem, dia, assunto, tagline, titulo, corpo_html, cta_texto, cta_link, ativo)
select
  'licitacao',
  1,
  0,
  'Garantia contratual{{?: [OBJETO_CURTO]}}',
  'Resultado Homologado',
  'Parabéns pelo resultado.<br>E a garantia contratual?',
  '<p style="{{P}}">Vimos que a <strong style="color:#1B263B;">[NOME_EMPRESA]</strong> teve homologado o resultado da licitação{{? [NUMERO_LICITACAO]}}{{? do [ORGAO]}}{{?, para [OBJETO]}}{{?, no valor de [VALOR]}}. Parabéns pelo resultado.</p>' || chr(10) ||
  '<p style="{{P}}">Nessa fase, antes da assinatura do contrato, é comum o órgão pedir a <strong style="color:#1B263B;">garantia contratual</strong>. Se for o caso, providenciamos o seguro garantia de execução com rapidez, cotando em <strong style="color:#1B263B;">mais de 25 seguradoras</strong> para buscar a melhor taxa e o limite adequado para a sua empresa.</p>' || chr(10) ||
  '<p style="{{PF}}">O edital ou a minuta do contrato de vocês prevê garantia? Se puder nos enviar, analisamos o percentual exigido e devolvemos a cotação.</p>',
  e.cta_texto,
  e.cta_link,
  true
  from email_trilha_etapas e
 where e.trilha = 'garantia' and e.ordem = 1
on conflict (trilha, ordem) do update
   set dia        = excluded.dia,
       assunto    = excluded.assunto,
       tagline    = excluded.tagline,
       titulo     = excluded.titulo,
       corpo_html = excluded.corpo_html,
       cta_texto  = excluded.cta_texto,
       cta_link   = excluded.cta_link,
       ativo      = excluded.ativo;
