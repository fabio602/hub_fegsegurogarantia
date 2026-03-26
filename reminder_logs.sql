-- Anti-duplicação de e-mails automáticos (1 envio por venda/dia/tipo)
-- Execute este SQL no Supabase (SQL Editor) antes de ativar os crons.
--
-- Lembrete "Em andamento" (Edge Function remind-stale-sales):
-- - Secrets: RESEND_API_KEY, e opcional STALE_REMINDERS_FALLBACK_EMAIL (vendedor fora da lista fixa)
-- - GitHub Actions: .github/workflows/daily-stale-sales-reminder.yml com secrets SUPABASE_*

create table if not exists public.email_reminder_logs (
  id bigserial primary key,
  sale_id bigint not null,
  reminder_key text not null,          -- ex: 'stale_sales', 'pregao_client_d-1', 'pregao_seller_d0'
  reminder_date date not null,         -- data (BRT) para dedupe diário
  audience text not null,              -- 'client' | 'seller'
  to_email text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_reminder_logs_unique
  on public.email_reminder_logs (sale_id, reminder_key, reminder_date, to_email);

