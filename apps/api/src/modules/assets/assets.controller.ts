import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, SQL } from 'drizzle-orm';
import { DB } from '../../db/client';
import { approvals, assetEvents, assets, categories, disposalItems, disposals, locations, movementItems, movements, orgUnits, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { schedule } from '../depreciation/engine';
import { locationPaths, locationSubtree } from '../referentials/referentials.controller';
import { deprInput, today, valuesAt } from './assets.util';

const listQuery = z.object({
  q: z.string().optional(), status: z.string().optional(), categoryId: zId.optional(), locationId: zId.optional(), orgUnitId: zId.optional(), holderId: zId.optional(),
  labelStatus: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(['code', 'designation', 'acquisitionDate', 'acquisitionValue']).default('code'), dir: z.enum(['asc', 'desc']).default('asc'),
});

@Controller('biens')
export class AssetsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  async where(ctx: Ctx, q: z.infer<typeof listQuery>) {
    const w: (SQL | undefined)[] = [eq(assets.entityId, ctx.user.entityId)];
    if (q.q) w.push(or(ilike(assets.code, `%${q.q}%`), ilike(assets.designation, `%${q.q}%`), ilike(assets.serialNumber, `%${q.q}%`)));
    if (q.status) w.push(inArray(assets.status, q.status.split(',') as (typeof assets.status.enumValues)[number][]));
    else w.push(sql`${assets.status} <> 'SORTI'`);
    if (q.categoryId) {
      const subs = await this.db.select({ id: categories.id }).from(categories).where(or(eq(categories.id, q.categoryId), eq(categories.parentId, q.categoryId)));
      const ids = subs.map((s) => s.id);
      const subs2 = await this.db.select({ id: categories.id }).from(categories).where(inArray(categories.parentId, ids));
      w.push(inArray(assets.categoryId, [...ids, ...subs2.map((s) => s.id)]));
    }
    if (q.locationId) w.push(inArray(assets.locationId, await locationSubtree(this.db, [q.locationId])));
    if (q.orgUnitId) w.push(eq(assets.orgUnitId, q.orgUnitId));
    if (q.holderId) w.push(eq(assets.holderId, q.holderId));
    if (q.labelStatus) w.push(eq(assets.labelStatus, q.labelStatus as (typeof assets.labelStatus.enumValues)[number]));
    return and(...w);
  }

  @Get() @Perm('assets.read')
  async list(@CurrentCtx() ctx: Ctx, @Query() query: unknown) {
    const q = parse(listQuery, query);
    const where = await this.where(ctx, q);
    const sortCol = { code: assets.code, designation: assets.designation, acquisitionDate: assets.acquisitionDate, acquisitionValue: assets.acquisitionValue }[q.sort];
    const [{ total }] = await this.db.select({ total: count() }).from(assets).where(where);
    const [{ gross }] = await this.db.select({ gross: sql<string>`coalesce(sum(${assets.acquisitionValue}),0)` }).from(assets).where(where);
    const rows = await this.db.select({ a: assets, category: categories.label, holder: users.fullName, orgUnit: orgUnits.name })
      .from(assets).innerJoin(categories, eq(categories.id, assets.categoryId)).leftJoin(users, eq(users.id, assets.holderId)).leftJoin(orgUnits, eq(orgUnits.id, assets.orgUnitId))
      .where(where).orderBy(q.dir === 'asc' ? asc(sortCol) : desc(sortCol)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const paths = await locationPaths(this.db, ctx.user.entityId);
    return {
      total: Number(total), grossValue: Number(gross), page: q.page, pageSize: q.pageSize,
      items: rows.map((r) => ({ ...r.a, ...valuesAt(r.a), category: r.category, holder: r.holder, orgUnit: r.orgUnit, location: r.a.locationId ? paths.get(r.a.locationId) : null })),
    };
  }

  @Get(':id') @Perm('assets.read', 'portal.use')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const isCode = !/^\d+$/.test(id);
    const [r] = await this.db.select({ a: assets, category: categories, holder: users.fullName, orgUnit: orgUnits.name }).from(assets)
      .innerJoin(categories, eq(categories.id, assets.categoryId)).leftJoin(users, eq(users.id, assets.holderId)).leftJoin(orgUnits, eq(orgUnits.id, assets.orgUnitId))
      .where(and(eq(assets.entityId, ctx.user.entityId), isCode ? eq(assets.code, id) : eq(assets.id, Number(id))));
    if (!r) throw new NotFoundException('Bien introuvable');
    if (ctx.user.role === 'DETENTEUR' && r.a.holderId !== ctx.user.id) throw new NotFoundException('Bien introuvable');
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const events = await this.db.select({ e: assetEvents, actor: users.fullName }).from(assetEvents).leftJoin(users, eq(users.id, assetEvents.actorId))
      .where(eq(assetEvents.assetId, r.a.id)).orderBy(desc(assetEvents.at)).limit(200);
    const mv = await this.db.select({ number: movements.number, type: movements.type, status: movements.status, createdAt: movements.createdAt, id: movements.id })
      .from(movementItems).innerJoin(movements, eq(movements.id, movementItems.movementId)).where(eq(movementItems.assetId, r.a.id)).orderBy(desc(movements.createdAt));
    const disp = await this.db.select({ number: disposals.number, status: disposals.status, id: disposals.id }).from(disposalItems)
      .innerJoin(disposals, eq(disposals.id, disposalItems.disposalId)).where(eq(disposalItems.assetId, r.a.id));
    return {
      ...r.a, ...valuesAt(r.a), category: r.category, holder: r.holder, orgUnit: r.orgUnit, location: r.a.locationId ? paths.get(r.a.locationId) : null,
      schedule: schedule(deprInput(r.a)), events: events.map((e) => ({ ...e.e, actor: e.actor })), movements: mv, disposals: disp, asOf: today(),
    };
  }

  /** Entrée manuelle (reprise de l'existant, régularisation). Les achats passent par une réception. */
  @Post() @Perm('assets.write')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({
      designation: z.string().min(2), categoryId: zId, entryMode: z.enum(['DON', 'TRANSFERT_ENTRANT', 'PRODUCTION', 'REGULARISATION', 'REPRISE']),
      acquisitionDate: zDate, inServiceDate: zDate.nullable().optional(), acquisitionValue: zMoney, residualValue: zMoney.default(0),
      serialNumber: z.string().optional(), brand: z.string().optional(), model: z.string().optional(), locationId: zId.nullable().optional(), orgUnitId: zId.nullable().optional(),
      holderId: zId.nullable().optional(), condition: z.enum(['NEUF', 'BON', 'MOYEN', 'MAUVAIS', 'HORS_USAGE']).default('BON'), supplier: z.string().optional(), justification: z.string().min(3),
    }), body);
    return this.db.transaction(async (tx) => {
      const [cat] = await tx.select().from(categories).where(and(eq(categories.id, b.categoryId), eq(categories.entityId, ctx.user.entityId)));
      if (!cat || !cat.prefix) throw new BadRequestException('Choisissez une catégorie de dernier niveau (avec préfixe de codification)');
      const code = await this.numbering.assetCode(tx, ctx.user.entityId, cat.prefix, Number(b.acquisitionDate.slice(0, 4)));
      const { justification, ...data } = b;
      const [a] = await tx.insert(assets).values({
        ...data, entityId: ctx.user.entityId, code, deprMethod: cat.method, deprYears: cat.durationYears,
        status: b.inServiceDate ? 'EN_SERVICE' : 'EN_STOCK', serialNumber: b.serialNumber ?? null,
      }).returning();
      await tx.insert(assetEvents).values({ assetId: a.id, type: 'ENTREE', summary: `Entrée au registre (${b.entryMode.toLowerCase()}) : ${justification}`, actorId: ctx.user.id });
      await this.audit.log(tx, ctx, 'CREATION', 'BIEN', code, { ...data, justification });
      return a;
    });
  }

  /** Modification des données descriptives. Localisation, détenteur et statut changent uniquement par une pièce. */
  @Patch(':id') @Perm('assets.write')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({
      designation: z.string().min(2).optional(), serialNumber: z.string().nullable().optional(), brand: z.string().nullable().optional(), model: z.string().nullable().optional(),
      condition: z.enum(['NEUF', 'BON', 'MOYEN', 'MAUVAIS', 'HORS_USAGE']).optional(), warrantyEnd: zDate.nullable().optional(), inServiceDate: zDate.optional(),
      attributes: z.record(z.unknown()).optional(),
    }), body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(assets).where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
      if (!before) throw new NotFoundException('Bien introuvable');
      if (before.status === 'SORTI') throw new BadRequestException('Un bien sorti du patrimoine ne peut plus être modifié');
      if (b.inServiceDate && before.inServiceDate) throw new BadRequestException("La date de mise en service est déjà fixée : sa modification passe par une révision de valeur");
      const patch: Partial<typeof assets.$inferInsert> = { ...b, updatedAt: new Date() };
      if (b.inServiceDate && before.status === 'EN_STOCK') patch.status = 'EN_SERVICE';
      const [a] = await tx.update(assets).set(patch).where(eq(assets.id, before.id)).returning();
      const changed = Object.keys(b).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k]));
      await tx.insert(assetEvents).values({ assetId: a.id, type: 'MODIFICATION', summary: `Modification : ${changed.join(', ') || 'aucun changement'}`, actorId: ctx.user.id });
      await this.audit.log(tx, ctx, 'MODIFICATION', 'BIEN', a.code, { avant: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])), apres: b });
      return a;
    });
  }

  @Get(':id/validations') @Perm('assets.read')
  async pending(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const mv = await this.db.select({ id: movements.id }).from(movementItems).innerJoin(movements, eq(movements.id, movementItems.movementId))
      .where(and(eq(movementItems.assetId, parse(zId, id)), eq(movements.status, 'A_VALIDER')));
    if (!mv.length) return [];
    return this.db.select().from(approvals).where(and(eq(approvals.objectType, 'MOUVEMENT'), inArray(approvals.objectId, mv.map((m) => m.id)), eq(approvals.status, 'EN_COURS')));
  }
}

@Controller('etiquettes')
export class LabelsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  @Get() @Perm('labels.manage')
  async queue(@CurrentCtx() ctx: Ctx, @Query('status') status?: string) {
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const rows = await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, serialNumber: assets.serialNumber, labelStatus: assets.labelStatus,
      locationId: assets.locationId, receptionId: assets.receptionId, entryOrderNo: assets.entryOrderNo, category: categories.label, account: categories.assetAccount })
      .from(assets).innerJoin(categories, eq(categories.id, assets.categoryId))
      .where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`, status ? eq(assets.labelStatus, status as 'GENEREE') : sql`${assets.labelStatus} <> 'CONTROLEE'`))
      .orderBy(asc(assets.code)).limit(500);
    const [{ n }] = await this.db.select({ n: count() }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.labelStatus} <> 'CONTROLEE'`, sql`${assets.status} <> 'SORTI'`));
    return { pending: Number(n), items: rows.map((r) => ({ ...r, location: r.locationId ? paths.get(r.locationId) : null })) };
  }

  /** Avance le cycle de l'étiquette : générée → imprimée → posée → contrôlée (par scan). */
  @Post('statut') @Perm('labels.manage', 'inventory.count')
  async setStatus(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ assetIds: z.array(zId).min(1).max(500), status: z.enum(['IMPRIMEE', 'POSEE', 'CONTROLEE']) }), body);
    return this.db.transaction(async (tx) => {
      const rows = await tx.update(assets).set({ labelStatus: b.status, updatedAt: new Date(), ...(b.status === 'CONTROLEE' ? { lastSeenAt: new Date() } : {}) })
        .where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.id, b.assetIds))).returning({ id: assets.id, code: assets.code });
      const label = { IMPRIMEE: 'Étiquette imprimée', POSEE: 'Étiquette posée', CONTROLEE: 'Pose contrôlée par scan' }[b.status];
      if (rows.length) await tx.insert(assetEvents).values(rows.map((r) => ({ assetId: r.id, type: 'ETIQUETTE', summary: label, actorId: ctx.user.id })));
      await this.audit.log(tx, ctx, 'ETIQUETTE', 'BIEN', rows.length === 1 ? rows[0].code : `${rows.length} biens`, { statut: b.status, biens: rows.map((r) => r.code) });
      return { updated: rows.length };
    });
  }

  /** Données d'une étiquette par code scanné (application de pose et inventaire). */
  @Get('scan/:code') @Perm('labels.manage', 'inventory.count')
  async scan(@CurrentCtx() ctx: Ctx, @Param('code') code: string) {
    const [a] = await this.db.select().from(assets).where(and(eq(assets.entityId, ctx.user.entityId), eq(assets.code, code.trim().toUpperCase())));
    if (!a) throw new NotFoundException(`Code ${code} inconnu au registre`);
    const loc = await this.db.select().from(locations).where(eq(locations.id, a.locationId ?? -1));
    return { id: a.id, code: a.code, designation: a.designation, status: a.status, labelStatus: a.labelStatus, location: loc[0]?.name ?? null };
  }
}
