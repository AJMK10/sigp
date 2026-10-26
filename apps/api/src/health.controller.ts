import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from './db/client';
import { InjectDb } from './common/db.module';
import { Public } from './common/context';

@Controller('sante')
export class HealthController {
  constructor(@InjectDb() private readonly db: DB) {}
  @Public() @Get()
  async health() { await this.db.execute(sql`select 1`); return { status: 'ok', version: '1.0.0', at: new Date().toISOString() }; }
}
