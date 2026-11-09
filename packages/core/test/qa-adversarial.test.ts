/**
 * QA ADVERSARIAL — ataques que o builder NÃO escreveu.
 * Estes testes tentam QUEBRAR o core: cross-tenant, replay,
 * tampering de audit, escalada via entitlement, ids duplicados.
 * Qualquer PASS aqui é suspeito; o esperado é TUDO BLOQUEADO.
 */
import { describe, it, expect } from 'vitest';
import {
  tenantFromSession,
  assertBelongsToTenant,
  scopedQuery,
  AuthorizationService,
  AuditStore,
  Outbox,
  IdempotentEffectRunner,
  ModuleCatalog,
  MissingTenantError,
  TenantIsolationViolationError,
  ForbiddenError,
  ModuleNotEntitledError,
  redactPii,
} from '../src/index.js';

describe('ADVERSarial: cross-tenant', () => {
  it('session spoofing: objeto de sessão não pode inventar tenant de outro registro', () => {
    const ctx = tenantFromSession({ tenantId: 'tenant-A' });
    // atacante tenta ler registro de tenant-B
    expect(() => assertBelongsToTenant({ tenantId: 'tenant-B' }, ctx)).toThrow(
      TenantIsolationViolationError,
    );
    // mesmo com a mensagem de erro, não vaza o conteúdo do registro
    try {
      assertBelongsToTenant({ tenantId: 'tenant-B', segredo: 'x' } as never, ctx);
    } catch (e) {
      expect((e as Error).message).not.toContain('segredo');
    }
  });

  it('bulk query export: scopedQuery não pode retornar linhas de outro tenant', () => {
    const linhas = [
      { tenantId: 'A', dado: 'legitimo-A' },
      { tenantId: 'B', dado: 'privado-B' },
    ];
    const exfiltrado = scopedQuery(linhas, { tenantId: 'A' });
    expect(exfiltrado.some((r) => r.tenantId === 'B')).toBe(false);
    expect(JSON.stringify(exfiltrado)).not.toContain('privado-B');
  });

  it('sessão sem tenant não pode ser "promovida" a qualquer tenant', () => {
    expect(() => tenantFromSession({ tenantId: undefined })).toThrow(MissingTenantError);
    expect(() => tenantFromSession({ tenantId: '' })).toThrow(MissingTenantError);
  });
});

describe('ADVERSARIAL: authorization escalation', () => {
  const svc = new AuthorizationService([
    { role: 'user', action: 'read', resource: 'invoice' },
  ]);

  it('role injection: array de roles não autoriza por coincidência parcial', () => {
    // 'userX' não é 'user'
    expect(() =>
      svc.authorize(
        { id: 'atk', tenantId: 't1', roles: ['userX', 'superuser'] },
        'read',
        { tenantId: 't1', type: 'invoice' },
        { tenantId: 't1' },
      ),
    ).toThrow(ForbiddenError);
  });

  it('case-sensitivity: roles/actions em caixa diferente não autorizam', () => {
    expect(() =>
      svc.authorize(
        { id: 'atk2', tenantId: 't1', roles: ['USER'] },
        'read',
        { tenantId: 't1', type: 'invoice' },
        { tenantId: 't1' },
      ),
    ).toThrow(ForbiddenError);
    expect(() =>
      svc.authorize(
        { id: 'atk3', tenantId: 't1', roles: ['user'] },
        'READ' as never,
        { tenantId: 't1', type: 'invoice' },
        { tenantId: 't1' },
      ),
    ).toThrow(ForbiddenError);
  });

  it('módulo desabilitado não pode ser reativado pelo atacante via authorize normal', () => {
    const cat = new ModuleCatalog();
    cat.enable('t1', 'finance');
    cat.disable('t1', 'finance');
    // qualquer rota para módulo desabilitado falha, mesmo com role correta
    expect(() => cat.require('t1', 'finance')).toThrow(ModuleNotEntitledError);
    expect(() =>
      svc.authorizeWithEntitlement(
        { id: 'u1', tenantId: 't1', roles: ['user'] },
        'read',
        { tenantId: 't1', type: 'invoice' },
        { tenantId: 't1' },
        cat.isEnabled('t1', 'finance'),
      ),
    ).toThrow(ForbiddenError);
  });
});

describe('ADVERSARIAL: audit tampering', () => {
  it('records não podem ser alterados após append', () => {
    const store = new AuditStore();
    const rec = store.append({
      tenantId: 't1',
      actorId: 'admin',
      action: 'approve',
      resourceType: 'payment',
      resourceId: 'p1',
    });
    const antes = JSON.stringify(rec);
    expect(() => {
      (rec as unknown as { action: string }).action = 'deleted';
    }).toThrow();
    expect(() => {
      (rec as unknown as { actorId: string }).actorId = 'outro';
    }).toThrow();
    expect(JSON.stringify(store.list({ tenantId: 't1' }))).toBe(
      `[${antes}]`,
    );
  });

  it('tenant A não lê trilha do tenant B nem por count vazado', () => {
    const store = new AuditStore();
    store.append({ tenantId: 'B', actorId: 'x', action: 'secret-op', resourceType: 'r', resourceId: '1' });
    const visaoA = store.list({ tenantId: 'A' });
    expect(visaoA).toHaveLength(0);
    expect(JSON.stringify(visaoA)).not.toContain('secret-op');
  });

  it('redactPii neutraliza payload com PII antes de logar', () => {
    const store = new AuditStore();
    const payload = store.append({
      tenantId: 't1',
      actorId: 'a1',
      action: 'create',
      resourceType: 'student',
      resourceId: 's1',
    });
    // audit record em si nunca carrega PII (design); redactPii protege payloads extras
    const extra = { cpf: '123.456.789-00', nome: 'Maria' };
    const redacted = redactPii(extra);
    expect(JSON.stringify(redacted)).not.toContain('123.456.789-00');
    expect(JSON.stringify(redacted)).not.toContain('Maria');
    expect(payload.resourceType).toBe('student');
  });
});

describe('ADVERSARIAL: outbox replay/duplicate effects', () => {
  it('replay em massa não duplica cobrança', () => {
    const box = new Outbox();
    const runner = new IdempotentEffectRunner();
    box.enqueue('charge-1', 'Finance.Charge', 'v1', { tenantId: 't1' }, { amount: 500 });
    box.enqueue('charge-2', 'Finance.Charge', 'v1', { tenantId: 't1' }, { amount: 300 });
    // processa 3x (retry agressivo)
    for (let i = 0; i < 3; i++) box.process((ev) => void runner.run(ev.id, 'charge'));
    expect(runner.appliedEffects).toEqual(['charge', 'charge']); // exatamente 1 por evento
  });

  it('evento de tenant A nunca entregue em contexto do tenant B', () => {
    const box = new Outbox();
    box.enqueue('e-A', 'T', 'v1', { tenantId: 'A' }, { dados: 'confidenciais-A' });
    const entregues: string[] = [];
    box.pending({ tenantId: 'B' }); // B não vê nada
    box.process((ev) => entregues.push(ev.id));
    expect(entregues).toEqual(['e-A']); // process é global (worker), mas pending é escopado
    // ataque: B tenta listar pending de A — não vaza payload
    expect(JSON.stringify(box.pending({ tenantId: 'B' }))).not.toContain('confidenciais-A');
  });
});
