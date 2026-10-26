import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assets, categories, depreciationLines, depreciationRuns, entities, fiscalPeriods, journalBatches } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { parse, z, zId, zPeriod } from '../../common/validation';
import { groupBy, JournalService } from '../journal/journal.service';
import { dotationForPeriod, endOfMonth, previousPeriod } from './engine';
import { deprInput } from '../assets/assets.util';

@Controller('amortissements')
export class DepreciationController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly journal: JournalService) {}

  private async isClosed(tx: Tx, entityId: number, period: string) {
    const [p] = await tx.select().from(fiscalPeriods).where(and(eq(fiscalPeriods.entityId, entityId), eq(fiscalPeriods.period, period)));
    return !!p?.closed;
  }

  /** Calcul des dotations d'une période. SIMULATION : sans effet comptable. DEFINITIF : lignes figées et écriture générée. */
  @Post('calcul') @Perm('depreciation.run')
  async run(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ period: zPeriod, mode: z.enum(['SIMULATION', 'DEFINITIF']) }), body);
    return this.db.transaction(async (tx) => {
      const eid = ctx.user.entityId;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${eid}, 7001)`);
      if (await this.isClosed(tx, eid, b.period)) throw new BadRequestException(`La période ${b.period} est clôturée`);
      if (b.mode === 'DEFINITIF') {
        const [dup] = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, eid), eq(depreciationRuns.period, b.period), eq(depreciationRuns.mode, 'DEFINITIF')));
        if (dup) throw new BadRequestException(`Les dotations de ${b.period} sont déjà comptabilisées (${dup.number})`);
        const [last] = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, eid), eq(depreciationRuns.mode, 'DEFINITIF'))).orderBy(desc(depreciationRuns.period)).limit(1);
        if (last && last.period !== previousPeriod(b.period)) {
          if (last.period > b.period) throw new BadRequestException(`Une période postérieure (${last.period}) est déjà comptabilisée`);
          throw new BadRequestException(`Comptabilisez d'abord ${previousPeriod(b.period)} : les périodes se traitent dans l'ordre`);
        }
      }
      const end = endOfMonth(b.period);
      const rows = await tx.select({ a: assets, c: categories }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId))
        .where(and(eq(assets.entityId, eid), ne(assets.status, 'SORTI'), sql`${assets.acquisitionDate} <= ${end}::date`));
      const anomalies: { assetId: number; code: string; reason: string }[] = [];
      const lines: (typeof depreciationLines.$inferInsert)[] = [];
      for (const { a, c } of rows) {
        if (a.deprMethod === 'NON_AMORTISSABLE') continue;
        if (!a.inServiceDate) {
          if (['EN_SERVICE', 'EN_MAINTENANCE', 'EN_PRET'].includes(a.status)) anomalies.push({ assetId: a.id, code: a.code, reason: 'En service sans date de mise en service' });
          continue;
        }
        if (!c.deprAccount || !c.expenseAccount) { anomalies.push({ assetId: a.id, code: a.code, reason: `Catégorie ${c.code} sans compte d'amortissement ou de dotation` }); continue; }
        const { amount, cumulativeAfter } = dotationForPeriod(deprInput(a), b.period);
        if (amount > 0) lines.push({ runId: 0, assetId: a.id, amount, cumulativeAfter, deprAccount: c.deprAccount, expenseAccount: c.expenseAccount });
      }
      const total = lines.reduce((s, l) => s + l.amount, 0);
      const [ent] = await tx.select().from(entities).where(eq(entities.id, eid));
      if (b.mode === 'SIMULATION') {
        const old = await tx.select({ id: depreciationRuns.id }).from(depreciationRuns).where(and(eq(depreciationRuns.entityId, eid), eq(depreciationRuns.period, b.period), eq(depreciationRuns.mode, 'SIMULATION')));
        if (old.length) await tx.delete(depreciationRuns).where(inArray(depreciationRuns.id, old.map((o) => o.id)));
      }
      const number = b.mode === 'DEFINITIF' ? `DOT-${ent.shortCode}-${b.period}` : `SIM-${ent.shortCode}-${b.period}`;
      const [run] = await tx.insert(depreciationRuns).values({ entityId: eid, number, period: b.period, mode: b.mode, assetCount: lines.length, total, anomalies, createdBy: ctx.user.id }).returning();
      for (let i = 0; i < lines.length; i += 1000) await tx.insert(depreciationLines).values(lines.slice(i, i + 1000).map((l) => ({ ...l, runId: run.id })));
      if (b.mode === 'DEFINITIF') {
        const deb = groupBy(lines.map((l) => ({ account: l.expenseAccount ?? null, amount: l.amount })), '6813');
        const cre = groupBy(lines.map((l) => ({ account: l.deprAccount ?? null, amount: l.amount })), '2840');
        await this.journal.createBatch(tx, ctx, { originType: 'DOTATION', originRef: number, label: `Dotations aux amortissements ${b.period}`, date: end,
          lines: [...deb.map(([account, amount]) => ({ account, label: `Dotations aux amortissements ${b.period}`, debit: amount })), ...cre.map(([account, amount]) => ({ account, label: `Amortissements ${b.period}`, credit: amount }))] });
      }
      await this.audit.log(tx, ctx, b.mode === 'DEFINITIF' ? 'DOTATION_DEFINITIVE' : 'DOTATION_SIMULATION', 'DOTATION', number, { biens: lines.length, total, anomalies: anomalies.length });
      return this.summary(tx, run.id);
    });
  }

  private async summary(tx: Tx, runId: number) {
    const [run] = await tx.select().from(depreciationRuns).where(eq(depreciationRuns.id, runId));
    const byAccount = await tx.select({ deprAccount: depreciationLines.deprAccount, expenseAccount: depreciationLines.expenseAccount, assets: sql<number>`count(*)`, amount: sql<string>`sum(${depreciationLines.amount})` })
      .from(depreciationLines).where(eq(depreciationLines.runId, runId)).groupBy(depreciationLines.deprAccount, depreciationLines.expenseAccount).orderBy(asc(depreciationLines.deprAccount));
    const accLabels = await tx.select({ acc: categories.deprAccount, label: categories.label }).from(categories);
    const lab = new Map<string, string>();
    for (const a of accLabels) if (a.acc && !lab.has(a.acc)) lab.set(a.acc, a.label);
    const [batch] = await tx.select().from(journalBatches).where(eq(journalBatches.originRef, run.number)).orderBy(desc(journalBatches.id)).limit(1);
    return { ...run, journal: batch ?? null, byAccount: byAccount.map((r) => ({ ...r, assets: Number(r.assets), amount: Number(r.amount), label: lab.get(r.deprAccount ?? '') ?? '' })) };
  }

  @Get('calculs') @Perm('depreciation.read')
  async runs(@CurrentCtx() ctx: Ctx) {
    return this.db.select().from(depreciationRuns).where(eq(depreciationRuns.entityId, ctx.user.entityId)).orderBy(desc(depreciationRuns.period), desc(depreciationRuns.id)).limit(100);
  }

  @Get('calculs/:id') @Perm('depreciation.read')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('page') page = '1') {
    const [run] = await this.db.select().from(depreciationRuns).where(and(eq(depreciationRuns.id, parse(zId, id)), eq(depreciationRuns.entityId, ctx.user.entityId)));
    if (!run) throw new NotFoundException('Calcul introuvable');
    const p = Math.max(1, Number(page) || 1);
    const lines = await this.db.select({ l: depreciationLines, code: assets.code, designation: assets.designation, value: assets.acquisitionValue }).from(depreciationLines)
      .innerJoin(assets, eq(assets.id, depreciationLines.assetId)).where(eq(depreciationLines.runId, run.id)).orderBy(desc(depreciationLines.amount)).limit(50).offset((p - 1) * 50);
    return { ...(await this.summary(this.db, run.id)), lines: lines.map((l) => ({ ...l.l, code: l.code, designation: l.designation, value: l.value })) };
  }

  /** Annulation d'un calcul définitif (période ouverte, dernière période, écriture non intégrée). */
  @Post('calculs/:id/annuler') @Perm('depreciation.run')
  async cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ reason: z.string().min(5, 'motif trop court') }), body);
    return this.db.transaction(async (tx) => {
      const [run] = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.id, parse(zId, id)), eq(depreciationRuns.entityId, ctx.user.entityId)));
      if (!run || run.mode !== 'DEFINITIF') throw new BadRequestException('Seul un calcul définitif peut être annulé');
      if (await this.isClosed(tx, run.entityId, run.period)) throw new BadRequestException('Période clôturée');
      const [later] = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, run.entityId), eq(depreciationRuns.mode, 'DEFINITIF'), sql`${depreciationRuns.period} > ${run.period}`));
      if (later) throw new BadRequestException(`Annulez d'abord ${later.number}`);
      const [batch] = await tx.select().from(journalBatches).where(eq(journalBatches.originRef, run.number)).orderBy(desc(journalBatches.id)).limit(1);
      if (batch?.status === 'INTEGRE') throw new BadRequestException("L'écriture est déjà intégrée dans l'ERP : passez une écriture d'extourne côté comptabilité");
      if (batch) await tx.update(journalBatches).set({ status: 'ANNULE', rejectReason: b.reason }).where(eq(journalBatches.id, batch.id));
      await tx.update(depreciationRuns).set({ mode: 'ANNULE', number: `${run.number}-ANN${run.id}` }).where(eq(depreciationRuns.id, run.id));
      await this.audit.log(tx, ctx, 'ANNULATION_DOTATION', 'DOTATION', run.number, { motif: b.reason });
      return { ok: true };
    });
  }

  @Get('periodes') @Perm('depreciation.read')
  async periods(@CurrentCtx() ctx: Ctx, @Query('year') year?: string) {
    const y = Number(year) || new Date().getFullYear();
    const runs = await this.db.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, ctx.user.entityId), sql`${depreciationRuns.period} like ${y + '-%'}`, ne(depreciationRuns.mode, 'ANNULE')));
    const closed = await this.db.select().from(fiscalPeriods).where(and(eq(fiscalPeriods.entityId, ctx.user.entityId), sql`${fiscalPeriods.period} like ${y + '-%'}`));
    return Array.from({ length: 12 }, (_, i) => {
      const period = `${y}-${String(i + 1).padStart(2, '0')}`;
      const def = runs.find((r) => r.period === period && r.mode === 'DEFINITIF');
      const sim = runs.find((r) => r.period === period && r.mode === 'SIMULATION');
      return { period, closed: !!closed.find((c) => c.period === period && c.closed), definitive: def ? { id: def.id, number: def.number, total: def.total } : null, simulation: sim ? { id: sim.id, total: sim.total } : null };
    });
  }

  /** Clôture d'une période : verrouille les dotations ; plus aucun calcul possible sur cette période. */
  @Post('periodes/:period/cloturer') @Perm('periods.close')
  async closePeriod(@CurrentCtx() ctx: Ctx, @Param('period') period: string) {
    const p = parse(zPeriod, period);
    return this.db.transaction(async (tx) => {
      const [def] = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, ctx.user.entityId), eq(depreciationRuns.period, p), eq(depreciationRuns.mode, 'DEFINITIF')));
      if (!def) throw new BadRequestException('Comptabilisez les dotations de la période avant de la clôturer');
      await tx.insert(fiscalPeriods).values({ entityId: ctx.user.entityId, period: p, closed: true, closedAt: new Date(), closedBy: ctx.user.id })
        .onConflictDoUpdate({ target: [fiscalPeriods.entityId, fiscalPeriods.period], set: { closed: true, closedAt: new Date(), closedBy: ctx.user.id } });
      await this.audit.log(tx, ctx, 'CLOTURE_PERIODE', 'PERIODE', p, {});
      return { ok: true };
    });
  }
}
