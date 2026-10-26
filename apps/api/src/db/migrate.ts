import 'dotenv/config';
import path from 'path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client';

export async function runMigrations(url?: string) {
  const pool = createPool(url);
  try {
    await migrate(createDb(pool), { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().then(() => { console.log('Migrations appliquées.'); }).catch((e) => { console.error(e); process.exit(1); });
}
