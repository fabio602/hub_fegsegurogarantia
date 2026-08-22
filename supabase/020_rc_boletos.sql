-- Tabela de boletos dos clientes RC
CREATE TABLE IF NOT EXISTS rc_boletos (
  id          bigserial PRIMARY KEY,
  rc_client_id bigint NOT NULL REFERENCES rc_clients(id) ON DELETE CASCADE,
  parcela     integer NOT NULL,
  vencimento  date,
  valor       numeric(10,2),
  url         text,
  pago        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rc_boletos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_rc_boletos"
  ON rc_boletos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
