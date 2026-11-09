/**
 * RF-018 — Observabilidade segura: request-id e log JSON sem PII.
 * Campos permitidos, exclusivamente: requestId, tenantId, method,
 * route, status, durationMs. Nada de body/payload/secret/keys.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false;
  return UUID_RE.test(value);
}

/** Aceita UUID válido do header; caso contrário gera um (nunca ecoa input cru). */
export function resolveRequestId(headerValue: string | undefined): string {
  return isUuid(headerValue) ? (headerValue as string) : crypto.randomUUID();
}

export interface RequestLogLine {
  requestId: string;
  tenantId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

const ALLOWED = ['requestId', 'tenantId', 'method', 'route', 'status', 'durationMs'] as const;
const MAX_ROUTE_LEN = 120;

export function safeLogLine(input: RequestLogLine | Record<string, unknown>): string {
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key === 'tenantId' && !src.tenantId) continue; // rotas públicas: sem tenant
    out[key] = key === 'route' ? String(src.route).slice(0, MAX_ROUTE_LEN) : src[key];
  }
  return JSON.stringify(out);
}
