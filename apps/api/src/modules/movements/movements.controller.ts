import { BadRequestException, Body, Controller, Get, NotFoundException, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assetEvents, assets, inventoryCampaigns, inventoryExpected, locations, movementItems, movements, orgUnits, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { parse, z, zDate, zId } from '../../common/validation';
import { StepDef, WorkflowService } from '../workflow/workflow.service';
import { locationPaths } from '../referentials/referentials.controller';
import { today } from '../assets/assets.util';

export const MOVEMENT_LABELS: Record<string, string> = { AFFECTATION: 'Affectation', TRANSFERT: 'Transfert', PRET: 'Prêt temporaire', RESTITUTION: 'Restitution' };
const PREFIX: Record<string, string> = { AFFECTATION: 'AFF', TRANSFERT: 'TRF', PRET: 'PRT', RESTITUTION: 'RST' };
const VISA_DIRECTEUR_SEUIL = 5_000_000;

/** Vérifie qu'aucun bien n'est gelé par une campagne d'inventaire en cours. */
export async function assertNotFrozen(tx: Tx, entityId: number, assetIds: number[]) {
  const frozen = await tx.select({ code: assets.code, campaign: inventoryCampaigns.number }).from(inventoryExpected)
    .innerJoin(inventoryCampaigns, eq(inventoryCampaigns.id, inventoryExpected.campaignId)).innerJoin(assets, eq(assets.id, inventoryExpected.assetId))
    .where(and(eq(inventoryCampaigns.entityId, entityId), eq(inventoryCampaigns.status, 'EN_COURS'), eq(inventoryCampaigns.freezeMovements, true), inArray(inventoryExpected.assetId, assetIds)));
  if (frozen.length) throw new BadRequestException(`Mouvements gelés pendant l'inventaire ${frozen[0].campaign} : ${frozen.slice(0, 5).map((f) => f.code).join(', ')}${frozen.length > 5 ? '…' : ''}`);
}

@Controller('mouvements')
export class MovementsController implements OnModuleInit {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly wf: WorkflowService) {}

  onModuleInit() {
    this.wf.register('MOUVEMENT', {
      describe: async (tx, id) => {
        const [m] = await tx.select().from(movements).where(eq(movements.id, id));
        const items = await tx.select({ id: movementItems.assetId }).from(movementItems).where(eq(movementItems.movementId, id));
        let dest = '';
        if (m.toHolderId) dest = (await tx.select({ n: users.fullName }).from(users).where(eq(users.id, m.toHolderId)))[0]?.n ?? '';
        else if (m.toOrgUnitId) dest = (await tx.select({ n: orgUnits.name }).from(orgUnits).where(eq(orgUnits.id, m.toOrgUnitId)))[0]?.n ?? '';
        else if (m.toLocationId) dest = (await tx.select({ n: locations.name }).from(locations).where(eq(locations.id, m.toLocationId)))[0]?.n ?? '';
        return { number: m.number, title: `${MOVEMENT_LABELS[m.type]} de ${items.length} bien(s)${dest ? ' → ' + dest : ''}`, subtitle: m.reason ?? '', requestedBy: m.requestedBy, link: `/mouvements/${id}` };
      },
      onApproved: (tx, ctx, id) => this.apply(tx, ctx, id),
      onRejected: async (tx, _ctx, id) => { await tx.update(movements).set({ status: 'REJETE' }).where(eq(movements.id, id)); },
    });
  }

  @Get() @Perm('movements.write', 'movements.validate', 'assets.read')
  async list(@CurrentCtx() ctx: Ctx, @Query('status') status?: string, @Query('type') type?: string) {
    const rows = await this.db.select({ m: movements, requester: users.fullName, count: sql<number>`(select count(*) from movement_items mi where mi.movement_id = ${movements.id})` })
      .from(movements).leftJoin(users, eq(users.id, movements.requestedBy))
      .where(and(eq(movements.entityId, ctx.user.entityId), status ? eq(movements.status, status) : undefined, type ? eq(movements.type, type) : undefined))
      .orderBy(desc(movements.id)).limit(300);
    return rows.map((r) => ({ ...r.m, requester: r.requester, count: Number(r.count), typeLabel: MOVEMENT_LABELS[r.m.type] }));
  }

  @Get(':id') @Perm('movements.write', 'movements.validate', 'assets.read', 'portal.use')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [m] = await this.db.select().from(movements).where(and(eq(movements.id, parse(zId, id)), eq(movements.entityId, ctx.user.entityId)));
    if (!m) throw new NotFoundException('Mouvement introuvable');
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const items = await this.db.select({ a: assets, mi: movementItems }).from(movementItems).innerJoin(assets, eq(assets.id, movementItems.assetId)).where(eq(movementItems.movementId, m.id));
    const names = async (id: number | null) => (id ? (await this.db.select({ n: users.fullName }).from(users).where(eq(users.id, id)))[0]?.n : null);
    const [ou] = m.toOrgUnitId ? await this.db.select().from(orgUnits).where(eq(orgUnits.id, m.toOrgUnitId)) : [];
    return {
      ...m, typeLabel: MOVEMENT_LABELS[m.type], requester: await names(m.requestedBy), toHolder: await names(m.toHolderId), toOrgUnit: ou?.name ?? null,
      toLocation: m.toLocationId ? paths.get(m.toLocationId) : null, steps: await this.wf.steps(this.db, 'MOUVEMENT', m.id),
      items: items.map(({ a, mi }) => ({ id: a.id, code: a.code, designation: a.designation, condition: a.condition, value: a.acquisitionValue, fromLocation: mi.fromLocationId ? paths.get(mi.fromLocationId) : null })),
    };
  }

  @Post() @Perm('movements.write')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({
      type: z.enum(['AFFECTATION', 'TRANSFERT', 'PRET', 'RESTITUTION']), assetIds: z.array(zId).min(1, 'sélectionnez au moins un bien').max(500),
      toLocationId: zId.nullable().optional(), toOrgUnitId: zId.nullable().optional(), toHolderId: zId.nullable().optional(), dueDate: zDate.nullable().optional(), reason: z.string().max(1000).optional(),
    }), body);
    if (b.type === 'AFFECTATION' && !b.toOrgUnitId && !b.toHolderId) throw new BadRequestException("Une affectation désigne un service ou un détenteur");
    if (b.type === 'TRANSFERT' && !b.toLocationId) throw new BadRequestException('Un transfert désigne une localisation de destination');
    if (b.type === 'PRET' && (!b.toHolderId || !b.dueDate)) throw new BadRequestException("Un prêt désigne un emprunteur et une date de retour");
    if (b.type === 'PRET' && b.dueDate! <= today()) throw new BadRequestException('La date de retour doit être postérieure à aujourd\'hui');
    if (b.type === 'RESTITUTION' && !b.toLocationId) throw new BadRequestException('Indiquez le lieu de restitution (magasin)');
    return this.db.transaction(async (tx) => {
      const list = await tx.select().from(assets).where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.id, b.assetIds)));
      if (list.length !== new Set(b.assetIds).size) throw new BadRequestException('Bien introuvable dans le registre');
      const allowed: Record<string, string[]> = { AFFECTATION: ['EN_STOCK', 'EN_SERVICE'], TRANSFERT: ['EN_STOCK', 'EN_SERVICE'], PRET: ['EN_STOCK', 'EN_SERVICE'], RESTITUTION: ['EN_SERVICE', 'EN_PRET'] };
      const bad = list.filter((a) => !allowed[b.type].includes(a.status));
      if (bad.length) throw new BadRequestException(`Statut incompatible avec ${MOVEMENT_LABELS[b.type].toLowerCase()} : ${bad.slice(0, 5).map((a) => `${a.code} (${a.status.toLowerCase().replace('_', ' ')})`).join(', ')}`);
      const busy = await tx.select({ code: assets.code, n: movements.number }).from(movementItems).innerJoin(movements, eq(movements.id, movementItems.movementId))
        .innerJoin(assets, eq(assets.id, movementItems.assetId)).where(and(inArray(movementItems.assetId, b.assetIds), inArray(movements.status, ['A_VALIDER', 'EN_TRANSIT'])));
      if (busy.length) throw new BadRequestException(`Bien déjà engagé dans le mouvement ${busy[0].n} : ${busy[0].code}`);
      await assertNotFrozen(tx, ctx.user.entityId, b.assetIds);
      const number = await this.numbering.piece(tx, ctx.user.entityId, PREFIX[b.type]);
      const [m] = await tx.insert(movements).values({ entityId: ctx.user.entityId, number, type: b.type, toLocationId: b.toLocationId ?? null, toOrgUnitId: b.toOrgUnitId ?? null,
        toHolderId: b.toHolderId ?? null, dueDate: b.dueDate ?? null, reason: b.reason ?? null, requestedBy: ctx.user.id }).returning();
      await tx.insert(movementItems).values(list.map((a) => ({ movementId: m.id, assetId: a.id, fromLocationId: a.locationId, fromOrgUnitId: a.orgUnitId, fromHolderId: a.holderId, fromStatus: a.status })));
      const value = list.reduce((s, a) => s + a.acquisitionValue, 0);
      const steps: StepDef[] = [];
      if (b.type === 'AFFECTATION') {
        steps.push({ label: 'Visa du comptable-matières', role: 'COMPTABLE_MATIERES' });
        if (value > VISA_DIRECTEUR_SEUIL) steps.push({ label: 'Visa du directeur du patrimoine (plus de 5 M)', role: 'DIRECTEUR' });
        if (b.toHolderId) steps.push({ label: 'Signature de la décharge par le détenteur', userId: b.toHolderId, days: 5 });
      } else if (b.type === 'TRANSFERT') steps.push({ label: 'Validation du directeur du patrimoine', role: 'DIRECTEUR' });
      else if (b.type === 'PRET') { steps.push({ label: 'Validation du directeur du patrimoine', role: 'DIRECTEUR' }); steps.push({ label: "Prise en charge par l'emprunteur", userId: b.toHolderId!, days: 5 }); }
      else steps.push({ label: 'Visa du comptable-matières', role: 'COMPTABLE_MATIERES' });
      await this.wf.start(tx, ctx.user.entityId, 'MOUVEMENT', m.id, steps);
      await tx.insert(assetEvents).values(list.map((a) => ({ assetId: a.id, type: 'MOUVEMENT_DEMANDE', documentNo: number, summary: `${MOVEMENT_LABELS[b.type]} demandé(e) (${number})`, actorId: ctx.user.id })));
      await this.audit.log(tx, ctx, 'CREATION', 'MOUVEMENT', number, { type: b.type, biens: list.map((a) => a.code), valeur: value });
      return m;
    });
  }

  /** Application du mouvement une fois le circuit terminé. */
  private async apply(tx: Tx, ctx: Ctx, id: number) {
    const [m] = await tx.select().from(movements).where(eq(movements.id, id));
    const items = await tx.select().from(movementItems).where(eq(movementItems.movementId, id));
    const ids = items.map((i) => i.assetId);
    const now = new Date();
    if (m.type === 'TRANSFERT') {
      await tx.update(assets).set({ status: 'EN_TRANSIT', updatedAt: now }).where(inArray(assets.id, ids));
      await tx.update(movements).set({ status: 'EN_TRANSIT' }).where(eq(movements.id, id));
      await tx.insert(assetEvents).values(ids.map((assetId) => ({ assetId, type: 'TRANSIT', documentNo: m.number, summary: `Expédié en transfert (${m.number})`, actorId: ctx.user.id })));
      return;
    }
    if (m.type === 'AFFECTATION') {
      await tx.update(assets).set({ status: 'EN_SERVICE', orgUnitId: m.toOrgUnitId ?? sql`${assets.orgUnitId}`, holderId: m.toHolderId ?? null,
        locationId: m.toLocationId ?? sql`${assets.locationId}`, inServiceDate: sql`coalesce(${assets.inServiceDate}, ${today()}::date)`, updatedAt: now }).where(inArray(assets.id, ids));
    } else if (m.type === 'PRET') {
      await tx.update(assets).set({ status: 'EN_PRET', holderId: m.toHolderId, locationId: m.toLocationId ?? sql`${assets.locationId}`, updatedAt: now }).where(inArray(assets.id, ids));
    } else if (m.type === 'RESTITUTION') {
      await tx.update(assets).set({ status: 'EN_STOCK', holderId: null, locationId: m.toLocationId, updatedAt: now }).where(inArray(assets.id, ids));
    }
    await tx.update(movements).set({ status: 'EXECUTE', executedAt: now }).where(eq(movements.id, id));
    await tx.insert(assetEvents).values(ids.map((assetId) => ({ assetId, type: m.type, documentNo: m.number, summary: `${MOVEMENT_LABELS[m.type]} exécuté(e) (${m.number})`, actorId: ctx.user.id })));
    await this.audit.log(tx, ctx, 'EXECUTION', 'MOUVEMENT', m.number, { type: m.type, biens: ids.length });
  }

  /** Confirmation de réception d'un transfert sur le site d'arrivée. */
  @Post(':id/reception') @Perm('movements.write', 'movements.validate')
  async receive(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(movements).where(and(eq(movements.id, parse(zId, id)), eq(movements.entityId, ctx.user.entityId)));
      if (!m) throw new NotFoundException('Mouvement introuvable');
      if (m.status !== 'EN_TRANSIT') throw new BadRequestException("Ce transfert n'est pas en transit");
      const items = await tx.select().from(movementItems).where(eq(movementItems.movementId, m.id));
      for (const it of items) {
        await tx.update(assets).set({ status: it.fromStatus === 'EN_STOCK' ? 'EN_STOCK' : 'EN_SERVICE', locationId: m.toLocationId, updatedAt: new Date() }).where(eq(assets.id, it.assetId));
      }
      await tx.update(movements).set({ status: 'EXECUTE', executedAt: new Date() }).where(eq(movements.id, m.id));
      await tx.insert(assetEvents).values(items.map((i) => ({ assetId: i.assetId, type: 'TRANSFERT', documentNo: m.number, summary: `Reçu sur le site d'arrivée (${m.number})`, actorId: ctx.user.id })));
      await this.audit.log(tx, ctx, 'RECEPTION_TRANSFERT', 'MOUVEMENT', m.number, { biens: items.length });
      return { ok: true };
    });
  }

  /** Prêts échus non restitués. */
  @Get('alertes/prets-echus') @Perm('movements.write', 'assets.read')
  async overdue(@CurrentCtx() ctx: Ctx) {
    return this.db.select({ number: movements.number, dueDate: movements.dueDate, holder: users.fullName, id: movements.id }).from(movements).leftJoin(users, eq(users.id, movements.toHolderId))
      .where(and(eq(movements.entityId, ctx.user.entityId), eq(movements.type, 'PRET'), eq(movements.status, 'EXECUTE'), sql`${movements.dueDate} < ${today()}::date`,
        sql`exists (select 1 from movement_items mi join assets a on a.id = mi.asset_id where mi.movement_id = ${movements.id} and a.status = 'EN_PRET')`));
  }
}
