import { BadRequestException, Body, Controller, Get, NotFoundException, OnModuleInit, Param, Patch, Post } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { assertYearOpen } from '../closing/closing.controller';
import { assetEvents, assets, categories, locations, receptionLines, receptions, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import { parse, z, zDate, zId, zMoney } from '../../common/validation';
import { WorkflowService } from '../workflow/workflow.service';
import { groupBy, JournalService } from '../journal/journal.service';

const lineSchema = z.object({
  designation: z.string().min(2), categoryId: zId, brand: z.string().optional(), model: z.string().optional(),
  qtyOrdered: z.coerce.number().int().min(0), qtyDelivered: z.coerce.number().int().min(0), qtyAccepted: z.coerce.number().int().min(0),
  unitValue: zMoney, reserve: z.string().optional(), serials: z.array(z.string()).default([]),
}).refine((l) => l.qtyAccepted <= l.qtyDelivered, { message: 'la quantité conforme ne peut dépasser la quantité livrée' })
  .refine((l) => l.qtyAccepted === l.qtyDelivered || !!l.reserve, { message: 'une réserve est obligatoire quand des articles ne sont pas conformes' });
const recSchema = z.object({
  entryMode: z.enum(['ACHAT', 'DON', 'TRANSFERT_ENTRANT', 'PRODUCTION']).default('ACHAT'), supplier: z.string().min(2), orderRef: z.string().optional(),
  deliveryNote: z.string().optional(), invoiceRef: z.string().optional(), deliveryDate: zDate, locationId: zId.nullable().optional(), notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, 'au moins une ligne'),
});
/** Contrepartie de l'entrée selon son mode (plan SYSCOHADA révisé). */
const COUNTER: Record<string, [string, string]> = {
  ACHAT: ['4812', "Fournisseurs d'investissements"], DON: ['1441', "Subventions d'investissement reçues"],
  TRANSFERT_ENTRANT: ['1810', 'Comptes de liaison des établissements'], PRODUCTION: ['7220', 'Production immobilisée'],
};

@Controller('receptions')
export class ReceptionsController implements OnModuleInit {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService,
    private readonly wf: WorkflowService, private readonly journal: JournalService) {}

  onModuleInit() {
    this.wf.register('RECEPTION', {
      describe: async (tx, id) => {
        const [r] = await tx.select().from(receptions).where(eq(receptions.id, id));
        const lines = await tx.select().from(receptionLines).where(eq(receptionLines.receptionId, id));
        const n = lines.reduce((s, l) => s + l.qtyAccepted, 0), v = lines.reduce((s, l) => s + l.qtyAccepted * l.unitValue, 0);
        return { number: r.number, title: `Réception de ${n} article(s) · ${r.supplier}`, subtitle: `${v.toLocaleString('fr-FR')} FCFA · livré le ${r.deliveryDate}`, requestedBy: r.createdBy, link: `/receptions/${id}` };
      },
      onApproved: (tx, ctx, id) => this.materialize(tx, ctx, id),
      onRejected: async (tx, _ctx, id) => { await tx.update(receptions).set({ status: 'REJETEE' }).where(eq(receptions.id, id)); },
    });
  }

  @Get() @Perm('receptions.write', 'receptions.validate')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ r: receptions, author: users.fullName }).from(receptions).leftJoin(users, eq(users.id, receptions.createdBy))
      .where(eq(receptions.entityId, ctx.user.entityId)).orderBy(desc(receptions.id));
    const lines = rows.length ? await this.db.select().from(receptionLines).where(inArray(receptionLines.receptionId, rows.map((r) => r.r.id))) : [];
    return rows.map(({ r, author }) => {
      const ls = lines.filter((l) => l.receptionId === r.id);
      return { ...r, author, articles: ls.reduce((s, l) => s + l.qtyAccepted, 0), total: ls.reduce((s, l) => s + l.qtyDelivered * l.unitValue, 0),
        accepted: ls.reduce((s, l) => s + l.qtyAccepted * l.unitValue, 0), reserves: ls.filter((l) => l.reserve).length };
    });
  }

  @Get(':id') @Perm('receptions.write', 'receptions.validate')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const [r] = await this.db.select({ r: receptions, author: users.fullName, location: locations.name }).from(receptions).leftJoin(users, eq(users.id, receptions.createdBy))
      .leftJoin(locations, eq(locations.id, receptions.locationId)).where(and(eq(receptions.id, parse(zId, id)), eq(receptions.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Réception introuvable');
    const lines = await this.db.select({ l: receptionLines, category: categories.label }).from(receptionLines).innerJoin(categories, eq(categories.id, receptionLines.categoryId))
      .where(eq(receptionLines.receptionId, r.r.id)).orderBy(asc(receptionLines.id));
    const created = await this.db.select({ id: assets.id, code: assets.code, designation: assets.designation, labelStatus: assets.labelStatus }).from(assets)
      .where(eq(assets.receptionId, r.r.id)).orderBy(asc(assets.code));
    return { ...r.r, author: r.author, location: r.location, lines: lines.map((x) => ({ ...x.l, category: x.category })), steps: await this.wf.steps(this.db, 'RECEPTION', r.r.id), assets: created };
  }

  @Post() @Perm('receptions.write')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(recSchema, body);
    return this.db.transaction(async (tx) => {
      await assertYearOpen(tx, ctx.user.entityId, b.deliveryDate);
      const number = await this.numbering.piece(tx, ctx.user.entityId, 'PVR');
      const { lines, ...head } = b;
      const [r] = await tx.insert(receptions).values({ ...head, entityId: ctx.user.entityId, number, createdBy: ctx.user.id }).returning();
      await tx.insert(receptionLines).values(lines.map((l) => ({ ...l, receptionId: r.id })));
      await this.audit.log(tx, ctx, 'CREATION', 'RECEPTION', number, { fournisseur: b.supplier, lignes: lines.length });
      return r;
    });
  }

  @Patch(':id') @Perm('receptions.write')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(recSchema, body);
    return this.db.transaction(async (tx) => {
      const r = await this.editable(tx, ctx, parse(zId, id));
      await assertYearOpen(tx, ctx.user.entityId, b.deliveryDate);
      const { lines, ...head } = b;
      await tx.update(receptions).set({ ...head, status: 'BROUILLON' }).where(eq(receptions.id, r.id));
      await tx.delete(receptionLines).where(eq(receptionLines.receptionId, r.id));
      await tx.insert(receptionLines).values(lines.map((l) => ({ ...l, receptionId: r.id })));
      await this.audit.log(tx, ctx, 'MODIFICATION', 'RECEPTION', r.number, { lignes: lines.length });
      return { ok: true };
    });
  }

  private async editable(tx: Tx, ctx: Ctx, id: number) {
    const [r] = await tx.select().from(receptions).where(and(eq(receptions.id, id), eq(receptions.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Réception introuvable');
    if (!['BROUILLON', 'REJETEE'].includes(r.status)) throw new BadRequestException('Seul un brouillon ou une réception rejetée peut être modifié');
    return r;
  }

  @Post(':id/soumettre') @Perm('receptions.write')
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.transaction(async (tx) => {
      const r = await this.editable(tx, ctx, parse(zId, id));
      const lines = await tx.select().from(receptionLines).where(eq(receptionLines.receptionId, r.id));
      if (!lines.some((l) => l.qtyAccepted > 0)) throw new BadRequestException('Aucun article conforme : rien à faire entrer au patrimoine');
      const total = lines.reduce((s, l) => s + l.qtyAccepted * l.unitValue, 0);
      await tx.update(receptions).set({ status: 'A_VALIDER' }).where(eq(receptions.id, r.id));
      await this.wf.submit(tx, ctx.user.entityId, 'RECEPTION', 'TOUS', r.id, { amount: total, requesterId: r.createdBy });
      await this.audit.log(tx, ctx, 'SOUMISSION', 'RECEPTION', r.number, { montant: total });
      return { ok: true };
    });
  }

  /** Validation finale : un bien immatriculé par article conforme, ordre d'entrée et écriture d'immobilisation. */
  private async materialize(tx: Tx, ctx: Ctx, id: number) {
    const [r] = await tx.select().from(receptions).where(eq(receptions.id, id));
    const lines = await tx.select({ l: receptionLines, c: categories }).from(receptionLines).innerJoin(categories, eq(categories.id, receptionLines.categoryId))
      .where(eq(receptionLines.receptionId, id));
    const entryOrderNo = await this.numbering.piece(tx, r.entityId, 'OE');
    const year = Number(r.deliveryDate.slice(0, 4));
    const created: { id: number; code: string; account: string | null; value: number }[] = [];
    for (const { l, c } of lines) {
      if (!c.prefix) throw new BadRequestException(`La catégorie ${c.label} n'a pas de préfixe de codification`);
      for (let i = 0; i < l.qtyAccepted; i++) {
        const code = await this.numbering.assetCode(tx, r.entityId, c.prefix, year);
        const [a] = await tx.insert(assets).values({
          entityId: r.entityId, code, designation: l.designation, categoryId: c.id, status: 'EN_STOCK', condition: 'NEUF', serialNumber: l.serials[i] ?? null,
          brand: l.brand, model: l.model, entryMode: r.entryMode, acquisitionDate: r.deliveryDate, acquisitionValue: l.unitValue, deprMethod: c.method, deprYears: c.durationYears,
          locationId: r.locationId, supplier: r.supplier, invoiceRef: r.invoiceRef, receptionId: r.id, entryOrderNo, labelStatus: 'GENEREE',
        }).returning({ id: assets.id, code: assets.code });
        created.push({ ...a, account: c.assetAccount, value: l.unitValue });
      }
    }
    if (created.length) await tx.insert(assetEvents).values(created.map((a) => ({ assetId: a.id, type: 'ENTREE', documentNo: r.number, summary: `Entrée au patrimoine par réception ${r.number} · ordre d'entrée ${entryOrderNo}`, actorId: ctx.user.id })));
    await tx.update(receptions).set({ status: 'VALIDEE', validatedAt: new Date(), entryOrderNo }).where(eq(receptions.id, id));
    const [cAcc, cLab] = COUNTER[r.entryMode] ?? COUNTER.ACHAT;
    const byAcc = groupBy(created.map((a) => ({ account: a.account, amount: a.value })), '2000');
    const total = created.reduce((s, a) => s + a.value, 0);
    await this.journal.createBatch(tx, ctx, { originType: 'RECEPTION', originRef: r.number, label: `Entrée en patrimoine ${r.number}`, date: r.deliveryDate,
      lines: [...byAcc.map(([account, amount]) => ({ account, label: `Immobilisation · ${r.supplier}`, debit: amount })), { account: cAcc, label: cLab, credit: total }] });
    await this.audit.log(tx, ctx, 'IMMATRICULATION', 'RECEPTION', r.number, { ordreEntree: entryOrderNo, biens: created.length, premier: created[0]?.code, dernier: created[created.length - 1]?.code });
  }
}
