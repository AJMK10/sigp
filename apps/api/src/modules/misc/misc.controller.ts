import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../db/client';
import { auditLog, notifications } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z, zId } from '../../common/validation';

@Controller('notifications')
export class NotificationsController {
  constructor(@InjectDb() private readonly db: DB) {}
  @Get()
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select().from(notifications).where(eq(notifications.userId, ctx.user.id)).orderBy(desc(notifications.id)).limit(100);
    return { unread: rows.filter((r) => !r.readAt).length, items: rows };
  }
  @Post('lues')
  async readAll(@CurrentCtx() ctx: Ctx) {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { ok: true };
  }
  @Post(':id/lue')
  async read(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, parse(zId, id)), eq(notifications.userId, ctx.user.id)));
    return { ok: true };
  }
}

@Controller('audit')
export class AuditController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}
  @Get() @Perm('audit.read')
  async list(@CurrentCtx() ctx: Ctx, @Query() query: unknown) {
    const q = parse(z.object({ q: z.string().optional(), action: z.string().optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }), query);
    const where = and(eq(auditLog.entityId, ctx.user.entityId), q.action ? eq(auditLog.action, q.action) : undefined,
      q.q ? or(ilike(auditLog.objectRef, `%${q.q}%`), ilike(auditLog.userName, `%${q.q}%`)) : undefined,
      q.from ? gte(auditLog.at, new Date(q.from)) : undefined, q.to ? lte(auditLog.at, new Date(q.to + 'T23:59:59')) : undefined);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)` }).from(auditLog).where(where);
    const items = await this.db.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).limit(50).offset((q.page - 1) * 50);
    return { total: Number(total), items };
  }
  @Get('integrite') @Perm('audit.read')
  verify() { return this.audit.verify(this.db); }
}
