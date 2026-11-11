-- 012: E06-04 — price books versionados + propostas + trilha de eventos
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_leads_tenant_id') THEN
    ALTER TABLE leads ADD CONSTRAINT uq_leads_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS price_books (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_price_books_tenant_id') THEN
    ALTER TABLE price_books ADD CONSTRAINT uq_price_books_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS price_items (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  price_book_id UUID NOT NULL,
  course_name TEXT NOT NULL,
  duration_months INT NOT NULL CHECK (duration_months > 0),
  price_cents INT NOT NULL CHECK (price_cents > 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  version INT NOT NULL DEFAULT 1,
  superseded_by UUID,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, price_book_id) REFERENCES price_books(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_price_items_tenant_book ON price_items(tenant_id, price_book_id, effective_from);

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id UUID NOT NULL,
  price_item_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','sent','accepted','rejected','expired','canceled')),
  discount_cents INT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  discount_pct NUMERIC(5,2),
  subtotal_cents INT NOT NULL,
  total_cents INT NOT NULL CHECK (total_cents >= 0),
  valid_until TIMESTAMPTZ NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_by_name TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads(tenant_id, id) ON DELETE CASCADE
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_proposals_tenant_id') THEN
    ALTER TABLE proposals ADD CONSTRAINT uq_proposals_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_price_items_tenant_id') THEN
    ALTER TABLE price_items ADD CONSTRAINT uq_price_items_tenant_id UNIQUE (tenant_id, id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_proposals_tenant_status ON proposals(tenant_id, status);

CREATE TABLE IF NOT EXISTS proposal_events (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  proposal_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES proposals(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_proposal_events_prop ON proposal_events(tenant_id, proposal_id, at);
