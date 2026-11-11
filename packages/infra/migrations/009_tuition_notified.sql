-- 009_tuition_notified.sql
-- E03-C: trilha de notificação do consumer (NULL p/ legados)
ALTER TABLE tuitions ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
