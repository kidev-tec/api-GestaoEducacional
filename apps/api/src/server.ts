import { buildApp } from './app.js';
import { Pool } from 'pg';
import { OutboxWorker } from './outbox-worker.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL é obrigatório para subir a API (nunca aponte para produção em dev).');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const app = await buildApp({ pool, logger: true });

// E03-C: consumer real do outbox — handler idempotente (dedupe por processedAt no worker)
const worker = new OutboxWorker({ pool });
worker.on('tuition.generated', async (ev) => {
  const payload = ev.payload as { tuitionId?: string } | undefined;
  const tuitionId = payload?.tuitionId;
  if (!tuitionId) throw new Error('tuition.generated sem tuitionId no payload');
  const res = await pool.query(
    'UPDATE tuitions SET notified_at = now() WHERE id = $1 AND tenant_id = $2 AND notified_at IS NULL',
    [tuitionId, ev.tenantId],
  );
  if (!res.rowCount) {
    // já notificado (idempotência) — não falha, apenas não faz nada
    console.log(JSON.stringify({ event: 'tuition.generated', tenantId: ev.tenantId, tuitionId, note: 'already notified' }));
    return;
  }
  console.log(JSON.stringify({ event: 'tuition.generated', tenantId: ev.tenantId, tuitionId, notified: true }));
});
worker.start();

// Graceful shutdown: para o worker e fecha o app/pool
async function shutdown(signal: string) {
  console.log(JSON.stringify({ msg: 'shutting down', signal }));
  worker.stop();
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
