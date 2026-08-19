CREATE TABLE IF NOT EXISTS garantia_locaticia_config (
  id SERIAL PRIMARY KEY,
  taxa_anual NUMERIC NOT NULL DEFAULT 0.10,
  setup_centavos INTEGER NOT NULL DEFAULT 25000,
  fator_boleto NUMERIC NOT NULL DEFAULT 1.291824,
  parcelas INTEGER NOT NULL DEFAULT 12,
  garantidora TEXT NOT NULL DEFAULT 'Fiantec',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO garantia_locaticia_config (taxa_anual, setup_centavos, fator_boleto, parcelas, garantidora)
SELECT 0.10, 25000, 1.291824, 12, 'Fiantec'
WHERE NOT EXISTS (SELECT 1 FROM garantia_locaticia_config);

ALTER TABLE garantia_locaticia_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "gl_config_read" ON garantia_locaticia_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "gl_config_admin" ON garantia_locaticia_config
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br')
  WITH CHECK (auth.jwt() ->> 'email' = 'fabio@fegsegurogarantia.com.br');

CREATE TABLE IF NOT EXISTS simulacoes_garantia_locaticia (
  id SERIAL PRIMARY KEY,
  nome_cliente TEXT,
  endereco TEXT,
  tipo_imovel TEXT DEFAULT 'residencial',
  aluguel_centavos INTEGER NOT NULL,
  outros_centavos INTEGER NOT NULL DEFAULT 0,
  forma_pagamento TEXT NOT NULL,
  data_primeiro_pagamento DATE NOT NULL,
  base_mensal_centavos INTEGER NOT NULL,
  base_anual_centavos INTEGER NOT NULL,
  premio_centavos INTEGER NOT NULL,
  setup_centavos INTEGER NOT NULL,
  total_avista_centavos INTEGER NOT NULL,
  total_forma_centavos INTEGER NOT NULL,
  taxa_anual_snapshot NUMERIC NOT NULL,
  setup_snapshot INTEGER NOT NULL,
  fator_boleto_snapshot NUMERIC,
  parcelas_snapshot INTEGER NOT NULL,
  garantidora_snapshot TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid()
);

ALTER TABLE simulacoes_garantia_locaticia ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "gl_sim_all" ON simulacoes_garantia_locaticia
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
