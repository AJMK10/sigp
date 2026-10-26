import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { DB } from '../../db/client';
import { approvals, users, workflowCircuits, workflowCircuitSteps } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { ROLE_LABELS } from '../../common/permissions';
import { parse, z, zMoney } from '../../common/validation';
import { CIRCUIT_TYPES, StepModel } from './circuits';
import { WorkflowService } from './workflow.service';

const ROLES = ['ADMIN', 'DIRECTEUR', 'GESTIONNAIRE', 'COMPTABLE_MATIERES', 'FINANCES', 'CONTROLEUR', 'CHEF_EQUIPE'] as const;
const stepSchema = z.object({
  label: z.string().trim().min(3, 'libellé trop court').max(120),
  assignee: z.enum(['ROLE', 'USER', 'BENEFICIAIRE']),
  role: z.enum(ROLES).nullable().optional(),
  userId: z.coerce.number().int().positive().nullable().optional(),
  days: z.coerce.number().int().min(1).max(60).default(3),
  minAmount: zMoney.nullable().optional(),
});

/** Paramétrage des circuits de validation : chaque entité adapte les circuits intégrés à son organisation. */
@Controller('circuits')
export class CircuitsController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly wf: WorkflowService) {}

  private key(type: string, variant: string) {
    const t = CIRCUIT_TYPES[type];
    if (!t || !t.variants[variant]) throw new NotFoundException('Circuit inconnu');
    return t;
  }

  @Get() @Perm('settings.manage', 'audit.read')
  async list(@CurrentCtx() ctx: Ctx) {
    const eid = ctx.user.entityId;
    const conf = await this.db.select({ c: workflowCircuits, by: users.fullName }).from(workflowCircuits).leftJoin(users, eq(users.id, workflowCircuits.updatedBy)).where(eq(workflowCircuits.entityId, eid));
    const pending = await this.db.select({ t: approvals.objectType, n: count() }).from(approvals).where(and(eq(approvals.entityId, eid), inArray(approvals.status, ['EN_COURS']))).groupBy(approvals.objectType);
    const people = await this.db.select({ id: users.id, n: users.fullName }).from(users).where(eq(users.entityId, eid));
    const names = new Map(people.map((p) => [p.id, p.n]));
    const out = [];
    for (const [type, t] of Object.entries(CIRCUIT_TYPES)) {
      for (const [variant, vLabel] of Object.entries(t.variants)) {
        const c = conf.find((x) => x.c.type === type && x.c.variant === variant);
        const m = await this.wf.model(this.db, eid, type, variant);
        out.push({
          type, variant, typeLabel: t.label, variantLabel: vLabel, amountLabel: t.amountLabel, beneficiaryLabel: t.beneficiaryLabel ?? null,
          configured: m.configured, exists: !!c, active: c?.c.active ?? false, version: c?.c.version ?? 0, updatedAt: c?.c.updatedAt ?? null, updatedBy: c?.by ?? null,
          pending: Number(pending.find((p) => p.t === type)?.n ?? 0),
          steps: m.steps.map((s) => ({ ...s, userName: s.userId ? names.get(s.userId) ?? null : null, roleLabel: s.role ? ROLE_LABELS[s.role] : null })),
          defaults: t.defaults[variant],
        });
      }
    }
    return out;
  }

  /** Enregistre le circuit paramétré : il s'appliquera aux pièces soumises à partir de maintenant. */
  @Put(':type/:variant') @Perm('settings.manage')
  async save(@CurrentCtx() ctx: Ctx, @Param('type') type: string, @Param('variant') variant: string, @Body() body: unknown) {
    const t = this.key(type, variant);
    const b = parse(z.object({ active: z.boolean().default(true), steps: z.array(stepSchema).min(1, 'au moins une étape').max(10, 'dix étapes au plus') }), body);
    const eid = ctx.user.entityId;
    const userIds = b.steps.filter((s) => s.assignee === 'USER').map((s) => s.userId).filter((x): x is number => !!x);
    const valid = userIds.length ? await this.db.select({ id: users.id }).from(users).where(and(eq(users.entityId, eid), eq(users.active, true), inArray(users.id, userIds))) : [];
    b.steps.forEach((s, i) => {
      const n = `Étape ${i + 1}`;
      if (s.assignee === 'ROLE' && !s.role) throw new BadRequestException(`${n} : choisissez le profil valideur`);
      if (s.assignee === 'USER' && (!s.userId || !valid.some((v) => v.id === s.userId))) throw new BadRequestException(`${n} : choisissez un utilisateur actif de l'entité`);
      if (s.assignee === 'BENEFICIAIRE' && !t.beneficiaryLabel) throw new BadRequestException(`${n} : ce type de pièce n'a pas de bénéficiaire`);
    });
    if (!b.steps.some((s) => s.assignee !== 'BENEFICIAIRE' && s.minAmount == null))
      throw new BadRequestException('Contrôle interne : le circuit doit comporter au moins une étape de validation systématique (sans seuil et confiée à un profil ou à une personne)');
    return this.db.transaction(async (tx) => {
      const before = await this.wf.model(tx, eid, type, variant);
      const [existing] = await tx.select().from(workflowCircuits).where(and(eq(workflowCircuits.entityId, eid), eq(workflowCircuits.type, type), eq(workflowCircuits.variant, variant))).for('update');
      let id: number, version: number;
      if (existing) {
        version = existing.version + 1; id = existing.id;
        await tx.update(workflowCircuits).set({ active: b.active, version, updatedBy: ctx.user.id, updatedAt: new Date() }).where(eq(workflowCircuits.id, id));
        await tx.delete(workflowCircuitSteps).where(eq(workflowCircuitSteps.circuitId, id));
      } else {
        version = 1;
        [{ id }] = await tx.insert(workflowCircuits).values({ entityId: eid, type, variant, active: b.active, version, updatedBy: ctx.user.id }).returning({ id: workflowCircuits.id });
      }
      await tx.insert(workflowCircuitSteps).values(b.steps.map((s, i) => ({ circuitId: id, position: i + 1, label: s.label, assignee: s.assignee,
        role: s.assignee === 'ROLE' ? s.role! : null, userId: s.assignee === 'USER' ? s.userId! : null, days: s.days, minAmount: s.minAmount ?? null })));
      await this.audit.log(tx, ctx, 'PARAMETRAGE', 'CIRCUIT', `${type}/${variant}`, {
        version, actif: b.active, avant: before.steps.map(describe), apres: b.steps.map((s) => describe(s as StepModel)) });
      return { ok: true, version };
    });
  }

  /** Revient au circuit réglementaire intégré. */
  @Delete(':type/:variant') @Perm('settings.manage')
  async reset(@CurrentCtx() ctx: Ctx, @Param('type') type: string, @Param('variant') variant: string) {
    this.key(type, variant);
    return this.db.transaction(async (tx) => {
      const before = await this.wf.model(tx, ctx.user.entityId, type, variant);
      await tx.delete(workflowCircuits).where(and(eq(workflowCircuits.entityId, ctx.user.entityId), eq(workflowCircuits.type, type), eq(workflowCircuits.variant, variant)));
      await this.audit.log(tx, ctx, 'PARAMETRAGE', 'CIRCUIT', `${type}/${variant}`, { retour: 'circuit intégré', avant: before.steps.map(describe) });
      return { ok: true };
    });
  }

  /** Simulation : étapes qu'aurait une pièce d'un montant donné, avec ou sans bénéficiaire. */
  @Post(':type/:variant/simuler') @Perm('settings.manage', 'audit.read')
  async simulate(@CurrentCtx() ctx: Ctx, @Param('type') type: string, @Param('variant') variant: string, @Body() body: unknown) {
    this.key(type, variant);
    const b = parse(z.object({ amount: zMoney.default(0), beneficiary: z.boolean().default(true), steps: z.array(stepSchema).max(10).optional() }), body);
    const models = (b.steps as StepModel[] | undefined) ?? (await this.wf.model(this.db, ctx.user.entityId, type, variant)).steps;
    try {
      const steps = this.wf.resolve(models, { amount: b.amount, beneficiaryId: b.beneficiary ? -1 : null, requesterId: 0 });
      const people = await this.db.select({ id: users.id, n: users.fullName }).from(users).where(eq(users.entityId, ctx.user.entityId)).orderBy(asc(users.id));
      return { ok: true, steps: steps.map((s) => ({ label: s.label, who: s.userId === -1 ? 'Bénéficiaire de la pièce' : s.userId ? people.find((p) => p.id === s.userId)?.n ?? '—' : ROLE_LABELS[s.role!], days: s.days })) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), steps: [] };
    }
  }
}

function describe(s: StepModel) {
  const who = s.assignee === 'BENEFICIAIRE' ? 'bénéficiaire' : s.assignee === 'USER' ? `utilisateur ${s.userId}` : s.role;
  return `${s.label} (${who}, ${s.days} j${s.minAmount != null ? `, au-delà de ${s.minAmount}` : ''})`;
}
