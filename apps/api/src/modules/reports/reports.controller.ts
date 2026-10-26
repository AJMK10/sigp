import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DB } from '../../db/client';
import { approvals, assets, auditLog, categories, disposals, entities, inventoryCampaigns, inventoryGaps, receptionLines, receptions, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { parse, zId } from '../../common/validation';
import { cumulativeAt } from '../depreciation/engine';
import { deprInput, STATUS_LABELS, today, valuesAt } from '../assets/assets.util';
import { locationPaths } from '../referentials/referentials.controller';
import { DECISIONS } from '../inventory/inventory.controller';

const NAVY = '13294B';
const pdfSafe = (s: string | null | undefined) => (s ?? '').replace(/›/g, '>').replace(/→/g, '->').replace(/[’]/g, "'").replace(/[^\x00-\xFF]/g, '');
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
const frDate = (d: string | Date | null | undefined) => { if (!d) return ''; const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };

async function sendXlsx(res: Response, wb: ExcelJS.Workbook, name: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
}
function sheet(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, headers: { header: string; key: string; width: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.getCell('A1').value = title; ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF' + NAVY } };
  ws.getCell('A2').value = subtitle; ws.getCell('A2').font = { name: 'Arial', size: 9, color: { argb: 'FF5B6775' } };
  const hr = ws.getRow(4);
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = h.width;
    const c = hr.getCell(i + 1); c.value = h.header; c.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + NAVY } }; c.alignment = { vertical: 'middle', wrapText: true };
    if (h.money) ws.getColumn(i + 1).numFmt = '#,##0';
  });
  hr.height = 30;
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };
  return { ws, add: (vals: unknown[]) => { const r = ws.addRow(vals); r.font = { name: 'Arial', size: 10 }; return r; } };
}
function pdfStart(res: Response, name: string, layout: 'portrait' | 'landscape' = 'portrait') {
  const doc = new PDFDocument({ size: 'A4', layout, margin: 40, info: { Title: name, Author: 'SIGP' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  doc.pipe(res);
  return doc;
}
function pdfHeader(doc: PDFKit.PDFDocument, entity: string, title: string, ref: string) {
  doc.rect(0, 0, doc.page.width, 70).fill('#' + NAVY);
  doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(16).text(pdfSafe(title), 40, 20, { width: doc.page.width - 80 });
  doc.font('Helvetica').fontSize(9).text(pdfSafe(`${entity} · ${ref}`), 40, 44);
  doc.fill('#16202E').moveDown(2); doc.y = 90;
}
function kvTable(doc: PDFKit.PDFDocument, rows: [string, string][], x = 40, w = 515) {
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fill('#5B6775').text(pdfSafe(k), x, y, { width: 160 });
    doc.font('Helvetica').fontSize(10).fill('#16202E').text(pdfSafe(v), x + 170, y, { width: w - 170 });
    doc.moveDown(0.4);
  }
}
function grid(doc: PDFKit.PDFDocument, headers: string[], widths: number[], rows: string[][], right: number[] = []) {
  const x0 = 40;
  const drawHead = () => {
    let x = x0; const y = doc.y;
    doc.rect(x0, y - 2, widths.reduce((a, b) => a + b, 0), 18).fill('#EEF2F6');
    doc.fill('#3E4753').font('Helvetica-Bold').fontSize(8);
    headers.forEach((h, i) => { doc.text(pdfSafe(h), x + 3, y + 3, { width: widths[i] - 6, align: right.includes(i) ? 'right' : 'left' }); x += widths[i]; });
    doc.y = y + 18;
  };
  drawHead();
  doc.font('Helvetica').fontSize(8.5).fill('#16202E');
  for (const r of rows) {
    const h = Math.max(...r.map((c, i) => doc.heightOfString(pdfSafe(c), { width: widths[i] - 6 }))) + 6;
    if (doc.y + h > doc.page.height - 50) { doc.addPage(); doc.y = 40; drawHead(); doc.font('Helvetica').fontSize(8.5).fill('#16202E'); }
    let x = x0; const y = doc.y;
    r.forEach((c, i) => { doc.text(pdfSafe(c), x + 3, y + 3, { width: widths[i] - 6, align: right.includes(i) ? 'right' : 'left' }); x += widths[i]; });
    doc.moveTo(x0, y + h).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y + h).strokeColor('#DDE3EA').lineWidth(0.5).stroke();
    doc.y = y + h;
  }
}

@Controller('etats')
export class ReportsController {
  constructor(@InjectDb() private readonly db: DB) {}

  private async entity(ctx: Ctx) { const [e] = await this.db.select().from(entities).where(eq(entities.id, ctx.user.entityId)); return e; }

  /** Registre des immobilisations à une date d'arrêté. */
  @Get('registre.xlsx') @Perm('reports.read')
  async register(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('date') date?: string) {
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today();
    const ent = await this.entity(ctx);
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const rows = await this.db.select({ a: assets, cat: categories, holder: users.fullName }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId))
      .leftJoin(users, eq(users.id, assets.holderId)).where(and(eq(assets.entityId, ctx.user.entityId), lte(assets.acquisitionDate, d))).orderBy(asc(assets.code));
    const wb = new ExcelJS.Workbook(); wb.creator = 'SIGP';
    const { ws, add } = sheet(wb, 'Registre', `Registre des immobilisations au ${frDate(d)}`, `${ent.name} · généré le ${frDate(today())} par ${ctx.user.fullName} · montants en FCFA`, [
      { header: 'Code', key: 'code', width: 22 }, { header: 'Désignation', key: 'd', width: 36 }, { header: 'Catégorie', key: 'c', width: 24 }, { header: 'Compte', key: 'acc', width: 9 },
      { header: 'Statut', key: 's', width: 16 }, { header: 'Localisation', key: 'l', width: 40 }, { header: 'Détenteur', key: 'h', width: 18 }, { header: 'Acquisition', key: 'ad', width: 12 },
      { header: 'Mise en service', key: 'sd', width: 12 }, { header: "Valeur d'origine", key: 'vo', width: 15, money: true }, { header: 'Cumul amortissements', key: 'cum', width: 15, money: true },
      { header: 'VNC', key: 'vnc', width: 15, money: true }, { header: 'Vétusté', key: 'w', width: 9 }, { header: 'Méthode', key: 'm', width: 11 }, { header: 'Durée (ans)', key: 'y', width: 8 }]);
    let tv = 0, tc = 0;
    for (const { a, cat, holder } of rows) {
      if (a.exitDate && a.exitDate <= d) continue;
      const cum = cumulativeAt(deprInput(a), d);
      tv += a.acquisitionValue; tc += cum;
      const r = add([a.code, a.designation, cat.label, cat.assetAccount, STATUS_LABELS[a.status], a.locationId ? paths.get(a.locationId) : '', holder ?? '', a.acquisitionDate, a.inServiceDate ?? '',
        a.acquisitionValue, cum, a.acquisitionValue - cum, a.acquisitionValue ? cum / a.acquisitionValue : 0, a.deprMethod.toLowerCase(), a.deprYears]);
      r.getCell(13).numFmt = '0%';
    }
    const t = add(['Total', `${ws.rowCount - 4} biens`, '', '', '', '', '', '', '', tv, tc, tv - tc]);
    t.font = { name: 'Arial', bold: true, size: 10 };
    await sendXlsx(res, wb, `registre-immobilisations-${d}.xlsx`);
  }

  /** Tableau des immobilisations et des amortissements par compte (note annexe SYSCOHADA). */
  @Get('amortissements.xlsx') @Perm('reports.read')
  async depreciation(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('year') year?: string) {
    const y = Number(year) || new Date().getFullYear();
    const start = `${y - 1}-12-31`, end = `${y}-12-31` > today() ? today() : `${y}-12-31`;
    const ent = await this.entity(ctx);
    const rows = await this.db.select({ a: assets, cat: categories }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId)).where(eq(assets.entityId, ctx.user.entityId));
    const by = new Map<string, { label: string; voStart: number; inV: number; outV: number; cumStart: number; dot: number; cumOut: number; cumEnd: number; voEnd: number }>();
    for (const { a, cat } of rows) {
      const acc = cat.assetAccount ?? '—';
      const x = by.get(acc) ?? { label: cat.label, voStart: 0, inV: 0, outV: 0, cumStart: 0, dot: 0, cumOut: 0, cumEnd: 0, voEnd: 0 };
      const inv = deprInput(a);
      const presentStart = a.acquisitionDate <= start && (!a.exitDate || a.exitDate > start);
      const enteredYear = a.acquisitionDate > start && a.acquisitionDate <= end;
      const exitedYear = !!a.exitDate && a.exitDate > start && a.exitDate <= end;
      const presentEnd = a.acquisitionDate <= end && (!a.exitDate || a.exitDate > end);
      const cS = presentStart ? cumulativeAt(inv, start) : 0;
      if (presentStart) { x.voStart += a.acquisitionValue; x.cumStart += cS; }
      if (enteredYear) x.inV += a.acquisitionValue;
      if (exitedYear) { x.outV += a.acquisitionValue; const cE = cumulativeAt(inv, a.exitDate!); x.cumOut += cE; x.dot += cE - cS; }
      if (presentEnd) { const cE = cumulativeAt(inv, end); x.voEnd += a.acquisitionValue; x.cumEnd += cE; x.dot += cE - cS; }
      by.set(acc, x);
    }
    const wb = new ExcelJS.Workbook();
    const { add } = sheet(wb, `Exercice ${y}`, `Tableau des immobilisations et des amortissements · exercice ${y}`, `${ent.name} · arrêté au ${frDate(end)} · montants en FCFA`, [
      { header: 'Compte', key: 'a', width: 10 }, { header: 'Libellé', key: 'l', width: 32 }, { header: 'Valeur brute début', key: 'vs', width: 16, money: true }, { header: 'Acquisitions', key: 'in', width: 15, money: true },
      { header: 'Sorties', key: 'out', width: 15, money: true }, { header: 'Valeur brute fin', key: 've', width: 16, money: true }, { header: 'Amortissements début', key: 'cs', width: 16, money: true },
      { header: "Dotations de l'exercice", key: 'd', width: 16, money: true }, { header: 'Reprises (sorties)', key: 'co', width: 15, money: true }, { header: 'Amortissements fin', key: 'ce', width: 16, money: true },
      { header: 'VNC fin', key: 'vnc', width: 16, money: true }]);
    const tot = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const [acc, x] of [...by.entries()].sort()) {
      const v = [x.voStart, x.inV, x.outV, x.voEnd, x.cumStart, x.dot, x.cumOut, x.cumEnd, x.voEnd - x.cumEnd];
      v.forEach((n, i) => (tot[i] += n));
      add([acc, x.label, ...v]);
    }
    add(['Total', '', ...tot]).font = { name: 'Arial', bold: true, size: 10 };
    await sendXlsx(res, wb, `tableau-amortissements-${y}.xlsx`);
  }

  @Get('ecarts/:id.xlsx') @Perm('reports.read', 'inventory.manage')
  async gaps(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Param('id') id: string) {
    const [c] = await this.db.select().from(inventoryCampaigns).where(and(eq(inventoryCampaigns.id, parse(zId, id)), eq(inventoryCampaigns.entityId, ctx.user.entityId)));
    if (!c) throw new NotFoundException('Campagne introuvable');
    const rows = await this.db.select({ g: inventoryGaps, code: assets.code, designation: assets.designation, value: assets.acquisitionValue }).from(inventoryGaps).leftJoin(assets, eq(assets.id, inventoryGaps.assetId))
      .where(eq(inventoryGaps.campaignId, c.id)).orderBy(asc(inventoryGaps.type));
    const wb = new ExcelJS.Workbook();
    const { add } = sheet(wb, 'Écarts', `État des écarts d'inventaire · ${c.number}`, `${c.label} · du ${frDate(c.startDate)} au ${frDate(c.endDate)}`, [
      { header: 'Type', key: 't', width: 14 }, { header: 'Code', key: 'c', width: 22 }, { header: 'Désignation', key: 'd', width: 34 }, { header: 'Détail', key: 'x', width: 60 },
      { header: "Valeur d'origine", key: 'v', width: 15, money: true }, { header: 'Décision', key: 'dec', width: 34 }, { header: 'Statut', key: 's', width: 12 }, { header: 'Commentaire', key: 'cm', width: 40 }]);
    for (const r of rows) add([r.g.type.replace('_', ' ').toLowerCase(), r.code ?? r.g.scannedCode, r.designation ?? '', r.g.detail, r.value ?? '', r.g.decision ? DECISIONS[r.g.type][r.g.decision]?.label : '', r.g.status.toLowerCase(), r.g.decisionComment ?? '']);
    await sendXlsx(res, wb, `ecarts-${c.number}.xlsx`);
  }

  @Get('audit.xlsx') @Perm('audit.read')
  async audit(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.db.select().from(auditLog).where(and(eq(auditLog.entityId, ctx.user.entityId), from ? gte(auditLog.at, new Date(from)) : undefined, to ? lte(auditLog.at, new Date(to + 'T23:59:59')) : undefined))
      .orderBy(asc(auditLog.id)).limit(100000);
    const wb = new ExcelJS.Workbook();
    const { add } = sheet(wb, 'Journal', "Journal d'audit", `Extraction du ${frDate(today())} · ${rows.length} événements · empreintes SHA-256 chaînées`, [
      { header: 'N°', key: 'n', width: 8 }, { header: 'Horodatage', key: 'at', width: 20 }, { header: 'Utilisateur', key: 'u', width: 20 }, { header: 'Action', key: 'a', width: 20 },
      { header: 'Objet', key: 'o', width: 14 }, { header: 'Référence', key: 'r', width: 24 }, { header: 'Détail', key: 'd', width: 60 }, { header: 'Empreinte', key: 'h', width: 66 }]);
    for (const r of rows) add([r.id, r.at.toISOString().replace('T', ' ').slice(0, 19), r.userName ?? '', r.action, r.objectType ?? '', r.objectRef ?? '', JSON.stringify(r.detail), r.hash]);
    await sendXlsx(res, wb, `journal-audit-${today()}.xlsx`);
  }

  /** Livre-journal des matières : entrées (ordres d'entrée) et sorties (ordres de sortie) de l'exercice. */
  @Get('livre-journal.xlsx') @Perm('reports.read')
  async ledger(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('year') year?: string) {
    const y = Number(year) || new Date().getFullYear();
    const recs = await this.db.select().from(receptions).where(and(eq(receptions.entityId, ctx.user.entityId), eq(receptions.status, 'VALIDEE'), gte(receptions.deliveryDate, `${y}-01-01`), lte(receptions.deliveryDate, `${y}-12-31`)));
    const lines = recs.length ? await this.db.select().from(receptionLines).where(inArray(receptionLines.receptionId, recs.map((r) => r.id))) : [];
    const outs = await this.db.select().from(disposals).where(and(eq(disposals.entityId, ctx.user.entityId), eq(disposals.status, 'SORTI')));
    const outAssets = await this.db.select().from(assets).where(and(eq(assets.entityId, ctx.user.entityId), eq(assets.status, 'SORTI'), gte(assets.exitDate, `${y}-01-01`), lte(assets.exitDate, `${y}-12-31`)));
    const ev: [string, string, string, string, number, number, number][] = [];
    for (const r of recs) for (const l of lines.filter((x) => x.receptionId === r.id)) if (l.qtyAccepted) ev.push([r.deliveryDate, r.entryOrderNo ?? '', r.number, l.designation, l.qtyAccepted, 0, l.qtyAccepted * l.unitValue]);
    for (const d of outs) { const its = outAssets.filter((a) => a.exitReason?.includes(d.number)); if (its.length) ev.push([its[0].exitDate!, d.exitOrderNo ?? '', d.number, d.title, 0, its.length, its.reduce((s, a) => s + a.acquisitionValue, 0)]); }
    ev.sort((a, b) => a[0].localeCompare(b[0]));
    const wb = new ExcelJS.Workbook();
    const { add } = sheet(wb, 'Livre-journal', `Livre-journal des matières · ${y}`, `${(await this.entity(ctx)).name} · tenu à partir des ordres d'entrée et de sortie visés`, [
      { header: "N° d'ordre", key: 'n', width: 10 }, { header: 'Date', key: 'd', width: 12 }, { header: 'Ordre', key: 'o', width: 22 }, { header: 'Pièce', key: 'p', width: 24 },
      { header: 'Désignation', key: 'x', width: 40 }, { header: 'Entrées', key: 'e', width: 9 }, { header: 'Sorties', key: 's', width: 9 }, { header: 'Valeur (FCFA)', key: 'v', width: 16, money: true }]);
    ev.forEach((e, i) => add([`${y}-${String(i + 1).padStart(4, '0')}`, frDate(e[0]), e[1], e[2], e[3], e[4] || '', e[5] || '', e[6]]));
    await sendXlsx(res, wb, `livre-journal-matieres-${y}.xlsx`);
  }

  /** Fiche d'immobilisation (PDF). */
  @Get('fiche/:id.pdf') @Perm('assets.read')
  async assetSheet(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Param('id') id: string) {
    const [r] = await this.db.select({ a: assets, cat: categories, holder: users.fullName }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId)).leftJoin(users, eq(users.id, assets.holderId))
      .where(and(eq(assets.id, parse(zId, id)), eq(assets.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Bien introuvable');
    const ent = await this.entity(ctx);
    const paths = await locationPaths(this.db, ctx.user.entityId);
    const v = valuesAt(r.a);
    const doc = pdfStart(res, `fiche-${r.a.code}`);
    pdfHeader(doc, ent.name, "Fiche d'immobilisation", r.a.code);
    const qr = await QRCode.toBuffer(r.a.code, { margin: 1, width: 180 });
    doc.image(qr, 455, 90, { width: 100 });
    doc.font('Helvetica-Bold').fontSize(14).text(pdfSafe(r.a.designation), 40, 92, { width: 400 }); doc.moveDown(0.6);
    kvTable(doc, [['Code', r.a.code], ['Catégorie', `${r.cat.code} · ${r.cat.label}`], ['Statut', STATUS_LABELS[r.a.status]], ['Localisation', r.a.locationId ? paths.get(r.a.locationId) ?? '' : '—'],
      ['Détenteur', r.holder ?? '—'], ['N° de série', r.a.serialNumber ?? '—'], ['Marque / modèle', [r.a.brand, r.a.model].filter(Boolean).join(' ') || '—'],
      ["Mode d'entrée", r.a.entryMode.toLowerCase()], ['Fournisseur / facture', [r.a.supplier, r.a.invoiceRef].filter(Boolean).join(' · ') || '—'], ["Ordre d'entrée", r.a.entryOrderNo ?? '—'],
      ['Acquisition / mise en service', `${frDate(r.a.acquisitionDate)} / ${frDate(r.a.inServiceDate) || 'non mis en service'}`],
      ["Valeur d'origine", `${fmt(r.a.acquisitionValue)} FCFA`], ['Amortissement', `${r.a.deprMethod.toLowerCase()} sur ${r.a.deprYears} ans`],
      [`Cumul au ${frDate(today())}`, `${fmt(v.cumulative)} FCFA`], ['Valeur nette comptable', `${fmt(v.nbv)} FCFA (vétusté ${Math.round(v.wear * 100)} %)`]], 40, 400);
    doc.moveDown(1); doc.font('Helvetica-Bold').fontSize(11).text("Plan d'amortissement", 40); doc.moveDown(0.4);
    const { schedule } = await import('../depreciation/engine');
    grid(doc, ['Exercice', 'Dotation', 'Cumul', 'VNC fin'], [100, 140, 140, 135], schedule(deprInput(r.a)).map((l) => [String(l.year), fmt(l.dotation), fmt(l.cumulative), fmt(l.nbv)]), [1, 2, 3]);
    doc.moveDown(1); doc.font('Helvetica').fontSize(8).fill('#5B6775').text(pdfSafe(`Édité le ${frDate(today())} par ${ctx.user.fullName} · SIGP`), 40);
    doc.end();
  }

  /** Procès-verbal de réception (PDF). */
  @Get('pv-reception/:id.pdf') @Perm('receptions.write', 'receptions.validate')
  async receptionPv(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Param('id') id: string) {
    const [r] = await this.db.select().from(receptions).where(and(eq(receptions.id, parse(zId, id)), eq(receptions.entityId, ctx.user.entityId)));
    if (!r) throw new NotFoundException('Réception introuvable');
    const ent = await this.entity(ctx);
    const lines = await this.db.select({ l: receptionLines, cat: categories.label }).from(receptionLines).innerJoin(categories, eq(categories.id, receptionLines.categoryId)).where(eq(receptionLines.receptionId, r.id));
    const steps = await this.db.select({ a: approvals, by: users.fullName }).from(approvals).leftJoin(users, eq(users.id, approvals.decidedBy)).where(and(eq(approvals.objectType, 'RECEPTION'), eq(approvals.objectId, r.id))).orderBy(asc(approvals.step));
    const [author] = await this.db.select({ n: users.fullName }).from(users).where(eq(users.id, r.createdBy));
    const doc = pdfStart(res, r.number);
    pdfHeader(doc, ent.name, 'Procès-verbal de réception', r.number);
    kvTable(doc, [['Fournisseur', r.supplier], ['Bon de commande / marché', r.orderRef ?? '—'], ['Bon de livraison', r.deliveryNote ?? '—'], ['Facture', r.invoiceRef ?? '—'],
      ['Date de livraison', frDate(r.deliveryDate)], ["Mode d'entrée", r.entryMode.toLowerCase()], ['Statut', r.status.toLowerCase().replace('_', ' ')], ["Ordre d'entrée", r.entryOrderNo ?? '—']]);
    doc.moveDown(0.8);
    grid(doc, ['Article', 'Catégorie', 'Cdé', 'Livré', 'Conf.', 'P.U. (FCFA)', 'Montant conforme', 'Réserve'], [125, 80, 30, 34, 34, 62, 72, 78],
      lines.map(({ l, cat }) => [l.designation, cat, String(l.qtyOrdered), String(l.qtyDelivered), String(l.qtyAccepted), fmt(l.unitValue), fmt(l.unitValue * l.qtyAccepted), l.reserve ?? '']), [2, 3, 4, 5, 6]);
    const total = lines.reduce((s, x) => s + x.l.unitValue * x.l.qtyAccepted, 0);
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10).text(pdfSafe(`Montant total conforme : ${fmt(total)} FCFA`), 40, doc.y, { align: 'right', width: 515 });
    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(11).text('Signatures', 40); doc.moveDown(0.4);
    grid(doc, ['Rôle', 'Nom', 'Décision', 'Date'], [170, 140, 100, 105], [['Établi par', author?.n ?? '', 'Saisie', frDate(r.createdAt)],
      ...steps.map((s) => [s.a.label, s.by ?? '', s.a.status === 'APPROUVE' ? 'Visé' : s.a.status.toLowerCase().replace('_', ' '), frDate(s.a.decidedAt)])]);
    doc.end();
  }

  /** Planche d'étiquettes (PDF A4, 3 × 8) avec QR code. */
  @Get('etiquettes.pdf') @Perm('labels.manage')
  async labels(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) throw new BadRequestException('Aucun bien sélectionné');
    if (list.length > 480) throw new BadRequestException('480 étiquettes au plus par planche');
    const ent = await this.entity(ctx);
    const rows = await this.db.select({ a: assets, cat: categories }).from(assets).innerJoin(categories, eq(categories.id, assets.categoryId))
      .where(and(eq(assets.entityId, ctx.user.entityId), inArray(assets.id, list))).orderBy(asc(assets.code));
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Etiquettes', Author: 'SIGP' } });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="etiquettes.pdf"'); doc.pipe(res);
    const W = 595.28 / 3, H = 841.89 / 8;
    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && i % 24 === 0) doc.addPage();
      const k = i % 24, x = (k % 3) * W, y = Math.floor(k / 3) * H;
      const { a, cat } = rows[i];
      doc.rect(x + 6, y + 6, W - 12, H - 12).lineWidth(0.5).strokeColor('#16202E').stroke();
      doc.image(await QRCode.toBuffer(a.code, { margin: 0, width: 160 }), x + 12, y + 16, { width: 62 });
      doc.fill('#16202E').font('Helvetica-Bold').fontSize(6.5).text(pdfSafe(`PROPRIÉTÉ DE ${ent.name.toUpperCase()}`), x + 80, y + 16, { width: W - 92 });
      doc.font('Courier-Bold').fontSize(9).text(a.code, x + 80, y + 36, { width: W - 92 });
      doc.font('Helvetica').fontSize(7).text(pdfSafe(`${a.designation.slice(0, 40)} · ${cat.assetAccount ?? ''}`), x + 80, y + 52, { width: W - 92 });
      doc.fontSize(6).fill('#5B6775').text('Ne pas retirer · signaler toute perte', x + 80, y + 78, { width: W - 92 });
    }
    doc.end();
  }
}
