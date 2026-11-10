-- E03-A: outbox persistente transacional
-- at-least-once + dedupe por id; worker com SKIP LOCKED e backoff.
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_tenant_id ON outbox_events(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(processed_at, next_attempt_at) WHERE processed_at IS NULL;
