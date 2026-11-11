/**
 * E09-02 — templates versionados, placeholders, PII, revisão (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  TemplateRuleError, createTemplateVersion, listTemplates, updateDraft,
  approveTemplate, previewTemplate, listVersions, resolveTemplate, mapTemplateError,
} from '../src/comm-template-repositories.js';
import { NotFoundError } from '../src/people-repositories.js';

type Q = { text: string; values: unknown[] };
function fakeClient(responder: (q: Q) => Array<Record<string, unknown>>) {
  const queries: Q[] = [];
  const client = {
    queries,
    query: vi.fn(async (...args: unknown[]) => {
      const q: Q = typeof args[0] === 'string'
        ? { text: args[0] as string, values: (args[1] as unknown[]) ?? [] }
        : { text: (args[0] as { text: string }).text, values: (args[0] as { values?: unknown[] }).values ?? [] };
      queries.push(q);
      const rows = responder(q);
      return { rows, rowCount: rows.length };
    }),
  };
  return { client, queries } as unknown as { client: import('pg').PoolClient & { queries: Q[] }; queries: Q[] };
}

const TPL = {
  id: 't1', tenant_id: 'T', event_key: 'enrollment.created', channel: 'inapp', locale: 'pt',
  version: 1, subject: 'Bem-vindo', body: 'Olá {{student_name}}, sua matrícula {{enrollment_id}} foi criada.',
  sample_payload: { student_name: 'Ana', enrollment_id: 'e-123' }, status: 'DRAFT',
  approved_by: null, approved_at: null, created_at: new Date(),
};

describe('createTemplateVersion (R1/R2/R4)', () => {
  it('valida placeholders vs sample; bloqueia PII literal; versiona; def deve existir', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ id: 'd1' }];
      if (q.text.includes('MAX(version)')) return [{ max_version: null }];
      if (q.text.includes('INSERT INTO comm_templates')) return [TPL];
      return [];
    });
    const t = await createTemplateVersion(client, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 'Bem-vindo', body: 'Olá {{student_name}}, matrícula {{enrollment_id}}.',
      samplePayload: { student_name: 'Ana', enrollment_id: 'e-123' },
    });
    expect(t.version).toBe(1);
    expect(queries[1]!.text).toContain('max_version');
    const { client: c0 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ id: 'd1' }];
      if (q.text.includes('MAX(version)')) return [{ max_version: 2 }];
      if (q.text.includes('INSERT INTO comm_templates')) return [{ ...TPL, version: 3 }];
      return [];
    });
    const t3 = await createTemplateVersion(c0, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: '{{student_name}}', samplePayload: { student_name: 'A' },
    });
    expect(t3.version).toBe(3); // R4: max+1
    // placeholder desconhecido → 422
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ id: 'd1' }];
      if (q.text.includes('MAX(version)')) return [{ max_version: null }];
      return [];
    });
    await expect(createTemplateVersion(c1, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: '{{nao_existe}}', samplePayload: { student_name: 'A' },
    })).rejects.toThrow(/placeholder/);
    // placeholder inválido (hífen) → 422
    await expect(createTemplateVersion(c1, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: '{{bad-name}}', samplePayload: {},
    })).rejects.toThrow(/placeholder/);
    // PII: CPF literal
    await expect(createTemplateVersion(c1, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: 'CPF 123.456.789-09 do aluno {{student_name}}', samplePayload: { student_name: 'A' },
    })).rejects.toThrow(/PII/);
    // PII: e-mail literal
    await expect(createTemplateVersion(c1, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: 'Envie para aluno@teste.com', samplePayload: {},
    })).rejects.toThrow(/PII/);
    // PII: telefone
    await expect(createTemplateVersion(c1, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: 's', body: 'Ligue (14) 99888-7766', samplePayload: {},
    })).rejects.toThrow(/PII/);
    // def inexistente → 404
    const { client: c2 } = fakeClient(() => []);
    await expect(createTemplateVersion(c2, 'T', {
      eventKey: 'zz', channel: 'inapp', locale: 'pt',
      subject: 's', body: 'b', samplePayload: {},
    })).rejects.toThrow(NotFoundError);
    // body vazio
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_event_defs')) return [{ id: 'd1' }];
      return [];
    });
    await expect(createTemplateVersion(c3, 'T', {
      eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt',
      subject: '', body: 'b', samplePayload: {},
    })).rejects.toThrow(TemplateRuleError);
  });
});

describe('updateDraft / approve (R3)', () => {
  it('só DRAFT edita; APPROVED imutável; approve grava approved_by/at; 404', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      if (q.text.includes('UPDATE comm_templates')) return [{ ...TPL, body: 'Novo {{student_name}}' }];
      return [];
    });
    const up = await updateDraft(client, 'T', 't1', { body: 'Novo {{student_name}}', samplePayload: { student_name: 'A' } });
    expect(up.body).toContain('Novo');
    // APPROVED → 422
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, status: 'APPROVED' }];
      return [];
    });
    await expect(updateDraft(c1, 'T', 't1', { body: 'x {{student_name}}', samplePayload: {} })).rejects.toThrow(/APPROVED/);
    // updateDraft com PII novo → 422
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      return [];
    });
    await expect(updateDraft(c2, 'T', 't1', { body: 'email: a@b.com', samplePayload: {} })).rejects.toThrow(/PII/);
    // approve
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      if (q.text.includes("SET status = 'APPROVED'")) return [{ ...TPL, status: 'APPROVED', approved_by: 'u1', approved_at: new Date() }];
      return [];
    });
    const ap = await approveTemplate(c3, 'T', 't1', 'u1');
    expect(ap.status).toBe('APPROVED');
    // approve de já APPROVED → 422
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, status: 'APPROVED' }];
      return [];
    });
    await expect(approveTemplate(c4, 'T', 't1', 'u1')).rejects.toThrow(TemplateRuleError);
    // 404
    const { client: c5 } = fakeClient(() => []);
    await expect(approveTemplate(c5, 'T', 'zz', 'u1')).rejects.toThrow(NotFoundError);
  });
});

describe('preview / resolve (R6)', () => {
  it('render substitui variáveis; variável ausente no payload → 422', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      return [];
    });
    const pv = await previewTemplate(client, 'T', 't1', { student_name: 'Bob', enrollment_id: 'e-9' });
    expect(pv).toContain('Bob');
    expect(pv).toContain('e-9');
    expect(pv).not.toContain('{{');
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      return [];
    });
    await expect(previewTemplate(c1, 'T', 't1', { student_name: 'Bob' })).rejects.toThrow(/payload/);
    // resolveTemplate direto
    const out = resolveTemplate('Olá {{name}}!', { name: 'X' });
    expect(out).toBe('Olá X!');
    expect(() => resolveTemplate('Olá {{name}}!', {})).toThrow(TemplateRuleError);
  });
});

describe('branches finais template', () => {
  it('paths: updateDraft 404; preview 404; sample string JSON.parse; patch parcial; placeholder inválido via updateDraft', async () => {
    // updateDraft 404 (132)
    const { client } = fakeClient(() => []);
    await expect(updateDraft(client, 'T', 'zz', { body: 'x', samplePayload: {} })).rejects.toThrow(NotFoundError);
    // preview 404 (169)
    const { client: c1 } = fakeClient(() => []);
    await expect(previewTemplate(c1, 'T', 'zz', {})).rejects.toThrow(NotFoundError);
    // updateDraft com sample_payload como STRING no banco (JSON.parse path 139-140)
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, sample_payload: '{"student_name":"A"}' }];
      if (q.text.includes('UPDATE comm_templates')) return [{ ...TPL, body: 'Oi {{student_name}}' }];
      return [];
    });
    const up = await updateDraft(c2, 'T', 't1', { body: 'Oi {{student_name}}' }); // sem patch.samplePayload e sem subject
    expect(up.body).toContain('Oi');
    // placeholder malformado via updateDraft (35-38 loop)
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      return [];
    });
    await expect(updateDraft(c3, 'T', 't1', { body: '{{bad-name}}', samplePayload: {} })).rejects.toThrow(/inválido/);
    // updateDraft só subject (patch.body null → newBody = tpl.body)
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      if (q.text.includes('UPDATE comm_templates')) return [{ ...TPL, subject: 'Novo assunto' }];
      return [];
    });
    const su = await updateDraft(c4, 'T', 't1', { subject: 'Novo assunto' });
    expect(su.subject).toBe('Novo assunto');
  });
});

describe('branches finais template 2', () => {
  it('paths: sample_payload objeto (139 não-string); subject vazio no update (140 throw); placeholder null-safe', async () => {
    // updateDraft com sample_payload OBJETO no banco (139 path objeto) e body vazio (140 throw)
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, sample_payload: { student_name: 'A' } }];
      return [];
    });
    await expect(updateDraft(client, 'T', 't1', { body: '  ' })).rejects.toThrow(/obrigat/);
    // subject vazio (140 segundo throw) com body ok
    await expect(updateDraft(client, 'T', 't1', { subject: ' ' })).rejects.toThrow(/obrigat/);
    // 139 col84: JSON.parse path com sample string + patch.samplePayload fornecido (objeto direto, sem parse)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, sample_payload: '{"student_name":"A"}' }];
      if (q.text.includes('UPDATE comm_templates')) return [{ ...TPL, body: 'Oi {{student_name}}' }];
      return [];
    });
    const up = await updateDraft(c1, 'T', 't1', { body: 'Oi {{student_name}}', samplePayload: { student_name: 'B' } });
    expect(up.body).toContain('Oi');
  });
});

describe('branches finais template 3', () => {
  it('updateDraft com sample_payload null no banco', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, sample_payload: null }];
      if (q.text.includes('UPDATE comm_templates')) return [{ ...TPL, body: 'Oi {{student_name}}' }];
      return [];
    });
    const up = await updateDraft(client, 'T', 't1', { body: 'Oi {{student_name}}', samplePayload: { student_name: 'A' } });
    expect(up.body).toContain('Oi');
    // sem patch e tpl null → {} vazio → placeholder sem sample → 422
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL, sample_payload: null, body: 'Oi {{student_name}}' }];
      return [];
    });
    await expect(updateDraft(c1, 'T', 't1', { subject: 's' })).rejects.toThrow(/sample_payload/);
  });
});

describe('list / versions / map', () => {
  it('filtros; versões do mesmo triplo; mapTemplateError', async () => {
    const { client, queries } = fakeClient(() => [TPL]);
    await listTemplates(client, 'T', {});
    expect(queries[0]!.values).toEqual(['T']);
    await listTemplates(client, 'T', { eventKey: 'enrollment.created', channel: 'inapp', locale: 'pt', status: 'APPROVED' });
    expect(queries[1]!.values).toEqual(['T', 'enrollment.created', 'inapp', 'pt', 'APPROVED']);
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM comm_templates WHERE id =')) return [{ ...TPL }];
      if (q.text.includes('ORDER BY version DESC')) return [{ ...TPL, version: 2 }, TPL];
      return [];
    });
    const vs = await listVersions(c1, 'T', 't1');
    expect(vs).toHaveLength(2);
    expect(vs[0]!.version).toBe(2);
    const { client: c2 } = fakeClient(() => []);
    await expect(listVersions(c2, 'T', 'zz')).rejects.toThrow(NotFoundError);
    expect(mapTemplateError(new TemplateRuleError('x')).status).toBe(422);
    expect(mapTemplateError(new NotFoundError('x')).status).toBe(404);
    expect(mapTemplateError(new Error('x')).status).toBe(500);
  });
});
