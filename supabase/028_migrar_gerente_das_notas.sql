-- 028 — Migra o contato do gerente comercial que estava digitado à mão
-- dentro das Notas Técnicas (obs) para os campos dedicados criados na 027
-- (gerente / contato / email).
--
-- O texto que NÃO era contato (requisitos de aceitação, regras de garantia
-- adicional, e-mail de inadimplência) permanece em obs. Quando a nota inteira
-- era só o contato, obs vira NULL para o bloco sumir do card.

begin;

-- ── Seguro Garantia (insurers) ──────────────────────────────────────────────

update insurers set
  gerente = 'Francisco',
  contato = '11 96453-0131',
  obs     = 'Inadimplência: Inadimplencia@riskadviser.com.br'
where id = 3; -- Allseg/ ASAS

update insurers set
  gerente = 'Ricardo',
  contato = '11 99788-6604',
  obs     = null
where id = 4; -- AVLA

update insurers set
  gerente = 'Edinamara',
  contato = '41 99698-4416',
  email   = 'atendimentocorretor@essor.com.br',
  obs     = 'Garantia Adicional emite no portal'
where id = 7; -- ESSOR

update insurers set
  gerente = 'Jeferson',
  contato = '(11) 2110-5519',
  obs     = null
where id = 8; -- EZZE

update insurers set
  gerente = 'Mirian Sena',
  contato = '11 93702-3984',
  obs     = null
where id = 11; -- Sancor

update insurers set
  gerente = 'Camila',
  contato = '11 93364-6372',
  obs     = 'PARA GARANTIA ADICIONAL: para os casos de garantia adicional que internalizam e dependem da nossa aprovação, é necessário a princípio os Balanços + Balancete + backlog. Nesses casos emitimos na mesma apólice, somando os valores e discriminando no objeto.'
where id = 12; -- Sombrero

update insurers set
  gerente = 'Daiane (Sucursal)',
  contato = '11 97566-9867',
  obs     = null
where id = 13; -- Tokio Marine

update insurers set
  gerente = 'Suellen Martins',
  contato = '19 2115-4202',
  email   = 'suelen.martins@br.zurich.com',
  obs     = null
where id = 14; -- Zurich

update insurers set
  gerente = 'Filipi',
  contato = '11 98981-9112',
  obs     = 'Requisitos: mínimo R$ 10MM de Patrimônio Líquido (PL); acima de 2 anos de atividade; acima de R$ 10MM de Receita Operacional Bruta.'
where id = 16; -- AXA

update insurers set
  gerente = 'Nathalia (Assessoria Madelle)',
  contato = '31 99508-4836',
  obs     = null
where id = 17; -- NEWE

-- ── Seguro Auto (seguradoras_auto) ──────────────────────────────────────────

update seguradoras_auto set
  gerente = 'Daiane (Sucursal)',
  contato = '11 97566-9867',
  obs     = null
where id = 2; -- Tokio Marine

-- ── Responsabilidade Civil (seguradoras_rc) ─────────────────────────────────

update seguradoras_rc set
  gerente = 'Suellen Martins',
  contato = '19 2115-4202',
  email   = 'suelen.martins@br.zurich.com',
  obs     = null
where id = 2; -- Zurich

update seguradoras_rc set
  gerente = 'Daiane (Sucursal)',
  contato = '11 97566-9867',
  obs     = null
where id = 3; -- Tokio Marine

update seguradoras_rc set
  gerente = 'Filipi',
  contato = '11 98981-9112',
  obs     = 'Requisitos: mínimo R$ 10MM de Patrimônio Líquido (PL); acima de 2 anos de atividade; acima de R$ 10MM de Receita Operacional Bruta.'
where id = 4; -- AXA

update seguradoras_rc set
  gerente = 'Ricardo',
  contato = '11 99788-6604',
  obs     = null
where id = 6; -- AVLA

commit;
