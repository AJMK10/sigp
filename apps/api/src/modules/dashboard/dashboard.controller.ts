import { Controller, Get } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { DB } from '../../db/client';
import { approvals, assets, auditLog, categories, inventoryCampaigns, inventoryCounts, inventoryExpected, inventoryGaps, movements } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { cumulativeAt } from '../depreciation/engine';
import { deprInput, today } from '../assets/assets.util';

@Controller('tableau-de-bord')
export class DashboardController {
  constructor(@InjectDb() private readonly db: DB) {}

  @Get() @Perm('dashboard.read')
  async get(@CurrentCtx() ctx: Ctx) {
    const eid = ctx.user.entityId;
    const now = today();
    const year = Number(now.slice(0, 4));
    const cats = await this.db.select().from(categories).where(eq(categories.entityId, eid));
    const catById = new Map(cats.map((c) => [c.id, c]));
    const root = (id: number) => { let c = catById.get(id); while (c?.parentId && catById.get(c.parentId)?.parentId) c = catById.get(c.parentId); return c; };
    const rows = await this.db.select({ id: assets.id, status: assets.status, categoryId: assets.categoryId, acquisitionValue: assets.acquisitionValue, residualValue: assets.residualValue,
      deprMethod: assets.deprMethod, deprYears: assets.deprYears, inServiceDate: assets.inServiceDate, acquisitionDate: assets.acquisitionDate, exitDate: assets.exitDate,
      labelStatus: assets.labelStatus, warrantyEnd: assets.warrantyEnd,
      revisedAt: assets.revisedAt, revisedCumulative: assets.revisedCumulative, previousYears: assets.previousYears, impairment: assets.impairment }).from(assets).where(eq(assets.entityId, eid));

    let gross = 0, cum = 0, imp = 0, active = 0, fullyDepr = 0, lowValue = 0;
    const byStatus: Record<string, number> = {};
    const byCat = new Map<string, { label: string; nbv: number; gross: number; count: number }>();
    const history = Array.from({ length: 5 }, (_, i) => ({ year: year - 4 + i, gross: 0, nbv: 0 }));
    for (const a of rows) {
      for (const h of history) {
        const end = h.year === year ? now : `${h.year}-12-31`;
        if (a.acquisitionDate <= end && (!a.exitDate || a.exitDate > end)) { const c = cumulativeAt(deprInput(a), end); h.gross += a.acquisitionValue; h.nbv += a.acquisitionValue - c - a.impairment; }
      }
      if (a.status === 'SORTI') continue;
      active++;
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      const c = cumulativeAt(deprInput(a), now);
      gross += a.acquisitionValue; cum += c; imp += a.impairment;
      if (a.deprMethod !== 'NON_AMORTISSABLE' && a.acquisitionValue > 0 && c >= a.acquisitionValue - a.residualValue && a.status === 'EN_SERVICE') fullyDepr++;
      if (a.acquisitionValue < 300_000) lowValue++;
      const r = root(a.categoryId);
      const key = r?.code ?? '?';
      const x = byCat.get(key) ?? { label: r?.label ?? 'Autres', nbv: 0, gross: 0, count: 0 };
      x.nbv += a.acquisitionValue - c - a.impairment; x.gross += a.acquisitionValue; x.count++; byCat.set(key, x);
    }
    const [lastCampaign] = await this.db.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.entityId, eid), ne(inventoryCampaigns.status, 'PREPARATION'))).orderBy(desc(inventoryCampaigns.id)).limit(1);
    let inventory = null;
    if (lastCampaign) {
      const [{ found }] = await this.db.select({ found: sql<number>`count(distinct ${inventoryCounts.assetId})` }).from(inventoryCounts)
        .innerJoin(inventoryExpected, and(eq(inventoryExpected.campaignId, inventoryCounts.campaignId), eq(inventoryExpected.assetId, inventoryCounts.assetId))).where(eq(inventoryCounts.campaignId, lastCampaign.id));
      const [{ gaps }] = await this.db.select({ gaps: count() }).from(inventoryGaps).where(eq(inventoryGaps.campaignId, lastCampaign.id));
      const [{ open }] = await this.db.select({ open: count() }).from(inventoryGaps).where(and(eq(inventoryGaps.campaignId, lastCampaign.id), ne(inventoryGaps.status, 'REGULARISE')));
      inventory = { id: lastCampaign.id, number: lastCampaign.number, label: lastCampaign.label, status: lastCampaign.status, endDate: lastCampaign.endDate, expected: lastCampaign.expectedCount,
        found: Number(found), coverage: lastCampaign.expectedCount ? Number(found) / lastCampaign.expectedCount : 0, gaps: Number(gaps), openGaps: Number(open) };
    }
    const myRoleFilter = ctx.user.role === 'ADMIN' ? undefined : sql`(${approvals.role} = ${ctx.user.role} or ${approvals.userId} = ${ctx.user.id})`;
    const [{ pending }] = await this.db.select({ pending: count() }).from(approvals).where(and(eq(approvals.entityId, eid), eq(approvals.status, 'EN_COURS'), myRoleFilter));
    const [{ late }] = await this.db.select({ late: count() }).from(approvals).where(and(eq(approvals.entityId, eid), eq(approvals.status, 'EN_COURS'), myRoleFilter, sql`${approvals.dueAt} < now()`));
    const [{ unsigned }] = await this.db.select({ unsigned: count() }).from(approvals).where(and(eq(approvals.entityId, eid), eq(approvals.status, 'EN_COURS'), isNotNull(approvals.userId)));
    const [{ overdue }] = await this.db.select({ overdue: count() }).from(movements).where(and(eq(movements.entityId, eid), eq(movements.type, 'PRET'), eq(movements.status, 'EXECUTE'), sql`${movements.dueDate} < ${now}::date`,
      sql`exists (select 1 from movement_items mi join assets a on a.id = mi.asset_id where mi.movement_id = ${movements.id} and a.status = 'EN_PRET')`));
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const warranties = rows.filter((a) => a.status !== 'SORTI' && a.warrantyEnd && a.warrantyEnd >= now && a.warrantyEnd <= in30).length;
    const labelsPending = rows.filter((a) => a.status !== 'SORTI' && a.labelStatus !== 'CONTROLEE').length;
    const recent = await this.db.select().from(auditLog).where(and(eq(auditLog.entityId, eid), inArray(auditLog.action, ['CREATION', 'SOUMISSION', 'VALIDATION', 'EXECUTION', 'IMMATRICULATION', 'DOTATION_DEFINITIVE', 'SORTIE', 'CLOTURE', 'LANCEMENT', 'REJET'])))
      .orderBy(desc(auditLog.id)).limit(8);
    return {
      asOf: now, grossValue: gross, nbv: gross - cum - imp, impairment: imp, wearRate: gross ? cum / gross : 0, activeCount: active, lowValueCount: lowValue,
      byStatus, byCategory: [...byCat.values()].sort((a, b) => b.nbv - a.nbv), history,
      control: { inventory, missing: byStatus.MANQUANT ?? 0, fullyDepreciatedInService: fullyDepr, unsignedDischarges: Number(unsigned), labelsPending, overdueLoans: Number(overdue), warrantiesExpiring: warranties },
      validations: { pending: Number(pending), late: Number(late) },
      recent: recent.map((r) => ({ at: r.at, action: r.action, objectType: r.objectType, objectRef: r.objectRef, user: r.userName, detail: r.detail })),
    };
  }
}
