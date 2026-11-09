/**
 * Gera o client da API a partir do /openapi.json da API (RF-011).
 * Rodar com a API no ar: node scripts/generate-client.mjs http://localhost:3000
 * Saída: apps/web/src/api-client/ — GERADO, nunca editado à mão.
 *
 * Uso: node scripts/generate-client.mjs [baseUrl]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/src/api-client');

const res = await fetch(`${baseUrl}/openapi.json`);
if (!res.ok) throw new Error(`API respondeu ${res.status} — suba a API primeiro`);
const spec = await res.json();

const paths = spec.paths ?? {};
const operations = [];

for (const [path, methods] of Object.entries(paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (typeof op !== 'object' || !op?.operationId && !op?.description && !op?.summary) {
      // ainda assim aceitamos rotas sem operationId: geramos nome do path
    }
    const name = op.operationId ?? op.summary ?? `${method}${path.replaceAll('/', '-')}`;
    operations.push({ name: toCamel(name), method: method.toUpperCase(), path, op });
  }
}

function toCamel(s) {
  return s
    .replace(/[{}]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

function paramsOf(path) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

let code = `/* GERADO por scripts/generate-client.mjs — NÃO EDITAR À MÃO (RF-011) */
/* eslint-disable */
export interface ApiConfig {
  baseUrl: string;
  getTenantId: () => string;
}

let config: ApiConfig = {
  baseUrl: import.meta.env?.VITE_API_URL ?? 'http://localhost:3000',
  getTenantId: () => localStorage.getItem('erp-tenant') ?? '',
};

export function configureApi(cfg: Partial<ApiConfig>): void {
  config = { ...config, ...cfg };
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(\`API \${status}\`);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const filled = path.replaceAll(/\\{(\\w+)\\}/g, (_, k) => {
    const v = opts.headers?.[k];
    if (!v) throw new Error(\`missing path param \${k}\`);
    return encodeURIComponent(v);
  });
  const res = await fetch(config.baseUrl + filled, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': config.getTenantId(),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
`;

for (const op of operations) {
  const pathParams = paramsOf(op.path);
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(op.method);
  const needsKey = op.path.includes('/ledger/entries') || op.path === '/v1/enrollments';
  const paramsList = [
    ...pathParams.map((p) => `${p}: string`),
    hasBody ? 'body: unknown' : null,
    needsKey ? 'idempotencyKey: string' : null,
  ].filter(Boolean);

  const headersParts = [
    ...(needsKey ? ["'idempotency-key': idempotencyKey"] : []),
    ...pathParams.map((p) => `${p}: ${p}`),
  ];
  const optsParts = [hasBody ? 'body' : '', headersParts.length ? `headers: { ${headersParts.join(', ')} }` : ''].filter(Boolean);
  const optsArg = optsParts.length ? `{ ${optsParts.join(', ')} }` : '';

  code += `
export function ${op.name}(${paramsList.join(', ')}): Promise<unknown> {
  return request<unknown>('${op.method}', '${op.path}'${optsArg ? `, ${optsArg}` : ''});
}
`;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'client.ts'), code);
writeFileSync(join(outDir, 'openapi.snapshot.json'), JSON.stringify(spec, null, 2));
console.log(`Client gerado com ${operations.length} operações → apps/web/src/api-client/`);
