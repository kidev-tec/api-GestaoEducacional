/**
 * RF-018 — Request-id e logs seguros (G7 hardening).
 * Contratos: x-request-id aceito (UUID) ou gerado; log JSON só com
 * requestId/tenantId/method/route/status/durationMs — nunca body,
 * idempotency-key, refs de aluno/oferta nem segredo.
 */
import { describe, it, expect } from 'vitest';
import { isUuid, safeLogLine, resolveRequestId } from '../src/obs.js';

describe('resolveRequestId', () => {
  it('aceita UUID válido vindo do header', () => {
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(resolveRequestId(id)).toBe(id);
  });

  it('rejeita valor não-UUID e gera outro (não ecoa input cru)', () => {
    const evil = "f47ac10b-58cc-4372-a567-0e02b2c3d479'; DROP--";
    const resolved = resolveRequestId(evil);
    expect(resolved).not.toBe(evil);
    expect(isUuid(resolved)).toBe(true);
  });

  it('gera UUID quando header ausente', () => {
    expect(isUuid(resolveRequestId(undefined))).toBe(true);
  });
});

describe('safeLogLine', () => {
  const base = {
    requestId: 'r1',
    tenantId: 'tenant-a',
    method: 'POST',
    route: '/v1/ledger',
    status: 201,
    durationMs: 12,
  };

  it('emite somente os campos permitidos', () => {
    const line = JSON.parse(safeLogLine(base));
    expect(Object.keys(line).sort()).toEqual(
      ['durationMs', 'method', 'requestId', 'route', 'status', 'tenantId'].sort(),
    );
  });

  it('omite tenantId quando vazio (rotas públicas)', () => {
    const line = JSON.parse(safeLogLine({ ...base, tenantId: '' }));
    expect(line).not.toHaveProperty('tenantId');
  });

  it('nunca inclui body/secret mesmo que passem no objeto', () => {
    const dirty = { ...base, body: { studentId: 'aluno-x' }, secret: 'shh' } as Record<string, unknown>;
    const line = JSON.parse(safeLogLine(dirty as never));
    expect(line).not.toHaveProperty('body');
    expect(line).not.toHaveProperty('secret');
  });

  it('trunca route acima de 120 chars (evita log inflado)', () => {
    const long = '/' + 'a'.repeat(300);
    const line = JSON.parse(safeLogLine({ ...base, route: long }));
    expect((line.route as string).length).toBeLessThanOrEqual(120);
  });
});
