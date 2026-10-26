import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { desc, sql } from 'drizzle-orm';
import { Tx } from '../db/client';
import { auditLog } from '../db/schema';
import type { Ctx } from './context';

const GENESIS = '0'.repeat(64);

/** Sérialisation canonique (clés triées) : jsonb ne conserve pas l'ordre des clés. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

export function auditHash(prev: string, e: { at: string; userId: number | null; action: string; objectType: string | null; objectRef: string | null; detail: unknown }) {
  return createHash('sha256').update(prev + canonical([e.at, e.userId, e.action, e.objectType, e.objectRef, e.detail])).digest('hex');
}

@Injectable()
export class AuditService {
  /** Ajoute un événement au journal, chaîné au précédent. À appeler dans la transaction de l'opération. */
  async log(tx: Tx, ctx: Ctx | null, action: string, objectType: string | null, objectRef: string | null, detail: Record<string, unknown> = {}) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(424242)`); // sérialise le chaînage
    const [last] = await tx.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    const prevHash = last?.hash ?? GENESIS;
    const at = new Date();
    const clean = JSON.parse(JSON.stringify(detail ?? {})) as Record<string, unknown>; // forme exacte stockée en jsonb
    const entry = { at: at.toISOString(), userId: ctx?.user.id ?? null, action, objectType, objectRef, detail: clean };
    await tx.insert(auditLog).values({
      entityId: ctx?.user.entityId ?? null, at, userId: entry.userId, userName: ctx?.user.fullName ?? 'Système', action, objectType, objectRef,
      detail: clean, ip: ctx?.ip ?? null, prevHash, hash: auditHash(prevHash, entry),
    });
  }

  /** Recalcule toute la chaîne et indique la première rupture éventuelle. */
  async verify(tx: Tx): Promise<{ ok: boolean; count: number; brokenAt?: number }> {
    const rows = await tx.select().from(auditLog).orderBy(auditLog.id);
    let prev = GENESIS;
    for (const r of rows) {
      const h = auditHash(prev, { at: r.at.toISOString(), userId: r.userId, action: r.action, objectType: r.objectType, objectRef: r.objectRef, detail: r.detail });
      if (r.prevHash !== prev || r.hash !== h) return { ok: false, count: rows.length, brokenAt: r.id };
      prev = r.hash;
    }
    return { ok: true, count: rows.length };
  }
}
