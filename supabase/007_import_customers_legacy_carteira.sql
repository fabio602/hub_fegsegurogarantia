-- Importação de clientes do CRM legado para Carteira (Seguro Garantia).
-- Fonte: customers.csv
-- Estratégia: inserção sem duplicar por CNPJ (quando houver) ou Nome+Email.

begin;

with src(data, nome, cnpj, telefone, email, decisor, vendedor, ramo, created_at) as (
  values
    ('2025-10-02','AGROFLORESTAL RIO DA PRATA LTDA','38.228.182/0001-25','','','','Equipe','','2025-10-02 09:42:26'),
    ('2025-12-30','G2 CONSTRUTORA LTDA ME','13.642.005/0001-60','','','','Fábio','Consutor de Licitações','2025-12-30 14:57:37'),
    ('2025-12-30','Gold Construtora','09.067.468/0001-78','(35) 99161-0000','goldconstrutora46@gmail.com','','Fábio','Construção','2025-12-30 15:07:07'),
    ('2025-12-30','Raphael Icaro Licitações Ltda','39.913.927/0001-58','(21) 97191- 9898','','','Fábio','Licitações','2025-12-30 15:13:30'),
    ('2025-12-30','Inove Licitações','23.567.504/0001-93','(81) 995578860','marcos__schneider@hotmail.com','','Fábio','Consultor de Licitações','2025-12-30 15:14:13'),
    ('2025-12-30','LEAL GUSMAO ASSESSORIA & EMPREENDIMENTOS LTDA','40.489.861/0001-08','(48) 99132-1694','','','Fábio','','2025-12-30 15:15:31'),
    ('2025-12-30','ENGETELA COMERCIO E SERVICOS EIRELI','12.721.248/0001-20','(35) 998724273','','','Fábio','Mat. de Construção','2025-12-30 15:16:05'),
    ('2025-12-30','Ouro Norte','29.621.201/0001-98','(94) 99170-3612','','','Fábio','Construção','2025-12-30 15:16:44'),
    ('2025-12-30','ITALUZ SERVICOS - INSTALACAO, MANUTENCAO E MATERIAIS ELETRICOS','16.919.699/0001-28','15 99627-1213','','','Fábio','Iluminação','2025-12-30 15:27:47'),
    ('2025-12-31','ARGO INDUSTRIAL LTDA','29.077.092/0001-90','(31) 3660-9056','','','Andréia','Construção','2025-12-31 17:40:20'),
    ('2025-12-31','AM2 CONSULTORIA & SOLUCOES LTDA','19.163.710/0001-60','(67) 98123-9993','','','Andréia','','2025-12-31 19:59:56'),
    ('2025-12-31','Farias Empreendimentos LTDA','01.232.045/0001-54','(82) 99809-8286','','','Andréia','','2025-12-31 20:17:26'),
    ('2025-12-31','Titas Eventos, Comercio e Serviços de Produtos Alimenticios ltda','84.498.179/0001-49','(92) 98591-4279','','','Andréia','','2025-12-31 20:41:59'),
    ('2026-01-01','ELLO SERVICOS DE MAO DE OBRA LTDA','06.888.220/0001-80','(85) 32156250','licitacao@ellosrv.com.br','','Fábio','6204000 - Consultoria em tecnologia da informação','2026-01-01 13:00:21'),
    ('2026-01-02','M. EDUARDA GOMES DE ARAUJO NEGOCIOS, SERVICOS E LOCACOES DE BENS','43.646.705/0001-93','(850 99590-8409','','','Andréia','','2026-01-02 10:46:26'),
    ('2026-01-02','CLINICA DE MEDICINA NUCLEAR VILLELA PEDRAS LTDA (FILIAL)','33.205.964/0004-78','(21) 99553-1664','','','Andréia','','2026-01-02 22:26:32'),
    ('2026-01-06','CRETA EMPREENDIMENTOS LTDA','23.572.314/0001-64','(73) 9994-3131','contato@cretaempreendimentos.com.br','','Fábio','','2026-01-06 10:59:45'),
    ('2026-01-07','CONSTRUTORA E CERAMICA ALTO TAPAJOS LTDA','18.391.392/0001-22','(93) 9122-4177','','Rosana Moreira da Silva','Andréia','Construção','2026-01-07 10:23:57'),
    ('2026-01-07','UNIMETAL RESERVATÓRIOS METÁLICOS LTDA','52.797.468/0001-52','(62) 99465-2864','','','Andréia','','2026-01-07 16:21:53'),
    ('2026-01-09','TERRA PERFURACOES LTDA','00.197.503/0001-07','(85) 34740916','','','Andréia','4399105 - Perfuração e construção de poços de água','2026-01-09 16:51:45'),
    ('2026-01-14','J. R. CONSTRUTORA E TERRAPLANAGEM LTDA.','01.963.124/0001-35','(12) 3861-1480 (12) 9774-4015','contabil@jrterraplanagem.com.br','','Fábio','4211101 - Construção de rodovias e ferrovias','2026-01-14 08:37:07'),
    ('2026-01-21','MAM Distribuidora','27.308.945/0001-21','(47) 3144-1900','mampneus@gmail.com','','Andréia','','2026-01-21 15:39:04'),
    ('2026-01-21','BBS Construtora','28.941.768/0001-89','(14)99788-7531','contato@escdinamica.com.br','Bruno Vicentini','Andréia','Construção','2026-01-21 16:04:37'),
    ('2026-01-28','DISTRIBUIDORA DE MEDICAMENTOS CEDRO LTDA','04.230.084/0001-00','(88) 21681012 - 35641307','dimecedro@yahoo.com.br','Bruno','Larissa','4644301 - Comércio atacadista de medicamentos e drogas de uso humano','2026-01-28 16:08:24'),
    ('2026-01-30','FERREIRA & MELO IND. COM. LTDA','15.237.315/0001-24','(34) 3236-5211','silcon@silconcontadores.com.br','Jonatã','Larissa','','2026-01-30 09:52:09'),
    ('2026-01-30','RIBEIRO COMERCIO DE MEDICAMENTOS LTDA','22.308.583/0001-55','(92) 8414-5402','ribeiroesouzaimpostos@gmail.com','','Larissa','','2026-01-30 09:59:35'),
    ('2026-02-06','J O SERVICOS DE ENGENHARIA LTDA','48.219.286/0001-27','(71) 994148789','','','Larissa','','2026-02-06 08:25:53'),
    ('2026-02-06','SAO BENTO ARTEFATOS DE CIMENTO LTDA','51.370.429/0001-01','(35) 9907-9871','apmessiascristiane@gmail.com','ROGER SOUZA RODRIGUES','Rafael','','2026-02-06 10:12:31'),
    ('2026-02-13','JJ FERRAMENTAS COMERCIO E SERVICOS LTDA','42.122.046/0001-23','(94) 991691606','','','Larissa','9601701 - Lavanderias','2026-02-13 08:58:34'),
    ('2026-02-18','FUNDACAO LA SALLE','08.341.725/0003-17','(51) 30313169','','','Andréia','8599699 - Outras atividades de ensino não especificadas anteriormente','2026-02-18 17:04:53'),
    ('2026-02-18','SUPER NOVA SERVICOS GERAIS LTDA','26.560.932/0001-82','(21) 34008501','','','Andréia','8111700 - Serviços combinados para apoio a edifícios exceto condomínios prediais','2026-02-18 17:10:37'),
    ('2026-02-23','AGUIAR ENGENHARIA E CONSTRUCAO LTDA','46.640.672/0001-62','','','','Helena','','2026-02-23 14:36:25'),
    ('2026-02-27','NORDESTE TRANS AGUA & POCOS ARTESIANOS LTDA','25.169.836/0001-45','(81) 36561030','','','Andréia','3600602 - Distribuição de água por caminhões','2026-02-27 09:58:28')
)
insert into public.sales (
  data, nome, origem, tipo, "is", seguradora, premio, vendeu, comissao, vendedor, indicacao, limites, catalogo,
  vigencia_inicio, vigencia_fim, telefone, email, cnpj, decisor, product_type, created_at
)
select
  s.data::date, s.nome, 'Importação CRM legado', null, null, null, null, 'Em andamento', null, s.vendedor, 'Não', 'Não', 'Não',
  null, null, nullif(s.telefone, ''), nullif(s.email, ''), nullif(s.cnpj, ''), nullif(s.decisor, ''), 'Seguro Garantia', s.created_at::timestamp
from src s
where not exists (
  select 1 from public.sales x
  where (
    nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), '') is not null
    and regexp_replace(coalesce(x.cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g')
  )
  or (
    coalesce(s.cnpj, '') = ''
    and upper(trim(coalesce(x.nome, ''))) = upper(trim(coalesce(s.nome, '')))
    and upper(trim(coalesce(x.email, ''))) = upper(trim(coalesce(s.email, '')))
  )
);

commit;