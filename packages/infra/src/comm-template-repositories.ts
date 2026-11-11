/**
 * E09-02 — templates versionados com placeholders validados, PII guard e revisão.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './people-repositories.js';

export class TemplateRuleError extends Error {}
type Pg = import('pg').Pool | import('pg').PoolClient;
type PoolClient = import('pg').PoolClient;

export function mapTemplateError(e: unknown): { status: number } {
  if (e instanceof TemplateRuleError) return { status: 422 };
  if (e instanceof NotFoundError) return { status: 404 };
  return { status: 500 };
}

// ── R1: placeholders ──
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]*)\s*\}\}/g;
const PLACEHOLDER_NAME_RE = /^[a-z_][a-z0-9_]*$/;

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

function validatePlaceholders(body: string, subject: string, sample: Record<string, unknown>): void {
  // qualquer {{...}} deve ser um placeholder bem-formado
  for (const text of [body, subject]) {
    for (const m of text.matchAll(/\{\{[^}]*\}\}/g)) {
      const inner = m[0].slice(2, -2).trim();
      if (!PLACEHOLDER_NAME_RE.test(inner)) throw new TemplateRuleError(`placeholder inválido: ${m[0]}`);
    }
  }
  for (const raw of [...extractPlaceholders(body), ...extractPlaceholders(subject)]) {
    if (!(raw in sample)) throw new TemplateRuleError(`placeholder sem correspondência no sample_payload: {{${raw}}}`);
  }
}

// ── R2: PII literal no template ──
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, 'CPF'],
  [/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, 'e-mail'],
  [/\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/, 'telefone'],
];

function assertNoPii(...texts: string[]): void {
  for (const text of texts) {
    for (const [re, label] of PII_PATTERNS) {
      if (re.test(text)) throw new TemplateRuleError(`PII literal (${label}) proibida no template — use uma variável`);
    }
  }
}

// ── R6: render ──
export function resolveTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_RE, (_all, name: string) => {
    if (!(name in payload)) throw new TemplateRuleError(`variável ausente no payload: ${name}`);
    return String(payload[name]);
  });
}

export type CommTemplate = {
  id: string; tenantId: string; eventKey: string; channel: 'inapp' | 'email'; locale: 'pt' | 'en' | 'es';
  version: number; subject: string; body: string; samplePayload: unknown;
  status: 'DRAFT' | 'APPROVED'; approvedBy: string | null;
};
type TplRow = Record<string, unknown> & {
  id: string; tenant_id: string; event_key: string; channel: CommTemplate['channel']; locale: CommTemplate['locale'];
  version: number; subject: string; body: string; sample_payload: unknown;
  status: CommTemplate['status']; approved_by: string | null;
};
const toTpl = (r: TplRow): CommTemplate => ({
  id: r.id, tenantId: r.tenant_id, eventKey: r.event_key, channel: r.channel, locale: r.locale,
  version: r.version, subject: r.subject, body: r.body, samplePayload: r.sample_payload,
  status: r.status, approvedBy: r.approved_by,
});

/** Cria nova versão DRAFT (R1/R2/R4). Exige def de evento existente no tenant. */
export async function createTemplateVersion(c: Pg, tenantId: string, input: {
  eventKey: string; channel: CommTemplate['channel']; locale: CommTemplate['locale'];
  subject: string; body: string; samplePayload: Record<string, unknown>;
}): Promise<CommTemplate> {
  if (!input.subject.trim() || !input.body.trim()) throw new TemplateRuleError('subject e body são obrigatórios');
  const def = await c.query(
    'SELECT id FROM comm_event_defs WHERE tenant_id = $1 AND event_key = $2 AND channel = $3',
    [tenantId, input.eventKey, input.channel],
  );
  if (!def.rowCount) throw new NotFoundError('definição de evento não encontrada para este tenant/canal');
  validatePlaceholders(input.body, input.subject, input.samplePayload);
  assertNoPii(input.body, input.subject);
  const maxRow = await c.query(
    'SELECT MAX(version) AS max_version FROM comm_templates WHERE tenant_id = $1 AND event_key = $2 AND channel = $3 AND locale = $4',
    [tenantId, input.eventKey, input.channel, input.locale],
  );
  const maxVersion = (maxRow.rows[0] as { max_version: number | null }).max_version ?? 0;
  const version = maxVersion + 1;
  const r = await c.query(
    `INSERT INTO comm_templates (id, tenant_id, event_key, channel, locale, version, subject, body, sample_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, tenant_id, event_key, channel, locale, version, subject, body, sample_payload, status, approved_by`,
    [randomUUID(), tenantId, input.eventKey, input.channel, input.locale, version, input.subject, input.body, JSON.stringify(input.samplePayload)],
  );
  return toTpl(r.rows[0] as TplRow);
}

export async function listTemplates(c: Pg, tenantId: string, filter: {
  eventKey?: string; channel?: string; locale?: string; status?: string;
}): Promise<CommTemplate[]> {
  const conds = ['tenant_id = $1'];
  const vals: unknown[] = [tenantId];
  if (filter.eventKey) { vals.push(filter.eventKey); conds.push(`event_key = $${vals.length}`); }
  if (filter.channel) { vals.push(filter.channel); conds.push(`channel = $${vals.length}`); }
  if (filter.locale) { vals.push(filter.locale); conds.push(`locale = $${vals.length}`); }
  if (filter.status) { vals.push(filter.status); conds.push(`status = $${vals.length}`); }
  const r = await c.query(
    `SELECT id, tenant_id, event_key, channel, locale, version, subject, body, sample_payload, status, approved_by
     FROM comm_templates WHERE ${conds.join(' AND ')} ORDER BY version DESC`,
    vals,
  );
  return (r.rows as TplRow[]).map(toTpl);
}

/** R3: só DRAFT edita. */
export async function updateDraft(c: PoolClient, tenantId: string, templateId: string, patch: {
  subject?: string; body?: string; samplePayload?: Record<string, unknown>;
}): Promise<CommTemplate> {
  const cur = await c.query('SELECT * FROM comm_templates WHERE id = $1 AND tenant_id = $2', [templateId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('template não encontrado');
  const tpl = toTpl(cur.rows[0] as TplRow);
  if (tpl.status === 'APPROVED') throw new TemplateRuleError('template APPROVED é imutável — crie nova versão');
  const newBody = patch.body ?? tpl.body;
  const newSubject = patch.subject ?? tpl.subject;
  const rawSample = patch.samplePayload ?? tpl.samplePayload;
  const newSample: Record<string, unknown> = typeof rawSample === 'string' ? JSON.parse(rawSample) : ((rawSample ?? {}) as Record<string, unknown>);
  if (!newSubject.trim() || !newBody.trim()) throw new TemplateRuleError('subject e body são obrigatórios');
  validatePlaceholders(newBody, newSubject, newSample);
  assertNoPii(newBody, newSubject);
  const r = await c.query(
    `UPDATE comm_templates SET subject = $3, body = $4, sample_payload = $5
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, event_key, channel, locale, version, subject, body, sample_payload, status, approved_by`,
    [templateId, tenantId, newSubject, newBody, JSON.stringify(newSample)],
  );
  return toTpl(r.rows[0] as TplRow);
}

/** R3: DRAFT → APPROVED (imutável a partir daí). */
export async function approveTemplate(c: PoolClient, tenantId: string, templateId: string, approvedBy: string): Promise<CommTemplate> {
  const cur = await c.query('SELECT * FROM comm_templates WHERE id = $1 AND tenant_id = $2', [templateId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('template não encontrado');
  if ((toTpl(cur.rows[0] as TplRow)).status === 'APPROVED') throw new TemplateRuleError('template já aprovado');
  const r = await c.query(
    `UPDATE comm_templates SET status = 'APPROVED', approved_by = $3, approved_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, tenant_id, event_key, channel, locale, version, subject, body, sample_payload, status, approved_by`,
    [templateId, tenantId, approvedBy],
  );
  return toTpl(r.rows[0] as TplRow);
}

/** R6: render sem persistir. */
export async function previewTemplate(c: Pg, tenantId: string, templateId: string, payload: Record<string, unknown>): Promise<string> {
  const cur = await c.query('SELECT body FROM comm_templates WHERE id = $1 AND tenant_id = $2', [templateId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('template não encontrado');
  return resolveTemplate((cur.rows[0] as { body: string }).body, payload);
}

export async function listVersions(c: Pg, tenantId: string, templateId: string): Promise<CommTemplate[]> {
  const cur = await c.query(
    'SELECT event_key, channel, locale FROM comm_templates WHERE id = $1 AND tenant_id = $2',
    [templateId, tenantId],
  );
  if (!cur.rowCount) throw new NotFoundError('template não encontrado');
  const key = cur.rows[0] as { event_key: string; channel: string; locale: string };
  const r = await c.query(
    `SELECT id, tenant_id, event_key, channel, locale, version, subject, body, sample_payload, status, approved_by
     FROM comm_templates WHERE tenant_id = $1 AND event_key = $2 AND channel = $3 AND locale = $4
     ORDER BY version DESC`,
    [tenantId, key.event_key, key.channel, key.locale],
  );
  return (r.rows as TplRow[]).map(toTpl);
}
