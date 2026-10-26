import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { and, desc, eq, or } from 'drizzle-orm';
import { DB } from '../../db/client';
import { entities, reportDefinitions, users } from '../../db/schema';
import { InjectDb } from '../../common/db.module';
import { CurrentCtx, Ctx, Perm } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { can } from '../../common/permissions';
import { parse, z, zId } from '../../common/validation';
import { today } from '../assets/assets.util';
import { Column, Definition, definitionSchema, display, execute, Result } from './engine';
import { SOURCES } from './sources';

const saveSchema = z.object({ name: z.string().trim().min(3).max(120), description: z.string().max(500).nullable().optional(), shared: z.boolean().default(false), definition: definitionSchema });
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'etat';

/** Générateur d'états personnalisés : sources en liste blanche, filtres, regroupements, exports. */
@Controller('rapports')
export class ReportBuilderController {
  constructor(@InjectDb() private readonly db: DB, private readonly audit: AuditService) {}

  @Get('sources') @Perm('reports.read')
  sources(@CurrentCtx() ctx: Ctx) {
    return Object.entries(SOURCES).filter(([, s]) => s.perms.some((p) => can(ctx.user.role, p))).map(([key, s]) => ({
      key, label: s.label, description: s.description,
      fields: Object.entries(s.fields).map(([k, f]) => ({ key: k, label: f.label, type: f.type, options: f.options ?? null, default: !!f.default, computed: !!f.computed })),
    }));
  }

  @Get() @Perm('reports.read')
  async list(@CurrentCtx() ctx: Ctx) {
    const rows = await this.db.select({ r: reportDefinitions, author: users.fullName }).from(reportDefinitions).leftJoin(users, eq(users.id, reportDefinitions.createdBy))
      .where(and(eq(reportDefinitions.entityId, ctx.user.entityId), or(eq(reportDefinitions.createdBy, ctx.user.id), eq(reportDefinitions.shared, true)))).orderBy(desc(reportDefinitions.updatedAt));
    return rows.filter((r) => SOURCES[r.r.source]?.perms.some((p) => can(ctx.user.role, p)))
      .map((r) => ({ ...r.r, author: r.author, sourceLabel: SOURCES[r.r.source]?.label ?? r.r.source, mine: r.r.createdBy === ctx.user.id }));
  }

  private async load(ctx: Ctx, id: string, write = false) {
    const [r] = await this.db.select().from(reportDefinitions).where(and(eq(reportDefinitions.id, parse(zId, id)), eq(reportDefinitions.entityId, ctx.user.entityId)));
    if (!r || (r.createdBy !== ctx.user.id && !r.shared)) throw new NotFoundException('État introuvable');
    if (write && r.createdBy !== ctx.user.id && ctx.user.role !== 'ADMIN') throw new ForbiddenException("Seul l'auteur de l'état (ou l'administrateur) peut le modifier");
    return r;
  }

  @Get(':id') @Perm('reports.read')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.load(ctx, id);
    return { ...r, mine: r.createdBy === ctx.user.id };
  }

  @Post() @Perm('reports.read')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(saveSchema, body);
    await execute(this.db, ctx.user.entityId, ctx.user.role, b.definition, { maxDisplay: 1 }); // valide la définition
    return this.db.transaction(async (tx) => {
      const [r] = await tx.insert(reportDefinitions).values({ entityId: ctx.user.entityId, name: b.name, description: b.description ?? null, shared: b.shared, source: b.definition.source, definition: b.definition, createdBy: ctx.user.id }).returning();
      await this.audit.log(tx, ctx, 'CREATION', 'ETAT', b.name, { source: b.definition.source, partage: b.shared });
      return r;
    });
  }

  @Put(':id') @Perm('reports.read')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const r = await this.load(ctx, id, true);
    const b = parse(saveSchema, body);
    await execute(this.db, ctx.user.entityId, ctx.user.role, b.definition, { maxDisplay: 1 });
    return this.db.transaction(async (tx) => {
      await tx.update(reportDefinitions).set({ name: b.name, description: b.description ?? null, shared: b.shared, source: b.definition.source, definition: b.definition, updatedAt: new Date() }).where(eq(reportDefinitions.id, r.id));
      await this.audit.log(tx, ctx, 'MODIFICATION', 'ETAT', b.name, { source: b.definition.source, partage: b.shared });
      return { ok: true };
    });
  }

  /** Suppression d'une définition d'état (paramétrage, pas une pièce comptable). */
  @Delete(':id') @Perm('reports.read')
  async remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.load(ctx, id, true);
    return this.db.transaction(async (tx) => {
      await tx.delete(reportDefinitions).where(eq(reportDefinitions.id, r.id));
      await this.audit.log(tx, ctx, 'SUPPRESSION', 'ETAT', r.name, {});
      return { ok: true };
    });
  }

  @Post('executer') @Perm('reports.read')
  run(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ definition: definitionSchema }), body);
    return execute(this.db, ctx.user.entityId, ctx.user.role, b.definition, { maxDisplay: 2000 });
  }

  @Post('exporter') @Perm('reports.read')
  async exportDraft(@CurrentCtx() ctx: Ctx, @Body() body: unknown, @Res() res: Response) {
    const b = parse(z.object({ definition: definitionSchema, name: z.string().max(120).default('État personnalisé'), format: z.enum(['xlsx', 'csv', 'pdf']) }), body);
    await this.send(ctx, res, b.name, b.definition, b.format);
  }

  @Get(':id/export') @Perm('reports.read')
  async exportSaved(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    if (!['xlsx', 'csv', 'pdf'].includes(format)) throw new BadRequestException('Format attendu : xlsx, csv ou pdf');
    const r = await this.load(ctx, id);
    await this.send(ctx, res, r.name, parse(definitionSchema, r.definition), format as 'xlsx' | 'csv' | 'pdf');
  }

  private async send(ctx: Ctx, res: Response, name: string, def: Definition, format: 'xlsx' | 'csv' | 'pdf') {
    const result = await execute(this.db, ctx.user.entityId, ctx.user.role, def);
    const [ent] = await this.db.select().from(entities).where(eq(entities.id, ctx.user.entityId));
    const file = `${slug(name)}-${today()}`;
    const sub = `${ent.name} · ${SOURCES[def.source].label} · ${result.count.toLocaleString('fr-FR')} ligne(s) source · édité le ${today().split('-').reverse().join('/')} par ${ctx.user.fullName}`;
    if (format === 'csv') {
      const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [result.columns.map((c) => esc(c.label)).join(';'), ...result.rows.map((r) => result.columns.map((c) => esc(display(c, r[c.key]))).join(';'))];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file}.csv"`);
      res.send('﻿' + lines.join('\r\n'));
      return;
    }
    if (format === 'xlsx') return this.xlsx(res, file, name, sub, result);
    return this.pdf(res, file, name, sub, result);
  }

  private async xlsx(res: Response, file: string, name: string, sub: string, r: Result) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SIGP';
    const ws = wb.addWorksheet('État', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.addRow([name]).font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FF13294B' } };
    ws.addRow([sub]).font = { name: 'Arial', size: 9, color: { argb: 'FF5B6775' } };
    ws.addRow([]);
    const h = ws.addRow(r.columns.map((c) => c.label));
    h.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13294B' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
    for (const row of r.rows) ws.addRow(r.columns.map((c) => display(c, row[c.key])));
    if (r.totals) {
      const t = ws.addRow(r.columns.map((c, i) => (r.totals![c.key] != null ? r.totals![c.key] : i === 0 ? 'Total' : null)));
      t.font = { name: 'Arial', bold: true };
      t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F6' } }; });
    }
    r.columns.forEach((c: Column, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.type === 'text' ? Math.min(40, Math.max(12, c.label.length + 4)) : Math.max(14, c.label.length + 2);
      if (c.type === 'money' || c.type === 'number') col.numFmt = '#,##0';
      if (c.type === 'percent') col.numFmt = '0.0" %"';
    });
    if (r.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + r.rows.length, column: r.columns.length } };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  }

  private pdf(res: Response, file: string, name: string, sub: string, r: Result) {
    const cols = r.columns.slice(0, 10);
    const doc = new PDFDocument({ size: 'A4', layout: cols.length > 5 ? 'landscape' : 'portrait', margin: 32, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${file}.pdf"`); doc.pipe(res);
    const W = doc.page.width - 64;
    const weight = (c: Column) => (c.type === 'text' ? 2.2 : c.type === 'enum' ? 1.4 : 1.1);
    const tw = cols.reduce((s, c) => s + weight(c), 0);
    const widths = cols.map((c) => (weight(c) / tw) * W);
    const fmt = (c: Column, v: unknown) => { const d = display(c, v); if (d == null) return '—'; if (typeof d === 'number') return c.type === 'percent' ? `${d.toLocaleString('fr-FR')} %` : d.toLocaleString('fr-FR').replace(/ | /g, ' '); return d; };
    const header = () => {
      doc.rect(0, 0, doc.page.width, 58).fill('#13294B');
      doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(14).text(name, 32, 14, { width: W });
      doc.font('Helvetica').fontSize(8).text(sub, 32, 36, { width: W });
      doc.fill('#16202E'); doc.y = 72;
      row(cols.map((c) => c.label), true);
    };
    const row = (vals: string[], head = false) => {
      doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 7.5 : 8);
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: widths[i] - 6 }))) + 6;
      if (doc.y + h > doc.page.height - 40) { doc.addPage(); header(); doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 7.5 : 8); }
      const y = doc.y;
      if (head) doc.rect(32, y - 2, W, h).fill('#EEF2F6').fill('#16202E');
      let x = 32;
      vals.forEach((v, i) => { doc.text(v, x + 3, y + 1, { width: widths[i] - 6, align: cols[i].type === 'text' || cols[i].type === 'enum' || head ? 'left' : 'right' }); x += widths[i]; });
      doc.moveTo(32, y + h - 2).lineTo(32 + W, y + h - 2).strokeColor('#DDE3EA').lineWidth(0.5).stroke();
      doc.y = y + h;
    };
    header();
    for (const x of r.rows) row(cols.map((c) => fmt(c, x[c.key])));
    if (r.totals) row(cols.map((c, i) => (r.totals![c.key] != null ? fmt(c, r.totals![c.key]) : i === 0 ? 'Total' : '')), true);
    if (r.columns.length > cols.length) doc.moveDown().font('Helvetica-Oblique').fontSize(8).text(`${r.columns.length - cols.length} colonne(s) non imprimée(s) : utilisez l'export Excel.`, 32);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) { doc.switchToPage(i); doc.font('Helvetica').fontSize(7).fill('#5B6775').text(`SIGP · page ${i + 1} / ${range.count}`, 32, doc.page.height - 24, { width: W, align: 'right', lineBreak: false }); }
    doc.end();
  }
}
