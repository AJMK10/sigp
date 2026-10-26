import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../db/client';
import { assetComponents, assets, categories, deadlines, occupancies, orgUnits, properties, propertyEvents } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { cumulativeAt } from '../depreciation/engine';
import { today, valuesAt } from '../assets/assets.util';
import { locationPaths } from '../referentials/referentials.controller';

const TITLE_LABELS: Record<string, string> = { TITRE_FONCIER: 'Titre foncier', ACD: 'ACD', LETTRE_ATTRIBUTION: "Lettre d'attribution", AUCUN: 'Aucun titre' };
const propSchema = z.object({
  kind: z.enum(['TERRAIN', 'BATIMENT']), address: z.string().optional(), lat: z.string().optional(), lng: z.string().optional(),
  landArea: z.coerce.number().int().nonnegative().optional(), builtArea: z.coerce.number().int().nonnegative().optional(), floors: z.coerce.number().int().nonnegative().optional(),
  titleType: z.enum(['TITRE_FONCIER', 'ACD', 'LETTRE_ATTRIBUTION', 'AUCUN']), titleRef: z.string().optional(), owner: z.string().optional(),
  assignmentAct: z.string().optional(), easements: z.string().optional(), titleProcedure: z.string().optional(),
});

/** Immobilier et foncier : portefeuille, situation juridique, composants, occupation, travaux et contentieux. */
@Controller('immobilier')
export class PropertyController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  @Get() @Perm('assets.read')
  async list(@CurrentCtx() ctx: Ctx) {
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const rows = await this.db.select({ a: assets, p: properties }).from(properties).innerJoin(assets, eq(assets.id, properties.assetId))
      .where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`)).orderBy(asc(assets.code));
    const occ = rows.length ? await this.db.select().from(occupancies).where(inArray(occupancies.assetId, rows.map((r) => r.a.id))) : [];
    const items = rows.map(({ a, p }) => {
      const o = occ.filter((x) => x.assetId === a.id);
      const occupied = o.filter((x) => x.kind !== 'VACANT').reduce((s, x) => s + x.area, 0);
      const area = p.builtArea ?? 0;
      return { ...a, ...valuesAt(a), property: p, titleLabel: TITLE_LABELS[p.titleType], location: a.locationId ? paths.get(a.locationId) : null,
        occupancyRate: area ? Math.min(1, occupied / area) : null, rentYear: o.reduce((s, x) => s + x.monthlyRent * 12, 0) };
    });
    const secured = items.filter((i) => i.property.titleType === 'TITRE_FONCIER').length;
    const built = items.reduce((s, i) => s + (i.property.builtArea ?? 0), 0);
    const occupiedArea = occ.filter((x) => x.kind !== 'VACANT').reduce((s, x) => s + x.area, 0);
    return {
      items,
      summary: {
        count: items.length, buildings: items.filter((i) => i.property.kind === 'BATIMENT').length, lands: items.filter((i) => i.property.kind === 'TERRAIN').length,
        builtArea: built, occupancyRate: built ? occupiedArea / built : 0, nbv: items.reduce((s, i) => s + i.nbv, 0), secured,
        byTitle: Object.fromEntries(Object.keys(TITLE_LABELS).map((k) => [k, items.filter((i) => i.property.titleType === k).length])),
        rentYear: items.reduce((s, i) => s + i.rentYear, 0),
      },
    };
  }

  @Get(':id') @Perm('assets.read')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [r] = await this.db.select({ a: assets, p: properties, cat: categories }).from(properties).innerJoin(assets, eq(assets.id, properties.assetId))
      .innerJoin(categories, eq(categories.id, assets.categoryId)).where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Bien immobilier introuvable');
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const comps = await this.db.select().from(assetComponents).where(eq(assetComponents.assetId, r.a.id)).orderBy(asc(assetComponents.id));
    const occ = await this.db.select({ o: occupancies, unit: orgUnits.name }).from(occupancies).leftJoin(orgUnits, eq(orgUnits.id, occupancies.orgUnitId)).where(eq(occupancies.assetId, r.a.id)).orderBy(asc(occupancies.id));
    const ev = await this.db.select().from(propertyEvents).where(eq(propertyEvents.assetId, r.a.id)).orderBy(asc(propertyEvents.date));
    const dl = await this.db.select().from(deadlines).where(eq(deadlines.assetId, r.a.id)).orderBy(asc(deadlines.dueDate));
    const now = today();
    const components = comps.map((c) => {
      const cum = c.replacedAt ? c.value : cumulativeAt({ base: c.value, method: 'LINEAIRE', years: c.durationYears, inServiceDate: c.inServiceDate }, now);
      return { ...c, cumulative: cum, nbv: c.value - cum };
    });
    const built = r.p.builtArea ?? 0;
    const occupied = occ.filter((x) => x.o.kind !== 'VACANT').reduce((s, x) => s + x.o.area, 0);
    return {
      ...r.a, ...valuesAt(r.a), category: r.cat, property: r.p, titleLabel: TITLE_LABELS[r.p.titleType], location: r.a.locationId ? paths.get(r.a.locationId) : null,
      components, componentsTotal: { value: components.filter((c) => !c.replacedAt).reduce((s, c) => s + c.value, 0), nbv: components.filter((c) => !c.replacedAt).reduce((s, c) => s + c.nbv, 0) },
      occupancies: occ.map((x) => ({ ...x.o, unit: x.unit })), occupancyRate: built ? occupied / built : null, rentYear: occ.reduce((s, x) => s + x.o.monthlyRent * 12, 0),
      events: ev, deadlines: dl,
    };
  }

  /** Rattache les données immobilières à un bien existant (catégorie terrains ou bâtiments) ou les met à jour. */
  @Post(':id') @Perm('property.manage')
  async upsert(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(propSchema, body);
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(assets).where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
      if (!a) throw new NotFoundException('Bien introuvable');
      await tx.insert(properties).values({ assetId: a.id, ...b }).onConflictDoUpdate({ target: properties.assetId, set: b });
      await this.audit.log(tx, ctx, 'MODIFICATION', 'IMMOBILIER', a.code, b);
      return { ok: true };
    });
  }

  @Post(':id/composants') @Perm('property.manage')
  async addComponent(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ label: z.string().min(2), value: zMoney, durationYears: z.coerce.number().int().min(1), inServiceDate: zDate }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [c] = await tx.insert(assetComponents).values({ assetId: a.id, ...b }).returning();
      await this.audit.log(tx, ctx, 'COMPOSANT', 'IMMOBILIER', a.code, { ajout: b });
      return c;
    });
  }

  /** Remplacement d'un composant : l'ancien sort (date de remplacement), le nouveau entre. */
  @Post(':id/composants/:cid/remplacer') @Perm('property.manage')
  async replaceComponent(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('cid') cid: string, @Body() body: unknown) {
    const b = parse(z.object({ date: zDate, value: zMoney, durationYears: z.coerce.number().int().min(1) }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [old] = await tx.update(assetComponents).set({ replacedAt: b.date }).where(and(eq(assetComponents.id, parse(zId, cid)), eq(assetComponents.assetId, a.id))).returning();
      if (!old) throw new NotFoundException('Composant introuvable');
      const [n] = await tx.insert(assetComponents).values({ assetId: a.id, label: old.label, value: b.value, durationYears: b.durationYears, inServiceDate: b.date }).returning();
      await this.audit.log(tx, ctx, 'COMPOSANT', 'IMMOBILIER', a.code, { remplace: old.label, valeur: b.value });
      return n;
    });
  }

  @Post(':id/occupations') @Perm('property.manage')
  async addOccupancy(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ kind: z.enum(['AFFECTATION', 'BAIL', 'VACANT']), occupant: z.string().min(2), orgUnitId: zId.nullable().optional(), area: z.coerce.number().int().positive(),
      floors: z.string().optional(), monthlyRent: zMoney.default(0), startDate: zDate.nullable().optional(), endDate: zDate.nullable().optional() }), body);
    if (b.kind === 'BAIL' && !b.monthlyRent) throw new BadRequestException('Indiquez le loyer mensuel du bail');
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [o] = await tx.insert(occupancies).values({ assetId: a.id, ...b }).returning();
      await this.audit.log(tx, ctx, 'OCCUPATION', 'IMMOBILIER', a.code, b);
      return o;
    });
  }

  @Delete(':id/occupations/:oid') @Perm('property.manage')
  async removeOccupancy(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('oid') oid: string) {
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      await tx.delete(occupancies).where(and(eq(occupancies.id, parse(zId, oid)), eq(occupancies.assetId, a.id)));
      await this.audit.log(tx, ctx, 'OCCUPATION', 'IMMOBILIER', a.code, { retrait: oid });
      return { ok: true };
    });
  }

  @Post(':id/evenements') @Perm('property.manage')
  async addEvent(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ kind: z.enum(['TRAVAUX', 'CONTENTIEUX', 'CONTROLE']), title: z.string().min(2), status: z.enum(['PROGRAMME', 'EN_COURS', 'CLOS', 'A_JOUR']),
      amount: zMoney.default(0), date: zDate.nullable().optional(), nextDate: zDate.nullable().optional(), notes: z.string().optional() }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [e] = await tx.insert(propertyEvents).values({ assetId: a.id, ...b }).returning();
      await this.audit.log(tx, ctx, 'EVENEMENT', 'IMMOBILIER', a.code, b);
      return e;
    });
  }

  @Patch(':id/evenements/:eid') @Perm('property.manage')
  async updateEvent(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('eid') eid: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['PROGRAMME', 'EN_COURS', 'CLOS', 'A_JOUR']).optional(), notes: z.string().optional(), nextDate: zDate.nullable().optional() }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      await tx.update(propertyEvents).set(b).where(and(eq(propertyEvents.id, parse(zId, eid)), eq(propertyEvents.assetId, a.id)));
      await this.audit.log(tx, ctx, 'EVENEMENT', 'IMMOBILIER', a.code, b);
      return { ok: true };
    });
  }

  private async asset(tx: DB | Parameters<Parameters<DB['transaction']>[0]>[0], ctx: Ctx, id: string) {
    const [a] = await tx.select().from(assets).where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
    if (!a) throw new NotFoundException('Bien introuvable');
    return a;
  }
}
