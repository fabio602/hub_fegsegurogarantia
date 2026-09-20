-- 092_campanha_saude_pme.sql
--
-- Cria a campanha de garimpo da linha de saude. O motor de campanhas ja e
-- generico (campanhas_garimpo + garimpo_estoque), entao isto e so um insert.
--
-- Nasce DESLIGADA e em dry_run de proposito. Assim que sair do dry_run e
-- comecar a inscrever contatos, o cron cadencia-emails-daily das 9h passa a
-- disparar a trilha saude-pme sozinho, porque ele liga todas as trilhas
-- ativas. Ligar esta campanha e, na pratica, comecar a mandar e-mail.
--
-- Pre-requisitos antes de ligar:
--   1. o site fgsaude.com.br no ar, porque quatro dos cinco botoes da trilha
--      levam para la;
--   2. o patch da prospecting-cadence aplicado, senao os e-mails de saude
--      saem assinados como Seguro Garantia.

insert into campanhas_garimpo (
  slug, nome, ativo, dry_run, fonte, termos_busca, cidades,
  palavras_exclusao, palavras_inclusao, trilha, tipo_prospect,
  limite_diario, cadencia_garimpo_dias, exigir_cnpj
) values (
  'saude-pme',
  'Plano de Saúde PME',
  false,
  true,
  'maps',
  array['metalúrgica','usinagem','indústria','transportadora','distribuidora',
        'escritório de contabilidade','construtora','autopeças','gráfica',
        'confecção','logística','escola particular','clínica'],
  array['Sorocaba, SP','Boituva, SP','Porto Feliz, SP'],
  array['mei','autônomo','profissional liberal','órgão público','prefeitura',
        'sindicato','associação','franquia','loja de shopping'],
  null,
  'saude-pme',
  'Plano de Saúde',
  5,
  7,
  true
)
on conflict (slug) do nothing;
