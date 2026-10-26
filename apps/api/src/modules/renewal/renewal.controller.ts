import { Controller, Get, Query } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../db/client';
import { assets, categories, workOrders } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { parse, z } from '../../common/validation';
import { cumulativeAt } from '../depreciation/engine';
import { deprInput, today } from '../assets/assets.util';

/** Criticité par préfixe de catégorie (1 = faible, 3 = forte) : sécurité, continuité de service. */
const CRITICALITY: Record<string, number> = { VEH: 3, INF: 3, GEL: 3, CLI: 2, TEL: 2, BUR: 2, MOT: 2, LOG: 2, IMM: 2, MOB: 1 };

/** Plan pluriannuel de renouvellement : besoins issus de la fin de vie des biens, confrontés à une enveloppe budgétaire. */
@Controller('renouvellement')
export class RenewalController {
  constructor(@InjectDb() private readonly db: DB) {}

  @Get() @Perm('reports.read', 'depreciation.read')
  async plan(@CurrentCtx() ctx: Ctx, @Query() query: unknown) {
    const q = parse(z.object({ horizon: z.coerce.number().int().min(1).max(10).default(5), inflation: z.coerce.number().min(0).max(0.3).default(0.03),
      budget: z.coerce.number().int().nonnegative().optional() }), query);
    const now = today(), y0 = Number(now.slice(0, 4));
    const rows = await this.db.select({ a: assets, c: categories }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId))
      .where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.status, ['EN_SERVICE', 'EN_STOCK', 'EN_MAINTENANCE', 'EN_PRET', 'PROPOSE_REFORME']), sql`${assets.deprMethod} <> 'NON_AMORTISSABLE'`));
    const maint = await this.db.select({ id: workOrders.assetId, s: sql<string>`sum(${workOrders.laborCost} + ${workOrders.partsCost})` }).from(workOrders)
      .where(and(eq(workOrders.entityId, ctx.user.entityId), eq(workOrders.status, 'TERMINE'))).groupBy(workOrders.assetId);
    const mm = new Map(maint.map((m) => [m.id, Number(m.s)]));
    const years = Array.from({ length: q.horizon }, (_, i) => y0 + 1 + i);
    const needs = new Map<number, number>(years.map((y) => [y, 0]));
    const byCat = new Map<string, { label: string; prefix: string; count: number; cost: number; criticality: number; wear: number; byYear: Record<number, number> }>();
    let backlogCount = 0, wearSum = 0, valueSum = 0;
    for (const { a, c } of rows) {
      if (!a.inServiceDate) continue;
      const end = Number(a.inServiceDate.slice(0, 4)) + a.deprYears;
      const wear = a.acquisitionValue ? cumulativeAt(deprInput(a), now) / a.acquisitionValue : 0;
      wearSum += wear * a.acquisitionValue; valueSum += a.acquisitionValue;
      const costly = a.acquisitionValue > 0 && (mm.get(a.id) ?? 0) > a.acquisitionValue * 0.3;
      let year = Math.max(end, y0 + 1);
      if (costly) year = y0 + 1;
      if (end <= y0) backlogCount++;
      if (year > years[years.length - 1]) continue;
      const cost = Math.round(a.acquisitionValue * Math.pow(1 + q.inflation, Math.max(0, year - Number(a.acquisitionDate.slice(0, 4)))));
      needs.set(year, (needs.get(year) ?? 0) + cost);
      const key = c.prefix ?? c.code;
      const x = byCat.get(key) ?? { label: c.label, prefix: key, count: 0, cost: 0, criticality: CRITICALITY[key] ?? 1, wear: 0, byYear: {} };
      x.count++; x.cost += cost; x.wear += wear; x.byYear[year] = (x.byYear[year] ?? 0) + cost; byCat.set(key, x);
    }
    const total = [...needs.values()].reduce((s, v) => s + v, 0);
    const budget = q.budget ?? Math.round(total / q.horizon / 1e6) * 1e6;
    let carry = 0;
    const plan = years.map((y) => {
      const need = needs.get(y)! + carry;
      const funded = Math.min(budget, need);
      carry = need - funded;
      return { year: y, need: needs.get(y)!, withBacklog: need, funded, backlog: carry, overBudget: needs.get(y)! > budget };
    });
    const categoriesOut = [...byCat.values()].map((x) => ({ ...x, wear: x.count ? x.wear / x.count : 0,
      priority: x.criticality >= 3 && x.wear / Math.max(1, x.count) > 0.7 ? 'HAUTE' : x.criticality >= 2 || x.wear / Math.max(1, x.count) > 0.8 ? 'MOYENNE' : 'BASSE' }))
      .sort((a, b) => b.criticality - a.criticality || b.cost - a.cost);
    const peak = plan.reduce((p, x) => (x.need > p.need ? x : p), plan[0]);
    return {
      parameters: { horizon: q.horizon, inflation: q.inflation, budget, suggestedBudget: Math.round(total / q.horizon / 1e6) * 1e6 },
      plan, categories: categoriesOut,
      summary: { total, assets: categoriesOut.reduce((s, c) => s + c.count, 0), peakYear: peak?.year, peakAmount: peak?.need ?? 0, backlogAtHorizon: carry,
        wear: valueSum ? wearSum / valueSum : 0, alreadyBeyondLife: backlogCount },
    };
  }
}
