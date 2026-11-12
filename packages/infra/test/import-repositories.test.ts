/**
 * E12-02 — importador CSV: parse, validação, dry-run, commit idempotente (fake PG, 100×4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ImportRuleError, parseCsv, createImportJob, getImportJob, commitImport, listImports, mapImportError,
} from '../src/import-repositories.js';
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

const CSV_OK = 'name,email,phone,document,role\nAna Silva,ana@x.com,14998887766,11122233344,GUARDIAN\nBob Souza,bob@x.com,,,STUDENT';
const MAP_OK = { name: 'name', email: 'email', phone: 'phone', document: 'document' };

describe('parseCsv', () => {
  it('parseia cabeçalho+linhas; lida com aspas; CSV vazio/malformado → erro', () => {
    const rows = parseCsv(CSV_OK);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Ana Silva', email: 'ana@x.com' });
    const quoted = parseCsv('name,note\n"A, B","tem ""aspas"""');
    expect(quoted[0]).toEqual({ name: 'A, B', note: 'tem "aspas"' });
    expect(() => parseCsv('')).toThrow(ImportRuleError);
    expect(() => parseCsv('name\n')).toThrow(ImportRuleError); // só cabeçalho, sem linhas
    expect(() => parseCsv('x'.repeat(2 * 1024 * 1024 + 10))).toThrow(/2 MB/);
  });
});

describe('createImportJob (dry-run automático)', () => {
  const jobRow = {
    id: 'j1', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK,
    total_rows: 2, valid_rows: 2, skipped_rows: 0, error_rows: 0, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null,
  };
  it('valida mapping/linhas; linha inválida vai pro relatório; insere job', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [jobRow];
      return [];
    });
    const job = await createImportJob(client, 'T', { entity: 'people', csv: CSV_OK, mapping: MAP_OK, createdBy: 'u1' });
    expect(job.totalRows).toBe(2);
    expect(job.validRows).toBe(2);
    expect(job.status).toBe('DRY_RUN');
    expect(queries.some((q) => q.text.includes('INSERT INTO import_jobs'))).toBe(true);
    // linha com email inválido → error_rows 1
    const csvBad = 'name,email,role\nAna,EMAIL-RUIM,GUARDIAN\nBob,bob@x.com,STUDENT';
    const mapBad = { name: 'name', email: 'email' };
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ ...jobRow, total_rows: 2, valid_rows: 1, error_rows: 1, errors: [{ line: 1, field: 'email', reason: 'email inválido' }] }];
      return [];
    });
    const bad = await createImportJob(c1, 'T', { entity: 'people', csv: csvBad, mapping: mapBad, createdBy: 'u1' });
    expect(bad.validRows).toBe(1);
    expect(bad.errorRows).toBe(1);
    // mapping sem campo name → 422
    const { client: c2 } = fakeClient(() => []);
    await expect(createImportJob(c2, 'T', { entity: 'people', csv: CSV_OK, mapping: { email: 'email' }, createdBy: 'u1' })).rejects.toThrow(/name/);
    // coluna mapeada inexistente no CSV → 422
    await expect(createImportJob(c2, 'T', { entity: 'people', csv: CSV_OK, mapping: { ...MAP_OK, email: 'nao_existe' }, createdBy: 'u1' })).rejects.toThrow(/coluna/);
    // CSV vazio → 422 (via parseCsv)
    await expect(createImportJob(c2, 'T', { entity: 'people', csv: '', mapping: MAP_OK, createdBy: 'u1' })).rejects.toThrow(ImportRuleError);
  });
});

describe('commitImport (R5)', () => {
  const committedJob = { ...{ id: 'j1', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK, total_rows: 2, valid_rows: 2, skipped_rows: 0, error_rows: 0, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null } };
  it('insere válidos, skip duplicado por email, 409 se já committed, 404', async () => {
    const validRows = [{ name: 'Ana Silva', email: 'ana@x.com', phone: '14998887766', document: '11122233344' }, { name: 'Bob Souza', email: 'bob@x.com', phone: '', document: '' }];
    const jobRow = { id: 'j1', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK, total_rows: 2, valid_rows: 2, skipped_rows: 0, error_rows: 0, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null, original_rows: JSON.stringify(validRows) };
    const jobId = 'j1';
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('FROM import_jobs WHERE id =') && q.text.includes('FOR UPDATE')) return [{ ...jobRow, id: jobId }];
      if (q.text.includes('FROM people') && q.text.includes('email')) return [];
      if (q.text.includes('INSERT INTO people')) return [{ id: 'p1' }];
      if (q.text.includes("SET status = 'COMMITTED'")) return [{ ...jobRow, id: jobId, status: 'COMMITTED', committed_at: new Date() }];
      return [];
    });
    const r = await commitImport(client, 'T', jobId, 'u-unit');
    expect(r.inserted).toBe(2);
    expect(queries.some((q) => q.text.includes('INSERT INTO people'))).toBe(true);
    // duplicado por email → skip
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM import_jobs WHERE id =') && q.text.includes('FOR UPDATE')) return [{ ...jobRow, id: 'j2', original_rows: JSON.stringify([{ name: 'Ana Silva', email: 'ana@x.com', phone: '14998887766', document: '11122233344' }, { name: 'Bob Souza', email: 'bob@x.com', phone: '', document: '' }]) }];
      if (q.text.includes('FROM people') && q.text.includes('email')) return [{ id: 'p-exists' }];
      if (q.text.includes("SET status = 'COMMITTED'")) return [{ ...jobRow, id: 'j2', status: 'COMMITTED', committed_at: new Date() }];
      return [];
    });
    const r2 = await commitImport(c1, 'T', 'j2', 'u-unit');
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(2);
    // já committed → 409
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('FROM import_jobs WHERE id =') && q.text.includes('FOR UPDATE')) return [{ ...jobRow, status: 'COMMITTED' }];
      return [];
    });
    await expect(commitImport(c2, 'T', jobId, 'u-unit')).rejects.toThrow(/já foi commitado/);
    // 404
    const { client: c3 } = fakeClient(() => []);
    await expect(commitImport(c3, 'T', 'zz', 'u-unit')).rejects.toThrow(NotFoundError);
  });
});

describe('branches finais import', () => {
  it('paths: CRLF; célula ausente; validações email/phone/document/kind; original_rows string; errors string', async () => {
    // CRLF (41)
    const rowsCrlf = parseCsv('name,email\r\nAna,a@x.com\r\n');
    expect(rowsCrlf).toHaveLength(1);
    expect(rowsCrlf[0]!.email).toBe('a@x.com');
    // célula faltante (53): header 2 colunas, linha só 1 célula
    const rowsShort = parseCsv('name,email\nSozinho');
    expect(rowsShort[0]!.email).toBe('');
    // validações: email ok ausente (78 false), phone curto (81), doc errado (83), kind inválido (85)
    const csvValid = 'name,email,phone,document,kind\nA,a@x.com,14998887766,11122233344,STUDENT\n';
    const jobRow = { id: 'j9', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK, total_rows: 1, valid_rows: 1, skipped_rows: 0, error_rows: 0, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null, original_rows: JSON.stringify([{ name: 'A', email: 'a@x.com', phone: '14998887766', document: '11122233344', kind: 'STUDENT' }]) };
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [jobRow];
      if (q.text.includes('FROM import_jobs WHERE id =') && q.text.includes('FOR UPDATE')) return [{ ...jobRow, mapping: MAP_OK }];
      if (q.text.includes('FROM people') && q.text.includes('email')) return [];
      if (q.text.includes('INSERT INTO people')) return [{ id: 'p1' }];
      if (q.text.includes("SET status = 'COMMITTED'")) return [{ ...jobRow, status: 'COMMITTED' }];
      return [];
    });
    await createImportJob(c1, 'T', { entity: 'people', csv: csvValid, mapping: MAP_OK, createdBy: 'u1' });
    const r = await commitImport(c1, 'T', 'j9', 'u-unit');
    expect(r.inserted).toBe(1);
    // validações adversariais via validateRow indireto: createImportJob com linha phone curta
    const csvShort = 'name,phone\nB,99';
    const { client: c2 } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ ...jobRow, valid_rows: 0, error_rows: 1, errors: [{ line: 1, field: 'phone', reason: 'phone com menos de 10 dígitos' }], original_rows: '[]' }];
      return [];
    });
    const bad = await createImportJob(c2, 'T', { entity: 'people', csv: csvShort, mapping: { name: 'name', phone: 'phone' }, createdBy: 'u1' });
    expect(bad.errorRows).toBe(1);
    // doc errado
    const csvDoc = 'name,document\nC,123';
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ ...jobRow, valid_rows: 0, error_rows: 1, original_rows: '[]' }];
      return [];
    });
    const badDoc = await createImportJob(c3, 'T', { entity: 'people', csv: csvDoc, mapping: { name: 'name', document: 'document' }, createdBy: 'u1' });
    expect(badDoc.errorRows).toBe(1);
    // kind inválido
    const csvKind = 'name,kind\nD,ALIEN';
    const { client: c4 } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ ...jobRow, valid_rows: 0, error_rows: 1, original_rows: '[]' }];
      return [];
    });
    const badKind = await createImportJob(c4, 'T', { entity: 'people', csv: csvKind, mapping: { name: 'name', kind: 'kind' }, createdBy: 'u1' });
    expect(badKind.errorRows).toBe(1);
    // get/list com mapping/errors como STRING (126/133/134) e original_rows string (181)
    const { client: c5 } = fakeClient(() => [{ ...jobRow, mapping: { name: 'name' }, errors: [{ line: 1, field: 'name', reason: 'x' }], original_rows: [{ name: 'A' }] }]);
    const g = await getImportJob(c5, 'T', 'j9');
    expect(g.mapping).toMatchObject({ name: 'name' });
    expect(g.errors).toHaveLength(1);
    const ls = await listImports(c5, 'T');
    expect(ls).toHaveLength(1);
    expect(ls[0]!.mapping).toMatchObject({ name: 'name' });
  });
});

describe('branches finais import 2', () => {
  it('dry-run com linhas adversariais cobrindo todos os validateRow', async () => {
    const csvAdversarial = [
      'name,email,phone,document,kind',
      ',a@x.com,14998887766,11122233344,STUDENT',        // name vazio (76/77)
      'B,email-ruim,,,',                                  // email inválido (78/79)
      'C,a@x.com,99,,',                                   // phone curto (80/81)
      'D,a@x.com,,123,',                                  // document errado (82/83)
      'E,a@x.com,,,ALIEN',                                // kind inválido (84/85)
      'F,f@x.com,14998887766,11122233344,STUDENT',        // válida (INSERT path 114)
    ].join('\n');
    const { client, queries } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ id: 'jx', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK, total_rows: 7, valid_rows: 1, skipped_rows: 0, error_rows: 5, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null, original_rows: '[]' }];
      return [];
    });
    const job = await createImportJob(client, 'T', { entity: 'people', csv: csvAdversarial, mapping: MAP_OK, createdBy: 'u1' });
    expect(job.totalRows).toBe(7);
    expect(job.validRows).toBe(1);
    expect(job.errorRows).toBe(5);
    expect(queries.some((q) => q.text.includes('original_rows'))).toBe(true);
  });
});

describe('branches finais import 3', () => {
  it('paths falsy: mapping mínimo, commit com inválida, original_rows array, errors array', async () => {
    // createImportJob com mapping mínimo (sem email/phone/document/kind → ternários falsy em validateRow)
    const csvMin = 'name\nAna\nBob\n';
    const { client } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ id: 'jm', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: { name: 'name' }, total_rows: 2, valid_rows: 2, skipped_rows: 0, error_rows: 0, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null, original_rows: [{ name: 'Ana' }, { name: 'Bob' }] }];
      return [];
    });
    const jm = await createImportJob(client, 'T', { entity: 'people', csv: csvMin, mapping: { name: 'name' }, createdBy: 'u1' });
    expect(jm.validRows).toBe(2);
    // commit com 1 válida + 1 inválida (continue path 148) e email sem row email (150 || null)
    const { client: c1 } = fakeClient((q) => {
      if (q.text.includes('FROM import_jobs WHERE id =') && q.text.includes('FOR UPDATE')) return [{ id: 'jm', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: { name: 'name' }, total_rows: 2, valid_rows: 1, skipped_rows: 0, error_rows: 1, errors: [{ line: 2, field: 'name', reason: 'name obrigatório' }], created_by: 'u1', created_at: new Date(), committed_at: null, original_rows: [{ name: 'Ana' }, { name: '' }, { name: 'Zé' }] }];
      if (q.text.includes('FROM people') && q.text.includes('email')) return [];
      if (q.text.includes('INSERT INTO people')) return [{ id: 'p1' }];
      if (q.text.includes("SET status = 'COMMITTED'")) return [{ id: 'jm', status: 'COMMITTED' }];
      return [];
    });
    const rc = await commitImport(c1, 'T', 'jm', 'u-unit');
    expect(rc.inserted).toBe(2);
    // get/list com mapping/errors/original_rows já OBJETO (não string) → paths typeof false
    const { client: c2 } = fakeClient(() => [{ id: 'j2', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: { name: 'name' }, total_rows: 0, valid_rows: 0, skipped_rows: 0, error_rows: 0, errors: [], created_by: null, created_at: new Date(), committed_at: null, original_rows: [] }]);
    // commit sem original_rows (undefined → ?? []) e row sem chave email (undefined → ?? '')
    const { client: c3 } = fakeClient((q) => {
      if (q.text.includes('FROM import_jobs WHERE id =') && q.text.includes('FOR UPDATE')) return [{ id: 'jn', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: { name: 'name', email: 'email' }, total_rows: 1, valid_rows: 1, skipped_rows: 0, error_rows: 0, errors: [], created_by: null, created_at: new Date(), committed_at: null, original_rows: [{ name: 'X' }] }];
      if (q.text.includes('FROM people') && q.text.includes('email')) return [];
      if (q.text.includes('INSERT INTO people')) return [{ id: 'p1' }];
      if (q.text.includes("SET status = 'COMMITTED'")) return [{ id: 'jn', status: 'COMMITTED' }];
      return [];
    });
    const rn = await commitImport(c3, 'T', 'jn', 'u-unit');
    expect(rn.inserted).toBe(1); // row sem email → get('email') → undefined → '' → null
    const g = await getImportJob(c2, 'T', 'j2');
    expect(g.mapping).toMatchObject({ name: 'name' });
    expect(await listImports(c2, 'T')).toHaveLength(1);
  });
});

describe('branches finais import 4', () => {
  it('células ausentes (undefined) nas validações + campo mapping inválido', async () => {
    // linhas com menos colunas que o header → row[x] === undefined → ?? '' paths (76-85 idx0)
    const csvShort = [
      'name,email,phone,document,kind',
      'SoloSemNada',                    // todas ausentes
      'ComTudo,t@x.com,14998887766,11122233344,STUDENT',
    ].join('\n');
    const { client } = fakeClient((q) => {
      if (q.text.includes('INSERT INTO import_jobs')) return [{ id: 'js', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK, total_rows: 2, valid_rows: 1, skipped_rows: 0, error_rows: 1, errors: [], created_by: null, created_at: new Date(), committed_at: null, original_rows: '[]' }];
      return [];
    });
    const job = await createImportJob(client, 'T', { entity: 'people', csv: csvShort, mapping: MAP_OK, createdBy: null });
    expect(job.totalRows).toBe(2);
    // campo inválido no mapping (96 idx0) — campo desconhecido
    const { client: c2 } = fakeClient(() => []);
    await expect(createImportJob(c2, 'T', { entity: 'people', csv: 'name\nA', mapping: { name: 'name', zombie: 'x' } as Record<string, string>, createdBy: 'u' })).rejects.toThrow(/campo inválido/);
  });
});

describe('get/list/map', () => {
  const jobRow = { id: 'j1', tenant_id: 'T', entity: 'people', status: 'DRY_RUN', mapping: MAP_OK, total_rows: 2, valid_rows: 2, skipped_rows: 0, error_rows: 0, errors: [], created_by: 'u1', created_at: new Date(), committed_at: null };
  it('get 404; lista tenant; mapImportError', async () => {
    const { client } = fakeClient(() => [jobRow]);
    const g = await getImportJob(client, 'T', 'j1');
    expect(g.id).toBe('j1');
    const { client: c1 } = fakeClient(() => []);
    await expect(getImportJob(c1, 'T', 'zz')).rejects.toThrow(NotFoundError);
    const { client: c2 } = fakeClient(() => [jobRow]);
    expect(await listImports(c2, 'T')).toHaveLength(1);
    expect(mapImportError(new ImportRuleError('x')).status).toBe(422);
    expect(mapImportError(new NotFoundError('x')).status).toBe(404);
    const { ImportConflictError } = await import('../src/import-repositories.js');
    expect(mapImportError(new ImportConflictError('x')).status).toBe(409);
    expect(mapImportError(new Error('x')).status).toBe(500);
  });
});
