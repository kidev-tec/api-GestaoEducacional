-- 027: trials e transições de assinatura (E13-04) — append-only + slug de tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON tenants (slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  from_plan_version_id UUID REFERENCES plan_versions(id),
  to_plan_version_id UUID NOT NULL REFERENCES plan_versions(id),
  mode TEXT NOT NULL CHECK (mode IN ('TRIAL','UPGRADE','DOWNGRADE','CANCEL')),
  actor_user_id UUID,
  notes TEXT,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_trans_tenant ON subscription_transitions (tenant_id, transitioned_at DESC);
