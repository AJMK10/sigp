import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** Transaction ou base : les services acceptent l'un ou l'autre. */
export type Tx = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

export function createPool(url = process.env.DATABASE_URL ?? 'postgres://sigp:sigp@localhost:5432/sigp') {
  return new Pool({ connectionString: url, max: 10 });
}
export function createDb(pool: Pool): DB {
  return drizzle(pool, { schema });
}
export { schema };
