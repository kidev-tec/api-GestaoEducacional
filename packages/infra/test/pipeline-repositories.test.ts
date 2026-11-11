/**
 * E06-B unit — pipeline-repositories com fake pg client. Cobertura 100×4.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  archiveStage, createStage, ensurePipeline, getBoard, getMetrics,
  mapPipelineError, moveLeadStage, PipelineError, renameStage, reorderStages,
  type Stage,
} from '../src/pipeline-repositories.js';
import { NotFoundError, ConflictError } from '../src/people-repositories.js';
import { LeadRuleError } from '../src/lead-repositories.js';

type Row = Record<string, unknown>;
interface Q { text: string; values: unknown[] }

function fakeClient(script: (q: Q, n: number) => Row[] | Promise<Row[]>) {
  const queries: Q[] = [];
  const client = {
    query: vi.fn(async (q: Q | string, values?: unknown[]) => {
      const norm: Q = typeof q === 'string' ? { text: q, values: values ?? [] } : { ...q, values: q.values ?? values ?? [] };
      queries.push(norm);
      const rows = await script(norm, queries.length);
      return { rows, rowCount: rows.length };
    }),
  };
  return { client: client as unknown as import('pg').PoolClient, queries };
}

const STAGES: Stage[] = [
  { id: 's1', label: 'Novo', kind: 'open', position: 1, archived: false },
  { id: 's2', label: 'Contato', kind: 'open', position: 2, archived: false },
  { id: 's3', label: 'Ganho', kind: 'won', position: 3, archived: false },
  { id: 's4', label: 'Perdido', kind: 'lost', position: 4, archived: false },
];

function ensureScript(q: Q): Row[] {
  if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
  if (q.text.startsWith('SELECT id, label, kind')) return structuredClone(STAGES) as unknown as Row[];
  return [];
}

describe('ensurePipeline', () => {
  it('cria pipeline default com estágios quando não existe', async () => {
    const { client, queries } = fakeClient((q, n) => {
      if (n === 1) return [];
      if (q.text.includes('INSERT INTO lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.includes('INSERT INTO pipeline_stages')) return [{ id: 's' + Math.random() }];
      if (q.text.startsWith('SELECT id, label, kind')) return STAGES as unknown as Row[];
      return [];
    });
    const r = await ensurePipeline(client, 'T');
    expect(r.pipelineId).toBe('p1');
    expect(queries.filter((q) => q.text.includes('INSERT INTO pipeline_stages'))).toHaveLength(5);
  });
  it('retorna pipeline existente', async () => {
    const { client } = fakeClient(ensureScript);
    const r = await ensurePipeline(client, 'T');
    expect(r.stages).toHaveLength(4);
  });
});

describe('createStage', () => {
  it('cria estágio aberto com shift de posições', async () => {
    const { client, queries } = fakeClient((q) => {
      const base = ensureScript(q);
      if (q.text.includes('RETURNING id, label, kind, position, archived'))
        return [{ id: 'ns', label: 'Visitado', kind: 'open', position: 2, archived: false }];
      return base;
    });
    const s = await createStage(client, 'T', 'Visitado', 'open', 2);
    expect(s.label).toBe('Visitado');
    expect(queries.some((q) => q.text.includes('SET position = $1') && JSON.stringify(q.values).includes('s2'))).toBe(true);
  });
  it('rejeita segundo won/lost (PROTECTED_KIND→422)', async () => {
    const { client } = fakeClient(ensureScript);
    await expect(createStage(client, 'T', 'Ganho2', 'won', 1)).rejects.toThrow(PipelineError);
  });
  it('posição inválida (INVALID_REORDER→422)', async () => {
    const { client } = fakeClient(ensureScript);
    await expect(createStage(client, 'T', 'X', 'open', 99)).rejects.toThrow(/posição inválida/);
  });
  it('afterPosition default = qtde de abertos', async () => {
    const { client, queries } = fakeClient(ensureScript);
    await createStage(client, 'T', 'Tail', 'open');
    const insert = queries.find((q) => q.text.includes('INSERT INTO pipeline_stages') && q.values.length === 5)!;
    expect(insert.values[4]).toBe(2);
  });
});

describe('renameStage', () => {
  it('renomeia estágio ativo', async () => {
    const { client } = fakeClient(() => [{ id: 's1', label: 'Novo nome', kind: 'open', position: 1, archived: false }]);
    const s = await renameStage(client, 'T', 's1', 'Novo nome');
    expect(s.label).toBe('Novo nome');
  });
  it('404 quando inexistente', async () => {
    const { client } = fakeClient(() => []);
    await expect(renameStage(client, 'T', 'zz', 'X')).rejects.toThrow(NotFoundError);
  });
});

describe('archiveStage', () => {
  it('arquiva estágio vazio', async () => {
    const { client, queries } = fakeClient((q) =>
      q.text.startsWith('SELECT kind') ? [{ kind: 'open' }] : q.text.includes('COUNT(*)') ? [{ n: '0' }] : []);
    await archiveStage(client, 'T', 's1');
    expect(queries.some((q) => q.text.includes('SET archived = true'))).toBe(true);
  });
  it('404 inexistente', async () => {
    const { client } = fakeClient(() => []);
    await expect(archiveStage(client, 'T', 'zz')).rejects.toThrow(NotFoundError);
  });
  it('PROTECTED_KIND em won', async () => {
    const { client } = fakeClient(() => [{ kind: 'won' }]);
    await expect(archiveStage(client, 'T', 's3')).rejects.toThrow(PipelineError);
  });
  it('ARCHIVED_WITH_LEADS quando tem leads', async () => {
    const { client } = fakeClient((q) => (q.text.startsWith('SELECT kind') ? [{ kind: 'open' }] : [{ n: '3' }]));
    await expect(archiveStage(client, 'T', 's1')).rejects.toThrow(/estágio tem leads/);
  });
});

describe('reorderStages', () => {
  it('reordena abertos e fixa won/lost no fim', async () => {
    const { client, queries } = fakeClient(ensureScript);
    await reorderStages(client, 'T', ['s2', 's1']);
    const updates = queries.filter((q) => q.text.includes('UPDATE pipeline_stages SET position = $1'));
    expect(updates).toHaveLength(4);
    expect(updates[0].values).toEqual([1, 's2', 'T']);
    expect(updates[2].values).toEqual([3, 's3', 'T']);
  });
  it('rejeita lista incompleta', async () => {
    const { client } = fakeClient(ensureScript);
    await expect(reorderStages(client, 'T', ['s1'])).rejects.toThrow(/exatamente/);
  });
  it('rejeita id desconhecido', async () => {
    const { client } = fakeClient(ensureScript);
    await expect(reorderStages(client, 'T', ['s1', 'zz'])).rejects.toThrow(PipelineError);
  });
});

describe('moveLeadStage', () => {
  const leadRow = [{ stage_id: 's1', consent: true }];
  it('move para won com consent e grava histórico', async () => {
    const { client, queries } = fakeClient((q) => {
      if (q.text.startsWith('SELECT stage_id')) return leadRow;
      if (q.text.startsWith('SELECT kind')) return [{ kind: 'won', archived: false }];
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return STAGES as unknown as Row[];
      return [];
    });
    const r = await moveLeadStage(client, 'T', 'L1', 's3', 'user1');
    expect(r.fromStageId).toBe('s1');
    expect(queries.some((q) => q.text.includes('lead_stage_history'))).toBe(true);
  });
  it('404 lead inexistente', async () => {
    const { client } = fakeClient(() => []);
    await expect(moveLeadStage(client, 'T', 'L', 's1')).rejects.toThrow(NotFoundError);
  });
  it('404 estágio de outro tenant', async () => {
    const { client } = fakeClient((q) => (q.text.startsWith('SELECT stage_id') ? leadRow : []));
    await expect(moveLeadStage(client, 'T', 'L1', 'zz')).rejects.toThrow(NotFoundError);
  });
  it('estágio arquivado rejeita', async () => {
    const { client } = fakeClient((q) =>
      q.text.startsWith('SELECT stage_id') ? leadRow : [{ kind: 'open', archived: true }]);
    await expect(moveLeadStage(client, 'T', 'L1', 's1')).rejects.toThrow(/arquivado/);
  });
  it('won sem consent → LeadRuleError (403)', async () => {
    const { client } = fakeClient((q) =>
      q.text.startsWith('SELECT stage_id') ? [{ stage_id: 's1', consent: false }] : [{ kind: 'won', archived: false }]);
    await expect(moveLeadStage(client, 'T', 'L1', 's3')).rejects.toThrow(LeadRuleError);
  });
  it('transição entre abertos não adjacente rejeita', async () => {
    const stages3: Stage[] = [
      { id: 'a', label: 'A', kind: 'open', position: 1, archived: false },
      { id: 'b', label: 'B', kind: 'open', position: 2, archived: false },
      { id: 'c', label: 'C', kind: 'open', position: 3, archived: false },
    ];
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT stage_id')) return [{ stage_id: 'a', consent: true }];
      if (q.text.startsWith('SELECT kind')) return [{ kind: 'open', archived: false }];
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return stages3 as unknown as Row[];
      return [];
    });
    await expect(moveLeadStage(client, 'T', 'L1', 'c')).rejects.toThrow(/adjacente/);
  });
  it('lead sem estágio (stage_id nulo) pode ir a qualquer aberto', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT stage_id')) return [{ stage_id: null, consent: true }];
      if (q.text.startsWith('SELECT kind')) return [{ kind: 'open', archived: false }];
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return STAGES as unknown as Row[];
      return [];
    });
    const r = await moveLeadStage(client, 'T', 'L1', 's2');
    expect(r.fromStageId).toBeNull();
  });
});

describe('getBoard', () => {
  it('agrega contagem e valor por estágio', async () => {
    let n = 0;
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return STAGES as unknown as Row[];
      if (q.text.includes('COUNT(*)')) { n++; return [{ n: String(n), total: String(n * 100) }]; }
      return [];
    });
    const board = await getBoard(client, 'T');
    expect(board).toHaveLength(4);
    expect(board[0].count).toBe(1);
    expect(board[1].totalValueCents).toBe(200);
  });
});

describe('getMetrics', () => {
  it('calcula conversão, tempo médio e wonRate', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return STAGES as unknown as Row[];
      if (q.text.includes('GROUP BY to_stage_id') && !q.text.includes('AVG'))
        return [{ to_stage_id: 's1', entered: '10' }, { to_stage_id: 's2', entered: '5' }, { to_stage_id: 's3', entered: '2' }, { to_stage_id: 's4', entered: '2' }];
      if (q.text.includes('GROUP BY from_stage_id')) return [{ from_stage_id: 's1', advanced: '5' }];
      if (q.text.includes('AVG')) return [{ to_stage_id: 's2', hrs: '4.5' }, { to_stage_id: 'zz', hrs: '9' }];
      return [];
    });
    const m = await getMetrics(client, 'T');
    expect(m.stageConversion[0]).toEqual({ label: 'Novo', entered: 10, advanced: 5, conversion: 0.5 });
    expect(m.stageConversion[1].conversion).toBe(0);
    expect(m.avgHoursPerStage).toEqual([{ label: 'Contato', avgHours: 4.5 }]);
    expect(m.wonRate).toBe(0.5);
  });
  it('wonRate 0 sem fechamentos', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return STAGES as unknown as Row[];
      return [];
    });
    const m = await getMetrics(client, 'T');
    expect(m.wonRate).toBe(0);
  });
});

describe('mapPipelineError', () => {
  it('mapeia todas as classes', () => {
    expect(mapPipelineError(new PipelineError('ARCHIVED_WITH_LEADS', 'x')).status).toBe(409);
    expect(mapPipelineError(new PipelineError('PROTECTED_KIND', 'x')).status).toBe(422);
    expect(mapPipelineError(new PipelineError('INVALID_REORDER', 'x')).status).toBe(422);
    expect(mapPipelineError(new PipelineError('DUPLICATE_POSITION', 'x')).status).toBe(422);
    expect(mapPipelineError(new NotFoundError('x')).status).toBe(404);
    expect(mapPipelineError(new ConflictError('x')).status).toBe(409);
    expect(mapPipelineError(new LeadRuleError('consent')).status).toBe(403);
    expect(() => mapPipelineError(new Error('boom'))).toThrow(/boom/);
  });
});

describe('branches extras', () => {
  it('createStage: won ausente permite criar won; lost ausente permite lost', async () => {
    const stagesNoWonLost: Stage[] = STAGES.filter((s) => s.kind === 'open');
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return stagesNoWonLost as unknown as Row[];
      if (q.text.includes('RETURNING id, label, kind, position, archived'))
        return [{ id: 'nw', label: 'Ganho', kind: 'won', position: 3, archived: false }];
      return [];
    });
    const s = await createStage(client, 'T', 'Ganho', 'won', 2);
    expect(s.kind).toBe('won');
  });
  it('moveLeadStage: target won/lost pula verificação de adjacência', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT stage_id')) return [{ stage_id: 's1', consent: true }];
      if (q.text.startsWith('SELECT kind')) return [{ kind: 'lost', archived: false }];
      return [];
    });
    const r = await moveLeadStage(client, 'T', 'L', 's4');
    expect(r.toStageId).toBe('s4');
  });
  it('getMetrics: won/lost ausentes → wonRate 0', async () => {
    const onlyOpens: Stage[] = STAGES.filter((s) => s.kind === 'open');
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return onlyOpens as unknown as Row[];
      return [];
    });
    const m = await getMetrics(client, 'T');
    expect(m.wonRate).toBe(0);
  });
});

describe('branch final pipeline', () => {
  it('avgHours: hrs null cobre ?? 0', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return STAGES as unknown as Row[];
      if (q.text.includes('GROUP BY to_stage_id') && !q.text.includes('AVG'))
        return [{ to_stage_id: 's1', entered: '4' }];
      if (q.text.includes('GROUP BY from_stage_id')) return [];
      if (q.text.includes('AVG')) return [{ to_stage_id: 's2', hrs: null }];
      return [];
    });
    const m = await getMetrics(client, 'T');
    expect(m.avgHoursPerStage).toEqual([{ label: 'Contato', avgHours: 0 }]);
  });
});

describe('branch final: estágio arquivado', () => {
  it('moveLeadStage para estágio arquivado rejeita (linha do throw coberta)', async () => {
    const { client } = fakeClient((q) => {
      if (q.text.startsWith('SELECT stage_id')) return [{ stage_id: 's1', consent: true }];
      if (q.text.startsWith('SELECT kind')) return [{ kind: 'open', archived: true }];
      return [];
    });
    await expect(moveLeadStage(client, 'T', 'L', 's1')).rejects.toThrow(PipelineError);
  });
});

describe('reorder: park cobre arquivados', () => {
  it('estaciona todos os estágios do pipeline inclusive arquivados', async () => {
    const withArchived: Stage[] = [...STAGES, { id: 's5', label: 'Velho', kind: 'open', position: 6, archived: true }];
    const { client, queries } = fakeClient((q) => {
      if (q.text.startsWith('SELECT id FROM lead_pipelines')) return [{ id: 'p1' }];
      if (q.text.startsWith('SELECT id, label')) return withArchived as unknown as Row[];
      if (q.text.startsWith('SELECT id FROM pipeline_stages WHERE pipeline_id'))
        return withArchived.map((s) => ({ id: s.id })) as unknown as Row[];
      return [];
    });
    await reorderStages(client, 'T', ['s1', 's2']);
    const parks = queries.filter((q) => q.text.includes('SET position = $1') && Number(q.values[0]) < 0);
    expect(parks.map((q) => q.values[1]).sort()).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });
});
