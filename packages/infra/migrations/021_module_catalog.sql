-- E13-01: catálogo global de módulos vendáveis com grafo de dependências (idempotente)
CREATE TABLE IF NOT EXISTS module_catalog (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('FREE','INCLUDED','PAID')),
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  requires TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tier <> 'FREE' OR price_cents = 0)
);

-- Seed idempotente (R1 grafo acíclico por construção)
INSERT INTO module_catalog (key, name, tier, price_cents, requires) VALUES
  ('core', 'Core', 'FREE', 0, '{}'),
  ('secretaria', 'Secretaria', 'INCLUDED', 0, '{core}'),
  ('crm', 'CRM', 'PAID', 9900, '{secretaria}'),
  ('financeiro', 'Financeiro', 'PAID', 14900, '{secretaria}'),
  ('academico', 'Acadêmico', 'PAID', 14900, '{secretaria}'),
  ('portais', 'Portais', 'PAID', 9900, '{academico}'),
  ('mensageria', 'Mensageria', 'PAID', 7900, '{core}'),
  ('bi', 'BI', 'PAID', 19900, '{core}'),
  ('ia', 'IA', 'PAID', 24900, '{bi}')
ON CONFLICT (key) DO NOTHING;
