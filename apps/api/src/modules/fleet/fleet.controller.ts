import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assets, contractAssets, contracts, deadlines, fuelLogs, missions, users, vehicleIncidents, vehicles, workOrders } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { NotifyService } from '../../common/notify.service';
import { can } from '../../common/permissions';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { today, valuesAt } from '../assets/assets.util';
import { cumulativeAt } from '../depreciation/engine';
import { deprInput } from '../assets/assets.util';

export const DEADLINE_LABELS: Record<string, string> = { VISITE_TECHNIQUE: 'Visite technique', VIGNETTE: 'Vignette', CARTE_GRISE: 'Carte grise', CONTROLE_INCENDIE: 'Contrôle sécurité incendie', CONTROLE_ASCENSEUR: 'Contrôle des ascenseurs', AUTRE: 'Autre échéance' };
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Consommation (L/100 km) d'après les pleins successifs. */
function consumption(logs: { mileage: number; liters: number }[]) {
  const s = [...logs].sort((a, b) => a.mileage - b.mileage);
  if (s.length < 2) return null;
  const km = s[s.length - 1].mileage - s[0].mileage;
  const l = s.slice(1).reduce((x, y) => x + y.liters, 0);
  return km > 0 ? (l / km) * 100 : null;
}

@Controller('flotte')
export class FleetController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  @Get() @Perm('assets.read', 'fleet.manage')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ a: assets, v: vehicles, driver: users.fullName }).from(vehicles).innerJoin(assets, eq(assets.id, vehicles.assetId)).leftJoin(users, eq(users.id, vehicles.driverId))
      .where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`)).orderBy(asc(vehicles.plate));
    const ids = rows.map((r) => r.a.id);
    const dls = ids.length ? await this.db.select().from(deadlines).where(and(inArray(deadlines.assetId, ids), sql`${deadlines.doneAt} is null`)).orderBy(asc(deadlines.dueDate)) : [];
    const ins = ids.length ? await this.db.select({ assetId: contractAssets.assetId, c: contracts }).from(contractAssets).innerJoin(contracts, eq(contracts.id, contractAssets.contractId))
      .where(and(inArray(contractAssets.assetId, ids), eq(contracts.kind, 'ASSURANCE'), eq(contracts.active, true))) : [];
    const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);
    const fuel = ids.length ? await this.db.select().from(fuelLogs).where(and(inArray(fuelLogs.assetId, ids), gte(fuelLogs.date, '2000-01-01'))) : [];
    const now = today(), in30 = addDays(30);
    const missionsToday = await this.db.select({ m: missions, plate: vehicles.plate, driver: users.fullName }).from(missions).innerJoin(vehicles, eq(vehicles.assetId, missions.assetId))
      .leftJoin(users, eq(users.id, missions.driverId)).where(and(eq(missions.entityId, ctx.user.entityId), inArray(missions.status, ['DEMANDE', 'VALIDEE', 'EN_COURS']),
        sql`${missions.startAt} < (current_date + 1)::timestamptz`, sql`${missions.endAt} >= current_date::timestamptz`)).orderBy(asc(missions.startAt));
    const busy = new Set(missionsToday.filter((m) => m.m.status === 'EN_COURS').map((m) => m.m.assetId));
    // consommation moyenne par modèle pour détecter les anomalies
    const byModel = new Map<string, number[]>();
    const cons = new Map<number, number | null>();
    for (const r of rows) {
      const c = consumption(fuel.filter((f) => f.assetId === r.a.id));
      cons.set(r.a.id, c);
      if (c) byModel.set(r.a.designation, [...(byModel.get(r.a.designation) ?? []), c]);
    }
    const items = rows.map(({ a, v, driver }) => {
      const next = dls.find((d) => d.assetId === a.id);
      const insurance = ins.filter((i) => i.assetId === a.id).sort((x, y) => x.c.endDate.localeCompare(y.c.endDate))[0]?.c ?? null;
      const c = cons.get(a.id) ?? null;
      const avg = byModel.get(a.designation);
      const mean = avg?.length ? avg.reduce((s, x) => s + x, 0) / avg.length : null;
      const serviceDue = v.mileage - v.lastServiceKm >= v.serviceIntervalKm - 500;
      return {
        id: a.id, code: a.code, designation: a.designation, status: a.status, orgUnitId: a.orgUnitId, plate: v.plate, mileage: v.mileage, driver, energy: v.energy,
        nextDeadline: next ? { kind: next.kind, label: DEADLINE_LABELS[next.kind], dueDate: next.dueDate } : null, insuranceEnd: insurance?.endDate ?? null,
        consumption: c, abnormal: !!(c && mean && avg!.length > 1 && c > mean * 1.25), serviceDue, onMission: busy.has(a.id),
        available: a.status === 'EN_SERVICE' && !busy.has(a.id),
      };
    });
    const months: { month: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); const m = d.toISOString().slice(0, 7); months.push({ month: m, amount: fuel.filter((f) => f.date.startsWith(m)).reduce((s, f) => s + f.amount, 0) }); }
    const yearStart = `${now.slice(0, 4)}-01-01`;
    const fuelYear = fuel.filter((f) => f.date >= yearStart);
    const kmYear = rows.reduce((s, r) => { const l = fuelYear.filter((f) => f.assetId === r.a.id).map((f) => f.mileage); return s + (l.length > 1 ? Math.max(...l) - Math.min(...l) : 0); }, 0);
    const woYear = ids.length ? await this.db.select({ s: sql<string>`coalesce(sum(${workOrders.laborCost} + ${workOrders.partsCost}),0)` }).from(workOrders).where(and(inArray(workOrders.assetId, ids), gte(workOrders.createdAt, new Date(yearStart)))) : [{ s: '0' }];
    const costYear = fuelYear.reduce((s, f) => s + f.amount, 0) + Number(woYear[0].s);
    return {
      items, fuelByMonth: months, missionsToday: missionsToday.map((m) => ({ ...m.m, plate: m.plate, driver: m.driver })),
      alerts: {
        insurance: items.filter((i) => i.insuranceEnd && i.insuranceEnd <= in30).length, deadlines: dls.filter((d) => d.dueDate <= in30).length,
        services: items.filter((i) => i.serviceDue).length, abnormal: items.filter((i) => i.abnormal).length, overdue: dls.filter((d) => d.dueDate < now).length,
      },
      summary: { count: items.length, inService: items.filter((i) => i.status === 'EN_SERVICE').length, availability: items.length ? items.filter((i) => i.available).length / items.length : 0,
        costPerKm: kmYear ? costYear / kmYear : null },
    };
  }

  @Get(':id') @Perm('assets.read', 'fleet.manage')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [r] = await this.db.select({ a: assets, v: vehicles, driver: users.fullName }).from(vehicles).innerJoin(assets, eq(assets.id, vehicles.assetId)).leftJoin(users, eq(users.id, vehicles.driverId))
      .where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Véhicule introuvable');
    const fuel = await this.db.select().from(fuelLogs).where(eq(fuelLogs.assetId, r.a.id)).orderBy(desc(fuelLogs.date), desc(fuelLogs.mileage));
    const ms = await this.db.select({ m: missions, driver: users.fullName }).from(missions).leftJoin(users, eq(users.id, missions.driverId)).where(eq(missions.assetId, r.a.id)).orderBy(desc(missions.startAt)).limit(50);
    const inc = await this.db.select({ i: vehicleIncidents, driver: users.fullName }).from(vehicleIncidents).leftJoin(users, eq(users.id, vehicleIncidents.driverId)).where(eq(vehicleIncidents.assetId, r.a.id)).orderBy(desc(vehicleIncidents.date));
    const dl = await this.db.select().from(deadlines).where(eq(deadlines.assetId, r.a.id)).orderBy(asc(deadlines.dueDate));
    const wo = await this.db.select().from(workOrders).where(eq(workOrders.assetId, r.a.id)).orderBy(desc(workOrders.createdAt));
    const ct = await this.db.select({ c: contracts }).from(contractAssets).innerJoin(contracts, eq(contracts.id, contractAssets.contractId)).where(eq(contractAssets.assetId, r.a.id));
    const y = today().slice(0, 4);
    const fy = fuel.filter((f) => f.date.startsWith(y));
    const woy = wo.filter((w) => w.createdAt.toISOString().startsWith(y)).reduce((s, w) => s + w.laborCost + w.partsCost, 0);
    // prime répartie au prorata de la valeur assurée du véhicule
    const insurance = Math.round(ct.filter((c) => c.c.kind === 'ASSURANCE').reduce((s, c) => s + (c.c.insuredValue ? c.c.annualAmount * Math.min(1, r.a.acquisitionValue / c.c.insuredValue) : 0), 0));
    const depr = cumulativeAt(deprInput(r.a), today()) - cumulativeAt(deprInput(r.a), `${Number(y) - 1}-12-31`);
    const km = fy.length > 1 ? Math.max(...fy.map((f) => f.mileage)) - Math.min(...fy.map((f) => f.mileage)) : 0;
    const total = fy.reduce((s, f) => s + f.amount, 0) + woy + insurance + depr;
    return {
      ...r.a, ...valuesAt(r.a), vehicle: r.v, driver: r.driver, consumption: consumption(fy.length > 1 ? fy : fuel.slice(0, 6)),
      fuel, missions: ms.map((m) => ({ ...m.m, driver: m.driver })), incidents: inc.map((i) => ({ ...i.i, driver: i.driver })),
      deadlines: dl.map((d) => ({ ...d, label: DEADLINE_LABELS[d.kind] ?? d.kind })), workOrders: wo, contracts: ct.map((c) => c.c),
      cost: { fuel: fy.reduce((s, f) => s + f.amount, 0), maintenance: woy, insurance, depreciation: depr, total, km, perKm: km ? total / km : null },
    };
  }

  @Post(':id') @Perm('fleet.manage')
  async upsert(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ plate: z.string().min(4).max(20), vin: z.string().optional(), energy: z.enum(['ESSENCE', 'GASOIL', 'HYBRIDE', 'ELECTRIQUE']), fiscalPower: z.coerce.number().int().optional(),
      seats: z.coerce.number().int().optional(), mileage: z.coerce.number().int().nonnegative(), driverId: zId.nullable().optional(), firstRegistration: zDate.nullable().optional(),
      serviceIntervalKm: z.coerce.number().int().positive().default(10000), lastServiceKm: z.coerce.number().int().nonnegative().default(0) }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      await tx.insert(vehicles).values({ assetId: a.id, ...b, plate: b.plate.toUpperCase() }).onConflictDoUpdate({ target: vehicles.assetId, set: { ...b, plate: b.plate.toUpperCase() } });
      await this.audit.log(tx, ctx, 'MODIFICATION', 'VEHICULE', a.code, b);
      return { ok: true };
    });
  }

  @Post(':id/carburant') @Perm('fleet.manage')
  async fuel(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ date: zDate, liters: z.coerce.number().int().positive(), amount: zMoney, mileage: z.coerce.number().int().positive(), station: z.string().optional(), cardRef: z.string().optional() }), body);
    if (b.date > today()) throw new BadRequestException('Date future');
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.assetId, a.id));
      if (!v) throw new BadRequestException("Ce bien n'est pas un véhicule");
      const [last] = await tx.select().from(fuelLogs).where(eq(fuelLogs.assetId, a.id)).orderBy(desc(fuelLogs.mileage)).limit(1);
      if (last && b.mileage < last.mileage && b.date >= last.date) throw new BadRequestException(`Kilométrage incohérent : le dernier plein indique ${last.mileage.toLocaleString('fr-FR')} km`);
      const [f] = await tx.insert(fuelLogs).values({ assetId: a.id, ...b, createdBy: ctx.user.id }).returning();
      if (b.mileage > v.mileage) await tx.update(vehicles).set({ mileage: b.mileage }).where(eq(vehicles.assetId, a.id));
      await this.audit.log(tx, ctx, 'CARBURANT', 'VEHICULE', v.plate, b);
      return f;
    });
  }

  @Post(':id/echeances') @Perm('fleet.manage', 'property.manage')
  async addDeadline(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ kind: z.enum(Object.keys(DEADLINE_LABELS) as [string, ...string[]]), dueDate: zDate, notes: z.string().optional() }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [d] = await tx.insert(deadlines).values({ assetId: a.id, ...b }).returning();
      await this.audit.log(tx, ctx, 'ECHEANCE', 'BIEN', a.code, b);
      return d;
    });
  }

  /** Échéance honorée : on enregistre la date et, si fournie, la prochaine échéance. */
  @Patch('echeances/:did') @Perm('fleet.manage', 'property.manage')
  async doneDeadline(@CurrentCtx() ctx: Ctx, @Param('did') did: string, @Body() body: unknown) {
    const b = parse(z.object({ doneAt: zDate, nextDueDate: zDate.optional() }), body);
    return this.db.transaction(async (tx) => {
      const [d] = await tx.select({ d: deadlines, code: assets.code }).from(deadlines).innerJoin(assets, eq(assets.id, deadlines.assetId)).where(and(eq(deadlines.id, parse(zId, did)), eq(assets.entityId, ctx.user.entityId)));
      if (!d) throw new NotFoundException('Échéance introuvable');
      await tx.update(deadlines).set({ doneAt: b.doneAt }).where(eq(deadlines.id, d.d.id));
      if (b.nextDueDate) await tx.insert(deadlines).values({ assetId: d.d.assetId, kind: d.d.kind, dueDate: b.nextDueDate });
      await this.audit.log(tx, ctx, 'ECHEANCE', 'BIEN', d.code, { honoree: d.d.kind, ...b });
      return { ok: true };
    });
  }

  @Post(':id/incidents') @Perm('fleet.manage')
  async addIncident(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ kind: z.enum(['SINISTRE', 'INFRACTION']), date: zDate, driverId: zId.nullable().optional(), description: z.string().min(5), amount: zMoney.default(0), insuranceClaim: z.string().optional() }), body);
    return this.db.transaction(async (tx) => {
      const a = await this.asset(tx, ctx, id);
      const [i] = await tx.insert(vehicleIncidents).values({ assetId: a.id, ...b, status: b.kind === 'SINISTRE' ? 'EXPERTISE' : 'OUVERT' }).returning();
      await this.audit.log(tx, ctx, b.kind, 'VEHICULE', a.code, b);
      return i;
    });
  }

  @Patch('incidents/:iid') @Perm('fleet.manage')
  async updateIncident(@CurrentCtx() ctx: Ctx, @Param('iid') iid: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['OUVERT', 'EXPERTISE', 'CLOS']), amount: zMoney.optional() }), body);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select({ code: assets.code }).from(vehicleIncidents).innerJoin(assets, eq(assets.id, vehicleIncidents.assetId)).where(and(eq(vehicleIncidents.id, parse(zId, iid)), eq(assets.entityId, ctx.user.entityId)));
      if (!r) throw new NotFoundException('Incident introuvable');
      await tx.update(vehicleIncidents).set(b).where(eq(vehicleIncidents.id, Number(iid)));
      await this.audit.log(tx, ctx, 'INCIDENT', 'VEHICULE', r.code, b);
      return { ok: true };
    });
  }

  private async asset(tx: Tx, ctx: Ctx, id: string) {
    const [a] = await tx.select().from(assets).where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
    if (!a) throw new NotFoundException('Bien introuvable');
    return a;
  }
}

/** Ordres de mission : réservation d'un véhicule, validation, départ et retour avec kilométrage. */
@Controller('missions')
export class MissionsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly notify: NotifyService) {}

  @Get() @Perm('fleet.use', 'fleet.manage')
  async list(@CurrentCtx() ctx: Ctx, @Query('status') status?: string) {
    const mine = !can(ctx.user.role, 'fleet.manage');
    const rows = await this.db.select({ m: missions, plate: vehicles.plate, vehicle: assets.designation, driver: users.fullName }).from(missions)
      .innerJoin(vehicles, eq(vehicles.assetId, missions.assetId)).innerJoin(assets, eq(assets.id, missions.assetId)).leftJoin(users, eq(users.id, missions.driverId))
      .where(and(eq(missions.entityId, ctx.user.entityId), status ? eq(missions.status, status) : undefined, mine ? or(eq(missions.requesterId, ctx.user.id), eq(missions.driverId, ctx.user.id)) : undefined))
      .orderBy(desc(missions.startAt)).limit(300);
    const req = await this.db.select({ id: users.id, n: users.fullName }).from(users).where(eq(users.entityId, ctx.user.entityId));
    const names = new Map(req.map((u) => [u.id, u.n]));
    return rows.map((r) => ({ ...r.m, plate: r.plate, vehicle: r.vehicle, driver: r.driver, requester: names.get(r.m.requesterId) }));
  }

  /** Véhicules libres sur un créneau. */
  @Get('disponibles') @Perm('fleet.use', 'fleet.manage')
  async available(@CurrentCtx() ctx: Ctx, @Query('start') start: string, @Query('end') end: string) {
    if (!start || !end) throw new BadRequestException('Créneau requis');
    const busy = await this.db.select({ id: missions.assetId }).from(missions).where(and(eq(missions.entityId, ctx.user.entityId), inArray(missions.status, ['VALIDEE', 'EN_COURS']),
      lte(missions.startAt, new Date(end)), gte(missions.endAt, new Date(start))));
    const b = new Set(busy.map((x) => x.id));
    const rows = await this.db.select({ id: assets.id, designation: assets.designation, plate: vehicles.plate, seats: vehicles.seats }).from(vehicles).innerJoin(assets, eq(assets.id, vehicles.assetId))
      .where(and(eq(assets.entityId, ctx.user.entityId), eq(assets.status, 'EN_SERVICE'))).orderBy(asc(vehicles.plate));
    return rows.filter((r) => !b.has(r.id));
  }

  @Post() @Perm('fleet.use', 'fleet.manage')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ assetId: zId, driverId: zId.nullable().optional(), destination: z.string().min(2), purpose: z.string().min(3), startAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
      endAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) }), body);
    const start = new Date(b.startAt), end = new Date(b.endAt);
    if (end <= start) throw new BadRequestException('Le retour doit suivre le départ');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${b.assetId}, 8101)`);
      const [v] = await tx.select({ a: assets, v: vehicles }).from(vehicles).innerJoin(assets, eq(assets.id, vehicles.assetId)).where(and(eq(assets.id, b.assetId), eq(assets.entityId, ctx.user.entityId)));
      if (!v) throw new NotFoundException('Véhicule introuvable');
      if (v.a.status !== 'EN_SERVICE') throw new BadRequestException(`Véhicule indisponible (${v.a.status.toLowerCase().replace('_', ' ')})`);
      const [clash] = await tx.select({ n: missions.number }).from(missions).where(and(eq(missions.assetId, b.assetId), inArray(missions.status, ['VALIDEE', 'EN_COURS']), lte(missions.startAt, end), gte(missions.endAt, start)));
      if (clash) throw new BadRequestException(`Véhicule déjà réservé sur ce créneau (${clash.n})`);
      const number = await this.numbering.piece(tx, ctx.user.entityId, 'OM', start, 4);
      const [m] = await tx.insert(missions).values({ entityId: ctx.user.entityId, number, assetId: b.assetId, driverId: b.driverId ?? null, requesterId: ctx.user.id, destination: b.destination,
        purpose: b.purpose, startAt: start, endAt: end }).returning();
      await this.notify.toRole(tx, ctx.user.entityId, 'GESTIONNAIRE', { kind: 'info', title: 'Ordre de mission à valider', body: `${number} · ${v.v.plate} · ${b.destination}`, link: '/missions' });
      await this.audit.log(tx, ctx, 'CREATION', 'MISSION', number, { vehicule: v.v.plate, destination: b.destination });
      return m;
    });
  }

  private async load(tx: Tx, ctx: Ctx, id: string) {
    const [m] = await tx.select().from(missions).where(and(eq(missions.id, parse(zId, id)), eq(missions.entityId, ctx.user.entityId)));
    if (!m) throw new NotFoundException('Ordre de mission introuvable');
    return m;
  }

  @Post(':id/decision') @Perm('fleet.manage')
  async decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ approve: z.boolean(), comment: z.string().optional() }), body);
    return this.db.transaction(async (tx) => {
      const m = await this.load(tx, ctx, id);
      if (m.status !== 'DEMANDE') throw new BadRequestException('Ordre déjà traité');
      if (m.requesterId === ctx.user.id) throw new ForbiddenException('Séparation des tâches : vous ne pouvez pas valider votre propre ordre de mission');
      if (b.approve) {
        const [clash] = await tx.select({ n: missions.number }).from(missions).where(and(eq(missions.assetId, m.assetId), inArray(missions.status, ['VALIDEE', 'EN_COURS']), lte(missions.startAt, m.endAt), gte(missions.endAt, m.startAt)));
        if (clash) throw new BadRequestException(`Créneau déjà pris par ${clash.n}`);
      } else if (!b.comment) throw new BadRequestException('Motif obligatoire en cas de refus');
      await tx.update(missions).set({ status: b.approve ? 'VALIDEE' : 'REJETEE' }).where(eq(missions.id, m.id));
      await this.notify.toUsers(tx, [m.requesterId, m.driverId ?? 0], { kind: b.approve ? 'ok' : 'bad', title: `Ordre de mission ${b.approve ? 'validé' : 'refusé'}`, body: `${m.number}${b.comment ? ' : ' + b.comment : ''}`, link: '/missions' });
      await this.audit.log(tx, ctx, b.approve ? 'VALIDATION' : 'REJET', 'MISSION', m.number, { commentaire: b.comment ?? null });
      return { ok: true };
    });
  }

  @Post(':id/depart') @Perm('fleet.manage', 'fleet.use')
  async depart(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ startMileage: z.coerce.number().int().nonnegative() }), body);
    return this.db.transaction(async (tx) => {
      const m = await this.load(tx, ctx, id);
      if (m.status !== 'VALIDEE') throw new BadRequestException("L'ordre doit être validé avant le départ");
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.assetId, m.assetId));
      if (b.startMileage < v.mileage) throw new BadRequestException(`Compteur inférieur au dernier relevé (${v.mileage.toLocaleString('fr-FR')} km)`);
      await tx.update(missions).set({ status: 'EN_COURS', startMileage: b.startMileage }).where(eq(missions.id, m.id));
      await tx.update(vehicles).set({ mileage: b.startMileage }).where(eq(vehicles.assetId, m.assetId));
      await this.audit.log(tx, ctx, 'DEPART', 'MISSION', m.number, b);
      return { ok: true };
    });
  }

  @Post(':id/retour') @Perm('fleet.manage', 'fleet.use')
  async back(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ endMileage: z.coerce.number().int().nonnegative() }), body);
    return this.db.transaction(async (tx) => {
      const m = await this.load(tx, ctx, id);
      if (m.status !== 'EN_COURS') throw new BadRequestException("La mission n'est pas en cours");
      if (b.endMileage < (m.startMileage ?? 0)) throw new BadRequestException('Le kilométrage de retour est inférieur au départ');
      await tx.update(missions).set({ status: 'CLOTUREE', endMileage: b.endMileage }).where(eq(missions.id, m.id));
      await tx.update(vehicles).set({ mileage: b.endMileage }).where(eq(vehicles.assetId, m.assetId));
      await this.audit.log(tx, ctx, 'RETOUR', 'MISSION', m.number, { ...b, distance: b.endMileage - (m.startMileage ?? 0) });
      return { ok: true };
    });
  }

  @Post(':id/annuler') @Perm('fleet.use', 'fleet.manage')
  async cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const m = await this.load(tx, ctx, id);
      if (!['DEMANDE', 'VALIDEE'].includes(m.status)) throw new BadRequestException('Seul un ordre non commencé peut être annulé');
      if (m.requesterId !== ctx.user.id && !can(ctx.user.role, 'fleet.manage')) throw new ForbiddenException('Ordre de mission d\'un autre agent');
      await tx.update(missions).set({ status: 'ANNULEE' }).where(eq(missions.id, m.id));
      await this.audit.log(tx, ctx, 'ANNULATION', 'MISSION', m.number, {});
      return { ok: true };
    });
  }
}
