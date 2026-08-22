-- Adiciona campo nome_contato na tabela rc_clients
ALTER TABLE rc_clients ADD COLUMN IF NOT EXISTS nome_contato text;
