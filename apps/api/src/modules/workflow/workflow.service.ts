import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { approvals, users, workflowCircuits, workflowCircuitSteps } from '../../db/schema';
import { CIRCUIT_TYPES, StepModel, variantOf } from './circuits';
import { InjectDb } from '../../common/db.module';
import { AuditService } from '../../common/audit.service';
import { NotifyService } from '../../common/notify.service';
import type { Ctx } from '../../common/context';
import type { Role } from '../../common/permissions';

export interface StepDef { label: string; role?: Role; userId?: number; days?: number }
export interface Handler {
  /** Créateur de l'objet (séparation des tâches) et résumé affiché dans la boîte de validation. */
  describe(tx: Tx, id: number): Promise<{ number: string; title: string; subtitle: string; requestedBy: number; link: string }>;
  onApproved(tx: Tx, ctx: Ctx, id: number): Promise<void>;
  onRejected(tx: Tx, ctx: Ctx, id: number, comment: string): Promise<void>;
  onStepApproved?(tx: Tx, ctx: Ctx, id: number, step: number): Promise<void>;
}

/** Circuits de validation : étapes successives, chacune par profil ou par personne nommée. */
@Injectable()
export class WorkflowService {
  private handlers = new Map<string, Handler>();
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly notify: NotifyService) {}

  register(type: string, h: Handler) { this.handlers.set(type, h); }
  private handler(type: string) {
    const h = this.handlers.get(type);
    if (!h) throw new Error(`Circuit inconnu : ${type}`);
    return h;
  }

  /** Modèle applicable : circuit paramétré et actif de l'entité, sinon circuit réglementaire intégré. */
  async model(tx: Tx, entityId: number, type: string, variant: string): Promise<{ configured: boolean; version: number; steps: StepModel[] }> {
    const v = variantOf(type, variant);
    const [c] = await tx.select().from(workflowCircuits).where(and(eq(workflowCircuits.entityId, entityId), eq(workflowCircuits.type, type), eq(workflowCircuits.variant, v)));
    if (c?.active) {
      const steps = await tx.select().from(workflowCircuitSteps).where(eq(workflowCircuitSteps.circuitId, c.id)).orderBy(asc(workflowCircuitSteps.position));
      if (steps.length) return { configured: true, version: c.version, steps: steps.map((s) => ({ label: s.label, assignee: s.assignee as StepModel['assignee'], role: s.role, userId: s.userId, days: s.days, minAmount: s.minAmount })) };
    }
    return { configured: false, version: 0, steps: CIRCUIT_TYPES[type].defaults[v] };
  }

  /** Étapes effectives d'une pièce : conditions de montant appliquées, bénéficiaire résolu. */
  resolve(models: StepModel[], c: { amount?: number; beneficiaryId?: number | null; requesterId?: number }): StepDef[] {
    const out: StepDef[] = [];
    for (const m of models) {
      if (m.minAmount != null && (c.amount ?? 0) <= m.minAmount) continue;
      if (m.assignee === 'BENEFICIAIRE') { if (c.beneficiaryId) out.push({ label: m.label, userId: c.beneficiaryId, days: m.days }); continue; }
      if (m.assignee === 'USER') {
        if (m.userId === c.requesterId) throw new BadRequestException(`Séparation des tâches : l'étape « ${m.label} » désigne l'auteur de la pièce ; faites corriger le circuit par l'administrateur`);
        out.push({ label: m.label, userId: m.userId!, days: m.days });
      } else out.push({ label: m.label, role: m.role!, days: m.days });
    }
    if (!out.length) throw new BadRequestException('Le circuit de validation applicable ne comporte aucune étape pour cette pièce');
    return out;
  }

  /** Lance le circuit paramétré (ou intégré) d'une pièce. */
  async submit(tx: Tx, entityId: number, type: string, variant: string, id: number, c: { amount?: number; beneficiaryId?: number | null; requesterId: number }) {
    const m = await this.model(tx, entityId, type, variant);
    const steps = this.resolve(m.steps, c);
    await this.start(tx, entityId, type, id, steps);
    return steps;
  }

  async start(tx: Tx, entityId: number, type: string, id: number, steps: StepDef[]) {
    if (!steps.length) throw new Error('Circuit vide');
    const now = Date.now();
    await tx.insert(approvals).values(steps.map((s, i) => ({
      entityId, objectType: type, objectId: id, step: i + 1, label: s.label, role: s.role ?? null, userId: s.userId ?? null,
      status: i === 0 ? 'EN_COURS' : 'ATTENTE', days: s.days ?? 3, dueAt: i === 0 ? new Date(now + (s.days ?? 3) * 86400000) : null,
    })));
    await this.notifyStep(tx, entityId, type, id, steps[0]);
  }

  private async notifyStep(tx: Tx, entityId: number, type: string, id: number, s: { role?: Role | null; userId?: number | null; label: string }) {
    const d = await this.handler(type).describe(tx, id);
    const n = { kind: 'warn', title: 'Validation demandée', body: `${d.number} · ${d.title} : étape « ${s.label} »`, link: '/validations' };
    if (s.userId) await this.notify.toUsers(tx, [s.userId], n);
    else if (s.role) await this.notify.toRole(tx, entityId, s.role, n);
  }

  async steps(tx: Tx, type: string, id: number) {
    return tx.select({ id: approvals.id, step: approvals.step, label: approvals.label, role: approvals.role, userId: approvals.userId, status: approvals.status,
      decidedAt: approvals.decidedAt, comment: approvals.comment, decidedBy: users.fullName, dueAt: approvals.dueAt })
      .from(approvals).leftJoin(users, eq(users.id, approvals.decidedBy))
      .where(and(eq(approvals.objectType, type), eq(approvals.objectId, id))).orderBy(asc(approvals.step));
  }

  /** Étapes en cours que l'utilisateur peut traiter. */
  async inbox(ctx: Ctx) {
    const rows = await this.db.select().from(approvals).where(and(eq(approvals.entityId, ctx.user.entityId), eq(approvals.status, 'EN_COURS'),
      ctx.user.role === 'ADMIN' ? undefined : or(eq(approvals.role, ctx.user.role), eq(approvals.userId, ctx.user.id)))).orderBy(asc(approvals.dueAt));
    return this.decorate(rows);
  }

  async history(ctx: Ctx) {
    const rows = await this.db.select().from(approvals).where(and(eq(approvals.entityId, ctx.user.entityId), eq(approvals.decidedBy, ctx.user.id)))
      .orderBy(desc(approvals.decidedAt)).limit(100);
    return this.decorate(rows);
  }

  private async decorate(rows: (typeof approvals.$inferSelect)[]) {
    const out = [];
    for (const r of rows) {
      const d = await this.handler(r.objectType).describe(this.db, r.objectId);
      const [req] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, d.requestedBy));
      const total = await this.db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.objectType, r.objectType), eq(approvals.objectId, r.objectId)));
      out.push({ ...r, ...d, requestedByName: req?.fullName, totalSteps: total.length, late: r.dueAt ? r.dueAt.getTime() < Date.now() && r.status === 'EN_COURS' : false });
    }
    return out;
  }

  canAct(ctx: Ctx, a: typeof approvals.$inferSelect) {
    if (a.userId) return a.userId === ctx.user.id;
    return ctx.user.role === 'ADMIN' || a.role === ctx.user.role;
  }

  async decide(ctx: Ctx, approvalId: number, approve: boolean, comment?: string) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(approvals).where(and(eq(approvals.id, approvalId), eq(approvals.entityId, ctx.user.entityId))).for('update');
      if (!a) throw new NotFoundException('Étape introuvable');
      if (a.status !== 'EN_COURS') throw new BadRequestException('Cette étape a déjà été traitée');
      if (!this.canAct(ctx, a)) throw new ForbiddenException("Cette étape ne vous est pas attribuée");
      const h = this.handler(a.objectType);
      const d = await h.describe(tx, a.objectId);
      if (!a.userId && d.requestedBy === ctx.user.id) throw new ForbiddenException('Séparation des tâches : vous ne pouvez pas valider une pièce que vous avez créée');
      if (!approve && !comment?.trim()) throw new BadRequestException('Le motif est obligatoire en cas de rejet');
      await tx.update(approvals).set({ status: approve ? 'APPROUVE' : 'REJETE', decidedBy: ctx.user.id, decidedAt: new Date(), comment: comment ?? null }).where(eq(approvals.id, a.id));
      await this.audit.log(tx, ctx, approve ? 'VALIDATION' : 'REJET', a.objectType, d.number, { etape: a.label, commentaire: comment ?? null });
      if (!approve) {
        await tx.update(approvals).set({ status: 'ANNULE' }).where(and(eq(approvals.objectType, a.objectType), eq(approvals.objectId, a.objectId), eq(approvals.status, 'ATTENTE')));
        await h.onRejected(tx, ctx, a.objectId, comment!);
        await this.notify.toUsers(tx, [d.requestedBy], { kind: 'bad', title: 'Pièce rejetée', body: `${d.number} rejetée à l'étape « ${a.label} » : ${comment}`, link: d.link });
        return { status: 'REJETE' };
      }
      if (h.onStepApproved) await h.onStepApproved(tx, ctx, a.objectId, a.step);
      const [next] = await tx.select().from(approvals).where(and(eq(approvals.objectType, a.objectType), eq(approvals.objectId, a.objectId), eq(approvals.step, a.step + 1)));
      if (next) {
        await tx.update(approvals).set({ status: 'EN_COURS', dueAt: new Date(Date.now() + next.days * 86400000) }).where(eq(approvals.id, next.id));
        await this.notifyStep(tx, a.entityId, a.objectType, a.objectId, next);
        return { status: 'EN_COURS', nextStep: next.label };
      }
      await h.onApproved(tx, ctx, a.objectId);
      await this.notify.toUsers(tx, [d.requestedBy], { kind: 'ok', title: 'Pièce validée', body: `${d.number} · ${d.title} : circuit terminé`, link: d.link });
      return { status: 'APPROUVE' };
    });
  }

  /** Annule les étapes en attente (ex. : pièce retirée par son auteur). */
  async cancel(tx: Tx, type: string, id: number) {
    await tx.update(approvals).set({ status: 'ANNULE' }).where(and(eq(approvals.objectType, type), eq(approvals.objectId, id), inArray(approvals.status, ['EN_COURS', 'ATTENTE'])));
  }
}
