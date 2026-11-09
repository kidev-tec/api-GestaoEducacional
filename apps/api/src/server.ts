import { buildApp } from './app.js';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL é obrigatório para subir a API (nunca aponte para produção em dev).');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const app = await buildApp({ pool, logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
