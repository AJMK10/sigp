import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { Tx } from '../db/client';
import { notifications, users } from '../db/schema';
import type { Role } from './permissions';

@Injectable()
export class NotifyService {
  async toUsers(tx: Tx, userIds: number[], n: { kind?: string; title: string; body: string; link?: string }) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return;
    await tx.insert(notifications).values(ids.map((userId) => ({ userId, kind: n.kind ?? 'info', title: n.title, body: n.body, link: n.link ?? null })));
  }
  async toRole(tx: Tx, entityId: number, role: Role, n: { kind?: string; title: string; body: string; link?: string }) {
    const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.entityId, entityId), eq(users.role, role), eq(users.active, true)));
    await this.toUsers(tx, rows.map((r) => r.id), n);
  }
  async toRoles(tx: Tx, entityId: number, roles: Role[], n: { kind?: string; title: string; body: string; link?: string }) {
    const rows = await tx.select({ id: users.id }).from(users).where(and(eq(users.entityId, entityId), inArray(users.role, roles), eq(users.active, true)));
    await this.toUsers(tx, rows.map((r) => r.id), n);
  }
}
