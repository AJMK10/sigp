import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { DB } from '../../db/client';
import { assets, categories, documents, inventoryCampaigns, inventoryCounts, inventoryExpected, inventoryZones, orgUnits, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { can } from '../../common/permissions';
import { parse, z, zId } from '../../common/validation';
import { locationPaths, locationSubtree } from '../referentials/referentials.controller';
import { countSchema, recordCount } from '../inventory/inventory.controller';
import { storeDocument } from '../documents/documents.controller';

const MAX_BATCH = 500;
const syncSchema = z.object({
  deviceId: z.string().min(4).max(60),
  counts: z.array(countSchema.extend({
    clientId: z.string().regex(/^[A-Za-z0-9-]{8,40}$/, 'identifiant de constat invalide'),
    campaignId: zId,
    countedAt: z.string().datetime({ offset: true }),
    lat: z.coerce.number().min(-90).max(90).nullable().optional(),
    lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  })).max(MAX_BATCH),
});

/**
 * Application mobile d'inventaire hors ligne : téléchargement du paquet des zones de l'équipe,
 * synchronisation idempotente des constats, photos, clôture de zone signée.
 */
@Controller('mobile')
export class MobileController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  /** Zones confiées à l'utilisateur dans les campagnes ouvertes ; un gestionnaire reçoit toutes les zones. */
  private async myZones(ctx: Ctx) {
    const all = can(ctx.user.role, 'inventory.manage');
    return this.db.select({ z: inventoryZones, c: inventoryCampaigns, leader: users.fullName }).from(inventoryZones)
      .innerJoin(inventoryCampaigns, eq(inventoryCampaigns.id, inventoryZones.campaignId)).leftJoin(users, eq(users.id, inventoryZones.leaderId))
      .where(and(eq(inventoryCampaigns.entityId, ctx.user.entityId), eq(inventoryCampaigns.status, 'EN_COURS'), all ? undefined : eq(inventoryZones.leaderId, ctx.user.id)))
      .orderBy(asc(inventoryCampaigns.id), asc(inventoryZones.id));
  }

  /**
   * Paquet hors ligne. Le dictionnaire des codes couvre les biens présents dans les zones confiées : il permet de reconnaître
   * un bien sans réseau. En comptage à l'aveugle, la localisation attendue et la liste par zone ne sont pas transmises.
   */
  @Get('paquet') @Perm('inventory.count', 'inventory.manage')
  async pack(@CurrentCtx() ctx: Ctx) {
    const rows = await this.myZones(ctx);
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const campaigns = new Map<number, { id: number; number: string; label: string; blind: boolean; endDate: string; zones: unknown[] }>();
    const assetIds = new Set<number>();
    const expectedByZone = new Map<number, number[]>();
    const subtreeIds = new Set<number>();
    for (const { z, c, leader } of rows) {
      if (!campaigns.has(c.id)) campaigns.set(c.id, { id: c.id, number: c.number, label: c.label, blind: c.blind, endDate: c.endDate, zones: [] });
      const exp = await this.db.select({ id: inventoryExpected.assetId }).from(inventoryExpected).where(eq(inventoryExpected.zoneId, z.id));
      exp.forEach((e) => assetIds.add(e.id));
      expectedByZone.set(z.id, exp.map((e) => e.id));
      const sub = await locationSubtree(this.db, [z.locationId]);
      sub.forEach((l) => subtreeIds.add(l));
      campaigns.get(c.id)!.zones.push({ id: z.id, campaignId: c.id, name: paths.get(z.locationId) ?? '', status: z.status, expectedCount: z.expectedCount, leader,
        locations: sub.map((lid) => ({ id: lid, path: paths.get(lid) ?? '' })) });
    }
    // Biens présents physiquement dans les zones (même hors liste attendue) : reconnus hors ligne.
    if (subtreeIds.size) (await this.db.select({ id: assets.id }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.locationId, [...subtreeIds]), ne(assets.status, 'SORTI')))).forEach((a) => assetIds.add(a.id));
    const ids = [...assetIds];
    const dict = ids.length ? await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, category: categories.label, condition: assets.condition,
      locationId: assets.locationId, holder: users.fullName, unit: orgUnits.name, lastSeenAt: assets.lastSeenAt, serial: assets.serialNumber })
      .from(assets).innerJoin(categories, eq(categories.id, assets.categoryId)).leftJoin(users, eq(users.id, assets.holderId)).leftJoin(orgUnits, eq(orgUnits.id, assets.orgUnitId))
      .where(inArray(assets.id, ids)) : [];
    const campIds = [...campaigns.keys()];
    const counted = campIds.length ? await this.db.select({ zoneId: inventoryCounts.zoneId, code: inventoryCounts.scannedCode, condition: inventoryCounts.condition, countedAt: inventoryCounts.countedAt, clientId: inventoryCounts.clientId, assetId: inventoryCounts.assetId })
      .from(inventoryCounts).where(and(inArray(inventoryCounts.campaignId, campIds), inArray(inventoryCounts.zoneId, rows.map((r) => r.z.id)))) : [];
    const blindIds = new Set([...campaigns.values()].filter((c) => c.blind).map((c) => c.id));
    const zoneCampaign = new Map(rows.map((r) => [r.z.id, r.c.id]));
    await this.audit.log(this.db, ctx, 'TELECHARGEMENT_MOBILE', 'INVENTAIRE', [...campaigns.values()].map((c) => c.number).join(', ') || '—', { zones: rows.length, biens: dict.length });
    return {
      generatedAt: new Date().toISOString(),
      user: { id: ctx.user.id, fullName: ctx.user.fullName },
      campaigns: [...campaigns.values()],
      assets: dict.map((a) => ({ id: a.id, code: a.code, designation: a.designation, category: a.category, condition: a.condition, serial: a.serial,
        holder: a.holder ?? (a.unit ? `${a.unit} (collectif)` : null), lastSeenAt: a.lastSeenAt,
        // En comptage à l'aveugle, la localisation attendue n'est pas communiquée.
        expectedLocation: a.locationId ? paths.get(a.locationId) ?? null : null })),
      expected: Object.fromEntries([...expectedByZone.entries()].filter(([zid]) => !blindIds.has(zoneCampaign.get(zid)!)).map(([zid, list]) => [zid, list])),
      counted: counted.map((x) => ({ zoneId: x.zoneId, code: x.code, condition: x.condition, countedAt: x.countedAt, clientId: x.clientId, known: x.assetId != null })),
      blindCampaigns: [...blindIds],
    };
  }

  /** Synchronisation : chaque constat est traité séparément ; un refus n'empêche pas les suivants. Renvoyer un lot déjà reçu est sans effet. */
  @Post('synchroniser') @Perm('inventory.count', 'inventory.manage')
  async sync(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(syncSchema, body);
    const results = [];
    const camps = new Map<number, typeof inventoryCampaigns.$inferSelect | null>();
    const now = Date.now();
    for (const k of b.counts) {
      try {
        if (!camps.has(k.campaignId)) camps.set(k.campaignId, (await this.db.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.id, k.campaignId), eq(inventoryCampaigns.entityId, ctx.user.entityId))))[0] ?? null);
        const c = camps.get(k.campaignId);
        if (!c) throw new NotFoundException('Campagne introuvable');
        let at = new Date(k.countedAt);
        if (at.getTime() > now + 5 * 60_000) at = new Date(now); // horloge de l'appareil en avance
        const r = await this.db.transaction(async (tx) => {
          const [z] = await tx.select({ leaderId: inventoryZones.leaderId }).from(inventoryZones).where(and(eq(inventoryZones.id, k.zoneId), eq(inventoryZones.campaignId, c.id)));
          if (z && z.leaderId !== ctx.user.id && !can(ctx.user.role, 'inventory.manage')) throw new BadRequestException("Cette zone n'est pas confiée à votre équipe");
          return recordCount(tx, ctx, c, { ...k, source: 'MOBILE', countedAt: at, lat: k.lat != null ? String(k.lat) : null, lng: k.lng != null ? String(k.lng) : null });
        });
        results.push({ clientId: k.clientId, ok: true, ...r });
      } catch (e) {
        const status = (e as { status?: number }).status;
        results.push({ clientId: k.clientId, ok: false, status: status === 409 ? 'CONFLIT' : 'REFUSE', code: k.code, message: e instanceof Error ? e.message : String(e), retry: !status || status >= 500 });
      }
    }
    if (b.counts.length) await this.audit.log(this.db, ctx, 'SYNCHRONISATION_MOBILE', 'INVENTAIRE', b.deviceId, { constats: b.counts.length, acceptes: results.filter((r) => r.ok).length });
    return { receivedAt: new Date().toISOString(), results };
  }

  /** Photo d'un constat, envoyée après la synchronisation du constat lui-même. */
  @Post('photos') @Perm('inventory.count', 'inventory.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async photo(@CurrentCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    const b = parse(z.object({ clientId: z.string().regex(/^[A-Za-z0-9-]{8,40}$/), photoId: z.string().regex(/^[A-Za-z0-9-]{4,40}$/) }), body);
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    const [k] = await this.db.select({ id: inventoryCounts.id, assetId: inventoryCounts.assetId, campaignId: inventoryCounts.campaignId, code: inventoryCounts.scannedCode, entityId: inventoryCampaigns.entityId })
      .from(inventoryCounts).innerJoin(inventoryCampaigns, eq(inventoryCampaigns.id, inventoryCounts.campaignId)).where(eq(inventoryCounts.clientId, b.clientId));
    if (!k || k.entityId !== ctx.user.entityId) throw new NotFoundException("Constat inconnu : synchronisez-le avant d'envoyer ses photos");
    const filename = `constat-${k.code}-${b.photoId}.jpg`;
    return this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.entityId, ctx.user.entityId), eq(documents.filename, filename)));
      if (dup) return { id: dup.id, duplicate: true };
      const d = await storeDocument(tx, this.audit, ctx, { objectType: k.assetId ? 'BIEN' : 'INVENTAIRE', objectId: k.assetId ?? k.campaignId, category: 'PHOTO', filename, mime: file.mimetype, buffer: file.buffer });
      return { id: d.id, duplicate: false };
    });
  }

  /** Clôture de zone sur l'appareil : bilan, signature du chef d'équipe conservée en GED. */
  @Post('zones/:zoneId/cloturer') @Perm('inventory.count', 'inventory.manage')
  async closeZone(@CurrentCtx() ctx: Ctx, @Param('zoneId') zoneId: string, @Body() body: unknown) {
    const b = parse(z.object({ signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'signature attendue au format PNG').max(2_000_000), pending: z.coerce.number().int().min(0).default(0) }), body);
    if (b.pending > 0) throw new BadRequestException(`${b.pending} constat(s) restent à synchroniser avant la clôture`);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select({ z: inventoryZones, c: inventoryCampaigns }).from(inventoryZones).innerJoin(inventoryCampaigns, eq(inventoryCampaigns.id, inventoryZones.campaignId))
        .where(and(eq(inventoryZones.id, parse(zId, zoneId)), eq(inventoryCampaigns.entityId, ctx.user.entityId)));
      if (!r) throw new NotFoundException('Zone introuvable');
      if (r.z.leaderId !== ctx.user.id && !can(ctx.user.role, 'inventory.manage')) throw new BadRequestException("Seul le chef d'équipe de la zone peut la clôturer");
      if (r.z.status === 'TERMINEE') return { ok: true, already: true };
      const buffer = Buffer.from(b.signature.split(',')[1], 'base64');
      await storeDocument(tx, this.audit, ctx, { objectType: 'INVENTAIRE', objectId: r.c.id, category: 'PV', filename: `signature-zone-${r.z.id}-${ctx.user.fullName.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`, mime: 'image/png', buffer });
      await tx.update(inventoryZones).set({ status: 'TERMINEE' }).where(eq(inventoryZones.id, r.z.id));
      const [{ n }] = await tx.select({ n: count() }).from(inventoryCounts).where(eq(inventoryCounts.zoneId, r.z.id));
      await this.audit.log(tx, ctx, 'CLOTURE_ZONE', 'INVENTAIRE', r.c.number, { zone: r.z.id, depuis: 'application mobile', constats: Number(n) });
      return { ok: true, already: false };
    });
  }
}
