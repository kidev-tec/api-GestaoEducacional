-- E12-05: webhooks de saída com assinatura HMAC e DLQ (idempotente)
-- Entrega local nesta fase (adapter registra; sem rede real).
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL CHECK (length(secret) >= 32),
  events TEXT[] NOT NULL DEFAULT '{*}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, url)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  endpoint_id UUID NOT NULL,
  outbox_id UUID,
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','FAILED')),
  attempts INT NOT NULL DEFAULT 0,
  response_code INT,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wh_deliveries_pending ON webhook_deliveries(tenant_id, status, next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_wh_deliveries_dlq ON webhook_deliveries(tenant_id, status) WHERE status = 'FAILED';
