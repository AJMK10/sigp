import { BadRequestException, Body, Controller, Get, NotFoundException, OnModuleInit, Param, Patch, Post } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assetEvents, assets, categories, disposalItems, disposals, movementItems, movements, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { WorkflowService } from '../workflow/workflow.service';
import { JournalService } from '../journal/journal.service';
import { cumulativeAt } from '../depreciation/engine';
import { deprInput, today, valuesAt } from '../assets/assets.util';

export const EXIT_MODES: Record<string, string> = { VENTE: 'Vente aux enchères', DESTRUCTION: 'Destruction', DON: 'Don ou cession gratuite', RECYCLAGE: 'Recyclage DEEE', PERTE: 'Perte ou vol constaté' };
const itemsSchema = z.array(z.object({ assetId: zId, motive: z.string().min(2) })).min(1, 'au moins un bien');

@Controller('reformes')
export class DisposalsController implements OnModuleInit {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService,
    private readonly wf: WorkflowService, private readonly journal: JournalService) {}

  onModuleInit() {
    this.wf.register('REFORME', {
      describe: async (tx, id) => {
        const [d] = await tx.select().from(disposals).where(eq(disposals.id, id));
        const items = await tx.select().from(disposalItems).where(eq(disposalItems.disposalId, id));
        const nbv = items.reduce((s, i) => s + i.nbvAtProposal, 0);
        return { number: d.number, title: `Réforme de ${items.length} bien(s) · ${d.title}`, subtitle: `${EXIT_MODES[d.exitMode]} · VNC ${nbv.toLocaleString('fr-FR')} FCFA`, requestedBy: d.createdBy, link: `/reformes/${id}` };
      },
      onStepApproved: async (tx, _ctx, id, step) => { if (step === 2) await tx.update(disposals).set({ commissionDate: sql`coalesce(${disposals.commissionDate}, ${today()}::date)` }).where(eq(disposals.id, id)); },
      onApproved: async (tx, _ctx, id) => { await tx.update(disposals).set({ status: 'APPROUVE' }).where(eq(disposals.id, id)); },
      onRejected: async (tx, ctx, id) => {
        await tx.update(disposals).set({ status: 'REJETE' }).where(eq(disposals.id, id));
        const items = await tx.select().from(disposalItems).where(eq(disposalItems.disposalId, id));
        for (const i of items) await tx.update(assets).set({ status: i.previousStatus }).where(eq(assets.id, i.assetId));
        if (items.length) await tx.insert(assetEvents).values(items.map((i) => ({ assetId: i.assetId, type: 'REFORME', summary: 'Proposition de réforme rejetée : statut rétabli', actorId: ctx.user.id })));
      },
    });
  }

  private async load(tx: Tx, ctx: Ctx, id: string | number) {
    const [d] = await tx.select().from(disposals).where(and(eq(disposals.id, Number(id)), eq(disposals.entityId, ctx.user.entityId)));
    if (!d) throw new NotFoundException('Dossier introuvable');
    return d;
  }

  private async checkAssets(tx: Tx, ctx: Ctx, ids: number[], exceptDisposal?: number) {
    const list = await tx.select().from(assets).where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.id, ids)));
    if (list.length !== new Set(ids).size) throw new BadRequestException('Bien introuvable');
    const out = list.filter((a) => a.status === 'SORTI' || a.status === 'EN_TRANSIT');
    if (out.length) throw new BadRequestException(`Bien non éligible : ${out[0].code} (${out[0].status.toLowerCase()})`);
    const other = await tx.select({ code: assets.code, n: disposals.number }).from(disposalItems).innerJoin(disposals, eq(disposals.id, disposalItems.disposalId)).innerJoin(assets, eq(assets.id, disposalItems.assetId))
      .where(and(inArray(disposalItems.assetId, ids), inArray(disposals.status, ['BROUILLON', 'EN_COURS', 'APPROUVE']), exceptDisposal ? sql`${disposals.id} <> ${exceptDisposal}` : undefined));
    if (other.length) throw new BadRequestException(`${other[0].code} figure déjà dans le dossier ${other[0].n}`);
    const mv = await tx.select({ code: assets.code }).from(movementItems).innerJoin(movements, eq(movements.id, movementItems.movementId)).innerJoin(assets, eq(assets.id, movementItems.assetId))
      .where(and(inArray(movementItems.assetId, ids), inArray(movements.status, ['A_VALIDER', 'EN_TRANSIT'])));
    if (mv.length) throw new BadRequestException(`${mv[0].code} est engagé dans un mouvement en cours`);
    return list;
  }

  @Get() @Perm('disposals.write', 'disposals.validate')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ d: disposals, author: users.fullName, n: sql<number>`(select count(*) from disposal_items i where i.disposal_id = ${disposals.id})`,
      nbv: sql<string>`(select coalesce(sum(nbv_at_proposal),0) from disposal_items i where i.disposal_id = ${disposals.id})` })
      .from(disposals).leftJoin(users, eq(users.id, disposals.createdBy)).where(eq(disposals.entityId, ctx.user.entityId)).orderBy(desc(disposals.id));
    return rows.map((r) => ({ ...r.d, author: r.author, count: Number(r.n), nbv: Number(r.nbv), exitModeLabel: EXIT_MODES[r.d.exitMode] }));
  }

  @Get(':id') @Perm('disposals.write', 'disposals.validate')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const d = await this.load(this.db, ctx, parse(zId, id));
    const items = await this.db.select({ i: disposalItems, a: assets, cat: categories.label }).from(disposalItems).innerJoin(assets, eq(assets.id, disposalItems.assetId))
      .innerJoin(categories, eq(categories.id, assets.categoryId)).where(eq(disposalItems.disposalId, d.id)).orderBy(assets.code);
    const [author] = await this.db.select({ n: users.fullName }).from(users).where(eq(users.id, d.createdBy));
    return {
      ...d, author: author?.n, exitModeLabel: EXIT_MODES[d.exitMode], steps: await this.wf.steps(this.db, 'REFORME', d.id),
      items: items.map(({ i, a, cat }) => ({ assetId: a.id, code: a.code, designation: a.designation, category: cat, condition: a.condition, motive: i.motive, value: a.acquisitionValue, nbvAtProposal: i.nbvAtProposal, nbvToday: valuesAt(a).nbv })),
      totals: { value: items.reduce((s, x) => s + x.a.acquisitionValue, 0), nbv: items.reduce((s, x) => s + x.i.nbvAtProposal, 0) },
    };
  }

  @Post() @Perm('disposals.write')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ title: z.string().min(3), exitMode: z.enum(['VENTE', 'DESTRUCTION', 'DON', 'RECYCLAGE', 'PERTE']), reason: z.string().optional(), commissionDate: zDate.nullable().optional(), items: itemsSchema }), body);
    return this.db.transaction(async (tx) => {
      const list = await this.checkAssets(tx, ctx, b.items.map((i) => i.assetId));
      const number = await this.numbering.piece(tx, ctx.user.entityId, 'REF');
      const [d] = await tx.insert(disposals).values({ entityId: ctx.user.entityId, number, title: b.title, exitMode: b.exitMode, reason: b.reason ?? null, commissionDate: b.commissionDate ?? null, createdBy: ctx.user.id }).returning();
      await tx.insert(disposalItems).values(b.items.map((i) => { const a = list.find((x) => x.id === i.assetId)!; return { disposalId: d.id, assetId: a.id, motive: i.motive, nbvAtProposal: valuesAt(a).nbv, previousStatus: a.status }; }));
      await this.audit.log(tx, ctx, 'CREATION', 'REFORME', number, { biens: list.map((a) => a.code), mode: b.exitMode });
      return d;
    });
  }

  @Patch(':id') @Perm('disposals.write')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ title: z.string().min(3).optional(), exitMode: z.enum(['VENTE', 'DESTRUCTION', 'DON', 'RECYCLAGE', 'PERTE']).optional(), reason: z.string().optional(),
      commissionDate: zDate.nullable().optional(), items: itemsSchema.optional() }), body);
    return this.db.transaction(async (tx) => {
      const d = await this.load(tx, ctx, parse(zId, id));
      if (!['BROUILLON', 'REJETE'].includes(d.status)) throw new BadRequestException('Le dossier est en circuit : il ne peut plus être modifié');
      const { items, ...head } = b;
      await tx.update(disposals).set({ ...head, status: 'BROUILLON' }).where(eq(disposals.id, d.id));
      if (items) {
        const list = await this.checkAssets(tx, ctx, items.map((i) => i.assetId), d.id);
        await tx.delete(disposalItems).where(eq(disposalItems.disposalId, d.id));
        await tx.insert(disposalItems).values(items.map((i) => { const a = list.find((x) => x.id === i.assetId)!; return { disposalId: d.id, assetId: a.id, motive: i.motive, nbvAtProposal: valuesAt(a).nbv, previousStatus: a.status }; }));
      }
      await this.audit.log(tx, ctx, 'MODIFICATION', 'REFORME', d.number, { ...head, biens: items?.length });
      return { ok: true };
    });
  }

  @Post(':id/soumettre') @Perm('disposals.write')
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const d = await this.load(tx, ctx, parse(zId, id));
      if (!['BROUILLON', 'REJETE'].includes(d.status)) throw new BadRequestException('Dossier déjà soumis');
      const items = await tx.select().from(disposalItems).where(eq(disposalItems.disposalId, d.id));
      const list = await this.checkAssets(tx, ctx, items.map((i) => i.assetId), d.id);
      for (const a of list) await tx.update(disposalItems).set({ previousStatus: a.status, nbvAtProposal: valuesAt(a).nbv }).where(and(eq(disposalItems.disposalId, d.id), eq(disposalItems.assetId, a.id)));
      await tx.update(assets).set({ status: 'PROPOSE_REFORME', updatedAt: new Date() }).where(inArray(assets.id, list.map((a) => a.id)));
      await tx.insert(assetEvents).values(list.map((a) => ({ assetId: a.id, type: 'REFORME', documentNo: d.number, summary: `Proposé à la réforme (${d.number})`, actorId: ctx.user.id })));
      await tx.update(disposals).set({ status: 'EN_COURS' }).where(eq(disposals.id, d.id));
      await this.wf.start(tx, ctx.user.entityId, 'REFORME', d.id, [
        { label: 'Avis du contrôle financier', role: 'CONTROLEUR', days: 5 },
        { label: 'Commission de réforme', role: 'DIRECTEUR', days: 10 },
        { label: "Décision de sortie de l'ordonnateur", role: 'FINANCES', days: 5 },
      ]);
      await this.audit.log(tx, ctx, 'SOUMISSION', 'REFORME', d.number, { biens: list.length });
      return { ok: true };
    });
  }

  /** Exécution de la sortie : biens sortis, ordre de sortie, écriture de sortie (et produit de cession). */
  @Post(':id/executer') @Perm('disposals.validate')
  async execute(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ exitDate: zDate, proceeds: zMoney.default(0), reference: z.string().optional() }), body);
    return this.db.transaction(async (tx) => {
      const d = await this.load(tx, ctx, parse(zId, id));
      if (d.status !== 'APPROUVE') throw new BadRequestException("La sortie s'exécute après la décision de l'ordonnateur");
      if (b.exitDate > today()) throw new BadRequestException('La date de sortie ne peut pas être future');
      if (b.proceeds > 0 && d.exitMode !== 'VENTE') throw new BadRequestException('Un produit de cession suppose une vente');
      const rows = await tx.select({ a: assets, c: categories }).from(disposalItems).innerJoin(assets, eq(assets.id, disposalItems.assetId)).innerJoin(categories, eq(categories.id, assets.categoryId))
        .where(eq(disposalItems.disposalId, d.id));
      const exitOrderNo = await this.numbering.piece(tx, ctx.user.entityId, 'OS');
      const acc = new Map<string, { debit: number; credit: number; label: string }>();
      const add = (account: string, label: string, debit: number, credit: number) => { const x = acc.get(account) ?? { debit: 0, credit: 0, label }; x.debit += debit; x.credit += credit; acc.set(account, x); };
      for (const { a, c } of rows) {
        const cum = cumulativeAt(deprInput(a), b.exitDate);
        add(c.deprAccount ?? '2840', 'Amortissements des biens sortis', cum, 0);
        add('8120', 'Valeur comptable des cessions', a.acquisitionValue - cum, 0);
        add(c.assetAccount ?? '2000', 'Sortie du patrimoine', 0, a.acquisitionValue);
        await tx.update(assets).set({ status: 'SORTI', exitDate: b.exitDate, exitReason: `${EXIT_MODES[d.exitMode]} · ${d.number}`, holderId: null, updatedAt: new Date() }).where(eq(assets.id, a.id));
      }
      if (b.proceeds > 0) { add('4851', 'Créances sur cessions', b.proceeds, 0); add('8220', 'Produits des cessions', 0, b.proceeds); }
      await tx.insert(assetEvents).values(rows.map(({ a }) => ({ assetId: a.id, type: 'SORTIE', documentNo: exitOrderNo, summary: `Sorti du patrimoine : ${EXIT_MODES[d.exitMode].toLowerCase()} (${d.number}, ordre de sortie ${exitOrderNo})`, actorId: ctx.user.id })));
      await tx.update(disposals).set({ status: 'SORTI', proceeds: b.proceeds, exitOrderNo, executedAt: new Date() }).where(eq(disposals.id, d.id));
      await this.journal.createBatch(tx, ctx, { originType: 'SORTIE', originRef: d.number, label: `Sortie du patrimoine ${d.number}`, date: b.exitDate,
        lines: [...acc.entries()].map(([account, v]) => ({ account, label: v.label, debit: v.debit, credit: v.credit })) });
      await this.audit.log(tx, ctx, 'SORTIE', 'REFORME', d.number, { ordreSortie: exitOrderNo, biens: rows.length, produit: b.proceeds, reference: b.reference ?? null });
      return { exitOrderNo };
    });
  }
}
