-- Vendedores e metas mensais por vendedor (Gestão de Resultados — Metas do Mês).

CREATE TABLE IF NOT EXISTS public.sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  share numeric NOT NULL DEFAULT 0.5,
  days_per_week integer NOT NULL DEFAULT 5,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monthly_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  target numeric NOT NULL DEFAULT 0,
  UNIQUE(seller_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_targets_seller_year ON public.monthly_targets (seller_id, year);

COMMENT ON TABLE public.sellers IS 'Vendedores para metas proporcionais e selects do formulário de vendas.';
COMMENT ON TABLE public.monthly_targets IS 'Meta mensal explícita por vendedor; ausência usa fallback share × meta empresa.';

-- Dados iniciais (ignora duplicata por nome se já existir — ajuste manual no SQL Editor se necessário)
INSERT INTO public.sellers (name, email, share, days_per_week)
SELECT v.name, v.email, v.share, v.days_per_week
FROM (VALUES
  ('Rafael', 'rafael@fegsegurogarantia.com.br', 0.70::numeric, 5),
  ('Andréia', 'andreia@fegsegurogarantia.com.br', 0.30::numeric, 2)
) AS v(name, email, share, days_per_week)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sellers s WHERE s.name = v.name
);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_sellers_all" ON public.sellers;
CREATE POLICY "authenticated_sellers_all"
  ON public.sellers
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_monthly_targets_all" ON public.monthly_targets;
CREATE POLICY "authenticated_monthly_targets_all"
  ON public.monthly_targets
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Hub usa client anon em desenvolvimento; restrinja no Supabase (service role / JWT) em produção se necessário.
DROP POLICY IF EXISTS "anon_sellers_all" ON public.sellers;
CREATE POLICY "anon_sellers_all"
  ON public.sellers
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_monthly_targets_all" ON public.monthly_targets;
CREATE POLICY "anon_monthly_targets_all"
  ON public.monthly_targets
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
