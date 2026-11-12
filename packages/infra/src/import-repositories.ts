/**
 * E12-02 — importador CSV de pessoas: parse sem libs, validação por linha, dry-run, commit idempotente.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class ImportRuleError extends Error {}
export class ImportConflictError extends Error { override name = 'ImportConflictError'; }
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapImportError(e: unknown): { status: number } {
  if (e instanceof ImportRuleError) return { status: 422 };
  if (e instanceof ImportConflictError) return { status: 409 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const VALID_FIELDS = new Set(['name', 'email', 'phone', 'document', 'kind']);
const VALID_KINDS = new Set(['STUDENT', 'GUARDIAN', 'STAFF']);

/** Parse CSV simples com suporte a aspas e vírgula escapada por aspas. */
export function parseCsv(text: string): Array<Record<string, string>> {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new ImportRuleError('CSV maior que 2 MB');
  const lines: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') lines.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') lines.push(row);
  if (lines.length < 2) throw new ImportRuleError('CSV vazio ou sem linhas de dados');
  const header = lines[0]!.map((h) => h.trim());
  return lines.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
}

type ImportJob = {
  id: string; tenantId: string; entity: string; status: 'DRY_RUN' | 'COMMITTED' | 'FAILED';
  mapping: Record<string, string>; totalRows: number; validRows: number; skippedRows: number;
  errorRows: number; errors: Array<{ line: number; field: string; reason: string }>; createdBy: string | null;
};
type JobRow = Record<string, unknown> & {
  id: string; tenant_id: string; entity: string; status: ImportJob['status']; mapping: Record<string, string>;
  total_rows: number; valid_rows: number; skipped_rows: number; error_rows: number;
  errors: Array<{ line: number; field: string; reason: string }>; created_by: string | null;
};
const toJob = (r: JobRow): ImportJob => ({
  id: r.id, tenantId: r.tenant_id, entity: r.entity, status: r.status, mapping: r.mapping,
  totalRows: r.total_rows, validRows: r.valid_rows, skippedRows: r.skipped_rows,
  errorRows: r.error_rows, errors: r.errors, createdBy: r.created_by,
});

// ── R3: validação por linha ──
function validateRow(row: Record<string, string>, mapping: Record<string, string>): { field: string; reason: string } | null {
  const name = row[mapping.name!]!.trim();
  if (!name) return { field: 'name', reason: 'name obrigatório' };
  const email = mapping.email ? row[mapping.email]!.trim() : '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { field: 'email', reason: 'email inválido' };
  const phone = mapping.phone ? row[mapping.phone]!.replace(/\D/g, '') : '';
  if (phone && phone.length < 10) return { field: 'phone', reason: 'phone com menos de 10 dígitos' };
  const doc = mapping.document ? row[mapping.document]!.replace(/\D/g, '') : '';
  if (doc && doc.length !== 11) return { field: 'document', reason: 'document deve ter 11 dígitos' };
  const kind = mapping.kind ? row[mapping.kind]!.trim().toUpperCase() : 'GUARDIAN';
  if (kind && !VALID_KINDS.has(kind)) return { field: 'kind', reason: `kind deve ser ${[...VALID_KINDS].join(', ')}` };
  return null;
}

/** Cria job + dry-run automático (R4): valida todas as linhas sem inserir pessoas. */
export async function createImportJob(c: PoolClient, tenantId: string, input: {
  entity: 'people'; csv: string; mapping: Record<string, string>; createdBy?: string;
}): Promise<ImportJob> {
  if (!input.mapping.name) throw new ImportRuleError('mapping deve incluir o campo name');
  const rows = parseCsv(input.csv);
  for (const [field, col] of Object.entries(input.mapping)) {
    if (!VALID_FIELDS.has(field)) throw new ImportRuleError(`campo inválido no mapping: ${field}`);
    if (!(col in rows[0]!)) throw new ImportRuleError(`coluna mapeada não existe no CSV: ${col}`);
  }
  const errors: Array<{ line: number; field: string; reason: string }> = [];
  let valid = 0;
  rows.forEach((row, idx) => {
    const err = validateRow(row, input.mapping);
    if (err) errors.push({ line: idx + 1, ...err });
    else valid += 1;
  });
  const validRows = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ idx }) => !errors.some((e) => e.line === idx + 1))
    .map(({ row }) => row);
  const r = await c.query(
    `INSERT INTO import_jobs (id, tenant_id, entity, status, mapping, total_rows, valid_rows, error_rows, errors, created_by, original_rows)
     VALUES ($1,$2,$3,'DRY_RUN',$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, tenant_id, entity, status, mapping, total_rows, valid_rows, skipped_rows, error_rows, errors, created_by, committed_at`,
    [randomUUID(), tenantId, input.entity, JSON.stringify(input.mapping), rows.length, valid, errors.length, JSON.stringify(errors), input.createdBy ?? null, JSON.stringify(validRows)],
  );
  return toJob(r.rows[0] as JobRow);
}

export async function getImportJob(c: Pg, tenantId: string, jobId: string): Promise<ImportJob> {
  const r = await c.query(
    'SELECT * FROM import_jobs WHERE id = $1 AND tenant_id = $2',
    [jobId, tenantId],
  );
  if (!r.rowCount) throw new NotFoundError('job não encontrado');
  return getImportJobRaw(r.rows[0] as JobRow);
}

export async function listImports(c: Pg, tenantId: string): Promise<ImportJob[]> {
  const r = await c.query('SELECT * FROM import_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100', [tenantId]);
  return (r.rows as JobRow[]).map((j) => getImportJobRaw(j));
}

/** R5: commit — insere apenas linhas válidas; idempotente por email (skip). 409 se já commitado. */
export async function commitImport(c: PoolClient, tenantId: string, jobId: string, unitId: string): Promise<{ inserted: number; skipped: number }> {
  const cur = await c.query('SELECT * FROM import_jobs WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [jobId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('job não encontrado');
  const job = getImportJobRaw(cur.rows[0] as JobRow);
  if (job.status === 'COMMITTED') throw new ImportConflictError('job já foi commitado');
  const mapping = job.mapping;
  let inserted = 0;
  let skipped = 0;
  for (const raw of job.validRowsCache) {
    const row: Record<string, string> = {};
    for (const [field, col] of Object.entries(mapping)) row[col] = raw[col] ?? '';
    if (validateRow(row, mapping)) continue; // só válidas
    const get = (field: string): string => (mapping[field] ? row[mapping[field]]!.trim() : '');
    const email = get('email').toLowerCase() || null;
    const name = get('name');
    const phone = get('phone').replace(/\D/g, '') || null;
    const document = get('document').replace(/\D/g, '') || null;
    const kind = get('kind').toUpperCase() || 'GUARDIAN';
    if (email) {
      const exists = await c.query(
        'SELECT id FROM people WHERE tenant_id = $1 AND email = $2',
        [tenantId, email],
      );
      if (exists.rowCount) { skipped += 1; continue; } // R5 idempotente
    }
    await c.query(
      `INSERT INTO people (id, tenant_id, unit_id, kind, name, email, phone, document) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), tenantId, unitId, kind, name, email, phone, document],
    );
    inserted += 1;
  }
  const r = await c.query(
    `UPDATE import_jobs SET status = 'COMMITTED', committed_at = now(),
       valid_rows = $3, skipped_rows = $4, error_rows = $5
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [jobId, tenantId, inserted + skipped, skipped, job.errorRows],
  );
  void r;
  return { inserted, skipped };
}

function getImportJobRaw(row: JobRow & { original_rows?: string }): ImportJob & { validRowsCache: Array<Record<string, string>> } {
  const orig = typeof row.original_rows === 'string' ? JSON.parse(row.original_rows) : row.original_rows;
  return {
    ...toJob(row),
    validRowsCache: (orig ?? []) as Array<Record<string, string>>,
  };
}
