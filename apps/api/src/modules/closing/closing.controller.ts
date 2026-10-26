import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { DB, Tx } from '../../db/client';
import { approvals, assets, categories, depreciationRuns, fiscalPeriods, fiscalYears, inventoryCampaigns, inventoryGaps, journalBatches, ledgerBalances, reconciliationNotes } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { parse, z, zDate, zId } from '../../common/validation';
import { cumulativeAt } from '../depreciation/engine';
import { deprInput, today } from '../assets/assets.util';

/** Refuse toute pièce datée d'un exercice clôturé. */
export async function assertYearOpen(tx: Tx, entityId: number, date: string) {
  const [y] = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.entityId, entityId), eq(fiscalYears.year, Number(date.slice(0, 4)))));
  if (y?.status === 'CLOTURE') throw new BadRequestException(`L'exercice ${date.slice(0, 4)} est clôturé : aucune pièce ne peut plus y être datée`);
}

/** Soldes du registre par compte à une date : valeurs brutes (2x), amortissements (28x), dépréciations (29x). */
export async function registerBalances(tx: Tx, entityId: number, date: string) {
  const rows = await tx.select({ a: assets, c: categories }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId))
    .where(and(eq(assets.entityId, entityId), lte(assets.acquisitionDate, date)));
  const m = new Map<string, { account: string; label: string; amount: number; count: number }>();
  const add = (account: string | null, label: string, amount: number) => {
    if (!account || !amount) return;
    const x = m.get(account) ?? { account, label, amount: 0, count: 0 }; x.amount += amount; x.count++; m.set(account, x);
  };
  for (const { a, c } of rows) {
    if (a.exitDate && a.exitDate <= date) continue;
    add(c.assetAccount, c.label, a.acquisitionValue);
    add(c.deprAccount, `Amortissements · ${c.label}`, cumulativeAt(deprInput(a), date));
    if (a.impairment) add(c.deprAccount ? '29' + c.deprAccount.slice(2) : '2940', `Dépréciations · ${c.label}`, a.impairment);
  }
  return [...m.values()].sort((x, y) => x.account.localeCompare(y.account));
}

@Controller('cloture')
export class ClosingController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  /** Rapprochement registre / comptabilité générale à une date d'arrêté. */
  @Get('rapprochement') @Perm('closing.manage', 'journal.read')
  async reconcile(@CurrentCtx() ctx: Ctx, @Query('date') date?: string) {
    const eid = ctx.user.entityId;
    let d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
    if (!d) { const [last] = await this.db.select({ d: ledgerBalances.date }).from(ledgerBalances).where(eq(ledgerBalances.entityId, eid)).orderBy(desc(ledgerBalances.date)).limit(1); d = last?.d ?? today(); }
    const reg = await registerBalances(this.db, eid, d);
    const gl = await this.db.select().from(ledgerBalances).where(and(eq(ledgerBalances.entityId, eid), eq(ledgerBalances.date, d)));
    const notes = await this.db.select().from(reconciliationNotes).where(and(eq(reconciliationNotes.entityId, eid), eq(reconciliationNotes.date, d))).orderBy(asc(reconciliationNotes.account));
    const accounts = [...new Set([...reg.map((r) => r.account), ...gl.map((g) => g.account)])].sort();
    const lines = accounts.map((account) => {
      const r = reg.find((x) => x.account === account); const g = gl.find((x) => x.account === account);
      const diff = (g?.balance ?? 0) - (r?.amount ?? 0);
      const explained = notes.filter((n) => n.account === account).reduce((s, n) => s + n.amount, 0);
      return { account, label: r?.label ?? g?.label ?? '', register: r?.amount ?? 0, ledger: g ? g.balance : null, diff: g ? diff : null, explained, unexplained: g ? diff - explained : null, count: r?.count ?? 0 };
    });
    const imported = gl.length > 0;
    const dates = await this.db.selectDistinct({ d: ledgerBalances.date }).from(ledgerBalances).where(eq(ledgerBalances.entityId, eid)).orderBy(desc(ledgerBalances.date));
    return { date: d, imported, importDates: dates.map((x) => x.d), lines, notes,
      totals: { register: lines.filter((l) => !l.account.startsWith('28') && !l.account.startsWith('29')).reduce((s, l) => s + l.register, 0),
        ledger: lines.filter((l) => !l.account.startsWith('28') && !l.account.startsWith('29')).reduce((s, l) => s + (l.ledger ?? 0), 0),
        gap: lines.reduce((s, l) => s + Math.abs(l.diff ?? 0), 0), unexplained: lines.reduce((s, l) => s + Math.abs(l.unexplained ?? 0), 0),
        accountsOk: lines.filter((l) => l.diff === 0).length, accounts: lines.length } };
  }

  /** Import des soldes de la balance générale (export de l'ERP). */
  @Post('soldes') @Perm('closing.manage')
  async importBalances(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ date: zDate, balances: z.array(z.object({ account: z.string().regex(/^2\d{1,11}$/, 'compte de classe 2 attendu'), label: z.string().optional(), balance: z.coerce.number().int() })).min(1).max(2000) }), body);
    return this.db.transaction(async (tx) => {
      await tx.delete(ledgerBalances).where(and(eq(ledgerBalances.entityId, ctx.user.entityId), eq(ledgerBalances.date, b.date)));
      await tx.insert(ledgerBalances).values(b.balances.map((x) => ({ entityId: ctx.user.entityId, date: b.date, account: x.account, label: x.label ?? null, balance: Math.abs(x.balance), importedBy: ctx.user.id })));
      await this.audit.log(tx, ctx, 'IMPORT_BALANCE', 'RAPPROCHEMENT', b.date, { comptes: b.balances.length });
      return { imported: b.balances.length };
    });
  }

  @Post('explications') @Perm('closing.manage')
  async addNote(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ date: zDate, account: z.string().min(2), amount: z.coerce.number().int(), label: z.string().min(5), status: z.enum(['A_CORRIGER', 'CORRIGE', 'JUSTIFIE']).default('A_CORRIGER') }), body);
    return this.db.transaction(async (tx) => {
      const [n] = await tx.insert(reconciliationNotes).values({ entityId: ctx.user.entityId, ...b, createdBy: ctx.user.id }).returning();
      await this.audit.log(tx, ctx, 'EXPLICATION_ECART', 'RAPPROCHEMENT', `${b.date} · ${b.account}`, b);
      return n;
    });
  }

  @Patch('explications/:id') @Perm('closing.manage')
  async updateNote(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['A_CORRIGER', 'CORRIGE', 'JUSTIFIE']) }), body);
    return this.db.transaction(async (tx) => {
      const [n] = await tx.update(reconciliationNotes).set(b).where(and(eq(reconciliationNotes.id, parse(zId, id)), eq(reconciliationNotes.entityId, ctx.user.entityId))).returning();
      if (!n) throw new NotFoundException('Explication introuvable');
      await this.audit.log(tx, ctx, 'EXPLICATION_ECART', 'RAPPROCHEMENT', `${n.date} · ${n.account}`, b);
      return n;
    });
  }

  /** Contrôles préalables à la clôture de l'exercice. */
  @Get('exercice/:year') @Perm('closing.manage', 'depreciation.read')
  async checklist(@CurrentCtx() ctx: Ctx, @Param('year') yearS: string) {
    return this.checks(this.db, ctx.user.entityId, Number(yearS));
  }

  private async checks(tx: Tx, eid: number, year: number) {
    const [fy] = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.entityId, eid), eq(fiscalYears.year, year)));
    const end = `${year}-12-31`;
    const lastMonth = year < Number(today().slice(0, 4)) ? 12 : Number(today().slice(5, 7)) - 1;
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const runs = await tx.select().from(depreciationRuns).where(and(eq(depreciationRuns.entityId, eid), eq(depreciationRuns.mode, 'DEFINITIF'), sql`${depreciationRuns.period} like ${year + '-%'}`));
    const closed = await tx.select().from(fiscalPeriods).where(and(eq(fiscalPeriods.entityId, eid), eq(fiscalPeriods.closed, true), sql`${fiscalPeriods.period} like ${year + '-%'}`));
    const missingRuns = months.filter((m) => !runs.some((r) => r.period === m));
    const camp = await tx.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.entityId, eid), eq(inventoryCampaigns.type, 'GENERAL'), sql`extract(year from ${inventoryCampaigns.endDate}) = ${year}`)).orderBy(desc(inventoryCampaigns.id));
    const closedCamp = camp.find((c) => c.status === 'CLOTUREE');
    const openGaps = camp.length ? await tx.select({ n: sql<number>`count(*)` }).from(inventoryGaps).where(and(inArray(inventoryGaps.campaignId, camp.map((c) => c.id)), ne(inventoryGaps.status, 'REGULARISE'))) : [{ n: 0 }];
    const pending = await tx.select({ t: approvals.objectType, n: sql<number>`count(distinct ${approvals.objectId})` }).from(approvals).where(and(eq(approvals.entityId, eid), eq(approvals.status, 'EN_COURS'))).groupBy(approvals.objectType);
    const batches = await tx.select({ s: journalBatches.status, n: sql<number>`count(*)` }).from(journalBatches).where(and(eq(journalBatches.entityId, eid), sql`extract(year from ${journalBatches.date}) = ${year}`)).groupBy(journalBatches.status);
    const notIntegrated = batches.filter((b) => b.s === 'A_ENVOYER' || b.s === 'REJETE').reduce((s, b) => s + Number(b.n), 0);
    const glDates = await tx.selectDistinct({ d: ledgerBalances.date }).from(ledgerBalances).where(and(eq(ledgerBalances.entityId, eid), eq(ledgerBalances.date, end)));
    let unexplained: number | null = null;
    if (glDates.length) {
      const reg = await registerBalances(tx, eid, end);
      const gl = await tx.select().from(ledgerBalances).where(and(eq(ledgerBalances.entityId, eid), eq(ledgerBalances.date, end)));
      const notes = await tx.select().from(reconciliationNotes).where(and(eq(reconciliationNotes.entityId, eid), eq(reconciliationNotes.date, end), eq(reconciliationNotes.status, 'JUSTIFIE')));
      const accts = [...new Set([...reg.map((r) => r.account), ...gl.map((g) => g.account)])];
      unexplained = accts.reduce((s, a) => s + Math.abs((gl.find((g) => g.account === a)?.balance ?? 0) - (reg.find((r) => r.account === a)?.amount ?? 0) - notes.filter((n) => n.account === a).reduce((x, n) => x + n.amount, 0)), 0);
    }
    const items = [
      { key: 'dotations', label: "Dotations des 12 mois comptabilisées", ok: missingRuns.length === 0, detail: missingRuns.length ? `Manquent : ${missingRuns.join(', ')}` : `${runs.length} calculs définitifs` },
      { key: 'periodes', label: 'Périodes mensuelles clôturées', ok: closed.length === 12, detail: `${closed.length} sur 12` },
      { key: 'inventaire', label: "Inventaire général clôturé, PV signé", ok: !!closedCamp, detail: closedCamp ? `${closedCamp.number} clôturé le ${closedCamp.closedAt?.toISOString().slice(0, 10)}` : camp.length ? `${camp[0].number} : ${camp[0].status.toLowerCase().replace('_', ' ')}` : "aucune campagne générale sur l'exercice" },
      { key: 'ecarts', label: "Écarts d'inventaire tous régularisés", ok: Number(openGaps[0].n) === 0, detail: `${openGaps[0].n} écart(s) sans décision finale` },
      { key: 'rapprochement', label: 'Rapprochement registre / comptabilité au 31/12 à zéro ou justifié', ok: unexplained === 0, detail: unexplained == null ? "Balance au 31/12 non importée" : `Écart non justifié : ${unexplained.toLocaleString('fr-FR')} FCFA` },
      { key: 'circuits', label: 'Aucune pièce en cours de validation', ok: pending.length === 0, detail: pending.length ? pending.map((p) => `${p.n} ${p.t.toLowerCase()}`).join(', ') : 'circuits soldés' },
      { key: 'ecritures', label: "Écritures intégrées dans l'ERP", ok: notIntegrated === 0, detail: notIntegrated ? `${notIntegrated} lot(s) non intégré(s)` : 'tous intégrés' },
    ];
    return { year, status: fy?.status ?? 'OUVERT', closedAt: fy?.closedAt ?? null, summary: fy?.summary ?? null, ready: items.every((i) => i.ok), items, lastMonthDue: lastMonth };
  }

  /** Clôture : verrouille l'exercice (plus aucune pièce datée de l'année) et fige la situation de clôture. */
  @Post('exercice/:year') @Perm('closing.manage')
  async close(@CurrentCtx() ctx: Ctx, @Param('year') yearS: string) {
    const year = Number(yearS);
    return this.db.transaction(async (tx) => {
      const c = await this.checks(tx, ctx.user.entityId, year);
      if (c.status === 'CLOTURE') throw new BadRequestException('Exercice déjà clôturé');
      if (!c.ready) throw new BadRequestException(`Conditions non remplies : ${c.items.filter((i) => !i.ok).map((i) => i.label.toLowerCase()).join(' ; ')}`);
      const reg = await registerBalances(tx, ctx.user.entityId, `${year}-12-31`);
      const gross = reg.filter((r) => !r.account.startsWith('28') && !r.account.startsWith('29')).reduce((s, r) => s + r.amount, 0);
      const depr = reg.filter((r) => r.account.startsWith('28')).reduce((s, r) => s + r.amount, 0);
      const imp = reg.filter((r) => r.account.startsWith('29')).reduce((s, r) => s + r.amount, 0);
      const summary = { valeurBrute: gross, amortissements: depr, depreciations: imp, vnc: gross - depr - imp, comptes: reg };
      await tx.insert(fiscalYears).values({ entityId: ctx.user.entityId, year, status: 'CLOTURE', closedAt: new Date(), closedBy: ctx.user.id, summary })
        .onConflictDoUpdate({ target: [fiscalYears.entityId, fiscalYears.year], set: { status: 'CLOTURE', closedAt: new Date(), closedBy: ctx.user.id, summary } });
      await this.audit.log(tx, ctx, 'CLOTURE_EXERCICE', 'EXERCICE', String(year), { valeurBrute: gross, vnc: gross - depr - imp });
      return { ok: true, summary };
    });
  }
}
