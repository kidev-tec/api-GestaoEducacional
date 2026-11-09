/** Gera client E05 a partir da app Fastify + Postgres temporário. Nunca toca ambiente externo. */
import { buildApp } from '../apps/api/src/app.js';
import { startTestDb } from '../packages/infra/src/test-db.js';

const db = await startTestDb();
const app = await buildApp({ pool: db.pool });
await app.listen({ port: 3100, host: '127.0.0.1' });
try {
  // generate-client recebe a base URL por argv; sem isto usa 3000 e gera snapshot obsoleto.
  process.argv[2] = 'http://127.0.0.1:3100';
  await import('./generate-client.mjs');
} finally {
  await app.close();
  await db.teardown();
}
