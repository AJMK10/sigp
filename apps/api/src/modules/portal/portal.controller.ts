import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DB } from '../../db/client';
import { assets, attestations, categories, holderRequests, inventoryCampaigns, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { NotifyService } from '../../common/notify.service';
import { parse, z, zId } from '../../common/validation';
import { locationPaths } from '../referentials/referentials.controller';

const REQ_LABELS: Record<string, string> = { PANNE: 'Signalement de panne', PERTE: 'Déclaration de perte ou de vol', EQUIPEMENT: "Demande d'équipement", RESTITUTION: 'Demande de restitution' };

/** Portail du détenteur : ses biens, ses demandes, son attestation de détention. */
@Controller('portail')
export class PortalController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly notify: NotifyService) {}

  @Get() @Perm('portal.use')
  async home(@CurrentCtx() ctx: Ctx) {
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const mine = await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, status: assets.status, condition: assets.condition, locationId: assets.locationId, category: categories.label })
      .from(assets).innerJoin(categories, eq(categories.id, assets.categoryId)).where(and(eq(assets.holderId, ctx.user.id), inArray(assets.status, ['EN_SERVICE', 'EN_PRET', 'EN_MAINTENANCE'])));
    const requests = await this.db.select().from(holderRequests).where(eq(holderRequests.createdBy, ctx.user.id)).orderBy(desc(holderRequests.id)).limit(30);
    const [open] = await this.db.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.entityId, ctx.user.entityId), eq(inventoryCampaigns.status, 'EN_COURS'))).orderBy(desc(inventoryCampaigns.id)).limit(1);
    const [att] = open ? await this.db.select().from(attestations).where(and(eq(attestations.campaignId, open.id), eq(attestations.holderId, ctx.user.id))) : [];
    return {
      assets: mine.map((a) => ({ ...a, location: a.locationId ? paths.get(a.locationId) : null })),
      requests: requests.map((r) => ({ ...r, typeLabel: REQ_LABELS[r.type] })),
      attestation: open ? { campaignId: open.id, campaign: open.number, endDate: open.endDate, signedAt: att?.signedAt ?? null, disputed: att?.disputed ?? false } : null,
    };
  }

  @Post('demandes') @Perm('portal.use')
  async request(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ type: z.enum(['PANNE', 'PERTE', 'EQUIPEMENT', 'RESTITUTION']), assetId: zId.nullable().optional(), description: z.string().min(5, 'décrivez la demande') }), body);
    if (b.type !== 'EQUIPEMENT' && !b.assetId) throw new BadRequestException('Choisissez le bien concerné');
    return this.db.transaction(async (tx) => {
      if (b.assetId) {
        const [a] = await tx.select().from(assets).where(and(eq(assets.id, b.assetId), eq(assets.holderId, ctx.user.id)));
        if (!a) throw new BadRequestException("Ce bien ne vous est pas affecté");
      }
      const number = await this.numbering.piece(tx, ctx.user.entityId, 'DMD', new Date(), 5);
      const [r] = await tx.insert(holderRequests).values({ entityId: ctx.user.entityId, number, type: b.type, assetId: b.assetId ?? null, description: b.description, createdBy: ctx.user.id }).returning();
      await this.notify.toRole(tx, ctx.user.entityId, 'GESTIONNAIRE', { kind: b.type === 'PERTE' ? 'bad' : 'info', title: REQ_LABELS[b.type], body: `${number} de ${ctx.user.fullName} : ${b.description.slice(0, 120)}`, link: '/portail/demandes' });
      await this.audit.log(tx, ctx, 'DEMANDE', 'DEMANDE', number, { type: b.type, bien: b.assetId ?? null });
      return r;
    });
  }

  /** Demandes reçues (gestionnaires). */
  @Get('demandes') @Perm('assets.write')
  async inbox(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ r: holderRequests, by: users.fullName, code: assets.code, designation: assets.designation }).from(holderRequests)
      .innerJoin(users, eq(users.id, holderRequests.createdBy)).leftJoin(assets, eq(assets.id, holderRequests.assetId))
      .where(eq(holderRequests.entityId, ctx.user.entityId)).orderBy(desc(holderRequests.id)).limit(200);
    return rows.map((x) => ({ ...x.r, by: x.by, code: x.code, designation: x.designation, typeLabel: REQ_LABELS[x.r.type] }));
  }

  @Patch('demandes/:id') @Perm('assets.write')
  async answer(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['EN_COURS', 'TRAITEE', 'REJETEE']), response: z.string().min(2) }), body);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(holderRequests).set(b).where(and(eq(holderRequests.id, parse(zId, id)), eq(holderRequests.entityId, ctx.user.entityId))).returning();
      if (!r) throw new BadRequestException('Demande introuvable');
      await this.notify.toUsers(tx, [r.createdBy], { kind: b.status === 'REJETEE' ? 'bad' : 'ok', title: `Demande ${r.number}`, body: b.response, link: '/portail' });
      await this.audit.log(tx, ctx, 'REPONSE_DEMANDE', 'DEMANDE', r.number, b);
      return r;
    });
  }

  /** Attestation de détention pour la campagne en cours. */
  @Post('attestation') @Perm('portal.use')
  async attest(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ campaignId: zId, disputed: z.boolean().default(false), comment: z.string().optional() }), body);
    if (b.disputed && !b.comment) throw new BadRequestException("Décrivez l'écart constaté");
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.id, b.campaignId), eq(inventoryCampaigns.entityId, ctx.user.entityId), eq(inventoryCampaigns.status, 'EN_COURS')));
      if (!c) throw new BadRequestException("Aucune campagne d'inventaire ouverte");
      const mine = await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.holderId, ctx.user.id), inArray(assets.status, ['EN_SERVICE', 'EN_PRET', 'EN_MAINTENANCE'])));
      const [a] = await tx.insert(attestations).values({ campaignId: c.id, holderId: ctx.user.id, assetCount: mine.length, disputed: b.disputed, comment: b.comment ?? null })
        .onConflictDoUpdate({ target: [attestations.campaignId, attestations.holderId], set: { disputed: b.disputed, comment: b.comment ?? null, signedAt: new Date(), assetCount: mine.length } }).returning();
      if (b.disputed) await this.notify.toRole(tx, ctx.user.entityId, 'GESTIONNAIRE', { kind: 'warn', title: 'Écart signalé par un détenteur', body: `${ctx.user.fullName} : ${b.comment}`, link: `/inventaires/${c.id}` });
      await this.audit.log(tx, ctx, 'ATTESTATION', 'INVENTAIRE', c.number, { biens: mine.length, ecart: b.disputed });
      return a;
    });
  }
}
