import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assets, categories, locations, orgUnits, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z, zId, zMoney } from '../../common/validation';
import { ROLE_LABELS, ROLE_PERMISSIONS, PERMISSIONS } from '../../common/permissions';

/** Identifiants des localisations d'un sous-arbre (racine incluse). */
export async function locationSubtree(tx: Tx, rootIds: number[]): Promise<number[]> {
  if (!rootIds.length) return [];
  const res = await tx.execute(sql`
    WITH RECURSIVE t AS (SELECT id FROM locations WHERE id IN (${sql.join(rootIds.map((i) => sql`${i}`), sql`, `)})
      UNION SELECT l.id FROM locations l JOIN t ON l.parent_id = t.id)
    SELECT id FROM t`);
  return (res.rows as { id: number }[]).map((r) => Number(r.id));
}

/** Chemin lisible d'une localisation : « Abidjan siège › Tour B › 3e étage › Bureau 305 ». */
export async function locationPaths(tx: Tx, entityId: number): Promise<Map<number, string>> {
  const rows = await tx.select().from(locations).where(eq(locations.entityId, entityId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<number, string>();
  for (const r of rows) {
    const parts: string[] = [];
    let cur: typeof r | undefined = r;
    while (cur) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    out.set(r.id, parts.join(' › '));
  }
  return out;
}

const catSchema = z.object({
  parentId: zId.nullable().optional(), code: z.string().min(1).max(20), label: z.string().min(2), prefix: z.string().max(6).nullable().optional(),
  assetAccount: z.string().max(12).nullable().optional(), deprAccount: z.string().max(12).nullable().optional(), expenseAccount: z.string().max(12).nullable().optional(),
  method: z.enum(['LINEAIRE', 'DEGRESSIF', 'NON_AMORTISSABLE']), durationYears: z.coerce.number().int().min(0).max(100), threshold: zMoney.default(0), active: z.boolean().default(true),
});

@Controller('referentiels')
export class ReferentialsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  @Get('categories')
  async categories(@CurrentCtx() ctx: Ctx) {
    const counts = await this.db.select({ categoryId: assets.categoryId, n: count() }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`)).groupBy(assets.categoryId);
    const m = new Map(counts.map((c) => [c.categoryId, Number(c.n)]));
    const rows = await this.db.select().from(categories).where(eq(categories.entityId, ctx.user.entityId)).orderBy(asc(categories.code));
    return rows.map((r) => ({ ...r, assetCount: m.get(r.id) ?? 0 }));
  }

  @Post('categories') @Perm('settings.manage')
  async createCategory(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(catSchema, body);
    return this.db.transaction(async (tx) => {
      const [c] = await tx.insert(categories).values({ ...b, entityId: ctx.user.entityId }).returning();
      await this.audit.log(tx, ctx, 'CREATION', 'CATEGORIE', c.code, b);
      return c;
    });
  }

  @Patch('categories/:id') @Perm('settings.manage')
  async updateCategory(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(catSchema.partial(), body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(categories).where(and(eq(categories.id, parse(zId, id)), eq(categories.entityId, ctx.user.entityId)));
      if (!before) throw new NotFoundException('Catégorie introuvable');
      const [c] = await tx.update(categories).set(b).where(eq(categories.id, before.id)).returning();
      await this.audit.log(tx, ctx, 'MODIFICATION', 'CATEGORIE', c.code, { avant: before, apres: b });
      return c;
    });
  }

  @Get('localisations')
  async locations(@CurrentCtx() ctx: Ctx) {
    const counts = await this.db.select({ locationId: assets.locationId, n: count() }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`)).groupBy(assets.locationId);
    const m = new Map(counts.map((c) => [c.locationId, Number(c.n)]));
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const rows = await this.db.select().from(locations).where(eq(locations.entityId, ctx.user.entityId)).orderBy(asc(locations.code));
    return rows.map((r) => ({ ...r, path: paths.get(r.id), assetCount: m.get(r.id) ?? 0 }));
  }

  @Post('localisations') @Perm('settings.manage')
  async createLocation(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ parentId: zId.nullable().optional(), kind: z.enum(['SITE', 'BATIMENT', 'NIVEAU', 'LOCAL']), code: z.string().min(1).max(40), name: z.string().min(1) }), body);
    return this.db.transaction(async (tx) => {
      const [l] = await tx.insert(locations).values({ ...b, entityId: ctx.user.entityId }).returning();
      await this.audit.log(tx, ctx, 'CREATION', 'LOCALISATION', l.code, b);
      return l;
    });
  }

  @Get('structures')
  async orgUnits(@CurrentCtx() ctx: Ctx) {
    const counts = await this.db.select({ orgUnitId: assets.orgUnitId, n: count() }).from(assets).where(and(eq(assets.entityId, ctx.user.entityId), sql`${assets.status} <> 'SORTI'`)).groupBy(assets.orgUnitId);
    const m = new Map(counts.map((c) => [c.orgUnitId, Number(c.n)]));
    const rows = await this.db.select().from(orgUnits).where(eq(orgUnits.entityId, ctx.user.entityId)).orderBy(asc(orgUnits.code));
    return rows.map((r) => ({ ...r, assetCount: m.get(r.id) ?? 0 }));
  }

  @Post('structures') @Perm('settings.manage')
  async createOrgUnit(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ parentId: zId.nullable().optional(), code: z.string().min(1).max(30), name: z.string().min(2) }), body);
    return this.db.transaction(async (tx) => {
      const [o] = await tx.insert(orgUnits).values({ ...b, entityId: ctx.user.entityId }).returning();
      await this.audit.log(tx, ctx, 'CREATION', 'STRUCTURE', o.code, b);
      return o;
    });
  }

  /** Annuaire léger (choix d'un détenteur) — accessible à tous les profils connectés. */
  @Get('personnes')
  async people(@CurrentCtx() ctx: Ctx) {
    return this.db.select({ id: users.id, fullName: users.fullName, title: users.title, role: users.role, orgUnitId: users.orgUnitId })
      .from(users).where(and(eq(users.entityId, ctx.user.entityId), eq(users.active, true))).orderBy(asc(users.fullName));
  }

  @Get('utilisateurs') @Perm('users.manage', 'audit.read')
  async users(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ id: users.id, email: users.email, fullName: users.fullName, title: users.title, role: users.role, active: users.active,
      lastLoginAt: users.lastLoginAt, orgUnit: orgUnits.name, orgUnitId: users.orgUnitId })
      .from(users).leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId)).where(eq(users.entityId, ctx.user.entityId)).orderBy(asc(users.fullName));
    return rows.map((r) => ({ ...r, roleLabel: ROLE_LABELS[r.role] }));
  }

  @Get('profils')
  profiles() {
    return { permissions: PERMISSIONS, roles: Object.entries(ROLE_PERMISSIONS).map(([code, perms]) => ({ code, label: ROLE_LABELS[code as keyof typeof ROLE_LABELS], perms })) };
  }

  @Post('utilisateurs') @Perm('users.manage')
  async createUser(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ email: z.string().email(), fullName: z.string().min(2), title: z.string().optional(),
      role: z.enum(['ADMIN', 'DIRECTEUR', 'GESTIONNAIRE', 'COMPTABLE_MATIERES', 'FINANCES', 'CONTROLEUR', 'CHEF_EQUIPE', 'DETENTEUR']),
      orgUnitId: zId.nullable().optional(), password: z.string().min(10, 'au moins 10 caractères') }), body);
    return this.db.transaction(async (tx) => {
      const exists = await tx.select({ id: users.id }).from(users).where(eq(users.email, b.email.toLowerCase()));
      if (exists.length) throw new BadRequestException('Cette adresse e-mail est déjà utilisée');
      const [u] = await tx.insert(users).values({ entityId: ctx.user.entityId, email: b.email.toLowerCase(), fullName: b.fullName, title: b.title ?? null, role: b.role,
        orgUnitId: b.orgUnitId ?? null, passwordHash: await bcrypt.hash(b.password, 10) }).returning({ id: users.id, email: users.email });
      await this.audit.log(tx, ctx, 'CREATION', 'UTILISATEUR', u.email, { role: b.role });
      return u;
    });
  }

  @Patch('utilisateurs/:id') @Perm('users.manage')
  async updateUser(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ role: z.enum(['ADMIN', 'DIRECTEUR', 'GESTIONNAIRE', 'COMPTABLE_MATIERES', 'FINANCES', 'CONTROLEUR', 'CHEF_EQUIPE', 'DETENTEUR']).optional(),
      active: z.boolean().optional(), orgUnitId: zId.nullable().optional(), title: z.string().optional() }), body);
    return this.db.transaction(async (tx) => {
      const uid = parse(zId, id);
      if (uid === ctx.user.id && b.active === false) throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte');
      const [u] = await tx.update(users).set(b).where(and(eq(users.id, uid), eq(users.entityId, ctx.user.entityId))).returning({ email: users.email });
      if (!u) throw new NotFoundException('Utilisateur introuvable');
      await this.audit.log(tx, ctx, 'MODIFICATION', 'UTILISATEUR', u.email, b);
      return { ok: true };
    });
  }
}
