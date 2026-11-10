-- 007_finance_integrity.sql
-- E07-B: integridade financeira — colunas opcionais p/ partidas equilibradas (RF-02) + índice de REVERSAL.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS account TEXT;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS doc_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ledger_reverses ON ledger_entries(reverses) WHERE reverses IS NOT NULL;
