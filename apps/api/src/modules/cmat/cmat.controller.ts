import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DB } from '../../db/client';
import { assets, attestations, categories, disposals, entities, inventoryCampaigns, orgUnits, receptionLines, receptions, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { today } from '../assets/assets.util';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');

/** Comptabilité-matières : registres tenus en quantités et en valeurs à partir des pièces visées. */
@Controller('comptabilite-matieres')
export class CmatController {
  constructor(@InjectDb() private readonly db: DB) {}

  async compute(ctx: Ctx, year: number) {
    const eid = ctx.user.entityId;
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const rows = await this.db.select({ a: assets, c: categories }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId)).where(eq(assets.entityId, eid));
    // Grand livre par catégorie : situation d'entrée, entrées, sorties, situation de sortie (quantités et valeurs d'origine)
    const gl = new Map<string, { account: string; label: string; q0: number; v0: number; qi: number; vi: number; qo: number; vo: number }>();
    for (const { a, c } of rows) {
      const k = c.code;
      const x = gl.get(k) ?? { account: c.assetAccount ?? c.code, label: c.label, q0: 0, v0: 0, qi: 0, vi: 0, qo: 0, vo: 0 };
      const present0 = a.acquisitionDate < start && (!a.exitDate || a.exitDate >= start);
      const inYear = a.acquisitionDate >= start && a.acquisitionDate <= end;
      const outYear = !!a.exitDate && a.exitDate >= start && a.exitDate <= end;
      if (present0) { x.q0++; x.v0 += a.acquisitionValue; }
      if (inYear) { x.qi++; x.vi += a.acquisitionValue; }
      if (outYear) { x.qo++; x.vo += a.acquisitionValue; }
      gl.set(k, x);
    }
    const ledger = [...gl.values()].filter((x) => x.q0 || x.qi || x.qo).map((x) => ({ ...x, q1: x.q0 + x.qi - x.qo, v1: x.v0 + x.vi - x.vo })).sort((a, b) => a.account.localeCompare(b.account));
    // Livre-journal : ordres d'entrée (réceptions visées), entrées manuelles, ordres de sortie
    const recs = await this.db.select().from(receptions).where(and(eq(receptions.entityId, eid), eq(receptions.status, 'VALIDEE'), gte(receptions.deliveryDate, start), lte(receptions.deliveryDate, end)));
    const lines = recs.length ? await this.db.select().from(receptionLines).where(inArray(receptionLines.receptionId, recs.map((r) => r.id))) : [];
    const journal: { date: string; order: string; piece: string; label: string; qin: number; qout: number; value: number }[] = [];
    for (const r of recs) for (const l of lines.filter((x) => x.receptionId === r.id && x.qtyAccepted)) journal.push({ date: r.deliveryDate, order: r.entryOrderNo ?? '', piece: r.number, label: l.designation, qin: l.qtyAccepted, qout: 0, value: l.qtyAccepted * l.unitValue });
    for (const { a } of rows.filter(({ a }) => !a.receptionId && a.entryMode !== 'REPRISE' && a.acquisitionDate >= start && a.acquisitionDate <= end))
      journal.push({ date: a.acquisitionDate, order: a.entryOrderNo ?? '—', piece: a.code, label: `${a.designation} (${a.entryMode.toLowerCase()})`, qin: 1, qout: 0, value: a.acquisitionValue });
    const outs = await this.db.select().from(disposals).where(and(eq(disposals.entityId, eid), eq(disposals.status, 'SORTI')));
    for (const d of outs) {
      const its = rows.filter(({ a }) => a.exitReason?.includes(d.number) && a.exitDate! >= start && a.exitDate! <= end);
      if (its.length) journal.push({ date: its[0].a.exitDate!, order: d.exitOrderNo ?? '', piece: d.number, label: d.title, qin: 0, qout: its.length, value: its.reduce((s, x) => s + x.a.acquisitionValue, 0) });
    }
    journal.sort((a, b) => a.date.localeCompare(b.date));
    // Fiches détenteurs
    const holders = await this.db.select({ id: users.id, name: users.fullName, unit: orgUnits.name, n: sql<number>`count(${assets.id})`, v: sql<string>`sum(${assets.acquisitionValue})` }).from(assets)
      .innerJoin(users, eq(users.id, assets.holderId)).leftJoin(orgUnits, eq(orgUnits.id, users.orgUnitId))
      .where(and(eq(assets.entityId, eid), inArray(assets.status, ['EN_SERVICE', 'EN_PRET', 'EN_MAINTENANCE']))).groupBy(users.id, users.fullName, orgUnits.name).orderBy(users.fullName);
    const att = await this.db.select({ h: attestations.holderId, at: sql<string>`max(${attestations.signedAt})` }).from(attestations).groupBy(attestations.holderId);
    const am = new Map(att.map((x) => [x.h, x.at]));
    const [camp] = await this.db.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.entityId, eid), eq(inventoryCampaigns.type, 'GENERAL'), sql`extract(year from ${inventoryCampaigns.endDate}) = ${year}`)).limit(1);
    const tot = ledger.reduce((s, x) => ({ v0: s.v0 + x.v0, vi: s.vi + x.vi, vo: s.vo + x.vo, v1: s.v1 + x.v1, q0: s.q0 + x.q0, qi: s.qi + x.qi, qo: s.qo + x.qo, q1: s.q1 + x.q1 }), { v0: 0, vi: 0, vo: 0, v1: 0, q0: 0, qi: 0, qo: 0, q1: 0 });
    const [accountant] = await this.db.select({ n: users.fullName }).from(users).where(and(eq(users.entityId, eid), eq(users.role, 'COMPTABLE_MATIERES'))).limit(1);
    return {
      year, ledger, journal: journal.map((j, i) => ({ ...j, no: `${year}-${String(i + 1).padStart(4, '0')}` })), totals: tot,
      holders: holders.map((h) => ({ ...h, n: Number(h.n), v: Number(h.v), lastAttestation: am.get(h.id) ?? null })),
      account: { accountant: accountant?.n ?? null, inventory: camp ? { number: camp.number, status: camp.status } : null, entries: journal.filter((j) => j.qin).length, exits: journal.filter((j) => j.qout).length },
    };
  }

  @Get() @Perm('reports.read')
  get(@CurrentCtx() ctx: Ctx, @Query('year') year?: string) { return this.compute(ctx, Number(year) || Number(today().slice(0, 4))); }

  @Get('grand-livre.xlsx') @Perm('reports.read')
  async ledgerXlsx(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('year') year?: string) {
    const d = await this.compute(ctx, Number(year) || Number(today().slice(0, 4)));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Grand livre');
    ws.addRow([`Grand livre des matières · exercice ${d.year}`]).font = { name: 'Arial', bold: true, size: 14 };
    ws.addRow([]);
    const h = ws.addRow(['Compte', 'Catégorie', 'Qté entrée', 'Valeur entrée', 'Qté entrées', 'Valeur entrées', 'Qté sorties', 'Valeur sorties', 'Qté finale', 'Valeur finale']);
    h.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }; h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13294B' } }; });
    for (const x of d.ledger) ws.addRow([x.account, x.label, x.q0, x.v0, x.qi, x.vi, x.qo, x.vo, x.q1, x.v1]);
    ws.addRow(['Total', '', d.totals.q0, d.totals.v0, d.totals.qi, d.totals.vi, d.totals.qo, d.totals.vo, d.totals.q1, d.totals.v1]).font = { name: 'Arial', bold: true };
    [10, 36, 10, 16, 10, 16, 10, 16, 10, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; if ([3, 5, 7, 9].includes(i)) ws.getColumn(i + 1).numFmt = '#,##0'; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="grand-livre-matieres-${d.year}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  }

  /** Compte de gestion matières (PDF) : situation d'entrée, mouvements de l'exercice, situation de sortie. */
  @Get('compte-gestion.pdf') @Perm('reports.read')
  async account(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('year') year?: string) {
    const d = await this.compute(ctx, Number(year) || Number(today().slice(0, 4)));
    const [ent] = await this.db.select().from(entities).where(eq(entities.id, ctx.user.entityId));
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="compte-gestion-matieres-${d.year}.pdf"`); doc.pipe(res);
    doc.rect(0, 0, doc.page.width, 64).fill('#13294B');
    doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(16).text(`Compte de gestion matières · exercice ${d.year}`, 36, 18);
    doc.font('Helvetica').fontSize(9).text(`${ent.name} · comptable-matières : ${d.account.accountant ?? '-'} · édité le ${today().split('-').reverse().join('/')}`, 36, 40);
    doc.fill('#16202E'); doc.y = 84;
    const cols = [60, 190, 50, 80, 50, 80, 50, 80, 50, 80]; const heads = ['Compte', 'Catégorie', 'Qté', "Entrée", 'Qté', 'Entrées', 'Qté', 'Sorties', 'Qté', 'Sortie'];
    const row = (vals: string[], bold = false) => { let x = 36; const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5); vals.forEach((v, i) => { doc.text(v, x + 2, y, { width: cols[i] - 4, align: i > 1 ? 'right' : 'left' }); x += cols[i]; }); doc.y = y + 16; };
    row(heads, true);
    for (const x of d.ledger) row([x.account, x.label.slice(0, 40), String(x.q0), fmt(x.v0), String(x.qi), fmt(x.vi), String(x.qo), fmt(x.vo), String(x.q1), fmt(x.v1)]);
    row(['Total', '', String(d.totals.q0), fmt(d.totals.v0), String(d.totals.qi), fmt(d.totals.vi), String(d.totals.qo), fmt(d.totals.vo), String(d.totals.q1), fmt(d.totals.v1)], true);
    doc.moveDown(1).font('Helvetica').fontSize(9).text(`Ordres d'entrée : ${d.account.entries} · ordres de sortie : ${d.account.exits} · inventaire de fin d'exercice : ${d.account.inventory ? `${d.account.inventory.number} (${d.account.inventory.status.toLowerCase()})` : 'non réalisé'}`, 36);
    doc.moveDown(2).text('Visa du comptable-matières', 36).text("Visa de l'ordonnateur", 420, doc.y - 11);
    doc.end();
  }
}
