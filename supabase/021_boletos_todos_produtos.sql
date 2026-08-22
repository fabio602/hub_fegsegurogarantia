-- Boletos Seguro Residencial
CREATE TABLE IF NOT EXISTS residential_boletos (
  id                    bigserial PRIMARY KEY,
  residential_client_id bigint NOT NULL REFERENCES residential_clients(id) ON DELETE CASCADE,
  parcela               integer NOT NULL,
  vencimento            date,
  valor                 numeric(10,2),
  url                   text,
  pago                  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE residential_boletos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_residential_boletos" ON residential_boletos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Boletos Seguro AUTO
CREATE TABLE IF NOT EXISTS auto_boletos (
  id             bigserial PRIMARY KEY,
  auto_client_id bigint NOT NULL REFERENCES auto_clients(id) ON DELETE CASCADE,
  parcela        integer NOT NULL,
  vencimento     date,
  valor          numeric(10,2),
  url            text,
  pago           boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auto_boletos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_auto_boletos" ON auto_boletos FOR ALL TO authenticated USING (true) WITH CHECK (true);
