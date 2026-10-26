import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assetEvents, assets, categories, contractAssets, contracts, holderRequests, maintenancePlans, vehicles, workOrders } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { NotifyService } from '../../common/notify.service';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { today } from '../assets/assets.util';
import { locationPaths } from '../referentials/referentials.controller';

const STATUS_FLOW: Record<string, string[]> = {
  A_PLANIFIER: ['PLANIFIE', 'EN_COURS', 'ANNULE'], PLANIFIE: ['EN_COURS', 'ANNULE', 'A_PLANIFIER'], EN_COURS: ['ATTENTE_PIECES', 'TERMINE'],
  ATTENTE_PIECES: ['EN_COURS', 'TERMINE'], TERMINE: [], ANNULE: [],
};
/** Seuil au-delà duquel le coût cumulé d'entretien justifie une proposition de réforme. */
const REFORM_THRESHOLD = 0.3;
const addMonths = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

/** Contrat de maintenance ou garantie couvrant un bien à une date. */
export async function coverage(tx: Tx, assetId: number, date = today()) {
  const [c] = await tx.select({ c: contracts }).from(contractAssets).innerJoin(contracts, eq(contracts.id, contractAssets.contractId))
    .where(and(eq(contractAssets.assetId, assetId), inArray(contracts.kind, ['MAINTENANCE', 'GARANTIE']), eq(contracts.active, true), lte(contracts.startDate, date), gte(contracts.endDate, date))).limit(1);
  if (c) return { type: c.c.kind, label: `${c.c.number} · ${c.c.provider}`, contractId: c.c.id, until: c.c.endDate };
  const [a] = await tx.select({ w: assets.warrantyEnd }).from(assets).where(eq(assets.id, assetId));
  if (a?.w && a.w >= date) return { type: 'GARANTIE', label: 'Garantie constructeur', contractId: null, until: a.w };
  return null;
}

@Controller('maintenance')
export class MaintenanceController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly notify: NotifyService) {}

  @Get() @Perm('assets.read', 'maintenance.manage')
  async board(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ w: workOrders, code: assets.code, designation: assets.designation, value: assets.acquisitionValue }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(eq(workOrders.entityId, ctx.user.entityId), sql`(${workOrders.status} not in ('TERMINE','ANNULE') or ${workOrders.doneAt} > now() - interval '45 days')`))
      .orderBy(desc(workOrders.id));
    const y = `${today().slice(0, 4)}-01-01`;
    const done = await this.db.select().from(workOrders).where(and(eq(workOrders.entityId, ctx.user.entityId), eq(workOrders.status, 'TERMINE'), gte(workOrders.doneAt, new Date(y))));
    const corr = done.filter((w) => w.kind === 'CORRECTIF' && w.startedAt && w.doneAt);
    const mttr = corr.length ? corr.reduce((s, w) => s + (w.doneAt!.getTime() - w.startedAt!.getTime()) / 86400000, 0) / corr.length : null;
    const [{ n: immobilized }] = await this.db.select({ n: count() }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), eq(assets.status, 'EN_MAINTENANCE')));
    const plans = await this.upcoming(ctx, '45');
    return {
      items: rows.map((r) => ({ ...r.w, code: r.code, designation: r.designation, cost: r.w.laborCost + r.w.partsCost })),
      kpi: { mttrDays: mttr, preventiveShare: done.length ? done.filter((w) => w.kind === 'PREVENTIF').length / done.length : null, costYear: done.reduce((s, w) => s + w.laborCost + w.partsCost, 0),
        immobilized: Number(immobilized), open: rows.filter((r) => !['TERMINE', 'ANNULE'].includes(r.w.status)).length },
      upcoming: plans,
    };
  }

  @Get('ot/:id') @Perm('assets.read', 'maintenance.manage')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [r] = await this.db.select({ w: workOrders, a: assets }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).where(and(eq(workOrders.id, parse(zId, id)), eq(workOrders.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Ordre de travail introuvable');
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const [{ s }] = await this.db.select({ s: sql<string>`coalesce(sum(${workOrders.laborCost} + ${workOrders.partsCost}),0)` }).from(workOrders).where(and(eq(workOrders.assetId, r.a.id), eq(workOrders.status, 'TERMINE')));
    const [ct] = r.w.contractId ? await this.db.select().from(contracts).where(eq(contracts.id, r.w.contractId)) : [];
    const total = Number(s);
    return { ...r.w, asset: { id: r.a.id, code: r.a.code, designation: r.a.designation, status: r.a.status, value: r.a.acquisitionValue, location: r.a.locationId ? paths.get(r.a.locationId) : null },
      contract: ct ?? null, coverage: await coverage(this.db, r.a.id), maintenanceTotal: total, reformSuggested: r.a.acquisitionValue > 0 && total > r.a.acquisitionValue * REFORM_THRESHOLD, next: STATUS_FLOW[r.w.status] };
  }

  /** Couverture (contrat, garantie) d'un bien : affichée dès la déclaration de l'incident. */
  @Get('couverture/:assetId') @Perm('assets.read', 'maintenance.manage')
  async cover(@Param('assetId') assetId: string) { return coverage(this.db, parse(zId, assetId)); }

  @Post('ot') @Perm('maintenance.manage')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ assetId: zId, kind: z.enum(['CORRECTIF', 'PREVENTIF']), title: z.string().min(3), description: z.string().optional(), priority: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']).default('NORMALE'),
      plannedDate: zDate.nullable().optional(), assignee: z.string().optional(), requestId: zId.nullable().optional() }), body);
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(assets).where(and(eq(assets.id, b.assetId), eq(assets.entityId, ctx.user.entityId)));
      if (!a) throw new NotFoundException('Bien introuvable');
      if (a.status === 'SORTI') throw new BadRequestException('Bien sorti du patrimoine');
      const cov = await coverage(tx, a.id);
      const number = await this.numbering.piece(tx, ctx.user.entityId, 'OT', new Date(), 4);
      const [w] = await tx.insert(workOrders).values({ entityId: ctx.user.entityId, number, ...b, requestId: b.requestId ?? null, plannedDate: b.plannedDate ?? null,
        status: b.plannedDate ? 'PLANIFIE' : 'A_PLANIFIER', contractId: cov?.contractId ?? null, assignee: b.assignee ?? (cov ? cov.label : null), createdBy: ctx.user.id }).returning();
      if (b.requestId) await tx.update(holderRequests).set({ status: 'EN_COURS', response: `Pris en charge : ordre de travail ${number}` }).where(and(eq(holderRequests.id, b.requestId), eq(holderRequests.entityId, ctx.user.entityId)));
      await tx.insert(assetEvents).values({ assetId: a.id, type: 'MAINTENANCE', documentNo: number, summary: `Ordre de travail ${b.kind.toLowerCase()} : ${b.title}`, actorId: ctx.user.id });
      await this.audit.log(tx, ctx, 'CREATION', 'OT', number, { bien: a.code, ...b, couverture: cov?.label ?? null });
      return { ...w, coverage: cov };
    });
  }

  @Patch('ot/:id') @Perm('maintenance.manage')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['A_PLANIFIER', 'PLANIFIE', 'EN_COURS', 'ATTENTE_PIECES', 'TERMINE', 'ANNULE']).optional(), assignee: z.string().optional(), plannedDate: zDate.nullable().optional(),
      laborCost: zMoney.optional(), partsCost: zMoney.optional(), report: z.string().optional(), priority: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']).optional() }), body);
    return this.db.transaction(async (tx) => {
      const [w] = await tx.select().from(workOrders).where(and(eq(workOrders.id, parse(zId, id)), eq(workOrders.entityId, ctx.user.entityId))).for('update');
      if (!w) throw new NotFoundException('Ordre de travail introuvable');
      const patch: Partial<typeof workOrders.$inferInsert> = { ...b };
      const [a] = await tx.select().from(assets).where(eq(assets.id, w.assetId));
      if (b.status && b.status !== w.status) {
        if (!STATUS_FLOW[w.status].includes(b.status)) throw new BadRequestException(`Passage impossible de ${w.status.toLowerCase().replace('_', ' ')} à ${b.status.toLowerCase().replace('_', ' ')}`);
        if (b.status === 'EN_COURS' && !w.startedAt) {
          patch.startedAt = new Date();
          if (['EN_SERVICE', 'EN_STOCK'].includes(a.status)) { patch.previousStatus = a.status; await tx.update(assets).set({ status: 'EN_MAINTENANCE', updatedAt: new Date() }).where(eq(assets.id, a.id)); }
        }
        if (b.status === 'TERMINE') {
          if (!(b.report ?? w.report)) throw new BadRequestException("Le compte rendu d'intervention est obligatoire pour clore l'ordre");
          patch.doneAt = new Date();
          if (a.status === 'EN_MAINTENANCE') await tx.update(assets).set({ status: w.previousStatus ?? 'EN_SERVICE', condition: a.condition === 'HORS_USAGE' || a.condition === 'MAUVAIS' ? 'MOYEN' : a.condition, updatedAt: new Date() }).where(eq(assets.id, a.id));
          if (w.kind === 'PREVENTIF') { const [v] = await tx.select().from(vehicles).where(eq(vehicles.assetId, a.id)); if (v) await tx.update(vehicles).set({ lastServiceKm: v.mileage }).where(eq(vehicles.assetId, a.id)); }
          if (w.requestId) await tx.update(holderRequests).set({ status: 'TRAITEE', response: `Intervention terminée (${w.number}) : ${b.report ?? w.report}` }).where(eq(holderRequests.id, w.requestId));
          await tx.insert(assetEvents).values({ assetId: a.id, type: 'MAINTENANCE', documentNo: w.number, summary: `Intervention terminée : ${w.title}`, actorId: ctx.user.id });
        }
        if (b.status === 'ANNULE' && a.status === 'EN_MAINTENANCE' && w.previousStatus) await tx.update(assets).set({ status: w.previousStatus }).where(eq(assets.id, a.id));
        if (b.status === 'PLANIFIE' && !(b.plannedDate ?? w.plannedDate)) throw new BadRequestException('Indiquez la date planifiée');
      }
      await tx.update(workOrders).set(patch).where(eq(workOrders.id, w.id));
      await this.audit.log(tx, ctx, 'MODIFICATION', 'OT', w.number, b);
      return { ok: true };
    });
  }

  @Get('plans') @Perm('assets.read', 'maintenance.manage')
  async plans(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ p: maintenancePlans, code: assets.code, designation: assets.designation, category: categories.label, contract: contracts.number })
      .from(maintenancePlans).leftJoin(assets, eq(assets.id, maintenancePlans.assetId)).leftJoin(categories, eq(categories.id, maintenancePlans.categoryId)).leftJoin(contracts, eq(contracts.id, maintenancePlans.contractId))
      .where(eq(maintenancePlans.entityId, ctx.user.entityId)).orderBy(asc(maintenancePlans.nextDate));
    const counts = await this.db.select({ c: assets.categoryId, n: count() }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.status, ['EN_SERVICE', 'EN_STOCK']))).groupBy(assets.categoryId);
    const m = new Map(counts.map((x) => [x.c, Number(x.n)]));
    return rows.map((r) => ({ ...r.p, code: r.code, designation: r.designation, category: r.category, contract: r.contract, assetCount: r.p.assetId ? 1 : m.get(r.p.categoryId ?? -1) ?? 0 }));
  }

  @Get('preventif') @Perm('assets.read', 'maintenance.manage')
  async upcoming(@CurrentCtx() ctx: Ctx, @Query('days') days = '30') {
    const until = new Date(Date.now() + Number(days) * 86400000).toISOString().slice(0, 10);
    return (await this.plans(ctx)).filter((p) => p.active && p.nextDate <= until);
  }

  @Post('plans') @Perm('maintenance.manage')
  async createPlan(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ label: z.string().min(3), assetId: zId.nullable().optional(), categoryId: zId.nullable().optional(), frequencyMonths: z.coerce.number().int().min(1).max(120),
      nextDate: zDate, contractId: zId.nullable().optional(), assignee: z.string().optional() }).refine((x) => !!x.assetId !== !!x.categoryId, { message: 'un plan vise soit un bien, soit une catégorie' }), body);
    return this.db.transaction(async (tx) => {
      const [p] = await tx.insert(maintenancePlans).values({ entityId: ctx.user.entityId, ...b }).returning();
      await this.audit.log(tx, ctx, 'CREATION', 'PLAN_MAINTENANCE', b.label, b);
      return p;
    });
  }

  /** Génère les ordres de travail préventifs arrivés à échéance (plans dont la date est atteinte sous `days` jours). */
  @Post('plans/generer') @Perm('maintenance.manage')
  async generate(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ days: z.coerce.number().int().min(0).max(90).default(15) }), body);
    return this.db.transaction(async (tx) => {
      const until = new Date(Date.now() + b.days * 86400000).toISOString().slice(0, 10);
      const due = await tx.select().from(maintenancePlans).where(and(eq(maintenancePlans.entityId, ctx.user.entityId), eq(maintenancePlans.active, true), lte(maintenancePlans.nextDate, until)));
      let created = 0;
      for (const p of due) {
        const targets = p.assetId ? [p.assetId] : (await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.categoryId, p.categoryId!), inArray(assets.status, ['EN_SERVICE', 'EN_STOCK']))).limit(300)).map((x) => x.id);
        for (const assetId of targets) {
          const number = await this.numbering.piece(tx, ctx.user.entityId, 'OT', new Date(), 4);
          await tx.insert(workOrders).values({ entityId: ctx.user.entityId, number, assetId, kind: 'PREVENTIF', title: p.label, status: 'PLANIFIE', plannedDate: p.nextDate, assignee: p.assignee,
            contractId: p.contractId, planId: p.id, createdBy: ctx.user.id });
          created++;
        }
        await tx.update(maintenancePlans).set({ nextDate: addMonths(p.nextDate, p.frequencyMonths) }).where(eq(maintenancePlans.id, p.id));
      }
      await this.audit.log(tx, ctx, 'GENERATION', 'PLAN_MAINTENANCE', `${due.length} plan(s)`, { ordres: created });
      return { plans: due.length, created };
    });
  }
}

@Controller('contrats')
export class ContractsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  @Get() @Perm('assets.read', 'contracts.manage')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ c: contracts, n: sql<number>`(select count(*) from contract_assets ca where ca.contract_id = ${contracts.id})` }).from(contracts)
      .where(eq(contracts.entityId, ctx.user.entityId)).orderBy(asc(contracts.endDate));
    const now = today(), in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const items = rows.map((r) => ({ ...r.c, assetCount: Number(r.n), state: !r.c.active ? 'RESILIE' : r.c.endDate < now ? 'EXPIRE' : r.c.endDate <= in30 ? 'ECHEANCE_30' : r.c.endDate <= in90 ? 'ECHEANCE_90' : 'ACTIF' }));
    const warranties = await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, warrantyEnd: assets.warrantyEnd }).from(assets)
      .where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`, gte(assets.warrantyEnd, now), lte(assets.warrantyEnd, in90))).orderBy(asc(assets.warrantyEnd));
    // Biens à assurer : véhicules et immeubles sans police active
    const uninsured = await this.db.execute(sql`
      select count(*)::int n from assets a join categories c on c.id = a.category_id
      where a.entity_id = ${ctx.user.entityId} and a.status <> 'SORTI' and (c.prefix in ('VEH','MOT','IMM'))
        and not exists (select 1 from contract_assets ca join contracts k on k.id = ca.contract_id where ca.asset_id = a.id and k.kind = 'ASSURANCE' and k.active and k.end_date >= ${now}::date)`);
    return { items, warranties, uninsured: Number((uninsured.rows[0] as { n: number }).n),
      summary: { active: items.filter((i) => i.active && i.state !== 'EXPIRE').length, insurance: items.filter((i) => i.kind === 'ASSURANCE' && i.active).length,
        insuredValue: items.filter((i) => i.kind === 'ASSURANCE' && i.active).reduce((s, i) => s + i.insuredValue, 0), annual: items.filter((i) => i.active).reduce((s, i) => s + i.annualAmount, 0),
        expiring: items.filter((i) => i.state === 'ECHEANCE_30').length + warranties.filter((w) => w.warrantyEnd! <= in30).length } };
  }

  @Get(':id') @Perm('assets.read', 'contracts.manage')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [c] = await this.db.select().from(contracts).where(and(eq(contracts.id, parse(zId, id)), eq(contracts.entityId, ctx.user.entityId)));
    if (!c) throw new NotFoundException('Contrat introuvable');
    const items = await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, status: assets.status }).from(contractAssets).innerJoin(assets, eq(assets.id, contractAssets.assetId)).where(eq(contractAssets.contractId, c.id)).orderBy(asc(assets.code)).limit(500);
    const wo = await this.db.select().from(workOrders).where(eq(workOrders.contractId, c.id)).orderBy(desc(workOrders.id)).limit(50);
    return { ...c, assets: items, workOrders: wo };
  }

  private schema = z.object({ kind: z.enum(['MAINTENANCE', 'ASSURANCE', 'GARANTIE', 'LOCATION']), title: z.string().min(3), provider: z.string().min(2), startDate: zDate, endDate: zDate,
    annualAmount: zMoney.default(0), insuredValue: zMoney.default(0), slaHours: z.coerce.number().int().positive().nullable().optional(), notes: z.string().optional(), active: z.boolean().default(true),
    assetIds: z.array(zId).max(5000).default([]) }).refine((x) => x.endDate >= x.startDate, { message: 'la fin doit suivre le début' });

  @Post() @Perm('contracts.manage')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(this.schema, body);
    return this.db.transaction(async (tx) => {
      const prefix = { MAINTENANCE: 'CTR', ASSURANCE: 'ASS', GARANTIE: 'GAR', LOCATION: 'LOC' }[b.kind];
      const number = await this.numbering.piece(tx, ctx.user.entityId, prefix, new Date(b.startDate), 3);
      const { assetIds, ...data } = b;
      const [c] = await tx.insert(contracts).values({ entityId: ctx.user.entityId, number, ...data }).returning();
      if (assetIds.length) await tx.insert(contractAssets).values(assetIds.map((assetId) => ({ contractId: c.id, assetId }))).onConflictDoNothing();
      await this.audit.log(tx, ctx, 'CREATION', 'CONTRAT', number, { ...data, biens: assetIds.length });
      return c;
    });
  }

  @Patch(':id') @Perm('contracts.manage')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ endDate: zDate.optional(), annualAmount: zMoney.optional(), insuredValue: zMoney.optional(), active: z.boolean().optional(), notes: z.string().optional(),
      assetIds: z.array(zId).max(5000).optional() }), body);
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, parse(zId, id)), eq(contracts.entityId, ctx.user.entityId)));
      if (!c) throw new NotFoundException('Contrat introuvable');
      const { assetIds, ...data } = b;
      if (Object.keys(data).length) await tx.update(contracts).set(data).where(eq(contracts.id, c.id));
      if (assetIds) { await tx.delete(contractAssets).where(eq(contractAssets.contractId, c.id)); if (assetIds.length) await tx.insert(contractAssets).values(assetIds.map((assetId) => ({ contractId: c.id, assetId }))); }
      await this.audit.log(tx, ctx, 'MODIFICATION', 'CONTRAT', c.number, { ...data, biens: assetIds?.length });
      return { ok: true };
    });
  }
}
