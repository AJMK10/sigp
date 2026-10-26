import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DB } from '../../db/client';
import { journalBatches, journalLines } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z, zId } from '../../common/validation';

@Controller('ecritures')
export class JournalController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  @Get() @Perm('journal.read')
  async list(@CurrentCtx() ctx: Ctx, @Query('status') status?: string) {
    return this.db.select().from(journalBatches).where(and(eq(journalBatches.entityId, ctx.user.entityId), status ? eq(journalBatches.status, status) : undefined))
      .orderBy(desc(journalBatches.id)).limit(300);
  }

  @Get(':id') @Perm('journal.read')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [b] = await this.db.select().from(journalBatches).where(and(eq(journalBatches.id, parse(zId, id)), eq(journalBatches.entityId, ctx.user.entityId)));
    if (!b) throw new NotFoundException('Lot introuvable');
    const lines = await this.db.select().from(journalLines).where(eq(journalLines.batchId, b.id)).orderBy(asc(journalLines.id));
    return { ...b, lines };
  }

  /** Accusé de l'ERP : intégré ou rejeté (avec motif). En production, alimenté par l'interface ERP. */
  @Post(':id/accuse') @Perm('journal.manage')
  async ack(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['INTEGRE', 'REJETE', 'A_ENVOYER']), reason: z.string().optional() }), body);
    if (b.status === 'REJETE' && !b.reason) throw new BadRequestException('Indiquez le motif du rejet');
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(journalBatches).set({ status: b.status, rejectReason: b.status === 'REJETE' ? b.reason! : null })
        .where(and(eq(journalBatches.id, parse(zId, id)), eq(journalBatches.entityId, ctx.user.entityId))).returning();
      if (!r) throw new NotFoundException('Lot introuvable');
      await this.audit.log(tx, ctx, 'ACCUSE_ERP', 'LOT_ECRITURES', r.number, b);
      return r;
    });
  }

  /** Export au format d'import comptable (CSV ; séparateur point-virgule). */
  @Get(':id/export') @Perm('journal.read')
  async export(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    const d = await this.get(ctx, id);
    const rows = [['Journal', 'Date', 'Pièce', 'Compte', 'Libellé', 'Débit', 'Crédit'], ...d.lines.map((l) => ['PAT', d.date, d.number, l.account, l.label, String(l.debit), String(l.credit)])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${d.number}.csv"`);
    res.send('﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n'));
  }
}
