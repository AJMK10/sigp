import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { Tx } from '../db/client';
import { entities } from '../db/schema';

/** Numérotation continue des pièces : PREFIXE-ENT01-AAAA-000001. Sans trou, par entité, préfixe et année. */
@Injectable()
export class NumberingService {
  async nextValue(tx: Tx, entityId: number, key: string, year: number): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO sequences (entity_id, key, year, value) VALUES (${entityId}, ${key}, ${year}, 1)
      ON CONFLICT (entity_id, key, year) DO UPDATE SET value = sequences.value + 1
      RETURNING value`);
    return Number((res.rows[0] as { value: number }).value);
  }

  async piece(tx: Tx, entityId: number, prefix: string, date = new Date(), width = 6): Promise<string> {
    const [ent] = await tx.select().from(entities).where(eq(entities.id, entityId));
    const year = date.getFullYear();
    const n = await this.nextValue(tx, entityId, prefix, year);
    return `${prefix}-${ent.shortCode}-${year}-${String(n).padStart(width, '0')}`;
  }

  /** Code d'un bien : MEF-INF-2026-001501. Jamais réattribué. */
  async assetCode(tx: Tx, entityId: number, categoryPrefix: string, year: number): Promise<string> {
    const [ent] = await tx.select().from(entities).where(eq(entities.id, entityId));
    const n = await this.nextValue(tx, entityId, `BIEN-${categoryPrefix}`, year);
    return `${ent.code}-${categoryPrefix}-${year}-${String(n).padStart(6, '0')}`;
  }

  /** Aligne une séquence sur une valeur déjà utilisée (reprise de données). */
  async bump(tx: Tx, entityId: number, key: string, year: number, atLeast: number) {
    await tx.execute(sql`
      INSERT INTO sequences (entity_id, key, year, value) VALUES (${entityId}, ${key}, ${year}, ${atLeast})
      ON CONFLICT (entity_id, key, year) DO UPDATE SET value = GREATEST(sequences.value, ${atLeast})`);
  }
}
