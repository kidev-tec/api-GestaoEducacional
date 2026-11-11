/**
 * E06-C — task-repositories: follow-up tasks + round-robin + timeline (SPEC-E06-C-tasks-v1).
 */
import { NotFoundError } from './people-repositories.js';

export type TaskKind = 'call' | 'visit' | 'email' | 'other';
export type TaskStatus = 'open' | 'done' | 'canceled';

export class TaskRuleError extends Error {}

export interface CrmTask {
  id: string; leadId: string; assignedTo: string; kind: TaskKind;
  status: TaskStatus; dueAt: string; doneAt: string | null; cancelReason: string | null; notes: string | null;
}

interface DbTask {
  id: string; lead_id: string; assigned_to: string; kind: TaskKind; status: TaskStatus;
  due_at: string; done_at: string | null; cancel_reason: string | null; notes: string | null;
}

function toRow(r: DbTask): CrmTask {
  return {
    id: r.id, leadId: r.lead_id, assignedTo: r.assigned_to, kind: r.kind, status: r.status,
    dueAt: r.due_at, doneAt: r.done_at, cancelReason: r.cancel_reason, notes: r.notes,
  };
}

export async function createTask(
  c: import('pg').PoolClient, tenantId: string,
  input: { leadId: string; assignedTo: string; kind: TaskKind; dueAt: string; notes?: string },
): Promise<CrmTask> {
  if (!['call', 'visit', 'email', 'other'].includes(input.kind)) throw new TaskRuleError('invalid kind');
  if (new Date(input.dueAt).getTime() <= Date.now()) throw new TaskRuleError('due_at must be in the future');
  const lead = await c.query('SELECT id FROM leads WHERE id = $1 AND tenant_id = $2', [input.leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');
  const r = await c.query(
    `INSERT INTO crm_tasks (id, tenant_id, lead_id, assigned_to, kind, due_at, notes)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
     RETURNING id, lead_id, assigned_to, kind, status, due_at, done_at, cancel_reason, notes`,
    [tenantId, input.leadId, input.assignedTo, input.kind, input.dueAt, input.notes ?? null],
  );
  await c.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, input.assignedTo, 'crm.task.create', 'crm_task', (r.rows[0] as DbTask).id],
  );
  return toRow(r.rows[0] as DbTask);
}

export async function completeTask(c: import('pg').PoolClient, tenantId: string, taskId: string, userId: string): Promise<CrmTask> {
  const cur = await c.query("SELECT status FROM crm_tasks WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [taskId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('tarefa não encontrada');
  const task = cur.rows[0] as { status: TaskStatus };
  if (task.status === 'canceled') throw new TaskRuleError('cannot complete canceled task');
  const r = await c.query(
    `UPDATE crm_tasks SET status = 'done', done_at = now() WHERE id = $1 AND tenant_id = $2
     RETURNING id, lead_id, assigned_to, kind, status, due_at, done_at, cancel_reason, notes`,
    [taskId, tenantId],
  );
  await c.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, userId, 'crm.task.done', 'crm_task', taskId],
  );
  return toRow(r.rows[0] as DbTask);
}

export async function cancelTask(c: import('pg').PoolClient, tenantId: string, taskId: string, reason: string, userId: string): Promise<CrmTask> {
  if (!reason || reason.trim().length < 3) throw new TaskRuleError('cancel reason required (min 3)');
  const cur = await c.query("SELECT status FROM crm_tasks WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [taskId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('tarefa não encontrada');
  const task = cur.rows[0] as { status: TaskStatus };
  if (task.status === 'done') throw new TaskRuleError('cannot cancel done task');
  const r = await c.query(
    `UPDATE crm_tasks SET status = 'canceled', cancel_reason = $1 WHERE id = $2 AND tenant_id = $3
     RETURNING id, lead_id, assigned_to, kind, status, due_at, done_at, cancel_reason, notes`,
    [reason.trim(), taskId, tenantId],
  );
  await c.query(
    'INSERT INTO audit_records (tenant_id, actor_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, userId, 'crm.task.cancel', 'crm_task', taskId],
  );
  return toRow(r.rows[0] as DbTask);
}

export interface TaskFilter { assignedTo?: string; status?: TaskStatus; overdue?: boolean; limit?: number; offset?: number }

export async function listTasks(c: import('pg').PoolClient, tenantId: string, filter: TaskFilter = {}): Promise<CrmTask[]> {
  const where: string[] = ['tenant_id = $1'];
  const values: unknown[] = [tenantId];
  if (filter.assignedTo) { values.push(filter.assignedTo); where.push(`assigned_to = $${values.length}`); }
  if (filter.status) { values.push(filter.status); where.push(`status = $${values.length}`); }
  if (filter.overdue) where.push("status = 'open' AND due_at < now()");
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const r = await c.query(
    `SELECT id, lead_id, assigned_to, kind, status, due_at, done_at, cancel_reason, notes
     FROM crm_tasks WHERE ${where.join(' AND ')} ORDER BY due_at ASC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return (r.rows as unknown as DbTask[]).map(toRow);
}

/** Round-robin atômico: retorna user ativo com menor position e o move para o fim (SKIP LOCKED). */
export async function nextInRotation(c: import('pg').PoolClient, tenantId: string): Promise<string> {
  const r = await c.query(
    `WITH locked AS (
       SELECT user_id, position FROM crm_rotation
       WHERE tenant_id = $1 AND active = true
       ORDER BY position ASC LIMIT 1 FOR UPDATE SKIP LOCKED
     ), bump AS (
       SELECT COALESCE(MAX(position), 0) + 1 AS next FROM crm_rotation WHERE tenant_id = $1
     )
     UPDATE crm_rotation rot
     SET position = (SELECT next FROM bump)
     FROM locked
     WHERE rot.user_id = locked.user_id AND rot.tenant_id = $1
     RETURNING rot.user_id`,
    [tenantId],
  );
  if (!r.rowCount) throw new TaskRuleError('rotation empty: no active members');
  return (r.rows[0] as { user_id: string }).user_id;
}

export async function addToRotation(c: import('pg').PoolClient, tenantId: string, userId: string): Promise<void> {
  const max = await c.query('SELECT COALESCE(MAX(position),0) AS m FROM crm_rotation WHERE tenant_id = $1', [tenantId]);
  await c.query(
    `INSERT INTO crm_rotation (tenant_id, user_id, position) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET active = true`,
    [tenantId, userId, Number((max.rows[0] as { m: string }).m) + 1],
  );
}

export async function removeFromRotation(c: import('pg').PoolClient, tenantId: string, userId: string): Promise<void> {
  const r = await c.query('UPDATE crm_rotation SET active = false WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
  if (!r.rowCount) throw new NotFoundError('usuário não está na rotação');
}

export interface TimelineEntry { at: string; type: 'stage' | 'task'; label: string; detail: string | null }

export async function getTimeline(c: import('pg').PoolClient, tenantId: string, leadId: string): Promise<TimelineEntry[]> {
  const lead = await c.query('SELECT id FROM leads WHERE id = $1 AND tenant_id = $2', [leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');
  const hist = await c.query(
    `SELECT h.changed_at AS at, COALESCE(sf.label, '(início)') AS from_l, st.label AS to_l
     FROM lead_stage_history h
     JOIN pipeline_stages st ON st.id = h.to_stage_id
     LEFT JOIN pipeline_stages sf ON sf.id = h.from_stage_id
     WHERE h.lead_id = $1 AND h.tenant_id = $2`,
    [leadId, tenantId],
  );
  const tasks = await c.query(
    `SELECT created_at AS at, kind, status, due_at FROM crm_tasks WHERE lead_id = $1 AND tenant_id = $2`,
    [leadId, tenantId],
  );
  const toIso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  const out: TimelineEntry[] = [];
  for (const h of hist.rows as Array<{ at: Date | string; from_l: string; to_l: string }>) {
    out.push({ at: toIso(h.at), type: 'stage', label: `${h.from_l} → ${h.to_l}`, detail: null });
  }
  for (const t of tasks.rows as Array<{ at: Date | string; kind: TaskKind; status: TaskStatus; due_at: Date | string }>) {
    out.push({ at: toIso(t.at), type: 'task', label: t.kind, detail: `${t.status} (due ${toIso(t.due_at)})` });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

export async function getSlaHours(c: import('pg').PoolClient, tenantId: string): Promise<number> {
  const r = await c.query("SELECT value FROM tenant_settings WHERE tenant_id = $1 AND key = 'crm_first_contact_sla_hours'", [tenantId]);
  if (!r.rowCount) return 48;
  const v = Number((r.rows[0] as { value: string }).value);
  return Number.isFinite(v) && v > 0 ? v : 48;
}
