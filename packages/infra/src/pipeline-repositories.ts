/**
 * E06-B — pipeline-repositories: funil configurável + histórico (SPEC-E06-B-funnel-v1).
 * Funções puras com PoolClient (padrão E05-A/E06-A). Coverage 100×4 obrigatória.
 */
import { ConflictError, NotFoundError } from './people-repositories.js';
import { LeadRuleError } from './lead-repositories.js';

export type StageKind = 'open' | 'won' | 'lost';

export interface Stage {
  id: string; label: string; kind: StageKind; position: number; archived: boolean;
}

export class PipelineError extends Error {
  constructor(public code: 'ARCHIVED_WITH_LEADS' | 'PROTECTED_KIND' | 'INVALID_REORDER' | 'DUPLICATE_POSITION', msg: string) {
    super(msg);
  }
}

export function mapPipelineError(e: unknown): { status: number } {
  if (e instanceof PipelineError) {
    if (e.code === 'ARCHIVED_WITH_LEADS') return { status: 409 };
    if (e.code === 'PROTECTED_KIND' || e.code === 'INVALID_REORDER' || e.code === 'DUPLICATE_POSITION') return { status: 422 };
  }
  if (e instanceof NotFoundError) return { status: 404 };
  if (e instanceof ConflictError) return { status: 409 };
  if (e instanceof LeadRuleError) return { status: 403 }; // consent-antes-de-422: consent mantém 403
  throw e;
}

/** Garante pipeline default do tenant (idempotente); retorna (pipelineId, estágios ativos ordenados). */
export async function ensurePipeline(c: import('pg').PoolClient, tenantId: string): Promise<{ pipelineId: string; stages: Stage[] }> {
  const p = await c.query('SELECT id FROM lead_pipelines WHERE tenant_id = $1', [tenantId]);
  let pipelineId: string;
  if (!p.rows.length) {
    pipelineId = (await c.query(
      'INSERT INTO lead_pipelines (id, tenant_id) VALUES (gen_random_uuid(), $1) RETURNING id', [tenantId],
    )).rows[0].id;
    const defaults: Array<[string, StageKind, number]> = [
      ['Novo', 'open', 1], ['Em contato', 'open', 2], ['Qualificado', 'open', 3], ['Ganho', 'won', 4], ['Perdido', 'lost', 5],
    ];
    for (const [label, kind, position] of defaults) {
      await c.query(
        'INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)',
        [pipelineId, tenantId, label, kind, position],
      );
    }
  } else {
    pipelineId = p.rows[0].id;
  }
  const s = await c.query(
    'SELECT id, label, kind, position, archived FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
    [pipelineId],
  );
  return { pipelineId, stages: s.rows as Stage[] };
}

export async function createStage(
  c: import('pg').PoolClient, tenantId: string, label: string, kind: StageKind, afterPosition?: number,
): Promise<Stage> {
  const { pipelineId, stages } = await ensurePipeline(c, tenantId);
  const openStages = stages.filter((s) => s.kind === 'open' && !s.archived);
  const won = stages.find((s) => s.kind === 'won');
  const lost = stages.find((s) => s.kind === 'lost');
  if (kind !== 'open' && (won || lost)) throw new PipelineError('PROTECTED_KIND', `kind ${kind} já existe`);
  const insertPos = afterPosition ?? openStages.length;
  if (insertPos < 1 || insertPos > openStages.length) throw new PipelineError('INVALID_REORDER', 'posição inválida');

  // abre espaço: two-phase (park em +1000 p/ evitar conflito de UNIQUE(pipeline_id, position))
  const toShift = openStages.filter((s) => s.position >= insertPos);
  const tail = stages.filter((s) => s.kind !== 'open' && !s.archived);
  // 1) park TODOS os seguintes (abertos + won/lost) em posições negativas únicas
  let park = -1;
  for (const s of [...toShift.reverse(), ...tail]) {
    await c.query('UPDATE pipeline_stages SET position = $1 WHERE id = $2', [park--, s.id]);
  }
  // 2) realoca em ordem final
  let pos = insertPos;
  for (const s of toShift.reverse()) {
    await c.query('UPDATE pipeline_stages SET position = $1 WHERE id = $2', [++pos, s.id]);
  }
  for (const s of tail) {
    await c.query('UPDATE pipeline_stages SET position = $1 WHERE id = $2', [++pos, s.id]);
  }
  const r = await c.query(
    `INSERT INTO pipeline_stages (id, pipeline_id, tenant_id, label, kind, position)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id, label, kind, position, archived`,
    [pipelineId, tenantId, label, kind, insertPos],
  );
  return r.rows[0] as Stage;
}

export async function renameStage(c: import('pg').PoolClient, tenantId: string, stageId: string, label: string): Promise<Stage> {
  const r = await c.query(
    'UPDATE pipeline_stages SET label = $1 WHERE id = $2 AND tenant_id = $3 AND archived = false RETURNING id, label, kind, position, archived',
    [label, stageId, tenantId],
  );
  if (!r.rowCount) throw new NotFoundError('estágio não encontrado');
  return r.rows[0] as Stage;
}

export async function archiveStage(c: import('pg').PoolClient, tenantId: string, stageId: string): Promise<void> {
  const cur = await c.query('SELECT kind FROM pipeline_stages WHERE id = $1 AND tenant_id = $2', [stageId, tenantId]);
  if (!cur.rowCount) throw new NotFoundError('estágio não encontrado');
  const stage = cur.rows[0] as { kind: StageKind };
  if (stage.kind !== 'open') throw new PipelineError('PROTECTED_KIND', 'won/lost não arquivam');
  const used = await c.query('SELECT COUNT(*) AS n FROM leads WHERE stage_id = $1', [stageId]);
  if (Number((used.rows[0] as { n: string }).n) > 0) throw new PipelineError('ARCHIVED_WITH_LEADS', 'estágio tem leads');
  await c.query('UPDATE pipeline_stages SET archived = true WHERE id = $1', [stageId]);
}

export async function reorderStages(c: import('pg').PoolClient, tenantId: string, orderedIds: string[]): Promise<void> {
  const { pipelineId, stages } = await ensurePipeline(c, tenantId);
  const active = stages.filter((s) => !s.archived && s.kind === 'open');
  const idsSet = new Set(orderedIds);
  if (orderedIds.length !== active.length || !orderedIds.every((id) => active.some((s) => s.id === id))) {
    throw new PipelineError('INVALID_REORDER', 'lista deve conter exatamente os estágios abertos');
  }
  const won = stages.find((s) => s.kind === 'won' && !s.archived);
  const lost = stages.find((s) => s.kind === 'lost' && !s.archived);
  const finalOrder = [...orderedIds, won?.id, lost?.id].filter((x): x is string => !!x);
  // UNIQUE(pipeline_id, position): estaciona TODOS os estágios do pipeline (inclusive arquivados).
  const all = await c.query('SELECT id FROM pipeline_stages WHERE pipeline_id = $1', [pipelineId]);
  let park = -1;
  for (const row of all.rows as Array<{ id: string }>) {
    await c.query('UPDATE pipeline_stages SET position = $1 WHERE id = $2 AND tenant_id = $3', [park--, row.id, tenantId]);
  }
  let pos = 1;
  for (const id of finalOrder) {
    await c.query('UPDATE pipeline_stages SET position = $1 WHERE id = $2 AND tenant_id = $3', [pos++, id, tenantId]);
  }
  void pipelineId;
  void idsSet;
}

export interface MoveStageResult { leadId: string; fromStageId: string | null; toStageId: string }

/** Move lead com histórico; valida: alvo ativo, adjacente (entre abertos) ou won/lost de qualquer aberto. */
export async function moveLeadStage(
  c: import('pg').PoolClient, tenantId: string, leadId: string, toStageId: string, userId?: string,
): Promise<MoveStageResult> {
  const lead = await c.query('SELECT stage_id, consent FROM leads WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [leadId, tenantId]);
  if (!lead.rowCount) throw new NotFoundError('lead não encontrado');
  const cur = lead.rows[0] as { stage_id: string; consent: boolean };

  const target = await c.query('SELECT kind, archived FROM pipeline_stages WHERE id = $1 AND tenant_id = $2', [toStageId, tenantId]);
  if (!target.rowCount) throw new NotFoundError('estágio não encontrado');
  const t = target.rows[0] as { kind: StageKind; archived: boolean };
  if (t.archived) throw new PipelineError('INVALID_REORDER', 'estágio arquivado');

  if (t.kind === 'won' && !cur.consent) throw new LeadRuleError('consent obrigatório para WON');

  if (t.kind === 'open') {
    const { stages } = await ensurePipeline(c, tenantId);
    const activeOpens = stages.filter((s) => s.kind === 'open' && !s.archived);
    const fromIdx = activeOpens.findIndex((s) => s.id === cur.stage_id);
    const toIdx = activeOpens.findIndex((s) => s.id === toStageId);
    if (fromIdx !== -1 && Math.abs(toIdx - fromIdx) > 1) {
      throw new PipelineError('INVALID_REORDER', 'transição entre abertos deve ser adjacente');
    }
  }

  await c.query('UPDATE leads SET stage_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [toStageId, leadId, tenantId]);
  await c.query(
    `INSERT INTO lead_stage_history (id, tenant_id, lead_id, from_stage_id, to_stage_id, changed_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [tenantId, leadId, cur.stage_id, toStageId, userId ?? null],
  );
  return { leadId, fromStageId: cur.stage_id, toStageId };
}

export interface BoardColumn { stageId: string; label: string; kind: StageKind; count: number; totalValueCents: number }

export async function getBoard(c: import('pg').PoolClient, tenantId: string): Promise<BoardColumn[]> {
  const { stages } = await ensurePipeline(c, tenantId);
  const out: BoardColumn[] = [];
  for (const s of stages.filter((x) => !x.archived)) {
    const agg = await c.query(
      'SELECT COUNT(*) AS n, COALESCE(SUM(estimated_value_cents),0) AS total FROM leads WHERE stage_id = $1',
      [s.id],
    );
    const row = agg.rows[0] as { n: string; total: string };
    out.push({ stageId: s.id, label: s.label, kind: s.kind, count: Number(row.n), totalValueCents: Number(row.total) });
  }
  return out;
}

export interface FunnelMetrics {
  stageConversion: Array<{ label: string; entered: number; advanced: number; conversion: number }>;
  avgHoursPerStage: Array<{ label: string; avgHours: number }>;
  wonRate: number;
}

export async function getMetrics(c: import('pg').PoolClient, tenantId: string): Promise<FunnelMetrics> {
  const { pipelineId, stages } = await ensurePipeline(c, tenantId);
  const labelById = new Map(stages.map((s) => [s.id, s.label]));
  const hist = await c.query(
    `SELECT to_stage_id, COUNT(*) AS entered FROM lead_stage_history h
     JOIN leads l ON l.id = h.lead_id
     WHERE h.tenant_id = $1 GROUP BY to_stage_id`,
    [tenantId],
  );
  const enteredMap = new Map<string, number>(
    (hist.rows as Array<{ to_stage_id: string; entered: string }>).map((r) => [r.to_stage_id, Number(r.entered)]),
  );
  const adv = await c.query(
    `SELECT from_stage_id, COUNT(*) AS advanced FROM lead_stage_history
     WHERE tenant_id = $1 AND from_stage_id IS NOT NULL GROUP BY from_stage_id`,
    [tenantId],
  );
  const advMap = new Map<string, number>(
    (adv.rows as Array<{ from_stage_id: string; advanced: string }>).map((r) => [r.from_stage_id, Number(r.advanced)]),
  );
  const stageConversion = stages
    .filter((s) => !s.archived)
    .map((s) => {
      const entered = enteredMap.get(s.id) ?? 0;
      const advanced = advMap.get(s.id) ?? 0;
      return { label: s.label, entered, advanced, conversion: entered > 0 ? advanced / entered : 0 };
    });

  const avg = await c.query(
    `SELECT to_stage_id, AVG(EXTRACT(EPOCH FROM (changed_at - prev_at)) / 3600.0) AS hrs
     FROM (
       SELECT to_stage_id, changed_at,
              LAG(changed_at) OVER (PARTITION BY lead_id ORDER BY changed_at) AS prev_at
       FROM lead_stage_history WHERE tenant_id = $1
     ) x WHERE prev_at IS NOT NULL GROUP BY to_stage_id`,
    [tenantId],
  );
  const avgHoursPerStage = (avg.rows as Array<{ to_stage_id: string; hrs: string | null }>)
    .filter((r) => labelById.has(r.to_stage_id))
    .map((r) => ({ label: labelById.get(r.to_stage_id) as string, avgHours: Math.round(Number(r.hrs ?? 0) * 100) / 100 }));

  const won = stages.find((s) => s.kind === 'won');
  const lost = stages.find((s) => s.kind === 'lost');
  const wonN = won ? (enteredMap.get(won.id) ?? 0) : 0;
  const lostN = lost ? (enteredMap.get(lost.id) ?? 0) : 0;
  const closed = wonN + lostN;
  void pipelineId;
  return { stageConversion, avgHoursPerStage, wonRate: closed > 0 ? wonN / closed : 0 };
}
