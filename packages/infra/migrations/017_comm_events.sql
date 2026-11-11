-- E09-01: matriz de eventos de comunicação + fila local de mensagens (idempotente)
-- Sem envio externo: canais inapp/email são registro. E09-03 fará provedores.
CREATE TABLE IF NOT EXISTS comm_event_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  event_key TEXT NOT NULL CHECK (event_key ~ '^[a-z0-9._-]+$'),
  channel TEXT NOT NULL CHECK (channel IN ('inapp','email')),
  name TEXT NOT NULL,
  template_subject TEXT NOT NULL DEFAULT '',
  template_body TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_key, channel)
);
CREATE INDEX IF NOT EXISTS idx_comm_event_defs_tenant ON comm_event_defs(tenant_id);

CREATE TABLE IF NOT EXISTS comm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('inapp','email')),
  recipient_user_id UUID,
  lead_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','DELIVERED_LOCAL','SKIPPED')),
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, recipient_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (lead_id, tenant_id) REFERENCES leads(id, tenant_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_comm_messages_tenant_status ON comm_messages(tenant_id, status);
