import { BadRequestException, Body, Controller, Get, NotFoundException, OnModuleInit, Param, Post } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assetEvents, assets, categories, depreciationRuns, revaluationItems, revaluations, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { WorkflowService } from '../workflow/workflow.service';
import { JournalService } from '../journal/journal.service';
import { cumulativeAt, endOfMonth } from '../depreciation/engine';
import { deprInput, today, valuesAt } from '../assets/assets.util';

export const REVAL_LABELS: Record<string, string> = { REVISION_DUREE: "Révision de la durée d'utilité", DEPRECIATION: 'Dépréciation', REPRISE_DEPRECIATION: 'Reprise de dépréciation' };
const PREFIX: Record<string, string> = { REVISION_DUREE: 'RVD', DEPRECIATION: 'DEP', REPRISE_DEPRECIATION: 'RDP' };
const dayBefore = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const impairmentAccount = (deprAccount: string | null) => (deprAccount ? '29' + deprAccount.slice(2) : '2940');

/** Opérations qui modifient la valeur ou le plan d'amortissement : changement d'estimation (prospectif) ou dépréciation. */
@Controller('revisions')
export class RevaluationController implements OnModuleInit {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService,
    private readonly wf: WorkflowService, private readonly journal: JournalService) {}

  onModuleInit() {
    this.wf.register('REVISION', {
      describe: async (tx, id) => {
        const [r] = await tx.select().from(revaluations).where(eq(revaluations.id, id));
        const items = await tx.select().from(revaluationItems).where(eq(revaluationItems.revaluationId, id));
        const sub = r.kind === 'REVISION_DUREE' ? `Nouvelle durée ${r.newYears} ans · impact annuel ${(items.reduce((s, i) => s + i.annualAfter - i.annualBefore, 0)).toLocaleString('fr-FR')} FCFA`
          : `${items.reduce((s, i) => s + i.amount, 0).toLocaleString('fr-FR')} FCFA`;
        return { number: r.number, title: `${REVAL_LABELS[r.kind]} · ${r.title} (${items.length} bien(s))`, subtitle: sub, requestedBy: r.createdBy, link: `/revisions/${id}` };
      },
      onApproved: (tx, ctx, id) => this.apply(tx, ctx, id),
      onRejected: async (tx, _c, id) => { await tx.update(revaluations).set({ status: 'REJETE' }).where(eq(revaluations.id, id)); },
    });
  }

  /** Les changements d'estimation ne s'appliquent qu'aux périodes non encore comptabilisées. */
  private async firstOpenDate(tx: Tx, entityId: number) {
    const [last] = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, entityId), eq(depreciationRuns.mode, 'DEFINITIF'))).orderBy(desc(depreciationRuns.period)).limit(1);
    if (!last) return null;
    const end = endOfMonth(last.period);
    const x = new Date(`${end}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10);
  }

  @Get() @Perm('depreciation.read', 'revaluation.write')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ r: revaluations, author: users.fullName }).from(revaluations).leftJoin(users, eq(users.id, revaluations.createdBy))
      .where(eq(revaluations.entityId, ctx.user.entityId)).orderBy(desc(revaluations.id));
    const items = rows.length ? await this.db.select().from(revaluationItems).where(inArray(revaluationItems.revaluationId, rows.map((r) => r.r.id))) : [];
    return rows.map(({ r, author }) => { const it = items.filter((i) => i.revaluationId === r.id); return { ...r, author, kindLabel: REVAL_LABELS[r.kind], count: it.length,
      amount: it.reduce((s, i) => s + i.amount, 0), annualImpact: it.reduce((s, i) => s + i.annualAfter - i.annualBefore, 0) }; });
  }

  @Get(':id') @Perm('depreciation.read', 'revaluation.write')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [r] = await this.db.select().from(revaluations).where(and(eq(revaluations.id, parse(zId, id)), eq(revaluations.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Opération introuvable');
    const items = await this.db.select({ i: revaluationItems, a: assets }).from(revaluationItems).innerJoin(assets, eq(assets.id, revaluationItems.assetId)).where(eq(revaluationItems.revaluationId, r.id));
    const [author] = await this.db.select({ n: users.fullName }).from(users).where(eq(users.id, r.createdBy));
    return { ...r, author: author?.n, kindLabel: REVAL_LABELS[r.kind], steps: await this.wf.steps(this.db, 'REVISION', r.id),
      items: items.map(({ i, a }) => ({ ...i, code: a.code, designation: a.designation, value: a.acquisitionValue, deprYears: a.deprYears, ...valuesAt(a) })) };
  }

  @Post() @Perm('revaluation.write')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ kind: z.enum(['REVISION_DUREE', 'DEPRECIATION', 'REPRISE_DEPRECIATION']), title: z.string().min(3), reason: z.string().min(10, 'motivez l\'opération (expertise, indice de perte de valeur…)'),
      effectiveDate: zDate, newYears: z.coerce.number().int().min(1).max(100).optional(), items: z.array(z.object({ assetId: zId, amount: zMoney.default(0) })).min(1).max(1000) }), body);
    if (b.kind === 'REVISION_DUREE' && !b.newYears) throw new BadRequestException('Indiquez la nouvelle durée totale');
    return this.db.transaction(async (tx) => {
      const open = await this.firstOpenDate(tx, ctx.user.entityId);
      if (b.kind === 'REVISION_DUREE' && open && b.effectiveDate < open) throw new BadRequestException(`Changement d'estimation prospectif : la date d'effet doit être postérieure à la dernière période comptabilisée (au plus tôt le ${open})`);
      if (b.effectiveDate > today() && b.kind !== 'REVISION_DUREE') throw new BadRequestException('Date d\'effet future');
      const list = await tx.select().from(assets).where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.id, b.items.map((i) => i.assetId))));
      if (list.length !== b.items.length) throw new BadRequestException('Bien introuvable');
      const rows = b.items.map((it) => {
        const a = list.find((x) => x.id === it.assetId)!;
        if (a.status === 'SORTI') throw new BadRequestException(`${a.code} est sorti du patrimoine`);
        const v = valuesAt(a, b.effectiveDate);
        if (b.kind === 'DEPRECIATION' && (it.amount <= 0 || it.amount > v.nbv)) throw new BadRequestException(`${a.code} : la dépréciation doit être positive et au plus égale à la VNC (${v.nbv.toLocaleString('fr-FR')})`);
        if (b.kind === 'REPRISE_DEPRECIATION' && (it.amount <= 0 || it.amount > a.impairment)) throw new BadRequestException(`${a.code} : reprise limitée à la dépréciation constatée (${a.impairment.toLocaleString('fr-FR')})`);
        let annualBefore = 0, annualAfter = 0;
        if (b.kind === 'REVISION_DUREE') {
          if (!a.inServiceDate) throw new BadRequestException(`${a.code} n'est pas mis en service`);
          const y = Number(b.effectiveDate.slice(0, 4)) + 1;
          annualBefore = cumulativeAt(deprInput(a), `${y}-12-31`) - cumulativeAt(deprInput(a), `${y - 1}-12-31`);
          const cum = cumulativeAt(deprInput(a), dayBefore(b.effectiveDate));
          const revised = { ...deprInput(a), years: b.newYears!, revision: { date: b.effectiveDate, cumulative: cum, previousYears: a.deprYears } };
          annualAfter = cumulativeAt(revised, `${y}-12-31`) - cumulativeAt(revised, `${y - 1}-12-31`);
          const elapsedYears = (new Date(b.effectiveDate).getTime() - new Date(a.inServiceDate).getTime()) / (365.25 * 86400000);
          if (b.newYears! <= elapsedYears) throw new BadRequestException(`${a.code} : la nouvelle durée (${b.newYears} ans) est déjà écoulée`);
        }
        return { assetId: a.id, amount: it.amount, annualBefore, annualAfter };
      });
      const number = await this.numbering.piece(tx, ctx.user.entityId, PREFIX[b.kind]);
      const [r] = await tx.insert(revaluations).values({ entityId: ctx.user.entityId, number, kind: b.kind, title: b.title, reason: b.reason, effectiveDate: b.effectiveDate, newYears: b.newYears ?? null, createdBy: ctx.user.id }).returning();
      await tx.insert(revaluationItems).values(rows.map((x) => ({ ...x, revaluationId: r.id })));
      await this.audit.log(tx, ctx, 'CREATION', 'REVISION', number, { type: b.kind, biens: rows.length });
      return r;
    });
  }

  @Post(':id/soumettre') @Perm('revaluation.write')
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(revaluations).where(and(eq(revaluations.id, parse(zId, id)), eq(revaluations.entityId, ctx.user.entityId)));
      if (!r) throw new NotFoundException('Opération introuvable');
      if (!['BROUILLON', 'REJETE'].includes(r.status)) throw new BadRequestException('Opération déjà soumise');
      await tx.update(revaluations).set({ status: 'EN_COURS' }).where(eq(revaluations.id, r.id));
      await this.wf.start(tx, ctx.user.entityId, 'REVISION', r.id, [{ label: 'Analyse de la direction financière', role: 'FINANCES', days: 5 }, { label: 'Validation du directeur du patrimoine', role: 'DIRECTEUR', days: 5 }]);
      await this.audit.log(tx, ctx, 'SOUMISSION', 'REVISION', r.number, {});
      return { ok: true };
    });
  }

  private async apply(tx: Tx, ctx: Ctx, id: number) {
    const [r] = await tx.select().from(revaluations).where(eq(revaluations.id, id));
    const items = await tx.select({ i: revaluationItems, a: assets, c: categories }).from(revaluationItems).innerJoin(assets, eq(assets.id, revaluationItems.assetId))
      .innerJoin(categories, eq(categories.id, assets.categoryId)).where(eq(revaluationItems.revaluationId, id));
    const lines: { account: string; label: string; debit?: number; credit?: number }[] = [];
    for (const { i, a, c } of items) {
      if (r.kind === 'REVISION_DUREE') {
        const cum = cumulativeAt(deprInput(a), dayBefore(r.effectiveDate));
        await tx.update(assets).set({ revisedAt: r.effectiveDate, revisedCumulative: cum, previousYears: a.deprYears, deprYears: r.newYears!, updatedAt: new Date() }).where(eq(assets.id, a.id));
        await tx.insert(assetEvents).values({ assetId: a.id, type: 'REVISION', documentNo: r.number, summary: `Durée révisée de ${a.deprYears} à ${r.newYears} ans à compter du ${r.effectiveDate}`, actorId: ctx.user.id });
      } else {
        const sign = r.kind === 'DEPRECIATION' ? 1 : -1;
        await tx.update(assets).set({ impairment: a.impairment + sign * i.amount, updatedAt: new Date() }).where(eq(assets.id, a.id));
        const acc = impairmentAccount(c.deprAccount);
        if (sign > 0) { lines.push({ account: '6914', label: 'Dotations aux dépréciations des immobilisations', debit: i.amount }); lines.push({ account: acc, label: 'Dépréciation des immobilisations', credit: i.amount }); }
        else { lines.push({ account: acc, label: 'Dépréciation des immobilisations', debit: i.amount }); lines.push({ account: '7914', label: 'Reprises de dépréciations', credit: i.amount }); }
        await tx.insert(assetEvents).values({ assetId: a.id, type: 'DEPRECIATION', documentNo: r.number, summary: `${REVAL_LABELS[r.kind]} de ${i.amount.toLocaleString('fr-FR')} FCFA`, actorId: ctx.user.id });
      }
    }
    if (lines.length) {
      const merged = new Map<string, { account: string; label: string; debit: number; credit: number }>();
      for (const l of lines) { const k = `${l.account}`; const x = merged.get(k) ?? { account: l.account, label: l.label, debit: 0, credit: 0 }; x.debit += l.debit ?? 0; x.credit += l.credit ?? 0; merged.set(k, x); }
      await this.journal.createBatch(tx, ctx, { originType: 'REVISION', originRef: r.number, label: `${REVAL_LABELS[r.kind]} ${r.number}`, date: r.effectiveDate, lines: [...merged.values()] });
    }
    await tx.update(revaluations).set({ status: 'APPLIQUE', appliedAt: new Date() }).where(eq(revaluations.id, id));
    await this.audit.log(tx, ctx, 'APPLICATION', 'REVISION', r.number, { biens: items.length });
  }
}
