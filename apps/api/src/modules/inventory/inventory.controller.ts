import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assetEvents, assets, attestations, inventoryCampaigns, inventoryCounts, inventoryExpected, inventoryGaps, inventoryZones, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { NotifyService } from '../../common/notify.service';
import { parse, z, zDate, zId } from '../../common/validation';
import { locationPaths, locationSubtree } from '../referentials/referentials.controller';

/** Décisions possibles par type d'écart ; « final » = l'écart est régularisé. */
export const DECISIONS: Record<string, Record<string, { label: string; final: boolean }>> = {
  MANQUANT: { ENQUETE: { label: 'Enquête auprès du détenteur', final: false }, RETROUVE: { label: 'Retrouvé au second passage', final: true }, CONSTAT_PERTE: { label: 'Constat de perte (statut Manquant)', final: true } },
  EXCEDENT: { RAPPROCHE: { label: "Rapproché d'une fiche existante", final: true }, A_IMMATRICULER: { label: 'À immatriculer (régularisation)', final: true }, BIEN_TIERS: { label: "Bien d'un tiers, hors patrimoine", final: true } },
  MAL_LOCALISE: { TRANSFERT_REGULARISATION: { label: 'Transfert de régularisation', final: true }, RETOUR_LOCAL: { label: 'Remis dans son local', final: true } },
  ECART_ETAT: { METTRE_A_JOUR: { label: "Mise à jour de l'état", final: true }, MAINTENANCE: { label: 'Envoi en maintenance', final: true }, A_REFORMER: { label: 'Mise à jour et proposition de réforme', final: true } },
};
const COND = ['NEUF', 'BON', 'MOYEN', 'MAUVAIS', 'HORS_USAGE'] as const;

@Controller('inventaires')
export class InventoryController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly notify: NotifyService) {}

  private async campaign(tx: Tx, ctx: Ctx, id: string | number) {
    const [c] = await tx.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.id, Number(id)), eq(inventoryCampaigns.entityId, ctx.user.entityId)));
    if (!c) throw new NotFoundException('Campagne introuvable');
    return c;
  }

  private async stats(tx: Tx, campaignId: number) {
    const [{ counted }] = await tx.select({ counted: count() }).from(inventoryCounts).where(eq(inventoryCounts.campaignId, campaignId));
    const [{ found }] = await tx.select({ found: sql<number>`count(distinct ${inventoryCounts.assetId})` }).from(inventoryCounts)
      .innerJoin(inventoryExpected, and(eq(inventoryExpected.campaignId, inventoryCounts.campaignId), eq(inventoryExpected.assetId, inventoryCounts.assetId)))
      .where(eq(inventoryCounts.campaignId, campaignId));
    const gaps = await tx.select({ type: inventoryGaps.type, status: inventoryGaps.status, n: count() }).from(inventoryGaps).where(eq(inventoryGaps.campaignId, campaignId)).groupBy(inventoryGaps.type, inventoryGaps.status);
    const g = { total: 0, open: 0, byType: {} as Record<string, number> };
    for (const r of gaps) { g.total += Number(r.n); g.byType[r.type] = (g.byType[r.type] ?? 0) + Number(r.n); if (r.status !== 'REGULARISE') g.open += Number(r.n); }
    return { counted: Number(counted), found: Number(found), gaps: g };
  }

  @Get() @Perm('inventory.manage', 'inventory.count', 'inventory.decide')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select().from(inventoryCampaigns).where(eq(inventoryCampaigns.entityId, ctx.user.entityId)).orderBy(desc(inventoryCampaigns.id));
    return Promise.all(rows.map(async (c) => ({ ...c, ...(await this.stats(this.db, c.id)) })));
  }

  @Get('decisions') decisions() { return DECISIONS; }

  @Post() @Perm('inventory.manage')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({
      label: z.string().min(3), type: z.enum(['GENERAL', 'TOURNANT', 'CIBLE', 'PASSATION']), startDate: zDate, endDate: zDate,
      blind: z.boolean().default(true), freezeMovements: z.boolean().default(true), zones: z.array(z.object({ locationId: zId, leaderId: zId.nullable().optional() })).min(1, 'au moins une zone'),
    }).refine((x) => x.endDate >= x.startDate, { message: 'la clôture doit suivre le début' }), body);
    return this.db.transaction(async (tx) => {
      const number = await this.numbering.piece(tx, ctx.user.entityId, 'INV', new Date(b.startDate), 2);
      const [c] = await tx.insert(inventoryCampaigns).values({ entityId: ctx.user.entityId, number, label: b.label, type: b.type, startDate: b.startDate, endDate: b.endDate,
        blind: b.blind, freezeMovements: b.freezeMovements, createdBy: ctx.user.id }).returning();
      await tx.insert(inventoryZones).values(b.zones.map((z) => ({ campaignId: c.id, locationId: z.locationId, leaderId: z.leaderId ?? null })));
      await this.audit.log(tx, ctx, 'CREATION', 'INVENTAIRE', number, { zones: b.zones.length, aveugle: b.blind, gel: b.freezeMovements });
      return c;
    });
  }

  /** Lancement : photo des biens attendus par zone, puis ouverture du comptage. */
  @Post(':id/lancer') @Perm('inventory.manage')
  async launch(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.campaign(tx, ctx, id);
      if (c.status !== 'PREPARATION') throw new BadRequestException('Campagne déjà lancée');
      const zones = await tx.select().from(inventoryZones).where(eq(inventoryZones.campaignId, c.id));
      const taken = new Set<number>();
      let total = 0;
      for (const z of zones) {
        const locIds = await locationSubtree(tx, [z.locationId]);
        const list = await tx.select({ id: assets.id, locationId: assets.locationId, condition: assets.condition }).from(assets)
          .where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.locationId, locIds), sql`${assets.status} not in ('SORTI', 'EN_TRANSIT')`));
        const mine = list.filter((a) => !taken.has(a.id));
        mine.forEach((a) => taken.add(a.id));
        for (let i = 0; i < mine.length; i += 1000) {
          await tx.insert(inventoryExpected).values(mine.slice(i, i + 1000).map((a) => ({ campaignId: c.id, zoneId: z.id, assetId: a.id, expectedLocationId: a.locationId, expectedCondition: a.condition })));
        }
        await tx.update(inventoryZones).set({ expectedCount: mine.length }).where(eq(inventoryZones.id, z.id));
        total += mine.length;
      }
      await tx.update(inventoryCampaigns).set({ status: 'EN_COURS', expectedCount: total }).where(eq(inventoryCampaigns.id, c.id));
      await this.notify.toUsers(tx, zones.map((z) => z.leaderId!).filter(Boolean), { kind: 'info', title: 'Inventaire lancé', body: `${c.number} : vos zones sont prêtes au comptage`, link: `/inventaires/${c.id}` });
      await this.audit.log(tx, ctx, 'LANCEMENT', 'INVENTAIRE', c.number, { biensAttendus: total });
      return { expected: total };
    });
  }

  @Get(':id') @Perm('inventory.manage', 'inventory.count', 'inventory.decide')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const c = await this.campaign(this.db, ctx, id);
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const zones = await this.db.select({ z: inventoryZones, leader: users.fullName }).from(inventoryZones).leftJoin(users, eq(users.id, inventoryZones.leaderId))
      .where(eq(inventoryZones.campaignId, c.id)).orderBy(asc(inventoryZones.id));
    const counts = await this.db.select({ zoneId: inventoryCounts.zoneId, n: count() }).from(inventoryCounts).where(eq(inventoryCounts.campaignId, c.id)).groupBy(inventoryCounts.zoneId);
    const cm = new Map(counts.map((x) => [x.zoneId, Number(x.n)]));
    return { ...c, ...(await this.stats(this.db, c.id)), zones: zones.map(({ z, leader }) => ({ ...z, leader, location: paths.get(z.locationId), counted: cm.get(z.id) ?? 0 })) };
  }

  /** Zone de comptage. En comptage à l'aveugle, la liste attendue n'est pas communiquée aux compteurs. */
  @Get(':id/zones/:zoneId') @Perm('inventory.manage', 'inventory.count')
  async zone(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('zoneId') zoneId: string) {
    const c = await this.campaign(this.db, ctx, id);
    const [z] = await this.db.select().from(inventoryZones).where(and(eq(inventoryZones.id, parse(zId, zoneId)), eq(inventoryZones.campaignId, c.id)));
    if (!z) throw new NotFoundException('Zone introuvable');
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const counted = await this.db.select({ k: inventoryCounts, code: assets.code, designation: assets.designation, by: users.fullName }).from(inventoryCounts)
      .leftJoin(assets, eq(assets.id, inventoryCounts.assetId)).leftJoin(users, eq(users.id, inventoryCounts.countedBy))
      .where(eq(inventoryCounts.zoneId, z.id)).orderBy(desc(inventoryCounts.countedAt));
    const showExpected = !c.blind || ctx.user.role === 'DIRECTEUR' || ctx.user.role === 'ADMIN';
    const expected = showExpected ? await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, locationId: inventoryExpected.expectedLocationId })
      .from(inventoryExpected).innerJoin(assets, eq(assets.id, inventoryExpected.assetId)).where(eq(inventoryExpected.zoneId, z.id)).orderBy(asc(assets.code)) : null;
    const seen = new Set(counted.map((x) => x.k.assetId));
    return {
      campaign: { id: c.id, number: c.number, label: c.label, status: c.status, blind: c.blind }, zone: { ...z, location: paths.get(z.locationId) },
      counts: counted.map((x) => ({ ...x.k, code: x.code ?? x.k.scannedCode, designation: x.designation ?? 'Code non référencé', by: x.by, location: x.k.locationId ? paths.get(x.k.locationId) : null })),
      expected: expected?.map((e) => ({ ...e, location: e.locationId ? paths.get(e.locationId) : null, counted: seen.has(e.id) })) ?? null,
      locations: (await locationSubtree(this.db, [z.locationId])).map((lid) => ({ id: lid, path: paths.get(lid) })),
    };
  }

  /** Constat d'un bien (scan ou saisie). */
  @Post(':id/constats') @Perm('inventory.count', 'inventory.manage')
  async count(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(countSchema, body);
    return this.db.transaction(async (tx) => recordCount(tx, ctx, await this.campaign(tx, ctx, id), { ...b, source: 'WEB' }));
  }

  @Post(':id/zones/:zoneId/terminer') @Perm('inventory.count', 'inventory.manage')
  async closeZone(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('zoneId') zoneId: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.campaign(tx, ctx, id);
      const [z] = await tx.update(inventoryZones).set({ status: 'TERMINEE' }).where(and(eq(inventoryZones.id, parse(zId, zoneId)), eq(inventoryZones.campaignId, c.id))).returning();
      if (!z) throw new NotFoundException('Zone introuvable');
      await this.audit.log(tx, ctx, 'CLOTURE_ZONE', 'INVENTAIRE', c.number, { zone: z.id });
      return { ok: true };
    });
  }

  /** Rapprochement : calcule les écarts entre attendus et constatés (les décisions déjà prises sont conservées). */
  @Post(':id/rapprocher') @Perm('inventory.manage', 'inventory.decide')
  async reconcile(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.campaign(tx, ctx, id);
      if (c.status === 'PREPARATION') throw new BadRequestException("La campagne n'est pas lancée");
      if (c.status === 'CLOTUREE') throw new BadRequestException('Campagne clôturée');
      const paths = await locationPaths(tx, ctx.user.entityId);
      const expected = await tx.select({ e: inventoryExpected, code: assets.code, designation: assets.designation }).from(inventoryExpected).innerJoin(assets, eq(assets.id, inventoryExpected.assetId)).where(eq(inventoryExpected.campaignId, c.id));
      const counts = await tx.select({ k: inventoryCounts, code: assets.code, designation: assets.designation }).from(inventoryCounts).leftJoin(assets, eq(assets.id, inventoryCounts.assetId)).where(eq(inventoryCounts.campaignId, c.id));
      const existing = await tx.select().from(inventoryGaps).where(eq(inventoryGaps.campaignId, c.id));
      const zoneLoc = new Map((await tx.select().from(inventoryZones).where(eq(inventoryZones.campaignId, c.id))).map((z) => [z.id, z.locationId]));
      const keep = new Set(existing.filter((g) => g.status !== 'A_TRAITER').map((g) => `${g.type}:${g.assetId ?? g.scannedCode}`));
      await tx.delete(inventoryGaps).where(and(eq(inventoryGaps.campaignId, c.id), eq(inventoryGaps.status, 'A_TRAITER')));
      const byAsset = new Map(counts.filter((k) => k.k.assetId).map((k) => [k.k.assetId!, k]));
      const expMap = new Map(expected.map((e) => [e.e.assetId, e]));
      const gaps: (typeof inventoryGaps.$inferInsert)[] = [];
      const push = (g: typeof inventoryGaps.$inferInsert) => { if (!keep.has(`${g.type}:${g.assetId ?? g.scannedCode}`)) gaps.push(g); };
      for (const e of expected) {
        const k = byAsset.get(e.e.assetId);
        if (!k) { push({ campaignId: c.id, type: 'MANQUANT', assetId: e.e.assetId, detail: `${e.designation} · attendu : ${paths.get(e.e.expectedLocationId!) ?? '—'}` }); continue; }
        const foundAt = k.k.locationId ?? (k.k.zoneId !== e.e.zoneId ? zoneLoc.get(k.k.zoneId) ?? null : null);
        if (foundAt && e.e.expectedLocationId && foundAt !== e.e.expectedLocationId)
          push({ campaignId: c.id, type: 'MAL_LOCALISE', assetId: e.e.assetId, detail: `Attendu : ${paths.get(e.e.expectedLocationId)} · trouvé : ${paths.get(foundAt)}` });
        const order = (x: string | null) => COND.indexOf((x ?? 'BON') as (typeof COND)[number]);
        if (order(k.k.condition) >= 3 && order(k.k.condition) > order(e.e.expectedCondition))
          push({ campaignId: c.id, type: 'ECART_ETAT', assetId: e.e.assetId, detail: `Fiche : ${(e.e.expectedCondition ?? 'BON').toLowerCase()} · constat : ${k.k.condition.toLowerCase().replace('_', ' ')}${k.k.comment ? ' · ' + k.k.comment : ''}` });
      }
      for (const k of counts) {
        const where = paths.get(k.k.locationId ?? zoneLoc.get(k.k.zoneId) ?? -1) ?? '—';
        if (!k.k.assetId) push({ campaignId: c.id, type: 'EXCEDENT', scannedCode: k.k.scannedCode, detail: `Code ${k.k.scannedCode} non référencé · trouvé : ${where}${k.k.comment ? ' · ' + k.k.comment : ''}` });
        else if (!expMap.has(k.k.assetId)) push({ campaignId: c.id, type: 'EXCEDENT', assetId: k.k.assetId, scannedCode: k.code, detail: `${k.designation} trouvé hors périmètre attendu : ${where}` });
      }
      for (let i = 0; i < gaps.length; i += 1000) await tx.insert(inventoryGaps).values(gaps.slice(i, i + 1000));
      await this.audit.log(tx, ctx, 'RAPPROCHEMENT', 'INVENTAIRE', c.number, { nouveauxEcarts: gaps.length });
      return this.stats(tx, c.id);
    });
  }

  @Get(':id/ecarts') @Perm('inventory.manage', 'inventory.decide')
  async gaps(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('type') type?: string) {
    const c = await this.campaign(this.db, ctx, id);
    const rows = await this.db.select({ g: inventoryGaps, code: assets.code, designation: assets.designation, value: assets.acquisitionValue, by: users.fullName })
      .from(inventoryGaps).leftJoin(assets, eq(assets.id, inventoryGaps.assetId)).leftJoin(users, eq(users.id, inventoryGaps.decidedBy))
      .where(and(eq(inventoryGaps.campaignId, c.id), type ? eq(inventoryGaps.type, type) : undefined)).orderBy(asc(inventoryGaps.type), asc(inventoryGaps.id)).limit(2000);
    return rows.map((r) => ({ ...r.g, code: r.code ?? r.g.scannedCode, designation: r.designation, value: r.value, decidedByName: r.by,
      decisionLabel: r.g.decision ? DECISIONS[r.g.type][r.g.decision]?.label : null }));
  }

  /** Décision sur un ou plusieurs écarts du même type ; les décisions finales sont appliquées au registre. */
  @Post(':id/ecarts/decision') @Perm('inventory.decide')
  async decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ gapIds: z.array(zId).min(1).max(1000), decision: z.string(), comment: z.string().max(1000).optional() }), body);
    return this.db.transaction(async (tx) => {
      const c = await this.campaign(tx, ctx, id);
      if (c.status === 'CLOTUREE') throw new BadRequestException('Campagne clôturée');
      const gaps = await tx.select().from(inventoryGaps).where(and(eq(inventoryGaps.campaignId, c.id), inArray(inventoryGaps.id, b.gapIds)));
      if (gaps.length !== b.gapIds.length) throw new NotFoundException('Écart introuvable');
      const types = new Set(gaps.map((g) => g.type));
      if (types.size > 1) throw new BadRequestException("Sélectionnez des écarts d'un même type");
      const type = gaps[0].type;
      const d = DECISIONS[type][b.decision];
      if (!d) throw new BadRequestException(`Décision « ${b.decision} » impossible pour un écart de type ${type}`);
      if (gaps.some((g) => g.status === 'REGULARISE')) throw new BadRequestException('Un écart déjà régularisé ne peut plus changer de décision');
      if (b.decision === 'CONSTAT_PERTE' && !b.comment) throw new BadRequestException('Le constat de perte exige un commentaire (circonstances, enquête)');
      const now = new Date();
      for (const g of gaps) {
        if (d.final && g.assetId) await this.applyDecision(tx, ctx, c, g, b.decision);
        await tx.update(inventoryGaps).set({ decision: b.decision, decisionComment: b.comment ?? null, status: d.final ? 'REGULARISE' : 'DECIDE', decidedBy: ctx.user.id, decidedAt: now }).where(eq(inventoryGaps.id, g.id));
      }
      await this.audit.log(tx, ctx, 'DECISION_ECART', 'INVENTAIRE', c.number, { type, decision: b.decision, ecarts: gaps.length, commentaire: b.comment ?? null });
      return { updated: gaps.length };
    });
  }

  private async applyDecision(tx: Tx, ctx: Ctx, c: typeof inventoryCampaigns.$inferSelect, g: typeof inventoryGaps.$inferSelect, decision: string) {
    const [k] = await tx.select().from(inventoryCounts).where(and(eq(inventoryCounts.campaignId, c.id), eq(inventoryCounts.assetId, g.assetId!)));
    const ev = (summary: string) => tx.insert(assetEvents).values({ assetId: g.assetId!, type: 'INVENTAIRE', documentNo: c.number, summary, actorId: ctx.user.id });
    if (decision === 'CONSTAT_PERTE') { await tx.update(assets).set({ status: 'MANQUANT', updatedAt: new Date() }).where(eq(assets.id, g.assetId!)); await ev('Constat de perte à l\'inventaire : statut Manquant'); }
    const foundAt = k ? k.locationId ?? (await tx.select({ l: inventoryZones.locationId }).from(inventoryZones).where(eq(inventoryZones.id, k.zoneId)))[0]?.l : null;
    if (decision === 'TRANSFERT_REGULARISATION' && foundAt) { await tx.update(assets).set({ locationId: foundAt, updatedAt: new Date() }).where(eq(assets.id, g.assetId!)); await ev('Localisation régularisée selon le constat d\'inventaire'); }
    if ((decision === 'METTRE_A_JOUR' || decision === 'A_REFORMER') && k) { await tx.update(assets).set({ condition: k.condition, updatedAt: new Date() }).where(eq(assets.id, g.assetId!)); await ev(`État mis à jour : ${k.condition.toLowerCase().replace('_', ' ')}${decision === 'A_REFORMER' ? ' · à proposer à la réforme' : ''}`); }
    if (decision === 'MAINTENANCE') { await tx.update(assets).set({ status: 'EN_MAINTENANCE', condition: k?.condition ?? 'MAUVAIS', updatedAt: new Date() }).where(eq(assets.id, g.assetId!)); await ev('Envoyé en maintenance suite à l\'inventaire'); }
    if (decision === 'RETROUVE') await ev('Retrouvé au second passage d\'inventaire');
  }

  /** Clôture : tous les écarts doivent être régularisés ; les constats mettent à jour la date de dernier contrôle. */
  @Post(':id/cloturer') @Perm('inventory.manage')
  async close(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.campaign(tx, ctx, id);
      if (c.status !== 'EN_COURS') throw new BadRequestException("Seule une campagne en cours peut être clôturée");
      const [{ n }] = await tx.select({ n: count() }).from(inventoryGaps).where(and(eq(inventoryGaps.campaignId, c.id), sql`${inventoryGaps.status} <> 'REGULARISE'`));
      if (Number(n) > 0) throw new BadRequestException(`${n} écart(s) sans décision finale : le PV ne peut pas être signé`);
      const [{ m }] = await tx.select({ m: count() }).from(inventoryExpected).where(and(eq(inventoryExpected.campaignId, c.id),
        sql`not exists (select 1 from inventory_counts k where k.campaign_id = ${c.id} and k.asset_id = ${inventoryExpected.assetId})`,
        sql`not exists (select 1 from inventory_gaps g where g.campaign_id = ${c.id} and g.asset_id = ${inventoryExpected.assetId})`));
      if (Number(m) > 0) throw new BadRequestException('Lancez le rapprochement avant la clôture : des biens non constatés n\'ont pas encore d\'écart');
      await tx.execute(sql`update assets a set last_seen_at = k.counted_at, label_status = 'CONTROLEE' from inventory_counts k where k.asset_id = a.id and k.campaign_id = ${c.id}`);
      await tx.update(inventoryCampaigns).set({ status: 'CLOTUREE', closedAt: new Date() }).where(eq(inventoryCampaigns.id, c.id));
      const st = await this.stats(tx, c.id);
      await this.audit.log(tx, ctx, 'CLOTURE', 'INVENTAIRE', c.number, st);
      return st;
    });
  }

  @Get(':id/attestations') @Perm('inventory.manage', 'inventory.decide')
  async attestations(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const c = await this.campaign(this.db, ctx, id);
    return this.db.select({ a: attestations, holder: users.fullName }).from(attestations).innerJoin(users, eq(users.id, attestations.holderId)).where(eq(attestations.campaignId, c.id));
  }
}

export const countSchema = z.object({ zoneId: zId, code: z.string().min(3).max(60), condition: z.enum(COND), locationId: zId.nullable().optional(), comment: z.string().max(500).optional() });
export interface CountInput extends z.infer<typeof countSchema> { source: 'WEB' | 'MOBILE'; clientId?: string; countedAt?: Date; lat?: string | null; lng?: string | null }
export type CountStatus = 'RECONNU' | 'MIS_A_JOUR' | 'EXCEDENT' | 'DEJA_SIGNALE' | 'DEJA_RECU';

/**
 * Règles d'un constat, communes au web et à l'application mobile : campagne ouverte, zone non clôturée,
 * commentaire obligatoire pour un mauvais état, un bien constaté une seule fois par campagne.
 */
export async function recordCount(tx: Tx, ctx: Ctx, c: typeof inventoryCampaigns.$inferSelect, b: CountInput): Promise<{ status: CountStatus; code: string; designation: string; countId?: number; assetId?: number | null }> {
  if (b.clientId) {
    const [prev] = await tx.select({ id: inventoryCounts.id, assetId: inventoryCounts.assetId, code: inventoryCounts.scannedCode }).from(inventoryCounts).where(eq(inventoryCounts.clientId, b.clientId));
    if (prev) return { status: 'DEJA_RECU', code: prev.code, designation: '', countId: prev.id, assetId: prev.assetId };
  }
  if (c.status !== 'EN_COURS') throw new BadRequestException("La campagne n'est pas ouverte au comptage");
  const [z] = await tx.select().from(inventoryZones).where(and(eq(inventoryZones.id, b.zoneId), eq(inventoryZones.campaignId, c.id)));
  if (!z) throw new NotFoundException('Zone introuvable');
  if (z.status === 'TERMINEE') throw new BadRequestException('Zone déjà clôturée');
  if (['MAUVAIS', 'HORS_USAGE'].includes(b.condition) && !b.comment) throw new BadRequestException('Commentaire obligatoire pour un bien en mauvais état ou hors d\'usage');
  const code = b.code.trim().toUpperCase();
  const at = b.countedAt ?? new Date();
  const extra = { clientId: b.clientId ?? null, source: b.source, lat: b.lat ?? null, lng: b.lng ?? null };
  const [a] = await tx.select().from(assets).where(and(eq(assets.entityId, ctx.user.entityId), eq(assets.code, code)));
  if (a) {
    const [dup] = await tx.select({ id: inventoryCounts.id, zoneId: inventoryCounts.zoneId, countedAt: inventoryCounts.countedAt }).from(inventoryCounts).where(and(eq(inventoryCounts.campaignId, c.id), eq(inventoryCounts.assetId, a.id)));
    if (dup && dup.zoneId !== z.id) throw new ConflictException(`${code} a déjà été constaté dans une autre zone : signalé au chef d'équipe`);
    if (dup) {
      // Le constat le plus récent l'emporte (un appareil resté hors ligne peut transmettre un constat plus ancien).
      if (dup.countedAt > at) return { status: 'MIS_A_JOUR', code, designation: a.designation, countId: dup.id, assetId: a.id };
      await tx.update(inventoryCounts).set({ condition: b.condition, comment: b.comment ?? null, locationId: b.locationId ?? null, countedBy: ctx.user.id, countedAt: at, ...extra }).where(eq(inventoryCounts.id, dup.id));
      return { status: 'MIS_A_JOUR', code, designation: a.designation, countId: dup.id, assetId: a.id };
    }
  } else {
    const [dup] = await tx.select({ id: inventoryCounts.id }).from(inventoryCounts).where(and(eq(inventoryCounts.campaignId, c.id), eq(inventoryCounts.scannedCode, code), isNull(inventoryCounts.assetId)));
    if (dup) return { status: 'DEJA_SIGNALE', code, designation: 'Code non référencé', countId: dup.id, assetId: null };
  }
  // Sans local précis, le bien est réputé trouvé dans sa zone (localisation non contestée).
  const [row] = await tx.insert(inventoryCounts).values({ campaignId: c.id, zoneId: z.id, assetId: a?.id ?? null, scannedCode: code, condition: b.condition, comment: b.comment ?? null,
    locationId: b.locationId ?? null, countedBy: ctx.user.id, countedAt: at, ...extra }).returning({ id: inventoryCounts.id });
  if (z.status === 'A_FAIRE') await tx.update(inventoryZones).set({ status: 'EN_COURS' }).where(eq(inventoryZones.id, z.id));
  return a ? { status: 'RECONNU', code, designation: a.designation, countId: row.id, assetId: a.id } : { status: 'EXCEDENT', code, designation: 'Code non référencé : sera traité comme excédent', countId: row.id, assetId: null };
}
