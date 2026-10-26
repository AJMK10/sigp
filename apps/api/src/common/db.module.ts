import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { createDb, createPool, DB } from '../db/client';

export const DB_TOKEN = 'DB';
export const POOL_TOKEN = 'POOL';
export const InjectDb = () => Inject(DB_TOKEN);

@Global()
@Module({
  providers: [
    { provide: POOL_TOKEN, useFactory: () => createPool() },
    { provide: DB_TOKEN, useFactory: (pool: Pool): DB => createDb(pool), inject: [POOL_TOKEN] },
  ],
  exports: [DB_TOKEN, POOL_TOKEN],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}
  async onApplicationShutdown() { await this.pool.end(); }
}
